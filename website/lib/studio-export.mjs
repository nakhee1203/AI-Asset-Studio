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
   if(!target||target.selected_version!==ref.versionId)fail(a.label+': 참조 이미지가 바뀌었습니다. 새 참조로 다시 제작해 주세요.',409);
  }
 }
 return true;
}
export async function createExport(project,snapshot,assets,versions){
 checkSelections(assets,versions,{final:true});
 const d=snapshot.draft,exportId=uid(),createdAt=now();
 const images=assets.map((a,index)=>{
  const v=versions.find(v=>v.id===a.final_version);
  return {path:folders[a.kind]+'/'+String(index+1).padStart(2,'0')+'_'+a.label.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,60)+'.png',assetId:a.id,versionId:v.id,label:a.label,kind:a.kind,sha256:v.sha256,bytes:v.bytes,url:'/api/images/'+v.id,prompt:v.prompt,refs:JSON.parse(v.refs_json)};
 });
 const documents=[];
 const add=async(path,content)=>{
  const data=new TextEncoder().encode(content);
  documents.push({path,content,sha256:await sha256(data),bytes:data.length});
 };
 const json=value=>JSON.stringify(value,null,2);
 await add('01_Creative_Bible/bible.md','# '+d.title+'\n\n'+d.logline+'\n\n'+d.synopsis+'\n\n- 장르: '+d.genre+'\n- 길이: '+d.durationSeconds+'초\n- 화면비: '+d.aspectRatio+'\n- 시각 스타일: '+d.visualStyle+'\n\n'+[['캐릭터',d.characters],['장소',d.locations],['소품',d.props]].map(([label,items])=>'## '+label+'\n\n'+items.map(e=>'- '+e.name+': '+e.description).join('\n')).join('\n\n'));
 await add('01_Creative_Bible/project_snapshot.json',json({schemaVersion:3,projectId:project.id,snapshotId:project.workflow.snapshotId,originalInput:project.input,draft:d}));
 const frames=images.filter(x=>x.kind==='keyframe');
 const shots=d.shots.map((s,i)=>({...s,image:frames[i]?.path,versionId:frames[i]?.versionId}));
 await add('06_Storyboard/storyboard.json',json(shots));
 await add('06_Storyboard/storyboard.html','<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escaped(d.title)+'</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 20px;background:#111;color:#eee}article{margin:32px 0;padding:24px;background:#222}img{max-width:100%;max-height:560px}p{white-space:pre-wrap}small{color:#aaa}</style><h1>'+escaped(d.title)+'</h1><p>'+escaped(d.logline)+'</p>'+shots.map(s=>'<article><h2>'+escaped(s.id+' · '+s.title)+'</h2><img alt="'+escaped(s.title)+'" src="../'+s.image+'"><p>'+escaped(s.description)+'</p><small>'+s.seconds+'초 · '+escaped(s.camera)+'</small></article>').join('')+'</html>');
 await add('07_Video_Prompts/prompts.json',json(shots.map(s=>({shotId:s.id,seconds:s.seconds,aspectRatio:d.aspectRatio,prompt:s.prompt,referenceImage:s.image}))));
 for(const s of shots)await add('07_Video_Prompts/'+s.id+'.txt','SHOT '+s.id+'\n'+s.seconds+' seconds · '+d.aspectRatio+'\n'+d.visualStyle+'\n'+s.prompt+'\nCAMERA: '+s.camera);
 const manifest={schemaVersion:1,exportId,projectId:project.id,snapshotId:project.workflow.snapshotId,createdAt,title:d.title,files:[...documents.map(({path,sha256,bytes})=>({path,sha256,bytes})),...images.map(({url,...v})=>v)]};
 await add('08_Manifest/manifest.json',json(manifest));
 return {exportId,createdAt,manifest,documents,images};
}
