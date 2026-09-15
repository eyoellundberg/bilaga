import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
export const transfers = sqliteTable(
  'transfers',
  {
    id: text('id').primaryKey(),
    publicId: text('public_id').notNull().unique(),
    owner: text('owner').notNull(),
    filename: text('filename').notNull(),
    size: integer('size').notNull(),
    sender: text('sender'),
    uploadId: text('upload_id'),
    state: text('state').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    completedAt: integer('completed_at'),
    sentAt: integer('sent_at'),
    purgedAt: integer('purged_at'),
    completionLockUntil: integer('completion_lock_until').notNull().default(0),
    downloadRequests: integer('download_requests').notNull().default(0),
    lastDownloadAt: integer('last_download_at'),
    contentHash: text('content_hash'),
    recipient: text('recipient'),
    receivedAt: integer('received_at'),
    receivedBy: text('received_by'),
    inReplyTo: text('in_reply_to'),
    priceCents: integer('price_cents').notNull().default(0),
    paidAt: integer('paid_at'),
    paidBy: text('paid_by'),
    receiptRequests: integer('receipt_requests').notNull().default(0),
  },
  (t) => [
    index('idx_transfers_recipient').on(t.recipient, t.completedAt),
    index('idx_transfers_content_hash').on(t.contentHash),
    index('idx_transfers_owner_created').on(t.owner, t.createdAt),
    index('idx_transfers_expiry').on(t.expiresAt),
    index('idx_transfers_pending_cleanup').on(t.purgedAt, t.expiresAt),
  ],
);
export const parts = sqliteTable(
  'parts',
  {
    transferId: text('transfer_id')
      .notNull()
      .references(() => transfers.id),
    number: integer('number').notNull(),
    etag: text('etag').notNull(),
    size: integer('size').notNull(),
    contentHash: text('content_hash'),
  },
  (t) => [primaryKey({ columns: [t.transferId, t.number] })],
);

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    scope: text('scope').primaryKey(),
    hits: integer('hits').notNull(),
    resetAt: integer('reset_at').notNull(),
  },
  (t) => [index('idx_rate_limits_reset').on(t.resetAt)],
);

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  createdAt: integer('created_at').notNull(),
  deletedAt: integer('deleted_at'),
  uploadsEnabled: integer('uploads_enabled').notNull().default(0),
  handle: text('handle').unique(),
  balanceCents: integer('balance_cents').notNull().default(0),
  lastLoginMethod: text('last_login_method'),
});
export const loginLinks = sqliteTable(
  'login_links',
  {
    hash: text('hash').primaryKey(),
    email: text('email').notNull(),
    browserHash: text('browser_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    index('idx_login_links_email').on(t.email),
    index('idx_login_links_expiry').on(t.expiresAt),
  ],
);
export const sessions = sqliteTable(
  'sessions',
  {
    hash: text('hash').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    index('idx_sessions_account').on(t.accountId),
    index('idx_sessions_expiry').on(t.expiresAt),
  ],
);
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    hash: text('hash').notNull().unique(),
    label: text('label').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_tokens_account').on(t.accountId)],
);


export const webhooks = sqliteTable('webhooks', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id),
  url: text('url').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at'),
    deliveredAt: integer('delivered_at'),
    lastStatus: integer('last_status'),
  },
  (t) => [
    index('idx_events_account_created').on(t.accountId, t.createdAt),
    index('idx_events_pending').on(t.nextAttemptAt),
  ],
);
export const ledger = sqliteTable(
  'ledger',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    deltaCents: integer('delta_cents').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    kind: text('kind').notNull(),
    transferId: text('transfer_id'),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('idx_ledger_account_created').on(t.accountId, t.createdAt)],
);

// Retained from the waitlist era; no longer written. Drop in a later migration once exported.
export const waitlist = sqliteTable('waitlist', {
  email: text('email').primaryKey(),
  createdAt: integer('created_at').notNull(),
});
