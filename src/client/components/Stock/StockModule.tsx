/**
 * @file components/Stock/StockModule.tsx
 * @description Stock de repuestos del taller: existencias con costo promedio, vales de entrada, salida,
 * saldo inicial y ajuste, informes (kardex y consumo) y maestro de artículos. Reemplaza STOCK TALLER CREAR
 * ITEM y STOCK TALLER ENTRADA Y SALIDA del Access. Una salida no puede superar el saldo disponible.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { describeError } from '../../services/http';
import { fleetApi } from '../../services/fleetApi';
import { mastersApi } from '../../services/mastersApi';
import { stockApi } from '../../services/stockApi';
import type { StockMovementResult, StockMovementType } from '../../../shared/stock';
import { Page, PageHeader, cx } from '../../ui';
import { ArticlesTab } from './ArticlesTab';
import { MovementForm } from './MovementForm';
import { MovementsTab } from './MovementsTab';
import { ReportsTab } from './ReportsTab';
import { StockTab } from './StockTab';
import type { StockRefs } from './common';

type Tab = 'EXISTENCIAS' | 'VALES' | 'INFORMES' | 'ARTICULOS';
const TAB_LABEL: Record<Tab, string> = {
  EXISTENCIAS: 'Existencias',
  VALES: 'Vales',
  INFORMES: 'Informes',
  ARTICULOS: 'Artículos',
};

export const StockModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>('EXISTENCIAS');
  const [refs, setRefs] = useState<StockRefs | null>(null);
  const [membrete, setMembrete] = useState('ccc');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<{ tipo?: StockMovementType; articleId?: string } | null>(null);
  const [notice, setNotice] = useState<StockMovementResult | null>(null);

  const loadRefs = useCallback(() => {
    Promise.all([stockApi.articles(), fleetApi.list({}), mastersApi.worksites(), mastersApi.suppliers(), mastersApi.settings()])
      .then(([articles, machines, worksites, suppliers, settings]) => {
        setRefs({ articles, machines, worksites, suppliers, settings });
        setMembrete((current) => (current in settings.letterheads ? current : (Object.keys(settings.letterheads)[0] ?? 'ccc')));
        setReloadKey((k) => k + 1);
      })
      .catch((err) => setError(describeError(err)));
  }, []);

  useEffect(loadRefs, [loadRefs]);

  return (
    <Page>
      <PageHeader
        title="Stock de repuestos"
        help="El saldo sale de los vales. Una salida no puede superar lo que hay; el valor se calcula al costo promedio."
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

      {notice && (
        <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="flex items-start justify-between gap-3">
            <p>Se registró el vale Nº {notice.numero}.</p>
            <button type="button" onClick={() => setNotice(null)} className="text-emerald-700 hover:underline">Cerrar</button>
          </div>
          {notice.advertencias.map((w) => (
            <p key={w} className="text-amber-900">{w}</p>
          ))}
        </div>
      )}

      {!refs ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : (
        <>
          {tab === 'EXISTENCIAS' && <StockTab refs={refs} reloadKey={reloadKey} onNewMovement={(tipo, articleId) => setForm({ tipo, articleId })} onGoToArticles={() => setTab('ARTICULOS')} />}
          {tab === 'VALES' && (
            <MovementsTab refs={refs} membrete={membrete} onMembrete={setMembrete} reloadKey={reloadKey} onNewMovement={() => setForm({})} onChanged={loadRefs} />
          )}
          {tab === 'INFORMES' && <ReportsTab refs={refs} reloadKey={reloadKey} />}
          {tab === 'ARTICULOS' && <ArticlesTab articles={refs.articles} onChanged={loadRefs} />}
          {form && (
            <MovementForm
              refs={refs}
              initial={form}
              reloadRefs={loadRefs}
              onClose={() => setForm(null)}
              onSaved={(result) => {
                setForm(null);
                setNotice(result);
                loadRefs();
              }}
            />
          )}
        </>
      )}
    </Page>
  );
};
