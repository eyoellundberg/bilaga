"""Exercise the actual local Worker, D1, and R2. No mock storage."""
import hashlib,json,os,subprocess
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
BASE='http://localhost:3119'
TOKEN=Path('.bilaga-token').read_text().strip()
checks=0

def request(path,method='GET',body=None,auth=True,headers=None,expect=200):
    global checks
    h={'Authorization':'Bearer '+TOKEN} if auth else {}
    if headers:h.update(headers)
    if isinstance(body,dict):body=json.dumps(body).encode();h['Content-Type']='application/json'
    try:
        with urlopen(Request(BASE+path,data=body,method=method,headers=h),timeout=90) as r:status=r.status;data=r.read();rh=r.headers
    except HTTPError as e:status=e.code;data=e.read();rh=e.headers
    assert status==expect,(path,status,data[:300])
    checks+=1
    return (json.loads(data) if 'application/json' in rh.get('Content-Type','') and data else data),rh

def main():
    config,_=request('/api/config',auth=False);assert config['uploads_configured']
    request('/api/transfers',auth=False,expect=401)
    request('/api/transfers',headers={'Authorization':'Bearer wrong'},expect=401)
    request('/api/transfers','POST',{'filename':'empty.txt','size_bytes':0},expect=400)
    quote,_=request('/api/quote?bytes=50000000000',auth=False);assert quote['estimated_price_usd']==5 and not quote['upload_allowed']
    payload=os.urandom(8*1024*1024+123)
    t,_=request('/api/transfers','POST',{'filename':'test-å-report.bin','size_bytes':len(payload)},expect=201)
    tid=t['id'];path='/api/transfers/'+tid
    request(path+'/complete','POST',expect=409)
    request(path+'/parts/1','PUT',b'wrong',expect=400)
    request(path+'/parts/999','PUT',b'wrong',expect=400)
    for i,start in enumerate(range(0,len(payload),t['part_size_bytes']),1):
        request(path+f'/parts/{i}','PUT',payload[start:start+t['part_size_bytes']])
    request(path+'/parts/2','PUT',payload[t['part_size_bytes']:])
    status,_=request(path);assert len(status['parts'])==2
    ready,_=request(path+'/complete','POST');assert ready['charged_usd']==0
    again,_=request(path+'/complete','POST');assert again['expires_at']==ready['expires_at'] and again['share_url']==ready['share_url']
    link=ready['share_url'].replace(BASE,'')
    request(link,auth=False)
    download='/api/download/'+link.rsplit('/',1)[1]
    _,rh=request(download,'HEAD',auth=False);assert int(rh['Content-Length'])==len(payload)
    status,_=request(path);assert status['download_requests']==0
    chunk,rh=request(download,auth=False,headers={'Range':'bytes=7-19'},expect=206);assert chunk==payload[7:20]
    request(download,auth=False,headers={'Range':'bytes=999999999-'},expect=416)
    stored,rh=request(download,auth=False);assert hashlib.sha256(stored).digest()==hashlib.sha256(payload).digest()
    assert rh['Content-Type']=='application/octet-stream' and 'attachment;' in rh['Content-Disposition'] and 'no-store' in rh['Cache-Control']
    status,_=request(path);assert status['download_requests']==2
    sent,_=request(path+'/sent','POST');assert sent['sent_at']
    request(path,'DELETE');request(path,'DELETE')
    request(download,auth=False,expect=404)
    # Force time forwards for a separate local fixture; test actual expiry and cleanup.
    t,_=request('/api/transfers','POST',{'filename':'expiry.txt','size_bytes':3},expect=201)
    path='/api/transfers/'+t['id'];request(path+'/parts/1','PUT',b'bye');ready,_=request(path+'/complete','POST')
    sql="UPDATE transfers SET expires_at=1 WHERE id='"+t['id']+"'"
    env=dict(os.environ,WRANGLER_LOG_PATH='.wrangler/logs')
    subprocess.run(['npx','wrangler','d1','execute','DB','--local','--config','wrangler.local.json','--persist-to','.wrangler/state','--command',sql],env=env,check=True,stdout=subprocess.DEVNULL)
    download='/api/download/'+ready['share_url'].rsplit('/',1)[1]
    request(download,auth=False,expect=410)
    status,_=request(path);assert status['status']=='expired'
    result,_=request('/api/cleanup','POST');assert result['removed']>=1
    request(download,auth=False,expect=404)
    for page in ['/','/docs','/llms.txt','/bilaga.py']:request(page,auth=False)
    print(f'{checks} HTTP checks passed: multipart bytes, retries, authentication, completion, download ranges, status, deletion, expiry, cleanup, and documentation.')

if __name__=='__main__':
    main()
