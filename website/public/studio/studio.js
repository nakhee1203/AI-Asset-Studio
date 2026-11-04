import {STORAGE_KEY,STATUSES,projectFromInput,activeInput,parseLibrary,exportProject,importProject} from './model.js';
import {makeZip} from './zip.mjs';
const $=s=>document.querySelector(s),dialog=$('#project-dialog'),form=$('#project-form');
let projects=[],localProjects=[],editingId=null,selectedId=null,detail=null,busy=false,connected=false,loadingLibrary=false,timer,toastTimer,estimateAccepted=false,showArchived=false,editingDraft=false,draftEdits=null,queue=[],queueTotal=0;
const feedbacks=new Map(),chatDrafts=new Map(),promptEdits=new Map(),promptOpen=new Set();
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
 const imageCount=p&&detail?detail.assets.reduce((n,a)=>n+a.versions.length,0):0;
 $('#edit-warning').textContent=imageCount?'입력을 바꾸면 새 기획 대화를 시작합니다. 지금 있는 이미지 '+imageCount+'장은 이 화면에서 사라집니다. 서버에는 남지만 아직 되돌리는 기능이 없습니다.':'입력을 바꾸면 새 기획 대화를 시작합니다. 이전 확정본은 서버에 보존됩니다.';
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
 clearTimeout(timer);selectedId=projectId;detail=null;editingDraft=false;draftEdits=null;queue=[];queueTotal=0;render();
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
    detail=await api('projects/'+projectId);syncSummary(detail.project);render();
    if(job.error){toast(job.error);if(queue.length){queue=[];queueTotal=0;toast('오류가 나서 일괄 생성을 멈췄습니다.');render();}}
    else if(queue.length)continueQueue();
   }else{detail.job=job;schedulePoll();}
  }catch(error){if(selectedId===projectId){$('#job-status').textContent='연결을 다시 확인하고 있습니다. 요청은 중복 전송하지 않습니다.';timer=setTimeout(schedulePoll,6000);}}
 },2500);
}
async function act(action,payload={}){
 if(busy||!detail)return null;busy=true;render();let result=null;
 try{
  result=await api('projects/'+selectedId+'/'+action,{revision:detail.project.revision,...payload});
  detail=result.project?result:await api('projects/'+selectedId);syncSummary(detail.project);
  if(result.job?.error)toast(result.job.error);
 }catch(error){result=null;toast(error.message);try{detail=await api('projects/'+selectedId);syncSummary(detail.project);}catch{}}
 finally{busy=false;render();schedulePoll();}
 return result;
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
 $('#queue-status').hidden=!queue.length;$('#queue-text').textContent='일괄 생성 중 · '+(queueTotal-queue.length)+' / '+queueTotal+'장 접수. 남은 '+queue.length+'장은 현재 작업이 끝나면 이어서 요청합니다. 이 화면을 닫으면 멈춥니다.';
 $('#workflow-error').hidden=!w.lastError;$('#workflow-error').textContent=w.lastError??'';
 $('#conversation-area').hidden=w.stage!=='interview';$('#asset-area').hidden=w.stage==='interview';
 $('#budget-note').textContent='프로젝트 $'+(detail.budget.usedMicro/1e6).toFixed(2)+' / $'+(detail.budget.projectMicro/1e6).toFixed(0)+' · 이번 달 $'+(detail.budget.monthlyUsedMicro/1e6).toFixed(2)+' / $200 (사용량 추정 및 진행 중 예약 포함)';
 if(w.stage==='interview')renderConversation(working);else renderAssets(working);
}
function renderConversation(working){
 const w=detail.workflow,log=$('#chat-log');log.replaceChildren();
 if(!w.messages.length)log.append(el('p','chat-intro','짧은 아이디어만 있어도 괜찮아요. GPT가 읽고 필요한 부분부터 함께 정리합니다.'));
 for(const m of w.messages){
  const article=el('article','chat-message '+m.role);article.append(el('small','',m.role==='user'?'나':'GPT'),el('p','',m.text));
  if(m.questions?.length){const list=el('ol');for(const q of m.questions)list.append(el('li','',q));article.append(list);}
  if(m.changes?.length){const box=el('div','chat-changes');box.append(el('b','','바뀐 내용'));const list=el('ul');for(const c of m.changes)list.append(el('li','',c));box.append(list);article.append(box);}
  log.append(article);
 }
 log.scrollTop=log.scrollHeight;
 $('#start-conversation').hidden=w.messages.length>0;$('#start-conversation').disabled=busy||working;
 $('#chat-form').hidden=!w.messages.length;$('#chat-answer').value=chatDrafts.get(selectedId)??'';$('#chat-answer').disabled=busy||working;$('#send-answer').disabled=busy||working;
 const panel=$('#draft-preview');panel.replaceChildren();panel.hidden=!w.draft;
 if(!w.draft)return;
 if(editingDraft){renderDraftForm(panel,draftEdits??w.draft,working);return;}
 const d=w.draft,head=el('div','draft-head');head.append(el('p','eyebrow','CREATIVE PLAN'));
 const edit=button('직접 수정',()=>{editingDraft=true;draftEdits=null;render();},'subtle-button');edit.disabled=busy||working;head.append(edit);
 panel.append(head,el('h2','',d.title),el('p','draft-logline',d.logline),el('p','',d.synopsis),el('p','draft-meta',d.genre+' · '+d.durationSeconds+'초 · '+d.aspectRatio),el('h3','','시각 스타일'),el('p','',d.visualStyle));
 if(d.stylePrompt)panel.append(el('p','prompt-line',d.stylePrompt));
 for(const [name,items] of [['캐릭터',d.characters??[]],['장소',d.locations??[]],['소품',d.props??[]]]){if(!items.length)continue;panel.append(el('h3','',name));for(const item of items){panel.append(el('p','',item.name+' — '+item.description));if(item.visualPrompt)panel.append(el('p','prompt-line',item.visualPrompt));}}
 panel.append(el('h3','','장면 구성'));const list=el('ol','shot-list');
 for(const s of d.shots??[]){const li=el('li');li.append(el('b','',s.title+' · '+s.seconds+'초'),el('p','',s.description),el('small','',s.camera));if(s.prompt)li.append(el('p','prompt-line','FRAME · '+s.prompt));if(s.motion)li.append(el('p','prompt-line','MOTION · '+s.motion));list.append(li);}
 panel.append(list);
 if(w.draftWarning)panel.append(el('p','flow-alert error','확정 전에 고칠 것: '+w.draftWarning+' 대화로 고쳐 달라고 하거나 직접 수정하세요.'));
 const confirm=button('이 기획 확정하고 이미지 만들기 ↗',()=>act('confirm-plan'),'button button-red');confirm.disabled=busy||working||!w.readyForReview;panel.append(confirm);
 if(!w.readyForReview&&!w.draftWarning)panel.append(el('p','muted','질문에 답한 뒤 기획을 확정할 수 있습니다.'));
}
function draftField(label,value,name,{rows=0,type='text'}={}){const wrap=el('label','draft-field');wrap.append(el('span','',label));const node=rows?el('textarea'):el('input');if(rows)node.rows=rows;else node.type=type;node.value=value??'';node.dataset.name=name;wrap.append(node);return wrap;}
function renderDraftForm(panel,d,working){
 const form=el('form','draft-form');
 form.append(el('p','eyebrow','기획 직접 수정'),el('p','muted','글만 고칠 수 있습니다. 인물·장소·쇼트를 더하거나 빼려면 대화로 요청하세요. 쇼트 길이의 합은 작품 길이와 같아야 합니다.'));
 const top=el('div','draft-grid');top.append(draftField('작품명',d.title,'title'),draftField('장르',d.genre,'genre'),draftField('길이(초)',d.durationSeconds,'durationSeconds',{type:'number'}));
 const ratio=el('label','draft-field');ratio.append(el('span','','화면비'));const select=el('select');select.dataset.name='aspectRatio';for(const r of ['16:9','9:16','1:1','2.39:1']){const o=el('option','',r);o.value=r;o.selected=r===d.aspectRatio;select.append(o);}ratio.append(select);top.append(ratio);form.append(top);
 form.append(draftField('로그라인',d.logline,'logline',{rows:2}),draftField('시놉시스',d.synopsis,'synopsis',{rows:4}),draftField('시각 스타일 (한국어)',d.visualStyle,'visualStyle',{rows:2}),draftField('스타일 프롬프트 (영어, 모델용)',d.stylePrompt,'stylePrompt',{rows:2}));
 for(const [label,key] of [['캐릭터','characters'],['장소','locations'],['소품','props']]){const items=d[key]??[];if(!items.length)continue;form.append(el('h3','',label));items.forEach((item,i)=>{const box=el('div','draft-entity');box.append(draftField('이름',item.name,key+'.'+i+'.name'),draftField('설정 (한국어)',item.description,key+'.'+i+'.description',{rows:3}),draftField('외형 프롬프트 (영어, 모델용)',item.visualPrompt,key+'.'+i+'.visualPrompt',{rows:3}));form.append(box);});}
 form.append(el('h3','','장면 구성'));
 (d.shots??[]).forEach((s,i)=>{const box=el('div','draft-entity');box.append(el('b','',s.id),draftField('제목',s.title,'shots.'+i+'.title'),draftField('길이(초)',s.seconds,'shots.'+i+'.seconds',{type:'number'}),draftField('장면 (한국어)',s.description,'shots.'+i+'.description',{rows:2}),draftField('카메라',s.camera,'shots.'+i+'.camera'),draftField('정지 화면 프롬프트 (영어)',s.prompt,'shots.'+i+'.prompt',{rows:3}),draftField('움직임 프롬프트 (영어)',s.motion,'shots.'+i+'.motion',{rows:3}));form.append(box);});
 const actions=el('div','draft-form-actions');const cancel=button('취소',()=>{editingDraft=false;draftEdits=null;render();},'subtle-button');const save=button('수정 저장',()=>{},'button button-red');save.type='submit';save.disabled=busy||working;actions.append(cancel,save);form.append(actions);
 const collect=()=>{const next=structuredClone(d);for(const node of form.querySelectorAll('[data-name]')){const path=node.dataset.name.split('.');let target=next;for(const k of path.slice(0,-1))target=target[k];target[path.at(-1)]=node.type==='number'?Number(node.value):node.value;}return next;};
 form.addEventListener('input',()=>{draftEdits=collect();});
 form.addEventListener('submit',async e=>{e.preventDefault();const next=collect();const ok=await act('edit-draft',{draft:next});if(ok){editingDraft=false;draftEdits=null;}else{editingDraft=true;draftEdits=next;}render();});
 panel.append(form);
}
function stale(version){return version?.refs.some(r=>detail.assets.find(a=>a.id===r.assetId)?.selectedVersion!==r.versionId);}
function viewImage(version,label){
 $('#large-image').src=version.url;$('#large-image').alt=label;$('#image-caption').textContent=label;
 $('#image-prompt').textContent='요청한 프롬프트\n'+version.prompt+(version.revisedPrompt?'\n\n모델에 실제로 전달된 프롬프트\n'+version.revisedPrompt:'');
 $('#image-dialog').showModal();
}
function renderAssets(working){
 const confirmed=$('#confirmed-plan-content');confirmed.replaceChildren();const draft=detail.workflow.draft;confirmed.append(el('h3','',draft.title),el('p','',draft.synopsis),el('p','',draft.visualStyle));for(const shot of draft.shots)confirmed.append(el('p','',shot.title+' · '+shot.seconds+'초 — '+shot.description));
 const list=$('#asset-grid');list.replaceChildren();$('#estimate-ack').checked=estimateAccepted;
 const canGenerate=!busy&&!working&&estimateAccepted;
 const refsReady=a=>a.refs.every(r=>{const x=detail.assets.find(y=>y.id===r);return x&&!x.excluded&&x.selectedVersion;});
 const bases=detail.assets.filter(a=>a.kind!=='keyframe'),frames=detail.assets.filter(a=>a.kind==='keyframe');
 for(const [name,items,word] of [['캐릭터·장소·소품',bases,'기준 이미지'],['장면 이미지',frames,'장면 이미지']]){
  if(!items.length)continue;
  const head=el('div','asset-group-head');head.append(el('h2','asset-group-title',name));
  const pending=items.filter(a=>!a.excluded&&!a.versions.length&&refsReady(a));
  if(pending.length>1){const batch=button('아직 없는 '+word+' '+pending.length+'장 차례로 만들기',()=>startQueue(pending.map(a=>a.id)),'button button-edit');batch.disabled=!canGenerate||queue.length>0;head.append(batch);}
  list.append(head);
  for(const a of items){
   const card=el('article','asset-card'+(a.excluded?' excluded':'')),selected=a.versions.find(v=>v.id===a.selectedVersion),ready=refsReady(a);
   const heading=el('div','asset-heading');heading.append(el('span','eyebrow',kinds[a.kind]),el('span','status-pill',a.excluded?'제외됨':a.finalVersion?'확정':selected?stale(selected)?'참조 변경됨':'선택됨':'검토 필요'));card.append(heading,el('h3','',a.label));
   if(a.excluded){card.append(el('p','muted','이 에셋은 생성·확정·ZIP에서 빠집니다.'));const include=button('다시 포함',()=>act('exclude',{assetId:a.id,excluded:false}),'subtle-button');include.disabled=busy||working;card.append(include);list.append(card);continue;}
   if(!a.versions.length)card.append(el('div','asset-empty',ready?'아직 생성된 이미지가 없어요.':'먼저 참조 이미지를 만들고 선택해 주세요.'));
   else{
    const versions=el('div','asset-versions');
    for(const [i,v] of a.versions.entries()){
     const tile=el('div','version-tile'+(v.id===a.selectedVersion?' selected':''));
     const imageButton=button('',()=>viewImage(v,a.label+' · 버전 '+(i+1)),'image-preview');imageButton.disabled=false;imageButton.setAttribute('aria-label',a.label+' 버전 '+(i+1)+' 크게 보기');const img=el('img');img.src=v.url;img.alt=a.label+' · 버전 '+(i+1);img.loading='lazy';imageButton.append(img);
     const choose=button(v.id===a.selectedVersion?'✓ 버전 '+(i+1)+' 선택됨':'버전 '+(i+1)+' 선택',()=>act('select',{assetId:a.id,versionId:v.id}),'choose-version');choose.disabled=busy||working;
     tile.append(imageButton,choose);if(stale(v))tile.append(el('small','stale-note','현재 참조와 다른 버전'));versions.append(tile);
    }
    card.append(versions);
   }
   const details=el('details','prompt-details');details.open=promptOpen.has(a.id);details.addEventListener('toggle',()=>{if(details.open)promptOpen.add(a.id);else promptOpen.delete(a.id);});
   details.append(el('summary','','이 에셋의 프롬프트 보기·수정'));
   const promptInput=el('textarea');promptInput.rows=7;promptInput.maxLength=6000;promptInput.value=promptEdits.get(a.id)??a.prompt;promptInput.disabled=busy||working;promptInput.addEventListener('input',()=>promptEdits.set(a.id,promptInput.value));
   const savePrompt=button('프롬프트 저장',async()=>{if(await act('edit-prompt',{assetId:a.id,prompt:promptEdits.get(a.id)??a.prompt}))promptEdits.delete(a.id);render();},'subtle-button');savePrompt.disabled=busy||working||!promptEdits.has(a.id)||promptEdits.get(a.id)===a.prompt;
   details.append(promptInput,savePrompt);card.append(details);
   const editable=!!selected&&!stale(selected);
   const label=el('label','asset-feedback',editable?'바꾸고 싶은 부분 (수정에 필수)':'추가로 반영할 방향 (선택)');const input=el('textarea');input.rows=2;input.maxLength=3000;input.placeholder='예: 표정만 조금 더 밝게';input.value=feedbacks.get(a.id)??'';input.disabled=busy||working;input.addEventListener('input',()=>feedbacks.set(a.id,input.value));label.append(input);card.append(label);
   const generate=button(editable?'선택한 이미지 수정':'이미지 만들기',()=>submitGenerate(a,editable?selected.id:null),'button button-edit');generate.disabled=!canGenerate||!ready;card.append(generate);
   if(editable){const anew=button('새 버전 생성',()=>submitGenerate(a,null),'subtle-button');anew.disabled=generate.disabled;card.append(anew);}
   if(!estimateAccepted)card.append(el('p','hint','위의 비용 확인에 체크하면 생성할 수 있습니다.'));
   const exclude=button('이 에셋 제외',()=>act('exclude',{assetId:a.id,excluded:true}),'link-button');exclude.disabled=busy||working;card.append(exclude);
   list.append(card);
  }
 }
 const active=detail.assets.filter(a=>!a.excluded);
 const ready=active.length>0&&active.every(a=>{const v=a.versions.find(x=>x.id===a.selectedVersion);return v&&!stale(v);});
 document.querySelector('.asset-actions').dataset.ready=String(ready);$('#confirm-assets').hidden=detail.workflow.stage==='complete';$('#confirm-assets').disabled=busy||working||!ready;$('#download-zip').hidden=detail.workflow.stage!=='complete';$('#download-zip').disabled=busy||working;
 const selectedCount=active.filter(a=>a.selectedVersion).length,excludedCount=detail.assets.length-active.length;
 $('#asset-progress').textContent=selectedCount+' / '+active.length+'개 선택'+(excludedCount?' · '+excludedCount+'개 제외':'')+' · 마음에 드는 버전을 모두 선택한 뒤 최종 확정하세요.';
}
async function submitGenerate(a,parentVersion){
 const feedback=feedbacks.get(a.id)??'';
 if(parentVersion&&!feedback.trim()){toast('선택한 이미지를 수정하려면 바꾸고 싶은 부분을 적어 주세요.');return null;}
 const result=await act('generate',{assetId:a.id,feedback,parentVersion,acknowledgeEstimate:estimateAccepted,requestId:crypto.randomUUID()});
 if(result&&!result.job?.error){feedbacks.delete(a.id);render();}
 return result;
}
// 일괄 생성은 브라우저가 순서를 들고 있다. 서버는 프로젝트당 작업 하나만 받으므로 앞 작업이 끝날 때마다 다음 장을 요청한다.
// 화면을 닫으면 남은 순서만 멈추고, 접수된 작업과 비용 기록은 서버에 그대로 남는다.
function startQueue(ids){
 if(!ids.length||!detail)return;
 const each=detail.budget.imageEstimateMicro/1e6;
 if(!confirm(ids.length+'장을 차례로 생성합니다. 요청당 $'+each.toFixed(0)+' 예약, 합계 약 $'+(each*ids.length).toFixed(0)+'. 실제 비용의 상한은 아닙니다. 이 화면을 닫으면 남은 순서는 멈춥니다. 계속할까요?'))return;
 queue=ids.slice();queueTotal=ids.length;continueQueue();
}
async function continueQueue(){
 if(!queue.length||busy||!detail||detail.workflow.activeJob)return;
 const a=detail.assets.find(x=>x.id===queue.shift());
 if(!a||a.excluded||a.versions.length){continueQueue();return;}
 const result=await submitGenerate(a,null);
 if(!result||result.job?.error){queue=[];queueTotal=0;toast('일괄 생성을 멈췄습니다.');render();}
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
$('#back-projects').addEventListener('click',()=>{clearTimeout(timer);selectedId=null;detail=null;queue=[];queueTotal=0;editingDraft=false;draftEdits=null;render();});$('#close-dialog').addEventListener('click',()=>dialog.close());form.querySelectorAll('[name="inputMode"]').forEach(n=>n.addEventListener('change',updateMode));
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
$('#estimate-ack').addEventListener('change',e=>{estimateAccepted=e.target.checked;render();});$('#queue-cancel').addEventListener('click',()=>{queue=[];queueTotal=0;render();});$('#confirm-assets').addEventListener('click',()=>act('confirm-assets'));$('#download-zip').addEventListener('click',downloadZip);$('#close-image').addEventListener('click',()=>$('#image-dialog').close());
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
