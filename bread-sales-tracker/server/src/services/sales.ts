import type { Config } from '../config.js';
import { isUniqueViolation, nowIso, type Db, type Statement } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import type { PaymentMode } from '../types.js';
import { dateInZone } from '../util/dates.js';
import { lineDiscount, MAX_LINE_PAISE, type DiscountRule } from './billMath.js';

export interface SaleItemInput {
  productId: number;
  quantity: number;
  unitPricePaise: number;
  /** The shop's discount the phone applied to this line (from its copy of the discount list). */
  discount?: DiscountRule | null;
}

/**
 * Expired units taken back. Their value (quantity × rate − the shop's discount) is taken off the bill.
 * Older app versions send no rate: those returns cost nothing (they were swapped free of charge).
 */
export interface ReturnInput {
  productId: number;
  quantity: number;
  unitPricePaise?: number;
  discount?: DiscountRule | null;
}

export interface SaleInput {
  clientId: string;
  storeId: number;
  soldAt?: string;
  paymentMode: PaymentMode;
  items: SaleItemInput[];
  returns?: ReturnInput[];
  /** Net amount shown on the phone (given − returned). Must match the server's own calculation exactly. */
  totalPaise: number;
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
  listDiscountPaise: number;
  /** What the shop pays for this line (quantity × rate − discount). */
  lineTotalPaise: number;
}

export interface SaleReturn {
  productId: number;
  productName: string;
  quantity: number;
  unitPricePaise: number;
  listPricePaise: number;
  discountKind: DiscountRule['kind'] | null;
  discountValue: number | null;
  discountPaise: number;
  listDiscountPaise: number;
  /** Taken off the bill for these units (0 for returns made with older app versions: they cost nothing). */
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
  /** Net amount the shop pays: what was given (after discounts) minus the returns. Below zero = the shop gets money back. */
  totalPaise: number;
  /** Units given. */
  totalQuantity: number;
  discountPaise: number;
  /** Expired units taken back. */
  returnedQuantity: number;
  /** Value of the expired units taken back (already taken off totalPaise). */
  returnedPaise: number;
  status: 'completed' | 'cancelled';
  cancelledAt: string | null;
  cancelledBy: 'driver' | 'admin' | null;
  cancelReason: string | null;
  createdAt: string;
  /** True if any line used a rate or discount different from the lists on the server when the bill arrived. */
  priceMismatch: boolean;
  items: SaleItem[];
  returns: SaleReturn[];
}

export type SaleRow = Omit<Sale, 'items' | 'returns' | 'priceMismatch'>;

const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;

export const SALE_SELECT = `
  SELECT s.id, s.client_id AS "clientId", s.driver_id AS "driverId", d.name AS "driverName",
         s.store_id AS "storeId", st.name AS "storeName", s.area_id AS "areaId", a.name AS "areaName",
         s.sold_at AS "soldAt", s.sale_date AS "saleDate", s.payment_mode AS "paymentMode",
         s.total_paise AS "totalPaise", s.total_quantity AS "totalQuantity", s.discount_paise AS "discountPaise",
         s.returned_quantity AS "returnedQuantity", s.returned_paise AS "returnedPaise", s.status,
         s.cancelled_at AS "cancelledAt", s.cancelled_by AS "cancelledBy", s.cancel_reason AS "cancelReason",
         s.created_at AS "createdAt"
    FROM sales s
    JOIN drivers d ON d.id = s.driver_id
    JOIN stores st ON st.id = s.store_id
    JOIN areas a ON a.id = s.area_id`;

