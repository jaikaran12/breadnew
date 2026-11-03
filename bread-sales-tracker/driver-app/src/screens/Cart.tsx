import { useState } from 'react';
import { discountText, netLabel } from '../components/Bill';
import { Keypad } from '../components/Keypad';
import { Confirm, ProductBadge, TopBar } from '../components/ui';
import { IconBasket, IconMinus, IconNext, IconPlus, IconReturn, IconTag, IconTrash } from '../icons';
import { rupees } from '../money';
import { vibrate } from '../device';
import { lineTotal } from '../billMath';
import { actions, billTotals, discountFor, draftLines, draftReturns, t, useAppState } from '../store';
import type { Product } from '../types';

export function CartScreen() {
  const s = useAppState();
  const [keypadFor, setKeypadFor] = useState<Product | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const { draft, catalog } = s;

  if (!draft || !catalog) {
    return (
      <div className="screen">
        <TopBar title={t('newBill')} />
        <main className="content">
          <button className="btn btn-green btn-xl" onClick={() => actions.reset({ name: 'home' }, { name: 'areas' })}>
            {t('chooseShop')}
          </button>
        </main>
      </div>
    );
  }

  const mode = draft.mode ?? 'sale';
  const returning = mode === 'return';
  const counts = (returning ? draft.ret : draft.qty) ?? {};
  const lines = draftLines(s);
  const returns = draftReturns(s);
  const totals = billTotals(lines, returns);
  const { quantity, returnedQuantity: returned } = totals;
  const net = netLabel(totals.totalPaise);
  const shopHasDiscounts = catalog.products.some((p) => discountFor(s, draft.storeId, p.id));

  const change = (p: Product, delta: number) => {
    vibrate();
    actions.setQty(p.id, (counts[p.id] ?? 0) + delta);
  };

  return (
    <div className={`screen screen-with-bar ${returning ? 'mode-return' : ''}`}>
      <TopBar
        title={draft.storeName}
        subtitle={draft.areaName}
        right={
          <button className="chip chip-dark" onClick={() => actions.back()}>
            {t('change')}
          </button>
        }
      />
      <div className="mode-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={!returning}
          className={`mode-tab mode-tab-sale ${!returning ? 'mode-tab-on' : ''}`}
          onClick={() => actions.setMode('sale')}
        >
          <IconBasket size={24} /> {t('saleTab')}
          {quantity > 0 && <span className="mode-count">{quantity}</span>}
        </button>
        <button
          role="tab"
          aria-selected={returning}
          className={`mode-tab mode-tab-return ${returning ? 'mode-tab-on' : ''}`}
          onClick={() => actions.setMode('return')}
        >
          <IconReturn size={24} /> {t('returnTab')}
          {returned > 0 && <span className="mode-count">{returned}</span>}
        </button>
      </div>
      <main className="content content-tight">
        {returning ? (
          <div className="alert alert-amber return-hint">
            <IconReturn size={22} /> {t('returnHint')}
          </div>
        ) : (
          <>
            {shopHasDiscounts && (
              <div className="alert alert-green special-rates">
                <IconTag size={22} /> {t('specialRates')}
              </div>
            )}
            <div className="hint center">{t('tapToType')}</div>
          </>
        )}
        <ul className="product-list">
          {catalog.products.map((p) => {
            const qty = counts[p.id] ?? 0;
            // Returns are valued at the shop's own rate too, so swapping one for one comes to ₹0.
            const rule = discountFor(s, draft.storeId, p.id);
            return (
              <li key={p.id} className={`product ${qty > 0 ? (returning ? 'product-return' : 'product-on') : ''}`}>
                <ProductBadge name={p.name} color={p.color} />
                <div className="product-info">
                  <div className="product-name">{p.name}</div>
                  <div className="product-meta">
                    {p.localName && <span className="product-local">{p.localName}</span>}
                    <span className={`product-price ${rule ? 'product-price-old' : ''}`}>{rupees(p.pricePaise)}</span>
                    {rule && <span className="product-discount">{discountText(rule)}</span>}
                  </div>
                  {qty > 0 && !returning && <div className="product-line">= {rupees(lineTotal(rule, p.pricePaise, qty))}</div>}
                  {qty > 0 && returning && (
                    <div className="product-line product-line-return">
                      <IconReturn size={16} /> {t('returnedN', { n: qty })} = −{rupees(lineTotal(rule, p.pricePaise, qty))}
                    </div>
                  )}
                </div>
                <div className="stepper">
                  <button
                    className="step step-minus"
                    onClick={() => change(p, -1)}
                    disabled={qty === 0}
                    aria-label={`${p.name} −1`}
                  >
                    <IconMinus size={28} />
                  </button>
                  <button className="step-qty" onClick={() => setKeypadFor(p)} aria-label={`${p.name} ${t('qty')}`}>
                    {qty}
                  </button>
                  <button className="step step-plus" onClick={() => change(p, 1)} aria-label={`${p.name} +1`}>
                    <IconPlus size={28} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {(returning ? returns.length > 0 : lines.length > 0) && (
          <button className="btn btn-light btn-block" onClick={() => setConfirmClear(true)}>
            <IconTrash /> {returning ? t('clearReturns') : t('clearAll')}
          </button>
        )}
      </main>

      <div className="bottombar">
        <div className="bar-total">
          <span className="bar-label">{returned > 0 ? net.label : t('total')}</span>
          <strong className={`bar-amount ${totals.totalPaise < 0 ? 'amount-back' : ''}`} data-testid="cart-total">
            {returned > 0 ? net.amount : rupees(totals.totalPaise)}
          </strong>
          <span className="bar-small">
            {quantity} {t('pcs')} · {t('itemsN', { n: lines.length })}
            {returned > 0 && (
              <span className="bar-returned" data-testid="cart-returned">
                <IconReturn size={14} /> {t('returnedN', { n: returned })} · −{rupees(totals.returnedPaise)}
              </span>
            )}
          </span>
        </div>
        <button
          className="btn btn-green btn-next"
          disabled={lines.length === 0 && returns.length === 0}
          onClick={() => actions.go({ name: 'review' })}
        >
          {t('next')} <IconNext size={26} />
        </button>
      </div>

      <Keypad
        product={keypadFor}
        mode={mode}
        discount={keypadFor ? discountFor(s, draft.storeId, keypadFor.id) : null}
        value={keypadFor ? counts[keypadFor.id] ?? 0 : 0}
        onClose={() => setKeypadFor(null)}
        onDone={(q) => {
          if (keypadFor) actions.setQty(keypadFor.id, q);
          setKeypadFor(null);
        }}
      />
      <Confirm
        open={confirmClear}
        text={returning ? t('clearReturnsConfirm') : t('clearAllConfirm')}
        danger
        onNo={() => setConfirmClear(false)}
        onYes={() => {
          actions.clearQty();
          setConfirmClear(false);
        }}
      />
    </div>
  );
}
