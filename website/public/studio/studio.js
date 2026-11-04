import {STORAGE_KEY,STATUSES,projectFromInput,activeInput,parseLibrary,exportProject,importProject} from './model.js';
import {makeZip} from './zip.mjs';
const $=s=>document.querySelector(s),dialog=$('#project-dialog'),form=$('#project-form');
let projects=[],localProjects=[],editingId=null,selectedId=null,detail=null,busy=false,connected=false,loadingLibrary=false,timer,toastTimer,estimateAccepted=false,showArchived=false;
const feedbacks=new Map(),chatDrafts=new Map();
const labels={interview:'기획 대화',assets:'이미지 제작·검토',complete:'다운로드 준비'};
const kinds={character:'캐릭터',environment:'장소',prop:'소품',keyframe:'장면'};
function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
function button(text,fn,className='button button-edit'){const n=el('button',className,text);n.type='button';n.addEventListener('click',fn);n.disabled=busy;return n;}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
async function api(path,body,method='POST'){
 const r=await fetch('/api/'+path,{method:body===undefined?'GET':method,credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let data;try{data=await r.json();}catch{throw Object.assign(new Error(r.redirected?'로그인이 필요합니다.':'서버 응답을 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.'),{status:r.redirected?401:r.status});}
 if(!r.ok)throw Object.assign(new Error(data.error??'요청을 처리하지 못했습니다.'),{status:r.status});return data;
}
function field(name){return form.elements.namedItem(name);}
function updateMode(){
 const planning=field('inputMode').value==='drafting';$('#idea-fields').hidden=planning;$('#planning-fields').hidden=!planning;field('ideaInput').required=!planning;field('planningInput').required=planning;
 $('#input-guidance').textContent=planning?'작성해 둔 내용 그대로 넣어 주세요. 빈 부분은 대화로 채워갑니다.':'한두 문장이면 충분합니다. 세부 설정은 대화로 정리합니다.';
}
function openProject(p){
 editingId=p?.id??null;form.reset();$('#form-error').hidden=true;$('#dialog-title').textContent=p?'입력 내용 다듬기':'어디까지 준비되었나요?';
 field('inputMode').value=p?.inputMode??'idea';for(const name of ['title','ideaInput','planningInput','planningFeedback'])field(name).value=p?.[name]??'';
 $('#project-name-field').hidden=!p;$('#delete-project').hidden=!p;$('#export-project').hidden=!p;$('#save-project').textContent=p?'새 기획 대화 시작 ↗':'프로젝트 만들기 ↗';$('#planning-feedback').open=!!p?.planningFeedback;
 $('#edit-warning').hidden=!p;updateMode();dialog.showModal();field(p?.inputMode==='drafting'?'planningInput':'ideaInput').focus();
}
function buildFromForm(){const previous=projects.find(p=>p.id===editingId);return projectFromInput({inputMode:field('inputMode').value,ideaInput:field('ideaInput').value,planningInput:field('planningInput').value,planningFeedback:field('planningFeedback').value,title:field('title').value},previous,{id:crypto.randomUUID(),now:new Date().toISOString()});}
function syncSummary(p){const i=projects.findIndex(x=>x.id===p.id);if(i<0)projects.unshift(p);else projects[i]=p;}
async function load(){
 if(loadingLibrary)return;loadingLibrary=true;
 $('#signin-link').hidden=true;$('#retry-connection').hidden=true;
 $('#connection-label').textContent='로그인 상태 확인 중…';
 try{
  projects=(await api('projects')).projects;connected=true;
  $('#storage-error').hidden=true;$('#connection-label').textContent='로그인됨 · 계정에 저장됩니다';
 }catch(error){
  connected=false;const needsLogin=error.status===401;
  $('#storage-error').textContent=needsLogin?'로그인하면 저장된 기획을 불러올 수 있습니다.':error.message;
  $('#storage-error').hidden=false;
  $('#connection-label').textContent=needsLogin?'로그인이 필요합니다':'서버 연결을 확인해 주세요';
  $('#signin-link').hidden=!needsLogin&&!!error.status;
  $('#retry-connection').hidden=false;
 }finally{loadingLibrary=false;render();}
}
async function openWorkspace(projectId){
 clearTimeout(timer);selectedId=projectId;detail=null;render();
 try{detail=await api('projects/'+projectId);syncSummary(detail.project);render();$('#workspace-title').focus();schedulePoll();}
 catch(error){toast(error.message);selectedId=null;render();}
}
function schedulePoll(){
 clearTimeout(timer);if(!detail?.job||!['submitting','running','processing'].includes(detail.job.status))return;
 const projectId=selectedId,jobId=detail.job.id;
 timer=setTimeout(async()=>{
  try{
   const {job}=await api('jobs/'+jobId);
   if(selectedId!==projectId)return;
   if(!['submitting','running','processing'].includes(job.status)){
    detail=await api('projects/'+projectId);syncSummary(detail.project);render();if(job.error)toast(job.error);
   }else{detail.job=job;schedulePoll();}
  }catch(error){if(selectedId===projectId){$('#job-status').textContent='연결을 다시 확인하고 있습니다. 요청은 중복 전송하지 않습니다.';timer=setTimeout(schedulePoll,6000);}}
 },2500);
}
async function act(action,payload={}){
 if(busy||!detail)return;busy=true;render();
 try{
  const result=await api('projects/'+selectedId+'/'+action,{revision:detail.project.revision,...payload});
  detail=result.project?result:await api('projects/'+selectedId);syncSummary(detail.project);
  if(result.job?.error)toast(result.job.error);
 }catch(error){toast(error.message);try{detail=await api('projects/'+selectedId);syncSummary(detail.project);}catch{}}
 finally{busy=false;render();schedulePoll();}
}
function render(){
 $('#new-project').disabled=!connected||busy;$('#import-project').disabled=!connected||busy;$('#empty-create').disabled=!connected||busy;$('#sample-project').disabled=!connected||busy;
 const visible=projects.filter(p=>showArchived?p.status==='archived':p.status!=='archived'),q=$('#search').value.trim().toLowerCase(),filtered=visible.filter(p=>(p.title+' '+activeInput(p)).toLowerCase().includes(q));
 $('#project-grid').replaceChildren();
 for(const p of filtered){
  const card=button('',()=>openWorkspace(p.id),'project-card');card.setAttribute('aria-label',p.title+' 프로젝트 열기');
  const art=el('div','project-cover');art.append(el('span','',p.inputMode==='idea'?'IDEA':'DRAFT'),el('b','','✳'));
  const content=el('div','card-content'),meta=el('div','card-meta');meta.append(el('span','','YOUR NEXT STORY'),el('span','status-pill',labels[p.stage]??'기획 대화'));
  const bottom=el('div','card-bottom');bottom.append(el('span','',new Date(p.updatedAt).toLocaleDateString('ko-KR')),el('span','','이어서 만들기 ↗'));
  content.append(meta,el('h2','',p.displayTitle??p.title),el('p','card-concept',activeInput(p)),bottom);card.append(art,content);$('#project-grid').append(card);
 }
 $('#project-count').textContent=String(visible.length).padStart(2,'0');$('#empty-state').hidden=visible.length>0;$('#no-results').hidden=!visible.length||!!filtered.length;
 const pending=localProjects.filter(p=>!projects.some(x=>x.id===p.id));$('#migrate-local').hidden=!connected||!pending.length;$('#migrate-local').textContent='이 브라우저의 기존 기획 '+pending.length+'개 가져오기 ↗';
 $('#project-library').hidden=!!selectedId;$('#project-workspace').hidden=!selectedId;if(!selectedId)return;
 $('#workspace-title').textContent=detail?.project.displayTitle??detail?.project.title??'불러오는 중…';if(!detail)return;
 const p=detail.project,w=detail.workflow,working=!!w.activeJob;
 $('#restore-project').hidden=p.status!=='archived';$('#workspace-mode').textContent=labels[w.stage];$('#workspace-input-label').textContent=p.inputMode==='idea'?'나의 아이디어':'준비한 기획';$('#workspace-input').textContent=activeInput(p);
 $('#workspace-feedback').hidden=!p.planningFeedback||p.inputMode!=='drafting';$('#workspace-feedback-text').textContent=p.planningFeedback;$('#edit-project').disabled=busy||working;
 document.querySelectorAll('.production-steps li').forEach((li,i)=>{const step=w.stage==='interview'?0:w.stage==='complete'?3:detail.assets.some(a=>a.versions.length)?2:1;li.classList.toggle('current',i===step);if(i===step)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
 $('#job-status').hidden=!working;$('#job-status').textContent=detail.job?.kind==='image'?'이미지를 만들고 있습니다. 다른 화면으로 이동해도 접수된 작업은 유지됩니다.':'GPT가 기획을 읽고 있습니다…';
 $('#workflow-error').hidden=!w.lastError;$('#workflow-error').textContent=w.lastError??'';
 $('#conversation-area').hidden=w.stage!=='interview';$('#asset-area').hidden=w.stage==='interview';
 $('#budget-note').textContent='프로젝트 $'+(detail.budget.usedMicro/1e6).toFixed(3)+' / $'+(detail.budget.projectMicro/1e6).toFixed(0)+' · 이번 달 $'+(detail.budget.monthlyUsedMicro/1e6).toFixed(3)+' / $200 (사용량 추정 및 진행 중 예약 포함)';
 if(w.stage==='interview')renderConversation(working);else renderAssets(working);
}
function renderConversation(working){
 const w=detail.workflow,log=$('#chat-log');log.replaceChildren();
 if(!w.messages.length)log.append(el('p','chat-intro','짧은 아이디어만 있어도 괜찮아요. GPT가 읽고 필요한 부분부터 함께 정리합니다.'));
 for(const m of w.messages){const article=el('article','chat-message '+m.role);article.append(el('small','',m.role==='user'?'나':'GPT'),el('p','',m.text));if(m.questions?.length){const list=el('ol');for(const q of m.questions)list.append(el('li','',q));article.append(list);}log.append(article);}
 $('#start-conversation').hidden=w.messages.length>0;$('#start-conversation').disabled=busy||working;
 $('#chat-form').hidden=!w.messages.length;$('#chat-answer').value=chatDrafts.get(selectedId)??'';$('#chat-answer').disabled=busy||working;$('#send-answer').disabled=busy||working;
 const panel=$('#draft-preview');panel.replaceChildren();panel.hidden=!w.draft;
 if(w.draft){
  const d=w.draft;panel.append(el('p','eyebrow','CREATIVE PLAN'),el('h2','',d.title),el('p','draft-logline',d.logline),el('p','',d.synopsis),el('p','draft-meta',d.genre+' · '+d.durationSeconds+'초 · '+d.aspectRatio),el('h3','','시각 스타일'),el('p','',d.visualStyle));
  for(const [name,items] of [['캐릭터',d.characters],['장소',d.locations],['소품',d.props]]){if(!items.length)continue;panel.append(el('h3','',name));for(const item of items)panel.append(el('p','',item.name+' — '+item.description));}
  panel.append(el('h3','','장면 구성'));const list=el('ol','shot-list');for(const s of d.shots){const li=el('li');li.append(el('b','',s.title+' · '+s.seconds+'초'),el('p','',s.description),el('small','',s.camera));list.append(li);}panel.append(list);
  const confirm=button('이 기획 확정하고 이미지 만들기 ↗',()=>act('confirm-plan'),'button button-red');confirm.disabled=busy||working||!w.readyForReview;panel.append(confirm);
  if(!w.readyForReview)panel.append(el('p','muted','질문에 답한 뒤 기획을 확정할 수 있습니다.'));
 }
}
function stale(version){return version?.refs.some(r=>detail.assets.find(a=>a.id===r.assetId)?.selectedVersion!==r.versionId);}
function viewImage(version,label){
 $('#large-image').src=version.url;$('#large-image').alt=label;$('#image-caption').textContent=label;$('#image-dialog').showModal();
}
function renderAssets(working){
 const confirmed=$('#confirmed-plan-content');confirmed.replaceChildren();const draft=detail.workflow.draft;confirmed.append(el('h3','',draft.title),el('p','',draft.synopsis),el('p','',draft.visualStyle));for(const shot of draft.shots)confirmed.append(el('p','',shot.title+' · '+shot.seconds+'초 — '+shot.description));const list=$('#asset-grid');list.replaceChildren();$('#estimate-ack').checked=estimateAccepted;
 const bases=detail.assets.filter(a=>a.kind!=='keyframe'),frames=detail.assets.filter(a=>a.kind==='keyframe');
 for(const [name,items] of [['캐릭터·장소·소품',bases],['장면 이미지',frames]]){
  if(!items.length)continue;list.append(el('h2','asset-group-title',name));
  for(const a of items){
   const card=el('article','asset-card'),selected=a.versions.find(v=>v.id===a.selectedVersion),refsReady=a.refs.every(r=>detail.assets.find(x=>x.id===r)?.selectedVersion);
   const heading=el('div','asset-heading');heading.append(el('span','eyebrow',kinds[a.kind]),el('span','status-pill',a.finalVersion?'확정':selected?stale(selected)?'참조 변경됨':'선택됨':'검토 필요'));card.append(heading,el('h3','',a.label));
   if(!a.versions.length){const blank=el('div','asset-empty',refsReady?'아직 생성된 이미지가 없어요.':'먼저 참조 이미지를 만들고 선택해 주세요.');card.append(blank);}
   else {
    const versions=el('div','asset-versions');
    for(const [i,v] of a.versions.entries()){
     const tile=el('div','version-tile'+(v.id===a.selectedVersion?' selected':''));
     const imageButton=button('',()=>viewImage(v,a.label+' · 버전 '+(i+1)),'image-preview');imageButton.disabled=false;imageButton.setAttribute('aria-label',a.label+' 버전 '+(i+1)+' 크게 보기');const img=el('img');img.src=v.url;img.alt=a.label+' · 버전 '+(i+1);img.loading='lazy';imageButton.append(img);
     const choose=button(v.id===a.selectedVersion?'✓ 버전 '+(i+1)+' 선택됨':'버전 '+(i+1)+' 선택',()=>act('select',{assetId:a.id,versionId:v.id}),'choose-version');choose.disabled=busy||working;
     tile.append(imageButton,choose);if(stale(v))tile.append(el('small','stale-note','현재 참조와 다른 버전'));versions.append(tile);
    }card.append(versions);
   }
   const label=el('label','asset-feedback','수정하고 싶은 부분');const input=el('textarea');input.rows=2;input.maxLength=3000;input.placeholder='예: 표정만 조금 더 밝게';input.value=feedbacks.get(a.id)??'';input.disabled=busy||working;input.addEventListener('input',()=>feedbacks.set(a.id,input.value));label.append(input);card.append(label);
   const generate=button(selected&&!stale(selected)?'선택한 이미지 수정':'이미지 만들기',()=>act('generate',{assetId:a.id,feedback:feedbacks.get(a.id)??'',parentVersion:selected&&!stale(selected)?selected.id:null,acknowledgeEstimate:estimateAccepted,requestId:crypto.randomUUID()}),'button button-edit');generate.disabled=busy||working||!estimateAccepted||!refsReady;card.append(generate);
   if(selected&&!stale(selected)){const anew=button('새 버전 생성',()=>act('generate',{assetId:a.id,feedback:feedbacks.get(a.id)??'',acknowledgeEstimate:estimateAccepted,requestId:crypto.randomUUID()}),'subtle-button');anew.disabled=generate.disabled;card.append(anew);}
   list.append(card);
  }
 }
 const ready=detail.assets.length&&detail.assets.every(a=>{const v=a.versions.find(x=>x.id===a.selectedVersion);return v&&!stale(v);});
 document.querySelector('.asset-actions').dataset.ready=String(!!ready);$('#confirm-assets').hidden=detail.workflow.stage==='complete';$('#confirm-assets').disabled=busy||working||!ready;$('#download-zip').hidden=detail.workflow.stage!=='complete';$('#download-zip').disabled=busy||working;
 const selectedCount=detail.assets.filter(a=>a.selectedVersion).length;$('#asset-progress').textContent=selectedCount+' / '+detail.assets.length+'개 선택 · 마음에 드는 버전을 모두 선택한 뒤 최종 확정하세요.';
}
function download(blob,name){const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function filename(value){return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,70)||'project';}
async function checksum(data){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function downloadZip(){
 if(busy)return;busy=true;render();$('#download-progress').hidden=false;$('#download-progress').textContent='확정 파일을 검증하고 있습니다…';
 try{
  const pack=await api('projects/'+selectedId+'/export',{revision:detail.project.revision}),entries=[],prefix=filename(detail.workflow.draft.title)+'/';
  for(const doc of pack.documents){const data=new TextEncoder().encode(doc.content);if(data.length!==doc.bytes||await checksum(data)!==doc.sha256)throw new Error('기획 문서 검증에 실패했습니다.');entries.push({path:prefix+doc.path,data});}
  let count=0;
  for(const img of pack.images){
   $('#download-progress').textContent='이미지 '+(++count)+' / '+pack.images.length+'개 정리 중…';
   const r=await fetch(img.url);if(!r.ok)throw new Error('이미지 다운로드에 실패했습니다. 다시 시도해 주세요.');const data=new Uint8Array(await r.arrayBuffer());
   if(data.length!==img.bytes||await checksum(data)!==img.sha256)throw new Error('이미지 검증에 실패했습니다. 불완전한 ZIP은 저장하지 않았습니다.');entries.push({path:prefix+img.path,data});
  }
  download(makeZip(entries),filename(detail.workflow.draft.title)+'_assets.zip');$('#download-progress').textContent='폴더별로 정리한 ZIP 다운로드를 시작했습니다.';
 }catch(error){$('#download-progress').textContent=error.message;}
 finally{busy=false;render();}
}
$('#show-archived').addEventListener('change',e=>{showArchived=e.target.checked;render();});$('#restore-project').addEventListener('click',()=>act('archive',{restore:true}));$('#search').addEventListener('input',render);$('#new-project').addEventListener('click',()=>openProject());$('#empty-create').addEventListener('click',()=>openProject());$('#edit-project').addEventListener('click',()=>openProject(detail.project));
$('#back-projects').addEventListener('click',()=>{clearTimeout(timer);selectedId=null;detail=null;render();});$('#close-dialog').addEventListener('click',()=>dialog.close());form.querySelectorAll('[name="inputMode"]').forEach(n=>n.addEventListener('change',updateMode));
form.addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;$('#form-error').hidden=true;
 try{
  const input=buildFromForm(),old=projects.find(p=>p.id===editingId);busy=true;$('#save-project').disabled=true;
  const result=editingId?await api('projects/'+editingId,{project:input,revision:old.revision},'PATCH'):await api('projects',{project:input});
  detail=result;selectedId=result.project.id;syncSummary(result.project);dialog.close();busy=false;render();
  await act('interview',{answer:'',requestId:crypto.randomUUID()});
 }catch(error){$('#form-error').textContent=error.message;$('#form-error').hidden=false;}
 finally{busy=false;$('#save-project').disabled=false;render();}
});
$('#sample-project').addEventListener('click',()=>{openProject();field('ideaInput').value='60초 신스팝 뮤직비디오. 네온 도시에서 외로움이 해방감으로 바뀌는 느낌. 16:9, 대사 없이.';});
$('#start-conversation').addEventListener('click',()=>act('interview',{answer:'',requestId:crypto.randomUUID()}));
$('#chat-answer').addEventListener('input',e=>chatDrafts.set(selectedId,e.target.value));
$('#chat-form').addEventListener('submit',async e=>{e.preventDefault();const answer=$('#chat-answer').value.trim();if(!answer)return;const before=detail.workflow.messages.length;await act('interview',{answer,requestId:crypto.randomUUID()});if(detail.workflow.activeJob||detail.workflow.messages.length>before){chatDrafts.delete(selectedId);$('#chat-answer').value='';}});
$('#estimate-ack').addEventListener('change',e=>{estimateAccepted=e.target.checked;render();});$('#confirm-assets').addEventListener('click',()=>act('confirm-assets'));$('#download-zip').addEventListener('click',downloadZip);$('#close-image').addEventListener('click',()=>$('#image-dialog').close());
$('#export-project').addEventListener('click',()=>{try{const p=buildFromForm();download(new Blob([exportProject(p)],{type:'application/json'}),filename(p.title)+'_input.json');}catch(error){$('#form-error').textContent=error.message;$('#form-error').hidden=false;}});
$('#import-project').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1000000)throw new Error('기획 파일은 1MB 이하여야 합니다.');const p={...importProject(await file.text()),id:crypto.randomUUID(),updatedAt:new Date().toISOString()};const r=await api('projects',{project:p});syncSummary(r.project);await openWorkspace(r.project.id);}catch(error){toast(error.message);}finally{e.target.value='';}});
$('#migrate-local').addEventListener('click',async()=>{if(busy)return;busy=true;try{for(const p of localProjects.filter(x=>!projects.some(y=>y.id===x.id))){const r=await api('projects',{project:p});syncSummary(r.project);}toast('기존 기획을 가져왔습니다. 브라우저 원본도 보존했습니다.');}catch(error){toast(error.message);}finally{busy=false;render();}});
$('#delete-project').addEventListener('click',()=>$('#delete-dialog').showModal());$('#cancel-delete').addEventListener('click',()=>$('#delete-dialog').close());
$('#confirm-delete').addEventListener('click',async()=>{await act('archive');$('#delete-dialog').close();dialog.close();selectedId=null;render();});
try{localProjects=parseLibrary(localStorage.getItem(STORAGE_KEY));}catch{toast('기존 브라우저 기획을 읽지 못했습니다. 원본 데이터는 그대로 보존했습니다.');}
$('#retry-connection').addEventListener('click',load);
addEventListener('pageshow',event=>{if(event.persisted)load();});
render();
load();
