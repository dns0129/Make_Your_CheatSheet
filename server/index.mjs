import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPiRuntime, generateWithPi, piStatus, PiError } from './pi-service.mjs';

const publicRoot = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.ttf': 'font/ttf', '.pfb': 'application/octet-stream', '.bcmap': 'application/octet-stream' };
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}
async function bodyOf(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 800000) throw new PiError('request_too_large', '请求过大，请减少资料。', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PiError('invalid_json', '请求不是有效 JSON。'); }
}
export function createSheetwiseServer(runtime, generate = generateWithPi) {
  let generating = false;
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/api/pi/status' && request.method === 'GET') { json(response, 200, await piStatus(runtime)); return; }
      if (url.pathname === '/api/pi/generate' && request.method === 'POST') {
        const origin = request.headers.origin;
        if (!origin || new URL(origin).host !== request.headers.host || !['http:', 'https:'].includes(new URL(origin).protocol)) throw new PiError('invalid_origin', '仅允许同站点提交生成请求。', 403);
        if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new PiError('invalid_content_type', '请使用 JSON 请求。', 415);
        if (generating) throw new PiError('busy', '已有一份速查表正在生成，请稍后再试。', 429);
        const payload = await bodyOf(request);
        if (generating) throw new PiError('busy', '已有一份速查表正在生成，请稍后再试。', 429);
        generating = true;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 150000);
        const cancel = () => { if (!response.writableEnded) controller.abort(); };
        response.on('close', cancel);
        try { json(response, 200, { sheet: await generate(runtime, payload, { signal: controller.signal }) }); }
        finally { generating = false; clearTimeout(timeout); response.removeListener('close', cancel); }
        return;
      }
      if (url.pathname.startsWith('/api/')) { json(response, 404, { error: { code: 'not_found', message: '接口不存在。' } }); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { json(response, 405, { error: { code: 'method_not_allowed', message: '不支持该请求方式。' } }); return; }
      const path = resolve(publicRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(publicRoot + sep) || !(await stat(path)).isFile()) throw new PiError('not_found', '页面不存在。', 404);
      const bytes = await readFile(path);
      response.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      const known = error instanceof PiError ? error : new PiError('service_error', '服务暂时不可用。', error.code === 'ENOENT' ? 404 : 500);
      if (!response.writableEnded) json(response, known.status, { error: { code: known.code, message: known.message } });
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await createPiRuntime();
  const port = Number(process.env.SHEETWISE_PORT || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid SHEETWISE_PORT');
  createSheetwiseServer(runtime).listen(port, '127.0.0.1', () => {
    console.log(`Sheetwise + Pi: http://127.0.0.1:${port}`);
    console.log('Model: openai/gpt-6.1-sol; thinking: medium; authentication: ChatGPT subscription only.');
  });
}
