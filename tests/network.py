"""Recipient identity and webhooks against the local Worker only. Starts a loopback webhook receiver."""
import hashlib, json, os, secrets, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from integration import request, BASE

checks = 0
def sql(query):
    result = subprocess.run(['npx','wrangler','d1','execute','DB','--local','--config','wrangler.cloudflare.json','--persist-to','.wrangler/state','--command',query,'--json'], check=True, capture_output=True, text=True, env=dict(os.environ, WRANGLER_LOG_PATH='.wrangler/logs'))
    return json.loads(result.stdout)[0]['results']
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def call(path, method='GET', body=None, cookie='', expect=200):
    global checks; checks += 1
    return request('/api/'+path, method, body, auth=False, headers={'Cookie':cookie,'Origin':BASE}, expect=expect)
def bearer(tok, path, method='GET', body=None, expect=200):
    global checks; checks += 1
    return request('/api/'+path, method, body, auth=False, headers={'Authorization':'Bearer '+tok}, expect=expect)[0]
def login(email):
    token, browser = secrets.token_hex(32), secrets.token_hex(32)
    sql(f"INSERT INTO login_links(hash,email,browser_hash,expires_at) VALUES('{digest(token)}','{email}','{digest(browser)}',{int(time.time()*1000)+900000})")
    _, headers = call('auth/verify','POST',{'token':token},cookie='bilaga_login='+browser)
    return headers.get_all('Set-Cookie')[0].split(';')[0]
def upload(tok, name, payload, **extra):
    t = bearer(tok,'transfers','POST',{'filename':name,'size_bytes':len(payload),**extra},expect=201)
    bearer(tok,f"transfers/{t['id']}/parts/1",'PUT',payload)
    return bearer(tok,f"transfers/{t['id']}/complete",'POST')

