/**
 * @file components/Finance/PettyCashTab.tsx
 * @description Caja chica por rendiciones (NO CAJA CHICA del Access): grilla de carga rápida,
 * totales por cuenta, cierre que bloquea cambios, rendición imprimible y botón de reposición
 * que crea la SF por lo gastado en efectivo, enlazada a la rendición.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { formatDocNumber } from '../../../shared/finance';
import { CheckCircle2, Plus, Printer, Trash2, Wallet } from 'lucide-react';
import { normalizeMachineCode } from '../../../shared/fleet';
import { validatePettyCashLine, type PettyCashSheetDto } from '../../../shared/finance';
import { formatCurrency } from '../../../shared/calculations';
import { describeError } from '../../services/http';
import { financeApi, type LineDraft } from '../../services/financeApi';
import { printArea } from '../../utils/print';
import { formatDate, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Modal, StatusPill, cx, inputClass } from '../../ui';
import { DispatchBadge } from '../Dispatch/DispatchBadge';
import { SupplierPicker } from './SupplierPicker';
import { FUND_LABEL, FUND_TONE, LETTERHEAD_LABEL, type FinanceRefs } from './common';

interface RowDraft {
  fecha: string;
  supplierCode: string;
  factura: string;
  concepto: string;
  monto: string;
  accountId: string;
  machineCode: string;
  aCredito: boolean;
}

const nextRow = (prev?: RowDraft): RowDraft => ({
  fecha: prev?.fecha ?? todayIso(),
  supplierCode: prev?.supplierCode ?? '',
  factura: '',
  concepto: '',
  monto: '',
  accountId: '',
  machineCode: '',
  aCredito: false,
});

export const PettyCashTab: React.FC<{ refs: FinanceRefs; reloadRefs: () => void; membrete: string }> = ({ refs, reloadRefs, membrete }) => {
  const [sheets, setSheets] = useState<PettyCashSheetDto[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setError(null);
    financeApi
      .sheets()
      .then(setSheets)
      .catch((err) => setError(describeError(err)));
  }, [reloadKey]);

  const create = async () => {
    try {
      const sheet = await financeApi.createSheet();
      setReloadKey((k) => k + 1);
      setOpenId(sheet.id);
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <>
      <Card padded={false} title="Rendiciones de caja chica" action={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={create}>Nueva rendición</Button>}>
        {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
        {sheets === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando rendiciones…</div>
        ) : sheets.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<Wallet className="h-6 w-6" />} title="Todavía no hay rendiciones" help="Creá una rendición y cargá los gastos de caja chica." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Nº</th>
                  <th className="px-4 py-2.5">Apertura</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5 text-right">Renglones</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5">Reposición</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sheets.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(s.id)}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{formatDocNumber(s.numero, s.anio)}</td>
                    <td className="px-4 py-2.5">{formatDate(s.fechaApertura)}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={s.estado === 'ABIERTA' ? 'warn' : 'good'}>{s.estado === 'ABIERTA' ? 'Abierta' : 'Cerrada'}</StatusPill></td>
                    <td className="px-4 py-2.5 text-right font-mono">{s.lineCount}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(s.total, s.currency)}</td>
                    <td className="px-4 py-2.5">
                      {s.reposicion ? (
                        <StatusPill tone={FUND_TONE[s.reposicion.estado]}>SF Nº {formatDocNumber(s.reposicion.numero, s.reposicion.anio)} · {FUND_LABEL[s.reposicion.estado]}</StatusPill>
                      ) : (
                        <span className="text-slate-400">{s.estado === 'CERRADA' ? 'Sin reponer' : '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {openId && (
        <SheetEditor
          sheetId={openId}
          refs={refs}
          reloadRefs={reloadRefs}
          membrete={membrete}
          onClose={() => setOpenId(null)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
    </>
  );
};

/* ─── Rendición abierta ────────────────────────────────────────────────── */

