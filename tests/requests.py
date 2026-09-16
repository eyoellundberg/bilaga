"""Generic multi-file requests against localhost D1/R2. Synthetic accounts only."""
import concurrent.futures, hashlib, json, os, secrets, subprocess, threading, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from integration import request, BASE
checks=0

def sql(query):
    result=subprocess.run(['npx','wrangler','d1','execute','DB','--local','--config','wrangler.cloudflare.json','--persist-to','.wrangler/state','--command',query,'--json'],check=True,capture_output=True,text=True,env=dict(os.environ,WRANGLER_LOG_PATH='.wrangler/logs'))
    return json.loads(result.stdout)[0]['results']
def api(path,method='GET',body=None,token='',expect=200):
    global checks
    checks+=1
    return request('/api/'+path,method,body,auth=False,headers={'Authorization':'Bearer '+token} if token else {},expect=expect)[0]
def account():
    aid,token,tid=secrets.token_hex(16),secrets.token_hex(32),secrets.token_hex(16)
    sql(f"INSERT INTO accounts(id,email,handle,created_at) VALUES('{aid}','{aid}@example.invalid','acct_{aid[:16]}',{int(time.time()*1000)}); INSERT INTO api_tokens(id,account_id,hash,label,created_at) VALUES('{tid}','{aid}','{hashlib.sha256(token.encode()).hexdigest()}','Request test',{int(time.time()*1000)})")
    return aid,token
owner,token=account(); other,other_token=account()
# The account-page controls use the same routes with a normal browser session.
session=secrets.token_hex(32); now=int(time.time()*1000)
sql(f"INSERT INTO sessions(hash,account_id,created_at,expires_at) VALUES('{hashlib.sha256(session.encode()).hexdigest()}','{owner}',{now},{now+86400000})")
session_headers={'Cookie':'bilaga_session='+session,'Origin':BASE}
created_ui,_=request('/api/account/requests','POST',{'title':'Created from account page'},auth=False,headers=session_headers,expect=201)
request('/api/account/requests/'+created_ui['id'],auth=False,headers=session_headers)
request('/api/account/requests/'+created_ui['id'],'DELETE',auth=False,headers=session_headers)

request('/api/requests','POST',{'title':'No owner-token requests'},expect=403)
api('requests','POST',{'title':'Invalid','max_files':0},token,400)

def create(**fields):
    result=api('requests','POST',{'title':'Project files','description':'Add the files you want to submit.','reference':'external-123',**fields},token,201)
    url=urlparse(result['upload_url']); key=parse_qs(url.fragment)['key'][0]
    assert key not in url.path and key not in json.dumps(sql(f"SELECT token_hash FROM file_requests WHERE id='{result['id']}'"))
    return result,key
r,key=create(max_files=8,max_total_bytes=100,max_file_bytes=30)
rid=r['id']; base='drop/'+rid
assert api(base,token=key)['status']=='open'
api(base,expect=404); api(base,token=token,expect=404)
api('transfers',token=key,expect=401)
api(base+'/inbox',token=key,expect=404)
api('requests/'+rid,token=other_token,expect=404)
api('requests/'+rid+'/receipt',token=token,expect=409)
api(base+'/submit','POST',{'email':'person@example.invalid'},key,409)
api(base+'/transfers','POST',{'filename':'bad.txt','size_bytes':1,'to':'elsewhere@example.invalid'},key,400)

# Each file completes independently; it does not finish the collection.
a=api(base+'/transfers','POST',{'filename':'one.txt','size_bytes':3},key,201)
assert not any(field in a for field in ['to','share_url','receipt_url','charged_usd'])
api(base+'/submit','POST',{'email':'person@example.invalid'},key,409)
api(base+'/transfers/'+a['id']+'/parts/1','PUT',b'one',key)
api(base+'/transfers/'+a['id']+'/complete','POST',token=key)
api(base+'/transfers/'+a['id']+'/complete','POST',token=key)
assert api(base,token=key)['status']=='open'
assert api('events?type=request.submitted',token=token)['events']==[]
b=api(base+'/transfers','POST',{'filename':'two.txt','size_bytes':3},key,201)
api(base+'/transfers/'+b['id']+'/parts/1','PUT',b'two',key)
api(base+'/transfers/'+b['id']+'/complete','POST',token=key)
# A different link, even belonging to the same account, cannot access these files.
r2,key2=create()
api('drop/'+r2['id']+'/transfers/'+a['id'],token=key2,expect=404)
api('drop/'+r2['id']+'/transfers/'+a['id'],'DELETE',token=key2,expect=404)
api(base+'/submit','POST',{'email':'not-an-email'},key,400)

