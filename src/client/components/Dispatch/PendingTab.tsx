/**
 * @file components/Dispatch/PendingTab.tsx
 * @description Documentos pendientes de enviar a oficina: pedidos, recepciones, SF y rendiciones cerradas
 * que todavía no están en ninguna nota. En el Access no existía esta lista (el 28 % de los pedidos de
 * 2024-2025 nunca figuró en una nota). Desde acá se arma la nota con los documentos tildados.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDocNumber } from '../../../shared/finance';
import { FileSpreadsheet, Send } from 'lucide-react';
import { OFFICE_LINE_KIND_LABEL, type OfficeLineKind, type PendingDocumentDto, type PendingDocumentsDto } from '../../../shared/dispatch';
import { dispatchApi } from '../../services/dispatchApi';
import { describeError } from '../../services/http';
import type { Supplier } from '../../services/mastersApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Stat, StatGrid, inputClass } from '../../ui';
import { KIND_SHORT, OLD_PENDING_DAYS, type DispatchRefs } from './common';
import { OfficeNoteForm } from './OfficeNoteForm';

type LinkedKind = Exclude<OfficeLineKind, 'MANUAL'>;
const KINDS: LinkedKind[] = ['PEDIDO', 'RECEPCION', 'SF', 'RENDICION'];
const keyOf = (i: PendingDocumentDto) => `${i.kind}:${i.id}`;

export const PendingTab: React.FC<{
  refs: DispatchRefs;
  version: number;
  onSupplierCreated: (supplier: Supplier) => void;
  onChanged: () => void;
  onOpenOffice: () => void;
}> = ({ refs, version, onSupplierCreated, onChanged, onOpenOffice }) => {
  const [data, setData] = useState<PendingDocumentsDto | null>(null);
  const [desde, setDesde] = useState('');
  const [kind, setKind] = useState<LinkedKind | ''>('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    dispatchApi
      .pending(desde || undefined)
      .then((r) => {
        setData(r);
        setPicked(new Set());
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [desde]);

  useEffect(load, [load, version]);

  const items = useMemo(() => {
    const text = q.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (i) =>
        (!kind || i.kind === kind) &&
        (!text || `${formatDocNumber(i.numero, i.anio)} ${i.supplier?.nombre ?? ''} ${i.machine?.codigo ?? ''} ${i.detalle ?? ''}`.toLowerCase().includes(text)),
    );
  }, [data, kind, q]);

  const old = (data?.items ?? []).filter((i) => i.dias > OLD_PENDING_DAYS).length;
  const toggle = (i: PendingDocumentDto) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(keyOf(i))) next.delete(keyOf(i));
      else next.add(keyOf(i));
      return next;
    });
  const allVisiblePicked = items.length > 0 && items.every((i) => picked.has(keyOf(i)));
  const toggleAll = () => setPicked(allVisiblePicked ? new Set() : new Set(items.map(keyOf)));

  const exportExcel = () =>
    exportRowsToExcel(
      items.map((i) => ({
        Tipo: OFFICE_LINE_KIND_LABEL[i.kind],
        'N.º': formatDocNumber(i.numero, i.anio),
        Fecha: formatDate(i.fecha),
        Proveedor: i.supplier?.nombre ?? '',
        Máquina: i.machine?.codigo ?? '',
        Detalle: i.detalle ?? '',
        'Días sin enviar': i.dias,
      })),
      'Pendientes',
      `pendientes-de-enviar-${todayIso()}.xlsx`,
    );

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <StatGrid>
        {KINDS.map((k) => (
          <React.Fragment key={k}>
            <Stat label={OFFICE_LINE_KIND_LABEL[k]} value={data ? String(data.conteo[k]) : '—'} />
          </React.Fragment>
        ))}
        <Stat label={`Con más de ${OLD_PENDING_DAYS} días`} value={data ? String(old) : '—'} tone={old > 0 ? 'warn' : undefined} />
      </StatGrid>

      <Card
        title="Pendientes de enviar a oficina"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportExcel} disabled={items.length === 0}>Excel</Button>
            <Button size="sm" variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => setCreating(true)} disabled={picked.size === 0}>
              Crear nota con {picked.size} {picked.size === 1 ? 'seleccionado' : 'seleccionados'}
            </Button>
          </div>
        }
        padded={false}
      >
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          <Field label="Tipo">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as LinkedKind | '')}>
              <option value="">Todos</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>{OFFICE_LINE_KIND_LABEL[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Desde" hint="Los documentos anteriores no se listan (histórico del Access)">
            <input type="date" className={inputClass} value={desde || data?.desde || ''} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Buscar"><input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número, proveedor, máquina…" /></Field>
        </div>
        {data === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No hay documentos pendientes" help={`Todo lo emitido desde el ${formatDate(data.desde)} ya fue enviado a la oficina.`} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-2.5"><input type="checkbox" checked={allVisiblePicked} onChange={toggleAll} aria-label="Elegir todos" /></th>
                  <th className="px-4 py-2.5">Documento</th>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Proveedor</th>
                  <th className="px-4 py-2.5">Máquina</th>
                  <th className="px-4 py-2.5">Detalle</th>
                  <th className="px-4 py-2.5 text-right">Días sin enviar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((i) => (
                  <tr key={keyOf(i)} className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(i)}>
                    <td className="px-4 py-2"><input type="checkbox" checked={picked.has(keyOf(i))} onChange={() => toggle(i)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="px-4 py-2 font-medium">{KIND_SHORT[i.kind]} N.º {formatDocNumber(i.numero, i.anio)}</td>
                    <td className="px-4 py-2">{formatDate(i.fecha)}</td>
                    <td className="px-4 py-2">{i.supplier?.nombre ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{i.machine?.codigo ?? ''}</td>
                    <td className="max-w-64 truncate px-4 py-2 text-slate-500">{i.detalle ?? ''}</td>
                    <td className={`px-4 py-2 text-right font-mono ${i.dias > OLD_PENDING_DAYS ? 'font-semibold text-amber-700' : ''}`}>{i.dias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && data && (
        <OfficeNoteForm
          refs={refs}
          onSupplierCreated={onSupplierCreated}
          preselected={data.items.filter((i) => picked.has(keyOf(i)))}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onChanged();
            onOpenOffice();
          }}
        />
      )}
    </div>
  );
};
