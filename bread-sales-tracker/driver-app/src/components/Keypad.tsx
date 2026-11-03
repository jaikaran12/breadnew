import { useEffect, useState } from 'react';
import { lineDiscount, type DiscountRule } from '../billMath';
import { IconBackspace, IconReturn } from '../icons';
import { rupees } from '../money';
import { vibrate } from '../device';
import { t } from '../store';
import type { Product } from '../types';
import { discountText } from './Bill';
import { Modal, ProductBadge } from './ui';

/** Calculator-style number pad to type a quantity directly (e.g. 24 loaves), or a number of expired items taken back. */
export function Keypad(props: {
  product: Product | null;
  value: number;
  mode?: 'sale' | 'return';
  discount?: DiscountRule | null;
  onDone: (qty: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText(props.value > 0 ? String(props.value) : '');
  }, [props.product, props.value]);

  const press = (key: string) => {
    vibrate(8);
    setText((cur) => {
      if (key === 'back') return cur.slice(0, -1);
      if (key === 'clear') return '';
      const next = (cur === '0' ? '' : cur) + key;
      return next.length > 4 ? cur : next;
    });
  };

  const qty = Number(text || '0');
  const p = props.product;
  const returning = props.mode === 'return';
  const off = p ? lineDiscount(props.discount, p.pricePaise, qty) : 0;
  return (
    <Modal open={Boolean(p)} onClose={props.onClose} sheet label={p?.name}>
      {p && (
        <div className={`keypad ${returning ? 'keypad-return' : ''}`}>
          {returning && (
            <div className="keypad-mode">
              <IconReturn size={20} /> {t('returnTab')}
            </div>
          )}
          <div className="keypad-head">
            <ProductBadge name={p.name} color={p.color} />
            <div>
              <div className="keypad-name">{p.name}</div>
              <div className="keypad-price">
                {p.localName ? `${p.localName} · ` : ''}
                {rupees(p.pricePaise)}
                {props.discount ? ` · ${discountText(props.discount)}` : ''}
              </div>
            </div>
          </div>
          <div className="keypad-display" aria-live="polite">
            {text || '0'}
          </div>
          <div className="keypad-calc">
            {returning ? (
              <>
                <IconReturn size={18} /> {t('returnedN', { n: qty })} = <strong>−{rupees(qty * p.pricePaise - off)}</strong>
              </>
            ) : off > 0 ? (
              <>
                {qty} × {rupees(p.pricePaise)} − {rupees(off)} = <strong>{rupees(qty * p.pricePaise - off)}</strong>
              </>
            ) : (
              <>
                {qty} × {rupees(p.pricePaise)} = <strong>{rupees(qty * p.pricePaise)}</strong>
              </>
            )}
          </div>
          <div className="keypad-grid">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
              <button key={k} className="key" onClick={() => press(k)}>
                {k}
              </button>
            ))}
            <button className="key key-muted" onClick={() => press('clear')}>
              C
            </button>
            <button className="key" onClick={() => press('0')}>
              0
            </button>
            <button className="key key-muted" onClick={() => press('back')} aria-label="Backspace">
              <IconBackspace size={30} />
            </button>
          </div>
          <div className="keypad-actions">
            <button className="btn btn-light" onClick={props.onClose}>
              {t('cancel')}
            </button>
            <button className="btn btn-green" onClick={() => props.onDone(qty)}>
              {t('ok')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