/** Loads the bill lines and returned items for the given sales and attaches them. Keeps the input order. */
export async function attachItems(db: Db, sales: SaleRow[]): Promise<Sale[]> {
  if (sales.length === 0) return [];
  const ids = JSON.stringify(sales.map((s) => s.id));
  const [items, returns] = await Promise.all([
    db.all<SaleItem & { saleId: number }>(
      `SELECT si.sale_id AS "saleId", si.product_id AS "productId", si.product_name AS "productName",
              si.unit_price_paise AS "unitPricePaise", si.list_price_paise AS "listPricePaise", si.quantity,
              si.discount_kind AS "discountKind", si.discount_value AS "discountValue", si.discount_paise AS "discountPaise",
              si.list_discount_paise AS "listDiscountPaise", si.line_total_paise AS "lineTotalPaise"
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id
        WHERE si.sale_id IN (SELECT value FROM json_each(?1))
        ORDER BY p.sort_order NULLS LAST, si.product_name`,
      [ids],
    ),
    db.all<SaleReturn & { saleId: number }>(
      `SELECT r.sale_id AS "saleId", r.product_id AS "productId", r.product_name AS "productName", r.quantity,
              r.unit_price_paise AS "unitPricePaise", r.list_price_paise AS "listPricePaise",
              r.discount_kind AS "discountKind", r.discount_value AS "discountValue", r.discount_paise AS "discountPaise",
              r.list_discount_paise AS "listDiscountPaise", r.credit_paise AS "creditPaise"
         FROM sale_returns r
         LEFT JOIN products p ON p.id = r.product_id
        WHERE r.sale_id IN (SELECT value FROM json_each(?1))
        ORDER BY p.sort_order NULLS LAST, r.product_name`,
      [ids],
    ),
  ]);
  const group = <T extends { saleId: number }>(rows: T[]) => {
    const map = new Map<number, Array<Omit<T, 'saleId'>>>();
    for (const { saleId, ...row } of rows) {
      const list = map.get(saleId) ?? [];
      list.push(row);
      map.set(saleId, list);
    }
    return map;
  };
  const itemsBySale = group(items);
  const returnsBySale = group(returns);
  const offList = (l: { unitPricePaise: number; listPricePaise: number; discountPaise: number; listDiscountPaise: number }) =>
    l.unitPricePaise !== l.listPricePaise || l.discountPaise !== l.listDiscountPaise;
  return sales.map((s) => {
    const saleItems = (itemsBySale.get(s.id) ?? []) as SaleItem[];
    const saleReturns = (returnsBySale.get(s.id) ?? []) as SaleReturn[];
    return {
      ...s,
      // Returns that cost nothing (older app versions) cannot be off the price list.
      priceMismatch: saleItems.some(offList) || saleReturns.some((r) => r.creditPaise > 0 && offList(r)),
      items: saleItems,
      returns: saleReturns,
    };
  });
}

export async function getSale(db: Db, id: number): Promise<Sale | undefined> {
  const sale = await db.first<SaleRow>(`${SALE_SELECT} WHERE s.id = ?1`, [id]);
  if (!sale) return undefined;
  const [withItems] = await attachItems(db, [sale]);
  return withItems;
}

function resolveSoldAt(raw: string | undefined, now: number): Date {
  if (!raw) return new Date(now);
  const t = Date.parse(raw);
  // A phone with a badly wrong clock must not put a bill on the wrong day.
  if (!Number.isFinite(t) || t > now + MAX_FUTURE_MS || t < now - MAX_PAST_MS) return new Date(now);
  return new Date(t);
}

async function existingFor(db: Db, clientId: string, driverId: number): Promise<Sale | null> {
  const existing = await db.first<{ id: number; driverId: number }>(
    'SELECT id, driver_id AS "driverId" FROM sales WHERE client_id = ?1',
    [clientId],
  );
  if (!existing) return null;
  if (existing.driverId !== driverId) throw conflict('This bill was already sent by another driver');
  return (await getSale(db, existing.id))!;
}

/**
 * Saves a bill sent by a driver's phone.
 * - Each line is quantity × rate − the shop's discount, in whole paise, worked out here again.
 * - Expired items taken back (returns) are valued the same way and taken off: the bill's total is the net
 *   amount, given − returned, and must match the phone exactly. It is below zero if the returns are worth more.
 * - Sending the same bill twice (same clientId) returns the first copy instead of a duplicate.
 */
