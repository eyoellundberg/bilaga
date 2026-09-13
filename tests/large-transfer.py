"""Local large-file validation. Streams synthetic data; never uses production."""
import hashlib, math, os, subprocess, sys, tempfile
from pathlib import Path
from urllib.request import urlopen
from integration import request, TOKEN, BASE

config,_=request('/api/config',auth=False)
assert config['max_file_bytes']==50_000_000_000 and config['retention_days']==30
request('/api/transfers','POST',{'filename':'too-large.bin','size_bytes':50_000_000_001},expect=400)
# Verify 64-bit arithmetic and the real final multipart part at the maximum size.
t,_=request('/api/transfers','POST',{'filename':'50gb-boundary.bin','size_bytes':50_000_000_000},expect=201)
p='/api/transfers/'+t['id']
try:
    count=math.ceil(t['size_bytes']/t['part_size_bytes'])
    last=t['size_bytes']-(count-1)*t['part_size_bytes']
    request(p+f'/parts/{count}','PUT',b'z'*last)
    request(p+f'/parts/{count+1}','PUT',b'z',expect=400)
    status,_=request(p);assert status['parts'][0]['number']==count and status['parts'][0]['size']==last
    request(p+'/complete','POST',expect=409)
finally: request(p,'DELETE')
print('50 GB boundary passed: declared size, final part, out-of-range part, incomplete completion, cleanup.',flush=True)
# Exercise the shipped client across the old 1 GB ceiling, with a bounded-memory download hash.
size=int(os.environ.get('BILAGA_TEST_BYTES','1100000123'))
assert 0<size<=50_000_000_000
with tempfile.TemporaryDirectory(prefix='bilaga-large-') as directory:
    f=Path(directory)/'synthetic-large.bin'
    with f.open('wb') as stream:stream.truncate(size)
    # Persist one finished part and one reserved-but-unfinished part, then
    # resume through the shipped client. The missing ETag must not be skipped.
    t,_=request('/api/transfers','POST',{'filename':f.name,'size_bytes':size},expect=201)
    tid=t['id']
    request('/api/transfers/'+tid+'/parts/1','PUT',b'\0'*min(size,t['part_size_bytes']))
    if size>t['part_size_bytes']:
        unfinished=min(t['part_size_bytes'],size-t['part_size_bytes'])
        subprocess.run(['npx','wrangler','d1','execute','DB','--local','--config','wrangler.cloudflare.json','--persist-to','.wrangler/state','--command',f"INSERT INTO parts(transfer_id,number,etag,size,content_hash) VALUES('{tid}',2,'',{unfinished},'{hashlib.sha256(b'\0'*unfinished).hexdigest()}')"],check=True,capture_output=True)
    result=subprocess.run([sys.executable,'public/bilaga.py','--base',BASE,'--file',str(f),'--resume',tid],env=dict(os.environ,BILAGA_TOKEN=TOKEN),capture_output=True,text=True)
    if result.returncode:
        print(result.stderr,flush=True)
        subprocess.run([sys.executable,'public/bilaga.py','--base',BASE,'--delete',tid],env=dict(os.environ,BILAGA_TOKEN=TOKEN),check=True,capture_output=True)
        raise RuntimeError(result.stderr)
    import json
    ready=json.loads(result.stdout)
    try:
        expected=hashlib.sha256();actual=hashlib.sha256();total=0
        with f.open('rb') as stream:
            while chunk:=stream.read(8*1024*1024):expected.update(chunk)
        with urlopen(BASE+'/api/download/'+ready['share_url'].rsplit('/',1)[1],timeout=120) as stream:
            while chunk:=stream.read(8*1024*1024):actual.update(chunk);total+=len(chunk)
        assert total==size and expected.digest()==actual.digest()
        print(f'{size:,}-byte transfer passed: shipped Python client, multipart upload, completion, full streamed download hash.',flush=True)
    finally:request('/api/transfers/'+ready['id'],'DELETE')
