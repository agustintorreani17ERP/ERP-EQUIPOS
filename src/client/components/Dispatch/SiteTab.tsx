/**
 * @file components/Dispatch/SiteTab.tsx
 * @description Notas a obra: agrupan los partes de «envío de repuestos» con número automático, obra de
 * destino y chofer. Reemplaza los informes ENVIOS A OBRAS y NOTA DE ENVIO del Access, que armaban la
 * nota con un número tipeado en cada parte.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Pencil, Plus, Printer } from 'lucide-react';
import type { DispatchState, SiteNoteDto, SiteNoteEventDto } from '../../../shared/dispatch';
import { dispatchApi } from '../../services/dispatchApi';
import { ApiError, describeError } from '../../services/http';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, todayIso } from '../../utils/format';
import { printArea } from '../../utils/print';
import { Button, Card, EmptyState, Field, Modal, StatusPill, inputClass } from '../../ui';
import { LETTERHEAD_LABEL } from '../Finance/common';
import { STATE_LABEL, STATE_TONE, type DispatchRefs } from './common';
import { NoteActions } from './NoteActions';

export const SiteTab: React.FC<{ refs: DispatchRefs; membrete: string; version: number; onChanged: () => void }> = ({
  refs,
  membrete,
  version,
  onChanged,
}) => {
  const [notes, setNotes] = useState<SiteNoteDto[] | null>(null);
  const [estado, setEstado] = useState<DispatchState | ''>('');
  const [obra, setObra] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    dispatchApi
      .siteNotes({ estado: estado || undefined, obra, desde, hasta })
      .then((r) => {
        setNotes(r);
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [estado, obra, desde, hasta]);

  useEffect(load, [load, version]);

  const exportExcel = () =>
    exportRowsToExcel(
      (notes ?? []).map((n) => ({
        'N.º': n.numero,
        Fecha: formatDate(n.fecha),
        Obra: n.worksite.nombre,
        Chofer: n.chofer ?? '',
        Envíos: n.eventCount,
        Estado: STATE_LABEL[n.estado],
        'Recibió': n.recibidoPor ?? '',
        'Recibido el': n.recibidoFecha ? formatDate(n.recibidoFecha) : '',
      })),
      'Notas a obra',
      `notas-a-obra-${todayIso()}.xlsx`,
    );

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card
        title="Notas a obra (envío de repuestos)"
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
          <Field label="Obra de destino">
            <select className={inputClass} value={obra} onChange={(e) => setObra(e.target.value)}>
              <option value="">Todas</option>
              {refs.worksites.map((w) => (
                <option key={w.id} value={w.id}>{w.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
        </div>
        {notes === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : notes.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No hay notas a obra"
              help="Cargá los envíos de repuestos como partes diarios (tipo «Envío de repuestos») y agrupalos acá en una nota con chofer y obra de destino."
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
                  <th className="px-4 py-2.5">Obra de destino</th>
                  <th className="px-4 py-2.5">Chofer</th>
                  <th className="px-4 py-2.5 text-right">Envíos</th>
                  <th className="px-4 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notes.map((n) => (
                  <tr key={n.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedId(n.id)}>
                    <td className="px-4 py-2.5 font-mono font-semibold">{n.numero}</td>
                    <td className="px-4 py-2.5">{formatDate(n.fecha)}</td>
                    <td className="px-4 py-2.5">{n.worksite.nombre}</td>
                    <td className="px-4 py-2.5 text-slate-600">{n.chofer ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{n.eventCount}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={STATE_TONE[n.estado]}>{STATE_LABEL[n.estado]}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <SiteNoteForm
          refs={refs}
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
        <SiteDetail
          id={selectedId}
          refs={refs}
          letterhead={refs.settings.letterheads[membrete] ?? ''}
          membrete={membrete}
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

const SiteNoteForm: React.FC<{ refs: DispatchRefs; note?: SiteNoteDto; onClose: () => void; onSaved: (note: SiteNoteDto) => void }> = ({
  refs,
  note,
  onClose,
  onSaved,
}) => {
  const [fecha, setFecha] = useState(note?.fecha ?? todayIso());
  const [worksiteId, setWorksiteId] = useState(note?.worksite.id ?? '');
  const [chofer, setChofer] = useState(note?.chofer ?? '');
  const [observaciones, setObservaciones] = useState(note?.observaciones ?? '');
  const [available, setAvailable] = useState<SiteNoteEventDto[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set((note?.events ?? []).map((e) => e.id)));
  const [onlyDestination, setOnlyDestination] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dispatchApi
      .eventsWithoutNote(onlyDestination && worksiteId ? { obra: worksiteId } : {})
      .then(setAvailable)
      .catch((err) => setErrors([describeError(err)]));
  }, [worksiteId, onlyDestination]);

  // Los partes que ya están en esta nota siguen elegibles aunque no figuren como «sin nota».
  const rows = [...(note?.events ?? []).filter((e) => !(available ?? []).some((a) => a.id === e.id)), ...(available ?? [])];
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setErrors([]);
    setSaving(true);
    try {
      const draft = { fecha, worksiteId, chofer: chofer.trim() || null, observaciones: observaciones.trim() || null, eventIds: [...picked] };
      onSaved(note ? await dispatchApi.updateSiteNote(note.id, draft) : await dispatchApi.createSiteNote(draft));
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={note ? `Editar nota a obra N.º ${note.numero}` : 'Nueva nota a obra'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={saving || picked.size === 0 || !worksiteId}>
            {saving ? 'Guardando…' : `Guardar nota (${picked.size} ${picked.size === 1 ? 'envío' : 'envíos'})`}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Fecha"><input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
        <Field label="Obra de destino">
          <select className={inputClass} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
            <option value="">Elegir…</option>
            {refs.worksites.map((w) => (
              <option key={w.id} value={w.id}>{w.nombre}</option>
            ))}
          </select>
        </Field>
        <Field label="Transportado por (chofer)"><input className={inputClass} value={chofer} onChange={(e) => setChofer(e.target.value)} /></Field>
        <Field label="Observaciones" className="sm:col-span-3"><input className={inputClass} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></Field>
      </div>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-800">Envíos de repuestos sin nota</h4>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={onlyDestination} onChange={(e) => setOnlyDestination(e.target.checked)} />
          Solo los de la obra elegida
        </label>
      </div>
      {available === null ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          No hay envíos de repuestos sin nota. Cargalos en Partes diarios con el tipo «Envío de repuestos».
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Máquina</th>
                <th className="px-3 py-2">Descripción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(e.id)}>
                  <td className="px-3 py-1.5"><input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} onClick={(ev) => ev.stopPropagation()} /></td>
                  <td className="px-3 py-1.5">{formatDate(e.fecha)}</td>
                  <td className="px-3 py-1.5"><span className="font-mono font-medium">{e.machine.codigo}</span><span className="ml-2 text-xs text-slate-500">{e.machine.descripcion}</span></td>
                  <td className="px-3 py-1.5">{e.descripcion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

const SiteDetail: React.FC<{
  id: string;
  refs: DispatchRefs;
  letterhead: string;
  membrete: string;
  onClose: () => void;
  onChanged: () => void;
}> = ({ id, refs, letterhead, membrete, onClose, onChanged }) => {
  const [note, setNote] = useState<SiteNoteDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dispatchApi.siteNote(id).then(setNote).catch((err) => setError(describeError(err)));
  }, [id]);

  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(false);
    return restore;
  }, [printing]);

  const update = (next: SiteNoteDto) => {
    setNote(next);
    onChanged();
  };

  if (!note) {
    return (
      <Modal title="Nota a obra" onClose={onClose}>
        <p className="text-sm text-slate-500">{error ?? 'Cargando…'}</p>
      </Modal>
    );
  }

  if (editing) {
    return (
      <SiteNoteForm
        refs={refs}
        note={note}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          update(saved);
        }}
      />
    );
  }

  return (
    <>
      <Modal
        title={`Nota a obra N.º ${note.numero}`}
        size="lg"
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
            <span className="text-slate-500">Enviada el {formatDate(note.fecha)} a {note.worksite.nombre}</span>
            {note.chofer && <span className="text-slate-500">Transporta {note.chofer}</span>}
            {note.recibidoPor && <span className="text-slate-500">Recibió {note.recibidoPor} el {note.recibidoFecha ? formatDate(note.recibidoFecha) : ''}</span>}
          </div>
          {note.anuladoMotivo && <div className="text-rose-700">Anulada: {note.anuladoMotivo}</div>}
          {note.observaciones && <div>Observaciones: {note.observaciones}</div>}
          {note.estado === 'ANULADA' ? (
            <p className="text-slate-500">Al anular la nota, los partes quedaron libres para otra nota.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {(note.events ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-4 px-3 py-2">
                  <span className="w-24 shrink-0 text-slate-500">{formatDate(e.fecha)}</span>
                  <span className="font-mono font-medium">{e.machine.codigo}</span>
                  <span className="text-slate-500">{e.machine.descripcion}</span>
                  <span className="basis-full sm:basis-auto">{e.descripcion}</span>
                </li>
              ))}
            </ul>
          )}
          {note.estado === 'ENVIADA' && (
            <NoteActions
              numero={note.numero}
              fechaEnvio={note.fecha}
              onAcknowledge={async (body) => update(await dispatchApi.acknowledgeSiteNote(note.id, body))}
              onCancel={async (motivo) => update(await dispatchApi.cancelSiteNote(note.id, motivo))}
            />
          )}
        </div>
      </Modal>
      {printing && <PrintableSiteNote note={note} letterhead={letterhead} membrete={membrete} />}
    </>
  );
};

const PrintableSiteNote: React.FC<{ note: SiteNoteDto; letterhead: string; membrete: string }> = ({ note, letterhead, membrete }) => (
  <div className="print-area text-sm text-black">
    <div className="mb-4 flex items-start justify-between border-b border-black pb-2">
      <div>
        <div className="text-lg font-bold">{letterhead || LETTERHEAD_LABEL[membrete]}</div>
        <div>Nota de envío de repuestos</div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold">N.º {note.numero}</div>
        <div>Fecha: {formatDate(note.fecha)}</div>
        {note.estado === 'ANULADA' && <div className="font-bold">ANULADA</div>}
      </div>
    </div>
    <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1">
      <div>De: <b>Taller central</b></div>
      <div>Para: <b>{note.worksite.nombre}</b></div>
      <div>Transportado por: <b>{note.chofer ?? ''}</b></div>
    </div>
    <table className="mb-4 w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="w-24 py-1">Fecha</th>
          <th className="w-24 py-1">Código</th>
          <th className="py-1">Máquina</th>
          <th className="py-1">Descripción del envío</th>
        </tr>
      </thead>
      <tbody>
        {(note.events ?? []).map((e) => (
          <tr key={e.id} className="border-b border-slate-300">
            <td className="py-1">{formatDate(e.fecha)}</td>
            <td className="py-1">{e.machine.codigo}</td>
            <td className="py-1">{e.machine.descripcion}</td>
            <td className="py-1">{e.descripcion}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {note.observaciones && <div className="mb-3">Observaciones: {note.observaciones}</div>}
    <div className="mt-16 grid grid-cols-3 gap-12 text-center">
      <div className="border-t border-black pt-1">Enviado por</div>
      <div className="border-t border-black pt-1">Transportista</div>
      <div className="border-t border-black pt-1">Recibido por (obra) y fecha</div>
    </div>
  </div>
);
