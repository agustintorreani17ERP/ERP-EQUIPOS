/**
 * @file components/Maintenance/OrdersTab.tsx
 * @description Órdenes de servicio: lista, detalle, realizar (con las horas reales como lectura de la
 * máquina), anular e imprimir. La orden impresa lleva tareas, filtros y capacidades de la ficha, con
 * ideal / actual / real y firmas, como las 12 plantillas del Access pero en una sola.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Ban, CheckCircle2, FileSpreadsheet, Printer } from 'lucide-react';
import { LATENESS_LABEL, type ServiceOrderDto, type ServiceOrderState } from '../../../shared/maintenance';
import { ApiError, describeError } from '../../services/http';
import { maintenanceApi } from '../../services/maintenanceApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { printArea } from '../../utils/print';
import { Button, Card, EmptyState, Field, Modal, StatusPill, inputClass } from '../../ui';
import { LETTERHEAD_LABEL } from '../Finance/common';
import { BUCKET_TONE, GROUP_LABEL, ORDER_LABEL, ORDER_TONE, unitLabel, type MaintenanceRefs } from './common';

export const OrdersTab: React.FC<{ refs: MaintenanceRefs; membrete: string; onChanged: () => void }> = ({ refs, membrete, onChanged }) => {
  const [orders, setOrders] = useState<ServiceOrderDto[] | null>(null);
  const [estado, setEstado] = useState<ServiceOrderState | ''>('');
  const [obra, setObra] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [selected, setSelected] = useState<ServiceOrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    maintenanceApi
      .orders({ estado: estado || undefined, obra, desde, hasta })
      .then((r) => {
        setOrders(r);
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [estado, obra, desde, hasta]);

  useEffect(load, [load]);

  const exportExcel = () =>
    exportRowsToExcel(
      (orders ?? []).map((o) => ({
        'N.º': o.numero,
        Emisión: formatDate(o.fechaEmision),
        Máquina: o.machine.codigo,
        Obra: o.worksite?.nombre ?? '',
        Tipo: o.tipo.codigo,
        Estado: ORDER_LABEL[o.estado],
        Ideal: o.horasIdeal,
        'Al emitir': o.horasActual,
        Real: o.horasReal,
        Atraso: o.atraso ? o.atraso.diferencia : null,
        Realizado: o.fechaRealizado ? formatDate(o.fechaRealizado) : '',
        Pedido: o.pedido?.numero ?? null,
      })),
      'Órdenes',
      `ordenes-servicio-${todayIso()}.xlsx`,
    );

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card
        title="Órdenes de servicio"
        action={<Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportExcel} disabled={!orders?.length}>Excel</Button>}
        padded={false}
      >
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
          <Field label="Estado">
            <select className={inputClass} value={estado} onChange={(e) => setEstado(e.target.value as ServiceOrderState | '')}>
              <option value="">Todos</option>
              {(Object.keys(ORDER_LABEL) as ServiceOrderState[]).map((s) => (
                <option key={s} value={s}>{ORDER_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="Obra">
            <select className={inputClass} value={obra} onChange={(e) => setObra(e.target.value)}>
              <option value="">Todas</option>
              {refs.worksites.map((w) => (
                <option key={w.id} value={w.id}>{w.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Emitidas desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
        </div>
        {orders === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : orders.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No hay órdenes de servicio" help="Emití la primera desde el Programa: elegí la máquina y tocá «Emitir»." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">N.º</th>
                  <th className="px-4 py-2.5">Emisión</th>
                  <th className="px-4 py-2.5">Máquina</th>
                  <th className="px-4 py-2.5">Tipo</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5 text-right">Ideal</th>
                  <th className="px-4 py-2.5 text-right">Real</th>
                  <th className="px-4 py-2.5">Atraso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(o)}>
                    <td className="px-4 py-2.5 font-mono font-semibold">{o.numero}</td>
                    <td className="px-4 py-2.5">{formatDate(o.fechaEmision)}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono font-medium">{o.machine.codigo}</span>
                      <span className="ml-2 text-xs text-slate-500">{o.worksite?.nombre}</span>
                    </td>
                    <td className="px-4 py-2.5">{o.tipo.codigo}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={ORDER_TONE[o.estado]}>{ORDER_LABEL[o.estado]}</StatusPill></td>
                    <td className="px-4 py-2.5 text-right font-mono">{o.horasIdeal === null ? '—' : formatQty(o.horasIdeal)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{o.horasReal === null ? '—' : formatQty(o.horasReal)}</td>
                    <td className="px-4 py-2.5">
                      {o.atraso ? <StatusPill tone={BUCKET_TONE[o.atraso.bucket]}>{LATENESS_LABEL[o.atraso.bucket]}</StatusPill> : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <OrderDetail
          order={selected}
          letterhead={refs.settings.letterheads[membrete] ?? ''}
          membrete={membrete}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
};

const OrderDetail: React.FC<{ order: ServiceOrderDto; letterhead: string; membrete: string; onClose: () => void; onChanged: () => void }> = ({
  order,
  letterhead,
  membrete,
  onClose,
  onChanged,
}) => {
  const unit = unitLabel(order.unidad);
  const [mode, setMode] = useState<'view' | 'complete' | 'cancel'>('view');
  const [fecha, setFecha] = useState(todayIso());
  const [horasReal, setHorasReal] = useState('');
  const [correccion, setCorreccion] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [fechaDevuelta, setFechaDevuelta] = useState('');
  const [cancelMotivo, setCancelMotivo] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(false);
    return restore;
  }, [printing]);

  const fail = (err: unknown) => setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);

  const complete = async () => {
    setErrors([]);
    if (horasReal.trim() === '' || !Number.isFinite(Number(horasReal))) {
      setErrors([`Ingresá las ${unit} reales del servicio.`]);
      return;
    }
    try {
      await maintenanceApi.complete(order.id, {
        fecha,
        horasReal: Number(horasReal),
        correccion,
        motivo: motivo.trim() || null,
        fechaDevuelta: fechaDevuelta || null,
      });
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const cancel = async () => {
    setErrors([]);
    try {
      await maintenanceApi.cancel(order.id, cancelMotivo);
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const open = order.estado === 'EMITIDA';

  return (
    <>
      <Modal
        title={`Orden de servicio N.º ${order.numero}`}
        size="lg"
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => setPrinting(true)}>Imprimir</Button>
              {open && mode === 'view' && <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setMode('complete')}>Realizar</Button>}
              {open && mode === 'view' && <Button variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setMode('cancel')}>Anular</Button>}
            </div>
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={ORDER_TONE[order.estado]}>{ORDER_LABEL[order.estado]}</StatusPill>
            {order.atraso && <StatusPill tone={BUCKET_TONE[order.atraso.bucket]}>{LATENESS_LABEL[order.atraso.bucket]} ({order.atraso.diferencia > 0 ? '+' : ''}{formatQty(order.atraso.diferencia)} {unit})</StatusPill>}
            <span className="text-slate-500">Emitida el {formatDate(order.fechaEmision)}</span>
          </div>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div>Máquina: <span className="font-medium">{order.machine.codigo} · {order.machine.descripcion}</span></div>
            <div>Obra: {order.worksite?.nombre ?? '—'}</div>
            <div>Servicio: <span className="font-medium">{order.tipo.nombre}</span></div>
            <div>Pedido de repuestos: {order.pedido ? `N.º ${order.pedido.numero}` : '—'}</div>
            <div>Ideal: <span className="font-mono">{order.horasIdeal === null ? '—' : `${formatQty(order.horasIdeal)} ${unit}`}</span></div>
            <div>Al emitir: <span className="font-mono">{order.horasActual === null ? '—' : `${formatQty(order.horasActual)} ${unit}`}</span></div>
            {order.estado === 'REALIZADA' && (
              <>
                <div>Realizada el {order.fechaRealizado ? formatDate(order.fechaRealizado) : '—'}: <span className="font-mono">{order.horasReal === null ? '—' : `${formatQty(order.horasReal)} ${unit}`}</span></div>
                <div>Próximo: {order.proximoTipo ? <span className="font-medium">{order.proximoTipo}</span> : '—'}{order.proximoHoras !== null && <span className="font-mono"> a las {formatQty(order.proximoHoras)} {unit}</span>}</div>
              </>
            )}
            {order.estado === 'ANULADA' && <div className="sm:col-span-2 text-rose-700">Anulada: {order.anuladoMotivo}</div>}
            {order.observaciones && <div className="sm:col-span-2">Observaciones: {order.observaciones}</div>}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Tareas</p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {order.tareas.map((t, i) => (
                <li key={i} className="flex gap-3 px-3 py-1.5"><span className="w-24 shrink-0 text-xs font-medium text-slate-500">{GROUP_LABEL[t.grupo]}</span><span>{t.descripcion}</span></li>
              ))}
              {order.tareas.length === 0 && <li className="px-3 py-2 text-slate-500">El tipo de servicio no tenía tareas cargadas.</li>}
            </ul>
          </div>
          {order.filtros.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Filtros de la máquina</p>
              <div className="text-slate-700">{order.filtros.map((f) => `${f.cantidad ?? '?'} × ${f.tipo}${f.referencia ? ` (${f.referencia})` : ''}`).join(' · ')}</div>
            </div>
          )}
          {order.capacidades.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Capacidades</p>
              <div className="text-slate-700">{order.capacidades.map((c) => `${c.punto}: ${c.capacidadLitros ?? '?'} L${c.producto ? ` de ${c.producto}` : ''}`).join(' · ')}</div>
            </div>
          )}

          {mode === 'complete' && (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="font-medium text-emerald-900">Realizar el servicio</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Fecha de realización"><input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
                <Field label={`${order.unidad === 'HS' ? 'Horas' : 'Kilómetros'} reales`} hint="Quedan como lectura de la máquina.">
                  <input type="number" min="0" step="any" className={inputClass} value={horasReal} onChange={(e) => setHorasReal(e.target.value)} />
                </Field>
                <Field label="Devuelta firmada (opcional)"><input type="date" className={inputClass} value={fechaDevuelta} onChange={(e) => setFechaDevuelta(e.target.value)} /></Field>
              </div>
              <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={correccion} onChange={(e) => setCorreccion(e.target.checked)} />Es una corrección (la lectura baja respecto de una anterior)</label>
              {correccion && <input className={inputClass} placeholder="Motivo de la corrección" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
              <div className="flex gap-2">
                <Button variant="primary" onClick={complete}>Confirmar</Button>
                <Button variant="ghost" onClick={() => setMode('view')}>Cancelar</Button>
              </div>
            </div>
          )}
          {mode === 'cancel' && (
            <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-4">
              <p className="font-medium text-rose-800">Anular la orden N.º {order.numero}: indicá el motivo.</p>
              <div className="flex gap-2">
                <input className={inputClass} value={cancelMotivo} onChange={(e) => setCancelMotivo(e.target.value)} placeholder="Motivo de la anulación" />
                <Button variant="danger" onClick={cancel}>Confirmar</Button>
                <Button variant="ghost" onClick={() => setMode('view')}>Cancelar</Button>
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
      {printing && <PrintableOrder order={order} letterhead={letterhead} membrete={membrete} />}
    </>
  );
};

const PrintableOrder: React.FC<{ order: ServiceOrderDto; letterhead: string; membrete: string }> = ({ order, letterhead, membrete }) => {
  const unit = unitLabel(order.unidad);
  return (
    <div className="print-area text-sm text-black">
      <div className="mb-4 flex items-start justify-between border-b border-black pb-2">
        <div>
          <div className="text-lg font-bold">{letterhead || LETTERHEAD_LABEL[membrete]}</div>
          <div>Orden de servicio de mantenimiento</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">N.º {order.numero}</div>
          <div>Emisión: {formatDate(order.fechaEmision)}</div>
          {order.estado === 'ANULADA' && <div className="font-bold">ANULADA</div>}
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1">
        <div>Máquina: <b>{order.machine.codigo}</b> · {order.machine.descripcion}</div>
        <div>Obra: {order.worksite?.nombre ?? '—'}</div>
        <div>Servicio: <b>{order.tipo.nombre}</b></div>
        <div>Pedido de repuestos: {order.pedido ? `N.º ${order.pedido.numero}` : '—'}</div>
      </div>
      <table className="mb-4 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-black text-left"><th className="py-1">Ideal ({unit})</th><th className="py-1">Actual ({unit})</th><th className="py-1">Real ({unit})</th><th className="py-1">Fecha de realización</th><th className="py-1">Próximo servicio</th></tr>
        </thead>
        <tbody>
          <tr className="h-8 border-b border-slate-400">
            <td>{order.horasIdeal === null ? '' : formatQty(order.horasIdeal)}</td>
            <td>{order.horasActual === null ? '' : formatQty(order.horasActual)}</td>
            <td>{order.horasReal === null ? '' : formatQty(order.horasReal)}</td>
            <td>{order.fechaRealizado ? formatDate(order.fechaRealizado) : ''}</td>
            <td>{order.proximoTipo ?? ''}{order.proximoHoras !== null ? ` · ${formatQty(order.proximoHoras)} ${unit}` : ''}</td>
          </tr>
        </tbody>
      </table>
      <table className="mb-4 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-black text-left"><th className="w-8 py-1">✓</th><th className="w-28 py-1">Grupo</th><th className="py-1">Tarea</th></tr>
        </thead>
        <tbody>
          {order.tareas.map((t, i) => (
            <tr key={i} className="border-b border-slate-300">
              <td className="py-1">☐</td>
              <td className="py-1">{GROUP_LABEL[t.grupo]}</td>
              <td className="py-1">{t.descripcion}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.filtros.length > 0 && (
        <div className="mb-3">
          <div className="font-bold">Filtros</div>
          <div>{order.filtros.map((f) => `${f.cantidad ?? '?'} × ${f.tipo}${f.referencia ? ` (${f.referencia})` : ''}`).join(' · ')}</div>
        </div>
      )}
      {order.capacidades.length > 0 && (
        <div className="mb-3">
          <div className="font-bold">Capacidades</div>
          <div>{order.capacidades.map((c) => `${c.punto}: ${c.capacidadLitros ?? '?'} L${c.producto ? ` de ${c.producto}` : ''}`).join(' · ')}</div>
        </div>
      )}
      {order.observaciones && <div className="mb-3">Observaciones: {order.observaciones}</div>}
      <div className="mt-16 grid grid-cols-3 gap-12 text-center">
        <div className="border-t border-black pt-1">Mecánico</div>
        <div className="border-t border-black pt-1">Jefe de taller</div>
        <div className="border-t border-black pt-1">Encargado de obra</div>
      </div>
    </div>
  );
};
