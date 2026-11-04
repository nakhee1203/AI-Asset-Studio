import {escaped,sha256,now,uid,fail} from './studio-domain.mjs';
const folders={character:'02_Characters',environment:'03_Environments',prop:'04_Props',keyframe:'05_Keyframes'};
export function checkSelections(assets,versions,{final=false}={}){
 const byId=new Map(versions.map(v=>[v.id,v]));
 for(const a of assets){
  const v=byId.get(a.selected_version);
  if(!v||v.asset_id!==a.id||v.snapshot_id!==a.snapshot_id)fail(a.label+': 이미지를 먼저 선택해 주세요.',409);
  if(final&&a.final_version!==v.id)fail('모든 에셋의 최종 확정이 필요합니다.',409);
  for(const ref of JSON.parse(v.refs_json)){
   const target=assets.find(x=>x.id===ref.assetId);
   if(!target||target.selected_version!==ref.versionId)fail(a.label+': 참조 이미지가 제외되었거나 바뀌었습니다. 새 참조로 다시 제작해 주세요.',409);
  }
 }
 return true;
}
const promptOf=e=>e.visualPrompt||e.description;
export async function createExport(project,snapshot,assets,versions){
 const excluded=new Set(project.workflow.excluded??[]),active=assets.filter(a=>!excluded.has(a.id));
 if(!active.length)fail('내보낼 에셋이 없습니다.',409);
 checkSelections(active,versions,{final:true});
 const d=snapshot.draft,exportId=uid(),createdAt=now(),style=d.stylePrompt||d.visualStyle;
 const images=active.map((a,index)=>{
  const v=versions.find(v=>v.id===a.final_version);
  return {path:folders[a.kind]+'/'+String(index+1).padStart(2,'0')+'_'+a.label.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,60)+'.png',assetId:a.id,versionId:v.id,label:a.label,kind:a.kind,sha256:v.sha256,bytes:v.bytes,url:'/api/images/'+v.id,prompt:v.prompt,revisedPrompt:v.revised_prompt??null,refs:JSON.parse(v.refs_json)};
 });
 const documents=[];
 const add=async(path,content)=>{
  const data=new TextEncoder().encode(content);
  documents.push({path,content,sha256:await sha256(data),bytes:data.length});
 };
 const json=value=>JSON.stringify(value,null,2);
 const entityLines=items=>items.map(e=>'- '+e.name+': '+e.description+(e.visualPrompt?'\n  - prompt: '+e.visualPrompt:'')).join('\n');
 await add('01_Creative_Bible/bible.md','# '+d.title+'\n\n'+d.logline+'\n\n'+d.synopsis+'\n\n- 장르: '+d.genre+'\n- 길이: '+d.durationSeconds+'초\n- 화면비: '+d.aspectRatio+'\n- 시각 스타일: '+d.visualStyle+(d.stylePrompt?'\n- 스타일 프롬프트: '+d.stylePrompt:'')+'\n\n'+[['캐릭터',d.characters],['장소',d.locations],['소품',d.props]].map(([label,items])=>'## '+label+'\n\n'+entityLines(items)).join('\n\n'));
 await add('01_Creative_Bible/project_snapshot.json',json({schemaVersion:3,projectId:project.id,snapshotId:project.workflow.snapshotId,originalInput:project.input,draft:d,excludedAssets:[...excluded]}));
 // 키프레임 에셋은 planAssets 가 쇼트 순서대로 만든다. 제외된 장면도 자리를 차지하므로 전체 목록으로 순서를 맞춘다.
 const allFrames=assets.filter(a=>a.kind==='keyframe');
 const byId=new Map(Object.entries({character:d.characters,environment:d.locations,prop:d.props}).flatMap(([kind,items])=>items.map(e=>[kind+':'+e.id,e])));
 const shots=d.shots.map((s,i)=>{const frame=allFrames[i],image=frame&&!excluded.has(frame.id)?images.find(x=>x.assetId===frame.id):null;return {...s,image:image?.path??null,versionId:image?.versionId??null,characters:s.characterIds.map(x=>byId.get('character:'+x)).filter(Boolean),location:byId.get('environment:'+s.locationId)??null,props:s.propIds.map(x=>byId.get('prop:'+x)).filter(Boolean)};});
 await add('06_Storyboard/storyboard.json',json(shots.map(({characters,location,props,...s})=>s)));
 await add('06_Storyboard/storyboard.html','<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escaped(d.title)+'</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 20px;background:#111;color:#eee}article{margin:32px 0;padding:24px;background:#222}img{max-width:100%;max-height:560px}p{white-space:pre-wrap}small{color:#aaa}.none{padding:40px;background:#2a2a2a;color:#888;text-align:center}</style><h1>'+escaped(d.title)+'</h1><p>'+escaped(d.logline)+'</p>'+shots.map(s=>'<article><h2>'+escaped(s.id+' · '+s.title)+'</h2>'+(s.image?'<img alt="'+escaped(s.title)+'" src="../'+escaped(s.image)+'">':'<p class="none">이 장면의 이미지는 제외했습니다.</p>')+'<p>'+escaped(s.description)+'</p>'+(s.motion?'<p><small>MOTION · '+escaped(s.motion)+'</small></p>':'')+'<small>'+s.seconds+'초 · '+escaped(s.camera)+'</small></article>').join('')+'</html>');
 const videoPrompt=s=>({shotId:s.id,title:s.title,seconds:s.seconds,aspectRatio:d.aspectRatio,stylePrompt:style,prompt:s.prompt,motion:s.motion||'',camera:s.camera,characters:s.characters.map(e=>({name:e.name,visualPrompt:promptOf(e)})),location:s.location?{name:s.location.name,visualPrompt:promptOf(s.location)}:null,props:s.props.map(e=>({name:e.name,visualPrompt:promptOf(e)})),referenceImage:s.image});
 await add('07_Video_Prompts/prompts.json',json(shots.map(videoPrompt)));
 for(const s of shots){
  const v=videoPrompt(s);
  await add('07_Video_Prompts/'+s.id+'.txt',['SHOT '+s.id+' · '+s.title,s.seconds+' seconds · '+d.aspectRatio,'STYLE: '+v.stylePrompt,'FRAME: '+v.prompt,'MOTION: '+(v.motion||'(not specified)'),'CAMERA: '+v.camera,...(v.characters.length?['CHARACTERS:',...v.characters.map(c=>'- '+c.name+': '+c.visualPrompt)]:[]),...(v.location?['LOCATION: '+v.location.name+': '+v.location.visualPrompt]:[]),...(v.props.length?['PROPS:',...v.props.map(c=>'- '+c.name+': '+c.visualPrompt)]:[]),'REFERENCE IMAGE: '+(s.image??'(excluded)')].join('\n'));
 }
 const manifest={schemaVersion:1,exportId,projectId:project.id,snapshotId:project.workflow.snapshotId,createdAt,title:d.title,excludedAssets:[...excluded],files:[...documents.map(({path,sha256,bytes})=>({path,sha256,bytes})),...images.map(({url,...v})=>v)]};
 await add('08_Manifest/manifest.json',json(manifest));
 return {exportId,createdAt,manifest,documents,images};
}
