/**
 * @file components/Orders/OrdersModule.tsx
 * @description Pedidos de materiales (tablas PEDIDOS DE MATERIALES y PEDIDO DE MATERIALES
 * REPUESTOS del Access): lista con filtros, alta y edición por renglón, recepciones
 * parciales, impresión del pedido e informe de pendientes con exportación a Excel.
 */

import React, { useEffect, useState } from 'react';
import { Ban, ClipboardList, Download, Plus, Printer, Trash2, Truck } from 'lucide-react';
import type { CompanySettings, MaterialOrder, OrderRubro, PendingReport } from '../../../shared/erp';
import type { OrderStatus } from '../../../shared/orders';
import { pendingQuantity, validateOrderDraft, validateReceptionDraft } from '../../../shared/orders';
import { describeError } from '../../services/http';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { printArea } from '../../utils/print';
import { exportRowsToExcel } from '../../utils/excel';
import { mastersApi, type MachineRef, type Supplier, type Worksite } from '../../services/mastersApi';
import {
  ordersApi,
  type OrderDraft,
  type OrderFilters,
  type PendingFilters,
  type ReceptionDraft,
} from '../../services/ordersApi';
import { Button, Card, EmptyState, Field, Modal, Page, PageHeader, StatusPill, cx, inputClass } from '../../ui';
import { DispatchBadge } from '../Dispatch/DispatchBadge';
import { stockApi } from '../../services/stockApi';
import type { ArticleDto } from '../../../shared/stock';
import { ArticlePicker } from '../Stock/ArticlePicker';

const RUBROS: { value: OrderRubro; label: string }[] = [
  { value: 'FILTROS', label: 'Filtros' },
  { value: 'ACEITES', label: 'Aceites' },
  { value: 'BATERIAS', label: 'Baterías' },
  { value: 'CUBIERTAS', label: 'Cubiertas' },
  { value: 'OTROS', label: 'Otros' },
];

const ESTADO_LABEL: Record<OrderStatus, string> = {
  PENDIENTE: 'Pendiente',
  PARCIAL: 'Parcial',
  RECIBIDO: 'Recibido',
  COMPRA_CENTRAL: 'Compra central',
  ANULADO: 'Anulado',
};

const ESTADO_TONE: Record<OrderStatus, 'warn' | 'info' | 'good' | 'violet' | 'bad'> = {
  PENDIENTE: 'warn',
  PARCIAL: 'info',
  RECIBIDO: 'good',
  COMPRA_CENTRAL: 'violet',
  ANULADO: 'bad',
};

const AGRUPACION_LABEL: Record<PendingFilters['agrupar'], string> = {
  obra: 'Obra',
  maquina: 'Máquina',
  rubro: 'Rubro',
  fecha: 'Mes',
};

const LETTERHEAD_LABEL: Record<string, string> = {
  ccc: 'C.C.C. S.A.',
  consorcio: 'Consorcio',
  papel_comun: 'Papel común',
};

/* ─── Utilidades ───────────────────────────────────────────────────────── */

function draftFromOrder(order: MaterialOrder | null): OrderDraft {
  if (!order) {
    return {
      fecha: todayIso(),
      worksiteId: null,
      machineId: null,
      supplierId: null,
      pedidoDeObra: false,
      compraCentral: false,
      rubros: [],
      observaciones: null,
      lines: [{ nroParte: null, descripcion: '', cantidad: 1, machineId: null }],
    };
  }
  return {
    fecha: order.fecha,
    worksiteId: order.worksite?.id ?? null,
    machineId: order.machine?.id ?? null,
    supplierId: order.supplier?.id ?? null,
    pedidoDeObra: order.pedidoDeObra,
    compraCentral: order.compraCentral,
    rubros: order.rubros,
    observaciones: order.observaciones,
    lines: order.lines.map((l) => ({
      nroParte: l.nroParte,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      machineId: l.machineId,
    })),
  };
}

interface Masters {
  worksites: Worksite[];
  suppliers: Supplier[];
  machines: MachineRef[];
}

const selectClass = inputClass;

