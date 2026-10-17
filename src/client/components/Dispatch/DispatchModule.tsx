/**
 * @file components/Dispatch/DispatchModule.tsx
 * @description Notas de envío: pendientes de enviar a oficina, notas a oficina central (documentos en
 * papel), notas a obra (repuestos), consulta de documentos enviados y tipos de documento. Reemplaza la
 * tabla NOTA ENVIO del Access, donde el documento se tipeaba y podía enviarse dos veces.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { dispatchApi } from '../../services/dispatchApi';
import { fleetApi } from '../../services/fleetApi';
import { describeError } from '../../services/http';
import { mastersApi, type Supplier } from '../../services/mastersApi';
import { Field, Page, PageHeader, cx, inputClass } from '../../ui';
import { LETTERHEAD_LABEL } from '../Finance/common';
import type { DispatchRefs } from './common';
import { IncomingTab } from './IncomingTab';
import { OfficeTab } from './OfficeTab';
import { PendingTab } from './PendingTab';
import { SentTab } from './SentTab';
import { SiteTab } from './SiteTab';
import { TypesTab } from './TypesTab';

type Tab = 'PENDIENTES' | 'OFICINA' | 'OBRA' | 'POR_RECIBIR' | 'DOCUMENTOS' | 'TIPOS';
const TAB_LABEL: Record<Tab, string> = {
  PENDIENTES: 'Pendientes de enviar',
  OFICINA: 'A oficina',
  OBRA: 'A obra',
  POR_RECIBIR: 'Por recibir',
  DOCUMENTOS: 'Documentos enviados',
  TIPOS: 'Tipos de documento',
};

export const DispatchModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>('PENDIENTES');
  const [refs, setRefs] = useState<DispatchRefs | null>(null);
  const [membrete, setMembrete] = useState('ccc');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const loadRefs = useCallback(() => {
    Promise.all([dispatchApi.documentTypes(), mastersApi.suppliers(), fleetApi.list({}), mastersApi.worksites(), mastersApi.settings()])
      .then(([documentTypes, suppliers, machines, worksites, settings]) => {
        setRefs({ documentTypes, suppliers, machines, worksites, settings });
        setMembrete((current) => (current in settings.letterheads ? current : (Object.keys(settings.letterheads)[0] ?? 'ccc')));
      })
      .catch((err) => setError(describeError(err)));
  }, []);

  useEffect(loadRefs, [loadRefs]);

  const changed = () => setVersion((v) => v + 1);
  const addSupplier = (supplier: Supplier) =>
    setRefs((current) => (current ? { ...current, suppliers: [...current.suppliers, supplier].sort((a, b) => a.nombre.localeCompare(b.nombre)) } : current));

  return (
    <Page>
      <PageHeader
        title="Notas de envío"
        help="Los documentos del taller que van a la oficina y los repuestos que van a obra. Un pedido, recepción, SF o rendición solo puede estar en una nota."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {refs && Object.keys(refs.settings.letterheads).length > 1 && (
              <Field label="Membrete" className="w-40">
                <select className={inputClass} value={membrete} onChange={(e) => setMembrete(e.target.value)}>
                  {Object.keys(refs.settings.letterheads).map((k) => (
                    <option key={k} value={k}>{LETTERHEAD_LABEL[k] ?? k}</option>
                  ))}
                </select>
              </Field>
            )}
            <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 text-sm">
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
          </div>
        }
      />

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {!refs ? (
        <div className="text-sm text-slate-500">Cargando…</div>
      ) : (
        <>
          {tab === 'PENDIENTES' && (
            <PendingTab refs={refs} version={version} onSupplierCreated={addSupplier} onChanged={changed} onOpenOffice={() => setTab('OFICINA')} />
          )}
          {tab === 'OFICINA' && <OfficeTab refs={refs} membrete={membrete} version={version} onSupplierCreated={addSupplier} onChanged={changed} />}
          {tab === 'OBRA' && <SiteTab refs={refs} membrete={membrete} version={version} onChanged={changed} />}
          {tab === 'POR_RECIBIR' && <IncomingTab version={version} onChanged={changed} />}
          {tab === 'DOCUMENTOS' &&<SentTab refs={refs} version={version} />}
          {tab === 'TIPOS' && <TypesTab refs={refs} reload={loadRefs} />}
        </>
      )}
    </Page>
  );
};
