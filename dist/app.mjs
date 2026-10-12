import { CATEGORIES, generateSheet, toMarkdown, sourceLabel } from './engine.mjs';
import { parseFile } from './parser.mjs';
import { sampleDocuments } from './sample.mjs';

const $ = id => document.getElementById(id);
const state = { documents: [], sheet: null, busy: false, stale: false, editing: null };
let toastTimer;
const create = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
function toast(message, error = false) {
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { $('toast').hidden = true; }, error ? 7500 : 4000);
}
function markStale() {
  if (!state.sheet) return;
  state.stale = true;
  $('preview-status').textContent = '需求或资料已修改 · 当前显示上次结果，请重新生成';
}
function options() {
  const form = new FormData($('settings-form'));
  return {
    title: form.get('title'), requirements: form.get('requirements'), keywords: form.get('keywords'),
    scope: form.get('scope'), density: form.get('density'),
    categories: form.getAll('category'), columns: $('columns').value,
  };
}
function setBusy(value) {
  state.busy = value;
  $('generate-button').disabled = value;
  $('file-input').disabled = value;
  $('add-paste').disabled = value;
  $('sample-button').disabled = value;
  $('empty-sample')?.toggleAttribute('disabled', value);
  $('generate-button').textContent = value ? '正在读取资料…' : '✳ 生成我的 Cheatsheet →';
  document.querySelectorAll('.doc-remove').forEach(x => { x.disabled = value; });
}
function renderDocuments() {
  const list = $('document-list'); list.replaceChildren();
  $('doc-count').textContent = state.documents.length;
  $('empty-documents').hidden = state.documents.length > 0;
  for (const doc of state.documents) {
    const li = create('li');
    const icon = create('span', 'doc-icon', '▤'); icon.setAttribute('aria-hidden', 'true');
    li.append(icon, create('span', 'doc-name', doc.name));
    if (doc.sample) li.append(create('span', 'sample-pill', '示例'));
    else li.append(create('span', 'doc-meta', doc.units.some(x => x.page) ? `${doc.units.length} 页` : `${Math.round(doc.units.reduce((s, x) => s + x.text.length, 0) / 100) / 10}k 字`));
    if (doc.warnings?.length) { const warning = create('span', 'doc-meta', '⚠'); warning.title = doc.warnings.join('\n'); li.append(warning); }
    const remove = create('button', 'doc-remove', '×');
    remove.type = 'button'; remove.setAttribute('aria-label', `移除 ${doc.name}`); remove.disabled = state.busy;
    remove.addEventListener('click', () => {
      state.documents = state.documents.filter(x => x.id !== doc.id); renderDocuments(); markStale();
    });
    li.append(remove); list.append(li);
  }
}
async function addFiles(files) {
  if (state.busy) return;
  if (state.documents.length + files.length > 8) { toast('最多添加 8 份资料，请先移除部分文档。', true); return; }
  setBusy(true);
  const errors = [];
  try {
    for (const file of files) {
      try {
        const doc = await parseFile(file);
        const length = [...state.documents, doc].reduce((s, x) => s + x.units.reduce((n, u) => n + u.text.length, 0), 0);
        if (length > 500000) throw new Error('全部资料合计最多支持 50 万字，请减少文件。');
        state.documents.push(doc);
        markStale(); renderDocuments();
      } catch (error) { errors.push(`${file.name}：${error.message}`); }
    }
    if (errors.length) toast(errors.join('\n'), true);
    else if (files.length) toast(`已添加 ${files.length} 份资料，点击生成即可整理。`);
  } finally { setBusy(false); $('file-input').value = ''; }
}

