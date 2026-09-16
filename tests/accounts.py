"""Account regressions against local Worker/D1/R2 and simulated email only."""
import concurrent.futures, hashlib, json, os, secrets, subprocess, time
from integration import request, BASE

checks = 0

def sql(query):
    result = subprocess.run(['npx','wrangler','d1','execute','DB','--local','--config','wrangler.cloudflare.json','--persist-to','.wrangler/state','--command',query,'--json'], check=True, capture_output=True, text=True, env=dict(os.environ, WRANGLER_LOG_PATH='.wrangler/logs'))
    return json.loads(result.stdout)[0]['results']

def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def call(path, method='GET', body=None, cookie='', expect=200, origin=BASE):
    global checks
    result = request('/api/'+path, method, body, auth=False, headers={'Cookie':cookie,'Origin':origin}, expect=expect)
    checks += 1
    return result

def login(email):
    token, browser = secrets.token_hex(32), secrets.token_hex(32)
    sql(f"INSERT INTO login_links(hash,email,browser_hash,expires_at) VALUES('{digest(token)}','{email}','{digest(browser)}',{int(time.time()*1000)+900000})")
    call('auth/verify','POST',{'token':token},expect=400)
    _,headers = call('auth/verify','POST',{'token':token},cookie='bilaga_login='+browser)
    cookies = headers.get_all('Set-Cookie')
    assert any(c.startswith('bilaga_last=email') for c in cookies), cookies
    session = cookies[0].split(';')[0]
    call('auth/verify','POST',{'token':token},cookie='bilaga_login='+browser,expect=400)
    return session

# Local runs share one address all day; reset sign-in and signup limiters so this run tests its own behaviour.
sql("DELETE FROM rate_limits WHERE scope LIKE 'signup-%' OR scope LIKE 'login-%' OR scope LIKE 'verify:%'")
# An expired link cannot be consumed or create a session.
expired, browser = secrets.token_hex(32), secrets.token_hex(32)
sql(f"INSERT INTO login_links(hash,email,browser_hash,expires_at) VALUES('{digest(expired)}','expired-test@example.invalid','{digest(browser)}',1)")
call('auth/verify','POST',{'token':expired},cookie='bilaga_login='+browser,expect=400)
call('account',expect=401)
call('auth/request','POST',{'email':'invalid'},expect=400)
call('auth/request','POST',{'email':'account-test@example.invalid'},origin='https://attacker.invalid',expect=403)
# Native binding sends to a local simulator, never a real recipient.
_,headers=call('auth/request','POST',{'email':'delivery-test@example.invalid'})
assert 'HttpOnly' in headers['Set-Cookie'] and 'SameSite=Lax' in headers['Set-Cookie']
call('auth/request','POST',{'email':'delivery-test@example.invalid'},expect=429)
a = login('first-'+secrets.token_hex(4)+'@example.invalid')
b = login('second-'+secrets.token_hex(4)+'@example.invalid')
account,_=call('account',cookie=a)
email=account['email']
assert account['limits']['retention_days']==30 and account['limits']['free_stored_bytes']==5_000_000_000 and account['balance_cents']==0 and account['last_login_method']=='email'
# Card top-ups: refused amounts, unavailable without a Stripe key; the webhook credits once per session id and rejects bad signatures.
call('account/topup','POST',{'amount_cents':999},cookie=a,expect=400)
if account['top_ups']=='unavailable': call('account/topup','POST',{'amount_cents':1500},cookie=a,expect=503)
import hmac
acct_id=sql(f"SELECT id FROM accounts WHERE email='{email}'")[0]['id']
def stripe_event(session_id,amount=1500,status='paid',secret='whsec_localtest',ts=None,offer=None):
    body=json.dumps({'type':'checkout.session.completed','data':{'object':{'id':session_id,'payment_status':status,'amount_total':amount,'currency':'usd','metadata':{'account_id':acct_id}}}})
    if offer is not None:
        event=json.loads(body); event['data']['object']['metadata']['offer']=offer; body=json.dumps(event)
    ts=ts or int(time.time()); sig=hmac.new(secret.encode(),f'{ts}.{body}'.encode(),'sha256').hexdigest()
    return body.encode(),{'Stripe-Signature':f't={ts},v1={sig}','Content-Type':'application/json'}
