import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, Card, DayPicker, Empty, ErrorBox, Loading, PageHeader, Stat, toast } from '../components/ui';
import { dateTime, paiseToInput, parseRupees, rupees, time, todayIn } from '../format';

interface TallyRow {
  driverId: number;
  driverName: string;
  phone: string;
  isActive: boolean;
  bills: number;
  totalPaise: number;
  cashPaise: number;
  upiPaise: number;
  creditPaise: number;
  cancelledBills: number;
  cancelledPaise: number;
  firstSaleAt: string | null;
  lastSaleAt: string | null;
  settled: boolean;
  cashReceivedPaise: number | null;
  settledExpectedCashPaise: number | null;
  differencePaise: number | null;
  changedSinceSettled: boolean;
  note: string | null;
  settledAt: string | null;
  settledBy: string | null;
}

interface TallyResponse {
  date: string;
  drivers: TallyRow[];
  totals: {
    bills: number;
    totalPaise: number;
    cashPaise: number;
    upiPaise: number;
    creditPaise: number;
    cashReceivedPaise: number;
    settledDrivers: number;
    driversWithSales: number;
  };
}

export function TallyPage() {
  const [date, setDate] = useState(todayIn());
  const q = useQuery({
    queryKey: ['tally', date],
    queryFn: () => api.get<TallyResponse>('/tally', { date }),
    refetchInterval: date === todayIn() ? 30_000 : false,
  });
  const t = q.data?.totals;

  return (
    <>
      <PageHeader
        title="Cash tally"
        subtitle="At the end of the day, enter the cash each driver hands over. The difference shows if cash is short."
        actions={<DayPicker value={date} onChange={setDate} />}
      />
      <ErrorBox error={q.error} />
      {t && (
        <div className="stats">
          <Stat label="Total sales" value={rupees(t.totalPaise)} hint={`${t.bills} bills`} />
          <Stat label="Cash expected" tone="green" value={rupees(t.cashPaise)} hint="from cash bills" />
          <Stat label="UPI" tone="blue" value={rupees(t.upiPaise)} hint="check in your UPI app" />
          <Stat label="Udhaar" tone="amber" value={rupees(t.creditPaise)} hint="given on credit" />
          <Stat
            label="Tallied"
            value={`${t.settledDrivers} / ${t.driversWithSales}`}
            hint={t.settledDrivers ? `received ${rupees(t.cashReceivedPaise)}` : 'drivers with sales'}
          />
        </div>
      )}
      <Card flush>
        {!q.data ? (
          <Loading />
        ) : q.data.drivers.length === 0 ? (
          <Empty>No drivers yet. Add drivers first.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table tally-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th className="num">Bills</th>
                  <th className="num">Total sales</th>
                  <th className="num">UPI</th>
                  <th className="num">Udhaar</th>
                  <th className="num">Cash expected</th>
                  <th>Cash received</th>
                  <th className="num">Difference</th>
                </tr>
              </thead>
              <tbody>
                {q.data.drivers.map((row) => (
                  <TallyRowView key={row.driverId} row={row} date={date} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="muted small">
        Cash expected = total of bills marked <b>Cash</b>. UPI money goes to your account directly; Udhaar is credit given to
        the shop. Cancelled bills are not counted. A driver cannot cancel bills on the phone after the day is tallied.
      </p>
    </>
  );
}

function TallyRowView(props: { row: TallyRow; date: string }) {
  const { row } = props;
  const qc = useQueryClient();
  const [editing, setEditing] = useState(!row.settled);
  const [cash, setCash] = useState(row.settled ? paiseToInput(row.cashReceivedPaise ?? 0) : '');
  const [note, setNote] = useState(row.note ?? '');
  useEffect(() => {
    setEditing(!row.settled);
    setCash(row.settled ? paiseToInput(row.cashReceivedPaise ?? 0) : '');
    setNote(row.note ?? '');
  }, [row.settled, row.cashReceivedPaise, row.note, props.date]);

  const save = useMutation({
    mutationFn: (paise: number) =>
      api.put('/tally', { driverId: row.driverId, date: props.date, cashReceivedPaise: paise, note: note.trim() || null }),
    onSuccess: () => {
      toast(`Saved tally for ${row.driverName}`);
      void qc.invalidateQueries({ queryKey: ['tally'] });
    },
  });
  const reopen = useMutation({
    mutationFn: () => api.del('/tally', { driverId: row.driverId, date: props.date }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tally'] }),
  });

  const typed = parseRupees(cash);
  const liveDiff = typed !== null ? typed - row.cashPaise : null;
  const diff = editing ? liveDiff : row.differencePaise;
  const diffTone = diff === null ? '' : diff === 0 ? 'diff-ok' : diff < 0 ? 'diff-short' : 'diff-extra';

  return (
    <tr className={row.bills === 0 && !row.settled ? 'row-quiet' : ''}>
      <td>
        <Link to={`/sales?driverId=${row.driverId}&from=${props.date}&to=${props.date}`}>{row.driverName}</Link>
        {!row.isActive && <Badge>off</Badge>}
        <div className="muted small">
          {row.firstSaleAt ? `${time(row.firstSaleAt)} – ${time(row.lastSaleAt)}` : 'no bills'}
          {row.cancelledBills > 0 && ` · ${row.cancelledBills} cancelled (${rupees(row.cancelledPaise)})`}
        </div>
      </td>
      <td className="num">{row.bills}</td>
      <td className="num">{rupees(row.totalPaise)}</td>
      <td className="num">{rupees(row.upiPaise)}</td>
      <td className="num">{rupees(row.creditPaise)}</td>
      <td className="num strong">{rupees(row.cashPaise)}</td>
      <td>
        {editing ? (
          <form
            className="tally-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed !== null) save.mutate(typed);
            }}
          >
            <div className="money-input">
              <span>₹</span>
              <input
                inputMode="decimal"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                placeholder="Enter cash"
                aria-label={`Cash received from ${row.driverName}`}
              />
            </div>
            <input className="note-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
            <button className="btn btn-primary btn-sm" disabled={typed === null || save.isPending}>
              Save
            </button>
            {row.bills > 0 && cash === '' && (
              <button type="button" className="btn btn-light btn-sm" onClick={() => setCash(paiseToInput(row.cashPaise))}>
                = expected
              </button>
            )}
            {row.settled && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
            <ErrorBox error={save.error} />
          </form>
        ) : (
          <div className="tally-done">
            <strong>{rupees(row.cashReceivedPaise)}</strong> <Badge tone="green">Tallied</Badge>
            {row.changedSinceSettled && (
              <Badge tone="red" title={`Expected cash was ${rupees(row.settledExpectedCashPaise)} when tallied`}>
                Bills changed after tally — check again
              </Badge>
            )}
            <div className="muted small">
              {row.note ? `“${row.note}” · ` : ''}
              {row.settledBy ? `${row.settledBy}, ` : ''}
              {dateTime(row.settledAt)}
            </div>
            <div className="row-gap">
              <button className="btn btn-light btn-sm" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
                Re-open day
              </button>
            </div>
          </div>
        )}
      </td>
      <td className={`num diff ${diffTone}`}>
        {diff === null ? '—' : diff === 0 ? 'Matches ✓' : diff < 0 ? `Short ${rupees(-diff)}` : `Extra ${rupees(diff)}`}
      </td>
    </tr>
  );
}
