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
}

export interface Product {
  id: number;
  name: string;
  localName: string | null;
  pricePaise: number;
  color: string;
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
}

export interface BillLine {
  productId: number;
  name: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
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
  totalPaise: number;
  totalQuantity: number;
  attempts: number;
  lastError?: string;
  /** The server refused this bill (not a network problem). Needs the owner's help. */
  rejected?: boolean;
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
  status: 'completed' | 'cancelled';
  cancelledBy: 'driver' | 'admin' | null;
  cancelReason: string | null;
  items: Array<{ productId: number; productName: string; unitPricePaise: number; quantity: number; lineTotalPaise: number }>;
}

export interface DayHistory {
  date: string;
  sales: ServerSale[];
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
  totalPaise: number;
  totalQuantity: number;
  items: BillLine[];
  state: BillState;
  error?: string;
  cancelledBy?: 'driver' | 'admin' | null;
}

export interface Draft {
  storeId: number;
  areaId: number;
  qty: Record<number, number>;
  paymentMode: PaymentMode;
}

export type Screen =
  | { name: 'home' }
  | { name: 'areas' }
  | { name: 'shops'; areaId: number }
  | { name: 'addShop'; areaId: number }
  | { name: 'cart' }
  | { name: 'review' }
  | { name: 'done'; key: string }
  | { name: 'bills'; date?: string }
  | { name: 'bill'; key: string; date: string };
