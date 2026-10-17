/**
 * @file components/Stock/MovementForm.tsx
 * @description Alta de un vale de stock (entrada, salida, saldo inicial o ajuste) con varios renglones.
 * Una salida pide la máquina u obra de destino y muestra el saldo disponible: el servidor la rechaza si
 * lo supera. Las entradas piden el costo unitario, que alimenta el costo promedio.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { STOCK_TYPE_LABEL, STOCK_TYPES, validateStockMovement, type StockMovementResult, type StockMovementType } from '../../../shared/stock';
import { ApiError, describeError } from '../../services/http';
import { maintenanceApi } from '../../services/maintenanceApi';
import { stockApi, type StockMovementDraft } from '../../services/stockApi';
import { todayIso } from '../../utils/format';
import { Button, Field, Modal, cx, inputClass } from '../../ui';
import { SupplierPicker } from '../Finance/SupplierPicker';
import { ArticlePicker } from './ArticlePicker';
import { UNIT_LABEL, type StockRefs } from './common';

interface LineDraft {
  articleId: string;
  cantidad: string;
  costo: string;
}

const emptyLine = (articleId = ''): LineDraft => ({ articleId, cantidad: '', costo: '' });

export const MovementForm: React.FC<{
  refs: StockRefs;
  initial?: { tipo?: StockMovementType; articleId?: string };
  reloadRefs: () => void;
  onClose: () => void;
  onSaved: (result: StockMovementResult) => void;
}> = ({ refs, initial, reloadRefs, onClose, onSaved }) => {
  const [tipo, setTipo] = useState<StockMovementType>(initial?.tipo ?? 'SALIDA');
  const [fecha, setFecha] = useState(todayIso());
  const [machineId, setMachineId] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [serviceOrderId, setServiceOrderId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [remision, setRemision] = useState('');
  const [motivo, setMotivo] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(initial?.articleId)]);
  const [orders, setOrders] = useState<{ id: string; numero: number; tipo: string }[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const costRequired = tipo === 'ENTRADA' || tipo === 'SALDO_INICIAL';
  const showCost = costRequired || tipo === 'AJUSTE';

  // Órdenes de servicio abiertas de la máquina elegida: la salida puede quedar enlazada a una.
  useEffect(() => {
    setServiceOrderId('');
    if (tipo !== 'SALIDA' || !machineId) {
      setOrders([]);
      return;
    }
    maintenanceApi
      .orders({ estado: 'EMITIDA', maquina: machineId })
      .then((list) => setOrders(list.map((o) => ({ id: o.id, numero: o.numero, tipo: o.tipo.nombre }))))
      .catch(() => setOrders([]));
  }, [tipo, machineId]);

  const patchLine = (i: number, changes: Partial<LineDraft>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...changes } : l)));

  const save = async () => {
    const used = lines.filter((l) => l.articleId || l.cantidad.trim() || l.costo.trim());
    const draft: StockMovementDraft = {
      tipo,
      fecha,
      machineId: tipo === 'SALIDA' ? machineId || null : null,
      worksiteId: tipo === 'SALIDA' ? worksiteId || null : null,
      serviceOrderId: tipo === 'SALIDA' ? serviceOrderId || null : null,
      supplierId: tipo === 'ENTRADA' ? supplierId || null : null,
      remision: tipo === 'ENTRADA' ? remision.trim() || null : null,
      motivo: motivo.trim() || null,
      observaciones: observaciones.trim() || null,
      lines: used.map((l) => ({
        articleId: l.articleId,
        cantidad: Number(l.cantidad),
        costoUnitario: l.costo.trim() === '' ? null : Number(l.costo),
      })),
    };
    const local = validateStockMovement(draft, todayIso());
    if (local.length > 0) {
      setErrors(local);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      onSaved(await stockApi.createMovement(draft));
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Nuevo vale de stock"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} disabled={saving} onClick={save}>Registrar</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tipo">
          <select className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value as StockMovementType)}>
            {STOCK_TYPES.map((t) => (
              <option key={t} value={t}>{STOCK_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Fecha"><input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
        {tipo === 'ENTRADA' && <Field label="Remisión o factura"><input className={inputClass} value={remision} onChange={(e) => setRemision(e.target.value)} /></Field>}

        {tipo === 'SALIDA' && (
          <>
            <Field label="Máquina de destino">
              <select className={inputClass} value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                <option value="">—</option>
                {refs.machines.filter((m) => m.status !== 'BAJA').map((m) => (
                  <option key={m.id} value={m.id}>{m.codigo} · {m.descripcion}</option>
                ))}
              </select>
            </Field>
            <Field label="Obra de destino" hint="Si no es para una máquina puntual.">
              <select className={inputClass} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
                <option value="">—</option>
                {refs.worksites.filter((w) => w.activa).map((w) => (
                  <option key={w.id} value={w.id}>{w.codigo} · {w.nombre}</option>
                ))}
              </select>
            </Field>
            {orders.length > 0 && (
              <Field label="Orden de servicio" hint="Opcional: enlaza la salida con el servicio.">
                <select className={inputClass} value={serviceOrderId} onChange={(e) => setServiceOrderId(e.target.value)}>
                  <option value="">Sin orden</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>Nº {o.numero} · {o.tipo}</option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}

        {tipo === 'ENTRADA' && (
          <div className="sm:col-span-3">
            <Field label="Proveedor">
              <SupplierPicker suppliers={refs.suppliers} value={supplierId} onChange={setSupplierId} onCreated={reloadRefs} />
            </Field>
          </div>
        )}
        {tipo === 'AJUSTE' && (
          <div className="sm:col-span-3">
            <Field label="Motivo del ajuste" hint="Obligatorio. Usá cantidad negativa para restar. Un ajuste positivo entra al costo promedio si no indicás costo.">
              <input className={inputClass} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Conteo físico, rotura, devolución, etc." />
            </Field>
          </div>
        )}
        {tipo === 'SALDO_INICIAL' && (
          <div className="sm:col-span-3 text-xs text-slate-500">El saldo inicial se carga una vez por artículo, con el conteo físico y su costo unitario.</div>
        )}
      </div>

      <div className="space-y-3">
        <div className={cx('hidden gap-2 text-xs font-medium text-slate-500 sm:grid', showCost ? 'sm:grid-cols-[1fr_7rem_8rem_2rem]' : 'sm:grid-cols-[1fr_7rem_2rem]')}>
          <span>Artículo</span>
          <span>Cantidad</span>
          {showCost && <span>{costRequired ? 'Costo unitario' : 'Costo unit. (opcional)'}</span>}
          <span />
        </div>
        {lines.map((l, i) => {
          const article = refs.articles.find((a) => a.id === l.articleId);
          return (
            <div key={i} className={cx('grid items-start gap-2', showCost ? 'sm:grid-cols-[1fr_7rem_8rem_2rem]' : 'sm:grid-cols-[1fr_7rem_2rem]')}>
              <ArticlePicker articles={refs.articles} value={l.articleId} onChange={(id) => patchLine(i, { articleId: id })} listId={`stock-articles-${i}`} showBalance={tipo !== 'ENTRADA' && tipo !== 'SALDO_INICIAL'} />
              <div className="flex items-center gap-1">
                <input type="number" step="any" className={cx(inputClass, 'text-right')} placeholder="Cant." value={l.cantidad} onChange={(e) => patchLine(i, { cantidad: e.target.value })} />
                <span className="w-8 text-xs text-slate-500">{article ? UNIT_LABEL[article.unidad] : ''}</span>
              </div>
              {showCost && <input type="number" step="any" min="0" className={cx(inputClass, 'text-right')} placeholder="Costo" value={l.costo} onChange={(e) => patchLine(i, { costo: e.target.value })} />}
              <button type="button" onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar renglón">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setLines((prev) => [...prev, emptyLine()])}>Agregar artículo</Button>
      </div>

      <Field label="Observaciones"><input className={inputClass} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></Field>

      {errors.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
    </Modal>
  );
};
