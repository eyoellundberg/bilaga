declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    // Cloudflare Email Service binding; the plain-object form the Worker uses.
    EMAIL?: {
      send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
    };
    AUTH_ORIGIN?: string;
    BILAGA_TOKEN_HASH?: string;
    RECEIPT_SIGNING_KEY?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
  }
}
