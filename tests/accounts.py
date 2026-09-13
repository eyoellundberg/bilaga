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
    session = headers.get_all('Set-Cookie')[0].split(';')[0]
    call('auth/verify','POST',{'token':token},cookie='bilaga_login='+browser,expect=400)
    return session

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
assert not account['uploads_enabled']
token,_=call('account/tokens','POST',{'label':'Synthetic agent'},cookie=a,expect=201)
assert 'token' in token
rows=sql(f"SELECT hash FROM api_tokens WHERE id='{token['id']}'")
assert rows[0]['hash']==digest(token['token'])
request('/api/transfers','POST',{'filename':'blocked.txt','size_bytes':1},headers={'Authorization':'Bearer '+token['token']},expect=403)
call('account/tokens/'+token['id'],'DELETE',cookie=b)
request('/api/transfers',headers={'Authorization':'Bearer '+token['token']})
call('account','DELETE',{'confirmation':email},cookie='',expect=401)
call('account','DELETE',{'confirmation':'wrong'},cookie=a,expect=400)
# Explicitly enable this synthetic account locally; public accounts remain gated.
owner=sql(f"SELECT id FROM accounts WHERE email='{email}'")[0]['id']
sql(f"UPDATE accounts SET uploads_enabled=1 WHERE id='{owner}'")
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
assert not sql(f"SELECT id FROM transfers WHERE owner='{owner}'")
assert not sql(f"SELECT id FROM accounts WHERE id='{owner}'")
call('auth/logout','POST',cookie=b)
call('account',cookie=b,expect=401)
sql("DELETE FROM login_links WHERE email LIKE '%@example.invalid'")
print(f'{checks} account HTTP checks passed: simulated email, single-use browser-bound login, session cookies, account isolation, upload gate, token hashing/revocation, recent-login deletion, immediate link revocation, scheduled erasure, logout.')
