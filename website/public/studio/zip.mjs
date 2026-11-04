const encoder=new TextEncoder();
const table=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function makeZip(entries){
 if(entries.length>1000)throw new Error('파일 수가 너무 많습니다.');
 const parts=[],central=[];let offset=0,centralBytes=0;const names=new Set();
 const header=(length)=>{const b=new Uint8Array(length);return [b,new DataView(b.buffer)];};
 for(const {path,data} of entries){
  if(typeof path!=='string'||path.startsWith('/')||path.includes('\\')||/[\u0000-\u001f:]/.test(path)||path.split('/').some(p=>p==='..'||p==='.'||!p)||names.has(path.toLowerCase()))throw new Error('안전하지 않거나 중복된 파일 경로입니다.');
  if(!(data instanceof Uint8Array))throw new Error('파일 데이터가 올바르지 않습니다.');
  names.add(path.toLowerCase());const name=encoder.encode(path);if(name.length>65535)throw new Error('파일 이름이 너무 깁니다.');
  const crc=crc32(data),[h,v]=header(30);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);parts.push(h,name,data);
  const [c,cv]=header(46);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(14,33,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.push(c,name);centralBytes+=c.length+name.length;offset+=h.length+name.length+data.length;
 }
 if(offset+centralBytes>0xffffffff)throw new Error('ZIP 파일이 너무 큽니다.');
 const [end,ev]=header(22);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,entries.length,true);ev.setUint16(10,entries.length,true);ev.setUint32(12,centralBytes,true);ev.setUint32(16,offset,true);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}
