/**
 * @file components/Fuel/CatalogTab.tsx
 * @description Productos (gasoil, lubricantes, grasas y lo que se agregue) y depósitos (obras,
 * cisternas y otros tanques) de los que sale y a los que entra el combustible.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Tags } from 'lucide-react';
import type { FuelDepositDto, FuelProductDto } from '../../../shared/fuel';
import { describeError } from '../../services/http';
import { fuelApi, type DepositDraft, type ProductDraft } from '../../services/fuelApi';
import { mastersApi, type Worksite } from '../../services/mastersApi';
import { Button, Card, EmptyState, StatusPill, inputClass } from '../../ui';
import { DEPOSIT_TYPE_LABEL, UNIT_LABEL, type FuelRefs } from './common';

const CATEGORY_LABEL = { COMBUSTIBLE: 'Combustible', LUBRICANTE: 'Lubricante', GRASA: 'Grasa', OTRO: 'Otro' } as const;

export const CatalogTab: React.FC<{ refs: FuelRefs; reload: () => void }> = ({ refs, reload }) => {
  const [error, setError] = useState<string | null>(null);
  const [worksites, setWorksites] = useState<Worksite[]>([]);

  useEffect(() => {
    mastersApi
      .worksites()
      .then(setWorksites)
      .catch((err) => setError(describeError(err)));
  }, []);

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <ProductsCard products={refs.products} guard={guard} />
      <DepositsCard deposits={refs.deposits} machines={refs.machines} worksites={worksites} guard={guard} />
    </div>
  );
};

type Guard = (fn: () => Promise<void>) => Promise<void>;

const ProductsCard: React.FC<{ products: FuelProductDto[]; guard: Guard }> = ({ products, guard }) => {
  const [draft, setDraft] = useState<ProductDraft>({ codigo: '', nombre: '', unidad: 'L', categoria: 'LUBRICANTE', activo: true });

  return (
    <Card
      title="Productos"
      padded={false}
      action={
        products.length === 0 ? (
          <Button variant="secondary" icon={<Tags className="h-4 w-4" />} onClick={() => guard(async () => void (await fuelApi.loadDefaultProducts()))}>
            Cargar productos predeterminados
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[8rem_1fr_6rem_9rem_auto]">
        <input className={inputClass} placeholder="Código" value={draft.codigo} onChange={(e) => setDraft({ ...draft, codigo: e.target.value })} />
        <input className={inputClass} placeholder="Nombre" value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} />
        <select className={inputClass} value={draft.unidad} onChange={(e) => setDraft({ ...draft, unidad: e.target.value as ProductDraft['unidad'] })}>
          <option value="L">Litros</option>
          <option value="KG">Kilos</option>
          <option value="U">Unidades</option>
        </select>
        <select className={inputClass} value={draft.categoria} onChange={(e) => setDraft({ ...draft, categoria: e.target.value as ProductDraft['categoria'] })}>
          {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => guard(async () => { await fuelApi.createProduct(draft); setDraft({ ...draft, codigo: '', nombre: '' }); })}>
          Agregar
        </Button>
      </div>
      {products.length === 0 ? (
        <div className="p-6"><EmptyState title="No hay productos" help="Cargá los predeterminados (gasoil y lubricantes) o creá los tuyos." /></div>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-5 py-2.5">
              <span><span className="font-mono font-semibold">{p.codigo}</span> · {p.nombre} <span className="text-slate-400">({UNIT_LABEL[p.unidad]})</span></span>
              <span className="flex items-center gap-3">
                <StatusPill tone="neutral">{CATEGORY_LABEL[p.categoria]}</StatusPill>
                <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => guard(async () => void (await fuelApi.updateProduct(p.id, { codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, categoria: p.categoria, activo: !p.activo })))}>
                  {p.activo ? 'Desactivar' : 'Activar'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

const DepositsCard: React.FC<{ deposits: FuelDepositDto[]; machines: FuelRefs['machines']; worksites: Worksite[]; guard: Guard }> = ({ deposits, machines, worksites, guard }) => {
  const [draft, setDraft] = useState<DepositDraft>({ codigo: '', nombre: '', tipo: 'OBRA', worksiteId: null, machineId: null, activo: true });

  return (
    <Card title="Depósitos" padded={false}>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[8rem_1fr_8rem_1fr_1fr_auto]">
        <input className={inputClass} placeholder="Código" value={draft.codigo} onChange={(e) => setDraft({ ...draft, codigo: e.target.value })} />
        <input className={inputClass} placeholder="Nombre (obra, cisterna…)" value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} />
        <select className={inputClass} value={draft.tipo} onChange={(e) => setDraft({ ...draft, tipo: e.target.value as DepositDraft['tipo'] })}>
          {(Object.keys(DEPOSIT_TYPE_LABEL) as (keyof typeof DEPOSIT_TYPE_LABEL)[]).map((t) => (
            <option key={t} value={t}>{DEPOSIT_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <select className={inputClass} value={draft.worksiteId ?? ''} onChange={(e) => setDraft({ ...draft, worksiteId: e.target.value || null })}>
          <option value="">Sin obra</option>
          {worksites.map((w) => (
            <option key={w.id} value={w.id}>{w.nombre}</option>
          ))}
        </select>
        <select className={inputClass} value={draft.machineId ?? ''} onChange={(e) => setDraft({ ...draft, machineId: e.target.value || null })}>
          <option value="">Sin máquina</option>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>{m.codigo} · {m.descripcion}</option>
          ))}
        </select>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => guard(async () => { await fuelApi.createDeposit(draft); setDraft({ ...draft, codigo: '', nombre: '' }); })}>
          Agregar
        </Button>
      </div>
      {deposits.length === 0 ? (
        <div className="p-6"><EmptyState title="No hay depósitos" help="Un depósito puede ser una obra, un camión cisterna o cualquier tanque." /></div>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {deposits.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-5 py-2.5">
              <span>
                <span className="font-mono font-semibold">{d.codigo}</span> · {d.nombre}
                {d.machine && <span className="ml-2 text-slate-500">Máquina {d.machine.codigo}</span>}
                {d.worksite && <span className="ml-2 text-slate-500">Obra {d.worksite.nombre}</span>}
              </span>
              <span className="flex items-center gap-3">
                <StatusPill tone="neutral">{DEPOSIT_TYPE_LABEL[d.tipo]}</StatusPill>
                <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => guard(async () => void (await fuelApi.updateDeposit(d.id, { codigo: d.codigo, nombre: d.nombre, tipo: d.tipo, worksiteId: d.worksite?.id ?? null, machineId: d.machine?.id ?? null, activo: !d.activo })))}>
                  {d.activo ? 'Desactivar' : 'Activar'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
