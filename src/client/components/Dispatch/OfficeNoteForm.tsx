/**
 * @file components/Dispatch/OfficeNoteForm.tsx
 * @description Alta y edición de una nota a oficina. Los pedidos, recepciones, SF y rendiciones se
 * eligen de «pendientes de enviar» (quedan enlazados y no se pueden enviar dos veces); los demás
 * documentos (factura, remisión, recibo, sobre de obra…) se cargan a mano con su tipo.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { formatDocNumber } from '../../../shared/finance';
import { Plus, Trash2 } from 'lucide-react';
import {
  OFFICE_LINE_KIND_LABEL,
  type OfficeLineKind,
  type OfficeNoteDto,
  type PendingDocumentDto,
  type PendingDocumentsDto,
} from '../../../shared/dispatch';
import { dispatchApi } from '../../services/dispatchApi';
import { ApiError, describeError } from '../../services/http';
import type { Supplier } from '../../services/mastersApi';
import { formatDate, todayIso } from '../../utils/format';
import { Button, Field, Modal, inputClass } from '../../ui';
import { SupplierPicker } from '../Finance/SupplierPicker';
import { KIND_SHORT, OLD_PENDING_DAYS, type DispatchRefs } from './common';

type LinkedKind = Exclude<OfficeLineKind, 'MANUAL'>;

interface Selected {
  kind: LinkedKind;
  documentId: string;
  label: string;
}

interface ManualDraft {
  key: number;
  documentTypeId: string;
  numero: string;
  supplierId: string;
  fechaDocumento: string;
  machineCodigo: string;
  observacion: string;
}

const keyOf = (kind: string, id: string) => `${kind}:${id}`;

const labelOf = (kind: LinkedKind, numero: number | string, supplier: string | null | undefined) =>
  `${KIND_SHORT[kind]} N.º ${numero}${supplier ? ` · ${supplier}` : ''}`;

let manualSeq = 0;
const emptyManual = (): ManualDraft => ({
  key: ++manualSeq,
  documentTypeId: '',
  numero: '',
  supplierId: '',
  fechaDocumento: '',
  machineCodigo: '',
  observacion: '',
});

export const OfficeNoteForm: React.FC<{
  refs: DispatchRefs;
  onSupplierCreated: (supplier: Supplier) => void;
  /** Nota que se edita; sin ella es una nota nueva. */
  note?: OfficeNoteDto;
  /** Pendientes ya elegidos en la pestaña «Pendientes de enviar». */
  preselected?: PendingDocumentDto[];
  onClose: () => void;
  onSaved: (note: OfficeNoteDto) => void;
}> = ({ refs, onSupplierCreated, note, preselected = [], onClose, onSaved }) => {
  const [fecha, setFecha] = useState(note?.fecha ?? todayIso());
  const [observaciones, setObservaciones] = useState(note?.observaciones ?? '');
  const [selected, setSelected] = useState<Map<string, Selected>>(() => {
    const map = new Map<string, Selected>();
    for (const l of note?.lines ?? []) {
      if (l.kind !== 'MANUAL' && l.documentId) {
        map.set(keyOf(l.kind, l.documentId), { kind: l.kind, documentId: l.documentId, label: labelOf(l.kind, l.numero ?? '?', l.supplier?.nombre) });
      }
    }
    for (const p of preselected) map.set(keyOf(p.kind, p.id), { kind: p.kind, documentId: p.id, label: labelOf(p.kind, formatDocNumber(p.numero, p.anio), p.supplier?.nombre) });
    return map;
  });
  const [manual, setManual] = useState<ManualDraft[]>(() =>
    (note?.lines ?? [])
      .filter((l) => l.kind === 'MANUAL')
      .map((l) => ({
        key: ++manualSeq,
        documentTypeId: l.documentTypeId ?? '',
        numero: l.numero ?? '',
        supplierId: l.supplier?.id ?? '',
        fechaDocumento: l.fechaDocumento ?? '',
        machineCodigo: l.machine?.codigo ?? '',
        observacion: l.observacion ?? '',
      })),
  );
  const [pending, setPending] = useState<PendingDocumentsDto | null>(null);
  const [desde, setDesde] = useState('');
  const [kindFilter, setKindFilter] = useState<LinkedKind | ''>('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dispatchApi
      .pending(desde || undefined)
      .then(setPending)
      .catch((err) => setErrors([describeError(err)]));
  }, [desde]);

  const toggle = (item: PendingDocumentDto) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const key = keyOf(item.kind, item.id);
      if (next.has(key)) next.delete(key);
      else next.set(key, { kind: item.kind, documentId: item.id, label: labelOf(item.kind, formatDocNumber(item.numero, item.anio), item.supplier?.nombre) });
      return next;
    });
  };

  const visiblePending = useMemo(
    () => (pending?.items ?? []).filter((i) => !kindFilter || i.kind === kindFilter),
    [pending, kindFilter],
  );

  const patchManual = (key: number, patch: Partial<ManualDraft>) =>
    setManual((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const total = selected.size + manual.length;

  const save = async () => {
    setErrors([]);
    const machineErrors: string[] = [];
    const lines = [
      ...[...selected.values()].map((s) => ({ kind: s.kind, documentId: s.documentId })),
      ...manual.map((m, i) => {
        const machine = m.machineCodigo.trim() ? refs.machines.find((x) => x.codigo === m.machineCodigo.trim()) : undefined;
        if (m.machineCodigo.trim() && !machine) machineErrors.push(`Documento manual ${i + 1}: la máquina «${m.machineCodigo}» no existe.`);
        return {
          kind: 'MANUAL' as const,
          documentTypeId: m.documentTypeId || null,
          numero: m.numero.trim() || null,
          supplierId: m.supplierId || null,
          fechaDocumento: m.fechaDocumento || null,
          machineId: machine?.id ?? null,
          observacion: m.observacion.trim() || null,
        };
      }),
    ];
    if (machineErrors.length > 0) {
      setErrors(machineErrors);
      return;
    }
    setSaving(true);
    try {
      const draft = { fecha, observaciones: observaciones.trim() || null, lines };
      onSaved(note ? await dispatchApi.updateOfficeNote(note.id, draft) : await dispatchApi.createOfficeNote(draft));
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    } finally {
      setSaving(false);
    }
  };

  const activeTypes = refs.documentTypes.filter((t) => t.activo);

  return (
    <Modal
      title={note ? `Editar nota a oficina N.º ${note.numero}` : 'Nueva nota a oficina'}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={saving || total === 0}>
            {saving ? 'Guardando…' : `Guardar nota (${total} ${total === 1 ? 'documento' : 'documentos'})`}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Fecha de envío"><input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
        <Field label="Observaciones" className="sm:col-span-2"><input className={inputClass} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></Field>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-800">Pendientes de enviar</h4>
          <div className="flex flex-wrap gap-2">
            <select className={inputClass + ' !w-auto'} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as LinkedKind | '')} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              {(['PEDIDO', 'RECEPCION', 'SF', 'RENDICION'] as LinkedKind[]).map((k) => (
                <option key={k} value={k}>{OFFICE_LINE_KIND_LABEL[k]}{pending ? ` (${pending.conteo[k]})` : ''}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Desde
              <input type="date" className={inputClass + ' !w-auto'} value={desde || pending?.desde || ''} onChange={(e) => setDesde(e.target.value)} />
            </label>
          </div>
        </div>
        {[...selected.values()].some((s) => !(pending?.items ?? []).some((i) => keyOf(i.kind, i.id) === keyOf(s.kind, s.documentId))) && (
          <div className="flex flex-wrap gap-2">
            {[...selected.entries()]
              .filter(([key]) => !(pending?.items ?? []).some((i) => keyOf(i.kind, i.id) === key))
              .map(([key, s]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected((prev) => { const next = new Map(prev); next.delete(key); return next; })}
                  className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100"
                  title="Quitar de la nota"
                >
                  {s.label} ✕
                </button>
              ))}
          </div>
        )}
        {!pending ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : visiblePending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            No hay documentos pendientes de enviar desde el {formatDate(pending.desde)}.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2">Máquina</th>
                  <th className="px-3 py-2">Detalle</th>
                  <th className="px-3 py-2 text-right">Días</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visiblePending.map((i) => (
                  <tr key={keyOf(i.kind, i.id)} className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(i)}>
                    <td className="px-3 py-1.5"><input type="checkbox" checked={selected.has(keyOf(i.kind, i.id))} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="px-3 py-1.5 font-medium">{KIND_SHORT[i.kind]} N.º {formatDocNumber(i.numero, i.anio)}</td>
                    <td className="px-3 py-1.5">{formatDate(i.fecha)}</td>
                    <td className="px-3 py-1.5">{i.supplier?.nombre ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{i.machine?.codigo ?? ''}</td>
                    <td className="max-w-48 truncate px-3 py-1.5 text-slate-500">{i.detalle ?? ''}</td>
                    <td className={`px-3 py-1.5 text-right font-mono ${i.dias > OLD_PENDING_DAYS ? 'font-semibold text-amber-700' : ''}`}>{i.dias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-800">Otros documentos (manuales)</h4>
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setManual((rows) => [...rows, emptyManual()])}>Agregar documento</Button>
        </div>
        {manual.length === 0 && <p className="text-sm text-slate-500">Facturas, remisiones, recibos, sobres de obra y todo lo que no sea un pedido, recepción, SF o rendición.</p>}
        {manual.map((m, i) => (
          <div key={m.key} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-6">
            <Field label="Tipo">
              <select className={inputClass} value={m.documentTypeId} onChange={(e) => patchManual(m.key, { documentTypeId: e.target.value })}>
                <option value="">Elegir…</option>
                {activeTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Número"><input className={inputClass} value={m.numero} onChange={(e) => patchManual(m.key, { numero: e.target.value })} /></Field>
            <Field label="Proveedor (opcional)" className="sm:col-span-2">
              <SupplierPicker suppliers={refs.suppliers} value={m.supplierId} onChange={(id) => patchManual(m.key, { supplierId: id })} onCreated={onSupplierCreated} />
            </Field>
            <Field label="Fecha del documento"><input type="date" className={inputClass} value={m.fechaDocumento} onChange={(e) => patchManual(m.key, { fechaDocumento: e.target.value })} /></Field>
            <Field label="Máquina">
              <input className={inputClass} list="dispatch-machines" value={m.machineCodigo} onChange={(e) => patchManual(m.key, { machineCodigo: e.target.value })} placeholder="Código" />
            </Field>
            <Field label="Observación" className="sm:col-span-5"><input className={inputClass} value={m.observacion} onChange={(e) => patchManual(m.key, { observacion: e.target.value })} /></Field>
            <div className="flex items-end justify-end">
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setManual((rows) => rows.filter((r) => r.key !== m.key))} aria-label={`Quitar documento ${i + 1}`}>Quitar</Button>
            </div>
          </div>
        ))}
        <datalist id="dispatch-machines">
          {refs.machines.map((x) => (
            <option key={x.id} value={x.codigo}>{x.descripcion}</option>
          ))}
        </datalist>
      </section>

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
