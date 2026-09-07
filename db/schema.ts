import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
export const transfers = sqliteTable('transfers', {
  id: text('id').primaryKey(), publicId: text('public_id').notNull().unique(), owner: text('owner').notNull(),
  filename: text('filename').notNull(), size: integer('size').notNull(), sender: text('sender'),
  uploadId: text('upload_id'), state: text('state').notNull(), createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(), completedAt: integer('completed_at'), sentAt: integer('sent_at'),
  downloadRequests: integer('download_requests').notNull().default(0), lastDownloadAt: integer('last_download_at'),
}, t => [index('idx_transfers_owner_created').on(t.owner,t.createdAt),index('idx_transfers_expiry').on(t.expiresAt)]);
export const parts = sqliteTable('parts', {
  transferId: text('transfer_id').notNull().references(()=>transfers.id), number: integer('number').notNull(),
  etag: text('etag').notNull(), size: integer('size').notNull(),
}, t => [primaryKey({columns:[t.transferId,t.number]})]);
