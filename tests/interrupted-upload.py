"""Kill and restart the shipped client against disposable LOCAL storage."""
import hashlib, json, os, secrets, sqlite3, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import urlopen
from integration import request, BASE

owner=secrets.token_hex(16)
token='bilaga_'+secrets.token_hex(32)
email='interruption-'+owner+'@example.invalid'
def sql(statement):
    result=subprocess.run(['npx','wrangler','d1','execute','DB','--local','--config','wrangler.cloudflare.json','--persist-to','.wrangler/state','--command',statement,'--json'],env=dict(os.environ,WRANGLER_LOG_PATH='.wrangler/logs'),check=True,capture_output=True,text=True)
    return json.loads(result.stdout)[0]['results']
def call(path,method='GET',body=None,expect=200):
    return request('/api/'+path,method,body,auth=False,headers={'Authorization':'Bearer '+token},expect=expect)[0]
def completed_parts(tid):
    for path in Path('.wrangler/state/v3/d1').rglob('*.sqlite'):
        with sqlite3.connect(f'file:{path}?mode=ro',uri=True) as database:
            try:
                count=database.execute("SELECT count(*) FROM parts WHERE transfer_id=? AND etag<>''",(tid,)).fetchone()[0]
                if count:return count
            except sqlite3.OperationalError:pass
    return 0
sql(f"INSERT INTO accounts(id,email,created_at,uploads_enabled) VALUES('{owner}','{email}',{int(time.time()*1000)},1)")
sql(f"INSERT INTO api_tokens(id,account_id,hash,label,created_at) VALUES('{secrets.token_hex(16)}','{owner}','{hashlib.sha256(token.encode()).hexdigest()}','Disposable restart test',{int(time.time()*1000)})")
tid=None
try:
    with tempfile.TemporaryDirectory(prefix='bilaga-interrupt-') as directory:
        file=Path(directory)/'interrupted.bin'
        size=96*1024*1024+123
        with file.open('wb') as stream:stream.truncate(size)
        command=[sys.executable,'public/bilaga.py','--base',BASE,'--file',str(file)]
        env=dict(os.environ,BILAGA_TOKEN=token)
        child=subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            line=child.stderr.readline()
            assert line.startswith('Transfer ID: '),line
            tid=line.split()[2]
            deadline=time.monotonic()+60
            while completed_parts(tid)<2:
                assert child.poll() is None,'Client finished before interruption'
                assert time.monotonic()<deadline,'First chunks did not finish'
                time.sleep(.05)
            child.terminate()
            child.wait(timeout=10)
        finally:
            if child.poll() is None:child.kill();child.wait()
        before=call('transfers/'+tid)
        assert before['status']=='uploading' and 2<=len([p for p in before['parts'] if p['etag']])<13
        confirmed={p['number']:p['etag'] for p in before['parts'] if p['etag']}
        resumed=subprocess.run(command+['--resume',tid],env=env,check=True,capture_output=True,text=True)
        ready=json.loads(resumed.stdout)
        assert ready['id']==tid and ready['status']=='complete'
        after=call('transfers/'+tid)
        assert all(next(p['etag'] for p in after['parts'] if p['number']==n)==etag for n,etag in confirmed.items())
        expected=hashlib.sha256();actual=hashlib.sha256();total=0
        with file.open('rb') as stream:
            while chunk:=stream.read(8*1024*1024):expected.update(chunk)
        with urlopen(BASE+'/api/download/'+ready['share_url'].rsplit('/',1)[1],timeout=120) as stream:
            while chunk:=stream.read(8*1024*1024):actual.update(chunk);total+=len(chunk)
        assert total==size and actual.digest()==expected.digest()
        print(f'Interrupted-client recovery passed: terminated after {len(confirmed)} confirmed chunks; restarted with the same ID, retained ETags, completed {size:,} bytes, and verified the full download hash.')
finally:
    if tid:
        subprocess.run([sys.executable,'public/bilaga.py','--base',BASE,'--delete',tid],env=dict(os.environ,BILAGA_TOKEN=token),check=True,capture_output=True)
    sql(f"DELETE FROM api_tokens WHERE account_id='{owner}'")
    sql(f"DELETE FROM accounts WHERE id='{owner}'")
    sql(f"DELETE FROM transfers WHERE owner='{owner}' AND purged_at IS NOT NULL")