body,h=stripe_event('cs_test_1'); request('/api/stripe/webhook','POST',body,auth=False,headers=h)
body,h=stripe_event('cs_test_1'); r,_=request('/api/stripe/webhook','POST',body,auth=False,headers=h); assert r['credited'] is False
body,h=stripe_event('cs_test_2',secret='wrong'); request('/api/stripe/webhook','POST',body,auth=False,headers=h,expect=400)
body,h=stripe_event('cs_test_3',ts=int(time.time())-3600); request('/api/stripe/webhook','POST',body,auth=False,headers=h,expect=400)
body,h=stripe_event('cs_test_4',status='unpaid'); request('/api/stripe/webhook','POST',body,auth=False,headers=h)
assert call('account',cookie=a)[0]['balance_cents']==1500
assert sql(f"SELECT kind,delta_cents FROM ledger WHERE account_id='{acct_id}'")==[{'kind':'purchase','delta_cents':1500}]
for sid,amount in [('cs_plus',1500),('cs_pro',3000)]:
    body,h=stripe_event(sid,amount=amount,offer='packs_2026_09')
    request('/api/stripe/webhook','POST',body,auth=False,headers=h)
    replay,_=request('/api/stripe/webhook','POST',body,auth=False,headers=h)
    assert replay['credited'] is False
assert call('account',cookie=a)[0]['balance_cents']==7000
for sid,amount,offer in [('cs_badpack',1000,'packs_2026_09'),('cs_badoffer',1500,'unknown')]:
    body,h=stripe_event(sid,amount=amount,offer=offer)
    request('/api/stripe/webhook','POST',body,auth=False,headers=h,expect=400)