# Loopback receiver: /hook accepts, /broken fails, so retries are observable.
received = []
class Hook(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length','0')))
        received.append({'path':self.path,'headers':dict(self.headers),'body':json.loads(body)})
        self.send_response(500 if self.path=='/broken' else 200); self.end_headers()
    def log_message(self, *a): pass
server = HTTPServer(('127.0.0.1', 3120), Hook)
threading.Thread(target=server.serve_forever, daemon=True).start()
def wait_for(kind, count=1, timeout=15, public_id=None):
    for _ in range(timeout*10):
        hits=[r for r in received if r['body']['event']['type']==kind and (public_id is None or (r['body']['event'].get('transfer') or {}).get('public_id')==public_id)]
        if len(hits)>=count: return hits
        time.sleep(0.1)
    raise AssertionError(f'no {kind} event; got {[r["body"]["event"]["type"] for r in received]}')

sql("DELETE FROM webhooks WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE '%@example.invalid')")
a_email, b_email = f'sender-{secrets.token_hex(4)}@example.invalid', f'recipient-{secrets.token_hex(4)}@example.invalid'
a, b = login(a_email), login(b_email)
a_acct,_ = call('account',cookie=a); b_acct,_ = call('account',cookie=b)
assert a_acct['handle'].startswith('acct_') and a_acct['handle']!=b_acct['handle'] and a_acct['webhook_url'] is None
ta = call('account/tokens','POST',{'label':'A agent'},cookie=a,expect=201)[0]['token']
tb = call('account/tokens','POST',{'label':'B agent'},cookie=b,expect=201)[0]['token']

# Webhook registration: https-only for public hosts, loopback allowed locally, owner token refused.
request('/api/webhook','PUT',{'url':'http://127.0.0.1:3120/hook'},expect=403)
for bad in ['http://example.com/hook','https://10.0.0.1/hook','https://user:pw@example.com/x','ftp://example.com','https://intranet/x']:
    bearer(ta,'webhook','PUT',{'url':bad},expect=400)
hook = bearer(ta,'webhook','PUT',{'url':'http://127.0.0.1:3120/hook'})
assert hook['webhook']['url']=='http://127.0.0.1:3120/hook'
assert bearer(ta,'webhook')['webhook']['url']=='http://127.0.0.1:3120/hook'
test = bearer(ta,'webhook/test','POST'); assert test['delivered'] and test['status']==200, test
probe = wait_for('webhook.test')[0]
assert probe['headers']['X-Bilaga-Event']=='webhook.test' and probe['headers']['X-Bilaga-Delivery']==probe['body']['event']['id']
config,_ = request('/api/config',auth=False)
signed = config.get('receipts')=='signed_ed25519'
if signed:
    assert probe['headers']['X-Bilaga-Signature']==probe['body']['signature_hex'] and len(probe['body']['signature_hex'])==128
    verify = subprocess.run(['python3','public/bilaga.py','--base',BASE,'--verify-event'],input=json.dumps(probe['body']),capture_output=True,text=True)
    assert verify.returncode==0 and json.loads(verify.stdout)['verified'], verify.stdout[-300:]+verify.stderr[-300:]
    tampered = dict(probe['body']); tampered['event']=dict(tampered['event'],type='transfer.completed')
    verify = subprocess.run(['python3','public/bilaga.py','--base',BASE,'--verify-event'],input=json.dumps(tampered),capture_output=True,text=True)
    assert verify.returncode==2

# Addressing: invalid recipient and foreign reply are refused; a valid address is stored, not leaked publicly.
bearer(ta,'transfers','POST',{'filename':'x.txt','size_bytes':1,'to':'not-an-email'},expect=400)
bearer(ta,'transfers','POST',{'filename':'x.txt','size_bytes':1,'in_reply_to':'0'*32},expect=404)
payload = os.urandom(4096)
sent = upload(ta,'brief.bin',payload,to=b_email.upper(),sender='Agent A')
assert sent['to']==b_email and sent['addressed'] and sent['received_at'] is None
pid = sent['share_url'].rsplit('/',1)[1]
public,_ = request('/t/'+pid,auth=False); assert b_email.encode() not in public
completed = wait_for('transfer.completed',public_id=pid)[0]['body']['event']
assert completed['transfer']['public_id']==pid and completed['transfer']['to']==b_email
receipt,_ = request('/api/receipts/'+pid,auth=False,expect=200 if signed else 503)
if signed: assert receipt['receipt']['addressed'] and receipt['receipt']['sender_account']==a_acct['handle'] and receipt['receipt']['recipient_account'] is None

# The recipient's inbox shows it; a stranger's does not. Downloading with the recipient token records receipt.
inbox = bearer(tb,'inbox'); assert [t['public_id'] for t in inbox['transfers']]==[pid] and inbox['transfers'][0]['from_account']==a_acct['handle']
assert bearer(ta,'inbox')['transfers']==[]
assert call('account',cookie=b)[0]['inbox_count']==1
request('/api/download/'+pid,auth=False,headers={'Authorization':'Bearer wrong'},expect=401)
out = f'.wrangler/inbox-{pid}.bin'
dl = subprocess.run(['python3','public/bilaga.py','--base',BASE,'--download',pid,'--out',out],env=dict(os.environ,BILAGA_TOKEN=tb),capture_output=True,text=True)
assert dl.returncode==0 and json.loads(dl.stdout)['sha256']==hashlib.sha256(payload).hexdigest(), dl.stderr[-300:]
os.remove(out)
status = bearer(ta,'transfers/'+sent['id']); assert status['received_at'] and status['download_requests']==1
wait_for('transfer.downloaded',public_id=pid); rec = wait_for('transfer.received',public_id=pid)[0]['body']['event']
assert rec['transfer']['received_by']==b_acct['handle']
if signed:
    receipt,_ = request('/api/receipts/'+pid,auth=False); assert receipt['receipt']['recipient_account']==b_acct['handle'] and receipt['receipt']['received_at']
again = bearer(tb,'inbox/'+pid+'/received','POST'); assert again['received_at']==status['received_at']
bearer(ta,'inbox/'+pid+'/received','POST',expect=404)

# A reply defaults its recipient to the original sender and notifies them.
bearer(ta,'transfers','POST',{'filename':'x.txt','size_bytes':1,'in_reply_to':pid},expect=404)
reply = upload(tb,'answer.txt',b'thanks',in_reply_to=pid)
assert reply['to']==a_email and reply['in_reply_to']==pid
rpid = reply['share_url'].rsplit('/',1)[1]
notice = wait_for('transfer.reply',public_id=rpid)[0]['body']['event']
assert notice['transfer']['public_id']==rpid and notice['transfer']['in_reply_to']==pid and notice['transfer']['from_account']==b_acct['handle'] and 'id' not in notice['transfer']
assert bearer(ta,'inbox')['transfers'][0]['in_reply_to']==pid
if signed: assert request('/api/receipts/'+rpid,auth=False)[0]['receipt']['in_reply_to']==pid

# The event feed is signed, ordered, filterable, and pageable.
feed = bearer(ta,'events'); kinds=[e['event']['type'] for e in feed['events']]
assert kinds==['transfer.completed','transfer.downloaded','transfer.received','transfer.reply'], kinds
assert all(e['event']['id']<feed['next_since'] or e['event']['id']==feed['next_since'] for e in feed['events'])
if signed: assert all(len(e['signature_hex'])==128 for e in feed['events'])
page = bearer(ta,'events?since='+feed['events'][1]['event']['id']); assert [e['event']['type'] for e in page['events']]==['transfer.received','transfer.reply']
assert [e['event']['type'] for e in bearer(ta,'events?type=transfer.reply')['events']]==['transfer.reply']
bearer(ta,'events?since=bogus',expect=400)
assert bearer(tb,'events')['events'][0]['event']['type']=='transfer.completed'

# Priced transfers: addressed only, paid from balance, settled with a fee, downloadable only after payment.
OWNER=open('.bilaga-token').read().strip()
bearer(ta,'transfers','POST',{'filename':'x.txt','size_bytes':1,'price_cents':250},expect=400)
bearer(ta,'transfers','POST',{'filename':'x.txt','size_bytes':1,'to':b_email,'price_cents':-1},expect=400)
request('/api/transfers','POST',{'filename':'x.txt','size_bytes':1,'to':b_email,'price_cents':250},expect=403)
request('/api/credits','POST',{'email':b_email,'cents':300},headers={'Authorization':'Bearer '+tb},expect=403)
request('/api/credits','POST',{'email':'nobody@example.invalid','cents':300},expect=404)
grant,_=request('/api/credits','POST',{'email':b_email,'cents':300,'note':'test grant'}); assert grant['balance_cents']==300
priced = upload(ta,'paid.bin',b'secret',to=b_email,price_cents=250)
ppid = priced['share_url'].rsplit('/',1)[1]
assert priced['price_cents']==250 and priced['paid'] is False
request('/api/download/'+ppid,auth=False,expect=402)
request('/api/download/'+ppid,auth=False,headers={'Authorization':'Bearer '+tb},expect=402)
page,_=request('/t/'+ppid,auth=False); assert b'2.50' in page
entry=[t for t in bearer(tb,'inbox')['transfers'] if t['public_id']==ppid][0]; assert entry['pay_url'] and entry['paid'] is False
bearer(ta,'inbox/'+ppid+'/pay','POST',expect=404)
bearer(tb,'inbox/'+pid+'/pay','POST',expect=409)
sql(f"UPDATE accounts SET balance_cents=100 WHERE email='{b_email}'")
bearer(tb,'inbox/'+ppid+'/pay','POST',expect=402)
sql(f"UPDATE accounts SET balance_cents=300 WHERE email='{b_email}'")
paid = bearer(tb,'inbox/'+ppid+'/pay','POST'); assert paid['paid'] is True and paid['paid_at'] and paid['received_at'] and paid['pay_url'] is None
assert bearer(tb,'inbox/'+ppid+'/pay','POST')['paid_at']==paid['paid_at']
body,_=request('/api/download/'+ppid,auth=False); assert body==b'secret'
bal_b = bearer(tb,'balance'); bal_a = bearer(ta,'balance')
assert bal_b['balance_cents']==50 and bal_a['balance_cents']==238, (bal_b['balance_cents'],bal_a['balance_cents'])
assert bal_b['ledger'][0]['kind']=='payment' and bal_b['ledger'][0]['delta_cents']==-250 and bal_a['ledger'][0]['kind']=='sale' and bal_a['ledger'][0]['delta_cents']==238
assert sql("SELECT sum(delta_cents) AS s FROM ledger WHERE kind='fee' AND account_id='bilaga'")[0]['s']>=12
if signed:
    r=request('/api/receipts/'+ppid,auth=False)[0]['receipt']; assert r['price_cents']==250 and r['fee_cents']==12 and r['paid_by_account']==b_acct['handle'] and r['recipient_account']==b_acct['handle']
paid_event = wait_for('transfer.paid',public_id=ppid)[0]['body']['event']; assert paid_event['transfer']['paid_by']==b_acct['handle'] and paid_event['transfer']['net_cents']==238
assert [e['event']['type'] for e in bearer(tb,'events?type=transfer.paid')['events']]==['transfer.paid']
bearer(ta,'transfers/'+priced['id'],'DELETE')

# A failing endpoint is retried later, not dropped; removing the webhook stops retries.
bearer(tb,'webhook','PUT',{'url':'http://127.0.0.1:3120/broken'})
bearer(tb,'transfers/'+reply['id'],'DELETE')
time.sleep(1.5)
recent = bearer(tb,'webhook')['recent_deliveries']
assert recent and recent[0]['type']=='transfer.deleted' and recent[0]['last_status']==500 and not recent[0]['delivered'] and recent[0]['next_attempt_at'], recent
assert sql(f"SELECT next_attempt_at FROM events WHERE id='{recent[0]['id']}'")[0]['next_attempt_at']
bearer(tb,'webhook','DELETE')
assert sql(f"SELECT next_attempt_at FROM events WHERE id='{recent[0]['id']}'")[0]['next_attempt_at'] is None
assert bearer(tb,'webhook')['webhook'] is None
# The scheduled job drains due deliveries.
bearer(tb,'webhook','PUT',{'url':'http://127.0.0.1:3120/hook'})
sql(f"UPDATE events SET next_attempt_at=1 WHERE id='{recent[0]['id']}'")
request('/cdn-cgi/handler/scheduled',auth=False)
assert sql(f"SELECT delivered_at FROM events WHERE id='{recent[0]['id']}'")[0]['delivered_at']

bearer(ta,'transfers/'+sent['id'],'DELETE'); wait_for('transfer.deleted',public_id=pid)
# Deleting the recipient account un-addresses transfers sent to it and drops its webhook and events.
sql(f"UPDATE sessions SET created_at={int(time.time()*1000)}")
call('account','DELETE',{'confirmation':b_email},cookie=b,expect=202)
b_id = sql(f"SELECT id FROM accounts WHERE handle='{b_acct['handle']}'")[0]['id']
assert not sql(f"SELECT 1 FROM transfers WHERE recipient='{b_email}'") and not sql(f"SELECT 1 FROM webhooks WHERE account_id='{b_id}'") and not sql(f"SELECT 1 FROM events WHERE account_id='{b_id}'")
bearer(ta,'webhook','DELETE')
sql("DELETE FROM login_links WHERE email LIKE '%@example.invalid'")
server.shutdown()
print(f'{checks} network checks passed: account handles, webhook validation and signed delivery, addressed transfers, private inbox, received-by identity in receipts, reply chaining, event feed paging, retry and scheduled drain, deletion redaction.')
