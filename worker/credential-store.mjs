const enc = new TextEncoder(), dec = new TextDecoder();
const OBJECT = 'sheetwise/pi-chatgpt-credential-v1';
const hexBytes = value => Uint8Array.from(value.match(/../g).map(x => parseInt(x, 16)));
async function keyOf(value) {
  if (!/^[0-9a-f]{64}$/i.test(value || '')) throw new Error('Credential encryption is not configured.');
  return crypto.subtle.importKey('raw', hexBytes(value), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function encryptCredential(credential, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await keyOf(secret),enc.encode(JSON.stringify(credential))));
  return { iv: Array.from(iv), bytes: Array.from(bytes) };
}
export async function decryptCredential(ciphertext, secret) {
  const value = await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(ciphertext.iv)},await keyOf(secret),new Uint8Array(ciphertext.bytes));
  return JSON.parse(dec.decode(value));
}
export class R2CredentialStore {
  constructor(env) { this.env = env; }
  async snapshot() {
    const object = await this.env.BUCKET.get(OBJECT);
    return object ? {value:await object.json(),etag:object.etag} : undefined;
  }
  async bootstrap() {
    if (!this.env.PI_CHATGPT_OAUTH) return;
    const digest = await crypto.subtle.digest('SHA-256',enc.encode(this.env.PI_CHATGPT_OAUTH));
    const version = Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    const current = await this.snapshot();
    if (current?.value.bootstrap === version) return;
    const credential = JSON.parse(this.env.PI_CHATGPT_OAUTH);
    if (credential.type !== 'oauth' || !credential.clientId || !credential.access || !credential.refresh || !Number.isFinite(credential.expires)) throw new Error('Invalid ChatGPT subscription credential.');
    if (current?.value.lease?.until > Date.now()) return;
    const value = {bootstrap:version,ciphertext:await encryptCredential(credential,this.env.PI_AUTH_ENCRYPTION_KEY),lease:null};
    await this.env.BUCKET.put(OBJECT,JSON.stringify(value),{onlyIf:current ? {etagMatches:current.etag} : {etagDoesNotMatch:'*'}});
  }
  async read(provider) {
    if (provider !== 'openai' || !this.env.PI_CHATGPT_OAUTH || !this.env.BUCKET) return;
    await this.bootstrap();
    const state = await this.snapshot();
    return state?.value.ciphertext ? decryptCredential(state.value.ciphertext,this.env.PI_AUTH_ENCRYPTION_KEY) : undefined;
  }
  async list() { return await this.read('openai') ? [{providerId:'openai',type:'oauth'}] : []; }
  async modify(provider, fn, options = {}) {
    if (provider !== 'openai') throw new Error('Unsupported provider.');
    await this.bootstrap();
    const owner = crypto.randomUUID();
    const deadline = Date.now()+20000;
    let current, locked;
    while (Date.now()<deadline) {
      if(options.signal?.aborted) throw new Error('Cancelled.');
      current = await this.snapshot();
      if (!current) throw new Error('ChatGPT is not connected.');
      if (current.value.lease?.until > Date.now()) { await new Promise(r=>setTimeout(r,100)); continue; }
      locked = await this.env.BUCKET.put(OBJECT,JSON.stringify({...current.value,lease:{owner,until:Date.now()+180000}}),{onlyIf:{etagMatches:current.etag}});
      if(locked) break;
    }
    if(!locked) throw new Error('Credential refresh is busy.');
    try {
      const before = await decryptCredential(current.value.ciphertext,this.env.PI_AUTH_ENCRYPTION_KEY);
      const after = await fn(before);
      const ciphertext = after ? await encryptCredential(after,this.env.PI_AUTH_ENCRYPTION_KEY) : current.value.ciphertext;
      const committed = await this.env.BUCKET.put(OBJECT,JSON.stringify({...current.value,ciphertext,lease:null}),{onlyIf:{etagMatches:locked.etag}});
      if(!committed) throw new Error('Credential refresh persistence failed.');
      return after ?? before;
    } finally {
      const latest = await this.snapshot();
      if(latest?.value.lease?.owner===owner) await this.env.BUCKET.put(OBJECT,JSON.stringify({...latest.value,lease:null}),{onlyIf:{etagMatches:latest.etag}});
    }
  }
  async delete() { throw new Error('Disconnect through the managed Site secrets.'); }
}
