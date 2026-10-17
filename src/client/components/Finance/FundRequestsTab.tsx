/**
 * @file components/Finance/FundRequestsTab.tsx
 * @description Solicitudes de fondos (SF): lista con filtros y totales por moneda, alta y edición
 * con monto en letras automático, pagos parciales, anulación con motivo y SF imprimible.
 * Reemplaza SFONDOS, SFONDOS PEND y los informes SF / SF CONSORCIO / SF EN USS del Access.
 */

import React, { useEffect, useState } from 'react';
import { formatDocNumber } from '../../../shared/finance';
import { Ban, Download, Plus, Printer, Wallet } from 'lucide-react';
import { validateFundRequestDraft, type FundRequestDto, type FundRequestStatus } from '../../../shared/finance';
import { formatCurrency } from '../../../shared/calculations';
import { describeError } from '../../services/http';
import { financeApi, type FundRequestDraft, type FundRequestFilters } from '../../services/financeApi';
import { printArea } from '../../utils/print';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Modal, StatusPill, cx, inputClass } from '../../ui';
import { DispatchBadge } from '../Dispatch/DispatchBadge';
import { SupplierPicker } from './SupplierPicker';
import { FUND_LABEL, FUND_TONE, LETTERHEAD_LABEL, totalsOf, wordsPreview, type FinanceRefs } from './common';

