import { useMemo, useState, type FormEvent } from 'react';
import { TopBar } from '../components/ui';
import { IconPlus } from '../icons';
import { actions, billedToday, errorText, t, useAppState } from '../store';
import { NetworkError } from '../api';
import { matches, SearchBox, ShopRow, useShopPicker } from './Areas';

export function ShopsScreen(props: { areaId: number }) {
  const s = useAppState();
  const [query, setQuery] = useState('');
  const area = s.catalog?.areas.find((a) => a.id === props.areaId);
  const billed = useMemo(() => billedToday(s), [s]);
  const { pick, dialog } = useShopPicker();
  const stores = useMemo(
    () => (s.catalog?.stores ?? []).filter((st) => st.areaId === props.areaId && matches(st, query)),
    [s.catalog, props.areaId, query],
  );
  const doneCount = stores.filter((st) => billed.has(st.id)).length;

  return (
    <div className="screen">
      <TopBar
        title={area?.name ?? t('chooseShop')}
        subtitle={`${t('chooseShop')} · ${doneCount}/${stores.length} ✓`}
      />
      <main className="content">
        <SearchBox value={query} onChange={setQuery} placeholder={t('searchShop')} />
        <div className="list">
          {stores.length === 0 && <div className="empty">{t('noShops')}</div>}
          {stores.map((st) => (
            <ShopRow key={st.id} store={st} billed={billed.get(st.id)} onPick={() => pick(st)} />
          ))}
        </div>
        <button className="btn btn-light btn-block add-shop" onClick={() => actions.go({ name: 'addShop', areaId: props.areaId })}>
          <IconPlus /> {t('addShop')}
        </button>
      </main>
      {dialog}
    </div>
  );
}

export function AddShopScreen(props: { areaId: number }) {
  const s = useAppState();
  const area = s.catalog?.areas.find((a) => a.id === props.areaId);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const store = await actions.addShop({
        areaId: props.areaId,
        name: name.trim(),
        ownerName: owner.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      actions.startBill(store, area?.name ?? '');
      actions.back();
      actions.go({ name: 'cart' });
    } catch (err) {
      setError(err instanceof NetworkError ? t('needInternetShop') : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <TopBar title={t('addShop')} subtitle={area?.name} />
      <main className="content">
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>{t('shopName')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoFocus />
          </label>
          <label className="field">
            <span>{t('ownerName')}</span>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={120} />
          </label>
          <label className="field">
            <span>{t('shopPhone')}</span>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))}
              maxLength={14}
            />
          </label>
          {!s.online && <div className="alert alert-amber">{t('needInternetShop')}</div>}
          {error && <div className="alert alert-red">{error}</div>}
          <button className="btn btn-green btn-xl" type="submit" disabled={busy || name.trim().length < 2}>
            {busy ? t('saving') : t('save')}
          </button>
        </form>
      </main>
    </div>
  );
}
