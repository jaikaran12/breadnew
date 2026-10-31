export type PaymentMode = 'cash' | 'upi' | 'credit';

export interface Admin {
  id: number;
  name: string;
  username: string;
}

export interface Settings {
  businessName: string;
  businessPhone: string;
  billFooter: string;
}

export interface Me {
  admin: Admin;
  settings: Settings;
  timezone: string;
  appDownloadUrl: string | null;
  cancelWindowMinutes: number;
}

export interface Area {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  storeCount: number;
  inactiveStoreCount: number;
}

export interface Store {
  id: number;
  name: string;
  areaId: number;
  areaName: string;
  ownerName: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  createdByDriverId: number | null;
  createdByDriverName: string | null;
  lastSaleAt?: string | null;
  bills30?: number;
  amount30Paise?: number;
}

export interface Product {
  id: number;
  name: string;
  localName: string | null;
  pricePaise: number;
  color: string;
  sortOrder: number;
  isActive: boolean;
  priceChangedAt: string | null;
}

export interface Driver {
  id: number;
  name: string;
  phone: string;
  vehicleNumber: string | null;
  isActive: boolean;
  isLocked: boolean;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  todayBills: number;
  todayAmountPaise: number;
  lastSaleAt: string | null;
}

export interface SaleItem {
  productId: number;
  productName: string;
  unitPricePaise: number;
  listPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface Sale {
  id: number;
  clientId: string;
  driverId: number;
  driverName: string;
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
  cancelledAt: string | null;
  cancelledBy: 'driver' | 'admin' | null;
  cancelReason: string | null;
  createdAt: string;
  priceMismatch: boolean;
  items: SaleItem[];
}

export interface Summary {
  bills: number;
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  creditPaise: number;
  quantity: number;
  cancelledBills: number;
  cancelledPaise?: number;
}
