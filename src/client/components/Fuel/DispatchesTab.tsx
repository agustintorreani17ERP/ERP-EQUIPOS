/**
 * @file components/Fuel/DispatchesTab.tsx
 * @description Despachos de combustible y lubricantes: lista con filtros, carga rápida en grilla (el
 * depósito y la fecha se repiten, Enter agrega fila), detalle con corrección de lectura observada,
 * anulación con motivo y vale imprimible. Reemplaza los formularios A, B y 2012 del Access.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Fuel, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { normalizeMachineCode } from '../../../shared/fleet';
import { validateFuelMovement, type FuelMovementDto, type FuelMovementResult } from '../../../shared/fuel';
import { ApiError, describeError } from '../../services/http';
import { fuelApi, type MovementDraft, type MovementFilters } from '../../services/fuelApi';
import { printArea } from '../../utils/print';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Modal, StatusPill, cx, inputClass } from '../../ui';
import { LETTERHEAD_LABEL } from '../Finance/common';
import { findGasoil, TYPE_TONE, UNIT_LABEL, type FuelRefs } from './common';

interface Row {
  machineCode: string;
  chapa: string;
  lectura: string;
  gasoil: string;
  productId: string;
  cantidad: string;
  remision: string;
}

const emptyRow = (prev?: Row): Row => ({ machineCode: '', chapa: '', lectura: '', gasoil: '', productId: '', cantidad: '', remision: prev?.remision ?? '' });

function linesLabel(m: FuelMovementDto): string {
  return m.lines.map((l) => `${formatQty(l.cantidad)} ${UNIT_LABEL[l.producto.unidad]} ${l.producto.nombre}`).join(' · ');
}

function destination(m: FuelMovementDto): string {
  if (m.machine) return `${m.machine.codigo} · ${m.machine.descripcion}`;
  if (m.terceroChapa) return `Tercero ${m.terceroChapa}`;
  return m.descripcion ?? '—';
}

export const DispatchesTab: React.FC<{ refs: FuelRefs; membrete: string; onMembrete: (key: string) => void; onChanged: () => void }> = ({
  refs,
  membrete,
  onMembrete,
  onChanged,
}) => {
  const [filters, setFilters] = useState<MovementFilters>({ desde: todayIso(), hasta: todayIso(), tipo: 'DESPACHO' });
  const [list, setList] = useState<FuelMovementDto[] | null>(null);
  const [selected, setSelected] = useState<FuelMovementDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setError(null);
    fuelApi
      .movements(filters)
      .then(setList)
      .catch((err) => setError(describeError(err)));
  }, [filters, reloadKey]);

  const setFilter = <K extends keyof MovementFilters>(key: K, value: MovementFilters[K] | '') =>
    setFilters((prev) => ({ ...prev, [key]: value === '' ? undefined : value }));
  const reload = () => {
    setReloadKey((k) => k + 1);
    onChanged();
  };

  return (
    <>
      <QuickEntry refs={refs} onSaved={reload} />

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Desde"><input type="date" className={inputClass} value={filters.desde ?? ''} onChange={(e) => setFilter('desde', e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" className={inputClass} value={filters.hasta ?? ''} onChange={(e) => setFilter('hasta', e.target.value)} /></Field>
          <Field label="Depósito">
            <select className={inputClass} value={filters.deposito ?? ''} onChange={(e) => setFilter('deposito', e.target.value)}>
              <option value="">Todos</option>
              {refs.deposits.map((d) => (
                <option key={d.id} value={d.id}>{d.codigo} · {d.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Máquina">
            <select className={inputClass} value={filters.maquina ?? ''} onChange={(e) => setFilter('maquina', e.target.value)}>
              <option value="">Todas</option>
              {refs.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.codigo} · {m.descripcion}</option>
              ))}
            </select>
          </Field>
          <Field label="Chapa tercero"><input className={cx(inputClass, 'w-28')} value={filters.chapa ?? ''} onChange={(e) => setFilter('chapa', e.target.value)} /></Field>
          <Field label="Buscar"><input className={inputClass} placeholder="Vale, remisión, descripción" value={filters.q ?? ''} onChange={(e) => setFilter('q', e.target.value)} /></Field>
          <div className="ml-auto">
            <Field label="Membrete">
              <select className={inputClass} value={membrete} onChange={(e) => onMembrete(e.target.value)}>
                {Object.keys(refs.settings.letterheads).map((k) => (
                  <option key={k} value={k}>{LETTERHEAD_LABEL[k] ?? k}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
        {list === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando despachos…</div>
        ) : list.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<Fuel className="h-6 w-6" />} title="No hay despachos en este rango" help="Usá la carga rápida de arriba o ampliá las fechas." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Vale</th>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Depósito</th>
                  <th className="px-4 py-2.5">Destino</th>
                  <th className="px-4 py-2.5">Productos</th>
                  <th className="px-4 py-2.5 text-right">Lectura</th>
                  <th className="px-4 py-2.5">Remisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((m) => (
                  <tr key={m.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(m)}>
                    <td className="px-4 py-2.5 font-mono font-semibold">{m.numero}</td>
                    <td className="px-4 py-2.5">{formatDate(m.fecha)}</td>
                    <td className="px-4 py-2.5">{m.deposit.codigo}</td>
                    <td className="px-4 py-2.5">{destination(m)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{linesLabel(m)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {m.lectura !== null ? formatQty(m.lectura) : '—'}
                      {m.lecturaObservada && <span className="ml-1 rounded bg-amber-50 px-1 text-xs text-amber-800">observada</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{m.remision ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <MovementDetail
          movement={selected}
          letterhead={refs.settings.letterheads[membrete] ?? ''}
          membrete={membrete}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            reload();
          }}
        />
      )}
    </>
  );
};

/* ─── Carga rápida ─────────────────────────────────────────────────────── */

