import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleApi} from '../lib/studio-api.mjs';
import {validateDraft,validateTurn,planAssets,imageUsage,textUsage,month,imageSize} from '../lib/studio-domain.mjs';
import {projectFromInput} from '../public/studio/model.js';
import {makeZip,crc32} from '../public/studio/zip.mjs';

const draft={title:'검증용 60초 뮤직비디오',logline:'도시의 아침',synopsis:'새벽 도시가 금빛으로 바뀐다.',genre:'뮤직비디오',durationSeconds:60,aspectRatio:'16:9',visualStyle:'청록에서 금빛으로',stylePrompt:'cinematic synthwave, anamorphic lens, 35mm grain',
 characters:[{id:'hero',name:'주인공',description:'20대 여성, 검은 단발, 은색 재킷',visualPrompt:'young woman, black bob hair, silver oversized jacket, white sneakers'}],
 locations:[{id:'city',name:'도시',description:'네온 거리',visualPrompt:'wet neon alley at dawn'}],props:[],
 shots:[{id:'shot1',title:'일출',seconds:60,description:'도시 위로 햇빛이 퍼진다.',camera:'느린 전진',prompt:'Golden sunrise over a cyan city',motion:'camera pushes in slowly as light warms',characterIds:['hero'],locationId:'city',propIds:[]}]};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=','base64');
