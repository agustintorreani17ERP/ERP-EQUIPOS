/**
 * @file components/Maintenance/MaintenanceModule.tsx
 * @description Mantenimiento: programa de servicios con aviso anticipado, órdenes de servicio, tipos y
 * cumplimiento. Reemplaza la tabla MANTENIMIENTOS del Access, donde el 61 % de las órdenes se emitía
 * con la máquina ya pasada de horas porque nadie avisaba. Las lecturas salen de Flota, Partes y Combustibles.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { describeError } from '../../services/http';
import { maintenanceApi } from '../../services/maintenanceApi';
import { mastersApi } from '../../services/mastersApi';
import { Page, PageHeader, cx } from '../../ui';
import { ComplianceTab } from './ComplianceTab';
import { OrdersTab } from './OrdersTab';
import { ProgramTab } from './ProgramTab';
import { TypesTab } from './TypesTab';
import type { MaintenanceRefs } from './common';

type Tab = 'PROGRAMA' | 'ORDENES' | 'TIPOS' | 'CUMPLIMIENTO';
const TAB_LABEL: Record<Tab, string> = {
  PROGRAMA: 'Programa',
  ORDENES: 'Órdenes',
  TIPOS: 'Tipos de servicio',
  CUMPLIMIENTO: 'Cumplimiento',
};

export const MaintenanceModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>('PROGRAMA');
  const [refs, setRefs] = useState<MaintenanceRefs | null>(null);
  const [membrete, setMembrete] = useState('ccc');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const loadRefs = useCallback(() => {
    Promise.all([maintenanceApi.types(), mastersApi.worksites(), mastersApi.settings()])
      .then(([types, worksites, settings]) => {
        setRefs({ types, worksites, settings });
        setMembrete((current) => (current in settings.letterheads ? current : (Object.keys(settings.letterheads)[0] ?? 'ccc')));
      })
      .catch((err) => setError(describeError(err)));
  }, []);

  useEffect(loadRefs, [loadRefs]);

  const changed = () => {
    loadRefs();
    setVersion((v) => v + 1);
  };

  return (
    <Page>
      <PageHeader
        title="Mantenimiento"
        help="Cada máquina tiene un plan: el próximo servicio se calcula con las horas reales del último más el intervalo, y avisa antes de que venza."
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
          {tab === 'PROGRAMA' && refs.types.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Para empezar, cargá los tipos en «Tipos de servicio» y después configurá el plan de cada máquina desde el Programa.
            </div>
          )}
          {tab === 'PROGRAMA' && <ProgramTab refs={refs} onChanged={changed} onOpenOrders={() => setTab('ORDENES')} />}
          {tab === 'ORDENES' && <OrdersTab key={version} refs={refs} membrete={membrete} onChanged={changed} />}
          {tab === 'TIPOS' && <TypesTab refs={refs} onChanged={changed} />}
          {tab === 'CUMPLIMIENTO' && <ComplianceTab key={version} refs={refs} />}
        </>
      )}
    </Page>
  );
};
