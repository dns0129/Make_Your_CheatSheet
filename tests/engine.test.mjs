import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates, generateSheet, toMarkdown, CATEGORIES } from '../dist/engine.mjs';
import { sampleDocuments } from '../dist/sample.mjs';
const options = { title: '概率论', requirements: '复习条件概率和贝叶斯', keywords: '条件概率，贝叶斯', scope: 'all', density: 'standard', categories: CATEGORIES.map(x => x.id), columns: '2' };
test('sample produces all four types with citations containing exact original evidence', () => {
  const sheet = generateSheet(sampleDocuments, options);
  assert.ok(sheet.items.length > 10);
  assert.equal(sheet.emptyCategories.length, 0);
  assert.deepEqual(sheet.missingKeywords, []);
  for (const item of sheet.items) for (const source of item.sources) {
    const doc = sampleDocuments.find(x => x.id === source.documentId);
    assert.ok(doc.units.some(x => x.text.includes(source.quote)));
    assert.equal(item.body, source.quote);
  }
  assert.ok(sheet.items.some(x => x.category === 'pitfall' && x.body.includes('互斥不等于独立')));
});
test('focused filtering uses entry titles and text without pulling in adjacent topics', () => {
  const sheet = generateSheet(sampleDocuments, { ...options, scope: 'focused', keywords: '贝叶斯' });
  assert.ok(sheet.items.every(x => (x.title + x.body).includes('贝叶斯')));
  assert.ok(!sheet.items.some(x => x.body.includes('Var(')));
});
test('missing keywords are reported and absent focused topics do not fabricate notes', () => {
  assert.throws(() => generateSheet(sampleDocuments, { ...options, scope: 'focused', keywords: '傅里叶变换' }), /未找到/);
  const sheet = generateSheet(sampleDocuments, { ...options, keywords: '傅里叶变换' });
  assert.deepEqual(sheet.missingKeywords, ['傅里叶变换']);
  assert.ok(sheet.items.every(x => !x.body.includes('傅里叶变换')));
});
test('budget, category selection and Markdown export preserve conditions', () => {
  const sheet = generateSheet(sampleDocuments, { ...options, density: 'compact', categories: ['formula'] });
  assert.ok(sheet.items.length <= 16);
  assert.ok(sheet.items.every(x => x.category === 'formula'));
  const markdown = toMarkdown(sheet);
  assert.ok(markdown.includes('P(B) > 0'));
  assert.ok(markdown.includes('复习讲义.md'));
});
test('duplicates merge sources while page numbers remain accurate', () => {
  const docs = [{ id: 'one', name: '讲义.pdf', units: [{ page: 2, text: '# 公式\n期望公式：E(X) = Σ xP(X=x)。' }, { page: 9, text: '# 公式\n期望公式：E(X) = Σ xP(X=x)。' }] }];
  const items = extractCandidates(docs);
  assert.equal(items.length, 1); assert.equal(items[0].sources.length, 2);
  assert.deepEqual(items[0].sources.map(x => x.page), [2, 9]);
});
test('code and long formulas are preserved without losing assumptions', () => {
  const text = '# 公式\n' + '条件：'.repeat(120) + 'P(B)>0。\n```math\nP(A|B)=P(A∩B)/P(B)\nP(B)>0\n```';
  const items = extractCandidates([{ id: 'd', name: 'notes.md', units: [{ text }] }]);
  assert.ok(items.some(x => x.body.endsWith('P(B)>0。')));
  assert.equal(items.find(x => x.isCode).body, 'P(A|B)=P(A∩B)/P(B)\nP(B)>0');
});
test('empty and headings-only documents return useful failures', () => {
  assert.throws(() => generateSheet([], options), /上传文档/);
  assert.throws(() => generateSheet([{ id: 'd', name: 'n.md', units: [{ text: '# 标题\n## 小标题' }] }], options), /足够的文字/);
});
