import type { DiscountRule } from './billMath';
import type { VisitStatus } from './geo';
import type { Fix } from './location';

export type PaymentMode = 'cash' | 'upi' | 'credit';
export type Lang = 'en' | 'hi';

export interface Driver {
  id: number;
  name: string;
  phone: string;
}

export interface Auth {
  token: string;
  driver: Driver;
}

export interface Area {
  id: number;
  name: string;
}

export interface Store {
  id: number;
  areaId: number;
  name: string;
  ownerName: string | null;
  phone: string | null;
  address: string | null;
  /** Saved location (missing in lists downloaded by older app versions; null = none yet). */
  lat?: number | null;
  lng?: number | null;
  /** Who placed it: 'owner', or 'driver' (saved at the shop, not checked by the owner yet). */
  locationStatus?: 'owner' | 'driver' | null;
}

/** One of the driver's routes: the shops in order, on the days of the week it runs (1 = Monday … 7 = Sunday). */
export interface Route {
  id: number;
  name: string;
  days: string;
  storeIds: number[];
}

export interface Product {
  id: number;
  name: string;
  localName: string | null;
  pricePaise: number;
  color: string;
}

/** A shop's special rate on one product: percent (hundredths of a percent: 500 = 5%) or paise off each unit. */
export interface Discount {
  storeId: number;
  productId: number;
  kind: 'percent' | 'amount';
  value: number;
}

export interface Catalog {
  version: string;
  businessName: string;
  businessPhone: string;
  billFooter: string;
  cancelWindowMinutes: number;
  timezone: string;
  today: string;
  serverTime: string;
  areas: Area[];
  stores: Store[];
  products: Product[];
  /** Missing in lists downloaded by older app versions. */
  discounts?: Discount[];
  /** The driver's routes (missing in lists downloaded by older app versions). */
  routes?: Route[];
  /** How far (metres) from a shop the driver may be when making a bill or "no bill". */
  visitRadiusM?: number;
}

export interface BillLine {
  productId: number;
  name: string;
  unitPricePaise: number;
  quantity: number;
  /** The shop's discount on this product (none for older bills). */
  discount?: DiscountRule | null;
  discountPaise?: number;
  /** What the shop pays for this line: quantity × rate − discount. */
  lineTotalPaise: number;
}

/**
 * Expired units taken back. Their value (quantity × rate − the shop's discount) is taken off the bill.
 * Bills made by older app versions have no rate here: those returns cost nothing.
 */
export interface ReturnLine {
  productId: number;
  name: string;
  quantity: number;
  unitPricePaise?: number;
  discount?: DiscountRule | null;
  discountPaise?: number;
  /** Taken off the bill for these units. */
  creditPaise?: number;
}

/** A bill saved on the phone that has not reached the server yet. */
export interface PendingSale {
  clientId: string;
  driverId: number;
  storeId: number;
  storeName: string;
  areaId: number;
  areaName: string;
  soldAt: string;
  saleDate: string;
  paymentMode: PaymentMode;
  items: BillLine[];
  /** Missing in bills saved by older app versions. */
  returns?: ReturnLine[];
  /** Net amount: what was given minus the returns (below zero = the shop gets money back). */
  totalPaise: number;
  totalQuantity: number;
  /** Value of the returns (missing in bills saved by older app versions: 0). */
  returnedPaise?: number;
  attempts: number;
  lastError?: string;
  /** The server refused this bill (not a network problem). Needs the owner's help. */
  rejected?: boolean;
  /** Where the phone was when the bill was saved, and the route followed (missing in older bills). */
  visit?: { location: Fix | null; routeId: number | null };
}

/** Why a shop was visited without a bill. */
export type NoBillReason = 'closed' | 'stock_ok' | 'owner_away' | 'other';

/** A "no bill" visit saved on the phone that has not reached the server yet. */
export interface PendingVisit {
  clientId: string;
  driverId: number;
  storeId: number;
  storeName: string;
  reason: NoBillReason;
  note?: string;
  visitedAt: string;
  visitDate: string;
  location: Fix | null;
  routeId: number | null;
  attempts: number;
  lastError?: string;
  rejected?: boolean;
}

/** A "no bill" visit as stored on the server, with its location check. */
export interface ServerVisit {
  id: number;
  clientId: string;
  storeId: number;
  kind: 'bill' | 'no_bill';
  reason: NoBillReason | null;
  visitedAt: string;
  visitDate: string;
  routeId: number | null;
  status: VisitStatus;
  distanceM: number | null;
  radiusM: number;
}

/** A bill as stored on the server. */
export interface ServerSale {
  id: number;
  clientId: string;
  storeId: number;
  storeName: string;
  areaId: number;
  areaName: string;
  soldAt: string;
  saleDate: string;
  paymentMode: PaymentMode;
  totalPaise: number;
  totalQuantity: number;
  discountPaise?: number;
  returnedQuantity?: number;
  returnedPaise?: number;
  /** Location check (missing for bills made before visits were recorded). */
  visitStatus?: VisitStatus | null;
  visitDistanceM?: number | null;
  status: 'completed' | 'cancelled';
  cancelledBy: 'driver' | 'admin' | null;
  cancelReason: string | null;
  items: Array<{
    productId: number;
    productName: string;
    unitPricePaise: number;
    quantity: number;
    discountKind?: DiscountRule['kind'] | null;
    discountValue?: number | null;
    discountPaise?: number;
    lineTotalPaise: number;
  }>;
  returns?: Array<{
    productId: number;
    productName: string;
    quantity: number;
    unitPricePaise?: number;
    discountKind?: DiscountRule['kind'] | null;
    discountValue?: number | null;
    discountPaise?: number;
    creditPaise?: number;
  }>;
}

export interface DayHistory {
  date: string;
  sales: ServerSale[];
  /** "No bill" visits of that day (missing in days saved by older app versions). */
  visits?: ServerVisit[];
  settled: boolean;
  fetchedAt: number;
}

export type BillState = 'pending' | 'rejected' | 'sent' | 'cancelled';

/** One bill for display, whether it is still on the phone or already on the server. */
export interface BillView {
  key: string;
  id: number | null;
  storeId: number;
  storeName: string;
  areaName: string;
  soldAt: string;
  saleDate: string;
  paymentMode: PaymentMode;
  /** Net amount (given − returned). */
  totalPaise: number;
  totalQuantity: number;
  /** Value of the returns, already taken off totalPaise. */
  returnedPaise: number;
  items: BillLine[];
  returns: ReturnLine[];
  state: BillState;
  error?: string;
  cancelledBy?: 'driver' | 'admin' | null;
  /** The server's location check (sent bills only). */
  visitStatus?: VisitStatus | null;
  visitDistanceM?: number | null;
}

export interface Draft {
  storeId: number;
  areaId: number;
  qty: Record<number, number>;
  /** Expired units taken back, by product (missing in drafts saved by older app versions). */
  ret?: Record<number, number>;
  /** Which counts the +/− buttons change: what is sold, or expired bread taken back. */
  mode?: 'sale' | 'return';
  /** The bill was started from this route (its next shop is shown after saving). */
  routeId?: number | null;
  paymentMode: PaymentMode;
}

export type Screen =
  | { name: 'home' }
  | { name: 'areas' }
  | { name: 'shops'; areaId: number }
  | { name: 'addShop'; areaId: number }
  | { name: 'route' }
  | { name: 'cart' }
  | { name: 'review' }
  | { name: 'done'; key: string }
  | { name: 'bills'; date?: string }
  | { name: 'bill'; key: string; date: string };
