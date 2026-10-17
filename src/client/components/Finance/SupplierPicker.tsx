/**
 * @file components/Finance/SupplierPicker.tsx
 * @description Selector de proveedor con alta rápida: si el proveedor no existe se crea sin salir
 * del formulario (en el Access había que abrir otra pantalla y volver).
 */

import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { describeError } from '../../services/http';
import { mastersApi, type Supplier } from '../../services/mastersApi';
import { Button, inputClass } from '../../ui';

export const SupplierPicker: React.FC<{
  suppliers: Supplier[];
  value: string;
  onChange: (supplierId: string) => void;
  /** Se llama con el proveedor recién creado para que el padre actualice su lista. */
  onCreated: (supplier: Supplier) => void;
  disabled?: boolean;
}> = ({ suppliers, value, onChange, onCreated, disabled }) => {
  const [creating, setCreating] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!codigo.trim() || !nombre.trim()) {
      setError('Ingresá código y nombre.');
      return;
    }
    try {
      const created = await mastersApi.createSupplier({ codigo: codigo.trim(), nombre: nombre.trim() });
      onCreated(created);
      onChange(created.id);
      setCreating(false);
      setCodigo('');
      setNombre('');
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select className={inputClass} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">Elegí un proveedor</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.codigo} · {s.nombre}</option>
          ))}
        </select>
        {!disabled && (
          <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating((c) => !c)}>
            Nuevo
          </Button>
        )}
      </div>
      {creating && (
        <div className="grid grid-cols-[6rem_1fr_auto] gap-2">
          <input className={inputClass} placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          <input className={inputClass} placeholder="Nombre del proveedor" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Button variant="primary" onClick={create}>Crear</Button>
        </div>
      )}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
};