const QuickEntry: React.FC<{ refs: FuelRefs; onSaved: () => void }> = ({ refs, onSaved }) => {
  const [depositId, setDepositId] = useState(refs.deposits.find((d) => d.activo)?.id ?? '');
  const [fecha, setFecha] = useState(todayIso());
  const [proveidoA, setProveidoA] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const machineByCode = useMemo(() => new Map(refs.machines.map((m) => [normalizeMachineCode(m.codigo), m])), [refs.machines]);
  const gasoil = findGasoil(refs.products);
  const extraProducts = refs.products.filter((p) => p.activo && p.id !== gasoil?.id);

  const patchRow = (i: number, changes: Partial<Row>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...changes } : r)));

  const save = async () => {
    setMessage(null);
    setWarnings([]);
    const used = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.machineCode.trim() || r.chapa.trim() || r.gasoil.trim() || r.cantidad.trim());
    const local: string[] = [];
    const drafts: MovementDraft[] = [];
    if (!depositId) local.push('Elegí el depósito.');
    if (!gasoil) local.push('Primero cargá los productos predeterminados en «Depósitos y productos».');
    for (const { r, i } of used) {
      const machine = r.machineCode.trim() ? machineByCode.get(normalizeMachineCode(r.machineCode)) : undefined;
      if (r.machineCode.trim() && !machine) local.push(`Fila ${i + 1}: la máquina «${r.machineCode}» no existe en la flota.`);
      const lines: { productId: string; cantidad: number }[] = [];
      if (r.gasoil.trim() && gasoil) lines.push({ productId: gasoil.id, cantidad: Number(r.gasoil) });
      if (r.productId && r.cantidad.trim()) lines.push({ productId: r.productId, cantidad: Number(r.cantidad) });
      const draft: MovementDraft = {
        tipo: 'DESPACHO',
        fecha,
        depositId,
        machineId: machine?.id ?? null,
        terceroChapa: r.chapa.trim() || null,
        proveidoA: proveidoA.trim() || null,
        remision: r.remision.trim() || null,
        lectura: r.lectura.trim() === '' ? null : Number(r.lectura),
        lines,
      };
      for (const e of validateFuelMovement(draft, todayIso())) local.push(`Fila ${i + 1}: ${e}`);
      drafts.push(draft);
    }
    if (drafts.length === 0) local.push('No hay despachos para guardar.');
    if (local.length > 0) {
      setErrors([...new Set(local)]);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const saved: FuelMovementResult[] = await fuelApi.createBatch(drafts);
      setMessage(`Se guardaron ${saved.length} despachos.`);
      setWarnings(saved.flatMap((s) => s.advertencias.map((a) => `Vale ${s.numero}: ${a}`)));
      setRows([emptyRow(), emptyRow(), emptyRow()]);
      onSaved();
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Carga rápida de despachos" action={<span className="text-xs text-slate-500">Enter en la remisión de la última fila agrega otra. Si un vale falla, no se guarda ninguno.</span>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="Depósito (se repite)">
          <select className={inputClass} value={depositId} onChange={(e) => setDepositId(e.target.value)}>
            <option value="">Elegí un depósito</option>
            {refs.deposits.filter((d) => d.activo).map((d) => (
              <option key={d.id} value={d.id}>{d.codigo} · {d.nombre}</option>
            ))}
          </select>
        </Field>
        <Field label="Fecha (se repite)"><input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
        <Field label="Proveído a (se repite)"><input className={inputClass} placeholder="Quien recibe" value={proveidoA} onChange={(e) => setProveidoA(e.target.value)} /></Field>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2">Máquina</th>
              <th className="px-2 py-2">o chapa tercero</th>
              <th className="px-2 py-2 text-right">Lectura</th>
              <th className="px-2 py-2 text-right">Gasoil (L)</th>
              <th className="px-2 py-2">Otro producto</th>
              <th className="px-2 py-2 text-right">Cant.</th>
              <th className="px-2 py-2">Remisión</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5"><input list="fuel-machines" className={cx(inputClass, 'w-28')} value={r.machineCode} onChange={(e) => patchRow(i, { machineCode: e.target.value, chapa: e.target.value ? '' : r.chapa })} /></td>
                <td className="px-2 py-1.5"><input className={cx(inputClass, 'w-28')} value={r.chapa} disabled={Boolean(r.machineCode.trim())} onChange={(e) => patchRow(i, { chapa: e.target.value })} /></td>
                <td className="px-2 py-1.5"><input type="number" min="0" step="any" className={cx(inputClass, 'w-24 text-right')} value={r.lectura} onChange={(e) => patchRow(i, { lectura: e.target.value })} /></td>
                <td className="px-2 py-1.5"><input type="number" min="0" step="any" className={cx(inputClass, 'w-24 text-right')} value={r.gasoil} onChange={(e) => patchRow(i, { gasoil: e.target.value })} /></td>
                <td className="px-2 py-1.5">
                  <select className={inputClass} value={r.productId} onChange={(e) => patchRow(i, { productId: e.target.value })}>
                    <option value="">—</option>
                    {extraProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5"><input type="number" min="0" step="any" className={cx(inputClass, 'w-20 text-right')} value={r.cantidad} onChange={(e) => patchRow(i, { cantidad: e.target.value })} /></td>
                <td className="px-2 py-1.5">
                  <input
                    className={cx(inputClass, 'w-28')}
                    value={r.remision}
                    onChange={(e) => patchRow(i, { remision: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && i === rows.length - 1) {
                        e.preventDefault();
                        setRows((prev) => [...prev, emptyRow(prev[prev.length - 1])]);
                      }
                    }}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar fila">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="fuel-machines">
        {refs.machines.map((m) => (
          <option key={m.id} value={m.codigo}>{m.descripcion}</option>
        ))}
      </datalist>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setRows((prev) => [...prev, emptyRow(prev[prev.length - 1])])}>Agregar fila</Button>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save} disabled={saving}>{saving ? 'Guardando…' : 'Guardar despachos'}</Button>
      </div>

      {message && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
    </Card>
  );
};

