import { Agent } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai/models';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { PI_CONFIG, PiError, validateRequest, prepareEvidence, buildPrompt, parseResult, SYSTEM_PROMPT } from '../shared/pi-contract.mjs';
import { R2CredentialStore } from './credential-store.mjs';
import assets from 'virtual:sheetwise-assets';

function json(status, body) { return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); }
async function generate(env, payload, signal) {
  const {documents,options}=validateRequest(payload);
  const store=new R2CredentialStore(env);
  if(!await store.read('openai')) throw new PiError('login_required','GPT 订阅尚未连接，请先完成 Pi 授权。',401);
  const models=createModels({providers:[openaiProvider()],credentials:store,authContext:{env:async()=>undefined,fileExists:async()=>false}});
  const model=models.getModel(PI_CONFIG.provider,PI_CONFIG.model);
  if(!model?.reasoning) throw new PiError('model_unavailable','指定的 GPT 6.1 Sol 模型不可用。',503);
  const {seed,evidence}=prepareEvidence(documents,options);
  const agent=new Agent({initialState:{model,thinkingLevel:PI_CONFIG.thinkingLevel,systemPrompt:SYSTEM_PROMPT,tools:[],messages:[]},streamFn:(m,c,o)=>models.streamSimple(m,c,{...o,maxTokens:12000})});
  const cancel=()=>agent.abort(); signal.addEventListener('abort',cancel,{once:true});
  try {
    if(signal.aborted) throw new PiError('cancelled','生成已取消。',499);
    await agent.prompt(buildPrompt(options,evidence));
    const last=agent.state.messages.findLast(x=>x.role==='assistant');
    if(!last||['error','aborted','length'].includes(last.stopReason)) throw new PiError('provider_error','GPT 生成未完成，请检查账户授权、订阅额度和资料长度后重试。',502);
    return parseResult(last.content.filter(x=>x.type==='text').map(x=>x.text).join(''),seed,evidence,options);
  } finally { signal.removeEventListener('abort',cancel); agent.abort(); await agent.waitForIdle(); }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    try {
      if(url.pathname==='/api/pi/status'&&request.method==='GET') {
        let connected=false;
        if(env.PI_CHATGPT_OAUTH&&env.PI_AUTH_ENCRYPTION_KEY&&env.BUCKET){try{connected=Boolean(await new R2CredentialStore(env).read('openai'));}catch{connected=false;}}
        return json(200,{...PI_CONFIG,connected,modelAvailable:true,authType:connected?'chatgpt-subscription':'not-connected'});
      }
      if(url.pathname==='/api/pi/generate'&&request.method==='POST') {
        if(!request.headers.get('oai-authenticated-user-id')) throw new PiError('signin_required','请使用站点拥有者账户登录后生成。',401);
        if(request.headers.get('Origin')!==url.origin) throw new PiError('invalid_origin','仅允许本站提交生成请求。',403);
        if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new PiError('invalid_content_type','请使用 JSON 请求。',415);
        if(Number(request.headers.get('Content-Length')||0)>800000) throw new PiError('request_too_large','请求过大，请减少资料。',413);
        const reader=request.body?.getReader(); if(!reader) throw new PiError('invalid_json','请求为空。');
        let size=0;const chunks=[];
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>800000){await reader.cancel();throw new PiError('request_too_large','请求过大。',413);}chunks.push(value);}
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
        let payload;try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new PiError('invalid_json','请求不是有效 JSON。');}
        const signal=AbortSignal.any([request.signal,AbortSignal.timeout(150000)]);
        return json(200,{sheet:await generate(env,payload,signal)});
      }
      if(url.pathname.startsWith('/api/'))return json(404,{error:{code:'not_found',message:'接口不存在。'}});
      if(!['GET','HEAD'].includes(request.method))return json(405,{error:{code:'method_not_allowed',message:'不支持该请求方式。'}});
      const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
      if(!asset)return new Response('Not found',{status:404});
      const bytes=Uint8Array.from(atob(asset.data),x=>x.charCodeAt(0));
      return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
    }catch(error){const known=error instanceof PiError?error:new PiError('service_error','Pi 服务暂时无法完成请求，请检查账户授权和额度后重试。',502);return json(known.status,{error:{code:known.code,message:known.message}});}
  },
};
