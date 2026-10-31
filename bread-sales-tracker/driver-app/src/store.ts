import { useSyncExternalStore } from 'react';
import { api, ApiError, configureApi, isTemporaryFailure, NetworkError } from './api';
import { dateIn } from './dates';
import { translate, type MessageKey } from './i18n';
import { load, save } from './storage';
import type {
  Auth,
  BillLine,
  BillView,
  Catalog,
  DayHistory,
  Draft,
  Lang,
  PaymentMode,
  PendingSale,
  Screen,
  ServerSale,
  Store,
} from './types';
import { uuid } from './uuid';

export const DEFAULT_SERVER_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
export const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '1.0.0';
const DEFAULT_TZ = 'Asia/Kolkata';
const HISTORY_DAYS_KEPT = 10;
const CATALOG_MAX_AGE_MS = 5 * 60 * 1000;

export interface DraftState extends Draft {
  storeName: string;
  areaName: string;
}

export interface State {
  lang: Lang;
  serverUrl: string;
  auth: Auth | null;
  authMessage: MessageKey | null;
  catalog: Catalog | null;
  catalogAt: number | null;
  catalogLoading: boolean;
  outbox: PendingSale[];
  history: Record<string, DayHistory>;
  historyLoading: boolean;
  online: boolean;
  syncing: boolean;
  draft: DraftState | null;
  lastAreaId: number | null;
  lastDriverId: number | null;
  stack: Screen[];
  toast: { text: string; kind: 'ok' | 'error' } | null;
}

// Saved on the phone so nothing is lost if the app is closed or the phone restarts.
const PERSISTED: Array<keyof State> = [
  'lang',
  'serverUrl',
  'auth',
  'catalog',
  'catalogAt',
  'outbox',
  'history',
  'draft',
  'lastAreaId',
  'lastDriverId',
];

let state: State = {
  lang: load<Lang>('lang', 'hi'),
  serverUrl: load<string>('serverUrl', DEFAULT_SERVER_URL),
  auth: load<Auth | null>('auth', null),
  authMessage: null,
  catalog: load<Catalog | null>('catalog', null),
  catalogAt: load<number | null>('catalogAt', null),
  catalogLoading: false,
  outbox: load<PendingSale[]>('outbox', []),
  history: load<Record<string, DayHistory>>('history', {}),
  historyLoading: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  syncing: false,
  draft: load<DraftState | null>('draft', null),
  lastAreaId: load<number | null>('lastAreaId', null),
  lastDriverId: load<number | null>('lastDriverId', null),
  stack: [{ name: 'home' }],
  toast: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const key of Object.keys(p) as Array<keyof State>) {
    if (PERSISTED.includes(key)) save(key, state[key]);
  }
  listeners.forEach((l) => l());
}

export function getState(): State {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return translate(state.lang, key, params);
}

export function timezone(): string {
  return state.catalog?.timezone || DEFAULT_TZ;
}

export function today(): string {
  return dateIn(timezone());
}

/** Turns any error into a message in the driver's language. */
export function errorText(err: unknown): string {
  if (err instanceof NetworkError) return t('errNoInternet');
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'wrong_credentials':
        return t('errWrongPin');
      case 'locked':
        return state.lang === 'en' ? err.message : t('errLocked');
      case 'driver_disabled':
        return t('errDisabled');
      case 'unauthorized':
        return t('errLoginAgain');
      case 'cancel_window_passed':
      case 'day_settled':
      case 'store_inactive':
        return err.message;
      default:
        return err.message || t('errGeneric');
    }
  }
  return t('errGeneric');
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(text: string, kind: 'ok' | 'error' = 'ok') {
  clearTimeout(toastTimer);
  setState({ toast: { text, kind } });
  toastTimer = setTimeout(() => setState({ toast: null }), kind === 'error' ? 4000 : 2500);
}

function applyApiConfig() {
  const base = state.serverUrl || (typeof window !== 'undefined' && !isNativeApp() ? window.location.origin : '');
  configureApi({ baseUrl: base, token: state.auth?.token ?? null });
}

