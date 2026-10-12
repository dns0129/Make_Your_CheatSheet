const MAX_SIZE = 10 * 1024 * 1024;
export async function parseFile(file) {
  if (file.size > MAX_SIZE) throw new Error('单个文件不能超过 10 MB。');
  const ext = file.name.split('.').pop().toLowerCase();
  const id = crypto.randomUUID();
  if (['txt', 'md', 'markdown'].includes(ext)) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
    let text = new TextDecoder(encoding).decode(buffer);
    if ((text.match(/\uFFFD/g) ?? []).length > text.length * 0.005) {
      const alternative = new TextDecoder('gb18030').decode(buffer);
      if ((alternative.match(/\uFFFD/g) ?? []).length < (text.match(/\uFFFD/g) ?? []).length) text = alternative;
    }
    if (text.includes('\0')) throw new Error('文件不是可读取的文本，请使用 TXT 或 Markdown 文件。');
    return validate({ id, name: file.name, size: file.size, units: [{ text }] });
  }
  if (ext === 'docx') {
    if (!globalThis.mammoth) throw new Error('Word 解析器未加载，请刷新页面后重试。');
    const result = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return validate({ id, name: file.name, size: file.size, units: [{ text: result.value }], warnings: result.messages.map(x => x.message) });
  }
  if (ext === 'pdf') {
    const pdfjs = await import('./vendor/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
    const loading = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
      isEvalSupported: false,
    });
    let pdf;
    try {
      pdf = await loading.promise;
      if (pdf.numPages > 150) throw new Error('第一版支持最多 150 页的 PDF，请分拆文档。');
      const units = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        let line = '', lastY = null; const lines = [];
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const y = item.transform?.[5];
          if (line && lastY !== null && y !== undefined && Math.abs(y - lastY) > 3) { lines.push(line); line = ''; }
          line += (line && !line.endsWith(' ') ? ' ' : '') + item.str;
          lastY = y;
          if (item.hasEOL) { lines.push(line); line = ''; lastY = null; }
        }
        if (line) lines.push(line);
        units.push({ page: n, text: lines.join('\n') });
        page.cleanup();
      }
      return validate({ id, name: file.name, size: file.size, units,
        warnings: units.some(x => x.text.trim().length < 20) ? ['部分页面没有足够文字；扫描页、图片和复杂公式需要人工核对。'] : [] });
    } catch (error) {
      if (error.name === 'PasswordException') throw new Error('此 PDF 已加密，请先解锁后上传。');
      throw error;
    } finally { await loading.destroy(); }
  }
  throw new Error('支持 PDF、DOCX、TXT 和 Markdown 文件。');
}

function validate(doc) {
  const length = doc.units.reduce((sum, x) => sum + x.text.length, 0);
  if (length < 20) throw new Error('没有读取到足够的文字。扫描版 PDF 请先进行 OCR，或粘贴识别后的内容。');
  if (length > 300000) throw new Error('单份文档最多支持 30 万字，请分拆后上传。');
  return { ...doc, characterCount: length };
}
