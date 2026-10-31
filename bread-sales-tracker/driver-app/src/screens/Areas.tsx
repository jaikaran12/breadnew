import { useMemo, useState } from 'react';
import { TopBar } from '../components/ui';
import { IconCheck, IconPin, IconSearch, IconShop, IconX } from '../icons';
import { rupees } from '../money';
import { actions, billedToday, t, useAppState } from '../store';
import type { Store } from '../types';
import { Confirm } from '../components/ui';

export function normalize(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function matches(store: Store, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const hay = normalize(`${store.name} ${store.ownerName ?? ''} ${store.address ?? ''} ${store.phone ?? ''}`);
  return q.split(' ').every((part) => hay.includes(part));
}

/** Picking a shop starts (or continues) its bill. Asks first if another shop's bill is unfinished. */
export function useShopPicker() {
  const s = useAppState();
  const [pendingStore, setPendingStore] = useState<Store | null>(null);
  const areaName = (id: number) => s.catalog?.areas.find((a) => a.id === id)?.name ?? '';
  const open = (store: Store) => {
    actions.startBill(store, areaName(store.areaId));
    actions.go({ name: 'cart' });
  };
  const pick = (store: Store) => {
    const d = s.draft;
    if (d && d.storeId !== store.id && Object.keys(d.qty).length > 0) setPendingStore(store);
    else open(store);
  };
  const dialog = (
    <Confirm
      open={Boolean(pendingStore)}
      text={t('otherDraft', { shop: s.draft?.storeName ?? '' })}
      onNo={() => setPendingStore(null)}
      onYes={() => {
        const store = pendingStore!;
        setPendingStore(null);
        actions.discardDraft();
        open(store);
      }}
    />
  );
  return { pick, dialog };
}

export function ShopRow(props: { store: Store; area?: string; billed?: number; onPick: () => void }) {
  const { store } = props;
  const extra = [props.area, store.ownerName, store.address].filter(Boolean).join(' · ');
  return (
    <button className={`row-btn ${props.billed ? 'row-billed' : ''}`} onClick={props.onPick}>
      <span className="row-icon">
        <IconShop size={26} />
      </span>
      <span className="row-text">
        <span className="row-title">{store.name}</span>
        {extra && <span className="row-sub">{extra}</span>}
      </span>
      {props.billed ? (
        <span className="row-badge">
          <IconCheck size={18} /> {rupees(props.billed)}
        </span>
      ) : null}
    </button>
  );
}

export function SearchBox(props: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search">
      <IconSearch size={24} />
      <input
        type="search"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        autoCorrect="off"
        autoCapitalize="off"
        enterKeyHint="search"
      />
      {props.value && (
        <button className="search-clear" onClick={() => props.onChange('')} aria-label="Clear">
          <IconX size={22} />
        </button>
      )}
    </div>
  );
}

export function AreasScreen() {
  const s = useAppState();
  const [query, setQuery] = useState('');
  const catalog = s.catalog;
  const billed = useMemo(() => billedToday(s), [s]);
  const { pick, dialog } = useShopPicker();
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const st of catalog?.stores ?? []) m.set(st.areaId, (m.get(st.areaId) ?? 0) + 1);
    return m;
  }, [catalog]);
  const results = useMemo(
    () => (query.trim() ? (catalog?.stores ?? []).filter((st) => matches(st, query)).slice(0, 60) : []),
    [catalog, query],
  );
  const areaName = (id: number) => catalog?.areas.find((a) => a.id === id)?.name ?? '';

  return (
    <div className="screen">
      <TopBar title={t('chooseArea')} />
      <main className="content">
        <SearchBox value={query} onChange={setQuery} placeholder={t('searchShop')} />
        {query.trim() ? (
          <div className="list">
            {results.length === 0 && <div className="empty">{t('noShops')}</div>}
            {results.map((st) => (
              <ShopRow key={st.id} store={st} area={areaName(st.areaId)} billed={billed.get(st.id)} onPick={() => pick(st)} />
            ))}
          </div>
        ) : (
          <div className="area-grid">
            {(catalog?.areas ?? []).map((a) => (
              <button
                key={a.id}
                className={`area-btn ${s.lastAreaId === a.id ? 'area-last' : ''}`}
                onClick={() => actions.go({ name: 'shops', areaId: a.id })}
              >
                <IconPin size={22} />
                <span className="area-name">{a.name}</span>
                <span className="area-count">{t('shopsN', { n: counts.get(a.id) ?? 0 })}</span>
              </button>
            ))}
          </div>
        )}
      </main>
      {dialog}
    </div>
  );
}
