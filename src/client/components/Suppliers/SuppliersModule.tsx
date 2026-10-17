/**
 * @file components/Suppliers/SuppliersModule.tsx
 * @description Proveedores: directorio con búsqueda, estado de cuenta por moneda y pagos, deuda por
 * proveedor y obras. Todo sale de la API; la deuda es cargos (SF y caja chica a crédito) menos pagos.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Search, Users } from 'lucide-react';
import type { CompanySettings } from '../../../shared/erp';
import { formatCurrency } from '../../../shared/calculations';
import { describeError } from '../../services/http';
import { financeApi, type DebtReport } from '../../services/financeApi';
import { mastersApi, type Supplier, type Worksite } from '../../services/mastersApi';
import { Button, Card, EmptyState, Field, Page, PageHeader, cx, inputClass } from '../../ui';
import { SupplierDetail } from './SupplierDetail';

type Tab = 'PROVEEDORES' | 'DEUDA' | 'OBRAS';
const TAB_LABEL: Record<Tab, string> = { PROVEEDORES: 'Proveedores', DEUDA: 'Deuda', OBRAS: 'Obras' };

export const SuppliersModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>('PROVEEDORES');
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Supplier | 'NUEVO' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    mastersApi
      .settings()
      .then(setSettings)
      .catch((err) => setError(describeError(err)));
  }, []);

  useEffect(() => {
    setError(null);
    mastersApi
      .suppliers(search.trim() || undefined)
      .then(setSuppliers)
      .catch((err) => setError(describeError(err)));
  }, [search, reloadKey]);

  return (
    <Page>
      <PageHeader
        title="Proveedores"
        help="La cuenta de cada proveedor suma las SF y los gastos de caja chica a crédito, y resta los pagos registrados."
        actions={
          <>
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
              {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cx(
                    'whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition',
                    tab === t ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>
            {tab === 'PROVEEDORES' && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setSelected('NUEVO')}>Nuevo proveedor</Button>}
          </>
        }
      />

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {tab === 'PROVEEDORES' && (
        <Card padded={false}>
          <div className="border-b border-slate-100 p-4">
            <Field label="Buscar">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <input className={cx(inputClass, 'pl-8')} placeholder="Código, nombre o RUC" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </Field>
          </div>
          {suppliers === null ? (
            <div className="p-6 text-sm text-slate-500">Cargando proveedores…</div>
          ) : suppliers.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<Users className="h-6 w-6" />} title="No hay proveedores" help="Creá el primero o cambiá la búsqueda." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Código</th>
                    <th className="px-4 py-2.5">Nombre</th>
                    <th className="px-4 py-2.5">RUC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {suppliers.map((s) => (
                    <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(s)}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{s.codigo}</td>
                      <td className="px-4 py-2.5">{s.nombre}</td>
                      <td className="px-4 py-2.5 text-slate-600">{s.ruc ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'DEUDA' && <DebtView onOpen={(id) => { const s = suppliers?.find((x) => x.id === id); if (s) setSelected(s); }} />}
      {tab === 'OBRAS' && <WorksitesView />}

      {selected && settings && (
        <SupplierDetail
          supplier={selected === 'NUEVO' ? null : selected}
          settings={settings}
          onClose={() => setSelected(null)}
          onSaved={reload}
        />
      )}
    </Page>
  );
};

/* ─── Deuda por proveedor ──────────────────────────────────────────────── */

const DebtView: React.FC<{ onOpen: (supplierId: string) => void }> = ({ onOpen }) => {
  const [report, setReport] = useState<DebtReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    financeApi
      .debt()
      .then(setReport)
      .catch((err) => setError(describeError(err)));
  }, []);

  return (
    <Card padded={false} title="Deuda por proveedor">
      {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
      {report === null ? (
        <div className="p-6 text-sm text-slate-500">Calculando…</div>
      ) : report.items.length === 0 ? (
        <div className="p-6 text-sm text-slate-500">No hay saldos pendientes con proveedores.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-6 border-b border-slate-100 px-5 py-3 text-sm">
            {(Object.entries(report.totales) as [string, number][]).map(([currency, total]) => (
              <div key={currency}>Total {currency} <span className="font-semibold text-slate-900">{formatCurrency(total, currency)}</span></div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Proveedor</th>
                  <th className="px-4 py-2.5">Moneda</th>
                  <th className="px-4 py-2.5 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.items.map((i) => (
                  <tr key={`${i.supplier.id}-${i.currency}`} className="cursor-pointer hover:bg-slate-50" onClick={() => onOpen(i.supplier.id)}>
                    <td className="px-4 py-2.5">{i.supplier.codigo} · {i.supplier.nombre}</td>
                    <td className="px-4 py-2.5">{i.currency}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(i.saldo, i.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
};

/* ─── Obras ────────────────────────────────────────────────────────────── */

const WorksitesView: React.FC = () => {
  const [worksites, setWorksites] = useState<Worksite[] | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    mastersApi
      .worksites()
      .then(setWorksites)
      .catch((err) => setError(describeError(err)));
  }, [reloadKey]);

  const create = async () => {
    if (!codigo.trim() || !nombre.trim()) {
      setError('Ingresá código y nombre de la obra.');
      return;
    }
    try {
      await mastersApi.createWorksite({ codigo: codigo.trim(), nombre: nombre.trim() });
      setCodigo('');
      setNombre('');
      setError(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Card padded={false} title="Obras">
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[8rem_1fr_auto]">
        <input className={inputClass} placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        <input className={inputClass} placeholder="Nombre de la obra" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={create}>Agregar obra</Button>
      </div>
      {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
      {worksites === null ? (
        <div className="p-6 text-sm text-slate-500">Cargando obras…</div>
      ) : worksites.length === 0 ? (
        <div className="p-6">
          <EmptyState icon={<Building2 className="h-6 w-6" />} title="No hay obras" help="Las obras se usan en pedidos y partes diarios." />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {worksites.map((w) => (
            <li key={w.id} className="flex items-center justify-between px-5 py-2.5">
              <span><span className="font-mono font-semibold">{w.codigo}</span> · {w.nombre}</span>
              {!w.activa && <span className="text-xs text-slate-400">Inactiva</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