export function isNativeApp(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/** Called when the server says our login is no longer valid (PIN changed, driver turned off). */
function handleUnauthorized(code?: string) {
  setState({
    auth: null,
    authMessage: code === 'driver_disabled' ? 'errDisabled' : 'errLoginAgain',
    stack: [{ name: 'home' }],
  });
  applyApiConfig();
}

function noteError(err: unknown) {
  if (err instanceof NetworkError) setState({ online: false });
  if (err instanceof ApiError && err.status === 401) handleUnauthorized(err.code);
}

// ---------- history helpers ----------

/** Keeps today, the given dates, and the most recently viewed days. */
function pruneHistory(history: Record<string, DayHistory>, keep: string[] = []): Record<string, DayHistory> {
  const must = new Set([today(), ...keep]);
  const days = Object.values(history);
  const others = days
    .filter((d) => !must.has(d.date))
    .sort((a, b) => b.fetchedAt - a.fetchedAt || b.date.localeCompare(a.date))
    .slice(0, HISTORY_DAYS_KEPT);
  const result: Record<string, DayHistory> = {};
  for (const d of days) if (must.has(d.date)) result[d.date] = d;
  for (const d of others) result[d.date] = d;
  return result;
}

function upsertSale(history: Record<string, DayHistory>, sale: ServerSale): Record<string, DayHistory> {
  const day = history[sale.saleDate] ?? { date: sale.saleDate, sales: [], settled: false, fetchedAt: 0 };
  const sales = [sale, ...day.sales.filter((s) => s.clientId !== sale.clientId)];
  return pruneHistory({ ...history, [sale.saleDate]: { ...day, sales } }, [sale.saleDate]);
}

function linesFromServer(sale: ServerSale): BillLine[] {
  return sale.items.map((i) => ({
    productId: i.productId,
    name: i.productName,
    unitPricePaise: i.unitPricePaise,
    quantity: i.quantity,
    lineTotalPaise: i.lineTotalPaise,
  }));
}

/** All bills of a day for the logged-in driver: sent ones from the server plus ones still on the phone. */
export function billsForDate(s: State, date: string): BillView[] {
  const driverId = s.auth?.driver.id;
  const server = s.history[date]?.sales ?? [];
  const seen = new Set(server.map((x) => x.clientId));
  const pending: BillView[] = s.outbox
    .filter((o) => o.driverId === driverId && o.saleDate === date && !seen.has(o.clientId))
    .map((o) => ({
      key: o.clientId,
      id: null,
      storeId: o.storeId,
      storeName: o.storeName,
      areaName: o.areaName,
      soldAt: o.soldAt,
      saleDate: o.saleDate,
      paymentMode: o.paymentMode,
      totalPaise: o.totalPaise,
      totalQuantity: o.totalQuantity,
      items: o.items,
      state: o.rejected ? 'rejected' : 'pending',
      error: o.lastError,
    }));
  const sent: BillView[] = server.map((x) => ({
    key: x.clientId,
    id: x.id,
    storeId: x.storeId,
    storeName: x.storeName,
    areaName: x.areaName,
    soldAt: x.soldAt,
    saleDate: x.saleDate,
    paymentMode: x.paymentMode,
    totalPaise: x.totalPaise,
    totalQuantity: x.totalQuantity,
    items: linesFromServer(x),
    state: x.status === 'cancelled' ? 'cancelled' : 'sent',
    cancelledBy: x.cancelledBy,
  }));
  return [...pending, ...sent].sort((a, b) => b.soldAt.localeCompare(a.soldAt));
}

export function findBill(s: State, key: string): BillView | undefined {
  for (const date of Object.keys(s.history)) {
    const found = billsForDate(s, date).find((b) => b.key === key);
    if (found) return found;
  }
  const pending = s.outbox.find((o) => o.clientId === key);
  return pending ? billsForDate(s, pending.saleDate).find((b) => b.key === key) : undefined;
}

export interface Totals {
  bills: number;
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  creditPaise: number;
  quantity: number;
}

export function summarize(bills: BillView[]): Totals {
  const t: Totals = { bills: 0, totalPaise: 0, cashPaise: 0, upiPaise: 0, creditPaise: 0, quantity: 0 };
  for (const b of bills) {
    if (b.state === 'cancelled') continue;
    t.bills++;
    t.totalPaise += b.totalPaise;
    t.quantity += b.totalQuantity;
    if (b.paymentMode === 'cash') t.cashPaise += b.totalPaise;
    if (b.paymentMode === 'upi') t.upiPaise += b.totalPaise;
    if (b.paymentMode === 'credit') t.creditPaise += b.totalPaise;
  }
  return t;
}

/** Shop ids that already have a (not cancelled) bill today, with the amount. */
export function billedToday(s: State): Map<number, number> {
  const map = new Map<number, number>();
  for (const b of billsForDate(s, today())) {
    if (b.state === 'cancelled') continue;
    map.set(b.storeId, (map.get(b.storeId) ?? 0) + b.totalPaise);
  }
  return map;
}

export function myPendingCount(s: State): { waiting: number; rejected: number; otherDriver: number } {
  const id = s.auth?.driver.id;
  let waiting = 0;
  let rejected = 0;
  let otherDriver = 0;
  for (const o of s.outbox) {
    if (o.driverId !== id) otherDriver++;
    else if (o.rejected) rejected++;
    else waiting++;
  }
  return { waiting, rejected, otherDriver };
}

// ---------- draft (bill being made) ----------

export function draftLines(s: State): BillLine[] {
  if (!s.draft || !s.catalog) return [];
  const lines: BillLine[] = [];
  for (const p of s.catalog.products) {
    const q = s.draft.qty[p.id] ?? 0;
    if (q > 0) lines.push({ productId: p.id, name: p.name, unitPricePaise: p.pricePaise, quantity: q, lineTotalPaise: q * p.pricePaise });
  }
  return lines;
}

export function linesTotal(lines: BillLine[]): { totalPaise: number; quantity: number } {
  return lines.reduce(
    (acc, l) => ({ totalPaise: acc.totalPaise + l.lineTotalPaise, quantity: acc.quantity + l.quantity }),
    { totalPaise: 0, quantity: 0 },
  );
}

// ---------- background work ----------

let catalogPromise: Promise<void> | null = null;
let syncPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 5000;

async function refreshCatalog(): Promise<void> {
  if (!state.auth) return;
  if (catalogPromise) return catalogPromise;
  setState({ catalogLoading: true });
  catalogPromise = (async () => {
    try {
      const catalog = await api.catalog();
      setState({ catalog, catalogAt: Date.now(), online: true });
    } catch (err) {
      noteError(err);
      throw err;
    } finally {
      setState({ catalogLoading: false });
      catalogPromise = null;
    }
  })();
  return catalogPromise;
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void syncNow(), retryDelay);
  retryDelay = Math.min(retryDelay * 2, 2 * 60 * 1000);
}

