import handler from 'vinext/server/fetch-handler';
import { cleanup, handleApi } from './lib/service';
import { PART_BYTES } from './lib/rules';

async function discardRejectedBody(request: Request) {
  if (!request.body || request.bodyUsed || request.body.locked) return;
  const reader = request.body.getReader();
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Body deadline')), 30_000);
  });
  try {
    while (bytes <= PART_BYTES) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) return;
      bytes += value.byteLength;
    }
  } catch {
    // A disconnected or stalled sender must not hold this request indefinitely.
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

const worker = {
  async fetch(...args: Parameters<typeof handler.fetch>) {
    const request = args[0];
    const api = new URL(request.url).pathname.startsWith('/api/');
    // Vinext middleware clones incoming bodies. Early rejection can cancel a
    // clone and abort workerd's connection. Dispatch explicit APIs directly,
    // retaining the same browser boundaries without cloning binary uploads.
    if (
      api ||
      request.headers.has('next-action') ||
      request.headers.has('x-rsc-action') ||
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ) {
      const rejected =
        request.headers.has('next-action') ||
        request.headers.has('x-rsc-action') ||
        !api;
      const response = rejected
        ? new Response('Method not allowed', {
            status: 405,
            headers: { Allow: 'GET, HEAD' },
          })
        : await handleApi(request);
      response.headers.set(
        'Content-Security-Policy',
        "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'",
      );
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('X-Frame-Options', 'DENY');
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      response.headers.set(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      );
      if (new URL(request.url).protocol === 'https:')
        response.headers.set('Strict-Transport-Security', 'max-age=31536000');
      // Consume a bounded rejected body without buffering it. Leaving even a
      // small body unread can cause the local workerd proxy to lose the reply.
      await discardRejectedBody(request);
      return response;
    }
    return handler.fetch(...args);
  },
  async scheduled() {
    // Bound each run. Failed deletions remain eligible for the next run.
    const removed = await cleanup();
    console.log(JSON.stringify({ event: 'scheduled_cleanup', removed }));
  },
};

export default worker;
