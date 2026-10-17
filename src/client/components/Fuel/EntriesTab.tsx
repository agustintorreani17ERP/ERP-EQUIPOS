/**
 * @file components/Fuel/EntriesTab.tsx
 * @description Entradas de combustible y lubricantes a un depósito, saldo inicial y ajustes con
 * motivo. Sin saldo inicial o entradas al día, los despachos se guardan igual con advertencia de saldo negativo.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { validateFuelMovement, type FuelMovementDto, type FuelMovementType } from '../../../shared/fuel';
import { ApiError, describeError } from '../../services/http';
import { fuelApi, type MovementDraft } from '../../services/fuelApi';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { Button, Card, Field, StatusPill, cx, inputClass } from '../../ui';
import { SupplierPicker } from '../Finance/SupplierPicker';
import { TYPE_TONE, UNIT_LABEL, type FuelRefs } from './common';
import { MovementDetail } from './DispatchesTab';

type EntryType = Exclude<FuelMovementType, 'DESPACHO'>;
const TYPE_LABEL: Record<EntryType, string> = { ENTRADA: 'Entrada', SALDO_INICIAL: 'Saldo inicial', AJUSTE: 'Ajuste' };

interface LineDraft {
  productId: string;
  cantidad: string;
}

export const EntriesTab: React.FC<{ refs: FuelRefs; reloadRefs: () => void; membrete: string; onChanged: () => void }> = ({ refs, reloadRefs, membrete, onChanged }) => {
  const [tipo, setTipo] = useState<EntryType>('ENTRADA');
  const [fecha, setFecha] = useState(todayIso());
  const [depositId, setDepositId] = useState(refs.deposits.find((d) => d.activo)?.id ?? '');
  const [supplierId, setSupplierId] = useState('');
  const [remision, setRemision] = useState('');
  const [motivo, setMotivo] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ productId: '', cantidad: '' }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recent, setRecent] = useState<FuelMovementDto[] | null>(null);
  const [selected, setSelected] = useState<FuelMovementDto | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const from = new Date();
    from.setDate(from.getDate() - 90);
    const pad = (n: number) => String(n).padStart(2, '0');
    const desde = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
    fuelApi
      .movements({ desde })
      .then((all) => setRecent(all.filter((m) => m.tipo !== 'DESPACHO')))
      .catch((err) => setErrors([describeError(err)]));
  }, [reloadKey]);

  const patchLine = (i: number, changes: Partial<LineDraft>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...changes } : l)));

  const save = async () => {
    setMessage(null);
    setWarnings([]);
    const used = lines.filter((l) => l.productId || l.cantidad.trim());
    const draft: MovementDraft = {
      tipo,
      fecha,
      depositId,
      supplierId: tipo === 'ENTRADA' ? supplierId || null : null,
      remision: tipo === 'ENTRADA' ? remision.trim() || null : null,
      motivo: motivo.trim() || null,
      lines: used.map((l) => ({ productId: l.productId, cantidad: Number(l.cantidad) })),
    };
    const local = validateFuelMovement(draft, todayIso());
    if (local.length > 0) {
      setErrors(local);
      return;
    }
    try {
      const saved = await fuelApi.createMovement(draft);
      setErrors([]);
      setMessage(`Se registró el vale Nº ${saved.numero}.`);
      setWarnings(saved.advertencias);
      setLines([{ productId: '', cantidad: '' }]);
      setRemision('');
      setMotivo('');
      setReloadKey((k) => k + 1);
      onChanged();
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    }
  };

  return (
    <>
      <Card title="Entradas, saldo inicial y ajustes">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Tipo">
            <select className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value as EntryType)}>
              {(Object.keys(TYPE_LABEL) as EntryType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Fecha"><input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
          <Field label="Depósito">
            <select className={inputClass} value={depositId} onChange={(e) => setDepositId(e.target.value)}>
              <option value="">Elegí un depósito</option>
              {refs.deposits.filter((d) => d.activo).map((d) => (
                <option key={d.id} value={d.id}>{d.codigo} · {d.nombre}</option>
              ))}
            </select>
          </Field>
          {tipo === 'ENTRADA' && <Field label="Remisión"><input className={inputClass} value={remision} onChange={(e) => setRemision(e.target.value)} /></Field>}
          {tipo === 'ENTRADA' && (
            <div className="sm:col-span-2">
              <Field label="Proveedor">
                <SupplierPicker suppliers={refs.suppliers} value={supplierId} onChange={setSupplierId} onCreated={reloadRefs} />
              </Field>
            </div>
          )}
          {tipo === 'AJUSTE' && (
            <div className="sm:col-span-3">
              <Field label="Motivo del ajuste" hint="Obligatorio. Usá cantidad negativa para restar.">
                <input className={inputClass} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Medición física del tanque, derrame, etc." />
              </Field>
            </div>
          )}
        </div>

        <div className="mt-4 space-y-2">
          {lines.map((l, i) => {
            const product = refs.products.find((p) => p.id === l.productId);
            return (
              <div key={i} className="grid grid-cols-[1fr_9rem_3rem_auto] items-center gap-2">
                <select className={inputClass} value={l.productId} onChange={(e) => patchLine(i, { productId: e.target.value })}>
                  <option value="">Producto</option>
                  {refs.products.filter((p) => p.activo).map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
                <input type="number" step="any" className={cx(inputClass, 'text-right')} placeholder="Cantidad" value={l.cantidad} onChange={(e) => patchLine(i, { cantidad: e.target.value })} />
                <span className="text-sm text-slate-500">{product ? UNIT_LABEL[product.unidad] : ''}</span>
                <button type="button" onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar renglón">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-between">
          <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((prev) => [...prev, { productId: '', cantidad: '' }])}>Agregar producto</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save}>Registrar</Button>
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

      <Card title="Últimos 90 días" padded={false}>
        {recent === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : recent.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Todavía no hay entradas, saldos iniciales ni ajustes.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Vale</th>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Tipo</th>
                  <th className="px-4 py-2.5">Depósito</th>
                  <th className="px-4 py-2.5">Productos</th>
                  <th className="px-4 py-2.5">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((m) => (
                  <tr key={m.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(m)}>
                    <td className="px-4 py-2.5 font-mono font-semibold">{m.numero}</td>
                    <td className="px-4 py-2.5">{formatDate(m.fecha)}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={TYPE_TONE[m.tipo]}>{TYPE_LABEL[m.tipo as EntryType]}</StatusPill></td>
                    <td className="px-4 py-2.5">{m.deposit.codigo}</td>
                    <td className="px-4 py-2.5 text-slate-600">{m.lines.map((l) => `${formatQty(l.cantidad)} ${UNIT_LABEL[l.producto.unidad]} ${l.producto.nombre}`).join(' · ')}</td>
                    <td className="px-4 py-2.5 text-slate-600">{m.motivo ?? m.remision ?? m.supplier?.nombre ?? ''}</td>
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
            setReloadKey((k) => k + 1);
            onChanged();
          }}
        />
      )}
    </>
  );
};