/** Sends bills saved on the phone to the server, oldest first. Safe to call any time. */
export function syncNow(): Promise<void> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const auth = state.auth;
    if (!auth) return;
    const queue = state.outbox.filter((o) => o.driverId === auth.driver.id && !o.rejected);
    if (queue.length === 0) return;
    setState({ syncing: true });
    let mustRetry = false;
    let catalogChanged = false;
    for (const sale of queue) {
      try {
        const res = await api.createSale({
          clientId: sale.clientId,
          storeId: sale.storeId,
          soldAt: sale.soldAt,
          paymentMode: sale.paymentMode,
          items: sale.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPricePaise: i.unitPricePaise })),
          totalPaise: sale.totalPaise,
        });
        setState((s) => ({
          outbox: s.outbox.filter((o) => o.clientId !== sale.clientId),
          history: upsertSale(s.history, res.sale),
          online: true,
        }));
        if (state.catalog && res.catalogVersion !== state.catalog.version) catalogChanged = true;
      } catch (err) {
        noteError(err);
        if (err instanceof ApiError && err.status === 401) {
          mustRetry = false;
          break;
        }
        const message = errorText(err);
        const temporary = isTemporaryFailure(err);
        setState((s) => ({
          outbox: s.outbox.map((o) =>
            o.clientId === sale.clientId ? { ...o, attempts: o.attempts + 1, lastError: message, rejected: !temporary } : o,
          ),
        }));
        if (temporary) {
          mustRetry = true;
          break;
        }
      }
    }
    setState({ syncing: false });
    if (mustRetry) scheduleRetry();
    else retryDelay = 5000;
    if (catalogChanged) void refreshCatalog().catch(() => undefined);
  })().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

