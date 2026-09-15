#!/usr/bin/env python3
"""Bilaga client. Python 3.10+, standard library only. Set BILAGA_TOKEN to send; receipts verify without a token."""
# SPDX-License-Identifier: MIT
import argparse
import hashlib
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
actions.add_argument('--receipt', metavar='PUBLIC_ID', help='Fetch and verify the signed receipt for a share link')
parser.add_argument('--resume', help='Resume a known upload ID; use with the same --file')
parser.add_argument('--verify', type=Path, metavar='DOWNLOADED_FILE', help='With --receipt: check a downloaded file against the receipt')
args=parser.parse_args()
origin=args.base.rstrip('/')
url=urlparse(origin)
if url.scheme!='https' and not (url.scheme=='http' and url.hostname in ('localhost','127.0.0.1')):
    parser.error('--base must use HTTPS (HTTP allowed only for localhost testing).')
if url.username or url.password or url.path or url.query or url.fragment:
    parser.error('--base must be an origin without credentials, path, query, or fragment.')
token=os.environ.get('BILAGA_TOKEN','').strip()
if not token and not args.receipt:
    parser.error('Set BILAGA_TOKEN in your environment; do not put tokens in download links.')
opener=build_opener(NoRedirect)

# --- Receipt verification: pure-Python Ed25519 (RFC 8032) and the chunked content hash. ---
_p=2**255-19
_q=2**252+27742317777372353535851937790883648493
_d=(-121665*pow(121666,-1,_p))%_p
_sqrt_m1=pow(2,(_p-1)//4,_p)
def _add(P,Q):
    A=(P[1]-P[0])*(Q[1]-Q[0])%_p;B=(P[1]+P[0])*(Q[1]+Q[0])%_p
    C=2*P[3]*Q[3]*_d%_p;D=2*P[2]*Q[2]%_p
    E,F,G,H=B-A,D-C,D+C,B+A
    return (E*F%_p,G*H%_p,F*G%_p,E*H%_p)
def _mul(s,P):
    Q=(0,1,1,0)
    while s:
        if s&1:Q=_add(Q,P)
        P=_add(P,P);s>>=1
    return Q
def _recover_x(y,sign):
    if y>=_p:return None
    x2=(y*y-1)*pow(_d*y*y+1,-1,_p)%_p
    if x2==0:return None if sign else 0
    x=pow(x2,(_p+3)//8,_p)
    if (x*x-x2)%_p:x=x*_sqrt_m1%_p
    if (x*x-x2)%_p:return None
    if (x&1)!=sign:x=_p-x
    return x
def _decompress(b):
    if len(b)!=32:return None
    y=int.from_bytes(b,'little');sign=y>>255;y&=(1<<255)-1
    x=_recover_x(y,sign)
    return None if x is None else (x,y,1,x*y%_p)
_gy=4*pow(5,-1,_p)%_p;_gx=_recover_x(_gy,0);_G=(_gx,_gy,1,_gx*_gy%_p)
def ed25519_verify(public,message,signature):
    if len(public)!=32 or len(signature)!=64:return False
    A=_decompress(public);R=_decompress(signature[:32])
    if A is None or R is None:return False
    s=int.from_bytes(signature[32:],'little')
    if s>=_q:return False
    h=int.from_bytes(hashlib.sha512(signature[:32]+public+message).digest(),'little')%_q
    L=_mul(s,_G);Rh=_add(R,_mul(h,A))
    return (L[0]*Rh[2]-Rh[0]*L[2])%_p==0 and (L[1]*Rh[2]-Rh[1]*L[2])%_p==0
def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def content_hash(path,part_size):
    digests=hashlib.sha256()
    with path.open('rb') as f:
        while chunk:=f.read(part_size):
            digests.update(hashlib.sha256(chunk).digest())
    return digests.hexdigest()
def public_get(path):
    with opener.open(Request(origin+'/api/'+path,headers={'User-Agent':'Bilaga-Client/0.1','Accept':'application/json'}),timeout=60) as res:
        return json.load(res)
def verify_receipt(public_id,file=None):
    signed=public_get('receipts/'+public_id)
    key=public_get('receipt-key')
    receipt=signed['receipt']
    checks={'key_matches_published':signed['public_key_hex']==key['public_key_hex'] and signed['key_id']==key['key_id']}
    checks['signature_valid']=ed25519_verify(bytes.fromhex(key['public_key_hex']),canonical(receipt).encode(),bytes.fromhex(signed['signature_hex']))
    checks['transfer_matches']=receipt.get('transfer')==public_id and receipt.get('content_hash_algorithm')=='bilaga-chunked-sha256-8mib'
    if file is not None:
        checks['file_size_matches']=file.stat().st_size==receipt['size_bytes']
        checks['file_hash_matches']=checks['file_size_matches'] and content_hash(file,receipt['part_size_bytes'])==receipt['content_hash']
    return {'verified':all(checks.values()),'checks':checks,'receipt':receipt}

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
    if args.receipt:
        result=verify_receipt(args.receipt,args.verify)
        print(json.dumps(result,indent=2))
        sys.exit(0 if result['verified'] else 2)
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
