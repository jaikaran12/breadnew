import { useState } from 'react';
import { Keypad } from '../components/Keypad';
import { Confirm, ProductBadge, TopBar } from '../components/ui';
import { IconMinus, IconNext, IconPlus, IconTrash } from '../icons';
import { rupees } from '../money';
import { vibrate } from '../device';
import { actions, draftLines, linesTotal, t, useAppState } from '../store';
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

  const lines = draftLines(s);
  const { totalPaise, quantity } = linesTotal(lines);

  const change = (p: Product, delta: number) => {
    vibrate();
    actions.setQty(p.id, (draft.qty[p.id] ?? 0) + delta);
  };

  return (
    <div className="screen screen-with-bar">
      <TopBar
        title={draft.storeName}
        subtitle={draft.areaName}
        right={
          <button className="chip chip-dark" onClick={() => actions.back()}>
            {t('change')}
          </button>
        }
      />
      <main className="content content-tight">
        <div className="hint center">{t('tapToType')}</div>
        <ul className="product-list">
          {catalog.products.map((p) => {
            const qty = draft.qty[p.id] ?? 0;
            return (
              <li key={p.id} className={`product ${qty > 0 ? 'product-on' : ''}`}>
                <ProductBadge name={p.name} color={p.color} />
                <div className="product-info">
                  <div className="product-name">{p.name}</div>
                  <div className="product-meta">
                    {p.localName && <span className="product-local">{p.localName}</span>}
                    <span className="product-price">{rupees(p.pricePaise)}</span>
                  </div>
                  {qty > 0 && <div className="product-line">= {rupees(qty * p.pricePaise)}</div>}
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
        {lines.length > 0 && (
          <button className="btn btn-light btn-block" onClick={() => setConfirmClear(true)}>
            <IconTrash /> {t('clearAll')}
          </button>
        )}
      </main>

      <div className="bottombar">
        <div className="bar-total">
          <span className="bar-label">{t('total')}</span>
          <strong className="bar-amount" data-testid="cart-total">
            {rupees(totalPaise)}
          </strong>
          <span className="bar-small">
            {quantity} {t('pcs')} · {t('itemsN', { n: lines.length })}
          </span>
        </div>
        <button className="btn btn-green btn-next" disabled={lines.length === 0} onClick={() => actions.go({ name: 'review' })}>
          {t('next')} <IconNext size={26} />
        </button>
      </div>

      <Keypad
        product={keypadFor}
        value={keypadFor ? draft.qty[keypadFor.id] ?? 0 : 0}
        onClose={() => setKeypadFor(null)}
        onDone={(q) => {
          if (keypadFor) actions.setQty(keypadFor.id, q);
          setKeypadFor(null);
        }}
      />
      <Confirm
        open={confirmClear}
        text={t('clearAllConfirm')}
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
