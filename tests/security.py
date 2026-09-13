"""Security regressions against LOCAL synthetic fixtures only; never public uploads."""
import concurrent.futures,gzip,hashlib,json,os,re,subprocess,time
from html.parser import HTMLParser
from integration import request,TOKEN

def sql(statement):
 subprocess.run(['npx','wrangler','d1','execute','DB','--local','--config',os.environ.get('BILAGA_TEST_CONFIG','wrangler.cloudflare.json'),'--persist-to','.wrangler/state','--command',statement],env=dict(os.environ,WRANGLER_LOG_PATH='.wrangler/logs'),check=True,stdout=subprocess.DEVNULL)

# Origin checks, strict body handling, missing auth, and unused framework endpoints.
request('/api/transfers','POST',{'filename':'a.txt','size_bytes':1},headers={'Origin':'https://attacker.invalid'},expect=403)
request('/api/transfers','POST',b'{}',headers={'Content-Type':'text/plain'},expect=415)
request('/api/transfers','POST',gzip.compress(b'{}'),headers={'Content-Encoding':'gzip'},expect=415)
request('/','POST',b'[]',auth=False,headers={'next-action':'untrusted'},expect=405)
request('/api/transfers','POST',b'{}',headers={'next-action':'untrusted'},expect=405)
request('/api/transfers','POST',{'filename':'x','size_bytes':1,'sender':'x'*5000},expect=413)
for name in ['CON','..','NUL.txt']:
 request('/api/transfers','POST',{'filename':name,'size_bytes':1},expect=400)

# Independent responses receive fresh nonces; caller-supplied CSP cannot choose them.
_,h1=request('/',auth=False,headers={'Content-Security-Policy':"script-src 'nonce-attacker'"})
_,h2=request('/',auth=False)
a=re.search("'nonce-([^']+)'",h1['Content-Security-Policy']).group(1)
b=re.search("'nonce-([^']+)'",h2['Content-Security-Policy']).group(1)
assert a!=b and a!='attacker'
assert "script-src-attr 'none'" in h1['Content-Security-Policy']
assert "frame-ancestors 'none'" in h1['Content-Security-Policy']
assert 'no-store' in h1['Cache-Control']

# A concurrent burst cannot allocate more than three unfinished uploads.
def create(i):
 try:
  return request('/api/transfers','POST',{'filename':f'concurrency-{i}.txt','size_bytes':1},expect=201)[0]
 except AssertionError as e:
  assert e.args[0][1]==429,e
  return None
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 created=[x for x in pool.map(create,range(10)) if x]
assert len(created)==3,created
for t in created:request('/api/transfers/'+t['id'],'DELETE')

# Chunks are immutable. Retrying matching bytes works; replacing them is blocked.
t,_=request('/api/transfers','POST',{'filename':'<script>probe</script>.html','size_bytes':3},expect=201)
p='/api/transfers/'+t['id']
request(p+'/parts/1','PUT',b'abc')
request(p+'/parts/1','PUT',b'abc')
request(p+'/parts/1','PUT',b'xyz',expect=409)
request(p+'/parts/1','PUT',b'long',expect=413)
ready,_=request(p+'/complete','POST')
link=ready['share_url'].split('http://localhost:3119',1)[1]
html,h=request(link,auth=False)
assert b'<script>probe' not in html
class Scripts(HTMLParser):
 def __init__(self):super().__init__();self.nonces=[]
 def handle_starttag(self,tag,attrs):
  if tag=='script':self.nonces.append(dict(attrs).get('nonce'))
parser=Scripts();parser.feed(html.decode())
nonce=re.search("'nonce-([^']+)'",h['Content-Security-Policy']).group(1)
assert parser.nonces and all(x==nonce for x in parser.nonces),parser.nonces
path='/api/download/'+link.rsplit('/',1)[1]
body,h=request(path,auth=False)
assert body==b'abc' and h['Content-Type']=='application/octet-stream'
assert 'sandbox' in h['Content-Security-Policy'] and 'attachment;' in h['Content-Disposition']
request(p,'DELETE')

# Concurrent completion preserves one link and expiry; deletion wins a race.
t,_=request('/api/transfers','POST',{'filename':'complete-race.txt','size_bytes':3},expect=201)
p='/api/transfers/'+t['id'];request(p+'/parts/1','PUT',b'abc')
def complete(_):
 try:return request(p+'/complete','POST')[0]
 except AssertionError as e:
  assert e.args[0][1]==409,e
  return None
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 results=[r for r in pool.map(complete,range(8)) if r]
assert results and len({r['share_url'] for r in results})==1 and len({r['expires_at'] for r in results})==1
request(p,'DELETE')
t,_=request('/api/transfers','POST',{'filename':'delete-race.txt','size_bytes':3},expect=201)
p='/api/transfers/'+t['id'];request(p+'/parts/1','PUT',b'abc')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 completion=pool.submit(request,p+'/complete','POST')
 deletion=pool.submit(request,p,'DELETE')
 deletion.result()
 try:completion.result()
 except AssertionError as e:assert e.args[0][1] in (409,410),e
status,_=request(p);assert status['status']=='deleted'

# A revoked record whose purge previously failed stays in the cleanup queue.
t,_=request('/api/transfers','POST',{'filename':'purge-retry.txt','size_bytes':1},expect=201)
p='/api/transfers/'+t['id'];request(p+'/parts/1','PUT',b'x');request(p+'/complete','POST')
sql("UPDATE transfers SET state='deleted',purged_at=NULL WHERE id='"+t['id']+"'")
r,_=request('/api/cleanup','POST');assert r['removed']>=1
status,_=request(p);assert status['status']=='deleted'

# Persisted quotas are enforced before R2 allocation, including across concurrent requests.
owner=hashlib.sha256(TOKEN.encode()).hexdigest();now=int(time.time()*1000)
sql(f"INSERT INTO transfers (id,public_id,owner,filename,size,state,created_at,expires_at,purged_at) VALUES ('audit-cap','audit-cap','{owner}','quota fixture',100000000000,'complete',{now},{now+60000},NULL)")
try:request('/api/transfers','POST',{'filename':'over-budget.txt','size_bytes':1},expect=429)
finally:sql("DELETE FROM transfers WHERE id='audit-cap'")

# The minute limiter produces a retry hint and can be reset by time, not browser state.
sql(f"INSERT INTO rate_limits (scope,hits,reset_at) VALUES ('owner:{owner}',300,{now+60000}) ON CONFLICT(scope) DO UPDATE SET hits=300,reset_at={now+60000}")
try:
 _,h=request('/api/transfers',expect=429);assert h['Retry-After']=='60'
finally:sql(f"DELETE FROM rate_limits WHERE scope='owner:{owner}'")
print('Security regressions passed: origin/encoding/body limits, nonce CSP, server-action rejection, atomic concurrent quotas, immutable chunks, safe file serving, purge retries, storage cap, and rate limiting.')
