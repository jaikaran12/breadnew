import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { paiseToInput, parsePercent, parseRupees, priceAfter, rupees } from '../format';
import { useProducts } from '../lookups';
import type { DiscountRule, StoreDiscount } from '../types';
import { ErrorBox, Loading, Modal, toast } from './ui';

type Kind = 'none' | DiscountRule['kind'];
interface Row {
  kind: Kind;
  text: string;
}

/** Turns what the owner typed into a rule, or an error message. */
function parseRow(row: Row, pricePaise: number): { rule: DiscountRule | null; error: string | null } {
  if (row.kind === 'none') return { rule: null, error: null };
  if (row.kind === 'percent') {
    const value = parsePercent(row.text);
    return value === null ? { rule: null, error: 'Enter a % from 0.01 to 100' } : { rule: { kind: 'percent', value }, error: null };
  }
  const value = parseRupees(row.text);
  if (value === null || value <= 0) return { rule: null, error: 'Enter the ₹ off each' };
  if (value > pricePaise) return { rule: null, error: `More than the price (${rupees(pricePaise)})` };
  return { rule: { kind: 'amount', value }, error: null };
}

/**
 * Special rates for one shop: for each product, no discount, a % off, or ₹ off each.
 * Saved all at once; drivers' phones pick the new rates up the next time they have internet.
 */
export function DiscountEditor(props: { storeId: number; storeName: string; onClose: () => void }) {
  const products = useProducts();
  const current = useQuery({
    queryKey: ['store-discounts', props.storeId],
    queryFn: () => api.get<{ discounts: StoreDiscount[] }>(`/stores/${props.storeId}/discounts`),
  });
  if (!products.data || !current.data) {
    return (
      <Modal open title={`Discounts — ${props.storeName}`} onClose={props.onClose} wide>
        <ErrorBox error={products.error || current.error} />
        <Loading />
      </Modal>
    );
  }
  return <EditorForm {...props} products={products.data} current={current.data.discounts} />;
}

function EditorForm(props: {
  storeId: number;
  storeName: string;
  onClose: () => void;
  products: Array<{ id: number; name: string; localName: string | null; pricePaise: number; isActive: boolean; color: string }>;
  current: StoreDiscount[];
}) {
  const qc = useQueryClient();
  const byProduct = new Map(props.current.map((d) => [d.productId, d]));
  // Active products, plus hidden ones that still have a discount (so it can be removed).
  const list = props.products.filter((p) => p.isActive || byProduct.has(p.id));
  const [rows, setRows] = useState<Record<number, Row>>(() => {
    const init: Record<number, Row> = {};
    for (const p of list) {
      const d = byProduct.get(p.id);
      init[p.id] = d
        ? { kind: d.kind, text: d.kind === 'percent' ? String(d.value / 100) : paiseToInput(d.value) }
        : { kind: 'none', text: '' };
    }
    return init;
  });
  const [allPercent, setAllPercent] = useState('');
  const set = (id: number, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const parsed = list.map((p) => ({ product: p, ...parseRow(rows[p.id], p.pricePaise) }));
  const errors = parsed.filter((x) => x.error).length;
  const count = parsed.filter((x) => x.rule).length;

  const save = useMutation({
    mutationFn: () =>
      api.put(`/stores/${props.storeId}/discounts`, {
        discounts: parsed.filter((x) => x.rule).map((x) => ({ productId: x.product.id, ...x.rule })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast(count ? `Saved ${count} discount${count > 1 ? 's' : ''} for ${props.storeName}` : `No discounts for ${props.storeName}`);
      props.onClose();
    },
  });

  return (
    <Modal
      open
      title={`Discounts — ${props.storeName}`}
      onClose={props.onClose}
      wide
      footer={
        <>
          <ErrorBox error={save.error} />
          <div className="row-gap">
            <button className="btn btn-light" onClick={props.onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={errors > 0 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save discounts'}
            </button>
          </div>
        </>
      }
    >
      <p className="muted small">
        The driver app takes these off automatically when billing this shop, and the bill shows the discount. Leave a
        product on “No discount” to charge the normal price.
      </p>
      <div className="discount-quick">
        <span>Same % off on every product:</span>
        <input
          className="discount-input"
          inputMode="decimal"
          placeholder="e.g. 5"
          value={allPercent}
          onChange={(e) => setAllPercent(e.target.value)}
          aria-label="Percent for all products"
        />
        <span>%</span>
        <button
          className="btn btn-light btn-sm"
          disabled={parsePercent(allPercent) === null}
          onClick={() =>
            setRows((r) => {
              const next = { ...r };
              for (const p of list) next[p.id] = { kind: 'percent', text: allPercent.trim() };
              return next;
            })
          }
        >
          Apply to all
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() =>
            setRows((r) => {
              const next = { ...r };
              for (const p of list) next[p.id] = { kind: 'none', text: '' };
              return next;
            })
          }
        >
          Remove all
        </button>
      </div>
      <div className="table-wrap">
        <table className="table discount-table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Normal price</th>
              <th>Discount</th>
              <th className="num">Price for this shop</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map(({ product: p, rule, error }) => {
              const row = rows[p.id];
              return (
                <tr key={p.id} className={rule ? 'row-discount' : ''}>
                  <td>
                    <span className="swatch" style={{ background: p.color }} /> <strong>{p.name}</strong>
                    {!p.isActive && <span className="muted small"> (hidden product)</span>}
                  </td>
                  <td className="num">{rupees(p.pricePaise)}</td>
                  <td>
                    <div className="discount-cell">
                      <select
                        value={row.kind}
                        onChange={(e) => set(p.id, { kind: e.target.value as Kind })}
                        aria-label={`Discount type for ${p.name}`}
                      >
                        <option value="none">No discount</option>
                        <option value="percent">% off</option>
                        <option value="amount">₹ off each</option>
                      </select>
                      {row.kind !== 'none' && (
                        <span className="discount-value">
                          {row.kind === 'amount' && <span>₹</span>}
                          <input
                            className="discount-input"
                            inputMode="decimal"
                            value={row.text}
                            onChange={(e) => set(p.id, { text: e.target.value })}
                            aria-label={`${row.kind === 'percent' ? 'Percent' : 'Rupees'} off for ${p.name}`}
                            placeholder={row.kind === 'percent' ? '5' : '2'}
                          />
                          {row.kind === 'percent' && <span>%</span>}
                        </span>
                      )}
                    </div>
                    {error && <div className="field-error">{error}</div>}
                  </td>
                  <td className="num strong">
                    {rule ? (
                      <>
                        {rupees(priceAfter(rule, p.pricePaise))}
                        <div className="muted small">−{rupees(p.pricePaise - priceAfter(rule, p.pricePaise))} each</div>
                      </>
                    ) : (
                      rupees(p.pricePaise)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {parsed.some((x) => x.rule?.kind === 'percent' && (x.product.pricePaise * x.rule.value) % 10000 !== 0) && (
        <p className="muted small">
          A % discount is worked out on the whole line (quantity × price) and rounded to the paisa, so the bill can
          differ from “price for this shop × quantity” by a few paise.
        </p>
      )}
    </Modal>
  );
}
