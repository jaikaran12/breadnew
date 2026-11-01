import { useEffect, useRef, type ReactNode } from 'react';
import { IconBack } from '../icons';
import { handleBack, pushBackHandler } from '../device';
import { t, useAppState } from '../store';

/** While `active`, the phone's Back button calls `fn` instead of leaving the screen. */
export function useBackHandler(active: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => ref.current());
  }, [active]);
}

export function TopBar(props: { title: string; subtitle?: string; back?: boolean; right?: ReactNode }) {
  return (
    <header className="topbar">
      {props.back !== false && (
        <button className="topbar-back" onClick={handleBack} aria-label={t('back')}>
          <IconBack size={30} />
        </button>
      )}
      <div className="topbar-title">
        <div className="topbar-main">{props.title}</div>
        {props.subtitle && <div className="topbar-sub">{props.subtitle}</div>}
      </div>
      {props.right && <div className="topbar-right">{props.right}</div>}
    </header>
  );
}

export function Modal(props: { open: boolean; onClose: () => void; children: ReactNode; sheet?: boolean; label?: string }) {
  useBackHandler(props.open, props.onClose);
  if (!props.open) return null;
  return (
    <div className={`overlay ${props.sheet ? 'overlay-sheet' : ''}`} onClick={props.onClose} role="presentation">
      <div
        className={props.sheet ? 'sheet' : 'dialog'}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        onClick={(e) => e.stopPropagation()}
      >
        {props.children}
      </div>
    </div>
  );
}

export function Confirm(props: {
  open: boolean;
  text: string;
  yes?: string;
  no?: string;
  danger?: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <Modal open={props.open} onClose={props.onNo} label={props.text}>
      <p className="dialog-text">{props.text}</p>
      <div className="dialog-actions">
        <button className="btn btn-light" onClick={props.onNo}>
          {props.no ?? t('no')}
        </button>
        <button className={`btn ${props.danger ? 'btn-red' : 'btn-green'}`} onClick={props.onYes}>
          {props.yes ?? t('yes')}
        </button>
      </div>
    </Modal>
  );
}

export function Toast() {
  const { toast } = useAppState();
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.kind}`} role="status">
      {toast.text}
    </div>
  );
}

/** Short code shown in the coloured square: "Milk Bread 400g" -> "MB", "Pav 12 pcs" -> "P12". */
export function productCode(name: string): string {
  const words = name.replace(/[^\p{L}\p{M}\p{N} ]/gu, ' ').split(' ').filter(Boolean);
  const first = words[0] ? Array.from(words[0])[0].toUpperCase() : '';
  // "Pav 12 pcs" -> "P12"
  if (first && words[1] && /^\d{1,2}$/.test(words[1])) return `${first}${words[1]}`;
  const letters = words.filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => Array.from(w)[0].toUpperCase());
  return letters.join('') || '•';
}

export function ProductBadge(props: { name: string; color: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={`badge-product ${props.size === 'lg' ? 'badge-lg' : ''}`} style={{ background: props.color }} aria-hidden>
      {productCode(props.name)}
    </span>
  );
}