async function loadDay(date: string): Promise<void> {
  if (!state.auth) return;
  setState({ historyLoading: true });
  try {
    const res = await api.sales(date);
    setState((s) => {
      // Keep bills we already know about that the answer may have missed (sent at the same moment).
      const previous = s.history[date]?.sales ?? [];
      const ids = new Set(res.sales.map((x) => x.clientId));
      const merged = [...res.sales, ...previous.filter((x) => !ids.has(x.clientId))];
      return {
        history: pruneHistory({ ...s.history, [date]: { date, sales: merged, settled: res.settled, fetchedAt: Date.now() } }, [date]),
        online: true,
      };
    });
  } catch (err) {
    noteError(err);
  } finally {
    setState({ historyLoading: false });
  }
}

/** Refresh things that may be out of date (called on start, when the app comes back, when internet returns). */
export function wakeUp(options: { force?: boolean } = {}) {
  if (!state.auth) return;
  const stale = !state.catalogAt || Date.now() - state.catalogAt > CATALOG_MAX_AGE_MS;
  if (options.force || stale || !state.catalog) void refreshCatalog().catch(() => undefined);
  void syncNow();
  void loadDay(today());
}

// ---------- actions used by the screens ----------

export const actions = {
  setLang(lang: Lang) {
    setState({ lang });
  },

  async setServerUrl(url: string): Promise<boolean> {
    const clean = url.trim().replace(/\/+$/, '');
    const target = clean || (isNativeApp() ? '' : window.location.origin);
    if (!target) return false;
    try {
      await api.health(target);
    } catch {
      return false;
    }
    setState({ serverUrl: clean });
    applyApiConfig();
    return true;
  },

  async login(phone: string, pin: string): Promise<void> {
    applyApiConfig();
    const res = await api.login(phone, pin);
    const sameDriver = state.lastDriverId === res.driver.id;
    setState({
      auth: res,
      authMessage: null,
      online: true,
      stack: [{ name: 'home' }],
      lastDriverId: res.driver.id,
      // The bill history is downloaded again; an unfinished bill is kept only for the same driver.
      history: sameDriver ? state.history : {},
      ...(sameDriver ? {} : { draft: null, lastAreaId: null }),
    });
    applyApiConfig();
    try {
      await refreshCatalog();
    } catch {
      // shown on the home screen
    }
    void syncNow();
    void loadDay(today());
  },

  logout() {
    setState({ auth: null, authMessage: null, draft: null, history: {}, stack: [{ name: 'home' }] });
    applyApiConfig();
  },

  refreshCatalog: () => refreshCatalog(),
  syncNow,
  loadDay,

  retryRejected(clientId: string) {
    setState((s) => ({
      outbox: s.outbox.map((o) => (o.clientId === clientId ? { ...o, rejected: false, lastError: undefined } : o)),
    }));
    retryDelay = 5000;
    void syncNow();
  },

  // Navigation
  go(screen: Screen) {
    setState((s) => ({ stack: [...s.stack, screen] }));
  },
  back() {
    setState((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : {}));
  },
  reset(...screens: Screen[]) {
    setState({ stack: screens.length ? screens : [{ name: 'home' }] });
  },

  // Bill making
  startBill(store: Store, areaName: string) {
    const d = state.draft;
    if (d && d.storeId === store.id) return; // continue the unfinished bill
    setState({
      draft: { storeId: store.id, storeName: store.name, areaId: store.areaId, areaName, qty: {}, paymentMode: 'cash' },
      lastAreaId: store.areaId,
    });
  },
  setQty(productId: number, qty: number) {
    if (!state.draft) return;
    const clean = Math.max(0, Math.min(9999, Math.floor(qty) || 0));
    const next = { ...state.draft.qty };
    if (clean === 0) delete next[productId];
    else next[productId] = clean;
    setState({ draft: { ...state.draft, qty: next } });
  },
  clearQty() {
    if (state.draft) setState({ draft: { ...state.draft, qty: {} } });
  },
  setPaymentMode(mode: PaymentMode) {
    if (state.draft) setState({ draft: { ...state.draft, paymentMode: mode } });
  },
  discardDraft() {
    setState({ draft: null });
  },

  /** Saves the bill on the phone first (never lost), then tries to send it. Returns the bill key. */
  saveBill(): string | null {
    const { draft, auth } = state;
    if (!draft || !auth) return null;
    const lines = draftLines(state);
    if (lines.length === 0) return null;
    const { totalPaise, quantity } = linesTotal(lines);
    const now = new Date();
    const sale: PendingSale = {
      clientId: uuid(),
      driverId: auth.driver.id,
      storeId: draft.storeId,
      storeName: draft.storeName,
      areaId: draft.areaId,
      areaName: draft.areaName,
      soldAt: now.toISOString(),
      saleDate: dateIn(timezone(), now),
      paymentMode: draft.paymentMode,
      items: lines,
      totalPaise,
      totalQuantity: quantity,
      attempts: 0,
    };
    setState((s) => ({ outbox: [...s.outbox, sale], draft: null }));
    retryDelay = 5000;
    void syncNow();
    return sale.clientId;
  },

  async cancelBill(bill: BillView): Promise<void> {
    if (!bill.id) return;
    try {
      const res = await api.cancelSale(bill.id);
      setState((s) => ({ history: upsertSale(s.history, res.sale), online: true }));
      showToast(t('billCancelled'));
    } catch (err) {
      noteError(err);
      showToast(err instanceof NetworkError ? t('cancelNeedsInternet') : errorText(err), 'error');
    }
  },

  async addShop(input: { areaId: number; name: string; ownerName?: string; phone?: string }): Promise<Store> {
    const res = await api.addStore(input);
    setState((s) => ({
      catalog: s.catalog
        ? { ...s.catalog, stores: [...s.catalog.stores.filter((x) => x.id !== res.store.id), res.store] }
        : s.catalog,
      online: true,
    }));
    return res.store;
  },

  setOnline(online: boolean) {
    if (online !== state.online) setState({ online });
    if (online) {
      retryDelay = 5000;
      wakeUp();
    }
  },
};

// ---------- start-up ----------

let started = false;
export function startApp() {
  if (started) return;
  started = true;
  applyApiConfig();
  window.addEventListener('online', () => actions.setOnline(true));
  window.addEventListener('offline', () => setState({ online: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wakeUp();
  });
  // Keep trying to send waiting bills while the app is open.
  setInterval(() => {
    if (state.auth && state.outbox.some((o) => o.driverId === state.auth!.driver.id && !o.rejected)) void syncNow();
  }, 60 * 1000);
  // Keep prices fresh while the app stays open all day.
  setInterval(() => {
    if (state.auth && document.visibilityState === 'visible') void refreshCatalog().catch(() => undefined);
  }, 10 * 60 * 1000);
  wakeUp();
}

/** Only for tests. */
export function __setStateForTests(patch: Partial<State>) {
  setState(patch);
}
