import { env } from 'cloudflare:workers';
import { MAX_BYTES, PART_BYTES, WEEK, DAY, quoteCents, validSize, cleanFilename, contentDisposition } from './rules';

type Transfer = {id:string; public_id:string; owner:string; filename:string; size:number; sender:string|null; upload_id:string|null; state:string; created_at:number; expires_at:number; completed_at:number|null; sent_at:number|null; download_requests:number; last_download_at:number|null};
type Part = {number:number;etag:string;size:number};
const bindings = () => env as unknown as {DB:D1Database;FILES:R2Bucket;BILAGA_TOKEN_HASH?:string};
const db = () => bindings().DB;
const bucket = () => bindings().FILES;
const key = (t:Transfer) => `transfers/${t.id}`;
const iso = (n:number|null) => n ? new Date(n).toISOString() : null;
export const json = (data:unknown,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
class ApiError extends Error { constructor(public status:number,public code:string,message:string){super(message);} }
const fail = (status:number,code:string,message:string):never => {throw new ApiError(status,code,message);};
async function sha(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
async function authorize(req:Request){
  const expected=bindings().BILAGA_TOKEN_HASH;
  if(!expected) return fail(503,'not_configured','Uploads are not configured yet.');
  const token=req.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if(!token || token.length>256) return fail(401,'unauthorized','A valid Bilaga test token is required.');
  const actual=await sha(token);let mismatch=actual.length^expected.length;
  for(let i=0;i<actual.length;i++) mismatch|=actual.charCodeAt(i)^(expected.charCodeAt(i)||0);
  if(mismatch) return fail(401,'unauthorized','A valid Bilaga test token is required.');
  return actual;
}
async function boundedBody(req:Request,limit:number){
  if(!req.body) return new Uint8Array();
  const reader=req.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit){await reader.cancel();return fail(413,'too_large','Request exceeds its allowed size.');}chunks.push(value);}}finally{reader.releaseLock();}
  const body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return body;
}
async function bodyJson(req:Request){try{return JSON.parse(new TextDecoder().decode(await boundedBody(req,4096)));}catch(e){if(e instanceof ApiError)throw e;return fail(400,'invalid_json','Send a JSON object.');}}
async function owned(id:string,owner:string){const t=await db().prepare('SELECT * FROM transfers WHERE id=? AND owner=?').bind(id,owner).first<Transfer>();if(!t)return fail(404,'not_found','Transfer not found.');return t;}
async function uploadParts(t:Transfer){return (await db().prepare('SELECT number,etag,size FROM parts WHERE transfer_id=? ORDER BY number').bind(t.id).all<Part>()).results;}
function publicData(t:Transfer){return {filename:t.filename,size_bytes:t.size,sender:t.sender,expires_at:iso(t.expires_at),status:t.expires_at<=Date.now()?'expired':t.state};}
function privateData(t:Transfer,origin:string){return {id:t.id,...publicData(t),created_at:iso(t.created_at),completed_at:iso(t.completed_at),sent_at:iso(t.sent_at),download_requests:t.download_requests,last_download_requested_at:iso(t.last_download_at),download_note:'Requests indicate a download was started, not completed or read.',share_url:t.state==='complete'?`${origin}/t/${t.public_id}`:null,estimated_price_usd:quoteCents(t.size)/100,charged_usd:0,billing:'preview_no_charge',part_size_bytes:PART_BYTES};}
async function removeBytes(t:Transfer){
  if(t.upload_id){try{await bucket().resumeMultipartUpload(key(t),t.upload_id).abort();}catch{if(t.state==='uploading') throw new Error('Could not abort unfinished upload.');}}
  await bucket().delete(key(t));
  await db().batch([db().prepare('DELETE FROM parts WHERE transfer_id=?').bind(t.id),db().prepare("UPDATE transfers SET state='deleted',upload_id=NULL,filename='Deleted file',sender=NULL WHERE id=?").bind(t.id)]);
}
export async function cleanup(){
  const expired=(await db().prepare("SELECT * FROM transfers WHERE expires_at<=? AND state!='deleted' LIMIT 25").bind(Date.now()).all<Transfer>()).results;
  let removed=0;for(const t of expired){try{await removeBytes(t);removed++;}catch{console.error('Expiry cleanup failed for a transfer');}}
  return removed;
}
export async function publicTransfer(id:string){
  if(!/^[a-f0-9]{32}$/.test(id))return null;
  const t=await db().prepare('SELECT * FROM transfers WHERE public_id=?').bind(id).first<Transfer>();
  if(!t||t.state!=='complete'||t.expires_at<=Date.now())return null;
  return publicData(t);
}
async function download(req:Request,id:string){
  const t=await db().prepare('SELECT * FROM transfers WHERE public_id=?').bind(id).first<Transfer>();
  if(!t||t.state!=='complete')return fail(404,'not_found','This file is unavailable.');
  if(t.expires_at<=Date.now())return fail(410,'expired','This link has expired.');
  // Force downloads; never execute uploaded HTML or SVG on our origin.
  const headers=new Headers({'Content-Type':'application/octet-stream','Content-Disposition':contentDisposition(t.filename),'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; sandbox",'Accept-Ranges':'bytes'});
  if(req.method==='HEAD'){headers.set('Content-Length',String(t.size));return new Response(null,{headers});}
  let offset=0,end=t.size-1;const range=req.headers.get('Range');
  if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${t.size}`}});
    if(!m[1]){const suffix=Number(m[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return fail(416,'invalid_range','Invalid byte range.');offset=Math.max(0,t.size-suffix);}else{offset=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;}
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(end)||offset> end||offset>=t.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${t.size}`}});
  }
  const object=await bucket().get(key(t),range?{range:{offset,length:end-offset+1}}:undefined);
  if(!object||!('body'in object))return fail(404,'not_found','This file is unavailable.');
  headers.set('Content-Length',String(end-offset+1));headers.set('ETag',object.httpEtag);
  if(range)headers.set('Content-Range',`bytes ${offset}-${end}/${t.size}`);
  await db().prepare('UPDATE transfers SET download_requests=download_requests+1,last_download_at=? WHERE id=?').bind(Date.now(),t.id).run();
  return new Response(object.body,{status:range?206:200,headers});
}
export async function handleApi(req:Request){try{
  const u=new URL(req.url),p=u.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean),method=req.method;
  if(p[0]==='config'&&method==='GET')return json({mode:'private_preview',max_file_bytes:MAX_BYTES,part_size_bytes:PART_BYTES,retention_days:7,billing:'preview_no_charge',auth:'bearer_token',signals:'polling',uploads_configured:!!bindings().BILAGA_TOKEN_HASH});
  if(p[0]==='quote'&&method==='GET'){const bytes=Number(u.searchParams.get('bytes'));if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>50e9)return fail(400,'invalid_size','Quote a file between 1 byte and 50 GB.');return json({size_bytes:bytes,estimated_price_usd:quoteCents(bytes)/100,currency:'USD',charged_usd:0,upload_allowed:bytes<=MAX_BYTES,max_file_bytes:MAX_BYTES,billing:'preview_no_charge'});}
  if(p[0]==='download'&&/^[a-f0-9]{32}$/.test(p[1]||'')&&(method==='GET'||method==='HEAD'))return await download(req,p[1]);
  const owner=await authorize(req);
  if(p[0]==='cleanup'&&method==='POST')return json({removed:await cleanup()});
  if(p[0]!=='transfers')return fail(404,'not_found','Endpoint not found.');
  if(p.length===1&&method==='POST'){
    const body=await bodyJson(req);if(!body||typeof body!=='object'||Array.isArray(body))return fail(400,'invalid_json','Send a JSON object.');
    if(!validSize(body.size_bytes))return fail(400,'invalid_size','This preview accepts files from 1 byte to 1 GB.');
    let filename:string;try{filename=cleanFilename(body.filename);}catch(e){return fail(400,'invalid_filename',(e as Error).message);}
    if(body.sender!==undefined&&(typeof body.sender!=='string'||body.sender.length>80))return fail(400,'invalid_sender','Sender must be at most 80 characters.');
    // At most 100 sessions/day per prototype token. Production needs per-account quotas.
    const count=await db().prepare('SELECT count(*) AS n FROM transfers WHERE owner=? AND created_at>?').bind(owner,Date.now()-DAY).first<{n:number}>();
    if((count?.n||0)>=100)return fail(429,'preview_limit','The preview limit is 100 transfers per day.');
    await cleanup();
    const id=crypto.randomUUID().replaceAll('-',''),publicId=crypto.randomUUID().replaceAll('-',''),now=Date.now();
    const multi=await bucket().createMultipartUpload(`transfers/${id}`,{httpMetadata:{contentType:'application/octet-stream'}});
    try{await db().prepare("INSERT INTO transfers (id,public_id,owner,filename,size,sender,upload_id,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?,'uploading',?,?)").bind(id,publicId,owner,filename,body.size_bytes,body.sender||null,multi.uploadId,now,now+DAY).run();}catch(e){await multi.abort();throw e;}
    const t=await owned(id,owner);return json({...privateData(t,u.origin),upload_expires_at:iso(now+DAY)},201);
  }
  if(p.length===1&&method==='GET'){const rows=(await db().prepare('SELECT * FROM transfers WHERE owner=? ORDER BY created_at DESC LIMIT 50').bind(owner).all<Transfer>()).results;return json({transfers:rows.map(t=>privateData(t,u.origin))});}
  if(!/^[a-f0-9]{32}$/.test(p[1]||''))return fail(404,'not_found','Transfer not found.');
  let t=await owned(p[1],owner);
  if(p.length===2&&method==='GET')return json({...privateData(t,u.origin),parts:await uploadParts(t)});
  if(p.length===2&&method==='DELETE'){await db().prepare("UPDATE transfers SET state='deleted' WHERE id=?").bind(t.id).run();await removeBytes(t);return json({id:t.id,status:'deleted'});}
  if(t.state==='deleted'||t.expires_at<=Date.now())return fail(410,'expired','Transfer deleted or expired.');
  if(p[2]==='parts'&&p.length===4&&method==='PUT'){
    if(t.state!=='uploading')return fail(409,'invalid_state','Upload is already complete or being finalized.');
    const n=Number(p[3]),count=Math.ceil(t.size/PART_BYTES);
    if(!Number.isInteger(n)||n<1||n>count)return fail(400,'invalid_part','Invalid part number.');
    const expected=Math.min(PART_BYTES,t.size-(n-1)*PART_BYTES),data=await boundedBody(req,expected);
    if(data.byteLength!==expected)return fail(400,'invalid_part_size',`Expected ${expected} bytes for this part.`);
    const part=await bucket().resumeMultipartUpload(key(t),t.upload_id!).uploadPart(n,data);
    await db().prepare('INSERT INTO parts (transfer_id,number,etag,size) VALUES (?,?,?,?) ON CONFLICT(transfer_id,number) DO UPDATE SET etag=excluded.etag,size=excluded.size').bind(t.id,n,part.etag,data.byteLength).run();
    return json({part_number:n,size_bytes:data.byteLength});
  }
  if(p[2]==='complete'&&p.length===3&&method==='POST'){
    if(t.state==='complete')return json(privateData(t,u.origin));
    const parts=await uploadParts(t);
    if(parts.length!==Math.ceil(t.size/PART_BYTES)||parts.reduce((n,p)=>n+p.size,0)!==t.size)return fail(409,'incomplete','Upload every part before completing the transfer.');
    let object=await bucket().head(key(t));
    if(!object){
      const lock=await db().prepare("UPDATE transfers SET state='completing' WHERE id=? AND state='uploading'").bind(t.id).run();
      if(!lock.meta.changes)return fail(409,'completing','Completion is in progress. Poll status; retry completion if it remains pending.');
      try{object=await bucket().resumeMultipartUpload(key(t),t.upload_id!).complete(parts.map(p=>({partNumber:p.number,etag:p.etag})));}
      catch(e){await db().prepare("UPDATE transfers SET state='uploading' WHERE id=? AND state='completing'").bind(t.id).run();throw e;}
    }
    if(object.size!==t.size)return fail(409,'size_mismatch','Stored file size did not match the declared size.');
    const now=Date.now();
    await db().prepare("UPDATE transfers SET state='complete',completed_at=?,expires_at=?,upload_id=NULL WHERE id=? AND state IN ('uploading','completing')").bind(now,now+WEEK,t.id).run();
    t=await owned(t.id,owner);
    // Deletion can race completion; never revive a revoked transfer or keep its bytes.
    if(t.state==='deleted'){await bucket().delete(key(t));return fail(410,'deleted','Transfer was deleted.');}
    return json(privateData(t,u.origin));
  }
  if(p[2]==='sent'&&p.length===3&&method==='POST'){
    if(t.state!=='complete')return fail(409,'not_ready','Complete the upload before reporting it sent.');
    await db().prepare('UPDATE transfers SET sent_at=COALESCE(sent_at,?) WHERE id=?').bind(Date.now(),t.id).run();return json(privateData(await owned(t.id,owner),u.origin));
  }
  return fail(405,'method_not_allowed','This method is not supported for the endpoint.');
}catch(e){if(e instanceof ApiError)return json({error:{code:e.code,message:e.message}},e.status);console.error('Bilaga API failure',e instanceof Error?e.message:'unknown');return json({error:{code:'temporary_error',message:'The request could not be completed. Please retry.'}},500);}}
