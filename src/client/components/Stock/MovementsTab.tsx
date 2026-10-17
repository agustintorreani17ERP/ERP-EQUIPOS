/**
 * @file components/Stock/MovementsTab.tsx
 * @description Vales de stock: lista con filtros, detalle, anulación con motivo e impresión del vale.
 * Reemplaza STOCK TALLER ENTRADA Y SALIDA del Access, donde entradas y salidas eran filas de texto sin
 * número de documento. Anular una entrada que ya salió se rechaza: primero hay que anular la salida.
 */

import React, { useEffect, useState } from 'react';
import { Ban, Printer } from 'lucide-react';
import { formatCurrency } from '../../../shared/calculations';
import { STOCK_TYPES, STOCK_TYPE_LABEL, type StockMovementDto, type StockMovementType } from '../../../shared/stock';
import { ApiError, describeError } from '../../services/http';
import { stockApi } from '../../services/stockApi';
import { formatDate, formatQty } from '../../utils/format';
import { printArea } from '../../utils/print';
import { Button, Card, Field, Modal, StatusPill, inputClass } from '../../ui';
import { LETTERHEAD_LABEL } from '../Finance/common';
import { TYPE_TONE, UNIT_LABEL, type StockRefs } from './common';

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function destinationOf(m: StockMovementDto): string {
  const parts: string[] = [];
  if (m.machine) parts.push(`${m.machine.codigo} · ${m.machine.descripcion}`);
  if (m.worksite) parts.push(m.worksite.nombre);
  if (m.serviceOrder) parts.push(`Orden de servicio Nº ${m.serviceOrder.numero}`);
  return parts.join(' — ') || '—';
}

