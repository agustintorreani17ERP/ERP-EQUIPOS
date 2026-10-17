/**
 * @file components/Dispatch/IncomingTab.tsx
 * @description Notas que la oficina central o una obra le mandan al Taller (llegan desde el ERP). El Taller
 * las recibe acá: al registrar el recibido, el ERP se entera y la nota de origen pasa a «Recibida».
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { DispatchState } from '../../../shared/dispatch';
import { incomingApi, type IncomingNoteDto } from '../../services/dispatchApi';
import { ApiError, describeError } from '../../services/http';
import { formatDate, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Modal, StatusPill, inputClass } from '../../ui';
import { STATE_LABEL, STATE_TONE } from './common';

const ORIGEN_LABEL: Record<string, string> = { OFICINA: 'Oficina central', OBRA: 'Obra', TALLER: 'Taller' };

export const IncomingTab: React.FC<{ version: number; onChanged: () => void }> = ({ version, onChanged }) => {
  const [notes, setNotes] = useState<IncomingNoteDto[] | null>(null);
  const [estado, setEstado] = useState<DispatchState | ''>('ENVIADA');
  const [selected, setSelected] = useState<IncomingNoteDto | null>(null);
  const [fecha, setFecha] = useState(todayIso());
  const [recibidoPor, setRecibidoPor] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    incomingApi
      .list(estado || undefined)
      .then((r) => {
        setNotes(r);
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [estado]);

  useEffect(load, [load, version]);

  const open = (n: IncomingNoteDto) => {
    setSelected(n);
    setFecha(todayIso() < n.fecha ? n.fecha : todayIso());
    setRecibidoPor('');
    setErrors([]);
  };

  const acknowledge = async () => {
    if (!selected) return;
    setErrors([]);
    try {
      await incomingApi.acknowledge(selected.id, { fecha, recibidoPor: recibidoPor.trim() });
      setSelected(null);
      onChanged();
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    }
  };

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card title="Notas que llegan al Taller" padded={false}>
        <div className="border-b border-slate-100 p-4 sm:w-64">
          <Field label="Estado">
            <select className={inputClass} value={estado} onChange={(e) => setEstado(e.target.value as DispatchState | '')}>
              <option value="">Todas</option>
              {(Object.keys(STATE_LABEL) as DispatchState[]).map((s) => (
                <option key={s} value={s}>{STATE_LABEL[s]}</option>
              ))}
            </select>
          </Field>
        </div>
        {notes === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : notes.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={estado === 'ENVIADA' ? 'No hay notas por recibir' : 'No hay notas'}
              help="Las notas que la oficina o una obra manden al Taller aparecen acá, con el mismo número que les dio el ERP."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">N.º</th>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Origen</th>
                  <th className="px-4 py-2.5">Chofer</th>
                  <th className="px-4 py-2.5 text-right">Renglones</th>
                  <th className="px-4 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notes.map((n) => (
                  <tr key={n.id} className="cursor-pointer hover:bg-slate-50" onClick={() => open(n)}>
                    <td className="px-4 py-2.5 font-mono font-semibold">{n.etiqueta}</td>
                    <td className="px-4 py-2.5">{formatDate(n.fecha)}</td>
                    <td className="px-4 py-2.5">{ORIGEN_LABEL[n.origenTipo] ?? n.origenTipo}</td>
                    <td className="px-4 py-2.5 text-slate-600">{n.chofer ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{n.lineas.length}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={STATE_TONE[n.estado]}>{STATE_LABEL[n.estado]}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <Modal title={`Nota ${selected.etiqueta}`} onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <div className="grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
              <div>Fecha: <span className="text-slate-900">{formatDate(selected.fecha)}</span></div>
              <div>Origen: <span className="text-slate-900">{ORIGEN_LABEL[selected.origenTipo] ?? selected.origenTipo}</span></div>
              <div>Contenido: <span className="text-slate-900">{selected.contenido === 'MATERIALES' ? 'Materiales' : 'Documentos'}</span></div>
              <div>Chofer: <span className="text-slate-900">{selected.chofer ?? '—'}</span></div>
            </div>
            {selected.observaciones && <p className="text-sm text-slate-600">{selected.observaciones}</p>}
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              {selected.lineas.map((l, i) => (
                <li key={`${l.descripcion}-${i}`} className="flex justify-between gap-3 px-3 py-2">
                  <span>{l.descripcion}</span>
                  {l.cantidad != null && <span className="font-mono text-slate-600">{l.cantidad} {l.unidad ?? ''}</span>}
                </li>
              ))}
            </ul>

            {selected.estado === 'ENVIADA' && (
              <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-medium text-emerald-900">Registrar recibido</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Fecha de recibido"><input type="date" className={inputClass} value={fecha} min={selected.fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
                  <Field label="Recibió"><input className={inputClass} value={recibidoPor} onChange={(e) => setRecibidoPor(e.target.value)} placeholder="Nombre de quien firmó" /></Field>
                </div>
                <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} onClick={acknowledge}>Confirmar</Button>
              </div>
            )}
            {selected.estado === 'RECIBIDA' && (
              <p className="text-sm text-emerald-700">Recibida el {formatDate(selected.recibidoFecha!)} por {selected.recibidoPor}.</p>
            )}
            {selected.estado === 'ANULADA' && <p className="text-sm text-rose-700">Anulada: {selected.anuladoMotivo}</p>}
            {errors.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errors.map((e) => <div key={e}>{e}</div>)}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
