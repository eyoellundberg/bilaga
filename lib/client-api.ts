class RequestError extends Error {
  status: number;
  retryAfter: number | null;

  constructor(message: string, response: Response) {
    super(message);
    this.status = response.status;
    const header = response.headers.get('Retry-After');
    const seconds = header === null ? NaN : Number(header);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : header === null
        ? NaN
        : Date.parse(header) - Date.now();
    this.retryAfter = Number.isFinite(delay) ? Math.max(0, delay) : null;
  }
}

export async function request<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token.trim()}`);
  if (typeof options.body === 'string')
    headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    redirect: 'error',
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new RequestError(
      data?.error?.message || 'Please try again.',
      response,
    );
  }
  return response.json() as Promise<T>;
}

function wait(delay: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delay);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// Call only for idempotent operations, such as uploading the same chunk again.
export async function retryRequest<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      signal.throwIfAborted();
      const retryable =
        error instanceof RequestError
          ? error.status === 408 || error.status === 429 || error.status >= 500
          : error instanceof TypeError;
      if (!retryable || attempt === 2) throw error;
      await wait(
        error instanceof RequestError && error.retryAfter !== null
          ? error.retryAfter
          : 700 * (attempt + 1),
        signal,
      );
    }
  }
}

export async function uploadChunks(
  file: Blob,
  partSize: number,
  signal: AbortSignal,
  upload: (part: number, chunk: Blob) => Promise<unknown>,
  progress: (percent: number) => void,
) {
  if (!Number.isSafeInteger(partSize) || partSize <= 0)
    throw new Error('Invalid upload chunk size.');
  for (
    let offset = 0, part = 1;
    offset < file.size;
    offset += partSize, part++
  ) {
    const chunk = file.slice(offset, Math.min(file.size, offset + partSize));
    await retryRequest(() => upload(part, chunk), signal);
    progress(
      Math.round(Math.min(99, ((offset + chunk.size) / file.size) * 100)),
    );
  }
}
