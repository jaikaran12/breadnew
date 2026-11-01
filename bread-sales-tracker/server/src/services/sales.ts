import type { Config } from '../config.js';
import { isUniqueViolation, nowIso, type Db, type Statement } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import type { PaymentMode } from '../types.js';
import { dateInZone } from '../util/dates.js';

export interface SaleItemInput {
  productId: number;
  quantity: number;
  unitPricePaise: number;
}

export interface SaleInput {
  clientId: string;
  storeId: number;
  soldAt?: string;
  paymentMode: PaymentMode;
  items: SaleItemInput[];
  /** Total shown on the phone. Must match the server's own calculation exactly. */
  totalPaise: number;
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
  /** True if any line was charged at a price different from the price list when the bill arrived. */
  priceMismatch: boolean;
  items: SaleItem[];
}

export type SaleRow = Omit<Sale, 'items' | 'priceMismatch'>;

const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;

export const SALE_SELECT = `
  SELECT s.id, s.client_id AS "clientId", s.driver_id AS "driverId", d.name AS "driverName",
         s.store_id AS "storeId", st.name AS "storeName", s.area_id AS "areaId", a.name AS "areaName",
         s.sold_at AS "soldAt", s.sale_date AS "saleDate", s.payment_mode AS "paymentMode",
         s.total_paise AS "totalPaise", s.total_quantity AS "totalQuantity", s.status,
         s.cancelled_at AS "cancelledAt", s.cancelled_by AS "cancelledBy", s.cancel_reason AS "cancelReason",
         s.created_at AS "createdAt"
    FROM sales s
    JOIN drivers d ON d.id = s.driver_id
    JOIN stores st ON st.id = s.store_id
    JOIN areas a ON a.id = s.area_id`;

/** Loads the line items for the given sales and attaches them. Keeps the input order. */
export async function attachItems(db: Db, sales: SaleRow[]): Promise<Sale[]> {
  if (sales.length === 0) return [];
  const items = await db.all<SaleItem & { saleId: number }>(
    `SELECT si.sale_id AS "saleId", si.product_id AS "productId", si.product_name AS "productName",
            si.unit_price_paise AS "unitPricePaise", si.list_price_paise AS "listPricePaise",
            si.quantity, si.line_total_paise AS "lineTotalPaise"
       FROM sale_items si
       LEFT JOIN products p ON p.id = si.product_id
      WHERE si.sale_id IN (SELECT value FROM json_each(?1))
      ORDER BY p.sort_order NULLS LAST, si.product_name`,
    [JSON.stringify(sales.map((s) => s.id))],
  );
  const bySale = new Map<number, SaleItem[]>();
  for (const { saleId, ...item } of items) {
    const list = bySale.get(saleId) ?? [];
    list.push(item);
    bySale.set(saleId, list);
  }
  return sales.map((s) => {
    const saleItems = bySale.get(s.id) ?? [];
    return { ...s, priceMismatch: saleItems.some((i) => i.unitPricePaise !== i.listPricePaise), items: saleItems };
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
 * - Totals are recalculated here from quantity × rate in whole paise and must match the phone.
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

  if (input.items.length === 0) throw badRequest('The bill has no items');
  const productIds = input.items.map((i) => i.productId);
  if (new Set(productIds).size !== productIds.length) throw badRequest('The same product appears twice in the bill');

  const store = await db.first<{ id: number; areaId: number }>('SELECT id, area_id AS "areaId" FROM stores WHERE id = ?1', [
    input.storeId,
  ]);
  if (!store) throw badRequest('Shop not found. Refresh the shop list and try again.');

  const products = await db.all<{ id: number; name: string; pricePaise: number }>(
    'SELECT id, name, price_paise AS "pricePaise" FROM products WHERE id IN (SELECT value FROM json_each(?1))',
    [JSON.stringify(productIds)],
  );
  const productById = new Map(products.map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !productById.has(id));
  if (missing.length > 0) throw badRequest(`Unknown product id(s): ${missing.join(', ')}`);

  let totalPaise = 0;
  let totalQuantity = 0;
  const lines = input.items.map((item) => {
    const product = productById.get(item.productId)!;
    const lineTotalPaise = item.quantity * item.unitPricePaise;
    totalPaise += lineTotalPaise;
    totalQuantity += item.quantity;
    return { ...item, productName: product.name, listPricePaise: product.pricePaise, lineTotalPaise };
  });
  if (!Number.isSafeInteger(totalPaise)) throw badRequest('Bill total is too large');
  if (totalPaise !== input.totalPaise) {
    throw badRequest('Bill total does not match the items. Please make the bill again.', {
      expectedTotalPaise: totalPaise,
    });
  }

  const soldAt = resolveSoldAt(input.soldAt, Date.now());
  const deviceSoldAt = input.soldAt && Number.isFinite(Date.parse(input.soldAt)) ? new Date(input.soldAt).toISOString() : null;
  // Two statements in one transaction: the bill, then all its lines (sent as one JSON value).
  const statements: Statement[] = [
    {
      sql: `INSERT INTO sales (client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode,
                               total_paise, total_quantity, device_sold_at, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
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
        deviceSoldAt,
        nowIso(),
      ],
    },
    {
      sql: `INSERT INTO sale_items (sale_id, product_id, product_name, unit_price_paise, list_price_paise,
                                    quantity, line_total_paise)
            SELECT (SELECT id FROM sales WHERE client_id = ?1), json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'),
                   json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'),
                   json_extract(j.value, '$[5]')
              FROM json_each(?2) j`,
      params: [
        input.clientId,
        JSON.stringify(
          lines.map((l) => [l.productId, l.productName, l.unitPricePaise, l.listPricePaise, l.quantity, l.lineTotalPaise]),
        ),
      ],
    },
  ];
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
  bills: number;
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  creditPaise: number;
  quantity: number;
  cancelledBills: number;
}

export const SUMMARY_COLUMNS = `
  count(*) FILTER (WHERE status = 'completed') AS bills,
  coalesce(sum(total_paise) FILTER (WHERE status = 'completed'), 0) AS "totalPaise",
  coalesce(sum(total_paise) FILTER (WHERE status = 'completed' AND payment_mode = 'cash'), 0) AS "cashPaise",
  coalesce(sum(total_paise) FILTER (WHERE status = 'completed' AND payment_mode = 'upi'), 0) AS "upiPaise",
  coalesce(sum(total_paise) FILTER (WHERE status = 'completed' AND payment_mode = 'credit'), 0) AS "creditPaise",
  coalesce(sum(total_quantity) FILTER (WHERE status = 'completed'), 0) AS quantity,
  count(*) FILTER (WHERE status = 'cancelled') AS "cancelledBills"`;
