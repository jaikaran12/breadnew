import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, downloadUrl } from '../api';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pager, Toggle, toast } from '../components/ui';
import { ago, num, rupees } from '../format';
import { useAreas } from '../lookups';
import type { Store } from '../types';

interface StoreList {
  stores: Store[];
  total: number;
  page: number;
  pageSize: number;
}

export function StoresPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const areas = useAreas();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [areaId, setAreaId] = useState(params.get('areaId') ?? '');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [notVisited, setNotVisited] = useState('');
  const [sort, setSort] = useState('area');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Store | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => setPage(1), [search, areaId, status, notVisited, sort]);

  const list = useQuery({
    queryKey: ['stores', { search, areaId, status, notVisited, sort, page }],
    queryFn: () =>
      api.get<StoreList>('/stores', { q: search, areaId, status, notVisitedDays: notVisited, sort, page, pageSize: 100 }),
  });

  return (
    <>
      <PageHeader
        title="Shops (kirana)"
        subtitle="All shops the drivers can pick in the app. Shops added by drivers are marked “added by driver”."
        actions={
          <>
            <button className="btn btn-light" onClick={() => setImporting(true)}>
              Import from Excel / CSV
            </button>
            <a className="btn btn-light" href={downloadUrl('/stores/export.csv')}>
              Download list
            </a>
            <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={!areas.data?.length}>
              + Add shop
            </button>
          </>
        }
      />
      {areas.data && areas.data.length === 0 && (
        <div className="alert alert-amber">
          First <Link to="/areas">add an area</Link>, or import your shop list — areas are created automatically.
        </div>
      )}
      <Card>
        <div className="filter-row">
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
            }}
          >
            <input type="search" placeholder="Search name, owner, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-light">Search</button>
          </form>
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Area">
            <option value="">All areas</option>
            {areas.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.storeCount})
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
            <option value="active">Active shops</option>
            <option value="inactive">Removed shops</option>
            <option value="all">All shops</option>
          </select>
          <select value={notVisited} onChange={(e) => setNotVisited(e.target.value)} aria-label="Not visited">
            <option value="">Any last visit</option>
            <option value="3">No bill for 3+ days</option>
            <option value="7">No bill for 7+ days</option>
            <option value="30">No bill for 30+ days</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="area">Sort: area</option>
            <option value="name">Sort: name</option>
            <option value="sales30">Sort: biggest buyers (30 days)</option>
            <option value="lastVisit">Sort: last bill</option>
          </select>
        </div>
      </Card>
      <Card flush>
        <ErrorBox error={list.error} />
        {!list.data ? (
          <Loading />
        ) : list.data.stores.length === 0 ? (
          <Empty>No shops found.</Empty>
        ) : (
          <>
            <div className="table-meta">{num(list.data.total)} shops</div>
            <div className="table-wrap">
              <table className="table table-click">
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th>Area</th>
                    <th>Phone</th>
                    <th>Last bill</th>
                    <th className="num">Bills (30 days)</th>
                    <th className="num">Sales (30 days)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.stores.map((s) => (
                    <tr key={s.id} onClick={() => navigate(`/stores/${s.id}`)} className={s.isActive ? '' : 'row-cancelled'}>
                      <td>
                        <strong>{s.name}</strong>
                        <div className="muted small">{[s.ownerName, s.address].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>{s.areaName}</td>
                      <td>{s.phone ?? ''}</td>
                      <td className="small">{ago(s.lastSaleAt)}</td>
                      <td className="num">{num(s.bills30)}</td>
                      <td className="num strong">{rupees(s.amount30Paise)}</td>
                      <td onClick={(e) => e.stopPropagation()} className="nowrap">
                        {s.createdByDriverName && <Badge tone="blue">added by {s.createdByDriverName}</Badge>}{' '}
                        {!s.isActive && <Badge tone="red">removed</Badge>}{' '}
                        <button className="btn btn-light btn-sm" onClick={() => setEditing(s)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {editing && <StoreForm key={editing === 'new' ? 'new' : editing.id} store={editing} onClose={() => setEditing(null)} />}
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}

export function StoreForm(props: { store: Store | 'new'; onClose: () => void }) {
  const qc = useQueryClient();
  const areas = useAreas();
  const editing = props.store !== 'new' ? props.store : null;
  const [form, setFormState] = useState(() =>
    editing
      ? {
          areaId: String(editing.areaId),
          name: editing.name,
          ownerName: editing.ownerName ?? '',
          phone: editing.phone ?? '',
          address: editing.address ?? '',
          notes: editing.notes ?? '',
          isActive: editing.isActive,
        }
      : {
          areaId: String(areas.data?.find((a) => a.isActive)?.id ?? ''),
          name: '',
          ownerName: '',
          phone: '',
          address: '',
          notes: '',
          isActive: true,
        },
  );
  const setForm = (patch: Partial<typeof form>) => setFormState((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, areaId: Number(form.areaId) };
      return editing ? api.put(`/stores/${editing.id}`, body) : api.post('/stores', body);
    },
    onSuccess: () => {
      toast(editing ? 'Shop saved' : 'Shop added');
      void qc.invalidateQueries({ queryKey: ['stores'] });
      void qc.invalidateQueries({ queryKey: ['store'] });
      void qc.invalidateQueries({ queryKey: ['areas'] });
      props.onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ [k]: e.target.value });

  return (
    <Modal open onClose={props.onClose} title={editing ? `Edit ${editing.name}` : 'Add shop'}>
      <form className="form" onSubmit={submit}>
        <Field label="Area">
          <select value={form.areaId} onChange={set('areaId')} required>
            <option value="" disabled>
              Choose area
            </option>
            {areas.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.isActive ? '' : ' (hidden)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Shop name" hint="Add a landmark if two shops have the same name, e.g. “Sharma Kirana (near temple)”.">
          <input value={form.name} onChange={set('name')} required maxLength={120} autoFocus />
        </Field>
        <div className="form-2">
          <Field label="Owner name">
            <input value={form.ownerName} onChange={set('ownerName')} maxLength={120} />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={20} />
          </Field>
        </div>
        <Field label="Address / landmark">
          <input value={form.address} onChange={set('address')} maxLength={300} />
        </Field>
        <Field label="Notes (only you see these)">
          <textarea value={form.notes} onChange={set('notes')} maxLength={500} rows={2} />
        </Field>
        {editing && (
          <Toggle
            checked={form.isActive}
            onChange={(v) => setForm({ isActive: v })}
            label={form.isActive ? 'Active — drivers can pick this shop' : 'Removed — hidden from drivers (old bills stay)'}
          />
        )}
        <ErrorBox error={save.error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-light" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface ImportResult {
  dryRun: boolean;
  rows: number;
  areasCreated: string[];
  storesCreated: number;
  skippedExisting: number;
  errors: Array<{ line: number; message: string }>;
}

const SAMPLE = `Area,Shop name,Owner,Phone,Address
Gandhi Nagar,Sharma Kirana,Ramesh Sharma,9876543210,Near Hanuman temple
Gandhi Nagar,Balaji Provision,,9812345678,Main road
Station Road,Gupta General Store,Anil Gupta,,Opp. bus stand
`;

function ImportDialog(props: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.post<ImportResult>('/stores/import', { csv: text, dryRun }),
    onSuccess: (res) => {
      if (res.dryRun) setPreview(res);
      else {
        toast(`Imported ${res.storesCreated} shops`);
        void qc.invalidateQueries();
        setText('');
        setPreview(null);
        props.onClose();
      }
    },
  });
  useEffect(() => {
    setPreview(null);
  }, [text]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
  };
  const sampleUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`;

  return (
    <Modal open={props.open} onClose={props.onClose} title="Import shops" wide>
      <ol className="import-help">
        <li>
          Make a sheet in Excel / Google Sheets with columns <b>Area</b>, <b>Shop name</b> and optionally <b>Owner</b>,{' '}
          <b>Phone</b>, <b>Address</b>. (<a href={sampleUrl} download="shops-sample.csv">download a sample</a>)
        </li>
        <li>Copy the cells (including the heading row) and paste below, or upload the file saved as CSV.</li>
        <li>Click “Check”, then “Import”. New areas are created; shops already in the list are skipped.</li>
      </ol>
      <textarea
        className="import-text"
        rows={9}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={SAMPLE}
        spellCheck={false}
      />
      <div className="row-gap">
        <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      <ErrorBox error={run.error} />
      {preview && (
        <div className="import-preview">
          <p>
            <b>{preview.rows}</b> rows checked: <b>{preview.storesCreated}</b> new shops will be added
            {preview.areasCreated.length > 0 && (
              <>
                , <b>{preview.areasCreated.length}</b> new areas ({preview.areasCreated.join(', ')})
              </>
            )}
            , <b>{preview.skippedExisting}</b> already exist and will be skipped.
          </p>
          {preview.errors.length > 0 && (
            <div className="alert alert-amber">
              {preview.errors.length} row(s) will be skipped:
              <ul>
                {preview.errors.slice(0, 10).map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn btn-light" onClick={props.onClose}>
          Close
        </button>
        {!preview ? (
          <button className="btn btn-primary" onClick={() => run.mutate(true)} disabled={!text.trim() || run.isPending}>
            Check
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => run.mutate(false)} disabled={run.isPending || preview.storesCreated === 0}>
            Import {preview.storesCreated} shops
          </button>
        )}
      </div>
    </Modal>
  );
}
