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
  lastBackupAt: string | null;
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
  /** Number of products with a special rate at this shop. */
  discountCount?: number;
}

/** A shop's special rate on one product: percent (hundredths of a percent: 500 = 5%) or paise off each unit. */
export interface DiscountRule {
  kind: 'percent' | 'amount';
  value: number;
}

export interface StoreDiscount extends DiscountRule {
  productId: number;
  updatedAt?: string;
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
  discountKind: DiscountRule['kind'] | null;
  discountValue: number | null;
  discountPaise: number;
  /** Discount the shop's current rule on the server would have given (to spot an old discount list). */
  listDiscountPaise: number;
  /** What the shop pays for this line (quantity × rate − discount). */
  lineTotalPaise: number;
}

/** Expired units taken back; their value (quantity × rate − the shop's discount) comes off the bill. */
export interface SaleReturn {
  productId: number;
  productName: string;
  quantity: number;
  /** Rate of one unit used for the value. */
  unitPricePaise: number;
  listPricePaise: number;
  discountKind: DiscountRule['kind'] | null;
  discountValue: number | null;
  discountPaise: number;
  listDiscountPaise: number;
  /** Taken off the bill (0 for returns made with older app versions: swapped free of charge). */
  creditPaise: number;
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
  /** Net amount: what was given (after discounts) minus the returns. Below zero = the shop got money back. */
  totalPaise: number;
  /** Units given. */
  totalQuantity: number;
  discountPaise: number;
  returnedQuantity: number;
  /** Value of the returns, already taken off totalPaise. */
  returnedPaise: number;
  status: 'completed' | 'cancelled';
  cancelledAt: string | null;
  cancelledBy: 'driver' | 'admin' | null;
  cancelReason: string | null;
  createdAt: string;
  priceMismatch: boolean;
  items: SaleItem[];
  returns: SaleReturn[];
}

export interface Summary {
  bills: number;
  /** Net amount (given − returned). */
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  creditPaise: number;
  quantity: number;
  discountPaise: number;
  returnedQuantity: number;
  returnedPaise: number;
  cancelledBills: number;
  cancelledPaise?: number;
}
