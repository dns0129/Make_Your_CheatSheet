import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createPiRuntime, AGENT_DIR, PI_CONFIG } from '../server/pi-service.mjs';

const runtime = await createPiRuntime();
const path = resolve(AGENT_DIR, 'installation-id');
let deviceId;
try { deviceId = (await readFile(path, 'utf8')).trim(); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  deviceId = randomUUID(); await writeFile(path, deviceId, { mode: 0o600, flag: 'wx' });
}
const readline = createInterface({ input: stdin, output: stdout });
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 15 * 60 * 1000);
process.on('SIGINT', () => controller.abort());
try {
  await runtime.login(PI_CONFIG.provider, 'oauth', {
    signal: controller.signal,
    prompt: async prompt => {
      if (prompt.type === 'secret') throw new Error('API key login is disabled.');
      return readline.question(`${prompt.message}\n> `, { signal: prompt.signal ?? controller.signal });
    },
    notify: event => {
      if (event.type === 'auth_url') stdout.write(`\nSign in with ChatGPT:\n${event.url}\n\n`);
      else if (event.type === 'progress' || event.type === 'info') stdout.write(`${event.message}\n`);
    },
  }, { getDeviceId: () => deviceId, agentName: 'Sheetwise via Pi' });
  console.log('Connected ChatGPT subscription. Model: gpt-6.1-sol; thinking: medium.');
  console.log('Credentials are stored only in the ignored private Pi runtime directory.');
} catch {
  console.error('ChatGPT login did not complete. Verify auth.openai.com and api.openai.com are allowed, then run npm run pi:login again.');
  process.exitCode = 1;
} finally { clearTimeout(deadline); controller.abort(); readline.close(); }
