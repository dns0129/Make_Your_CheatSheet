import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptCredential, decryptCredential, R2CredentialStore } from '../worker/credential-store.mjs';
import { createSheetwiseServer } from '../server/index.mjs';
import { request as httpRequest } from 'node:http';
class FakeR2 {
  constructor(){this.data=null;this.sequence=0;}
  async get(){if(!this.data)return null;const copy=structuredClone(this.data);return {etag:copy.etag,json:async()=>copy.value};}
  async put(_key,text,options){
    if(options?.onlyIf?.etagMatches && options.onlyIf.etagMatches!==this.data?.etag)return null;
    if(options?.onlyIf?.etagDoesNotMatch==='*' && this.data)return null;
    this.data={etag:String(++this.sequence),value:JSON.parse(text)};
    return {etag:this.data.etag};
  }
}
const credential={type:'oauth',clientId:'test-client',access:'test-access',refresh:'test-refresh',expires:Date.now()+3600000};
const secret='12'.repeat(32);
test('OAuth credentials are authenticated and encrypted at rest', async()=>{
  const cipher=await encryptCredential(credential,secret);
  assert.ok(!JSON.stringify(cipher).includes('test-access'));
  assert.deepEqual(await decryptCredential(cipher,secret),credential);
  await assert.rejects(decryptCredential(cipher,'34'.repeat(32)));
});
test('R2 conditional writes serialize refreshes and persist the latest rotated token', async()=>{
  const bucket=new FakeR2();
  const env={BUCKET:bucket,PI_CHATGPT_OAUTH:JSON.stringify(credential),PI_AUTH_ENCRYPTION_KEY:secret};
  const first=new R2CredentialStore(env),second=new R2CredentialStore(env);
  assert.deepEqual(await first.read('openai'),credential);
  await Promise.all([first.modify('openai',async current=>{await new Promise(r=>setTimeout(r,5));return {...current,refresh:current.refresh+'-one'};}),second.modify('openai',async current=>({...current,refresh:current.refresh+'-two'}))]);
  assert.equal((await second.read('openai')).refresh,'test-refresh-one-two');
  assert.equal(bucket.data.value.lease,null);
  assert.ok(!JSON.stringify(bucket.data).includes('test-refresh'));
});
test('failed refresh releases its lease while preserving the prior credential', async()=>{
  const bucket=new FakeR2();const store=new R2CredentialStore({BUCKET:bucket,PI_CHATGPT_OAUTH:JSON.stringify(credential),PI_AUTH_ENCRYPTION_KEY:secret});
  await assert.rejects(store.modify('openai',async()=>{throw new Error('refresh failed');}));
  assert.deepEqual(await store.read('openai'),credential);assert.equal(bucket.data.value.lease,null);
});
test('without account credentials the hosted store stays disconnected', async()=>{
  const store=new R2CredentialStore({BUCKET:new FakeR2()});
  assert.equal(await store.read('openai'),undefined);
  assert.deepEqual(await store.list(),[]);
});
test('Node bridge serves assets and blocks unauthorized-origin generation', async()=>{
  const runtime={listCredentials:async()=>[],isUsingSubscription:()=>false,getModel:()=>({reasoning:true})};
  const server=createSheetwiseServer(runtime);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const call=(path,method='GET',origin)=>new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:origin?{'Origin':origin,'Content-Type':'application/json'}:{}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body}));});
    req.on('error',reject);req.end(method==='POST'?'{}':undefined);
  });
  try{
    const root=await call('/');assert.equal(root.status,200);assert.ok(root.body.includes('Sheetwise'));
    assert.equal((await call('/api/pi/status')).status,200);
    assert.equal((await call('/api/pi/generate','POST','https://foreign.example')).status,403);
    assert.equal((await call('/api/pi/generate','POST')).status,403);
    assert.equal((await call('/../README.md')).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
