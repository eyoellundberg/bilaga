#!/usr/bin/env python3
"""Bilaga preview client. Python 3.10+, standard library only. Set BILAGA_TOKEN."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Refusing a redirect with your token. Check --base.')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', required=True, help='Bilaga HTTPS origin (no trailing path)')
actions=parser.add_mutually_exclusive_group(required=True)
actions.add_argument('--file', type=Path)
actions.add_argument('--status', metavar='TRANSFER_ID')
actions.add_argument('--delete', metavar='TRANSFER_ID')
actions.add_argument('--sent', metavar='TRANSFER_ID')
parser.add_argument('--resume', help='Resume a known upload ID; use with the same --file')
args=parser.parse_args()
origin=args.base.rstrip('/')
url=urlparse(origin)
if url.scheme!='https' and not (url.scheme=='http' and url.hostname in ('localhost','127.0.0.1')):
    parser.error('--base must use HTTPS (HTTP allowed only for localhost testing).')
if url.username or url.password or url.path or url.query or url.fragment:
    parser.error('--base must be an origin without credentials, path, query, or fragment.')
token=os.environ.get('BILAGA_TOKEN','').strip()
if not token:
    parser.error('Set BILAGA_TOKEN in your environment; do not put tokens in download links.')
opener=build_opener(NoRedirect)

def api(path, method='GET', data=None, retry=False):
    payload=json.dumps(data).encode() if isinstance(data,dict) else data
    headers={'User-Agent':'Bilaga-Client/0.1','Accept':'application/json','Authorization':'Bearer '+token,'Content-Type':'application/json' if isinstance(data,dict) else 'application/octet-stream'}
    for attempt in range(3 if retry else 1):
        try:
            with opener.open(Request(origin+'/api/'+path,data=payload,headers=headers,method=method),timeout=120) as res:
                return json.load(res)
        except HTTPError as e:
            message=e.read().decode('utf-8',errors='replace')
            if retry and (e.code>=500 or e.code==429) and attempt<2:
                time.sleep(min(60,max(1,int(e.headers.get('Retry-After','1')))) if e.code==429 else 2**attempt);continue
            raise RuntimeError(f'Bilaga returned {e.code}: {message}') from None
        except (URLError,TimeoutError) as e:
            if retry and attempt<2:
                time.sleep(2**attempt);continue
            raise RuntimeError(str(e)) from None
try:
    if args.status:
        result=api('transfers/'+args.status)
    elif args.delete:
        result=api('transfers/'+args.delete,'DELETE',retry=True)
    elif args.sent:
        result=api('transfers/'+args.sent+'/sent','POST',retry=True)
    else:
        path=args.file
        size=path.stat().st_size
        config=api('config')
        if not 0<size<=config['max_file_bytes']:
            raise RuntimeError(f"File must be non-empty and no larger than {config['max_file_bytes']} bytes.")
        if args.resume:
            transfer=api('transfers/'+args.resume)
            if transfer['filename']!=path.name or transfer['size_bytes']!=size:
                raise RuntimeError('Resume requires the same file name and size. Do not modify the file between attempts.')
        else:
            transfer=api('transfers','POST',{'filename':path.name,'size_bytes':size})
        tid=transfer['id']
        print('Transfer ID: '+tid+' (use --resume with the same unchanged file if interrupted)',file=sys.stderr)
        if transfer['status']=='complete':
            result=transfer
        else:
            uploaded={p['number'] for p in transfer.get('parts',[]) if p.get('etag')}
            with path.open('rb') as file:
                n=1
                while chunk:=file.read(transfer['part_size_bytes']):
                    if n not in uploaded:
                        api(f'transfers/{tid}/parts/{n}','PUT',chunk,retry=True)
                    n+=1
            result=api(f'transfers/{tid}/complete','POST',retry=True)
    print(json.dumps(result,indent=2))
except (RuntimeError,OSError,KeyError) as e:
    print(str(e),file=sys.stderr)
    sys.exit(1)