/* ─── Módulo ───────────────────────────────────────────────────────────── */

export const OrdersModule: React.FC = () => {
  const [tab, setTab] = useState<'PEDIDOS' | 'PENDIENTES'>('PEDIDOS');
  const [masters, setMasters] = useState<Masters>({ worksites: [], suppliers: [], machines: [] });
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [membrete, setMembrete] = useState<string>('ccc');
  const [printOrder, setPrintOrder] = useState<MaterialOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([mastersApi.worksites(), mastersApi.suppliers(), mastersApi.machines(), mastersApi.settings()])
      .then(([worksites, suppliers, machines, cfg]) => {
        setMasters({ worksites, suppliers, machines });
        setSettings(cfg);
        if (cfg.letterheads.ccc === undefined) setMembrete(Object.keys(cfg.letterheads)[0] ?? 'ccc');
      })
      .catch((err) => setError(describeError(err)));
  }, []);

  // Imprime solo el área del pedido: body.print-doc oculta el resto (ver index.css).
  useEffect(() => {
    if (!printOrder) return;
    const restore = printArea();
    setPrintOrder(null);
    return restore;
  }, [printOrder]);

  return (
    <Page>
      <PageHeader
        title="Pedidos de materiales"
        help="Cada renglón se recibe por separado y en parcial. El pendiente es lo pedido menos lo recibido."
        actions={
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
            {(['PEDIDOS', 'PENDIENTES'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cx(
                  'rounded-lg px-3 py-1.5 font-medium transition',
                  tab === t ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {t === 'PEDIDOS' ? 'Pedidos' : 'Pendientes'}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {tab === 'PEDIDOS' ? (
        <OrdersList
          masters={masters}
          settings={settings}
          membrete={membrete}
          onMembreteChange={setMembrete}
          onPrint={setPrintOrder}
        />
      ) : (
        <PendingView masters={masters} />
      )}

      {printOrder && settings && (
        <PrintableOrder order={printOrder} letterhead={settings.letterheads[membrete] ?? ''} membrete={membrete} />
      )}
    </Page>
  );
};

/* ─── Lista de pedidos ─────────────────────────────────────────────────── */

const OrdersList: React.FC<{
  masters: Masters;
  settings: CompanySettings | null;
  membrete: string;
  onMembreteChange: (value: string) => void;
  onPrint: (order: MaterialOrder) => void;
}> = ({ masters, settings, membrete, onMembreteChange, onPrint }) => {
  const [filters, setFilters] = useState<OrderFilters>({});
  const [orders, setOrders] = useState<MaterialOrder[] | null>(null);
  const [editing, setEditing] = useState<MaterialOrder | 'NUEVO' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    ordersApi
      .list(filters)
      .then(setOrders)
      .catch((err) => setError(describeError(err)));
  };

  useEffect(load, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = <K extends keyof OrderFilters>(key: K, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value === '' ? undefined : value }));

  return (
    <>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Estado">
            <select className={selectClass} value={filters.estado ?? ''} onChange={(e) => setFilter('estado', e.target.value)}>
              <option value="">Todos</option>
              {(Object.keys(ESTADO_LABEL) as OrderStatus[]).map((s) => (
                <option key={s} value={s}>{ESTADO_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="Obra">
            <select className={selectClass} value={filters.obra ?? ''} onChange={(e) => setFilter('obra', e.target.value)}>
              <option value="">Todas</option>
              {masters.worksites.map((w) => (
                <option key={w.id} value={w.id}>{w.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Máquina">
            <select className={selectClass} value={filters.maquina ?? ''} onChange={(e) => setFilter('maquina', e.target.value)}>
              <option value="">Todas</option>
              {masters.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.codigo} · {m.descripcion}</option>
              ))}
            </select>
          </Field>
          <Field label="Rubro">
            <select className={selectClass} value={filters.rubro ?? ''} onChange={(e) => setFilter('rubro', e.target.value)}>
              <option value="">Todos</option>
              {RUBROS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
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
            <input
              className={inputClass}
              placeholder="Nº, parte o descripción"
              value={filters.q ?? ''}
              onChange={(e) => setFilter('q', e.target.value)}
            />
          </Field>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            {settings && (
              <Field label="Membrete">
                <select className={selectClass} value={membrete} onChange={(e) => onMembreteChange(e.target.value)}>
                  {Object.keys(settings.letterheads).map((k) => (
                    <option key={k} value={k}>{LETTERHEAD_LABEL[k] ?? k}</option>
                  ))}
                </select>
              </Field>
            )}
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('NUEVO')}>
              Nuevo pedido
            </Button>
          </div>
        </div>

        {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}

        {orders === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando pedidos…</div>
        ) : orders.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ClipboardList className="h-6 w-6" />}
              title="No hay pedidos con estos filtros"
              help="Creá un pedido o cambiá los filtros."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Nº</th>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Obra</th>
                  <th className="px-4 py-2.5">Máquina</th>
                  <th className="px-4 py-2.5">Rubros</th>
                  <th className="px-4 py-2.5">Renglones</th>
                  <th className="px-4 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => {
                  const abiertos = o.lines.filter((l) => l.pendiente > 0).length;
                  return (
                    <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(o)}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{o.numero}</td>
                      <td className="px-4 py-2.5">{formatDate(o.fecha)}</td>
                      <td className="px-4 py-2.5">{o.worksite?.nombre ?? <span className="text-slate-400">Sin obra</span>}</td>
                      <td className="px-4 py-2.5">{o.machine?.codigo ?? <span className="text-slate-400">—</span>}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {o.rubros.length > 0 ? o.rubros.map((r) => RUBROS.find((x) => x.value === r)?.label ?? r).join(', ') : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {abiertos} pendiente{abiertos === 1 ? '' : 's'} de {o.lines.length}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill tone={ESTADO_TONE[o.estado]}>{ESTADO_LABEL[o.estado]}</StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <OrderEditor
          order={editing === 'NUEVO' ? null : editing}
          masters={masters}
          onPrint={onPrint}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
};

/* ─── Editor de pedido ─────────────────────────────────────────────────── */

const OrderEditor: React.FC<{
  order: MaterialOrder | null;
  masters: Masters;
  onPrint: (order: MaterialOrder) => void;
  onClose: () => void;
  onSaved: () => void;
}> = ({ order, masters, onPrint, onClose, onSaved }) => {
  const [draft, setDraft] = useState<OrderDraft>(() => draftFromOrder(order));
  const [current, setCurrent] = useState<MaterialOrder | null>(order);
  const [receiving, setReceiving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const anulado = current?.anulado ?? false;
  const tieneRecepciones = (current?.receptions.length ?? 0) > 0;
  const readOnly = anulado || tieneRecepciones;
  const puedeRecibir = current !== null && !anulado && !current.compraCentral;

  const patch = (changes: Partial<OrderDraft>) => setDraft((prev) => ({ ...prev, ...changes }));
  const patchLine = (index: number, changes: Partial<OrderDraft['lines'][number]>) =>
    setDraft((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === index ? { ...l, ...changes } : l)),
    }));
  const addLine = () =>
    setDraft((prev) => ({
      ...prev,
      lines: [...prev.lines, { nroParte: null, descripcion: '', cantidad: 1, machineId: prev.machineId }],
    }));
  const removeLine = (index: number) =>
    setDraft((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));

  const toggleRubro = (rubro: OrderRubro) =>
    patch({
      rubros: draft.rubros.includes(rubro) ? draft.rubros.filter((r) => r !== rubro) : [...draft.rubros, rubro],
    });

  const save = async () => {
    const local = validateOrderDraft(draft.lines);
    if (!draft.fecha) local.unshift('La fecha es obligatoria.');
    if (local.length > 0) {
      setErrors(local);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const saved = current ? await ordersApi.update(current.id, draft) : await ordersApi.create(draft);
      setCurrent(saved);
      onSaved();
    } catch (err) {
      setErrors([describeError(err)]);
    } finally {
      setSaving(false);
    }
  };

  const anular = async () => {
    if (!current) return;
    if (!window.confirm(`¿Anular el pedido Nº ${current.numero}? No se puede deshacer.`)) return;
    try {
      await ordersApi.anular(current.id);
      onSaved();
    } catch (err) {
      setErrors([describeError(err)]);
    }
  };

  const title = current ? `Pedido Nº ${current.numero}` : 'Nuevo pedido';

  return (
    <>
      <Modal
        title={title}
        size="lg"
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {current && puedeRecibir && (
                <Button variant="secondary" icon={<Truck className="h-4 w-4" />} onClick={() => setReceiving(true)}>
                  Registrar recepción
                </Button>
              )}
              {current && (
                <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => onPrint(current)}>
                  Imprimir
                </Button>
              )}
              {current && !anulado && (
                <Button variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={anular}>
                  Anular
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cerrar
              </Button>
              {!readOnly && (
                <Button variant="primary" onClick={save} disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar pedido'}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {current && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StatusPill tone={ESTADO_TONE[current.estado]}>{ESTADO_LABEL[current.estado]}</StatusPill>
              {!current.anulado && <DispatchBadge kind="PEDIDO" id={current.id} />}
              {readOnly && (
                <span className="text-slate-500">
                  {anulado ? 'Pedido anulado: solo lectura.' : 'Tiene recepciones: no se puede editar.'}
                </span>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha">
              <input
                type="date"
                className={inputClass}
                value={draft.fecha}
                disabled={readOnly}
                onChange={(e) => patch({ fecha: e.target.value })}
              />
            </Field>
            <Field label="Obra">
              <select
                className={selectClass}
                value={draft.worksiteId ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ worksiteId: e.target.value || null })}
              >
                <option value="">Sin obra</option>
                {masters.worksites.map((w) => (
                  <option key={w.id} value={w.id}>{w.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Máquina">
              <select
                className={selectClass}
                value={draft.machineId ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ machineId: e.target.value || null })}
              >
                <option value="">Sin máquina</option>
                {masters.machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.codigo} · {m.descripcion}</option>
                ))}
              </select>
            </Field>
            <Field label="Proveedor sugerido">
              <select
                className={selectClass}
                value={draft.supplierId ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ supplierId: e.target.value || null })}
              >
                <option value="">Sin proveedor</option>
                {masters.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-wrap gap-2">
              {RUBROS.map((r) => {
                const on = draft.rubros.includes(r.value);
                return (
                  <button
                    key={r.value}
                    type="button"
                    disabled={readOnly}
                    onClick={() => toggleRubro(r.value)}
                    className={cx(
                      'rounded-full px-3 py-1 text-xs font-medium ring-1 transition disabled:opacity-60',
                      on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
                    )}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.pedidoDeObra}
                disabled={readOnly}
                onChange={(e) => patch({ pedidoDeObra: e.target.checked })}
              />
              Pedido de obra
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.compraCentral}
                disabled={readOnly}
                onChange={(e) => patch({ compraCentral: e.target.checked })}
              />
              Compra central
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Renglones</h3>
              {!readOnly && (
                <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={addLine}>
                  Agregar renglón
                </Button>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nº parte</th>
                    <th className="px-3 py-2">Descripción</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2">Máquina</th>
                    {current && <th className="px-3 py-2 text-right">Recibido</th>}
                    {current && <th className="px-3 py-2 text-right">Pendiente</th>}
                    {!readOnly && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draft.lines.map((line, index) => {
                    const saved = current?.lines[index];
                    return (
                      <tr key={index}>
                        <td className="px-2 py-1.5">
                          <input
                            className={inputClass}
                            value={line.nroParte ?? ''}
                            disabled={readOnly}
                            onChange={(e) => patchLine(index, { nroParte: e.target.value || null })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={inputClass}
                            value={line.descripcion}
                            disabled={readOnly}
                            onChange={(e) => patchLine(index, { descripcion: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && index === draft.lines.length - 1 && !readOnly) {
                                e.preventDefault();
                                addLine();
                              }
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            className={cx(inputClass, 'text-right')}
                            value={line.cantidad}
                            disabled={readOnly}
                            onChange={(e) => patchLine(index, { cantidad: Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            className={selectClass}
                            value={line.machineId ?? ''}
                            disabled={readOnly}
                            onChange={(e) => patchLine(index, { machineId: e.target.value || null })}
                          >
                            <option value="">—</option>
                            {masters.machines.map((m) => (
                              <option key={m.id} value={m.id}>{m.codigo}</option>
                            ))}
                          </select>
                        </td>
                        {current && (
                          <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                            {saved ? formatQty(saved.recibida) : '—'}
                          </td>
                        )}
                        {current && (
                          <td className="px-3 py-1.5 text-right font-mono font-semibold text-slate-900">
                            {saved ? formatQty(saved.pendiente) : '—'}
                          </td>
                        )}
                        {!readOnly && (
                          <td className="px-2 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => removeLine(index)}
                              disabled={draft.lines.length === 1}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                              aria-label="Quitar renglón"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Field label="Observaciones">
            <textarea
              className={cx(inputClass, 'min-h-20')}
              value={draft.observaciones ?? ''}
              disabled={readOnly}
              onChange={(e) => patch({ observaciones: e.target.value || null })}
            />
          </Field>

          {current && current.receptions.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Recepciones</h3>
              <ul className="space-y-1 text-sm text-slate-600">
                {current.receptions.map((r) => (
                  <li key={r.id}>
                    Recepción Nº {r.numero} · {formatDate(r.fecha)}
                    {r.facturaORemision ? ` · ${r.facturaORemision}` : ''} · {r.lines.length} renglón
                    {r.lines.length === 1 ? '' : 'es'}
                    {r.stockMovement ? ` · ingresó a stock (vale Nº ${r.stockMovement.numero})` : ''}
                  </li>
                ))}
              </ul>
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

      {receiving && current && (
        <ReceptionForm
          order={current}
          masters={masters}
          onClose={() => setReceiving(false)}
          onSaved={(updated) => {
            setCurrent(updated);
            setDraft(draftFromOrder(updated));
            setReceiving(false);
            onSaved();
          }}
        />
      )}
    </>
  );
};

/* ─── Recepción parcial ────────────────────────────────────────────────── */

const ReceptionForm: React.FC<{
  order: MaterialOrder;
  masters: Masters;
  onClose: () => void;
  onSaved: (order: MaterialOrder) => void;
}> = ({ order, masters, onClose, onSaved }) => {
  const pendientes = order.lines.filter((l) => l.pendiente > 0);
  const [fecha, setFecha] = useState(todayIso());
  const [supplierId, setSupplierId] = useState<string>(order.supplier?.id ?? '');
  const [remito, setRemito] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Ingreso a stock: por renglón, con el artículo sugerido por número de parte (código propio o equivalencia).
  const [articles, setArticles] = useState<ArticleDto[]>([]);
  const [stock, setStock] = useState<Record<string, { enabled: boolean; articleId: string; costo: string }>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all([stockApi.articles({ activo: true }), stockApi.matchArticles(pendientes.map((l) => l.nroParte ?? ''))])
      .then(([list, matches]) => {
        if (cancelled) return;
        setArticles(list);
        setStock(
          Object.fromEntries(
            pendientes.map((l, i) => {
              const article = matches[i]?.articulo ?? null;
              return [l.id, { enabled: article !== null, articleId: article?.id ?? '', costo: article && article.costoPromedio > 0 ? String(article.costoPromedio) : '' }];
            }),
          ),
        );
      })
      .catch(() => undefined); // Sin stock disponible la recepción se registra igual, sin ingreso.
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const setCantidad = (lineId: string, value: number) => setCantidades((prev) => ({ ...prev, [lineId]: value }));
  const patchStock = (lineId: string, changes: Partial<{ enabled: boolean; articleId: string; costo: string }>) =>
    setStock((prev) => ({ ...prev, [lineId]: { enabled: false, articleId: '', costo: '', ...prev[lineId], ...changes } }));

  const submit = async () => {
    const lines: ReceptionDraft['lines'] = pendientes
      .filter((l) => (cantidades[l.id] ?? 0) > 0)
      .map((l) => {
        const s = stock[l.id];
        const toStock = s?.enabled && s.articleId !== '';
        return {
          orderLineId: l.id,
          cantidad: cantidades[l.id],
          stock: toStock ? { articleId: s.articleId, costoUnitario: Number(s.costo) } : null,
        };
      });
    const stockErrors = lines.flatMap((line) =>
      line.stock && !(Number.isFinite(line.stock.costoUnitario) && line.stock.costoUnitario > 0)
        ? [`Indicá el costo unitario del renglón «${order.lines.find((l) => l.id === line.orderLineId)?.descripcion ?? ''}» para ingresarlo a stock.`]
        : [],
    );
    const pending = new Map<string, number>(
      order.lines.map((l): [string, number] => [l.id, pendingQuantity(l.cantidad, l.recibida)]),
    );
    const local = [...validateReceptionDraft(lines, pending), ...stockErrors];
    if (!fecha) local.unshift('La fecha es obligatoria.');
    if (local.length > 0) {
      setErrors(local);
      return;
    }
    const draft: ReceptionDraft = {
      fecha,
      supplierId: supplierId || null,
      facturaORemision: remito.trim() || null,
      observaciones: null,
      lines,
    };
    setSaving(true);
    try {
      onSaved(await ordersApi.receive(order.id, draft));
    } catch (err) {
      setErrors([describeError(err)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Recepción · Pedido Nº ${order.numero}`}
      size={articles.length > 0 ? 'xl' : 'lg'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Guardando…' : 'Registrar recepción'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Fecha de recepción">
            <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
          <Field label="Proveedor">
            <select className={selectClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Sin proveedor</option>
              {masters.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Factura o remisión">
            <input className={inputClass} value={remito} onChange={(e) => setRemito(e.target.value)} />
          </Field>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2 text-right">Pendiente</th>
                <th className="px-3 py-2 text-right">Recibir ahora</th>
                <th className="px-3 py-2" />
                {articles.length > 0 && <th className="px-3 py-2">Ingresar a stock</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pendientes.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{l.descripcion}</div>
                    {l.nroParte && <div className="text-xs text-slate-500">Parte {l.nroParte}</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatQty(l.pendiente)}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      max={l.pendiente}
                      step="any"
                      className={cx(inputClass, 'text-right')}
                      value={cantidades[l.id] ?? ''}
                      placeholder="0"
                      onChange={(e) => setCantidad(l.id, Number(e.target.value))}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setCantidad(l.id, l.pendiente)}>
                      Todo
                    </Button>
                  </td>
                  {articles.length > 0 && (
                    <td className="min-w-[22rem] px-3 py-2">
                      <div className="grid grid-cols-[auto_1fr_7rem] items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-3"
                          aria-label="Ingresar a stock"
                          checked={stock[l.id]?.enabled ?? false}
                          onChange={(e) => patchStock(l.id, { enabled: e.target.checked })}
                        />
                        <ArticlePicker
                          articles={articles}
                          value={stock[l.id]?.articleId ?? ''}
                          onChange={(articleId) => patchStock(l.id, { articleId, enabled: articleId !== '' ? true : stock[l.id]?.enabled ?? false })}
                          listId={`reception-articles-${l.id}`}
                          placeholder="Sin artículo"
                          showBalance={false}
                        />
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className={cx(inputClass, 'text-right')}
                          placeholder="Costo unit."
                          disabled={!(stock[l.id]?.enabled ?? false)}
                          value={stock[l.id]?.costo ?? ''}
                          onChange={(e) => patchStock(l.id, { costo: e.target.value })}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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

/* ─── Impresión del pedido ─────────────────────────────────────────────── */

const PrintableOrder: React.FC<{ order: MaterialOrder; letterhead: string; membrete: string }> = ({
  order,
  letterhead,
  membrete,
}) => (
  <div className="print-area text-sm text-black">
    <div className="mb-4 flex items-start justify-between border-b border-black pb-2">
      <div>
        <div className="text-lg font-bold">{letterhead || LETTERHEAD_LABEL[membrete]}</div>
        <div>Pedido de materiales</div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold">Nº {order.numero}</div>
        <div>Fecha: {formatDate(order.fecha)}</div>
        <div>Estado: {ESTADO_LABEL[order.estado]}</div>
      </div>
    </div>

    <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1">
      <div>Obra: {order.worksite?.nombre ?? '—'}</div>
      <div>Máquina: {order.machine ? `${order.machine.codigo} · ${order.machine.descripcion}` : '—'}</div>
      <div>Proveedor sugerido: {order.supplier?.nombre ?? '—'}</div>
      <div>Rubros: {order.rubros.map((r) => RUBROS.find((x) => x.value === r)?.label ?? r).join(', ') || '—'}</div>
    </div>

    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="py-1">Nº</th>
          <th className="py-1">Parte</th>
          <th className="py-1">Descripción</th>
          <th className="py-1">Máquina</th>
          <th className="py-1 text-right">Pedido</th>
          <th className="py-1 text-right">Recibido</th>
          <th className="py-1 text-right">Pendiente</th>
        </tr>
      </thead>
      <tbody>
        {order.lines.map((l) => (
          <tr key={l.id} className="border-b border-slate-300">
            <td className="py-1">{l.position}</td>
            <td className="py-1">{l.nroParte ?? ''}</td>
            <td className="py-1">{l.descripcion}</td>
            <td className="py-1">{l.maquinaCodigo ?? ''}</td>
            <td className="py-1 text-right">{formatQty(l.cantidad)}</td>
            <td className="py-1 text-right">{formatQty(l.recibida)}</td>
            <td className="py-1 text-right">{formatQty(l.pendiente)}</td>
          </tr>
        ))}
      </tbody>
    </table>

    {order.receptions.length > 0 && (
      <div className="mt-4">
        <div className="font-bold">Recepciones</div>
        <ul>
          {order.receptions.map((r) => (
            <li key={r.id}>
              Nº {r.numero} · {formatDate(r.fecha)}
              {r.facturaORemision ? ` · ${r.facturaORemision}` : ''} · {r.lines.length} renglón
              {r.lines.length === 1 ? '' : 'es'}
            </li>
          ))}
        </ul>
      </div>
    )}

    {order.observaciones && <div className="mt-4">Observaciones: {order.observaciones}</div>}

    <div className="mt-16 grid grid-cols-2 gap-16 text-center">
      <div className="border-t border-black pt-1">Solicitado por</div>
      <div className="border-t border-black pt-1">Recibido por</div>
    </div>
  </div>
);

/* ─── Informe de pendientes ────────────────────────────────────────────── */

const PendingView: React.FC<{ masters: Masters }> = ({ masters }) => {
  const [filters, setFilters] = useState<PendingFilters>({ agrupar: 'obra' });
  const [report, setReport] = useState<PendingReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    ordersApi
      .pendingReport(filters)
      .then(setReport)
      .catch((err) => setError(describeError(err)));
  }, [filters]);

  const exportExcel = () => {
    if (!report) return;
    const rows = report.grupos.flatMap((g) =>
      g.filas.map((f) => ({
        [AGRUPACION_LABEL[report.agrupar]]: g.clave,
        Pedido: f.pedidoNumero,
        Fecha: formatDate(f.fecha),
        'Días pendiente': f.dias,
        Máquina: f.maquina,
        Rubro: f.rubro,
        Parte: f.nroParte ?? '',
        Descripción: f.descripcion,
        Pedido_cant: f.cantidad,
        Recibido: f.recibida,
        Pendiente: f.pendiente,
        Proveedor: f.proveedor ?? '',
      })),
    );
exportRowsToExcel(rows, 'Pendientes', `pedidos-pendientes-${report.agrupar}-${report.hoy}.xlsx`);
  };

  return (
    <>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Agrupar por">
            <select
              className={selectClass}
              value={filters.agrupar}
              onChange={(e) => setFilters((p) => ({ ...p, agrupar: e.target.value as PendingFilters['agrupar'] }))}
            >
              {(Object.keys(AGRUPACION_LABEL) as PendingFilters['agrupar'][]).map((k) => (
                <option key={k} value={k}>{AGRUPACION_LABEL[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Obra">
            <select
              className={selectClass}
              value={filters.obra ?? ''}
              onChange={(e) => setFilters((p) => ({ ...p, obra: e.target.value || undefined }))}
            >
              <option value="">Todas</option>
              {masters.worksites.map((w) => (
                <option key={w.id} value={w.id}>{w.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Máquina">
            <select
              className={selectClass}
              value={filters.maquina ?? ''}
              onChange={(e) => setFilters((p) => ({ ...p, maquina: e.target.value || undefined }))}
            >
              <option value="">Todas</option>
              {masters.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.codigo}</option>
              ))}
            </select>
          </Field>
          <Field label="Rubro">
            <select
              className={selectClass}
              value={filters.rubro ?? ''}
              onChange={(e) =>
                setFilters((p) => ({ ...p, rubro: (e.target.value || undefined) as OrderRubro | undefined }))
              }
            >
              <option value="">Todos</option>
              {RUBROS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Pedidos desde">
            <input
              type="date"
              className={inputClass}
              value={filters.desde ?? ''}
              onChange={(e) => setFilters((p) => ({ ...p, desde: e.target.value || undefined }))}
            />
          </Field>
          <div className="ml-auto">
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportExcel} disabled={!report}>
              Exportar a Excel
            </Button>
          </div>
        </div>
      </Card>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {report === null ? (
        <div className="text-sm text-slate-500">Cargando pendientes…</div>
      ) : report.grupos.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title="No hay renglones pendientes"
          help="Todo lo pedido con estos filtros ya fue recibido, o los pedidos están anulados o son de compra central."
        />
      ) : (
        report.grupos.map((g) => {
          const total = g.filas.reduce((acc, f) => acc + f.pendiente, 0);
          return (
            <div key={g.clave}>
            <Card
              padded={false}
              title={
                <span className="flex items-center gap-2">
                  {g.clave}
                  <StatusPill tone={g.diasMaxPendiente > 30 ? 'bad' : 'warn'}>
                    Máx. {g.diasMaxPendiente} días
                  </StatusPill>
                </span>
              }
              action={
                <span className="text-xs text-slate-500">
                  {g.lineas} renglón{g.lineas === 1 ? '' : 'es'} · {g.pedidos} pedido{g.pedidos === 1 ? '' : 's'} · pendiente{' '}
                  <span className="font-mono font-semibold text-slate-800">{formatQty(total)}</span>
                </span>
              }
            >
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Pedido</th>
                      <th className="px-4 py-2">Fecha</th>
                      <th className="px-4 py-2 text-right">Días</th>
                      <th className="px-4 py-2">Máquina</th>
                      <th className="px-4 py-2">Descripción</th>
                      <th className="px-4 py-2 text-right">Pedido</th>
                      <th className="px-4 py-2 text-right">Recibido</th>
                      <th className="px-4 py-2 text-right">Pendiente</th>
                      <th className="px-4 py-2">Proveedor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {g.filas.map((f, i) => (
                      <tr key={`${f.pedidoId}-${i}`}>
                        <td className="px-4 py-2 font-mono">{f.pedidoNumero}</td>
                        <td className="px-4 py-2">{formatDate(f.fecha)}</td>
                        <td className="px-4 py-2 text-right font-mono">{f.dias}</td>
                        <td className="px-4 py-2">{f.maquina}</td>
                        <td className="px-4 py-2">
                          {f.descripcion}
                          {f.nroParte && <span className="ml-1 text-xs text-slate-500">({f.nroParte})</span>}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{formatQty(f.cantidad)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatQty(f.recibida)}</td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">{formatQty(f.pendiente)}</td>
                        <td className="px-4 py-2 text-slate-600">{f.proveedor ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            </div>
          );
        })
      )}
    </>
  );
};
