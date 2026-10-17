/**
 * @file components/Fuel/FuelModule.tsx
 * @description Combustibles y lubricantes: despachos con carga rápida, entradas y ajustes, informes
 * (saldos, consumo, terceros) y catálogos. Reemplaza la tabla ancha ACGAS2012 y sus formularios del
 * Access. Un despacho que deja el saldo del depósito en negativo se guarda y se advierte: arriba de todo
 * aparece el aviso de los saldos negativos vigentes, que casi siempre son entradas sin registrar.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { describeError } from '../../services/http';
import { fleetApi } from '../../services/fleetApi';
import { fuelApi, type BalanceRow } from '../../services/fuelApi';
import { mastersApi } from '../../services/mastersApi';
import { formatQty } from '../../utils/format';
import { Button, Page, PageHeader, cx } from '../../ui';
import { CatalogTab } from './CatalogTab';
import { DispatchesTab } from './DispatchesTab';
import { EntriesTab } from './EntriesTab';
import { ReportsTab } from './ReportsTab';
import type { FuelRefs } from './common';

type Tab = 'DESPACHOS' | 'ENTRADAS' | 'INFORMES' | 'CATALOGOS';
const TAB_LABEL: Record<Tab, string> = {
  DESPACHOS: 'Despachos',
  ENTRADAS: 'Entradas y ajustes',
  INFORMES: 'Informes',
  CATALOGOS: 'Depósitos y productos',
};

export const FuelModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>('DESPACHOS');
  const [refs, setRefs] = useState<FuelRefs | null>(null);
  const [membrete, setMembrete] = useState('ccc');
  const [error, setError] = useState<string | null>(null);
  const [negatives, setNegatives] = useState<BalanceRow[]>([]);

  const loadRefs = useCallback(() => {
    Promise.all([fuelApi.products(), fuelApi.deposits(), fleetApi.list({}), mastersApi.suppliers(), mastersApi.settings()])
      .then(([products, deposits, machines, suppliers, settings]) => {
        setRefs({ products, deposits, machines, suppliers, settings });
        setMembrete((current) => (current in settings.letterheads ? current : (Object.keys(settings.letterheads)[0] ?? 'ccc')));
      })
      .catch((err) => setError(describeError(err)));
    fuelApi
      .balances({})
      .then((r) => setNegatives(r.filas.filter((f) => f.negativo)))
      .catch(() => setNegatives([]));
  }, []);

  useEffect(loadRefs, [loadRefs]);

  const needsSetup = refs !== null && (refs.products.length === 0 || refs.deposits.length === 0);

  return (
    <Page>
      <PageHeader
        title="Combustibles y lubricantes"
        help="Cada despacho descuenta del saldo del depósito. Si el saldo queda en negativo, el despacho se guarda y se advierte."
        actions={
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
            {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cx('whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition', tab === t ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50')}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        }
      />

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {!refs ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : (
        <>
          {negatives.length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">
                Saldo negativo en {negatives.length} {negatives.length === 1 ? 'producto de depósito' : 'productos de depósitos'}. Suele ser una entrada sin registrar.
              </p>
              <ul className="list-disc pl-5">
                {negatives.slice(0, 4).map((n) => (
                  <li key={`${n.deposito.id}-${n.producto.id}`}>
                    {n.producto.nombre} en {n.deposito.nombre}: <span className="font-mono">{formatQty(n.saldoFinal)} {n.producto.unidad.toLowerCase()}</span>
                  </li>
                ))}
                {negatives.length > 4 && <li>y {negatives.length - 4} más</li>}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setTab('ENTRADAS')}>Registrar la entrada o un ajuste</Button>
                <Button size="sm" variant="ghost" onClick={() => setTab('INFORMES')}>Ver saldos</Button>
              </div>
            </div>
          )}
          {needsSetup && tab !== 'CATALOGOS' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Para empezar, cargá los productos y al menos un depósito en «Depósitos y productos», y después el saldo inicial en «Entradas y ajustes».
            </div>
          )}
          {tab === 'DESPACHOS' && <DispatchesTab refs={refs} membrete={membrete} onMembrete={setMembrete} onChanged={loadRefs} />}
          {tab === 'ENTRADAS' && <EntriesTab refs={refs} reloadRefs={loadRefs} membrete={membrete} onChanged={loadRefs} />}
          {tab === 'INFORMES' && <ReportsTab refs={refs} />}
          {tab === 'CATALOGOS' && <CatalogTab refs={refs} reload={loadRefs} />}
        </>
      )}
    </Page>
  );
};
