import test from 'node:test';
import assert from 'node:assert/strict';
import { PI_CONFIG, generateWithPi, piStatus } from '../server/pi-service.mjs';
import { validateRequest, prepareEvidence, parseResult } from '../shared/pi-contract.mjs';
import { sampleDocuments } from '../dist/sample.mjs';
const options = { title: '概率论', requirements: '复习贝叶斯与条件概率', keywords: '贝叶斯，条件概率', scope: 'all', categories: ['concept','formula','steps','pitfall'], density: 'standard', columns: '2' };
const payload = () => ({ documents: structuredClone(sampleDocuments), options: { ...options } });
function runtime(auth = 'oauth') {
  return {
    listCredentials: async () => auth ? [{ providerId: 'openai', type: auth }] : [],
    isUsingSubscription: () => auth === 'oauth',
    getModel: (provider, id) => provider === 'openai' && id === 'gpt-6.1-sol' ? { id, provider, reasoning: true } : undefined,
  };
}
test('only subscription OAuth can enable generation; API key credentials cannot', async () => {
  assert.equal((await piStatus(runtime('oauth'))).connected, true);
  assert.equal((await piStatus(runtime('api_key'))).connected, false);
  await assert.rejects(generateWithPi(runtime(null), payload()), error => error.code === 'login_required');
});
test('rejects oversized documents, duplicate IDs and invalid scope before sending model requests', () => {
  assert.throws(() => validateRequest({ documents: [{id:'d',name:'a.md',units:[{text:'a'.repeat(60001)}]}], options }), /6 万/);
  const duplicate = payload(); duplicate.documents[1].id = duplicate.documents[0].id;
  assert.throws(() => validateRequest(duplicate), /不能重复/);
  assert.throws(() => validateRequest({ ...payload(), options: { ...options, scope: 'arbitrary' } }), /范围/);
});
test('Pi uses requested model, medium, no tools, in-memory sessions and validated evidence', async () => {
  let configured, prompt, disposed = false;
  const { evidence } = prepareEvidence(sampleDocuments, options);
  const source = evidence.find(x => x.body.includes('贝叶斯公式：'));
  const result = await generateWithPi(runtime(), payload(), { createSession: async config => {
    configured = config;
    return { session: {
      messages: [{ role:'assistant', stopReason:'stop' }], abort() {}, dispose() { disposed=true; },
      prompt: async text => { prompt = JSON.parse(text); },
      getLastAssistantText: () => JSON.stringify({items:[{category:'formula',title:'贝叶斯公式',body:source.body,evidenceIds:[source.id]}]}),
    } };
  } });
  assert.equal(configured.model.id, PI_CONFIG.model);
  assert.equal(configured.thinkingLevel, 'medium');
  assert.equal(configured.noTools, 'all'); assert.deepEqual(configured.tools, []);
  assert.equal(prompt.requirements, options.requirements);
  assert.ok(prompt.evidence.length > 0); assert.equal(disposed, true);
  assert.equal(result.mode, 'pi-ai'); assert.equal(result.items[0].sources[0].quote, source.body);
});
test('fabricated citations and unselected content categories cannot enter the cheatsheet', () => {
  const {seed,evidence}=prepareEvidence(sampleDocuments,options);
  assert.throws(() => parseResult(JSON.stringify({items:[{category:'formula',title:'假的',body:'没有依据',evidenceIds:['invented']}]}),seed,evidence,options), /出处/);
  assert.throws(() => parseResult(JSON.stringify({items:[{category:'other',title:'假的',body:'没有依据',evidenceIds:[evidence[0].id]}]}),seed,evidence,options), /出处/);
});
test('Pi sessions are disposed after invalid output and provider errors', async () => {
  let disposed=false;
  await assert.rejects(generateWithPi(runtime(),payload(),{createSession:async()=>({session:{
    messages:[{role:'assistant',stopReason:'error'}],prompt:async()=>{},abort(){},
    getLastAssistantText:()=>'',dispose(){disposed=true;},
  }})}), error => error.code === 'provider_error');
  assert.equal(disposed,true);
});