/* ─── Detalle de un vale ───────────────────────────────────────────────── */

export const MovementDetail: React.FC<{
  movement: FuelMovementDto;
  letterhead: string;
  membrete: string;
  onClose: () => void;
  onChanged: () => void;
}> = ({ movement, letterhead, membrete, onClose, onChanged }) => {
  const [valor, setValor] = useState('');
  const [correccion, setCorreccion] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [annulMotivo, setAnnulMotivo] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);
  const [annulWarnings, setAnnulWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(false);
    return restore;
  }, [printing]);

  const guard = async (fn: () => Promise<void>) => {
    setErrors([]);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.detalles.length > 0) setErrors(err.detalles);
      else if (err instanceof Error && !(err instanceof ApiError)) setErrors([err.message]);
      else setErrors([describeError(err)]);
    }
  };

  const fixReading = () =>
    guard(async () => {
      const n = Number(valor);
      if (valor.trim() === '' || !Number.isFinite(n)) throw new Error('Ingresá la lectura.');
      await fuelApi.fixReading(movement.id, { valor: n, correccion, motivo: motivo || null });
      onChanged();
    });

  const annul = () =>
    guard(async () => {
      const annulled = await fuelApi.annul(movement.id, annulMotivo ?? '');
      if (annulled.advertencias.length > 0) {
        // Se muestra la advertencia antes de cerrar: anular una entrada puede dejar un saldo negativo.
        setAnnulWarnings(annulled.advertencias);
        setAnnulMotivo(null);
        return;
      }
      onChanged();
    });

  return (
    <>
      <Modal
        title={`Vale Nº ${movement.numero}`}
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => setPrinting(true)}>Imprimir</Button>
              {!movement.anulado && annulMotivo === null && <Button variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setAnnulMotivo('')}>Anular</Button>}
            </div>
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={TYPE_TONE[movement.tipo]}>{movement.tipo === 'DESPACHO' ? 'Despacho' : movement.tipo === 'ENTRADA' ? 'Entrada' : movement.tipo === 'AJUSTE' ? 'Ajuste' : 'Saldo inicial'}</StatusPill>
            {movement.anulado && <StatusPill tone="bad">Anulado: {movement.anuladoMotivo}</StatusPill>}
            <span className="text-slate-500">{formatDate(movement.fecha)} · {movement.deposit.codigo} · {movement.deposit.nombre}</span>
          </div>
          <div>Destino: <span className="font-medium">{destination(movement)}</span></div>
          {movement.proveidoA && <div>Proveído a: {movement.proveidoA}</div>}
          {movement.remision && <div>Remisión: {movement.remision}</div>}
          {movement.supplier && <div>Proveedor: {movement.supplier.nombre}</div>}
          {movement.motivo && <div>Motivo: {movement.motivo}</div>}
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {movement.lines.map((l) => (
              <li key={l.productId} className="flex justify-between px-3 py-2"><span>{l.producto.nombre}</span><span className="font-mono">{formatQty(l.cantidad)} {UNIT_LABEL[l.producto.unidad]}</span></li>
            ))}
          </ul>
          {movement.lectura !== null && (
            <div>
              Lectura: <span className="font-mono">{formatQty(movement.lectura)} {movement.lecturaUnidad?.toLowerCase()}</span>
              {movement.lecturaObservada && <span className="ml-2 text-amber-800">Observada: {movement.lecturaMotivo}</span>}
            </div>
          )}

          {movement.lecturaObservada && !movement.anulado && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="font-medium text-amber-900">Corregir la lectura para que cuente en el consumo</p>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
                <input type="number" min="0" step="any" className={inputClass} placeholder="Lectura" value={valor} onChange={(e) => setValor(e.target.value)} />
                <input className={inputClass} placeholder="Motivo (si es una corrección real)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={correccion} onChange={(e) => setCorreccion(e.target.checked)} />Es corrección</label>
              </div>
              <Button variant="primary" onClick={fixReading}>Guardar lectura</Button>
            </div>
          )}

          {annulMotivo !== null && (
            <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="font-medium text-rose-800">Anular el vale Nº {movement.numero}: indicá el motivo.</p>
              <div className="flex gap-2">
                <input className={inputClass} value={annulMotivo} onChange={(e) => setAnnulMotivo(e.target.value)} placeholder="Motivo de la anulación" />
                <Button variant="danger" onClick={annul}>Confirmar</Button>
                <Button variant="ghost" onClick={() => setAnnulMotivo(null)}>Cancelar</Button>
              </div>
            </div>
          )}

          {annulWarnings.length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
              <p className="font-medium">El vale se anuló, con estas advertencias:</p>
              {annulWarnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
              <Button variant="secondary" onClick={onChanged}>Entendido</Button>
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
              {errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
        </div>
      </Modal>
      {printing && <PrintableVoucher movement={movement} letterhead={letterhead} membrete={membrete} />}
    </>
  );
};

const PrintableVoucher: React.FC<{ movement: FuelMovementDto; letterhead: string; membrete: string }> = ({ movement, letterhead, membrete }) => (
  <div className="print-area text-sm text-black">
    <div className="mb-6 flex items-start justify-between border-b border-black pb-2">
      <div>
        <div className="text-lg font-bold">{letterhead || LETTERHEAD_LABEL[membrete]}</div>
        <div>Vale de {movement.tipo === 'DESPACHO' ? 'despacho' : movement.tipo === 'ENTRADA' ? 'entrada' : movement.tipo === 'AJUSTE' ? 'ajuste' : 'saldo inicial'} de combustibles y lubricantes</div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold">Vale Nº {movement.numero}</div>
        <div>Fecha: {formatDate(movement.fecha)}</div>
        {movement.anulado && <div className="font-bold">ANULADO</div>}
      </div>
    </div>
    <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1">
      <div>Depósito: {movement.deposit.codigo} · {movement.deposit.nombre}</div>
      <div>Destino: {destination(movement)}</div>
      <div>Remisión: {movement.remision ?? '—'}</div>
      <div>Lectura: {movement.lectura !== null ? `${formatQty(movement.lectura)} ${movement.lecturaUnidad?.toLowerCase() ?? ''}` : '—'}</div>
      <div>Proveído a: {movement.proveidoA ?? '—'}</div>
    </div>
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-black text-left"><th className="py-1">Producto</th><th className="py-1 text-right">Cantidad</th></tr>
      </thead>
      <tbody>
        {movement.lines.map((l) => (
          <tr key={l.productId} className="border-b border-slate-300">
            <td className="py-1">{l.producto.nombre}</td>
            <td className="py-1 text-right">{formatQty(l.cantidad)} {UNIT_LABEL[l.producto.unidad]}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="mt-20 grid grid-cols-2 gap-16 text-center">
      <div className="border-t border-black pt-1">Despachó</div>
      <div className="border-t border-black pt-1">Recibió</div>
    </div>
  </div>
);
