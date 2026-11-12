// Real workerd/SQLite, synthetic model only. No audio or production credentials.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket,WebSocketServer} from 'ws';
const port=18898,modelPort=18899,base=`http://127.0.0.1:${port}`;
const dir=mkdtempSync(join(tmpdir(),'kotoleaf-review-'));
let calls=[],invalid=false,hold=null,fail=false;
const model=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',async()=>{
 if(req.url.startsWith('/v1/listen')){calls.push({speech:true,url:req.url,auth:req.headers.authorization});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({results:{channels:[{alternatives:[{transcript:'Visa payment remains possible.'}]}]}}));return;}
 const request=JSON.parse(body);calls.push({request,auth:req.headers.authorization});
 if(hold){const wait=hold;hold=null;await wait;}
 if(fail){fail=false;res.writeHead(503);res.end('private upstream body must not leak');return;}
 const p=JSON.parse(request.messages[0].content);
 const output={cleaned:p.lines.map(l=>({sources:[l.seq],text:l.text.replace('Mira. To','Mira to')})),notes:[{kind:'discussion',en:'No commitment is established.',ja:'まだ確約していません。',evidence:[{seq:p.lines[0].seq,quote:invalid?'invented quote':p.lines[0].text}]}],terms:[{term:'稟議',reading:'りんぎ',meaning:'Internal approval process',evidence:[{seq:p.lines.at(-1).seq,quote:p.lines.at(-1).text}]}]};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({model:'synthetic-model',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}]}));invalid=false;
 });});