export async function createSale(
  db: Db,
  config: Pick<Config, 'appTimezone'>,
  driverId: number,
  input: SaleInput,
): Promise<{ sale: Sale; created: boolean }> {
  const already = await existingFor(db, input.clientId, driverId);
  if (already) return { sale: already, created: false };

  const returns = input.returns ?? [];
  if (input.items.length === 0 && returns.length === 0) throw badRequest('The bill has no items');
  const productIds = input.items.map((i) => i.productId);
  if (new Set(productIds).size !== productIds.length) throw badRequest('The same product appears twice in the bill');
  const returnIds = returns.map((r) => r.productId);
  if (new Set(returnIds).size !== returnIds.length) throw badRequest('The same product appears twice in the returns');

  const store = await db.first<{ id: number; areaId: number }>('SELECT id, area_id AS "areaId" FROM stores WHERE id = ?1', [
    input.storeId,
  ]);
  if (!store) throw badRequest('Shop not found. Refresh the shop list and try again.');

  // Products with their price and this shop's current discount (one query).
  const allIds = [...new Set([...productIds, ...returnIds])];
  const products = await db.all<{
    id: number;
    name: string;
    pricePaise: number;
    discountKind: DiscountRule['kind'] | null;
    discountValue: number | null;
  }>(
    `SELECT p.id, p.name, p.price_paise AS "pricePaise", d.kind AS "discountKind", d.value AS "discountValue"
       FROM products p LEFT JOIN store_discounts d ON d.product_id = p.id AND d.store_id = ?2
      WHERE p.id IN (SELECT value FROM json_each(?1))`,
    [JSON.stringify(allIds), store.id],
  );
  const productById = new Map(products.map((p) => [p.id, p]));
  const missing = allIds.filter((id) => !productById.has(id));
  if (missing.length > 0) throw badRequest(`Unknown product id(s): ${missing.join(', ')}`);

  const shopRuleOf = (product: { discountKind: DiscountRule['kind'] | null; discountValue: number | null }): DiscountRule | null =>
    product.discountKind && product.discountValue ? { kind: product.discountKind, value: product.discountValue } : null;

  let givenPaise = 0;
  let totalQuantity = 0;
  let discountPaise = 0;
  const lines = input.items.map((item) => {
    const product = productById.get(item.productId)!;
    const gross = item.quantity * item.unitPricePaise;
    if (gross > MAX_LINE_PAISE) throw badRequest('A bill line is too large');
    const rule = item.discount ?? null;
    const discount = lineDiscount(rule, item.unitPricePaise, item.quantity);
    const listDiscount = lineDiscount(shopRuleOf(product), product.pricePaise, item.quantity);
    givenPaise += gross - discount;
    totalQuantity += item.quantity;
    discountPaise += discount;
    return {
      ...item,
      rule,
      productName: product.name,
      listPricePaise: product.pricePaise,
      discountPaise: discount,
      listDiscountPaise: listDiscount,
      lineTotalPaise: gross - discount,
    };
  });
  const returnLines = returns.map((r) => {
    const product = productById.get(r.productId)!;
    const base = { productId: r.productId, productName: product.name, quantity: r.quantity, listPricePaise: product.pricePaise };
    // Sent by an older app version: swapped free of charge, nothing taken off the bill.
    if (r.unitPricePaise === undefined) {
      return { ...base, unitPricePaise: product.pricePaise, rule: null, discountPaise: 0, listDiscountPaise: 0, creditPaise: 0 };
    }
    const gross = r.quantity * r.unitPricePaise;
    if (gross > MAX_LINE_PAISE) throw badRequest('A returned line is too large');
    const rule = r.discount ?? null;
    const discount = lineDiscount(rule, r.unitPricePaise, r.quantity);
    return {
      ...base,
      unitPricePaise: r.unitPricePaise,
      rule,
      discountPaise: discount,
      listDiscountPaise: lineDiscount(shopRuleOf(product), product.pricePaise, r.quantity),
      creditPaise: gross - discount,
    };
  });
  const returnedQuantity = returnLines.reduce((acc, r) => acc + r.quantity, 0);
  const returnedPaise = returnLines.reduce((acc, r) => acc + r.creditPaise, 0);
  const totalPaise = givenPaise - returnedPaise;
  if (!Number.isSafeInteger(givenPaise) || !Number.isSafeInteger(returnedPaise)) throw badRequest('Bill total is too large');
  if (totalPaise !== input.totalPaise) {
    throw badRequest('Bill total does not match the items. Please make the bill again.', {
      expectedTotalPaise: totalPaise,
    });
  }

  const soldAt = resolveSoldAt(input.soldAt, Date.now());
  const deviceSoldAt = input.soldAt && Number.isFinite(Date.parse(input.soldAt)) ? new Date(input.soldAt).toISOString() : null;
  const saleId = '(SELECT id FROM sales WHERE client_id = ?1)';
  // One statement for the bill, one for all its lines and one for the returns (lines go as one JSON value).
  const statements: Statement[] = [
    {
      sql: `INSERT INTO sales (client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise,
                               total_quantity, discount_paise, returned_quantity, returned_paise, device_sold_at, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      params: [
        input.clientId,
        driverId,
        store.id,
        store.areaId,
        soldAt.toISOString(),
        dateInZone(soldAt, config.appTimezone),
        input.paymentMode,
        totalPaise,
        totalQuantity,
        discountPaise,
        returnedQuantity,
        returnedPaise,
        deviceSoldAt,
        nowIso(),
      ],
    },
  ];
  if (lines.length > 0) {
    statements.push({
      sql: `INSERT INTO sale_items (sale_id, product_id, product_name, unit_price_paise, list_price_paise, quantity,
                                    discount_kind, discount_value, discount_paise, list_discount_paise, line_total_paise)
            SELECT ${saleId}, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'),
                   json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]'),
                   json_extract(j.value, '$[6]'), json_extract(j.value, '$[7]'), json_extract(j.value, '$[8]'),
                   json_extract(j.value, '$[9]')
              FROM json_each(?2) j`,
      params: [
        input.clientId,
        JSON.stringify(
          lines.map((l) => [
            l.productId,
            l.productName,
            l.unitPricePaise,
            l.listPricePaise,
            l.quantity,
            l.rule?.kind ?? null,
            l.rule?.value ?? null,
            l.discountPaise,
            l.listDiscountPaise,
            l.lineTotalPaise,
          ]),
        ),
      ],
    });
  }
  if (returnLines.length > 0) {
    statements.push({
      sql: `INSERT INTO sale_returns (sale_id, product_id, product_name, quantity, unit_price_paise, list_price_paise,
                                      discount_kind, discount_value, discount_paise, list_discount_paise, credit_paise)
            SELECT ${saleId}, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'),
                   json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]'),
                   json_extract(j.value, '$[6]'), json_extract(j.value, '$[7]'), json_extract(j.value, '$[8]'),
                   json_extract(j.value, '$[9]')
              FROM json_each(?2) j`,
      params: [
        input.clientId,
        JSON.stringify(
          returnLines.map((r) => [
            r.productId,
            r.productName,
            r.quantity,
            r.unitPricePaise,
            r.listPricePaise,
            r.rule?.kind ?? null,
            r.rule?.value ?? null,
            r.discountPaise,
            r.listDiscountPaise,
            r.creditPaise,
          ]),
        ),
      ],
    });
  }
  try {
    await db.batch(statements);
  } catch (err) {
    // The same bill arrived twice at the same moment: return the copy that won.
    if (isUniqueViolation(err)) {
      const winner = await existingFor(db, input.clientId, driverId);
      if (winner) return { sale: winner, created: false };
    }
    throw err;
  }
  const saved = await db.first<{ id: number }>('SELECT id FROM sales WHERE client_id = ?1', [input.clientId]);
  return { sale: (await getSale(db, saved!.id))!, created: true };
}

/** A driver may cancel their own bill for a short time after making it, unless the day is already tallied. */
export async function cancelSaleByDriver(
  db: Db,
  config: Pick<Config, 'driverCancelWindowMinutes'>,
  driverId: number,
  saleId: number,
): Promise<Sale> {
  const sale = await db.first<{ id: number; status: string; soldAt: string; settled: number }>(
    `SELECT s.id, s.status, s.sold_at AS "soldAt",
            EXISTS (SELECT 1 FROM settlements t WHERE t.driver_id = s.driver_id AND t.settle_date = s.sale_date) AS settled
       FROM sales s WHERE s.id = ?1 AND s.driver_id = ?2`,
    [saleId, driverId],
  );
  if (!sale) throw notFound('Bill not found');
  if (sale.status === 'cancelled') throw conflict('This bill is already cancelled');
  if (sale.settled) throw forbidden('Cash for this day is already settled. Please call the owner.', 'day_settled');
  const windowMs = config.driverCancelWindowMinutes * 60 * 1000;
  if (Date.now() - Date.parse(sale.soldAt) > windowMs) {
    throw forbidden(
      `Bills can only be cancelled within ${config.driverCancelWindowMinutes} minutes. Please call the owner.`,
      'cancel_window_passed',
    );
  }
  await db.run(
    `UPDATE sales SET status = 'cancelled', cancelled_at = ?2, cancelled_by = 'driver', cancel_reason = 'Cancelled by driver'
      WHERE id = ?1 AND status = 'completed'`,
    [saleId, nowIso()],
  );
  return (await getSale(db, saleId))!;
}

export async function cancelSaleByAdmin(db: Db, saleId: number, reason: string): Promise<Sale> {
  const result = await db.run(
    `UPDATE sales SET status = 'cancelled', cancelled_at = ?3, cancelled_by = 'admin', cancel_reason = ?2
      WHERE id = ?1 AND status = 'completed'`,
    [saleId, reason, nowIso()],
  );
  if (result.changes === 0) {
    const exists = await db.first('SELECT 1 AS x FROM sales WHERE id = ?1', [saleId]);
    if (!exists) throw notFound('Bill not found');
    throw conflict('This bill is already cancelled');
  }
  return (await getSale(db, saleId))!;
}

/** Undo an admin cancellation (e.g. cancelled by mistake). */
export async function restoreSale(db: Db, saleId: number): Promise<Sale> {
  const result = await db.run(
    `UPDATE sales SET status = 'completed', cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL
      WHERE id = ?1 AND status = 'cancelled'`,
    [saleId],
  );
  if (result.changes === 0) {
    const exists = await db.first('SELECT 1 AS x FROM sales WHERE id = ?1', [saleId]);
    if (!exists) throw notFound('Bill not found');
    throw conflict('This bill is not cancelled');
  }
  return (await getSale(db, saleId))!;
}

export interface DaySummary {
  /** Bills with something given (visits where expired items were only taken back are not counted here). */
  bills: number;
  /** Net amount of the bills (given − returned); the cash, UPI and udhaar parts below add up to it. */
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  creditPaise: number;
  quantity: number;
  discountPaise: number;
  returnedQuantity: number;
  /** Value of the expired items taken back (already taken off totalPaise). */
  returnedPaise: number;
  cancelledBills: number;
}

export const SUMMARY_COLUMNS = `
  count(*) FILTER (WHERE status = 'completed' AND total_quantity > 0) AS bills,
  coalesce(sum(total_paise) FILTER (WHERE status = 'completed'), 0) AS "totalPaise",
  coalesce(sum(total_paise) FILTER (WHERE status = 'completed' AND payment_mode = 'cash'), 0) AS "cashPaise",
  coalesce(sum(total_paise) FILTER (WHERE status = 'completed' AND payment_mode = 'upi'), 0) AS "upiPaise",
  coalesce(sum(total_paise) FILTER (WHERE status = 'completed' AND payment_mode = 'credit'), 0) AS "creditPaise",
  coalesce(sum(total_quantity) FILTER (WHERE status = 'completed'), 0) AS quantity,
  coalesce(sum(discount_paise) FILTER (WHERE status = 'completed'), 0) AS "discountPaise",
  coalesce(sum(returned_quantity) FILTER (WHERE status = 'completed'), 0) AS "returnedQuantity",
  coalesce(sum(returned_paise) FILTER (WHERE status = 'completed'), 0) AS "returnedPaise",
  count(*) FILTER (WHERE status = 'cancelled') AS "cancelledBills"`;