# Starting another file and Done cannot both succeed.
barrier=threading.Barrier(2)
def race(kind):
    barrier.wait()
    try:
        if kind=='upload': return kind,api(base+'/transfers','POST',{'filename':'race.txt','size_bytes':1},key,201)
        return kind,api(base+'/submit','POST',{'email':'person@example.invalid'},key)
    except AssertionError as e:
        assert e.args[0][1] in (409,429),e
        return kind,None
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    raced=dict(pool.map(race,['upload','submit']))
assert bool(raced['upload']) != bool(raced['submit']),raced
if raced['upload']: api(base+'/transfers/'+raced['upload']['id'],'DELETE',token=key)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    finished=list(pool.map(lambda _:api(base+'/submit','POST',{'email':'person@example.invalid'},key),range(8)))
assert all(f['status']=='submitted' for f in finished)
assert len({f['submitted_at'] for f in finished})==1
assert len(finished[0]['files'])==2
api(base+'/transfers','POST',{'filename':'late.txt','size_bytes':1},key,409)
api(base+'/transfers/'+a['id'],'DELETE',token=key,expect=409)
events=api('events?type=request.submitted',token=token)['events']; assert len(events)==1
assert events[0]['event']['request']['reference']=='external-123'
assert len(events[0]['event']['request']['files'])==2
receipt=api('requests/'+rid+'/receipt',token=token)
assert receipt['submission']['uploader_email']=='person@example.invalid' and receipt['submission']['uploader_email_verified'] is False
assert len(receipt['submission']['files'])==2
key_info=api('receipt-key')
for signed,kind in [(receipt,'submission'),(events[0],'event')]:
    verify=subprocess.run(['node','--input-type=module','-e',"import {createPublicKey,verify} from 'node:crypto'; import {readFileSync} from 'node:fs'; const d=JSON.parse(readFileSync(0,'utf8')); const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(d.key,'hex')]),format:'der',type:'spki'}); if(!verify(null,Buffer.from(d.payload),key,Buffer.from(d.signature,'hex')))process.exit(1);"],input=json.dumps({'key':key_info['public_key_hex'],'payload':json.dumps(signed[kind],sort_keys=True,separators=(',',':'),ensure_ascii=False),'signature':signed['signature_hex']}),text=True,capture_output=True)
    assert verify.returncode==0,verify.stderr
for file in receipt['submission']['files']:
    public=api('receipts/'+file['public_id'])['receipt']
    assert public['sender_account'] is None and public['requester_account']=='acct_'+owner[:16]
    assert 'person@example.invalid' not in json.dumps(public)
assert len(api('inbox',token=token)['transfers'])==2
assert len(api('inbox',token=other_token)['transfers'])==0
# Owner removal changes availability, not the submitted manifest or signature.
api('transfers/'+a['id'],'DELETE',token=token)
assert api('requests/'+rid+'/receipt',token=token)['submission']==receipt['submission']

# Request caps are atomic and include removed attempts (no unlimited spending).
capped,capkey=create(max_files=1,max_file_bytes=2,max_total_bytes=2)
cap='drop/'+capped['id']
api(cap+'/transfers','POST',{'filename':'oversize','size_bytes':3},capkey,429)
one=api(cap+'/transfers','POST',{'filename':'within','size_bytes':2},capkey,201)
api(cap+'/transfers','POST',{'filename':'extra','size_bytes':1},capkey,429)
api(cap+'/transfers/'+one['id'],'DELETE',token=capkey)
api(cap+'/transfers','POST',{'filename':'again','size_bytes':1},capkey,429)
# Expiry, revocation and account deletion invalidate guest permissions.
sql(f"UPDATE file_requests SET expires_at=1 WHERE id='{r2['id']}'")
api('drop/'+r2['id']+'/transfers','POST',{'filename':'expired','size_bytes':1},key2,409)
revoked,rkey=create()
api('requests/'+revoked['id'],'DELETE',token=token)
api('drop/'+revoked['id'],token=rkey,expect=404)

# Requester pays per file under existing rules; Done never charges again.
paid,pkey=create(max_files=4,max_total_bytes=6_000_000_000,max_file_bytes=6_000_000_000)
pbase='drop/'+paid['id']
blocked=api(pbase+'/transfers','POST',{'filename':'large.bin','size_bytes':5_000_000_001},pkey,402)
assert 'Your balance' not in blocked['error']['message']
request('/api/credits','POST',{'email':owner+'@example.invalid','cents':200})
large=api(pbase+'/transfers','POST',{'filename':'large.bin','size_bytes':5_000_000_001},pkey,201)
assert api('balance',token=token)['balance_cents']==149
api(pbase+'/transfers/'+large['id'],'DELETE',token=pkey)
assert api('balance',token=token)['balance_cents']==200
# Completed files retain their per-file charge, including after removal/purge retry.
now=int(time.time()*1000)
for i in range(5):
    tid=secrets.token_hex(16)
    sql(f"INSERT INTO transfers(id,public_id,owner,filename,size,state,created_at,expires_at,completed_at,purged_at) VALUES('{tid}','{secrets.token_hex(16)}','{owner}','allowance-fixture',1,'complete',{now-1000},{now-1},{now-1000},{now})")
