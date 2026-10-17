/**
 * @file components/Dispatch/OfficeTab.tsx
 * @description Notas a oficina central: lista, detalle con acuse de recibo y anulación, edición
 * mientras está enviada e impresión con las firmas de «enviado por» y «recibido por». Reemplaza el
 * informe ENVIOS A OFICINA del Access.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Pencil, Plus, Printer } from 'lucide-react';
import { documentAfterDispatch, type OfficeNoteDto, type DispatchState } from '../../../shared/dispatch';
import { dispatchApi } from '../../services/dispatchApi';
import { describeError } from '../../services/http';
import type { Supplier } from '../../services/mastersApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, todayIso } from '../../utils/format';
import { printArea } from '../../utils/print';
import { Button, Card, EmptyState, Field, Modal, StatusPill, inputClass } from '../../ui';
import { LETTERHEAD_LABEL } from '../Finance/common';
import { KIND_SHORT, STATE_LABEL, STATE_TONE, type DispatchRefs } from './common';
import { NoteActions } from './NoteActions';
import { OfficeNoteForm } from './OfficeNoteForm';

export const OfficeTab: React.FC<{
  refs: DispatchRefs;
  membrete: string;
  version: number;
  onSupplierCreated: (supplier: Supplier) => void;
  onChanged: () => void;
}> = ({ refs, membrete, version, onSupplierCreated, onChanged }) => {
  const [notes, setNotes] = useState<OfficeNoteDto[] | null>(null);
  const [estado, setEstado] = useState<DispatchState | ''>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    dispatchApi
      .officeNotes({ estado: estado || undefined, desde, hasta, q })
      .then((r) => {
        setNotes(r);
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [estado, desde, hasta, q]);

  useEffect(load, [load, version]);

  const exportExcel = () =>
    exportRowsToExcel(
      (notes ?? []).map((n) => ({
        'N.º': n.numero,
        Fecha: formatDate(n.fecha),
        Documentos: n.lineCount,
        Estado: STATE_LABEL[n.estado],
        'Recibido el': n.recibidoFecha ? formatDate(n.recibidoFecha) : '',
        'Recibió': n.recibidoPor ?? '',
        Observaciones: n.observaciones ?? '',
      })),
      'Notas a oficina',
      `notas-a-oficina-${todayIso()}.xlsx`,
    );

  const sinAcuse = (notes ?? []).filter((n) => n.estado === 'ENVIADA').length;

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card
        title="Notas a oficina central"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportExcel} disabled={!notes?.length}>Excel</Button>
            <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nueva nota</Button>
          </div>
        }
        padded={false}
      >
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
          <Field label="Estado">
            <select className={inputClass} value={estado} onChange={(e) => setEstado(e.target.value as DispatchState | '')}>
              <option value="">Todos</option>
              {(Object.keys(STATE_LABEL) as DispatchState[]).map((s) => (
                <option key={s} value={s}>{STATE_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="Enviadas desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
          <Field label="Buscar" hint="N.º de nota, de documento u observación"><input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        </div>
        {notes !== null && sinAcuse > 0 && estado === '' && (
          <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {sinAcuse} {sinAcuse === 1 ? 'nota enviada sin acuse de recibo' : 'notas enviadas sin acuse de recibo'}.
          </div>
        )}
        {notes === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : notes.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No hay notas a oficina"
              help="Armá la primera con los documentos pendientes de enviar: pedidos, recepciones, SF y rendiciones se eligen de la lista."
              action={<Button variant="primary" onClick={() => setCreating(true)}>Nueva nota</Button>}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">N.º</th>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5 text-right">Documentos</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5">Recibió</th>
                  <th className="px-4 py-2.5">Observaciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notes.map((n) => (
                  <tr key={n.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedId(n.id)}>
                    <td className="px-4 py-2.5 font-mono font-semibold">{n.numero}</td>
                    <td className="px-4 py-2.5">{formatDate(n.fecha)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{n.lineCount}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={STATE_TONE[n.estado]}>{STATE_LABEL[n.estado]}</StatusPill></td>
                    <td className="px-4 py-2.5 text-slate-600">{n.recibidoPor ? `${n.recibidoPor} · ${n.recibidoFecha ? formatDate(n.recibidoFecha) : ''}` : '—'}</td>
                    <td className="max-w-64 truncate px-4 py-2.5 text-slate-500">{n.observaciones ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <OfficeNoteForm
          refs={refs}
          onSupplierCreated={onSupplierCreated}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            setSelectedId(saved.id);
            load();
            onChanged();
          }}
        />
      )}
      {selectedId && (
        <OfficeDetail
          id={selectedId}
          refs={refs}
          letterhead={refs.settings.letterheads[membrete] ?? ''}
          membrete={membrete}
          onSupplierCreated={onSupplierCreated}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
};

const OfficeDetail: React.FC<{
  id: string;
  refs: DispatchRefs;
  letterhead: string;
  membrete: string;
  onSupplierCreated: (supplier: Supplier) => void;
  onClose: () => void;
  onChanged: () => void;
}> = ({ id, refs, letterhead, membrete, onSupplierCreated, onClose, onChanged }) => {
  const [note, setNote] = useState<OfficeNoteDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dispatchApi.officeNote(id).then(setNote).catch((err) => setError(describeError(err)));
  }, [id]);

  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(false);
    return restore;
  }, [printing]);

  const update = (next: OfficeNoteDto) => {
    setNote(next);
    onChanged();
  };

  if (!note) {
    return (
      <Modal title="Nota a oficina" onClose={onClose}>
        <p className="text-sm text-slate-500">{error ?? 'Cargando…'}</p>
      </Modal>
    );
  }

  if (editing) {
    return (
      <OfficeNoteForm
        refs={refs}
        note={note}
        onSupplierCreated={onSupplierCreated}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          update(saved);
        }}
      />
    );
  }

  const lines = note.lines ?? [];
  return (
    <>
      <Modal
        title={`Nota a oficina N.º ${note.numero}`}
        size="xl"
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => setPrinting(true)}>Imprimir</Button>
              {note.estado === 'ENVIADA' && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Editar</Button>}
            </div>
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill tone={STATE_TONE[note.estado]}>{STATE_LABEL[note.estado]}</StatusPill>
            <span className="text-slate-500">Enviada el {formatDate(note.fecha)}</span>
            {note.recibidoPor && <span className="text-slate-500">Recibió {note.recibidoPor} el {note.recibidoFecha ? formatDate(note.recibidoFecha) : ''}</span>}
          </div>
          {note.anuladoMotivo && <div className="text-rose-700">Anulada: {note.anuladoMotivo}</div>}
          {note.observaciones && <div>Observaciones: {note.observaciones}</div>}
          {note.advertencias?.map((a) => (
            <div key={a} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-amber-900">{a}</div>
          ))}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2">Máquina</th>
                  <th className="px-3 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5 text-slate-400">{l.position}</td>
                    <td className="px-3 py-1.5 font-medium">{l.kind === 'MANUAL' ? `${l.documentTypeNombre ?? 'Documento'} ${l.numero ?? ''}` : `${KIND_SHORT[l.kind]} N.º ${l.numero}`}</td>
                    <td className={`px-3 py-1.5 ${l.fechaDocumento && documentAfterDispatch(l.fechaDocumento, note.fecha) ? 'text-amber-700' : ''}`}>{l.fechaDocumento ? formatDate(l.fechaDocumento) : '—'}</td>
                    <td className="px-3 py-1.5">{l.supplier?.nombre ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{l.machine?.codigo ?? ''}</td>
                    <td className="px-3 py-1.5 text-slate-500">{[l.detalle, l.observacion].filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {note.estado === 'ENVIADA' && (
            <NoteActions
              numero={note.numero}
              fechaEnvio={note.fecha}
              onAcknowledge={async (body) => update(await dispatchApi.acknowledgeOfficeNote(note.id, body))}
              onCancel={async (motivo) => update(await dispatchApi.cancelOfficeNote(note.id, motivo))}
            />
          )}
        </div>
      </Modal>
      {printing && <PrintableOfficeNote note={note} letterhead={letterhead} membrete={membrete} />}
    </>
  );
};

const PrintableOfficeNote: React.FC<{ note: OfficeNoteDto; letterhead: string; membrete: string }> = ({ note, letterhead, membrete }) => (
  <div className="print-area text-sm text-black">
    <div className="mb-4 flex items-start justify-between border-b border-black pb-2">
      <div>
        <div className="text-lg font-bold">{letterhead || LETTERHEAD_LABEL[membrete]}</div>
        <div>Dpto. Control y Mantenimiento de Máquinas</div>
        <div>Nota de envío a oficina central · Enviado por: Taller central</div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold">N.º {note.numero}</div>
        <div>Fecha: {formatDate(note.fecha)}</div>
        {note.estado === 'ANULADA' && <div className="font-bold">ANULADA</div>}
      </div>
    </div>
    <table className="mb-4 w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="w-8 py-1">#</th>
          <th className="py-1">Tipo de documento</th>
          <th className="py-1">N.º de documento</th>
          <th className="py-1">Fecha</th>
          <th className="py-1">Proveedor</th>
          <th className="py-1">Máquina</th>
          <th className="py-1">Obs.</th>
        </tr>
      </thead>
      <tbody>
        {(note.lines ?? []).map((l) => (
          <tr key={l.id} className="border-b border-slate-300">
            <td className="py-1">{l.position}</td>
            <td className="py-1">{l.kind === 'MANUAL' ? (l.documentTypeNombre ?? '') : (KIND_SHORT[l.kind] === 'SF' ? 'Solicitud de fondos' : KIND_SHORT[l.kind])}</td>
            <td className="py-1">{l.numero}{l.detalle && l.kind === 'RECEPCION' ? ` (${l.detalle})` : ''}</td>
            <td className="py-1">{l.fechaDocumento ? formatDate(l.fechaDocumento) : ''}</td>
            <td className="py-1">{l.supplier?.nombre ?? ''}</td>
            <td className="py-1">{l.machine?.codigo ?? ''}</td>
            <td className="py-1">{l.observacion ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {note.observaciones && <div className="mb-3">Observaciones: {note.observaciones}</div>}
    <div className="mt-16 grid grid-cols-3 gap-12 text-center">
      <div className="border-t border-black pt-1">Enviado por</div>
      <div className="border-t border-black pt-1">Recibido por</div>
      <div className="border-t border-black pt-1">Fecha de recibido</div>
    </div>
  </div>
);