assert call('account',cookie=a)[0]['balance_cents']==7000
credits=call('account',cookie=a)[0]['credit_lots']
assert sum(lot['remaining_cents'] for lot in credits)==7000
assert sum(lot['remaining_cents'] for lot in credits if lot['source']=='promotion')==1000
assert sum(lot['remaining_cents'] for lot in credits if lot['expires_at'] is None)==1500
# Local scheduled reminders are simulated and marked once; due lots expire on read.
plus=next(lot for lot in credits if lot['id']=='stripe_cs_plus_paid')
assert plus['expires_at'] > int(time.time()*1000)+1000*86400*1000
sql(f"UPDATE credit_lots SET expires_at={int(time.time()*1000)+10*86400*1000} WHERE account_id='{acct_id}' AND expires_at IS NOT NULL")
request('/cdn-cgi/handler/scheduled',auth=False)
reminded=sql(f"SELECT reminder_sent_at FROM credit_lots WHERE id='{plus['id']}'")[0]['reminder_sent_at']
assert reminded
assert sql(f"SELECT COUNT(DISTINCT reminder_sent_at) AS n,COUNT(*) AS lots FROM credit_lots WHERE account_id='{acct_id}' AND expires_at IS NOT NULL")[0]=={'n':1,'lots':3}
request('/cdn-cgi/handler/scheduled',auth=False)
assert sql(f"SELECT reminder_sent_at FROM credit_lots WHERE id='{plus['id']}'")[0]['reminder_sent_at']==reminded
sql(f"UPDATE credit_lots SET expires_at=1 WHERE id='{plus['id']}'")
assert call('account',cookie=a)[0]['balance_cents']==5500
assert call('account',cookie=a)[0]['balance_cents']==5500
assert sql(f"SELECT COUNT(*) AS n FROM ledger WHERE id='expiry_{plus['id']}'")[0]['n']==1
sql(f"DELETE FROM credit_lots WHERE account_id='{acct_id}'"); sql(f"UPDATE accounts SET balance_cents=0 WHERE id='{acct_id}'"); sql(f"DELETE FROM ledger WHERE account_id='{acct_id}'")
token,_=call('account/tokens','POST',{'label':'Synthetic agent'},cookie=a,expect=201)
assert 'token' in token
rows=sql(f"SELECT hash FROM api_tokens WHERE id='{token['id']}'")
assert rows[0]['hash']==digest(token['token'])
# One tier: a new account sends immediately, oversize files are refused, retention is 30 days.
request('/api/transfers','POST',{'filename':'too-big.bin','size_bytes':50_000_000_001},headers={'Authorization':'Bearer '+token['token']},expect=400)
free,_=request('/api/transfers','POST',{'filename':'free.txt','size_bytes':2},headers={'Authorization':'Bearer '+token['token']},expect=201)
request('/api/transfers/'+free['id']+'/parts/1','PUT',b'ok',headers={'Authorization':'Bearer '+token['token']})
free_done,_=request('/api/transfers/'+free['id']+'/complete','POST',headers={'Authorization':'Bearer '+token['token']})
from datetime import datetime as _dt
assert (_dt.fromisoformat(free_done['expires_at'].replace('Z','+00:00'))-_dt.fromisoformat(free_done['completed_at'].replace('Z','+00:00'))).total_seconds()==30*86400
assert free_done['content_hash'] and free_done['receipt_url'] and free_done['price_cents']==0 and free_done['paid'] is None
request('/api/transfers/'+free['id'],'DELETE',headers={'Authorization':'Bearer '+token['token']})
# Google sign-in: advertised only when configured, starts with a browser-bound state, refuses mismatched callbacks.
methods,_=call('auth/methods')
def no_follow(path, cookie=''):
    global checks; checks += 1
    from urllib.request import Request as _R, build_opener, HTTPRedirectHandler
    class Stop(HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    try:
        with build_opener(Stop()).open(_R(BASE+'/api/'+path, headers={'Cookie':cookie,'Origin':BASE})) as r: return r.status, r.headers
    except HTTPError as e: return e.code, e.headers
from urllib.error import HTTPError
if methods['google']:
    code,h=no_follow('auth/google'); assert code==302, code
    assert 'accounts.google.com' in h['Location'] and 'code_challenge=' in h['Location'] and 'bilaga_oauth=' in h['Set-Cookie'] and 'HttpOnly' in h['Set-Cookie']
    state=h['Location'].split('state=')[1].split('&')[0]
    oauth=h['Set-Cookie'].split(';')[0]
    code,h=no_follow('auth/google/callback?state=wrong&code=x',cookie=oauth); assert code==303 and 'error=' in h['Location']
    code,h=no_follow('auth/google/callback?state='+state+'&code=x',cookie=oauth); assert code==303 and 'error=' in h['Location']
    code,h=no_follow('auth/google/callback?state='+state+'&code=x'); assert code==303 and 'error=' in h['Location']
else:
    call('auth/google',expect=503)
call('account/tokens/'+token['id'],'DELETE',cookie=b)
request('/api/transfers',headers={'Authorization':'Bearer '+token['token']})
call('account','DELETE',{'confirmation':email},cookie='',expect=401)
call('account','DELETE',{'confirmation':'wrong'},cookie=a,expect=400)
owner=sql(f"SELECT id FROM accounts WHERE email='{email}'")[0]['id']
t,_=request('/api/transfers','POST',{'filename':'account-file.txt','size_bytes':3},headers={'Authorization':'Bearer '+token['token']},expect=201)
path='/api/transfers/'+t['id']
request(path+'/parts/1','PUT',b'abc',headers={'Authorization':'Bearer '+token['token']})
ready,_=request(path+'/complete','POST',headers={'Authorization':'Bearer '+token['token']})
other,_=call('account/tokens','POST',{'label':'Other agent'},cookie=b,expect=201)
request(path,headers={'Authorization':'Bearer '+other['token']},expect=404)
call('account/tokens/'+other['id'],'DELETE',cookie=b)
request('/api/transfers',headers={'Authorization':'Bearer '+other['token']},expect=401)
# An old session cannot delete an account, even with the right email.
sql(f"UPDATE sessions SET created_at=1 WHERE account_id='{owner}'")
call('account','DELETE',{'confirmation':email},cookie=a,expect=403)
sql(f"UPDATE sessions SET created_at={int(time.time()*1000)} WHERE account_id='{owner}'")
pending, pending_browser = secrets.token_hex(32), secrets.token_hex(32)
sql(f"INSERT INTO login_links(hash,email,browser_hash,expires_at) VALUES('{digest(pending)}','{email}','{digest(pending_browser)}',{int(time.time()*1000)+900000})")
call('account','DELETE',{'confirmation':email},cookie=a,expect=202)
call('auth/verify','POST',{'token':pending},cookie='bilaga_login='+pending_browser,expect=400)
call('account',cookie=a,expect=401)
request(path,headers={'Authorization':'Bearer '+token['token']},expect=401)
request('/api/download/'+ready['share_url'].rsplit('/',1)[1],auth=False,expect=404)
rows=sql(f"SELECT email,deleted_at FROM accounts WHERE id='{owner}'")
assert rows[0]['email'] is None and rows[0]['deleted_at']
request('/cdn-cgi/handler/scheduled',auth=False)
rows=sql(f"SELECT purged_at,filename,sender FROM transfers WHERE id='{t['id']}'")
assert rows[0]['purged_at'] and rows[0]['filename']=='Deleted file' and rows[0]['sender'] is None
sql(f"UPDATE accounts SET deleted_at=1 WHERE id='{owner}'")
request('/cdn-cgi/handler/scheduled',auth=False)
# The redacted transfer row and the email-less account tombstone stay, so the receipt keeps resolving.
assert sql(f"SELECT filename FROM transfers WHERE owner='{owner}'")[0]['filename']=='Deleted file'
assert sql(f"SELECT email,handle FROM accounts WHERE id='{owner}'")[0]['email'] is None
config,_=request('/api/config',auth=False)
if config.get('receipts')=='signed_ed25519':
    r,_=request('/api/receipts/'+ready['share_url'].rsplit('/',1)[1],auth=False)
    assert r['receipt']['status']=='deleted' and r['receipt']['filename']=='Deleted file' and r['receipt']['sender_account']
call('auth/logout','POST',cookie=b)
call('account',cookie=b,expect=401)
sql("DELETE FROM login_links WHERE email LIKE '%@example.invalid'")
print(f'{checks} account HTTP checks passed: simulated email, single-use browser-bound login, session cookies, account isolation, upload gate, token hashing/revocation, recent-login deletion, immediate link revocation, scheduled erasure, logout.')
