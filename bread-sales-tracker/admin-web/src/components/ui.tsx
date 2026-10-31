import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../api';
import { addDays, dateLabel, PAYMENT_LABEL, todayIn } from '../format';

export function PageHeader(props: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p className="page-sub">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </div>
  );
}

export function Card(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {(props.title || props.actions) && (
        <div className="card-head">
          {props.title && <h2>{props.title}</h2>}
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </div>
      )}
      <div className={props.flush ? 'card-body-flush' : 'card-body'}>{props.children}</div>
    </section>
  );
}

export function Stat(props: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'green' | 'blue' | 'amber' | 'red' }) {
  return (
    <div className={`stat ${props.tone ? `stat-${props.tone}` : ''}`}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      {props.hint && <div className="stat-hint">{props.hint}</div>}
    </div>
  );
}

export function Badge(props: { tone?: 'green' | 'blue' | 'amber' | 'red' | 'gray'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${props.tone ?? 'gray'}`} title={props.title}>
      {props.children}
    </span>
  );
}

export function PaymentBadge(props: { mode: string }) {
  const tone = props.mode === 'cash' ? 'green' : props.mode === 'upi' ? 'blue' : 'amber';
  return <Badge tone={tone}>{PAYMENT_LABEL[props.mode] ?? props.mode}</Badge>;
}

export function Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return createPortal(
    <div className="modal-overlay" onMouseDown={props.onClose}>
      <div className={`modal ${props.wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-button" onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
      {props.error && <span className="field-error">{props.error}</span>}
    </label>
  );
}

export function ErrorBox(props: { error: unknown }) {
  if (!props.error) return null;
  const message = props.error instanceof ApiError || props.error instanceof Error ? props.error.message : String(props.error);
  return <div className="alert alert-red">{message}</div>;
}

export function Empty(props: { children: ReactNode }) {
  return <div className="empty">{props.children}</div>;
}

export function Loading() {
  return <div className="loading">Loading…</div>;
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden />
      <span>{props.label}</span>
    </label>
  );
}

/** ‹ date › picker with quick "Today" button. */
export function DayPicker(props: { value: string; onChange: (d: string) => void }) {
  const today = todayIn();
  return (
    <div className="day-picker">
      <button className="btn btn-ghost" onClick={() => props.onChange(addDays(props.value, -1))} aria-label="Previous day">
        ‹
      </button>
      <input type="date" value={props.value} max={today} onChange={(e) => e.target.value && props.onChange(e.target.value)} />
      <button
        className="btn btn-ghost"
        onClick={() => props.onChange(addDays(props.value, 1))}
        disabled={props.value >= today}
        aria-label="Next day"
      >
        ›
      </button>
      {props.value !== today && (
        <button className="btn btn-light btn-sm" onClick={() => props.onChange(today)}>
          Today
        </button>
      )}
      <span className="day-picker-label">{dateLabel(props.value)}</span>
    </div>
  );
}

export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';

export function presetRange(preset: RangePreset, current: { from: string; to: string }): { from: string; to: string } {
  const today = todayIn();
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'lastMonth': {
      const firstThis = `${today.slice(0, 8)}01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
    }
    default:
      return current;
  }
}

export function RangePicker(props: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  const [preset, setPreset] = useState<RangePreset>('custom');
  const today = todayIn();
  const presets: Array<[RangePreset, string]> = [
    ['today', 'Today'],
    ['yesterday', 'Yesterday'],
    ['7d', 'Last 7 days'],
    ['30d', 'Last 30 days'],
    ['month', 'This month'],
    ['lastMonth', 'Last month'],
  ];
  useEffect(() => {
    const match = presets.find(([p]) => {
      const r = presetRange(p, props);
      return r.from === props.from && r.to === props.to;
    });
    setPreset(match ? match[0] : 'custom');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.from, props.to]);
  return (
    <div className="range-picker">
      <div className="segmented">
        {presets.map(([p, label]) => (
          <button key={p} className={preset === p ? 'on' : ''} onClick={() => props.onChange(presetRange(p, props))}>
            {label}
          </button>
        ))}
      </div>
      <div className="range-inputs">
        <input type="date" value={props.from} max={today} onChange={(e) => e.target.value && props.onChange({ from: e.target.value, to: props.to < e.target.value ? e.target.value : props.to })} />
        <span>to</span>
        <input type="date" value={props.to} max={today} onChange={(e) => e.target.value && props.onChange({ from: props.from > e.target.value ? e.target.value : props.from, to: e.target.value })} />
      </div>
    </div>
  );
}

export function Pager(props: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn btn-light btn-sm" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>
        ‹ Previous
      </button>
      <span>
        Page {props.page} of {pages}
      </span>
      <button className="btn btn-light btn-sm" disabled={props.page >= pages} onClick={() => props.onPage(props.page + 1)}>
        Next ›
      </button>
    </div>
  );
}

let toastSetter: ((t: { text: string; tone: 'ok' | 'error' } | null) => void) | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, tone: 'ok' | 'error' = 'ok') {
  toastSetter?.({ text, tone });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastSetter?.(null), 3000);
}

export function ToastHost() {
  const [t, setT] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  useEffect(() => {
    toastSetter = setT;
    return () => {
      toastSetter = null;
    };
  }, []);
  if (!t) return null;
  return <div className={`toast toast-${t.tone}`}>{t.text}</div>;
}

/** Tiny bar chart (SVG) for daily totals. */
export function BarChart(props: { data: Array<{ label: string; value: number; title: string }>; highlightLast?: boolean }) {
  const max = Math.max(1, ...props.data.map((d) => d.value));
  const w = 100 / Math.max(1, props.data.length);
  return (
    <div className="bar-chart">
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label="Daily sales chart">
        {props.data.map((d, i) => {
          const h = (d.value / max) * 46;
          return (
            <rect
              key={d.label + i}
              x={i * w + w * 0.15}
              y={50 - h}
              width={w * 0.7}
              height={Math.max(h, d.value > 0 ? 0.6 : 0)}
              rx={0.8}
              className={props.highlightLast && i === props.data.length - 1 ? 'bar bar-last' : 'bar'}
            >
              <title>{d.title}</title>
            </rect>
          );
        })}
      </svg>
      <div className="bar-labels">
        {props.data.map((d, i) => (
          <span key={d.label + i} style={{ width: `${w}%` }}>
            {i % 2 === props.data.length % 2 ? '' : d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bar inside a table cell, for quick comparison. */
export function InlineBar(props: { value: number; max: number }) {
  const pct = props.max > 0 ? Math.round((props.value / props.max) * 100) : 0;
  return (
    <div className="inline-bar" aria-hidden>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}
