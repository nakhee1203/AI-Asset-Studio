import {validateProject,activeInput} from '../public/studio/model.js';
import {TEXT_MODEL,IMAGE_MODEL,MONTHLY_LIMIT,IMAGE_RESERVATION,MAX_IMAGE_BYTES,uid,now,month,fail,string,id,initialWorkflow,discussionRequest,textReservation,textUsage,imageUsage,responseText,validateTurn,validateDraft,planAssets,sha256,imageSize,editPrompt,IMAGE_TOOL_INSTRUCTION} from './studio-domain.mjs';
import {checkSelections,createExport} from './studio-export.mjs';
const ACTIVE=['submitting','running','processing'];
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const parse=row=>row?{...row,input:JSON.parse(row.input_json),workflow:JSON.parse(row.workflow_json)}:null;
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const first=(db,sql,...args)=>stmt(db,sql,...args).first();
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results;
const run=(db,sql,...args)=>stmt(db,sql,...args).run();
async function project(db,owner,projectId){
 const p=parse(await first(db,'SELECT * FROM studio_projects WHERE id=? AND owner=?',id(projectId),owner));
 if(!p)fail('프로젝트를 찾을 수 없습니다.',404);return p;
}
const safeJob=j=>j?{id:j.id,kind:j.kind,status:j.status,error:j.error,reservationMicro:j.reservation_micro,actualMicro:j.actual_micro,createdAt:j.created_at}:null;
const summary=p=>({...p.input,displayTitle:p.workflow.draft?.title??p.input.title,revision:p.revision,stage:p.workflow.stage,server:true});
function current(p,revision){if(p.revision!==revision)fail('다른 화면에서 변경되었습니다. 새로고침한 뒤 다시 진행해 주세요.',409);}
function idle(p){if(p.workflow.activeJob)fail('진행 중인 작업이 끝난 뒤 변경할 수 있습니다.',409);}
async function loadAssets(db,p){
 const assets=await all(db,'SELECT * FROM studio_assets WHERE project_id=? AND owner=? AND snapshot_id=? ORDER BY rowid',p.id,p.owner,p.workflow.snapshotId??'');
 const versions=await all(db,'SELECT * FROM studio_versions WHERE project_id=? AND owner=? AND snapshot_id=? ORDER BY created_at',p.id,p.owner,p.workflow.snapshotId??'');
 return {assets,versions};
}
async function detail(db,p){
 const {assets,versions}=await loadAssets(db,p);
 const cost=await first(db,'SELECT COALESCE(SUM(COALESCE(actual_micro,reservation_micro)),0) AS projectCost FROM studio_jobs WHERE project_id=? AND owner=?',p.id,p.owner);
 const monthly=await first(db,'SELECT COALESCE(SUM(COALESCE(actual_micro,reservation_micro)),0) AS cost FROM studio_jobs WHERE owner=? AND (billing_month=? OR actual_micro IS NULL)',p.owner,month());
 const job=p.workflow.activeJob?await first(db,'SELECT * FROM studio_jobs WHERE id=? AND owner=?',p.workflow.activeJob,p.owner):null;
 const excluded=new Set(p.workflow.excluded??[]);
 return {project:summary(p),workflow:p.workflow,job:safeJob(job),assets:assets.map(a=>({id:a.id,kind:a.kind,label:a.label,prompt:a.prompt,excluded:excluded.has(a.id),refs:JSON.parse(a.refs_json),selectedVersion:a.selected_version,finalVersion:a.final_version,versions:versions.filter(v=>v.asset_id===a.id).map(v=>({id:v.id,url:'/api/images/'+v.id,prompt:v.prompt,revisedPrompt:v.revised_prompt??null,parentVersion:v.parent_version,refs:JSON.parse(v.refs_json),createdAt:v.created_at}))})),budget:{projectMicro:p.budget_micro,usedMicro:cost.projectCost,monthlyMicro:MONTHLY_LIMIT,monthlyUsedMicro:monthly.cost,imageEstimateMicro:IMAGE_RESERVATION}};
}
async function commit(db,p,workflow,extra=()=>[],input=p.input){
 const token=uid();workflow={...workflow,mutation:token};
 const guard='EXISTS (SELECT 1 FROM studio_projects WHERE id=? AND owner=? AND revision=? AND json_extract(workflow_json,\'$.mutation\')=?)';
 const args=[p.id,p.owner,p.revision+1,token];
 const results=await db.batch([
  stmt(db,'UPDATE studio_projects SET input_json=?,workflow_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=?',JSON.stringify(input),JSON.stringify(workflow),now(),p.id,p.owner,p.revision),
  ...extra(guard,args)
 ]);
 if(results[0].meta.changes!==1)fail('다른 요청이 먼저 처리됐습니다. 새로고침해 주세요.',409);
 return project(db,p.owner,p.id);
}
async function openai(env,path,body){
 if(!env.OPENAI_API_KEY)fail('서버 API 연결 설정이 필요합니다.',503);
 let response;
 try{response=await fetch('https://api.openai.com/v1/responses'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});}
 catch{throw Object.assign(new Error('응답을 확인하지 못했습니다. 중복 비용을 피하기 위해 자동 재요청하지 않습니다.'),{uncertain:true,status:502});}
 const value=await response.json().catch(()=>({}));
 if(!response.ok){
  const message=response.status===401?'API 키 인증을 확인해 주세요.':response.status===429?'API 한도 또는 잔액을 확인한 뒤 다시 시도해 주세요.':response.status===403?'이 모델을 사용할 권한이 없습니다.':'AI 요청을 처리하지 못했습니다. ('+response.status+')';
  throw Object.assign(new Error(message),{status:502,providerStatus:response.status,uncertain:response.status>=500});
 }
 return value;
}
async function submitJob(db,env,p,body,kind,input,request,reservation){
 const requestKey=p.owner+':'+id(body.requestId);
 const duplicate=await first(db,'SELECT * FROM studio_jobs WHERE request_key=? AND owner=?',requestKey,p.owner);
 if(duplicate){if(duplicate.project_id!==p.id)fail('요청 식별자가 이미 사용되었습니다.',409);return safeJob(duplicate);}
 current(p,body.revision);idle(p);if(!env.OPENAI_API_KEY)fail('서버 API 연결 설정이 필요합니다.',503);
 const jobId=uid(),at=now(),workflow={...p.workflow,activeJob:jobId,lastError:null,messages:kind==='interview'&&input.answer?[...p.workflow.messages,{role:'user',text:input.answer}]:p.workflow.messages};
 const result=await db.batch([
  stmt(db,`UPDATE studio_projects SET workflow_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=? AND
    NOT EXISTS(SELECT 1 FROM studio_jobs WHERE owner=? AND actual_micro>reservation_micro) AND
    (SELECT COALESCE(SUM(COALESCE(actual_micro,reservation_micro)),0) FROM studio_jobs WHERE owner=? AND (billing_month=? OR actual_micro IS NULL))+?<=? AND
    (SELECT COALESCE(SUM(COALESCE(actual_micro,reservation_micro)),0) FROM studio_jobs WHERE project_id=? AND owner=?)+?<=budget_micro`,
   JSON.stringify(workflow),at,p.id,p.owner,p.revision,p.owner,p.owner,month(),reservation,MONTHLY_LIMIT,p.id,p.owner,reservation),
  stmt(db,`INSERT INTO studio_jobs (id,project_id,owner,request_key,kind,input_json,status,reservation_micro,billing_month,created_at,updated_at)
    SELECT ?,?,?,?,?,?,'submitting',?,?,?,? WHERE EXISTS(SELECT 1 FROM studio_projects WHERE id=? AND owner=? AND json_extract(workflow_json,'$.activeJob')=?)`,
    jobId,p.id,p.owner,requestKey,kind,JSON.stringify(input),reservation,month(),at,at,p.id,p.owner,jobId)
 ]);
 if(result[0].meta.changes!==1)fail('동시 요청 또는 예산 제한으로 시작하지 못했습니다. 사용량과 진행 중인 작업을 확인해 주세요.',409);
 try{
  const response=await openai(env,'',request);
  if(typeof response.id!=='string'||!/^resp_[A-Za-z0-9_-]+$/.test(response.id))throw Object.assign(new Error('AI 응답 식별자를 확인하지 못했습니다.'),{uncertain:true});
  await run(db,"UPDATE studio_jobs SET response_id=?,status='running',updated_at=? WHERE id=? AND owner=?",response.id,now(),jobId,p.owner);
 }catch(error){
  await finishFailed(db,await first(db,'SELECT * FROM studio_jobs WHERE id=? AND owner=?',jobId,p.owner),error.message,error.uncertain?null:0);
 }
 return safeJob(await first(db,'SELECT * FROM studio_jobs WHERE id=? AND owner=?',jobId,p.owner));
}
async function finishFailed(db,job,message,cost=null){
 const p=await project(db,job.owner,job.project_id);
 if(p.workflow.activeJob!==job.id)return;
 await commit(db,p,{...p.workflow,activeJob:null,lastError:message},(guard,args)=>[
  stmt(db,"UPDATE studio_jobs SET status='failed',error=?,actual_micro=?,updated_at=? WHERE id=? AND owner=? AND "+guard,message,cost,now(),job.id,job.owner,...args)
 ]);
}
async function pollJob(db,env,owner,jobId){
 let job=await first(db,'SELECT * FROM studio_jobs WHERE id=? AND owner=?',id(jobId),owner);
 if(!job)fail('작업을 찾을 수 없습니다.',404);
 if(!ACTIVE.includes(job.status))return safeJob(job);
 if(job.status==='submitting'){
  if(Date.now()-Date.parse(job.updated_at)>120000)await finishFailed(db,job,'요청 접수 여부를 확인할 수 없습니다. 예상 금액을 보류했으며 자동 재시도하지 않았습니다.');
  return safeJob(await first(db,'SELECT * FROM studio_jobs WHERE id=? AND owner=?',job.id,owner));
 }
 if(job.status==='processing'&&Date.now()-Date.parse(job.updated_at)<120000)return safeJob(job);
 let response;
 try{response=await openai(env,'/'+job.response_id);}
 catch(error){
  if(error.providerStatus===404)await finishFailed(db,job,'AI 결과 조회가 만료되었습니다. 중복 요청은 보내지 않았고 예상 금액을 보류했습니다.');
  return safeJob(await first(db,'SELECT * FROM studio_jobs WHERE id=? AND owner=?',job.id,owner));
 }
 if(['queued','in_progress'].includes(response.status))return safeJob(job);
 const cost=job.kind==='interview'?textUsage(response.usage):imageUsage(response);
 if(response.status!=='completed'){await finishFailed(db,job,'AI 작업이 완료되지 않았습니다. 입력은 보존했습니다. 다시 시도하면 별도 요청으로 처리됩니다.',cost);return safeJob(await first(db,'SELECT * FROM studio_jobs WHERE id=? AND owner=?',job.id,owner));}
 const claimed=await run(db,"UPDATE studio_jobs SET status='processing',updated_at=? WHERE id=? AND owner=? AND (status='running' OR (status='processing' AND updated_at<?))",now(),job.id,owner,new Date(Date.now()-120000).toISOString());
 if(!claimed.meta.changes)return safeJob(job);
 try{
  const p=await project(db,owner,job.project_id);
  if(p.workflow.activeJob!==job.id)fail('프로젝트 상태가 달라 결과를 적용하지 않았습니다.');
  const saved=JSON.parse(job.input_json),workflow={...p.workflow,activeJob:null,lastError:null};
  let additional=()=>[];
  if(job.kind==='interview'){
   const turn=validateTurn(JSON.parse(responseText(response)));
   workflow.messages=[...p.workflow.messages,{role:'assistant',text:turn.message,questions:turn.questions,changes:turn.changes}];
   workflow.draft=turn.draft;workflow.readyForReview=turn.readyForReview;workflow.draftWarning=turn.draftWarning;
  }else{
   const calls=(response.output??[]).filter(o=>o.type==='image_generation_call'&&o.result);
   if(calls.length!==1)fail('이미지 한 장의 생성 결과를 확인하지 못했습니다.');
   const encoded=calls[0].result,revised=typeof calls[0].revised_prompt==='string'?calls[0].revised_prompt.slice(0,8000):null;
   if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_IMAGE_BYTES/3)*4+4)fail('이미지가 허용 크기를 넘었습니다.');
   const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
   if(bytes.length<8||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n))fail('올바른 PNG 이미지가 아닙니다.');
   const objectKey=owner+'/'+p.id+'/'+saved.snapshotId+'/'+job.id+'.png';
   await env.BUCKET.put(objectKey,bytes,{httpMetadata:{contentType:'image/png'}});
   const hash=await sha256(bytes);
   additional=(guard,args)=>[stmt(db,`INSERT OR IGNORE INTO studio_versions (id,asset_id,project_id,owner,snapshot_id,object_key,mime,sha256,bytes,prompt,revised_prompt,parent_version,refs_json,created_at)
    SELECT ?,?,?,?,?,?,'image/png',?,?,?,?,?,?,? WHERE `+guard,job.id,saved.assetId,p.id,owner,saved.snapshotId,objectKey,hash,bytes.length,saved.prompt,revised,saved.parentVersion??null,JSON.stringify(saved.refs),now(),...args)];
  }
  await commit(db,p,workflow,(guard,args)=>[...additional(guard,args),stmt(db,"UPDATE studio_jobs SET status='completed',actual_micro=?,updated_at=? WHERE id=? AND owner=? AND "+guard,cost,now(),job.id,owner,...args)]);
 }catch(error){
  await finishFailed(db,job,error.status?error.message:'AI 결과를 저장하지 못했습니다. 입력과 이전 에셋은 보존했습니다.',cost);
 }
 return safeJob(await first(db,'SELECT * FROM studio_jobs WHERE id=? AND owner=?',job.id,owner));
}
async function imageRequest(db,env,p,body){
 if(!['assets','complete'].includes(p.workflow.stage)||!p.workflow.snapshotId)fail('기획을 먼저 확정해 주세요.',409);
 if(body.acknowledgeEstimate!==true)fail('이미지 생성 예상 비용을 확인해 주세요.');
 const {assets,versions}=await loadAssets(db,p),asset=assets.find(a=>a.id===body.assetId),excluded=new Set(p.workflow.excluded??[]);
 if(!asset)fail('에셋을 찾을 수 없습니다.',404);
 if(excluded.has(asset.id))fail('제외한 에셋입니다. 다시 포함한 뒤 생성해 주세요.',409);
 const snapshot=await first(db,'SELECT * FROM studio_snapshots WHERE id=? AND owner=?',p.workflow.snapshotId,p.owner);
 const draft=JSON.parse(snapshot.data_json).draft;
 const feedback=string(body.feedback??'','수정 요청',3000);
 const parent=body.parentVersion?versions.find(v=>v.id===body.parentVersion&&v.asset_id===asset.id):null;
 if(body.parentVersion&&!parent)fail('수정할 원본을 찾을 수 없습니다.',404);
 if(parent&&!feedback)fail('선택한 이미지를 수정하려면 바꾸고 싶은 부분을 적어 주세요.');
 const refs=JSON.parse(asset.refs_json).map(refId=>{
  const refAsset=assets.find(a=>a.id===refId),version=versions.find(v=>v.id===refAsset?.selected_version);
  if(!refAsset||excluded.has(refAsset.id))fail('이 장면이 참조하는 에셋이 제외되었습니다. 참조 에셋을 다시 포함해 주세요.',409);
  if(!version)fail('캐릭터·장소·소품 이미지를 먼저 만들고 선택해 주세요.',409);
  return {assetId:refId,versionId:version.id};
 });
 if(parent&&JSON.stringify(JSON.parse(parent.refs_json))!==JSON.stringify(refs))fail('참조가 바뀐 이미지는 새 참조로 다시 생성해 주세요.',409);
 const inputs=parent?[parent]:refs.map(r=>versions.find(v=>v.id===r.versionId));
 // 편집은 짧은 지시만, 새 생성은 저장된 에셋 프롬프트(사용자가 고쳤을 수 있음)+추가 방향.
 const prompt=parent?editPrompt(feedback):asset.prompt+(feedback?'\nUSER DIRECTION: '+feedback:'');
 const content=[{type:'input_text',text:prompt}];
 for(const version of inputs){
  const object=await env.BUCKET.get(version.object_key);if(!object)fail('참조 이미지 파일이 없습니다.',409);
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(bytes.length>MAX_IMAGE_BYTES||await sha256(bytes)!==version.sha256)fail('참조 이미지 검증에 실패했습니다.',409);
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  content.push({type:'input_image',image_url:'data:image/png;base64,'+btoa(binary)});
 }
 const request={model:TEXT_MODEL,reasoning:{effort:'none'},background:true,store:true,max_output_tokens:2048,max_tool_calls:1,input:[{role:'developer',content:IMAGE_TOOL_INSTRUCTION},{role:'user',content}],tool_choice:{type:'image_generation'},tools:[{type:'image_generation',model:IMAGE_MODEL,action:inputs.length?'edit':'generate',size:imageSize(draft.aspectRatio,asset.kind),quality:'medium',output_format:'png',background:'opaque',partial_images:0}]};
 return {request,input:{assetId:asset.id,snapshotId:p.workflow.snapshotId,prompt,parentVersion:parent?.id??null,refs,acknowledgedEstimate:true}};
}
async function readBody(request){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('JSON 요청이 필요합니다.',415);
 const reader=request.body?.getReader();if(!reader)fail('입력 내용이 없습니다.');
 let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256000){await reader.cancel();fail('입력 내용이 너무 깁니다.',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('입력 내용을 읽지 못했습니다.');}
}
export async function handleApi(request,env){
 try{
  const owner=request.headers.get('oai-authenticated-user-id');if(!owner)fail('로그인이 필요합니다.',401);
  if(!env.DB||!env.BUCKET)fail('프로젝트 저장소 연결이 필요합니다.',503);
  const db=env.DB,url=new URL(request.url),parts=url.pathname.replace(/^\/api\//,'').split('/').filter(Boolean),method=request.method;
  if(method!=='GET'){
   const origin=request.headers.get('Origin');if(!origin||origin!==url.origin)fail('요청 출처를 확인할 수 없습니다.',403);
  }
  const body=method==='GET'?null:await readBody(request);
  if(parts[0]==='images'&&parts.length===2&&method==='GET'){
   const version=await first(db,'SELECT * FROM studio_versions WHERE id=? AND owner=?',id(parts[1]),owner);if(!version)fail('이미지를 찾을 수 없습니다.',404);
   const object=await env.BUCKET.get(version.object_key);if(!object)fail('이미지 파일을 찾을 수 없습니다.',404);
   return new Response(object.body,{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
  }
  if(parts[0]==='jobs'&&parts.length===2&&method==='GET')return json({job:await pollJob(db,env,owner,parts[1])});
  if(parts[0]!=='projects')fail('지원하지 않는 요청입니다.',404);
  if(parts.length===1){
   if(method==='GET')return json({projects:(await all(db,'SELECT * FROM studio_projects WHERE owner=? ORDER BY updated_at DESC',owner)).map(p=>summary(parse(p)))});
   if(method==='POST'){
    const input=validateProject(body.project);if(!activeInput(input))fail('아이디어 또는 기획 내용을 입력해 주세요.');
    const existing=await first(db,'SELECT id,owner FROM studio_projects WHERE id=?',input.id);
    if(existing){if(existing.owner!==owner)fail('이미 사용 중인 식별자입니다.',409);return json(await detail(db,await project(db,owner,input.id)));}
    const count=await first(db,'SELECT COUNT(*) AS count FROM studio_projects WHERE owner=?',owner);if(count.count>=500)fail('프로젝트는 최대 500개까지 보관할 수 있습니다.');
    await run(db,'INSERT INTO studio_projects (id,owner,input_json,workflow_json,created_at,updated_at) VALUES (?,?,?,?,?,?)',input.id,owner,JSON.stringify(input),JSON.stringify(initialWorkflow()),now(),now());
    return json(await detail(db,await project(db,owner,input.id)),201);
   }
  }
  let p=await project(db,owner,parts[1]);
  if(parts.length===2&&method==='GET')return json(await detail(db,p));
  if(parts.length===2&&method==='PATCH'){
   current(p,body.revision);idle(p);const input=validateProject({...body.project,id:p.id,createdAt:p.input.createdAt,updatedAt:now()});
   if(!activeInput(input))fail('아이디어 또는 기획 내용을 입력해 주세요.');
   p=await commit(db,p,initialWorkflow(),()=>[],input);return json(await detail(db,p));
  }
  if(parts.length!==3||method!=='POST')fail('지원하지 않는 요청입니다.',404);
  const action=parts[2];
  if(action==='interview'){
   if(p.workflow.stage!=='interview')fail('확정 기획을 수정하려면 입력 내용 수정에서 새 기획 대화를 시작해 주세요.',409);
   const answer=string(body.answer??'','답변',8000);
   if(p.workflow.messages.length>=60)fail('대화가 길어졌습니다. 입력 내용을 정리하고 새 대화를 시작해 주세요.');
   const request=discussionRequest(p.input,p.workflow,answer);
   return json({job:await submitJob(db,env,p,body,'interview',{answer},request,textReservation(request))},202);
  }
  if(action==='generate'){
   const existing=await first(db,'SELECT * FROM studio_jobs WHERE request_key=? AND owner=?',owner+':'+id(body.requestId),owner);
   if(existing&&existing.project_id===p.id)return json({job:safeJob(existing)},202);
   current(p,body.revision);idle(p);
   const prepared=await imageRequest(db,env,p,body);
   return json({job:await submitJob(db,env,p,body,'image',prepared.input,prepared.request,IMAGE_RESERVATION)},202);
  }
  current(p,body.revision);idle(p);
  if(action==='confirm-plan'){
   if(p.workflow.stage!=='interview'||!p.workflow.readyForReview)fail('기획 초안을 먼저 검토해 주세요.',409);
   const draft=validateDraft(p.workflow.draft),snapshotId=uid(),assets=planAssets(draft,snapshotId,p.id,owner);
   p=await commit(db,p,{...p.workflow,stage:'assets',snapshotId,excluded:[],draftWarning:null},(guard,args)=>[
    stmt(db,'INSERT INTO studio_snapshots (id,project_id,owner,data_json,created_at) SELECT ?,?,?,?,? WHERE '+guard,snapshotId,p.id,owner,JSON.stringify({draft,input:p.input}),now(),...args),
    ...assets.map(a=>stmt(db,'INSERT INTO studio_assets (id,project_id,owner,snapshot_id,kind,label,prompt,refs_json) SELECT ?,?,?,?,?,?,?,? WHERE '+guard,a.id,p.id,owner,snapshotId,a.kind,a.label,a.prompt,JSON.stringify(a.refs),...args))
   ]);return json(await detail(db,p));
  }
  if(action==='select'){
   const {assets,versions}=await loadAssets(db,p),asset=assets.find(a=>a.id===body.assetId),version=versions.find(v=>v.id===body.versionId&&v.asset_id===asset?.id);
   if(!asset||!version)fail('에셋 버전을 찾을 수 없습니다.',404);
   p=await commit(db,p,{...p.workflow,stage:'assets'},(guard,args)=>[
    stmt(db,'UPDATE studio_assets SET selected_version=? WHERE id=? AND owner=? AND '+guard,version.id,asset.id,owner,...args),
    stmt(db,'UPDATE studio_assets SET final_version=NULL WHERE project_id=? AND owner=? AND snapshot_id=? AND '+guard,p.id,owner,p.workflow.snapshotId,...args)
   ]);return json(await detail(db,p));
  }
  if(action==='confirm-assets'){
   const {assets,versions}=await loadAssets(db,p),excluded=[...new Set(p.workflow.excluded??[])],active=assets.filter(a=>!excluded.includes(a.id));
   if(!active.length)fail('확정할 에셋이 없습니다.',409);checkSelections(active,versions);
   p=await commit(db,p,{...p.workflow,stage:'complete'},(guard,args)=>[stmt(db,'UPDATE studio_assets SET final_version=selected_version WHERE project_id=? AND owner=? AND snapshot_id=? AND '+guard,p.id,owner,p.workflow.snapshotId,...args),...excluded.map(assetId=>stmt(db,'UPDATE studio_assets SET final_version=NULL WHERE id=? AND owner=? AND '+guard,assetId,owner,...args))]);
   return json(await detail(db,p));
  }
  if(action==='edit-draft'){
   if(p.workflow.stage!=='interview')fail('확정한 기획은 입력 내용 수정에서 새 대화로 바꿀 수 있습니다.',409);
   const draft=validateDraft(body.draft);
   p=await commit(db,p,{...p.workflow,draft,readyForReview:true,draftWarning:null});return json(await detail(db,p));
  }
  if(action==='edit-prompt'){
   if(!['assets','complete'].includes(p.workflow.stage))fail('기획을 먼저 확정해 주세요.',409);
   const {assets}=await loadAssets(db,p),asset=assets.find(a=>a.id===body.assetId);if(!asset)fail('에셋을 찾을 수 없습니다.',404);
   const prompt=string(body.prompt,'프롬프트',6000);if(!prompt)fail('프롬프트를 입력해 주세요.');
   p=await commit(db,p,p.workflow,(guard,args)=>[stmt(db,'UPDATE studio_assets SET prompt=? WHERE id=? AND owner=? AND '+guard,prompt,asset.id,owner,...args)]);return json(await detail(db,p));
  }
  if(action==='exclude'){
   // 제외는 참조 관계를 깨지 않는 범위에서만. 장면이 참조하는 기준 에셋은 장면을 먼저 제외해야 뺄 수 있다.
   if(!['assets','complete'].includes(p.workflow.stage))fail('기획을 먼저 확정해 주세요.',409);
   const {assets}=await loadAssets(db,p),asset=assets.find(a=>a.id===body.assetId);if(!asset)fail('에셋을 찾을 수 없습니다.',404);
   const excluded=new Set(p.workflow.excluded??[]);
   if(body.excluded===true){
    const dependent=assets.find(a=>!excluded.has(a.id)&&a.id!==asset.id&&JSON.parse(a.refs_json).includes(asset.id));
    if(dependent)fail('"'+dependent.label+'" 장면이 이 에셋을 참조합니다. 그 장면을 먼저 제외해 주세요.',409);
    excluded.add(asset.id);
   }else if(body.excluded===false){
    if(JSON.parse(asset.refs_json).some(refId=>excluded.has(refId)))fail('이 장면이 참조하는 에셋이 아직 제외되어 있습니다. 참조 에셋을 먼저 포함해 주세요.',409);
    excluded.delete(asset.id);
   }else fail('제외 여부를 확인해 주세요.');
   p=await commit(db,p,{...p.workflow,stage:'assets',excluded:[...excluded]},(guard,args)=>[stmt(db,'UPDATE studio_assets SET final_version=NULL WHERE project_id=? AND owner=? AND snapshot_id=? AND '+guard,p.id,owner,p.workflow.snapshotId,...args)]);
   return json(await detail(db,p));
  }
  if(action==='export'){
   if(p.workflow.stage!=='complete')fail('에셋을 먼저 최종 확정해 주세요.',409);
   const snapshot=await first(db,'SELECT data_json FROM studio_snapshots WHERE id=? AND owner=?',p.workflow.snapshotId,owner),{assets,versions}=await loadAssets(db,p);
   const pack=await createExport(p,JSON.parse(snapshot.data_json),assets,versions);
   for(const image of pack.images){const v=versions.find(v=>v.id===image.versionId),object=await env.BUCKET.head(v.object_key);if(!object||object.size!==v.bytes)fail('다운로드할 이미지 파일이 누락되었습니다.',409);}
   await run(db,'INSERT INTO studio_exports (id,project_id,owner,snapshot_id,manifest_json,created_at) VALUES (?,?,?,?,?,?)',pack.exportId,p.id,owner,p.workflow.snapshotId,JSON.stringify(pack.manifest),pack.createdAt);
   return json(pack);
  }
  if(action==='archive'){
   p=await commit(db,p,p.workflow,()=>[],{...p.input,status:body.restore?p.input.inputMode:'archived',updatedAt:now()});return json(await detail(db,p));
  }
  fail('지원하지 않는 요청입니다.',404);
 }catch(error){return json({error:error.status?error.message:'요청 처리 중 문제가 생겼습니다. 입력과 기존 에셋은 보존했습니다.'},error.status??500);}
}
