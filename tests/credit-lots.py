"""Deterministic transaction regressions using the real migration and triggers."""
import sqlite3
from pathlib import Path

db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
for path in sorted(Path('drizzle').glob('*.sql')):
    if path.name.startswith('0009'):
        db.execute("INSERT INTO accounts(id,email,created_at,balance_cents) VALUES('legacy','legacy@example.invalid',1,75)")
    db.executescript(path.read_text())
assert dict(db.execute("SELECT remaining_cents,expires_at FROM credit_lots WHERE account_id='legacy'").fetchone()) == {'remaining_cents':75,'expires_at':None}
db.execute("INSERT INTO accounts(id,email,created_at) VALUES('a','a@example.invalid',1)")
db.commit()

def ledger(id, cents, kind, at, expiry=None, paid=None, transfer=None):
    with db:
        db.execute('UPDATE accounts SET balance_cents=balance_cents+? WHERE id=?',(cents,'a'))
        db.execute('INSERT INTO ledger(id,account_id,delta_cents,balance_after,kind,created_at,expires_at,paid_cents,transfer_id) SELECT ?,id,?,balance_cents,?,?,?,?,? FROM accounts WHERE id=?',(id,cents,kind,at,expiry,paid,transfer,'a'))
def balance(): return db.execute("SELECT balance_cents FROM accounts WHERE id='a'").fetchone()[0]
def remaining(id): return db.execute('SELECT remaining_cents FROM credit_lots WHERE id=?',(id,)).fetchone()[0]
def expire(at):
    with db:
        db.execute("INSERT OR IGNORE INTO ledger(id,account_id,delta_cents,balance_after,kind,credit_lot_id,created_at) SELECT 'expiry_'||id,account_id,-remaining_cents,0,'expiry',id,? FROM credit_lots WHERE remaining_cents>0 AND expires_at<=?",(at,at))

ledger('p1',1500,'purchase',10,100,1500)
ledger('p2',4000,'purchase',20,200,3000)
assert balance()==5500 and remaining('p2_promo')==1000
ledger('c1',-1600,'charge',30,transfer='t1')
assert remaining('p1_paid')==0 and remaining('p2_paid')==2900
ledger('r1',1600,'refund',40,transfer='t1')
assert remaining('p1_paid')==1500 and remaining('p2_paid')==3000 and balance()==5500
ledger('c2',-1600,'charge',50,transfer='t2')
# A refund after the first purchase expires restores only the still-valid $1.
ledger('r2',1600,'refund',110,transfer='t2')
assert balance()==4000 and remaining('p1_paid')==0 and remaining('p2_paid')==3000
assert db.execute("SELECT delta_cents FROM ledger WHERE id='r2'").fetchone()[0]==100
# Expired lots cannot be spent even before a scheduled expiry sweep runs.
try:
    ledger('expired',-25,'charge',201,transfer='t3')
    raise AssertionError('expired credit was spent')
except sqlite3.IntegrityError as error:
    assert 'insufficient_credit' in str(error)
assert balance()==4000 and not db.execute("SELECT 1 FROM ledger WHERE id='expired'").fetchone()
expire(201); expire(201)
assert balance()==0 and remaining('p2_paid')==0 and remaining('p2_promo')==0
assert db.execute("SELECT COUNT(*) FROM ledger WHERE kind='expiry'").fetchone()[0]==2
# Grants are non-expiring; failed ledger inserts roll back the balance change.
ledger('g1',100,'grant',300)
try:
    ledger('g1',100,'grant',301)
    raise AssertionError('duplicate ledger entry accepted')
except sqlite3.IntegrityError: pass
assert balance()==100
ledger('c3',-100,'charge',400,transfer='t4')
ledger('r3',100,'refund',500,transfer='t4')
assert balance()==100 and remaining('g1_paid')==100
# Refunds for pre-migration unfinished uploads retain non-expiring terms.
ledger('legacy-refund',25,'refund',600,transfer='old-transfer')
assert balance()==125 and remaining('legacy-refund')==25
# Retained credit records must not block the global sweep after account erasure.
ledger('orphan-purchase',50,'purchase',700,800,50)
db.execute("DELETE FROM accounts WHERE id='a'"); db.commit()
expire(900)
assert remaining('orphan-purchase_paid')==0
print('Credit lot regressions passed: migration, FIFO, promotional tracking, refunds, expiry, idempotency, rollback and legacy terms.')
