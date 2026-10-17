/**
 * @file components/Maintenance/TypesTab.tsx
 * @description Catálogo de tipos de servicio con sus tareas. Reemplaza el tipo escrito a mano del Access
 * («2000 HS», «00500 HS», «5.000 kmss») y las 12 plantillas de impresión: acá hay un solo tipo por
 * servicio, con tareas editables. «Cargar predeterminados» trae los 6 que el Access usa de verdad.
 */

import React, { useState } from 'react';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { serviceTypeCode, type ServiceTask, type ServiceTypeDto, type ServiceUnit } from '../../../shared/maintenance';
import { ApiError, describeError } from '../../services/http';
import { maintenanceApi } from '../../services/maintenanceApi';
import { Button, Card, EmptyState, Field, Modal, StatusPill, inputClass } from '../../ui';
import { GROUP_LABEL, type MaintenanceRefs } from './common';

const GROUPS = Object.keys(GROUP_LABEL) as ServiceTask['grupo'][];

export const TypesTab: React.FC<{ refs: MaintenanceRefs; onChanged: () => void }> = ({ refs, onChanged }) => {
  const [editing, setEditing] = useState<ServiceTypeDto | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDefaults = async () => {
    try {
      await maintenanceApi.loadDefaultTypes();
      setError(null);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card
        title="Tipos de servicio"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={loadDefaults}>Cargar predeterminados</Button>
            <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Nuevo tipo</Button>
          </div>
        }
        padded={false}
      >
        {refs.types.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Todavía no hay tipos de servicio"
              help="Cargá los predeterminados (250, 500, 1.000 y 2.000 hs, 5.000 y 20.000 km) con las tareas de las plantillas del Access, y después editalos a tu medida."
              action={<Button variant="primary" onClick={loadDefaults}>Cargar predeterminados</Button>}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Código</th>
                  <th className="px-4 py-2.5">Nombre</th>
                  <th className="px-4 py-2.5">Tareas</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {refs.types.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-semibold">{t.codigo}</td>
                    <td className="px-4 py-2.5">{t.nombre}</td>
                    <td className="px-4 py-2.5 text-slate-600">{t.tareas.length}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={t.activo ? 'good' : 'neutral'}>{t.activo ? 'Activo' : 'Inactivo'}</StatusPill></td>
                    <td className="px-4 py-2.5 text-right"><Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(t)}>Editar</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <TypeModal
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
};

const TypeModal: React.FC<{ type: ServiceTypeDto | null; onClose: () => void; onSaved: () => void }> = ({ type, onClose, onSaved }) => {
  const [nombre, setNombre] = useState(type?.nombre ?? '');
  const [valor, setValor] = useState(type ? String(type.valor) : '');
  const [unidad, setUnidad] = useState<ServiceUnit>(type?.unidad ?? 'HS');
  const [activo, setActivo] = useState(type?.activo ?? true);
  const [tareas, setTareas] = useState<ServiceTask[]>(type?.tareas ?? []);
  const [errors, setErrors] = useState<string[]>([]);

  const patch = (i: number, changes: Partial<ServiceTask>) => setTareas((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...changes } : t)));

  const save = async () => {
    const cleaned = tareas.filter((t) => t.descripcion.trim()).map((t) => ({ ...t, descripcion: t.descripcion.trim() }));
    try {
      if (type) await maintenanceApi.updateType(type.id, { nombre, tareas: cleaned, activo });
      else await maintenanceApi.createType({ nombre, valor: Number(valor), unidad, tareas: cleaned });
      onSaved();
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    }
  };

  return (
    <Modal
      title={type ? `Tipo ${type.codigo}` : 'Nuevo tipo de servicio'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save}>Guardar</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nombre"><input className={inputClass} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Servicio de 250 hs" /></Field>
        <Field label="Valor" hint={!type && valor ? `Código: ${serviceTypeCode(Number(valor), unidad)}` : undefined}>
          <input type="number" min="1" className={inputClass} value={valor} disabled={!!type} onChange={(e) => setValor(e.target.value)} />
        </Field>
        <Field label="Unidad">
          <select className={inputClass} value={unidad} disabled={!!type} onChange={(e) => setUnidad(e.target.value as ServiceUnit)}>
            <option value="HS">Horas</option>
            <option value="KM">Kilómetros</option>
          </select>
        </Field>
      </div>
      {type && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          Activo
        </label>
      )}
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600">Tareas (salen en la orden impresa)</p>
        {tareas.map((t, i) => (
          <div key={i} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2">
            <select className={inputClass} value={t.grupo} onChange={(e) => patch(i, { grupo: e.target.value as ServiceTask['grupo'] })}>
              {GROUPS.map((g) => (
                <option key={g} value={g}>{GROUP_LABEL[g]}</option>
              ))}
            </select>
            <input className={inputClass} value={t.descripcion} onChange={(e) => patch(i, { descripcion: e.target.value })} />
            <button type="button" onClick={() => setTareas((prev) => prev.filter((_, idx) => idx !== i))} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar tarea">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setTareas((prev) => [...prev, { grupo: 'CAMBIO', descripcion: '' }])}>Agregar tarea</Button>
      </div>
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
