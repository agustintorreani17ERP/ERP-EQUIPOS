/**
 * @file components/Finance/FinanceModule.tsx
 * @description Fondos: solicitudes de fondos (SF), caja chica por rendiciones y gastos por máquina.
 * Reemplaza SFONDOS, CAJA CHICA y sus ~14 informes del Access. Todo sale de la API; el estado
 * de cada SF se calcula de los pagos registrados, no de casillas.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Tags } from 'lucide-react';
import type { CompanySettings } from '../../../shared/erp';
import { describeError } from '../../services/http';
import { financeApi } from '../../services/financeApi';
import { fleetApi } from '../../services/fleetApi';
import { mastersApi } from '../../services/mastersApi';
import { Button, Page, PageHeader, cx } from '../../ui';
import { MachineExpensesTab } from './MachineExpensesTab';
import { FundRequestsTab } from './FundRequestsTab';
import { PettyCashTab } from './PettyCashTab';
import type { FinanceRefs } from './common';

type Tab = 'SF' | 'CAJA' | 'GASTOS';
const TAB_LABEL: Record<Tab, string> = { SF: 'Solicitudes de fondos', CAJA: 'Caja chica', GASTOS: 'Gastos por máquina' };

export const FinanceModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>('SF');
  const [refs, setRefs] = useState<FinanceRefs | null>(null);
  const [membrete, setMembrete] = useState('ccc');
  const [error, setError] = useState<string | null>(null);

  const loadRefs = useCallback(() => {
    Promise.all([mastersApi.suppliers(), financeApi.accounts(), fleetApi.list({}), mastersApi.settings()])
      .then(([suppliers, accounts, machines, settings]: [FinanceRefs['suppliers'], FinanceRefs['accounts'], FinanceRefs['machines'], CompanySettings]) => {
        setRefs({ suppliers, accounts, machines, settings });
        setMembrete((current) => (current in settings.letterheads ? current : (Object.keys(settings.letterheads)[0] ?? 'ccc')));
      })
      .catch((err) => setError(describeError(err)));
  }, []);

  useEffect(loadRefs, [loadRefs]);

  const loadDefaultAccounts = async () => {
    try {
      await financeApi.loadDefaultAccounts();
      loadRefs();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Page>
      <PageHeader
        title="Fondos"
        help="Las SF y la caja chica comparten proveedores, cuentas y máquinas. El estado de cada SF sale de los pagos que registrés."
        actions={
          <>
            {refs && refs.accounts.length === 0 && (
              <Button variant="secondary" icon={<Tags className="h-4 w-4" />} onClick={loadDefaultAccounts}>Cargar cuentas</Button>
            )}
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
          </>
        }
      />

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {!refs ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : (
        <>
          {tab === 'SF' && <FundRequestsTab refs={refs} reloadRefs={loadRefs} membrete={membrete} onMembrete={setMembrete} />}
          {tab === 'CAJA' && <PettyCashTab refs={refs} reloadRefs={loadRefs} membrete={membrete} />}
          {tab === 'GASTOS' && <MachineExpensesTab refs={refs} />}
        </>
      )}
    </Page>
  );
};
