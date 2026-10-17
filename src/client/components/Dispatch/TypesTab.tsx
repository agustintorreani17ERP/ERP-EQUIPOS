/**
 * @file components/Dispatch/TypesTab.tsx
 * @description Catálogo de tipos de documento para los renglones manuales de una nota a oficina.
 * «Cargar tipos predeterminados» trae los del Access sin los de recursos humanos.
 */

import React, { useState } from 'react';
import { Download, Plus } from 'lucide-react';
import type { DocumentTypeDto } from '../../../shared/dispatch';
import { dispatchApi } from '../../services/dispatchApi';
import { describeError } from '../../services/http';
import { Button, Card, EmptyState, Field, Modal, StatusPill, inputClass } from '../../ui';
import type { DispatchRefs } from './common';

export const TypesTab: React.FC<{ refs: DispatchRefs; reload: () => void }> = ({ refs, reload }) => {
  const [editing, setEditing] = useState<DocumentTypeDto | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDefaults = async () => {
    setError(null);
    try {
      await dispatchApi.loadDefaultDocumentTypes();
      reload();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card
        title="Tipos de documento"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={loadDefaults}>Cargar tipos predeterminados</Button>
            <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Nuevo tipo</Button>
          </div>
        }
        padded={false}
      >
        {refs.documentTypes.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No hay tipos de documento"
              help="Sirven para los documentos manuales de una nota (factura, remisión, recibo, sobre de obra…). Los pedidos, recepciones, SF y rendiciones no los necesitan."
              action={<Button variant="primary" onClick={loadDefaults}>Cargar tipos predeterminados</Button>}
            />
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Código</th>
                <th className="px-4 py-2.5">Nombre</th>
                <th className="px-4 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {refs.documentTypes.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(t)}>
                  <td className="px-4 py-2.5 font-mono">{t.codigo}</td>
                  <td className="px-4 py-2.5">{t.nombre}</td>
                  <td className="px-4 py-2.5"><StatusPill tone={t.activo ? 'good' : 'neutral'}>{t.activo ? 'Activo' : 'Inactivo'}</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {editing && (
        <TypeForm
          type={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
};

const TypeForm: React.FC<{ type?: DocumentTypeDto; onClose: () => void; onSaved: () => void }> = ({ type, onClose, onSaved }) => {
  const [codigo, setCodigo] = useState(type?.codigo ?? '');
  const [nombre, setNombre] = useState(type?.nombre ?? '');
  const [activo, setActivo] = useState(type?.activo ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!codigo.trim() || !nombre.trim()) {
      setError('Ingresá código y nombre.');
      return;
    }
    try {
      const draft = { codigo: codigo.trim().toUpperCase(), nombre: nombre.trim(), activo };
      if (type) await dispatchApi.updateDocumentType(type.id, draft);
      else await dispatchApi.createDocumentType(draft);
      onSaved();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Modal
      title={type ? 'Editar tipo de documento' : 'Nuevo tipo de documento'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save}>Guardar</Button>
        </>
      }
    >
      <Field label="Código"><input className={inputClass} value={codigo} onChange={(e) => setCodigo(e.target.value)} /></Field>
      <Field label="Nombre"><input className={inputClass} value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />Activo</label>
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
    </Modal>
  );
};
