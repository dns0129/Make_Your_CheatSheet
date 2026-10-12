export const CATEGORIES = [
  { id: 'concept', label: '核心知识', icon: '◈' },
  { id: 'formula', label: '公式与定理', icon: 'ƒ' },
  { id: 'steps', label: '解题步骤', icon: '↗' },
  { id: 'pitfall', label: '易错提醒', icon: '!' },
];

export function normalize(text) {
  return String(text ?? '').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').trim();
}

function category(text, heading) {
  const context = heading + ' ' + text;
  if (/易错|误区|注意|不要|不能|切勿|陷阱|特别提醒|常见错误|warning|mistake|pitfall|caution/i.test(context)) return 'pitfall';
  if (/步骤|第一步|第二步|解题流程|求解方法|解题方法|先.{0,12}再|step\s*\d|procedure/i.test(context)) return 'steps';
  if (/公式|定理|法则|分布律|formula|theorem|[=≈≠≤≥∑∫√]|\\(?:frac|sum|int|sqrt)|[A-Za-zα-ωΑ-Ω]\s*[∝∈]/i.test(context)) return 'formula';
  return 'concept';
}

function headingOf(line) {
  if (/^#{1,6}\s+/.test(line)) return line.replace(/^#{1,6}\s+/, '').trim();
  if (/^(?:第.{1,8}[章节]|[一二三四五六七八九十]+[、．.]|\d+(?:\.\d+)*[、．.]\s)/.test(line) && line.length < 65) return line;
  if (line.length < 38 && /^(?:核心知识|基本概念|定义|公式(?:与定理)?|定理|易错(?:提醒|点)?|注意事项|解题步骤|解题方法|知识点|重点)\s*[:：]?$/.test(line)) return line.replace(/[:：]$/, '');
  return null;
}

export function extractCandidates(documents) {
  const items = [];
  for (const doc of documents) {
    let heading = doc.name.replace(/\.[^.]+$/, '');
    for (const unit of doc.units) {
      // Preserve mathematical superscripts/subscripts and original line positions.
      // Compatibility normalization is used for matching only, never evidence.
      const lines = String(unit.text ?? '').replace(/^\ufeff/, '').split(/\r?\n/);
      let fenced = false, code = [], codeStart = 0;
      const add = (body, line, isCode = false) => {
        body = body.trim();
        if (body.length < 4 || /^[\s|\-:—=_]+$/.test(body)) return;
        // Split prose only at sentence boundaries; keep equations and code intact.
        const chunks = !isCode && body.length > 340
          ? body.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [body] : [body];
        for (const chunk of chunks) {
          const clean = chunk.trim();
          if (clean.length < 4) continue;
          const kind = category(clean, heading);
          const shortLabel = clean.match(/^([^:：]{2,30})[:：]/)?.[1];
          items.push({
            id: `item-${items.length + 1}`, category: kind,
            title: shortLabel ?? heading.replace(/^\*+|\*+$/g, ''), body: clean,
            isCode, heading,
            sources: [{ documentId: doc.id, name: doc.name, page: unit.page ?? null, line: line + 1, quote: clean }],
          });
        }
      };
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i], line = raw.trim();
        if (/^```/.test(line)) {
          if (fenced) { add(code.join('\n'), codeStart, true); code = []; }
          else codeStart = i + 1;
          fenced = !fenced; continue;
        }
        if (fenced) { code.push(raw); continue; }
        if (!line) continue;
        const h = headingOf(line);
        if (h) { heading = h; continue; }
        if (/^\|?\s*:?-{3,}/.test(line)) continue;
        add(line.replace(/^[-*+]\s+/, ''), i);
      }
      if (code.length) add(code.join('\n'), codeStart, true);
    }
  }
  const unique = new Map();
  for (const item of items) {
    const key = normalize(item.body).toLowerCase().replace(/\s+/g, ' ');
    if (unique.has(key)) unique.get(key).sources.push(...item.sources);
    else unique.set(key, item);
  }
  return [...unique.values()];
}

export function keywordsFrom(text) {
  return [...new Set(normalize(text).split(/[,，;；\n、]+/).map(x => x.trim()).filter(Boolean))].slice(0, 20);
}

function requirementTerms(text) {
  const words = normalize(text).toLowerCase().match(/[a-z][a-z0-9_-]{1,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  const stop = /^(?:重点|复习|考试|知识点|公式|定理|易错点|解题步骤|整理|包含|简洁|学习|帮助|生成|cheatsheet|the|and|for|with|exam|review)$/;
  const terms = words.filter(x => !stop.test(x));
  const chunks = [];
  for (const word of terms) {
    chunks.push(word);
    if (/[\u4e00-\u9fff]/.test(word)) {
      for (let i = 0; i < word.length - 1; i++) {
        const pair = word.slice(i, i + 2);
        if (!stop.test(pair)) chunks.push(pair);
      }
    }
  }
  return [...new Set(chunks)].slice(0, 100);
}

export function generateSheet(documents, options) {
  if (!documents.length) throw new Error('请先上传文档或粘贴学习资料。');
  const categories = options.categories?.length ? options.categories : CATEGORIES.map(x => x.id);
  const keywords = keywordsFrom(options.keywords ?? '');
  const terms = requirementTerms(options.requirements ?? '');
  const candidates = extractCandidates(documents);
  if (!candidates.length) throw new Error('没有提取到足够的文字内容，请检查文档或粘贴文字资料。');
  const ranked = candidates.filter(x => categories.includes(x.category)).map((item, index) => {
    const text = normalize(item.heading + ' ' + item.body).toLowerCase();
    const entryText = normalize(item.title + ' ' + item.body).toLowerCase();
    const matches = keywords.filter(k => entryText.includes(k.toLowerCase()));
    let score = 1 + matches.length * 20 + terms.reduce((s, term) => s + (text.includes(term) ? 1 : 0), 0);
    if (/定义|定理|重要|关键|核心|必考|注意|易错|definition|theorem|important/i.test(text)) score += 3;
    if (item.body.length > 550) score -= 2;
    return { ...item, score, index, matches };
  });
  const pool = options.scope === 'focused' && keywords.length ? ranked.filter(x => x.matches.length) : ranked;
  if (!pool.length) throw new Error(options.scope === 'focused' && keywords.length
    ? '文档中未找到匹配重点的内容。请修改关键词，或切换到“覆盖全部资料”。'
    : '所选内容类型没有匹配条目。请选择其他类型或补充资料。');
  const budget = { compact: 16, standard: 28, detailed: 44 }[options.density] ?? 28;
  const sorted = [...pool].sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = [];
  // Reserve some space for every selected category, then fill by relevance.
  for (const cat of categories) {
    picked.push(...sorted.filter(x => x.category === cat).slice(0, Math.min(3, Math.floor(budget / categories.length))));
  }
  for (const item of sorted) {
    if (picked.length >= budget) break;
    if (!picked.some(x => x.id === item.id)) picked.push(item);
  }
  picked.sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) || a.index - b.index);
  const missingKeywords = keywords.filter(k => !ranked.some(x => x.matches.includes(k)));
  return {
    title: normalize(options.title) || '我的复习 Cheatsheet',
    requirements: options.requirements ?? '', keywords, density: options.density ?? 'standard',
    columns: options.columns ?? '2', scope: options.scope ?? 'all',
    createdAt: new Date().toISOString(), mode: 'extractive',
    items: picked.map(({ score, index, matches, ...item }) => item),
    documentNames: documents.map(x => x.name),
    candidateCount: candidates.length, omittedCount: pool.length - picked.length,
    missingKeywords,
    emptyCategories: categories.filter(cat => !picked.some(x => x.category === cat)),
  };
}

export function toMarkdown(sheet) {
  const method = sheet.mode === 'pi-ai' ? 'Pi 智能整理 · GPT 6.1 Sol · medium' : '文档提炼版';
  const lines = [`# ${sheet.title}`, '', `> ${method} · ${sheet.items.length} 个重点 · 内容与公式请对照原文核验`, ''];
  if (sheet.requirements) lines.push(`复习目标：${sheet.requirements}`, '');
  for (const cat of CATEGORIES) {
    const items = sheet.items.filter(x => x.category === cat.id);
    if (!items.length) continue;
    lines.push(`## ${cat.label}`, '');
    for (const item of items) {
      lines.push(`### ${item.title}${item.edited ? '（已编辑）' : ''}`, '', item.isCode ? '```\n' + item.body + '\n```' : item.body, '');
      lines.push(`来源：${item.sources.map(sourceLabel).join('；')}`, '');
    }
  }
  if (sheet.missingKeywords.length) lines.push(`资料未覆盖的重点：${sheet.missingKeywords.join('、')}`, '');
  return lines.join('\n');
}

export function sourceLabel(source) {
  return `${source.name} · ${source.page ? `第 ${source.page} 页 · ` : ''}${source.page ? '提取文本第' : '第'} ${source.line} 行`;
}
