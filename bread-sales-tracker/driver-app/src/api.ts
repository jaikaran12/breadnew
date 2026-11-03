import type { DiscountRule } from './billMath';
import type { Catalog, Driver, PaymentMode, ServerSale, Store } from './types';

/** The server answered with an error (wrong PIN, validation problem, ...). */
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

/** Could not reach the server at all (no internet, server down, timeout). */
export class NetworkError extends Error {
  constructor() {
    super('network');
  }
}

export function isTemporaryFailure(err: unknown): boolean {
  return err instanceof NetworkError || (err instanceof ApiError && (err.status >= 500 || err.status === 429 || err.status === 408));
}

let baseUrl = '';
let token: string | null = null;

export function configureApi(options: { baseUrl: string; token: string | null }) {
  baseUrl = options.baseUrl.replace(/\/+$/, '');
  token = options.token;
}

// 30 s: generous for a slow mobile connection; bills that time out stay on the phone and are sent again
// (the server recognises a bill it already has, so it is never saved twice).
async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string; details?: unknown };
    throw new ApiError(res.status, d.error || `Server error ${res.status}`, d.code, d.details);
  }
  return data as T;
}

export const api = {
  login: (phone: string, pin: string) => request<{ token: string; driver: Driver }>('POST', '/api/driver/login', { phone, pin }),
  catalog: () => request<Catalog>('GET', '/api/driver/catalog'),
  catalogVersion: () => request<{ version: string }>('GET', '/api/driver/catalog/version', undefined, 10000),
  createSale: (sale: {
    clientId: string;
    storeId: number;
    soldAt: string;
    paymentMode: PaymentMode;
    items: Array<{ productId: number; quantity: number; unitPricePaise: number; discount?: DiscountRule }>;
    returns: Array<{ productId: number; quantity: number }>;
    totalPaise: number;
  }) => request<{ sale: ServerSale; created: boolean; catalogVersion: string }>('POST', '/api/driver/sales', sale),
  sales: (date: string) =>
    request<{ date: string; today: string; settled: boolean; sales: ServerSale[]; cancelWindowMinutes: number }>(
      'GET',
      `/api/driver/sales?date=${encodeURIComponent(date)}`,
    ),
  cancelSale: (id: number) => request<{ sale: ServerSale }>('POST', `/api/driver/sales/${id}/cancel`, {}),
  addStore: (store: { areaId: number; name: string; ownerName?: string; phone?: string }) =>
    request<{ store: Store; created: boolean }>('POST', '/api/driver/stores', store),
};
