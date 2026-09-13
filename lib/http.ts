export const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
export async function boundedBody(req: Request, limit: number) {
  if (!req.body) return new Uint8Array();
  const declared = req.headers.get('Content-Length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limit)
  ) {
    return fail(413, 'too_large', 'Request exceeds its allowed size.');
  }
  const reader = req.body.getReader(),
    data = new Uint8Array(limit);
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new ApiError(
          408,
          'upload_timeout',
          'Upload chunk timed out. Retry this chunk.',
        ),
      );
    }, 30_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (total + value.byteLength > limit) {
        return fail(413, 'too_large', 'Request exceeds its allowed size.');
      }
      data.set(value, total);
      total += value.byteLength;
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  return data.subarray(0, total);
}
export async function bodyJson(req: Request) {
  try {
    return JSON.parse(new TextDecoder().decode(await boundedBody(req, 4096)));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return fail(400, 'invalid_json', 'Send a JSON object.');
  }
}