charged=api(pbase+'/transfers','POST',{'filename':'charged.txt','size_bytes':1},pkey,201)
api(pbase+'/transfers/'+charged['id']+'/parts/1','PUT',b'x',pkey)
api(pbase+'/transfers/'+charged['id']+'/complete','POST',token=pkey)
api(pbase+'/transfers/'+charged['id'],'DELETE',token=pkey)
assert api('balance',token=token)['balance_cents']==175
sql(f"UPDATE transfers SET purged_at=NULL WHERE id='{charged['id']}'")
request('/cdn-cgi/handler/scheduled',auth=False)
assert api('balance',token=token)['balance_cents']==175
final=api(pbase+'/transfers','POST',{'filename':'final.txt','size_bytes':1},pkey,201)
api(pbase+'/transfers/'+final['id']+'/parts/1','PUT',b'y',pkey)
api(pbase+'/transfers/'+final['id']+'/complete','POST',token=pkey)
api(pbase+'/submit','POST',{'email':'paid-uploader@example.invalid'},pkey)
api(pbase+'/submit','POST',{'email':'paid-uploader@example.invalid'},pkey)
assert api('balance',token=token)['balance_cents']==150
# Stable pagination does not skip requests sharing a timestamp.
rows=[]
for i in range(51):
    rows.append(f"('{secrets.token_hex(16)}','{owner}','{secrets.token_hex(32)}','old request','',1,1,1,1,1)")
sql('INSERT INTO file_requests(id,owner,token_hash,title,description,max_files,max_file_bytes,max_total_bytes,created_at,expires_at) VALUES '+','.join(rows))
page=api('requests',token=token); ids=[r['id'] for r in page['requests']]
assert len(ids)==50 and page['next_before']
page2=api('requests?before='+page['next_before'],token=token)
ids += [r['id'] for r in page2['requests']]
assert len(ids)==len(set(ids)) and len(ids)==sql(f"SELECT COUNT(*) AS n FROM file_requests WHERE owner='{owner}'")[0]['n']
# Expire the owner account to exercise the same joined authorization as deletion.
sql(f"UPDATE accounts SET deleted_at=1,email=NULL WHERE id='{owner}'")
api(base,token=key,expect=404)
sql(f"UPDATE accounts SET deleted_at=NULL,email='{owner}@example.invalid' WHERE id='{owner}'")
# The Python client covers both sides: requester commands with a token, uploader commands with only the link.
def client(*argv,token='',stdin=None,expect=0):
    global checks
    checks+=1
    env=dict(os.environ); env.pop('BILAGA_TOKEN',None)
    if token: env['BILAGA_TOKEN']=token
    run=subprocess.run(['python3','public/bilaga.py','--base',BASE,*argv],env=env,capture_output=True,text=True,input=stdin)
    assert run.returncode==expect,(argv,run.returncode,run.stdout[-300:],run.stderr[-300:])
    return json.loads(run.stdout) if run.stdout.strip().startswith('{') else run.stdout
made=client('--request','Client request','--reference','cli-1','--max-files','3','--max-bytes','100',token=token)
assert made['status']=='open' and made['upload_url'].startswith(BASE+'/r/')
assert any(r['id']==made['id'] for r in client('--requests',token=token)['requests'])
link=made['upload_url']
client('--drop-status',expect=2)                     # --link is required
client('--drop-status','--link','https://elsewhere.invalid/r/'+made['id']+'#key=aa',expect=2)
client('--done','x@example.invalid','--link',link,expect=1)   # nothing uploaded yet
Path('.wrangler/cli-one.txt').write_bytes(b'cli-one'); Path('.wrangler/cli-two.txt').write_bytes(b'cli-two')
first=client('--drop-file','.wrangler/cli-one.txt','--link',link)
assert first['status']=='complete' and 'share_url' not in first
second=client('--drop-file','.wrangler/cli-two.txt','--link',link)
removed=client('--drop-remove',second['id'],'--link',link)
assert len(client('--drop-status','--link',link)['files'])==1
client('--drop-file','.wrangler/cli-two.txt','--link',link)
submitted=client('--done','cli-uploader@example.invalid','--link',link)
assert submitted['status']=='submitted' and len(submitted['files'])==2
client('--drop-file','.wrangler/cli-one.txt','--link',link,expect=1)   # closed after Done
status=client('--request-status',made['id'],token=token)
assert status['uploader_email']=='cli-uploader@example.invalid' and len(status['submission'])==2
verified=client('--request-receipt',made['id'],token=token)
assert verified['verified'] and verified['submission']['reference']=='cli-1'
client('--request-receipt',made['id'],token=other_token,expect=1)
assert client('--request-revoke',made['id'],token=token)['status']=='revoked'
# Keep a disposable open link for a browser smoke test, with no production identity.
preview,preview_key=create(title='Files for your project',description='Add your document, cover and any supporting files. Click Done when you have added everything.')
Path('.wrangler/request-preview.json').write_text(json.dumps({'url':preview['upload_url'],'owner':owner,'token':token,'request_id':preview['id']}))
print(f'{checks} file-request checks passed: guest scope, multiple files, explicit Done, atomic submission, receipts, limits, requester billing, expiry and revocation.')