export const FundRequestsTab: React.FC<{ refs: FinanceRefs; reloadRefs: () => void; membrete: string; onMembrete: (key: string) => void }> = ({
  refs,
  reloadRefs,
  membrete,
  onMembrete,
}) => {
  const [filters, setFilters] = useState<FundRequestFilters>({});
  const [list, setList] = useState<FundRequestDto[] | null>(null);
  const [editing, setEditing] = useState<FundRequestDto | 'NUEVA' | null>(null);
  const [printing, setPrinting] = useState<FundRequestDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setError(null);
    financeApi
      .fundRequests(filters)
      .then(setList)
      .catch((err) => setError(describeError(err)));
  }, [filters, reloadKey]);

  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(null);
    return restore;
  }, [printing]);

  const setFilter = <K extends keyof FundRequestFilters>(key: K, value: FundRequestFilters[K] | '') =>
    setFilters((prev) => ({ ...prev, [key]: value === '' ? undefined : value }));

  const totals = list ? totalsOf(list) : {};
  const currencies = [refs.settings.currency, refs.settings.secondaryCurrency];

  const exportExcel = () => {
    if (!list) return;
    exportRowsToExcel(
      list.map((sf) => ({
        Nº: formatDocNumber(sf.numero, sf.anio),
        Fecha: formatDate(sf.fecha),
        Proveedor: sf.supplier.nombre,
        Concepto: sf.concepto,
        Moneda: sf.currency,
        Monto: sf.monto,
        Pagado: sf.pagado,
        Saldo: sf.saldo,
        Estado: FUND_LABEL[sf.estado],
        Cuenta: sf.account?.nombre ?? '',
        Máquina: sf.machine?.codigo ?? '',
        Pedido: sf.order?.numero ?? null,
      })),
      'Solicitudes',
      `solicitudes-de-fondos-${todayIso()}.xlsx`,
    );
  };

  return (
    <>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Estado">
            <select className={inputClass} value={filters.estado ?? ''} onChange={(e) => setFilter('estado', e.target.value as FundRequestStatus)}>
              <option value="">Todos</option>
              {(Object.keys(FUND_LABEL) as FundRequestStatus[]).map((s) => (
                <option key={s} value={s}>{FUND_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="Proveedor">
            <select className={inputClass} value={filters.proveedor ?? ''} onChange={(e) => setFilter('proveedor', e.target.value)}>
              <option value="">Todos</option>
              {refs.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Moneda">
            <select className={inputClass} value={filters.moneda ?? ''} onChange={(e) => setFilter('moneda', e.target.value)}>
              <option value="">Todas</option>
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Desde">
            <input type="date" className={inputClass} value={filters.desde ?? ''} onChange={(e) => setFilter('desde', e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input type="date" className={inputClass} value={filters.hasta ?? ''} onChange={(e) => setFilter('hasta', e.target.value)} />
          </Field>
          <Field label="Buscar">
            <input className={inputClass} placeholder="Nº, concepto o factura" value={filters.q ?? ''} onChange={(e) => setFilter('q', e.target.value)} />
          </Field>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <Field label="Membrete">
              <select className={inputClass} value={membrete} onChange={(e) => onMembrete(e.target.value)}>
                {Object.keys(refs.settings.letterheads).map((k) => (
                  <option key={k} value={k}>{LETTERHEAD_LABEL[k] ?? k}</option>
                ))}
              </select>
            </Field>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!list?.length} onClick={exportExcel}>Excel</Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('NUEVA')}>Nueva SF</Button>
          </div>
        </div>

        {Object.keys(totals).length > 0 && (
          <div className="flex flex-wrap gap-6 border-b border-slate-100 px-4 py-3 text-sm">
            {Object.entries(totals).map(([currency, t]) => (
              <div key={currency}>
                <span className="font-semibold text-slate-900">{currency}</span>{' '}
                <span className="text-slate-600">solicitado {formatCurrency(t.monto, currency)} · pagado {formatCurrency(t.pagado, currency)} · saldo </span>
                <span className="font-semibold text-slate-900">{formatCurrency(t.saldo, currency)}</span>
              </div>
            ))}
          </div>
        )}

        {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}

        {list === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando solicitudes…</div>
        ) : list.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<Wallet className="h-6 w-6" />} title="No hay solicitudes con estos filtros" help="Creá una SF o cambiá los filtros." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Nº</th>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Proveedor</th>
                  <th className="px-4 py-2.5">Concepto</th>
                  <th className="px-4 py-2.5 text-right">Monto</th>
                  <th className="px-4 py-2.5 text-right">Saldo</th>
                  <th className="px-4 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((sf) => (
                  <tr key={sf.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(sf)}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{formatDocNumber(sf.numero, sf.anio)}</td>
                    <td className="px-4 py-2.5">{formatDate(sf.fecha)}</td>
                    <td className="px-4 py-2.5">{sf.supplier.nombre}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-slate-600">{sf.concepto}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(sf.monto, sf.currency)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(sf.saldo, sf.currency)}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={FUND_TONE[sf.estado]}>{FUND_LABEL[sf.estado]}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <FundRequestEditor
          sf={editing === 'NUEVA' ? null : editing}
          refs={refs}
          reloadRefs={reloadRefs}
          onClose={() => setEditing(null)}
          onChanged={() => setReloadKey((k) => k + 1)}
          onPrint={setPrinting}
        />
      )}
      {printing && (
        <PrintableFundRequest sf={printing} letterhead={refs.settings.letterheads[membrete] ?? ''} membrete={membrete} />
      )}
    </>
  );
};

/* ─── Editor de SF ─────────────────────────────────────────────────────── */

const FundRequestEditor: React.FC<{
  sf: FundRequestDto | null;
  refs: FinanceRefs;
  reloadRefs: () => void;
  onClose: () => void;
  onChanged: () => void;
  onPrint: (sf: FundRequestDto) => void;
}> = ({ sf, refs, reloadRefs, onClose, onChanged, onPrint }) => {
  const [current, setCurrent] = useState<FundRequestDto | null>(sf);
  const [draft, setDraft] = useState<FundRequestDraft>(() => ({
    fecha: sf?.fecha ?? todayIso(),
    supplierId: sf?.supplier.id ?? '',
    monto: sf?.monto ?? 0,
    currency: sf?.currency ?? refs.settings.currency,
    concepto: sf?.concepto ?? '',
    facturaORemision: sf?.facturaORemision ?? null,
    accountId: sf?.account?.id ?? null,
    machineId: sf?.machine?.id ?? null,
    pedidoNumero: sf?.order?.numero ?? null,
  }));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [payFecha, setPayFecha] = useState(todayIso());
  const [payMonto, setPayMonto] = useState('');
  const [payRef, setPayRef] = useState('');
  const [annulMotivo, setAnnulMotivo] = useState<string | null>(null);

  const hasPayments = current?.pagos.some((p) => !p.anulado) ?? false;
  const readOnly = current !== null && (current.anulado || hasPayments || current.pettyCashSheet !== null);
  const patch = (changes: Partial<FundRequestDraft>) => setDraft((prev) => ({ ...prev, ...changes }));
  const currencies = [refs.settings.currency, refs.settings.secondaryCurrency];

  const guard = async (fn: () => Promise<void>) => {
    setErrors([]);
    try {
      await fn();
    } catch (err) {
      setErrors([describeError(err)]);
    }
  };

  const save = () =>
    guard(async () => {
      const local = validateFundRequestDraft(draft, todayIso(), currencies);
      if (local.length > 0) {
        setErrors(local);
        return;
      }
      setSaving(true);
      try {
        const saved = current ? await financeApi.updateFundRequest(current.id, draft) : await financeApi.createFundRequest(draft);
        setCurrent(saved);
        onChanged();
      } finally {
        setSaving(false);
      }
    });

  const refresh = async () => {
    if (!current) return;
    setCurrent(await financeApi.fundRequest(current.id));
    onChanged();
  };

  const pay = () =>
    guard(async () => {
      if (!current) return;
      const monto = Number(payMonto === '' ? current.saldo : payMonto);
      const updated = await financeApi.payFundRequest(current.id, { fecha: payFecha, monto, referencia: payRef || null });
      setCurrent(updated);
      setPayMonto('');
      setPayRef('');
      onChanged();
    });

  const annulPayment = (id: string) =>
    guard(async () => {
      await financeApi.annulPayment(id);
      await refresh();
    });

  const annulSf = () =>
    guard(async () => {
      if (!current || annulMotivo === null) return;
      setCurrent(await financeApi.annulFundRequest(current.id, annulMotivo));
      setAnnulMotivo(null);
      onChanged();
    });

  const words = wordsPreview(draft.monto, draft.currency);

  return (
    <Modal
      title={current ? `SF Nº ${formatDocNumber(current.numero, current.anio)}` : 'Nueva solicitud de fondos'}
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {current && (
              <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => onPrint(current)}>Imprimir</Button>
            )}
            {current && !current.anulado && !hasPayments && annulMotivo === null && (
              <Button variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setAnnulMotivo('')}>Anular</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
            {!readOnly && <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar SF'}</Button>}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {current && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusPill tone={FUND_TONE[current.estado]}>{FUND_LABEL[current.estado]}</StatusPill>
            {!current.anulado && <DispatchBadge kind="SF" id={current.id} />}
            {current.pettyCashSheet && <span className="text-slate-500">Reposición de la caja chica Nº {formatDocNumber(current.pettyCashSheet.numero, current.pettyCashSheet.anio)}</span>}
            {readOnly && !current.pettyCashSheet && (
              <span className="text-slate-500">{current.anulado ? `Anulada: ${current.anuladoMotivo ?? ''}` : 'Tiene pagos: no se puede editar.'}</span>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha">
            <input type="date" className={inputClass} value={draft.fecha} disabled={readOnly} onChange={(e) => patch({ fecha: e.target.value })} />
          </Field>
          <Field label="Proveedor">
            <SupplierPicker
              suppliers={refs.suppliers}
              value={draft.supplierId}
              disabled={readOnly}
              onChange={(supplierId) => patch({ supplierId })}
              onCreated={reloadRefs}
            />
          </Field>
          <Field label="Monto">
            <input
              type="number"
              min="0"
              step="any"
              className={cx(inputClass, 'text-right')}
              value={draft.monto || ''}
              disabled={readOnly}
              onChange={(e) => patch({ monto: Number(e.target.value) })}
            />
          </Field>
          <Field label="Moneda">
            <select className={inputClass} value={draft.currency} disabled={readOnly} onChange={(e) => patch({ currency: e.target.value })}>
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Monto en letras">
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">{words || '—'}</p>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Concepto">
              <input className={inputClass} value={draft.concepto} disabled={readOnly} onChange={(e) => patch({ concepto: e.target.value })} />
            </Field>
          </div>
          <Field label="Factura o remisión">
            <input className={inputClass} value={draft.facturaORemision ?? ''} disabled={readOnly} onChange={(e) => patch({ facturaORemision: e.target.value || null })} />
          </Field>
          <Field label="Pedido de materiales Nº" hint="Enlaza la SF con un pedido">
            <input
              type="number"
              min="1"
              className={inputClass}
              value={draft.pedidoNumero ?? ''}
              disabled={readOnly}
              onChange={(e) => patch({ pedidoNumero: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </Field>
          <Field label="Cuenta">
            <select className={inputClass} value={draft.accountId ?? ''} disabled={readOnly} onChange={(e) => patch({ accountId: e.target.value || null })}>
              <option value="">Sin cuenta</option>
              {refs.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.codigo} · {a.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Máquina">
            <select className={inputClass} value={draft.machineId ?? ''} disabled={readOnly} onChange={(e) => patch({ machineId: e.target.value || null })}>
              <option value="">Sin máquina</option>
              {refs.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.codigo} · {m.descripcion}</option>
              ))}
            </select>
          </Field>
        </div>

        {current && !current.anulado && (
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Pagos</h3>
              <span className="text-sm text-slate-600">
                Pagado {formatCurrency(current.pagado, current.currency)} · saldo{' '}
                <span className="font-semibold text-slate-900">{formatCurrency(current.saldo, current.currency)}</span>
              </span>
            </div>
            {current.pagos.length > 0 && (
              <ul className="divide-y divide-slate-100 text-sm">
                {current.pagos.map((p) => (
                  <li key={p.id} className={cx('flex items-center justify-between py-1.5', p.anulado && 'text-slate-400 line-through')}>
                    <span>Pago Nº {p.numero} · {formatDate(p.fecha)}{p.referencia ? ` · ${p.referencia}` : ''}</span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono">{formatCurrency(p.monto, p.currency)}</span>
                      {!p.anulado && (
                        <button type="button" onClick={() => annulPayment(p.id)} className="text-xs text-rose-600 hover:underline">Anular pago</button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {current.estado !== 'PAGADA' && (
              <div className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr_auto]">
                <input type="date" className={inputClass} value={payFecha} onChange={(e) => setPayFecha(e.target.value)} />
                <input type="number" min="0" step="any" className={cx(inputClass, 'text-right')} placeholder={`Monto (saldo ${current.saldo})`} value={payMonto} onChange={(e) => setPayMonto(e.target.value)} />
                <input className={inputClass} placeholder="Referencia (transferencia, cheque…)" value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                <Button variant="primary" onClick={pay}>Registrar pago</Button>
              </div>
            )}
          </div>
        )}

        {annulMotivo !== null && current && (
          <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm font-medium text-rose-800">Anular la SF Nº {formatDocNumber(current.numero, current.anio)}: indicá el motivo.</p>
            <div className="flex gap-2">
              <input className={inputClass} value={annulMotivo} onChange={(e) => setAnnulMotivo(e.target.value)} placeholder="Motivo de la anulación" />
              <Button variant="danger" onClick={annulSf}>Confirmar anulación</Button>
              <Button variant="ghost" onClick={() => setAnnulMotivo(null)}>Cancelar</Button>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};

/* ─── SF imprimible ────────────────────────────────────────────────────── */

export const PrintableFundRequest: React.FC<{ sf: FundRequestDto; letterhead: string; membrete: string }> = ({ sf, letterhead, membrete }) => (
  <div className="print-area text-sm text-black">
    <div className="mb-6 flex items-start justify-between border-b border-black pb-2">
      <div>
        <div className="text-lg font-bold">{letterhead || LETTERHEAD_LABEL[membrete]}</div>
        <div>Solicitud de fondos</div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold">SF Nº {formatDocNumber(sf.numero, sf.anio)}</div>
        <div>Fecha: {formatDate(sf.fecha)}</div>
        {sf.anulado && <div className="font-bold">ANULADA</div>}
      </div>
    </div>
    <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2">
      <div>Proveedor: <span className="font-semibold">{sf.supplier.nombre}</span> ({sf.supplier.codigo})</div>
      <div>Factura o remisión: {sf.facturaORemision ?? '—'}</div>
      <div>Cuenta: {sf.account?.nombre ?? '—'}</div>
      <div>Máquina: {sf.machine ? `${sf.machine.codigo} · ${sf.machine.descripcion}` : '—'}</div>
      <div>Pedido de materiales: {sf.order ? `Nº ${sf.order.numero}` : '—'}</div>
    </div>
    <div className="mb-2">Concepto: {sf.concepto}</div>
    <div className="my-6 rounded border border-black p-3">
      <div className="text-lg font-bold">{formatCurrency(sf.monto, sf.currency)}</div>
      <div className="font-semibold">{sf.montoEnLetras}</div>
    </div>
    <div className="mt-20 grid grid-cols-3 gap-10 text-center">
      <div className="border-t border-black pt-1">Solicitado por</div>
      <div className="border-t border-black pt-1">Autorizado por</div>
      <div className="border-t border-black pt-1">Recibí conforme</div>
    </div>
  </div>
);