const SheetEditor: React.FC<{
  sheetId: string;
  refs: FinanceRefs;
  reloadRefs: () => void;
  membrete: string;
  onClose: () => void;
  onChanged: () => void;
}> = ({ sheetId, refs, reloadRefs, membrete, onClose, onChanged }) => {
  const [sheet, setSheet] = useState<PettyCashSheetDto | null>(null);
  const [rows, setRows] = useState<RowDraft[]>([nextRow()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickBeneficiary, setPickBeneficiary] = useState(false);
  const [beneficiary, setBeneficiary] = useState('');
  const [printing, setPrinting] = useState(false);

  const supplierByCode = useMemo(() => new Map(refs.suppliers.map((s) => [s.codigo.toLowerCase(), s])), [refs.suppliers]);
  const machineByCode = useMemo(() => new Map(refs.machines.map((m) => [normalizeMachineCode(m.codigo), m])), [refs.machines]);

  useEffect(() => {
    financeApi
      .sheet(sheetId)
      .then(setSheet)
      .catch((err) => setErrors([describeError(err)]));
  }, [sheetId]);

  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(false);
    return restore;
  }, [printing]);

  const open = sheet?.estado === 'ABIERTA';
  const patchRow = (i: number, changes: Partial<RowDraft>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...changes } : r)));

  const guard = async (fn: () => Promise<void>) => {
    setErrors([]);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setErrors([describeError(err)]);
    }
  };

  const saveRows = () =>
    guard(async () => {
      if (!sheet) return;
      const used = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.supplierCode.trim() || r.monto.trim() || r.concepto.trim());
      const local: string[] = [];
      const drafts: LineDraft[] = [];
      for (const { r, i } of used) {
        const supplier = supplierByCode.get(r.supplierCode.trim().toLowerCase());
        const machine = r.machineCode.trim() ? machineByCode.get(normalizeMachineCode(r.machineCode)) : undefined;
        if (r.supplierCode.trim() && !supplier) local.push(`Fila ${i + 1}: el proveedor «${r.supplierCode}» no existe.`);
        if (r.machineCode.trim() && !machine) local.push(`Fila ${i + 1}: la máquina «${r.machineCode}» no existe.`);
        const monto = Number(r.monto);
        for (const e of validatePettyCashLine({ fecha: r.fecha, supplierId: supplier?.id, monto, aCredito: r.aCredito }, todayIso())) {
          local.push(`Fila ${i + 1}: ${e}`);
        }
        drafts.push({
          fecha: r.fecha,
          supplierId: supplier?.id ?? null,
          facturaORemision: r.factura.trim() || null,
          concepto: r.concepto.trim() || null,
          monto,
          accountId: r.accountId || null,
          machineId: machine?.id ?? null,
          aCredito: r.aCredito,
        });
      }
      if (drafts.length === 0) local.push('No hay renglones para guardar.');
      if (local.length > 0) {
        setErrors(local);
        return;
      }
      setSaving(true);
      try {
        const updated = await financeApi.addLines(sheet.id, drafts);
        setSheet(updated);
        setRows([nextRow(rows[rows.length - 1])]);
        setMessage(`Se guardaron ${drafts.length} renglones.`);
        onChanged();
      } finally {
        setSaving(false);
      }
    });

  const deleteLine = (lineId: string) =>
    guard(async () => {
      if (!sheet) return;
      setSheet(await financeApi.deleteLine(sheet.id, lineId));
      onChanged();
    });

  const close = () =>
    guard(async () => {
      if (!sheet) return;
      if (!window.confirm('¿Cerrar la rendición? Después no se podrán agregar ni borrar renglones.')) return;
      setSheet(await financeApi.closeSheet(sheet.id));
      onChanged();
    });

  const replenish = (supplierId?: string) =>
    guard(async () => {
      if (!sheet) return;
      const sf = await financeApi.replenish(sheet.id, supplierId);
      setPickBeneficiary(false);
      setMessage(`Se creó la SF Nº ${formatDocNumber(sf.numero, sf.anio)} por ${formatCurrency(sf.monto, sf.currency)} (${sf.supplier.nombre}).`);
      setSheet(await financeApi.sheet(sheet.id));
      reloadRefs();
      onChanged();
    });

  const requestReplenishment = () => {
    if (!sheet) return;
    const habitual = refs.suppliers.find((s) => s.id === refs.settings.pettyCashSupplierId);
    if (!habitual) {
      setPickBeneficiary(true);
      return;
    }
    if (window.confirm(`Se creará una SF por ${formatCurrency(sheet.totalEfectivo, sheet.currency)} a nombre de ${habitual.nombre}. ¿Continuar?`)) {
      void replenish();
    }
  };

  const accountName = (id: string | null) => refs.accounts.find((a) => a.id === id)?.nombre ?? 'Sin cuenta';
  const machineName = (id: string | null) => refs.machines.find((m) => m.id === id)?.codigo ?? 'Sin máquina';

  return (
    <>
      <Modal
        title={sheet ? `Rendición de caja chica Nº ${formatDocNumber(sheet.numero, sheet.anio)}` : 'Rendición de caja chica'}
        size="xl"
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {sheet && <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => setPrinting(true)}>Imprimir</Button>}
              {sheet && open && sheet.lineCount > 0 && <Button variant="secondary" icon={<CheckCircle2 className="h-4 w-4" />} onClick={close}>Cerrar rendición</Button>}
              {sheet && !open && !sheet.reposicion && sheet.totalEfectivo > 0 && (
                <Button variant="primary" icon={<Wallet className="h-4 w-4" />} onClick={requestReplenishment}>Solicitar reposición</Button>
              )}
            </div>
            <Button variant="ghost" onClick={onClose}>Cerrar ventana</Button>
          </div>
        }
      >
        {!sheet ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StatusPill tone={open ? 'warn' : 'good'}>{open ? 'Abierta' : 'Cerrada'}</StatusPill>
              {!open && <DispatchBadge kind="RENDICION" id={sheet.id} />}
              <span className="text-slate-500">Apertura {formatDate(sheet.fechaApertura)}</span>
              {sheet.reposicion && (
                <StatusPill tone={FUND_TONE[sheet.reposicion.estado]}>Repuesta · SF Nº {formatDocNumber(sheet.reposicion.numero, sheet.reposicion.anio)} · {FUND_LABEL[sheet.reposicion.estado]}</StatusPill>
              )}
            </div>

            <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-3">
              <div><div className="text-xs uppercase text-slate-500">Total</div><div className="text-lg font-semibold">{formatCurrency(sheet.total, sheet.currency)}</div></div>
              <div><div className="text-xs uppercase text-slate-500">En efectivo (se repone)</div><div className="text-lg font-semibold">{formatCurrency(sheet.totalEfectivo, sheet.currency)}</div></div>
              <div><div className="text-xs uppercase text-slate-500">A crédito (cuenta del proveedor)</div><div className="text-lg font-semibold">{formatCurrency(sheet.totalCredito, sheet.currency)}</div></div>
              <div className="sm:col-span-3 text-slate-600">{sheet.montoEnLetras}</div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Proveedor</th>
                    <th className="px-3 py-2">Concepto</th>
                    <th className="px-3 py-2">Cuenta</th>
                    <th className="px-3 py-2">Máquina</th>
                    <th className="px-3 py-2 text-right">Monto</th>
                    {open && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sheet.lines.length === 0 && <tr><td colSpan={8} className="px-3 py-3 text-slate-500">Sin renglones todavía.</td></tr>}
                  {sheet.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-slate-500">{l.position}</td>
                      <td className="px-3 py-2">{formatDate(l.fecha)}</td>
                      <td className="px-3 py-2">{l.supplier?.nombre ?? <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2 text-slate-600">{l.concepto ?? l.facturaORemision ?? ''}{l.aCredito && <span className="ml-1 rounded bg-amber-50 px-1 text-xs text-amber-800">a crédito</span>}</td>
                      <td className="px-3 py-2 text-slate-600">{l.account?.nombre ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{l.machine?.codigo ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(l.monto, sheet.currency)}</td>
                      {open && (
                        <td className="px-2 py-2 text-right">
                          <button type="button" onClick={() => deleteLine(l.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Borrar renglón">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {open && (
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">Carga rápida</h3>
                  <span className="text-xs text-slate-500">Enter en el monto de la última fila agrega otra. La fecha y el proveedor se repiten.</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-1 py-1">Fecha</th>
                        <th className="px-1 py-1">Prov. (opcional)</th>
                        <th className="px-1 py-1">Factura</th>
                        <th className="px-1 py-1">Concepto</th>
                        <th className="px-1 py-1">Cuenta</th>
                        <th className="px-1 py-1">Máquina</th>
                        <th className="px-1 py-1 text-right">Monto</th>
                        <th className="px-1 py-1">Crédito</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td className="px-1 py-1"><input type="date" className={inputClass} value={r.fecha} onChange={(e) => patchRow(i, { fecha: e.target.value })} /></td>
                          <td className="px-1 py-1"><input list="proveedores-codigos" className={cx(inputClass, 'w-24')} value={r.supplierCode} onChange={(e) => patchRow(i, { supplierCode: e.target.value })} /></td>
                          <td className="px-1 py-1"><input className={cx(inputClass, 'w-28')} value={r.factura} onChange={(e) => patchRow(i, { factura: e.target.value })} /></td>
                          <td className="px-1 py-1"><input className={inputClass} value={r.concepto} onChange={(e) => patchRow(i, { concepto: e.target.value })} /></td>
                          <td className="px-1 py-1">
                            <select className={inputClass} value={r.accountId} onChange={(e) => patchRow(i, { accountId: e.target.value })}>
                              <option value="">—</option>
                              {refs.accounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.nombre}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1 py-1"><input list="maquinas-codigos-caja" className={cx(inputClass, 'w-24')} value={r.machineCode} onChange={(e) => patchRow(i, { machineCode: e.target.value })} /></td>
                          <td className="px-1 py-1">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              className={cx(inputClass, 'w-28 text-right')}
                              value={r.monto}
                              onChange={(e) => patchRow(i, { monto: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && i === rows.length - 1) {
                                  e.preventDefault();
                                  setRows((prev) => [...prev, nextRow(prev[prev.length - 1])]);
                                }
                              }}
                            />
                          </td>
                          <td className="px-1 py-1 text-center"><input type="checkbox" checked={r.aCredito} onChange={(e) => patchRow(i, { aCredito: e.target.checked })} /></td>
                          <td className="px-1 py-1">
                            <button type="button" onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar fila">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <datalist id="proveedores-codigos">
                  {refs.suppliers.map((s) => (
                    <option key={s.id} value={s.codigo}>{s.nombre}</option>
                  ))}
                </datalist>
                <datalist id="maquinas-codigos-caja">
                  {refs.machines.map((m) => (
                    <option key={m.id} value={m.codigo}>{m.descripcion}</option>
                  ))}
                </datalist>
                <div className="flex justify-between">
                  <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setRows((prev) => [...prev, nextRow(prev[prev.length - 1])])}>Agregar fila</Button>
                  <Button variant="primary" onClick={saveRows} disabled={saving}>{saving ? 'Guardando…' : 'Guardar renglones'}</Button>
                </div>
              </div>
            )}

            {pickBeneficiary && (
              <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-medium text-slate-800">¿A quién se paga la reposición? Se guarda como beneficiario habitual.</p>
                <SupplierPicker suppliers={refs.suppliers} value={beneficiary} onChange={setBeneficiary} onCreated={reloadRefs} />
                <div className="flex gap-2">
                  <Button variant="primary" disabled={!beneficiary} onClick={() => replenish(beneficiary)}>Crear SF de reposición</Button>
                  <Button variant="ghost" onClick={() => setPickBeneficiary(false)}>Cancelar</Button>
                </div>
              </div>
            )}

            {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
            {errors.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            )}

            {sheet.totales.porCuenta.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-800">Por cuenta</h3>
                  <ul className="text-sm text-slate-600">
                    {sheet.totales.porCuenta.map((t) => (
                      <li key={t.clave ?? 'sin'} className="flex justify-between"><span>{accountName(t.clave)}</span><span className="font-mono">{formatCurrency(t.total, sheet.currency)}</span></li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-slate-800">Por máquina</h3>
                  <ul className="text-sm text-slate-600">
                    {sheet.totales.porMaquina.map((t) => (
                      <li key={t.clave ?? 'sin'} className="flex justify-between"><span>{machineName(t.clave)}</span><span className="font-mono">{formatCurrency(t.total, sheet.currency)}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
      {printing && sheet && (
        <PrintableSheet sheet={sheet} letterhead={refs.settings.letterheads[membrete] ?? ''} membrete={membrete} accountName={accountName} />
      )}
    </>
  );
};

/* ─── Rendición imprimible ─────────────────────────────────────────────── */

const PrintableSheet: React.FC<{ sheet: PettyCashSheetDto; letterhead: string; membrete: string; accountName: (id: string | null) => string }> = ({
  sheet,
  letterhead,
  membrete,
  accountName,
}) => (
  <div className="print-area text-sm text-black">
    <div className="mb-4 flex items-start justify-between border-b border-black pb-2">
      <div>
        <div className="text-lg font-bold">{letterhead || LETTERHEAD_LABEL[membrete]}</div>
        <div>Rendición de caja chica</div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold">Nº {formatDocNumber(sheet.numero, sheet.anio)}</div>
        <div>Apertura: {formatDate(sheet.fechaApertura)}</div>
      </div>
    </div>
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="py-1">Fecha</th>
          <th className="py-1">Proveedor</th>
          <th className="py-1">Factura</th>
          <th className="py-1">Concepto</th>
          <th className="py-1">Cuenta</th>
          <th className="py-1">Máq.</th>
          <th className="py-1 text-right">Monto</th>
        </tr>
      </thead>
      <tbody>
        {sheet.lines.map((l) => (
          <tr key={l.id} className="border-b border-slate-300">
            <td className="py-1">{formatDate(l.fecha)}</td>
            <td className="py-1">{l.supplier?.nombre ?? ''}</td>
            <td className="py-1">{l.facturaORemision ?? ''}</td>
            <td className="py-1">{l.concepto ?? ''}{l.aCredito ? ' (a crédito)' : ''}</td>
            <td className="py-1">{accountName(l.account?.id ?? null)}</td>
            <td className="py-1">{l.machine?.codigo ?? ''}</td>
            <td className="py-1 text-right">{formatCurrency(l.monto, sheet.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="mt-4 text-right text-base font-bold">Total: {formatCurrency(sheet.total, sheet.currency)}</div>
    <div className="text-right">{sheet.montoEnLetras}</div>
    <div className="mt-20 grid grid-cols-2 gap-16 text-center">
      <div className="border-t border-black pt-1">Responsable de caja</div>
      <div className="border-t border-black pt-1">Controlado por</div>
    </div>
  </div>
);
