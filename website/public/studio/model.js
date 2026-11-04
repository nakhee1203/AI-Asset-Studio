export const STORAGE_KEY='ai-asset-studio.projects.v1';
export const ASPECT_RATIOS=['16:9','9:16','1:1','2.39:1'];
export const STATUSES={idea:'아이디어만 있음',drafting:'기획 정리 중',archived:'보관'};
export const INPUT_MODES=['idea','drafting'];
function text(value,label,max,required=false){if(typeof value!=='string'||value.length>max)throw new Error(label+' 형식을 확인해 주세요.');const result=value.trim();if(required&&!result)throw new Error(label+'을 입력해 주세요.');return result;}
function timestamp(value){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error('저장 시각이 올바르지 않습니다.');return new Date(value).toISOString();}
function legacyPlan(value){
 return [['작품명',value.title],['이야기',value.concept],['장르',value.genre],['길이',value.durationSeconds==null?'':value.durationSeconds+'초'],['화면비',value.aspectRatio],['시각 스타일',value.visualStyle],['캐릭터',value.characters],['장면',value.sceneNotes]].filter(([,content])=>content).map(([label,content])=>label+'\n'+content).join('\n\n');
}
export function validateProject(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('프로젝트 형식이 올바르지 않습니다.');
 const id=text(value.id,'프로젝트 ID',100,true);
 if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('프로젝트 ID가 올바르지 않습니다.');
 if(value.aspectRatio!==null&&!ASPECT_RATIOS.includes(value.aspectRatio))throw new Error('지원하는 화면비를 선택해 주세요.');
 if(!Object.hasOwn(STATUSES,value.status))throw new Error('정리 상태가 올바르지 않습니다.');
 if(value.durationSeconds!==null&&(!Number.isInteger(value.durationSeconds)||value.durationSeconds<1||value.durationSeconds>36000))throw new Error('길이는 1~36,000초 사이의 정수로 입력해 주세요.');
 const base={id,title:text(value.title,'프로젝트 이름',100,true),genre:text(value.genre,'장르',60),concept:text(value.concept,'이야기',8000),visualStyle:text(value.visualStyle,'시각 스타일',4000),characters:text(value.characters,'캐릭터 메모',8000),sceneNotes:text(value.sceneNotes,'장면 메모',8000),aspectRatio:value.aspectRatio,durationSeconds:value.durationSeconds,status:value.status,createdAt:timestamp(value.createdAt),updatedAt:timestamp(value.updatedAt)};
 const inputMode=value.inputMode??(value.status==='drafting'?'drafting':'idea');
 if(!INPUT_MODES.includes(inputMode))throw new Error('준비 상태를 선택해 주세요.');
 return {...base,inputMode,ideaInput:text(value.ideaInput??base.concept,'아이디어',8000),planningInput:text(value.planningInput??legacyPlan(base),'기획 내용',40000),planningFeedback:text(value.planningFeedback??'','기획 검토 메모',4000)};
}
export function activeInput(project){return project.inputMode==='drafting'?project.planningInput:project.ideaInput;}
export function projectFromInput(input,previous,{id,now}){
 if(!INPUT_MODES.includes(input.inputMode))throw new Error('준비 상태를 선택해 주세요.');
 const ideaInput=text(input.ideaInput,'아이디어',8000,input.inputMode==='idea');
 const planningInput=text(input.planningInput,'기획 내용',40000,input.inputMode==='drafting');
 const content=input.inputMode==='idea'?ideaInput:planningInput;
 const title=input.title?.trim()||previous?.title||content.replace(/\s+/g,' ').slice(0,40);
 return validateProject({id:previous?.id??id,title,genre:previous?.genre??'',concept:previous?.concept??'',visualStyle:previous?.visualStyle??'',characters:previous?.characters??'',sceneNotes:previous?.sceneNotes??'',aspectRatio:previous?.aspectRatio??null,durationSeconds:previous?.durationSeconds??null,status:previous?.status==='archived'?'archived':input.inputMode,createdAt:previous?.createdAt??now,updatedAt:now,inputMode:input.inputMode,ideaInput,planningInput,planningFeedback:input.planningFeedback});
}
export function parseLibrary(raw){
 if(raw===null)return [];
 let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('저장된 기획을 읽을 수 없습니다. 기존 데이터는 그대로 보존했습니다.');}
 if(![1,2].includes(parsed?.schemaVersion)||!Array.isArray(parsed.projects)||parsed.projects.length>500)throw new Error('지원하지 않는 기획 보관함 형식입니다. 기존 데이터는 보존했습니다.');
 const projects=parsed.projects.map(validateProject);
 if(new Set(projects.map(p=>p.id)).size!==projects.length)throw new Error('중복된 프로젝트 ID가 있습니다. 기존 데이터는 보존했습니다.');
 return projects;
}
export function serializeLibrary(projects){if(!Array.isArray(projects)||projects.length>500)throw new Error('프로젝트는 최대 500개까지 보관할 수 있습니다.');return JSON.stringify({schemaVersion:2,projects:projects.map(validateProject)});}
export function exportProject(project){return JSON.stringify({fileFormat:'ai-asset-studio.project',schemaVersion:2,project:validateProject(project)},null,2);}
export function importProject(raw){
 if(typeof raw!=='string'||raw.length>1000000)throw new Error('기획 파일은 1MB 이하의 JSON이어야 합니다.');
 let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('올바른 JSON 파일이 아닙니다.');}
 if(parsed?.fileFormat!=='ai-asset-studio.project'||![1,2].includes(parsed.schemaVersion))throw new Error('AI Asset Studio에서 내보낸 기획 파일을 선택해 주세요.');
 return validateProject(parsed.project);
}