export const MovementsTab: React.FC<{
  refs: StockRefs;
  membrete: string;
  onMembrete: (key: string) => void;
  reloadKey: number;
  onNewMovement: () => void;
  onChanged: () => void;
}> = ({ refs, membrete, onMembrete, reloadKey, onNewMovement, onChanged }) => {
  const [desde, setDesde] = useState(addDays(-90));
  const [hasta, setHasta] = useState('');
  const [tipo, setTipo] = useState<StockMovementType | ''>('');
  const [q, setQ] = useState('');
  const [incluirAnulados, setIncluirAnulados] = useState(false);
  const [rows, setRows] = useState<StockMovementDto[] | null>(null);
  const [selected, setSelected] = useState<StockMovementDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      stockApi
        .movements({ desde: desde || undefined, hasta: hasta || undefined, tipo: tipo || undefined, q: q.trim() || undefined, incluirAnulados })
        .then((r) => {
          setRows(r);
          setError(null);
        })
        .catch((err) => setError(describeError(err)));
    }, 200);
    return () => clearTimeout(timer);
  }, [desde, hasta, tipo, q, incluirAnulados, reloadKey]);

  return (
    <>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
          <Field label="Tipo">
            <select className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value as StockMovementType | '')}>
              <option value="">Todos</option>
              {STOCK_TYPES.map((t) => (
                <option key={t} value={t}>{STOCK_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Buscar" className="min-w-[12rem] flex-1">
            <input className={inputClass} placeholder="Nº de vale, remisión, artículo" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700"><input type="checkbox" checked={incluirAnulados} onChange={(e) => setIncluirAnulados(e.target.checked)} />Ver anulados</label>
          <Button variant="primary" onClick={onNewMovement}>Nuevo vale</Button>
        </div>
        {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
        {rows === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No hay vales en ese período.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Vale</th>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Tipo</th>
                  <th className="px-4 py-2.5">Artículos</th>
                  <th className="px-4 py-2.5">Destino u origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((m) => (
                  <tr key={m.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(m)}>
                    <td className="px-4 py-2.5 font-mono font-semibold">{m.numero}</td>
                    <td className="px-4 py-2.5">{formatDate(m.fecha)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <StatusPill tone={TYPE_TONE[m.tipo]}>{STOCK_TYPE_LABEL[m.tipo]}</StatusPill>
                        {m.anulado && <StatusPill tone="bad">Anulado</StatusPill>}
                      </div>
                    </td>
                    <td className="max-w-md px-4 py-2.5 text-slate-600">
                      <div className="truncate">{m.lines.map((l) => `${formatQty(l.cantidad)} ${UNIT_LABEL[l.articulo.unidad]} ${l.articulo.codigo}`).join(' · ')}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {m.tipo === 'SALIDA' ? destinationOf(m) : (m.supplier?.nombre ?? m.motivo ?? (m.reception ? `Recepción Nº ${m.reception.numero}` : '—'))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <MovementDetail
          refs={refs}
          movement={selected}
          membrete={membrete}
          onMembrete={onMembrete}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            onChanged();
          }}
        />
      )}
    </>
  );
};

const MovementDetail: React.FC<{
  refs: StockRefs;
  movement: StockMovementDto;
  membrete: string;
  onMembrete: (key: string) => void;
  onClose: () => void;
  onChanged: () => void;
}> = ({ refs, movement, membrete, onMembrete, onClose, onChanged }) => {
  const [annulMotivo, setAnnulMotivo] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);
  const currency = refs.settings.currency;
  const total = movement.lines.reduce((acc, l) => acc + Math.abs(l.valor), 0);

  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(false);
    return restore;
  }, [printing]);

  const annul = async () => {
    setErrors([]);
    try {
      await stockApi.annul(movement.id, annulMotivo ?? '');
      onChanged();
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    }
  };

  return (
    <>
      <Modal
        title={`Vale de stock Nº ${movement.numero}`}
        size="lg"
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => setPrinting(true)}>Imprimir</Button>
              <div className="w-40">
                <select className={inputClass} value={membrete} onChange={(e) => onMembrete(e.target.value)} aria-label="Membrete">
                  {Object.keys(refs.settings.letterheads).map((k) => (
                    <option key={k} value={k}>{LETTERHEAD_LABEL[k] ?? k}</option>
                  ))}
                </select>
              </div>
              {!movement.anulado && annulMotivo === null && <Button variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setAnnulMotivo('')}>Anular</Button>}
            </div>
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={TYPE_TONE[movement.tipo]}>{STOCK_TYPE_LABEL[movement.tipo]}</StatusPill>
            {movement.anulado && <StatusPill tone="bad">Anulado: {movement.anuladoMotivo}</StatusPill>}
            <span className="text-slate-500">{formatDate(movement.fecha)}</span>
          </div>
          {movement.tipo === 'SALIDA' && <div>Destino: <span className="font-medium">{destinationOf(movement)}</span></div>}
          {movement.supplier && <div>Proveedor: {movement.supplier.nombre}</div>}
          {movement.remision && <div>Remisión o factura: {movement.remision}</div>}
          {movement.reception && <div>Recepción Nº {movement.reception.numero} del pedido Nº {movement.reception.orderNumero}</div>}
          {movement.motivo && <div>Motivo: {movement.motivo}</div>}
          {movement.observaciones && <div className="text-slate-600">{movement.observaciones}</div>}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Artículo</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2 text-right">Costo unit.</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movement.lines.map((l) => (
                  <tr key={l.articleId}>
                    <td className="px-3 py-2"><span className="font-mono font-semibold">{l.articulo.codigo}</span> <span className="text-slate-600">{l.articulo.descripcion}</span></td>
                    <td className="px-3 py-2 text-right font-mono">{formatQty(l.cantidad)} {UNIT_LABEL[l.articulo.unidad]}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(l.costoUnitario, currency)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(Math.abs(l.valor), currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>Total valorizado</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(total, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {annulMotivo !== null && (
            <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="font-medium text-rose-800">Anular el vale Nº {movement.numero}: indicá el motivo. El saldo vuelve a como estaba antes del vale.</p>
              <div className="flex gap-2">
                <input className={inputClass} value={annulMotivo} onChange={(e) => setAnnulMotivo(e.target.value)} placeholder="Motivo de la anulación" />
                <Button variant="danger" onClick={annul}>Confirmar</Button>
                <Button variant="ghost" onClick={() => setAnnulMotivo(null)}>Cancelar</Button>
              </div>
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
      {printing && <PrintableVoucher movement={movement} letterhead={refs.settings.letterheads[membrete] ?? ''} membrete={membrete} />}
    </>
  );
};

const PrintableVoucher: React.FC<{ movement: StockMovementDto; letterhead: string; membrete: string }> = ({ movement, letterhead, membrete }) => (
  <div className="print-area text-sm text-black">
    <div className="mb-6 flex items-start justify-between border-b border-black pb-2">
      <div>
        <div className="text-lg font-bold">{letterhead || LETTERHEAD_LABEL[membrete]}</div>
        <div>Vale de {STOCK_TYPE_LABEL[movement.tipo].toLowerCase()} — stock del taller</div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold">Vale Nº {movement.numero}</div>
        <div>Fecha: {formatDate(movement.fecha)}</div>
        {movement.anulado && <div className="font-bold">ANULADO</div>}
      </div>
    </div>
    <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1">
      {movement.tipo === 'SALIDA' && <div className="col-span-2">Destino: {destinationOf(movement)}</div>}
      {movement.supplier && <div>Proveedor: {movement.supplier.nombre}</div>}
      {movement.remision && <div>Remisión o factura: {movement.remision}</div>}
      {movement.motivo && <div className="col-span-2">Motivo: {movement.motivo}</div>}
    </div>
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-black text-left"><th className="py-1">Código</th><th className="py-1">Descripción</th><th className="py-1 text-right">Cantidad</th></tr>
      </thead>
      <tbody>
        {movement.lines.map((l) => (
          <tr key={l.articleId} className="border-b border-slate-300">
            <td className="py-1 font-mono">{l.articulo.codigo}</td>
            <td className="py-1">{l.articulo.descripcion}</td>
            <td className="py-1 text-right">{formatQty(l.cantidad)} {UNIT_LABEL[l.articulo.unidad]}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="mt-20 grid grid-cols-2 gap-16 text-center">
      <div className="border-t border-black pt-1">{movement.tipo === 'SALIDA' ? 'Entregó' : 'Recibió'}</div>
      <div className="border-t border-black pt-1">{movement.tipo === 'SALIDA' ? 'Recibió' : 'Autorizó'}</div>
    </div>
  </div>
);
