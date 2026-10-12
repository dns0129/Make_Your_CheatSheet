import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { PI_CONFIG, PiError, validateRequest, prepareEvidence, buildPrompt, parseResult, SYSTEM_PROMPT } from '../shared/pi-contract.mjs';
export { PI_CONFIG, PiError, validateRequest, prepareEvidence, buildPrompt, parseResult } from '../shared/pi-contract.mjs';

export const AGENT_DIR = resolve(process.env.SHEETWISE_PI_DIR || '.sites-runtime/pi');
export async function createPiRuntime() {
  await mkdir(AGENT_DIR, { recursive: true, mode: 0o700 });
  return ModelRuntime.create({
    authPath: resolve(AGENT_DIR, 'auth.json'), modelsPath: null,
    modelsStorePath: resolve(AGENT_DIR, 'models-store.json'),
    allowModelNetwork: false, refreshOnCreate: false,
  });
}
export async function piStatus(runtime) {
  const credential = (await runtime.listCredentials()).find(x => x.providerId === PI_CONFIG.provider);
  const subscription = credential?.type === 'oauth' && runtime.isUsingSubscription(PI_CONFIG.provider);
  const model = runtime.getModel(PI_CONFIG.provider, PI_CONFIG.model);
  return { ...PI_CONFIG, connected: Boolean(subscription), modelAvailable: Boolean(model?.reasoning), authType: subscription ? 'chatgpt-subscription' : 'not-connected' };
}

export async function generateWithPi(runtime, payload, { signal, createSession = createAgentSession } = {}) {
  const { documents, options } = validateRequest(payload);
  const status = await piStatus(runtime);
  if (!status.connected) throw new PiError('login_required', '尚未连接 GPT 订阅，请先完成 Pi 的 ChatGPT 授权。', 401);
  if (!status.modelAvailable) throw new PiError('model_unavailable', 'Pi 未提供指定的 gpt-6.1-sol 模型。', 503);
  const { seed, evidence } = prepareEvidence(documents, options);
  const loader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => SYSTEM_PROMPT, getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {},
  };
  const { session } = await createSession({
    cwd: AGENT_DIR, agentDir: AGENT_DIR, modelRuntime: runtime,
    model: runtime.getModel(PI_CONFIG.provider, PI_CONFIG.model), thinkingLevel: PI_CONFIG.thinkingLevel,
    noTools: 'all', tools: [], resourceLoader: loader,
    sessionManager: SessionManager.inMemory(AGENT_DIR),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
  });
  const abort = () => session.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new PiError('cancelled', '生成已取消。', 499);
    await session.prompt(buildPrompt(options, evidence));
    if (signal?.aborted) throw new PiError('cancelled', '生成已取消。', 499);
    const last = session.messages?.findLast(x => x.role === 'assistant');
    if (last?.stopReason === 'error' || last?.stopReason === 'aborted') throw new PiError('provider_error', 'GPT 请求失败，请检查订阅额度、账户授权和云端网络后重试。', 502);
    return parseResult(session.getLastAssistantText() || '', seed, evidence, options);
  } catch (error) {
    if (error instanceof PiError) throw error;
    throw new PiError('provider_error', 'Pi 模型调用失败，请检查 ChatGPT 授权、额度和云端网络。', 502);
  } finally { signal?.removeEventListener('abort', abort); session.dispose(); }
}
