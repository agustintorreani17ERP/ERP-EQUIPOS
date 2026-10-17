/**
 * @file components/Dispatch/NoteActions.tsx
 * @description Acuse de recibo y anulación de una nota de envío (a oficina o a obra), con el mismo
 * panel en línea para las dos. Solo se ofrecen mientras la nota está enviada.
 */

import React, { useState } from 'react';
import { Ban, CheckCircle2 } from 'lucide-react';
import { ApiError, describeError } from '../../services/http';
import { todayIso } from '../../utils/format';
import { Button, Field, inputClass } from '../../ui';

type Mode = 'idle' | 'ack' | 'cancel';

export const NoteActions: React.FC<{
  numero: number;
  fechaEnvio: string;
  onAcknowledge: (body: { fecha: string; recibidoPor: string }) => Promise<void>;
  onCancel: (motivo: string) => Promise<void>;
}> = ({ numero, fechaEnvio, onAcknowledge, onCancel }) => {
  const [mode, setMode] = useState<Mode>('idle');
  const [fecha, setFecha] = useState(todayIso() < fechaEnvio ? fechaEnvio : todayIso());
  const [recibidoPor, setRecibidoPor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const run = async (fn: () => Promise<void>) => {
    setErrors([]);
    try {
      await fn();
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    }
  };

  return (
    <div className="space-y-3">
      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setMode('ack')}>Registrar recibido</Button>
          <Button variant="ghost" icon={<Ban className="h-4 w-4" />} onClick={() => setMode('cancel')}>Anular</Button>
        </div>
      )}
      {mode === 'ack' && (
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-900">Recibido de la nota N.º {numero}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fecha de recibido"><input type="date" className={inputClass} value={fecha} min={fechaEnvio} onChange={(e) => setFecha(e.target.value)} /></Field>
            <Field label="Recibió"><input className={inputClass} value={recibidoPor} onChange={(e) => setRecibidoPor(e.target.value)} placeholder="Nombre de quien firmó" /></Field>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => run(() => onAcknowledge({ fecha, recibidoPor: recibidoPor.trim() }))}>Confirmar</Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>Cancelar</Button>
          </div>
        </div>
      )}
      {mode === 'cancel' && (
        <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-medium text-rose-800">Anular la nota N.º {numero}: los documentos quedan libres para otra nota.</p>
          <div className="flex gap-2">
            <input className={inputClass} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la anulación" />
            <Button variant="danger" onClick={() => run(() => onCancel(motivo.trim()))}>Confirmar</Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>Cancelar</Button>
          </div>
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
  );
};
