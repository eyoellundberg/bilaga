"""Run against local built Worker with --test-scheduled, never production."""
import json, os, subprocess
from integration import request

def sql(query):
    result = subprocess.run(['npx','wrangler','d1','execute','DB','--local','--config','wrangler.cloudflare.json','--persist-to','.wrangler/state','--command',query,'--json'], check=True, capture_output=True, text=True, env=dict(os.environ, WRANGLER_LOG_PATH='.wrangler/logs'))
    return json.loads(result.stdout)[0]['results']

pending,_=request('/api/transfers','POST',{'filename':'abandoned.txt','size_bytes':3},expect=201)
request('/api/transfers/'+pending['id']+'/parts/1','PUT',b'old')
active,_=request('/api/transfers','POST',{'filename':'keep.txt','size_bytes':4},expect=201)
request('/api/transfers/'+active['id']+'/parts/1','PUT',b'keep')
ready,_=request('/api/transfers/'+active['id']+'/complete','POST')
sql("UPDATE transfers SET expires_at=1 WHERE id='"+pending['id']+"'")
request('/cdn-cgi/handler/scheduled',auth=False)
rows=sql("SELECT state,upload_id,purged_at,(SELECT COUNT(*) FROM parts WHERE transfer_id=transfers.id) AS parts FROM transfers WHERE id='"+pending['id']+"'")
assert rows[0]['state']=='deleted' and rows[0]['upload_id'] is None and rows[0]['purged_at'] and rows[0]['parts']==0,rows
body,_=request('/api/download/'+ready['share_url'].rsplit('/',1)[1],auth=False)
assert body==b'keep'
request('/cdn-cgi/handler/scheduled',auth=False)
request('/api/transfers/'+active['id'],'DELETE')
print('Scheduled cleanup passed: unfinished upload aborted, storage purge recorded, parts removed, active file preserved, repeat run safe.')