const wss=new WebSocketServer({server:model});
wss.on('connection',socket=>{socket.on('message',bytes=>{if(String(bytes)==='final'){socket.send(JSON.stringify({type:'Results',is_final:true,start:0,duration:35,channel:{alternatives:[{transcript:'We have not approved the proposal.',words:[{speaker:0},{speaker:1}]}]}}));}});});
await new Promise(r=>model.listen(modelPort,'127.0.0.1',r));
writeFileSync('.dev.vars',`DEEPGRAM_API_KEY=synthetic-asr-key\nACCESS_TOKENS=local:synthetic-review-token,other:synthetic-other-token\nOPENCODE_CHAT_TOKEN=synthetic-chat-token\nREFINEMENT_TOKEN=synthetic-model-token\n`,{flag:'wx',mode:0o600});
let log='',child;
function start(){child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--port',String(port),'--ip','127.0.0.1','--persist-to',dir,'--var',`DEEPGRAM_URL:http://127.0.0.1:${modelPort}/v1/listen`,'--var',`REFINEMENT_URL:http://127.0.0.1:${modelPort}/v1/messages`,'--var','REFINEMENT_MODEL:synthetic-model','--var','CHAT_LEARNING_LABEL:local','--var','AUTO_REFINE_LABEL:local','--var','HOT_DAYS:0'],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);}
async function stop(){if(child&&child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});}
async function ready(){for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('worker unavailable '+log.slice(-2000));}
const auth=t=>({Authorization:'Bearer '+t,'Content-Type':'application/json'});
async function api(path='',method='GET',body,token='synthetic-review-token'){return fetch(base+'/review-data'+path,{method,headers:auth(token),body:body?JSON.stringify(body):undefined});}
const json=async(...args)=>{const r=await api(...args);assert.equal(r.status,200,await r.clone().text());return r.json();};
const imported=async(text)=>{const id=crypto.randomUUID(),r=await api('/import','POST',{id,text});assert.equal(r.status,201);return {id:(await r.json()).id,requestId:id,text};};
start();
try{
 await ready();
 assert.equal((await fetch(base+'/review')).status,200);assert.equal((await api('','GET',undefined,'bad')).status,401);
 for(const path of ['','/context','/import'])assert.equal((await api(path,'POST',{},'synthetic-chat-token')).status,401);
 await json('/context','POST',{context:'Fictional lab. No date has been committed.'});
 assert.equal((await json()).context,'Fictional lab. No date has been committed.');assert.equal((await json('','GET',undefined,'synthetic-other-token')).context,'');
 const item=await imported('We might invite Mira. To the workshop, but we have not committed to Friday.\n\n稟議はまだ通っていません。Visaで払うかもしれません。');
 assert.equal((await api('/import','POST',{id:item.requestId,text:item.text})).status,200);
 assert.equal((await api('/import','POST',{id:item.requestId,text:'different'})).status,409);
 assert.equal((await api('/'+item.id,'GET',undefined,'synthetic-other-token')).status,404);
 assert.equal((await api('/'+item.id+'/refine','POST',{},'synthetic-other-token')).status,404);
 const before=await json('/'+item.id);assert.ok(before.lines.every(l=>l.start===null&&l.end===null&&l.speaker===null));
 assert.equal((await json('/'+item.id+'/refine','POST',{})).status,'ready');
 const result=await json('/'+item.id),r=result.revisions[0];assert.equal(r.state,'ready');assert.equal(r.review,'draft');assert.deepEqual(result.lines,before.lines);
 const reader=await (await fetch(base+'/meetings/'+item.id+'/review',{headers:auth('synthetic-other-token')})).json();assert.equal(reader.revisions[0].review,'draft');assert.ok(!('context' in reader.revisions[0]));
 const rpc=await (await fetch(base+'/mcp',{method:'POST',headers:auth('synthetic-other-token'),body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'meeting_review',arguments:{meeting_id:item.id}}})})).json();assert.equal(JSON.parse(rpc.result.content[0].text).revisions[0].review,'draft');
 assert.equal(calls[0].auth,'Bearer synthetic-model-token');assert.match(calls[0].request.system,/lingual intelligence/);assert.match(calls[0].request.system,/ChibaTech/);
 assert.equal(JSON.parse(calls[0].request.messages[0].content).context,'Fictional lab. No date has been committed.');
 const count=calls.length;assert.equal((await json('/'+item.id+'/refine','POST',{})).status,'up-to-date');assert.equal(calls.length,count);
 for(const review of ['accepted','accepted','rejected','draft'])await json('/'+item.id+'/revisions/'+r.id,'PATCH',{review});
 const reviewed=await json('/'+item.id);assert.equal(reviewed.revisions[0].review,'draft');assert.equal(reviewed.decisions.length,3);assert.deepEqual(reviewed.lines,before.lines);
 const candidate={id:crypto.randomUUID(),confirmed:true,original:'',term:'稟議',reading:'りんぎ',meaning:'Internal approval process',revision:r.id,index:0};
 assert.equal((await api('/'+item.id+'/learn','POST',{...candidate,confirmed:false})).status,400);
 assert.equal((await api('/'+item.id+'/learn','POST',candidate)).status,201);assert.equal((await api('/'+item.id+'/learn','POST',candidate)).status,200);
 const learning=await (await fetch(base+'/learning',{headers:auth('synthetic-review-token')})).json();assert.equal(learning.keyterms[0],'稟議');assert.equal(learning.sources[0].revision,r.id);
 const form=new FormData();form.append('file',new Blob(['synthetic'],{type:'audio/wav'}),'synthetic.wav');
 const speech=await fetch(base+'/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer synthetic-chat-token'},body:form});assert.equal(speech.status,200);assert.equal((await speech.json()).text,'Visa payment remains possible.');assert.ok(new URL(calls.at(-1).url,'http://mock').searchParams.getAll('keyterm').includes('稟議'));
 assert.equal((await fetch(base+'/learning',{headers:auth('synthetic-chat-token')})).status,401);
 // Model failure and invented citations fail closed, preserving every raw byte.
 const invalidItem=await imported('Do not approve it.');invalid=true;assert.equal((await json('/'+invalidItem.id+'/refine','POST',{})).status,'failed');
 const bad=await json('/'+invalidItem.id);assert.equal(bad.lines[0].text,'Do not approve it.');assert.equal(bad.revisions[0].result,null);
 const failItem=await imported('Maybe next week.');fail=true;assert.equal((await json('/'+failItem.id+'/refine','POST',{})).status,'failed');assert.doesNotMatch(JSON.stringify(await json('/'+failItem.id)),/private upstream body/);
 // Concurrent requests cannot duplicate a model call.
 const concurrent=await imported('No decision yet.');let release;hold=new Promise(r=>release=r);const pending=json('/'+concurrent.id+'/refine','POST',{});
 while(!calls.some(c=>c.request?.messages[0].content.includes('No decision yet.')))await new Promise(r=>setTimeout(r,10));
 const running=await json('/'+concurrent.id+'/refine','POST',{});release();assert.equal(running.status,'running');assert.equal((await pending).status,'ready');
 // Stored live path triggers without waiting for model, retains mixed-speaker uncertainty.
 let releaseLive;hold=new Promise(r=>releaseLive=r);
 const socket=new WebSocket(`ws://127.0.0.1:${port}/v1/listen`,{headers:{Authorization:'Bearer synthetic-review-token'}});let meeting;
 socket.on('upgrade',r=>meeting=r.headers['x-kotoleaf-meeting']);await new Promise((resolve,reject)=>{socket.on('open',()=>socket.send('final'));socket.on('message',resolve);socket.on('error',reject);});socket.close();
 let live;try{for(let i=0;i<100;i++){live=await json('/'+meeting);if(live.revisions.some(r=>r.state==='running'))break;await new Promise(r=>setTimeout(r,20));}assert.equal(live.lines[0].text,'We have not approved the proposal.');assert.equal(live.revisions[0].state,'running','raw delivered and readable while model is blocked');}finally{releaseLive();}
 for(let i=0;i<100;i++){live=await json('/'+meeting);if(live.revisions.some(r=>r.state==='ready'))break;await new Promise(r=>setTimeout(r,30));}
 assert.equal(live.lines[0].speaker,null);assert.equal(live.revisions[0].state,'ready');assert.equal(live.lines[0].text,'We have not approved the proposal.');
 await stop();start();await ready();assert.deepEqual((await json('/'+item.id)).lines,before.lines);assert.equal((await json('/'+item.id)).decisions.length,3);assert.equal((await json()).context,'Fictional lab. No date has been committed.');
 console.log('Review E2E passed: private scoping, raw preservation, model validation/failure/single-flight, live rolling, reversible decisions, source-linked learning, chat hints, SQLite restart.');
 if(process.env.KOTOLEAF_BROWSER_PYTHON){const browser=spawn(process.env.KOTOLEAF_BROWSER_PYTHON,['test/browser-review.py',base],{stdio:'inherit'});assert.equal(await new Promise(r=>browser.once('exit',r)),0);}
 const archived=await (await fetch(base+'/archive/run',{method:'POST',headers:auth('synthetic-review-token')})).json();assert.ok(archived.archived.includes(item.id));
 const archive=await fetch(base+'/archive/'+item.id,{headers:auth('synthetic-review-token')});
 const archiveText=await new Response(archive.body.pipeThrough(new DecompressionStream('gzip'))).text();
  const rows=archiveText.trim().split('\n').map(JSON.parse);assert.equal(rows.filter(r=>r.refinement).length,1);assert.equal(rows.filter(r=>r.review_decision).length,3);assert.equal(rows.filter(r=>r.message)[0].message.channel.alternatives[0].transcript,before.lines[0].text);
  assert.ok(!('context' in rows.find(r=>r.refinement).refinement),'shared archive omits private context snapshots');
  assert.doesNotMatch(archiveText,/Fictional lab/);
  assert.equal((await api('/'+item.id+'/archive-context','GET',undefined,'synthetic-other-token')).status,404);
  const privateArchive=await api('/'+item.id+'/archive-context');assert.equal(privateArchive.status,200);
  const privateText=await new Response(privateArchive.body.pipeThrough(new DecompressionStream('gzip'))).text();
  assert.match(privateText,/Fictional lab/,'owner can recover preserved private context after archive');
 assert.equal((await api('/'+item.id)).status,404);
 const retained=await (await fetch(base+'/learning',{headers:auth('synthetic-review-token')})).json();assert.equal(retained.sources[0].revision,r.id);
 console.log('Archive includes unchanged raw, refinement snapshots and review history; learned evidence remains available.');
}finally{await stop();for(const socket of wss.clients)socket.terminate();wss.close();await new Promise(r=>model.close(r));rmSync('.dev.vars',{force:true});rmSync(dir,{recursive:true,force:true});}