function renderMessages() {
  const root = $('sheet-messages'); root.replaceChildren();
  const sheet = state.sheet;
  if (!sheet) return;
  const messages = [];
  if (state.documents.some(x => x.sample)) messages.push('当前包含概率论示例资料。制作自己的速查表时，请移除示例，再添加课程文档。');
  if (sheet.missingKeywords.length) messages.push(`资料未覆盖这些重点：${sheet.missingKeywords.join('、')}。可补充文档后重新生成。`);
  if (sheet.emptyCategories.length) messages.push(`资料中未识别到：${sheet.emptyCategories.map(id => CATEGORIES.find(x => x.id === id).label).join('、')}。`);
  if (sheet.omittedCount > 0) messages.push(`已保留 ${sheet.items.length} 条重点，其余 ${sheet.omittedCount} 条未纳入。需要更多内容时可选择“详细”。`);
  for (const doc of state.documents) for (const warning of doc.warnings ?? []) messages.push(`${doc.name}：${warning}`);
  for (const message of messages) root.append(create('p', 'sheet-message', message));
}
function showSources(item) {
  const content = $('source-content'); content.replaceChildren();
  if (item.edited) content.append(create('p', 'sheet-message', '该条目已手动编辑，以下为原始引用内容。'));
  for (const source of item.sources) {
    const entry = create('section', 'source-entry');
    entry.append(create('h3', '', sourceLabel(source)), create('blockquote', '', source.quote));
    content.append(entry);
  }
  $('source-dialog').showModal();
}
function cardFor(item) {
  const card = create('section', 'sheet-card'); card.dataset.itemId = item.id;
  const heading = create('div', 'card-heading');
  heading.append(create('h4', '', item.title));
  if (item.edited) heading.append(create('span', 'edited-label', '已编辑'));
  const actions = create('div', 'card-actions');
  const edit = create('button', '', '✎'); edit.setAttribute('aria-label', `编辑 ${item.title}`);
  edit.addEventListener('click', () => startEditing(item, card));
  const remove = create('button', '', '×'); remove.setAttribute('aria-label', `删除 ${item.title}`);
  remove.addEventListener('click', () => {
    if (!confirm('从速查表移除这条内容？重新生成可恢复原文条目。')) return;
    state.sheet.items = state.sheet.items.filter(x => x.id !== item.id); state.editing = null; renderSheet();
  });
  actions.append(edit, remove); heading.append(actions);
  const body = create(item.isCode ? 'pre' : 'p', 'card-body', item.body);
  const source = create('button', 'card-source', `↗ ${sourceLabel(item.sources[0])}${item.sources.length > 1 ? ` 等 ${item.sources.length} 处` : ''}`);
  source.setAttribute('aria-label', `查看 ${item.title} 的原文出处`);
  source.addEventListener('click', () => showSources(item));
  card.append(heading, body, source); return card;
}
function startEditing(item, card) {
  if (state.editing) { toast('请先保存或取消正在编辑的条目。'); return; }
  state.editing = item.id;
  const body = card.querySelector('.card-body'); body.hidden = true;
  const form = create('form', 'card-editor');
  const title = create('input'); title.value = item.title; title.maxLength = 120; title.required = true; title.setAttribute('aria-label', '条目标题');
  const text = create('textarea'); text.value = item.body; text.maxLength = 5000; text.required = true; text.rows = 5; text.setAttribute('aria-label', '条目内容');
  const buttons = create('div', 'editor-actions');
  const cancel = create('button', 'small-button', '取消'); cancel.type = 'button';
  cancel.addEventListener('click', () => { state.editing = null; renderSheet(); });
  const save = create('button', 'small-button primary', '保存'); save.type = 'submit';
  buttons.append(cancel, save); form.append(title, text, buttons); body.after(form); text.focus();
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!title.value.trim() || !text.value.trim()) return;
    item.title = title.value.trim(); item.body = text.value.trim(); item.edited = true;
    state.editing = null; renderSheet();
  });
}
function renderSheet() {
  const sheet = state.sheet;
  if (!sheet) return;
  const paper = $('paper'); paper.replaceChildren();
  $('paper-settings').hidden = false;
  $('save-button').disabled = false; $('export-button').disabled = !sheet.items.length; $('print-button').disabled = !sheet.items.length;
  $('columns').value = String(sheet.columns);
  paper.style.setProperty('--print-columns', sheet.columns);
  const header = create('div', 'sheet-header');
  const title = create('div');
  title.append(create('p', 'sheet-eyebrow', 'STUDY NOTES / CHEATSHEET'), create('h2', '', sheet.title));
  if (sheet.requirements) title.append(create('p', 'sheet-goal', sheet.requirements));
  const stamp = create('div', 'sheet-stamp'); stamp.append(create('strong', '', String(sheet.items.length).padStart(2, '0')), create('span', '', '个复习重点'));
  header.append(title, stamp);
  const body = create('div', 'sheet-body'); body.style.columnCount = sheet.columns;
  for (const cat of CATEGORIES) {
    const items = sheet.items.filter(x => x.category === cat.id);
    if (!items.length) continue;
    const section = create('section', `sheet-category category-${cat.id}`);
    const label = create('h3', 'category-heading'); label.append(create('span', 'category-symbol', cat.icon), create('span', '', cat.label));
    section.append(label, ...items.map(cardFor)); body.append(section);
  }
  if (!sheet.items.length) body.append(create('p', 'card-body', '所有条目已移除，可以重新生成。'));
  const footer = create('div', 'sheet-footer');
  footer.append(create('span', 'wordmark', 'sheetwise'), create('span', '', `文档提炼 · ${sheet.documentNames.length} 份资料 · 公式与条件请核验`));
  paper.append(header, body, footer);
  $('preview-status').textContent = state.stale ? '需求或资料已修改 · 当前显示上次结果，请重新生成' : `${sheet.documentNames.length} 份资料 · ${sheet.items.length} 个重点 · 原文出处可核对`;
  renderMessages();
}
function generate() {
  if (state.busy) return;
  if (state.editing && !confirm('重新生成会放弃未保存的编辑，继续生成？')) return;
  if (state.sheet?.items.some(x => x.edited) && !confirm('重新生成会替换已手动编辑的内容，继续生成？')) return;
  const opts = options();
  if (!opts.categories.length) { toast('请至少选择一种内容类型。', true); return; }
  if (opts.scope === 'focused' && !opts.keywords.trim()) { toast('只保留重点时，请填写至少一个关键词。', true); $('keywords').focus(); return; }
  try {
    state.sheet = generateSheet(state.documents, opts);
    state.stale = false; state.editing = null; renderSheet();
    toast(`已整理 ${state.sheet.items.length} 个重点，记得核对原文。`);
  } catch (error) { toast(error.message, true); }
}
function loadSample() {
  if (state.busy) return;
  if ((state.documents.some(x => !x.sample) || state.sheet?.items.some(x => x.edited)) && !confirm('试用示例将替换当前资料与结果。需要保留结果时，请先保存到本机。继续？')) return;
  state.documents = structuredClone(sampleDocuments);
  state.sheet = null; state.stale = false; state.editing = null;
  $('sheet-title').value = '概率论 · 考前速查';
  $('requirements').value = '准备期末考试，重点复习条件概率与贝叶斯公式，保留使用条件和易错提醒。';
  $('keywords').value = '条件概率，贝叶斯'; $('scope').value = 'all';
  $('settings-form').querySelectorAll('[name=category]').forEach(x => { x.checked = true; });
  $('settings-form').querySelector('[name=density][value=standard]').checked = true;
  renderDocuments(); generate();
}
function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = create('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function ensureFinished() {
  if (!state.sheet) return false;
  if (state.editing) { toast('请先保存或取消正在编辑的内容。'); return false; }
  return true;
}
function validDraft(value) {
  return value && typeof value.title === 'string' && value.title.length <= 100 && typeof value.requirements === 'string'
    && ['1', '2', '3'].includes(String(value.columns)) && ['compact', 'standard', 'detailed'].includes(value.density)
    && Array.isArray(value.documentNames) && value.documentNames.every(x => typeof x === 'string')
    && Array.isArray(value.missingKeywords) && value.missingKeywords.every(x => typeof x === 'string')
    && Array.isArray(value.emptyCategories) && value.emptyCategories.every(x => CATEGORIES.some(c => c.id === x))
    && Array.isArray(value.items) && value.items.length <= 44 && value.items.every(x =>
      x && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.body === 'string'
      && x.body.length <= 300000 && CATEGORIES.some(c => c.id === x.category) && Array.isArray(x.sources) && x.sources.length > 0
      && x.sources.every(s => typeof s.name === 'string' && typeof s.quote === 'string' && Number.isInteger(s.line) && s.line > 0
        && (s.page === null || (Number.isInteger(s.page) && s.page > 0))));
}
$('settings-form').addEventListener('submit', event => { event.preventDefault(); generate(); });
$('settings-form').addEventListener('input', markStale);
$('file-input').addEventListener('change', event => addFiles([...event.target.files]));
$('dropzone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!state.busy) $('file-input').click(); } });
for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('dropzone').addEventListener(name, event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('drop', event => { addFiles([...event.dataTransfer.files]); });
function switchTab(tab) {
  for (const name of ['upload', 'paste']) {
    const selected = name === tab;
    $(`${name}-tab`).classList.toggle('active', selected); $(`${name}-tab`).setAttribute('aria-selected', String(selected));
    $(`${name}-tab`).tabIndex = selected ? 0 : -1; $(`${name}-pane`).hidden = !selected;
  }
}
for (const name of ['upload', 'paste']) {
  $(`${name}-tab`).addEventListener('click', () => switchTab(name));
  $(`${name}-tab`).addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'upload' : event.key === 'End' ? 'paste' : name === 'upload' ? 'paste' : 'upload'; switchTab(next); $(`${next}-tab`).focus(); }
  });
}
$('add-paste').addEventListener('click', () => {
  if (state.busy) return;
  const text = $('paste-content').value.trim();
  if (text.length < 20) { toast('请粘贴至少 20 个字符的学习资料。', true); return; }
  if (state.documents.length >= 8) { toast('最多添加 8 份资料。', true); return; }
  if (state.documents.reduce((s, x) => s + x.units.reduce((n, u) => n + u.text.length, 0), 0) + text.length > 500000) { toast('全部资料合计最多支持 50 万字。', true); return; }
  state.documents.push({ id: crypto.randomUUID(), name: $('paste-name').value.trim() || `粘贴笔记 ${state.documents.length + 1}`, units: [{ text }] });
  $('paste-content').value = ''; $('paste-name').value = ''; renderDocuments(); markStale(); toast('文字资料已添加。');
});
$('sample-button').addEventListener('click', loadSample);
$('empty-sample').addEventListener('click', loadSample);
$('columns').addEventListener('change', () => { if (ensureFinished()) { state.sheet.columns = $('columns').value; renderSheet(); } else $('columns').value = String(state.sheet.columns); });
$('export-button').addEventListener('click', () => {
  if (!ensureFinished()) return;
  const filename = state.sheet.title.replace(/[\\/:*?"<>|\r\n]/g, '-').slice(0, 90) || 'cheatsheet';
  download(toMarkdown(state.sheet), `${filename}.md`, 'text/markdown;charset=utf-8'); toast('Markdown 已导出。');
});
$('print-button').addEventListener('click', () => { if (ensureFinished()) window.print(); });
$('save-button').addEventListener('click', () => {
  if (!ensureFinished()) return;
  try { localStorage.setItem('sheetwise-draft-v1', JSON.stringify(state.sheet)); toast('已保存到本机。下次点击 ↶ 恢复结果。'); }
  catch { toast('浏览器无法保存本机草稿，请导出 Markdown 保存。', true); }
});
$('restore-button').addEventListener('click', () => {
  try {
    const raw = localStorage.getItem('sheetwise-draft-v1');
    if (!raw) { toast('本机还没有保存的 Cheatsheet。'); return; }
    if (raw.length > 2000000) throw new Error('oversize');
    const draft = JSON.parse(raw);
    if (!validDraft(draft)) throw new Error('invalid');
    if (state.sheet && !confirm('用本机保存的结果替换当前 Cheatsheet？当前资料仍会保留。')) return;
    state.sheet = draft; state.editing = null; state.stale = true;
    $('sheet-title').value = draft.title; $('requirements').value = draft.requirements;
    renderSheet(); $('preview-status').textContent = '已恢复本机结果 · 原始文档未保存，重新生成前请添加对应资料';
    toast('本机 Cheatsheet 已恢复。');
  } catch { toast('本机草稿无法读取，请重新生成。', true); }
});
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('close-source').addEventListener('click', () => $('source-dialog').close());
for (const id of ['source-dialog', 'help-dialog']) $(id).addEventListener('click', event => { if (event.target === $(id)) { const r = $(id).getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $(id).close(); } });
renderDocuments();