const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
function setup(){
 const sql=new DatabaseSync(':memory:');
 for(const entry of journal.entries)for(const statement of readFileSync(new URL('../drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))if(statement.trim())sql.exec(statement);
 const db={prepare(query){const create=(args=[])=>({bind(...v){return create(v);},first(){return sql.prepare(query).get(...args)??null;},all(){return {results:sql.prepare(query).all(...args)};},run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};}});return create();},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const objects=new Map(),bucket={async put(k,v){objects.set(k,new Uint8Array(v));},async get(k){const v=objects.get(k);return v?{body:v,arrayBuffer:async()=>v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength)}:null;},async head(k){return objects.has(k)?{size:objects.get(k).length}:null;}};
 const env={DB:db,BUCKET:bucket,OPENAI_API_KEY:'test-only-not-a-key'};
 async function call(path,body,{owner='owner-a',origin='http://studio.test',method='POST'}={}){
  const headers={'Content-Type':'application/json'};if(owner)headers['oai-authenticated-user-id']=owner;if(origin)headers.Origin=origin;
  const response=await handleApi(new Request('http://studio.test/api/'+path,{method:body===undefined?'GET':method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  const data=response.headers.get('content-type')?.includes('json')?await response.json():await response.arrayBuffer();
  return {status:response.status,data};
 }
 const input=projectFromInput({inputMode:'idea',ideaInput:'60초 도시 뮤직비디오. 16:9.',planningInput:'',planningFeedback:'',title:''},null,{id:'test-project',now:new Date().toISOString()});
 return {db,sql,objects,env,call,input};
}
function mockProvider(t,{invalid=false,uncertain=false}={}){
 const original=globalThis.fetch,responses=new Map(),requests=[];let n=0;
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='POST'){
   requests.push(JSON.parse(options.body));if(uncertain)throw new Error('connection lost');
   const id='resp_test_'+(++n),image=!!requests.at(-1).tools;
   responses.set(id,{id,status:'completed',usage:{input_tokens:100,output_tokens:100},...(image?{tool_usage:{image_gen:{input_tokens_details:{text_tokens:10,image_tokens:20},output_tokens:30}}}:{}),output:image?[{type:'image_generation_call',result:png.toString('base64'),revised_prompt:'REVISED '+n}]:[{type:'message',content:[{type:'output_text',text:JSON.stringify({message:'초안을 검토해 주세요.',questions:[],changes:['제목 확정'],readyForReview:true,draft:invalid?{...draft,durationSeconds:59}:draft})}]}]});
   return Response.json({id,status:'queued'});
  }
  const response=responses.get(String(url).split('/').at(-1));return Response.json(response??{error:'missing'},{status:response?200:404});
 };
 t.after(()=>{globalThis.fetch=original;});return requests;
}
async function create(h){const r=await h.call('projects',{project:h.input});assert.equal(r.status,201);return r.data;}
async function planning(h){
 let p=await create(h);const r=await h.call('projects/test-project/interview',{revision:p.project.revision,answer:'초안을 만들어줘',requestId:'interview-1'});assert.equal(r.status,202,JSON.stringify(r.data));
 await h.call('jobs/'+r.data.job.id);p=(await h.call('projects/test-project')).data;assert.equal(p.workflow.readyForReview,true);
 const confirmed=await h.call('projects/test-project/confirm-plan',{revision:p.project.revision});assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));return confirmed.data;
}
async function generate(h,p,a,requestId,extra={}){
 const r=await h.call('projects/test-project/generate',{revision:p.project.revision,assetId:a.id,acknowledgeEstimate:true,requestId,...extra});assert.equal(r.status,202,JSON.stringify(r.data));await h.call('jobs/'+r.data.job.id);
 p=(await h.call('projects/test-project')).data;assert.equal(p.workflow.lastError,null);return {p,job:r.data.job};
}
async function select(h,p,a,versionId){
 const r=await h.call('projects/test-project/select',{revision:p.project.revision,assetId:a.id,versionId});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;
}
const byKind=(p,kind)=>p.assets.find(a=>a.kind===kind);
test('인증·소유권·요청 출처와 오래된 revision을 서버가 차단한다',async()=>{
 const h=setup();try{
 assert.equal((await h.call('projects',undefined,{owner:null})).status,401);
 assert.equal((await h.call('projects',{project:h.input},{origin:'https://other.test'})).status,403);
 const p=await create(h);assert.equal((await h.call('projects/test-project',undefined,{owner:'owner-b'})).status,404);
 assert.equal((await h.call('projects/test-project',{project:h.input,revision:99},{method:'PATCH'})).status,409);
 assert.equal((await h.call('projects/test-project/confirm-plan',{revision:p.project.revision})).status,409);
 }finally{h.sql.close();}
});
test('기획 대화부터 참조 이미지·수정·확정·오프라인 ZIP까지 완료한다',async t=>{
 const h=setup(),requests=mockProvider(t);try{
 let p=await planning(h),hero=byKind(p,'character'),base=byKind(p,'environment'),frame=byKind(p,'keyframe');
 // 기준 이미지는 구도를 고정하고, 장면 프롬프트는 참조 이미지를 순서대로 이름 붙인다.
 assert.ok(hero.prompt.includes('Full-body front view'));assert.ok(hero.prompt.includes(draft.characters[0].visualPrompt));
 assert.ok(frame.prompt.includes('REFERENCE IMAGES'));assert.ok(frame.prompt.includes('1. CHARACTER "주인공"'));assert.ok(frame.prompt.includes('2. LOCATION "도시"'));assert.ok(!frame.prompt.includes('CAMERA:'));
 assert.equal((await h.call('projects/test-project/generate',{revision:p.project.revision,assetId:frame.id,acknowledgeEstimate:true,requestId:'too-early'})).status,409);
 assert.equal((await h.call('projects/test-project/export',{revision:p.project.revision})).status,409);
 let generated=await generate(h,p,hero,'hero-1');p=generated.p;
 assert.equal(requests.at(-1).tools[0].size,'1024x1024');assert.equal(requests.at(-1).tools[0].action,'generate');assert.equal(requests.at(-1).input[0].role,'developer');
 p=await select(h,p,hero,generated.job.id);
 generated=await generate(h,p,base,'base-1');p=generated.p;assert.equal(requests.at(-1).tools[0].size,'1536x864');
 const duplicate=await h.call('projects/test-project/generate',{revision:0,assetId:base.id,acknowledgeEstimate:true,requestId:'base-1'});assert.equal(duplicate.data.job.id,generated.job.id);assert.equal(requests.length,3);
 p=await select(h,p,base,generated.job.id);
 generated=await generate(h,p,frame,'frame-1');p=generated.p;const firstFrame=generated.job.id;
 assert.equal(requests.at(-1).input[1].content.filter(c=>c.type==='input_image').length,2);assert.equal(requests.at(-1).tools[0].action,'edit');
 assert.ok(p.assets.find(a=>a.id===frame.id).versions[0].revisedPrompt.startsWith('REVISED'));
 p=await select(h,p,frame,firstFrame);
 // 수정은 바꿀 내용이 필수이고, 짧은 편집 지시만 원본 한 장과 함께 보낸다.
 assert.equal((await h.call('projects/test-project/generate',{revision:p.project.revision,assetId:frame.id,acknowledgeEstimate:true,requestId:'frame-edit-empty',parentVersion:firstFrame})).status,400);
 generated=await generate(h,p,frame,'frame-edit',{parentVersion:firstFrame,feedback:'빛을 조금 더 밝게'});p=generated.p;
 const edit=requests.at(-1),editText=edit.input[1].content[0].text;
 assert.equal(edit.tools[0].action,'edit');assert.ok(editText.startsWith('Edit the supplied image'));assert.ok(editText.includes('빛을 조금 더 밝게'));assert.ok(!editText.includes('STYLE:'));assert.equal(edit.input[1].content.filter(c=>c.type==='input_image').length,1);
 assert.equal(p.assets.find(a=>a.id===frame.id).versions.length,2);
 p=await select(h,p,frame,generated.job.id);
 let r=await h.call('projects/test-project/confirm-assets',{revision:p.project.revision});assert.equal(r.status,200,JSON.stringify(r.data));p=r.data;
 const pack=(await h.call('projects/test-project/export',{revision:p.project.revision})).data;
 assert.equal(pack.images.length,3);assert.ok(pack.documents.find(d=>d.path==='06_Storyboard/storyboard.html').content.includes('../05_Keyframes/'));
 const txt=pack.documents.find(d=>d.path==='07_Video_Prompts/shot1.txt').content;assert.ok(txt.includes('MOTION: camera pushes in'));assert.ok(txt.includes('- 주인공: young woman'));assert.ok(txt.includes('STYLE: cinematic synthwave'));
 assert.ok(!JSON.stringify(pack).includes('test-only-not-a-key'));assert.ok(!JSON.stringify(pack).includes('object_key'));
 const entries=pack.documents.map(d=>({path:d.path,data:new TextEncoder().encode(d.content)}));
 for(const image of pack.images){const response=await h.call(image.url.replace('/api/',''));assert.equal(response.status,200);entries.push({path:image.path,data:new Uint8Array(response.data)});}
 const bytes=new Uint8Array(await makeZip(entries).arrayBuffer());assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
 assert.ok(bytes.length>png.length*2);assert.equal((await h.call('images/'+firstFrame,undefined,{owner:'owner-b'})).status,404);
 // 기준 이미지를 바꾸면 이전에 승인한 장면이 참조 변경 상태가 되어 확정·내보내기가 막힌다.
 generated=await generate(h,p,base,'base-2');p=await select(h,generated.p,base,generated.job.id);
 assert.equal((await h.call('projects/test-project/confirm-assets',{revision:p.project.revision})).status,409);
 assert.equal((await h.call('projects/test-project/export',{revision:p.project.revision})).status,409);
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM studio_exports').get().n,1);
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM studio_versions').get().n,5);
 assert.equal(h.sql.prepare("SELECT revised_prompt FROM studio_versions WHERE id=?").get(firstFrame).revised_prompt,'REVISED 4');
 }finally{h.sql.close();}
});
test('불필요한 에셋을 제외하면 생성·확정·ZIP에서 빠지고, 참조 중인 에셋은 제외할 수 없다',async t=>{
 const h=setup(),requests=mockProvider(t);try{
 let p=await planning(h);const hero=byKind(p,'character'),base=byKind(p,'environment'),frame=byKind(p,'keyframe');
 const exclude=(assetId,excluded)=>h.call('projects/test-project/exclude',{revision:p.project.revision,assetId,excluded});
 assert.equal((await exclude(hero.id,true)).status,409);
 let r=await exclude(frame.id,true);assert.equal(r.status,200,JSON.stringify(r.data));p=r.data;assert.equal(p.assets.find(a=>a.id===frame.id).excluded,true);
 assert.equal((await h.call('projects/test-project/generate',{revision:p.project.revision,assetId:frame.id,acknowledgeEstimate:true,requestId:'excluded-gen'})).status,409);
 r=await exclude(hero.id,true);assert.equal(r.status,200,JSON.stringify(r.data));p=r.data;
 assert.equal((await exclude(frame.id,false)).status,409);
 const generated=await generate(h,p,base,'base-1');p=await select(h,generated.p,base,generated.job.id);
 r=await h.call('projects/test-project/confirm-assets',{revision:p.project.revision});assert.equal(r.status,200,JSON.stringify(r.data));p=r.data;
 const pack=(await h.call('projects/test-project/export',{revision:p.project.revision})).data;
 assert.equal(pack.images.length,1);assert.deepEqual(new Set(pack.manifest.excludedAssets),new Set([frame.id,hero.id]));
 assert.ok(pack.documents.find(d=>d.path==='06_Storyboard/storyboard.html').content.includes('제외했습니다'));
 assert.equal(JSON.parse(pack.documents.find(d=>d.path==='07_Video_Prompts/prompts.json').content)[0].referenceImage,null);
 assert.equal(requests.length,2);
 }finally{h.sql.close();}
});
test('초안과 에셋 프롬프트를 직접 수정할 수 있고 잘못된 수정은 거부한다',async t=>{
 const h=setup(),requests=mockProvider(t);try{
 let p=await create(h);let r=await h.call('projects/test-project/interview',{revision:p.project.revision,answer:'초안을 만들어줘',requestId:'i1'});await h.call('jobs/'+r.data.job.id);p=(await h.call('projects/test-project')).data;
 assert.deepEqual(p.workflow.messages.at(-1).changes,['제목 확정']);
 assert.equal((await h.call('projects/test-project/edit-draft',{revision:p.project.revision,draft:{...p.workflow.draft,durationSeconds:61}})).status,400);
 r=await h.call('projects/test-project/edit-draft',{revision:p.project.revision,draft:{...p.workflow.draft,title:'수정한 제목'}});assert.equal(r.status,200,JSON.stringify(r.data));p=r.data;
 assert.equal(p.workflow.draft.title,'수정한 제목');assert.equal(p.workflow.readyForReview,true);
 r=await h.call('projects/test-project/confirm-plan',{revision:p.project.revision});assert.equal(r.status,200);p=r.data;
 assert.equal((await h.call('projects/test-project/edit-draft',{revision:p.project.revision,draft:p.workflow.draft})).status,409);
 const hero=byKind(p,'character');
 assert.equal((await h.call('projects/test-project/edit-prompt',{revision:p.project.revision,assetId:hero.id,prompt:'  '})).status,400);
 r=await h.call('projects/test-project/edit-prompt',{revision:p.project.revision,assetId:hero.id,prompt:'CUSTOM PROMPT'});assert.equal(r.status,200,JSON.stringify(r.data));p=r.data;
 assert.equal(p.assets.find(a=>a.id===hero.id).prompt,'CUSTOM PROMPT');
 await generate(h,p,hero,'h1',{feedback:'조금 더 밝게'});
 assert.equal(requests.at(-1).input[1].content[0].text,'CUSTOM PROMPT\nUSER DIRECTION: 조금 더 밝게');
 }finally{h.sql.close();}
});
test('잘못된 AI 초안은 턴을 잃지 않고 경고와 함께 보여 주되 확정을 차단한다',async t=>{
 const h=setup();mockProvider(t,{invalid:true});try{let p=await create(h);const r=await h.call('projects/test-project/interview',{revision:0,answer:'',requestId:'bad-draft'});await h.call('jobs/'+r.data.job.id);p=(await h.call('projects/test-project')).data;
 assert.equal(p.workflow.readyForReview,false);assert.ok(p.workflow.draftWarning);assert.equal(p.workflow.draft.durationSeconds,59);assert.equal(p.workflow.lastError,null);assert.equal(p.project.ideaInput,h.input.ideaInput);assert.equal(p.workflow.activeJob,null);assert.ok(p.budget.usedMicro>0);
 assert.equal((await h.call('projects/test-project/confirm-plan',{revision:p.project.revision})).status,409);
 }finally{h.sql.close();}
});
test('응답 유실을 자동 재전송하지 않고 예약 금액을 보류한다',async t=>{
 const h=setup(),calls=mockProvider(t,{uncertain:true});try{await create(h);const r=await h.call('projects/test-project/interview',{revision:0,answer:'',requestId:'lost-1'});assert.equal(r.data.job.status,'failed');assert.equal(r.data.job.actualMicro,null);await h.call('projects/test-project/interview',{revision:0,answer:'',requestId:'lost-1'});assert.equal(calls.length,1);const p=(await h.call('projects/test-project')).data;assert.ok(p.budget.usedMicro>0);assert.equal(p.workflow.activeJob,null);}finally{h.sql.close();}
});
test('월 경계의 미정산 비용과 프로젝트 예산 부족을 모두 차단한다',async t=>{
 const h=setup(),calls=mockProvider(t);try{
 await create(h);
 h.sql.prepare("INSERT INTO studio_jobs (id,project_id,owner,request_key,kind,input_json,status,reservation_micro,billing_month,created_at,updated_at) VALUES ('old','other','owner-a','old','image','{}','failed',200000000,'2020-01','2020-01-01','2020-01-01')").run();
 let r=await h.call('projects/test-project/interview',{revision:0,answer:'',requestId:'budget-1'});assert.equal(r.status,409);assert.equal(calls.length,0);
 h.sql.exec('UPDATE studio_jobs SET actual_micro=0');h.sql.exec('UPDATE studio_projects SET budget_micro=1');
 r=await h.call('projects/test-project/interview',{revision:0,answer:'',requestId:'budget-2'});assert.equal(r.status,409);assert.equal(calls.length,0);
 assert.equal((await h.call('projects/test-project')).data.workflow.activeJob,null);
 }finally{h.sql.close();}
});
test('진행 중 중복 클릭은 두 번째 유료 요청과 입력 변경을 차단한다',async t=>{
 const h=setup(),calls=mockProvider(t);try{await create(h);const first=await h.call('projects/test-project/interview',{revision:0,answer:'',requestId:'active-1'});assert.equal(first.status,202);
 const p=(await h.call('projects/test-project')).data;
 assert.equal((await h.call('projects/test-project/interview',{revision:p.project.revision,answer:'',requestId:'active-2'})).status,409);
 assert.equal((await h.call('projects/test-project',{revision:p.project.revision,project:h.input},{method:'PATCH'})).status,409);
 await h.call('jobs/'+first.data.job.id);await h.call('jobs/'+first.data.job.id);
 assert.equal(calls.length,1);assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM studio_jobs WHERE status='completed'").get().n,1);
 }finally{h.sql.close();}
});
test('가격·길이·응답 검증은 누락·음수 사용량과 모순된 기획을 거부하거나 경고로 바꾼다',()=>{
 assert.equal(textUsage({input_tokens:0,output_tokens:0}),null);assert.equal(imageUsage({usage:{input_tokens:1,output_tokens:1},tool_usage:{image_gen:{input_tokens_details:{text_tokens:-1,image_tokens:2},output_tokens:3}}}),null);
 assert.equal(imageUsage({usage:{input_tokens:100,output_tokens:100},tool_usage:{image_gen:{input_tokens_details:{text_tokens:10,image_tokens:20},output_tokens:99,output_tokens_details:{image_tokens:30}}}}),1173);
 assert.throws(()=>validateDraft({...draft,durationSeconds:61}));assert.equal(month(new Date('2026-10-31T15:00:00Z')),'2026-11');
 // 예전 초안에 없는 영어 프롬프트 필드는 비워 두고 통과시킨다.
 assert.equal(validateDraft({...draft,stylePrompt:undefined}).stylePrompt,'');
 const turn=validateTurn({message:'m',questions:['q'],readyForReview:true,changes:['x'],draft});assert.equal(turn.readyForReview,false);assert.deepEqual(turn.changes,['x']);
 const warned=validateTurn({message:'m',questions:[],readyForReview:true,draft:{...draft,durationSeconds:59}});assert.equal(warned.readyForReview,false);assert.ok(warned.draftWarning);assert.equal(warned.draft.durationSeconds,59);
 assert.equal(imageSize('16:9','character'),'1024x1024');assert.equal(imageSize('9:16','keyframe'),'864x1536');assert.equal(imageSize('16:9','environment'),'1536x864');
 const rows=planAssets(draft,'s','p','o');assert.equal(rows.filter(r=>r.kind==='keyframe')[0].refs.length,2);assert.ok(rows.find(r=>r.kind==='environment').prompt.includes('Wide establishing shot'));
});
test('ZIP은 CRC·UTF-8과 폴더를 유지하고 위험·중복 경로를 거부한다',async()=>{
 const data=new TextEncoder().encode('123456789');assert.equal(crc32(data),0xcbf43926);
 for(const path of ['../secret','/root','C:/file','a\\b','a/../b','a//b'])assert.throws(()=>makeZip([{path,data}]));
 assert.throws(()=>makeZip([{path:'a',data},{path:'A',data}]));
 const zip=await makeZip([{path:'한글/문서.txt',data}]).arrayBuffer(),view=new DataView(zip);
 assert.equal(view.getUint16(6,true),0x800);assert.equal(view.getUint32(zip.byteLength-22,true),0x06054b50);
});
