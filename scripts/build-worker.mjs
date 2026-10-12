import { build } from 'esbuild';
import { readdir,readFile,mkdir,writeFile } from 'node:fs/promises';
import { resolve,relative,extname } from 'node:path';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.ttf':'font/ttf'};
const assets={};
async function collect(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=resolve(directory,entry.name);if(entry.isDirectory())await collect(path);else{const name='/'+relative(resolve('dist'),path).split('\\').join('/');assets[name]={type:types[extname(path)]||'application/octet-stream',data:(await readFile(path)).toString('base64')};}}}
await collect(resolve('dist'));
const output=resolve('.sites-runtime/deploy/dist');
await mkdir(output+'/server',{recursive:true});await mkdir(output+'/.openai',{recursive:true});
await build({entryPoints:['worker/index.mjs'],outfile:output+'/server/index.js',bundle:true,format:'esm',platform:'neutral',target:'es2022',conditions:['workerd','worker','browser'],external:['node:*'],minify:true,plugins:[{name:'embedded-assets',setup(b){b.onResolve({filter:/^virtual:sheetwise-assets$/},()=>({path:'assets',namespace:'inline'}));b.onLoad({filter:/.*/,namespace:'inline'},()=>({contents:'export default '+JSON.stringify(assets),loader:'js'}));}}]});
const manifest=await readFile('.openai/hosting.json','utf8');await writeFile(output+'/.openai/hosting.json',manifest);
await mkdir(resolve('.sites-runtime/deploy/.openai'),{recursive:true});
await writeFile(resolve('.sites-runtime/deploy/.openai/hosting.json'),manifest);
await writeFile(output+'/server/wrangler.json',JSON.stringify({name:'sheetwise-study',main:'index.js',compatibility_date:'2026-10-12',compatibility_flags:['nodejs_compat'],r2_buckets:[{binding:'BUCKET',bucket_name:'sheetwise-study-credentials'}]},null,2));
console.log('Worker bundled with Pi Agent, embedded assets, and private credential storage.');
