export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your internet connection.');
  }
  const data = (await res.json().catch(() => null)) as { error?: string; code?: string; details?: unknown } | null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/login')) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T,>(path: string, query?: Query) => request<T>('GET', `${path}${qs(query)}`),
  post: <T,>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T,>(path: string, query?: Query) => request<T>('DELETE', `${path}${qs(query)}`),
};
