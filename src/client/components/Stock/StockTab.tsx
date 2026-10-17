/**
 * @file components/Stock/StockTab.tsx
 * @description Existencias del taller: saldo, costo promedio y valor de cada artículo, con búsqueda por
 * código, equivalencia o descripción. Reemplaza el informe STOCK TALLER ENTRADA Y SALIDA del Access, donde
 * el saldo era un `Sum` sobre texto. Desde cada fila se registra una entrada, una salida o un ajuste.
 */

import React, { useEffect, useState } from 'react';
import { Boxes, Download, Search } from 'lucide-react';
import { formatCurrency } from '../../../shared/calculations';
import { ARTICLE_RUBROS, RUBRO_LABEL, type ArticleRubro, type StockExistencesReport, type StockMovementType } from '../../../shared/stock';
import { describeError } from '../../services/http';
import { stockApi } from '../../services/stockApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Stat, StatGrid, StatusPill, inputClass } from '../../ui';
import { UNIT_LABEL, type StockRefs } from './common';

export const StockTab: React.FC<{
  refs: StockRefs;
  reloadKey: number;
  onNewMovement: (tipo: StockMovementType, articleId?: string) => void;
  onGoToArticles: () => void;
}> = ({ refs, reloadKey, onNewMovement, onGoToArticles }) => {
  const [q, setQ] = useState('');
  const [rubro, setRubro] = useState<ArticleRubro | ''>('');
  const [bajoMinimo, setBajoMinimo] = useState(false);
  const [conSaldo, setConSaldo] = useState(false);
  const [report, setReport] = useState<StockExistencesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = refs.settings.currency;

  useEffect(() => {
    const timer = setTimeout(() => {
      stockApi
        .existences({ q: q.trim() || undefined, rubro: rubro || undefined, bajoMinimo, conSaldo, activo: true })
        .then((r) => {
          setReport(r);
          setError(null);
        })
        .catch((err) => setError(describeError(err)));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, rubro, bajoMinimo, conSaldo, reloadKey]);

  if (refs.articles.length === 0) {
    return (
      <EmptyState
        icon={<Boxes className="h-10 w-10" />}
        title="Todavía no hay artículos"
        help="Cargá el maestro de artículos y el saldo inicial con el conteo físico del depósito. Podés importarlos desde una planilla de Excel."
        action={<Button variant="primary" onClick={onGoToArticles}>Ir a Artículos</Button>}
      />
    );
  }

  const items = report?.items ?? [];
  const low = items.filter((a) => a.bajoMinimo).length;

  const exportExcel = () =>
    exportRowsToExcel(
      items.map((a) => ({
        Código: a.codigo,
        Descripción: a.descripcion,
        Rubro: RUBRO_LABEL[a.rubro],
        Ubicación: a.ubicacion ?? '',
        Unidad: UNIT_LABEL[a.unidad],
        Saldo: a.saldo,
        Mínimo: a.stockMinimo,
        'Costo promedio': a.costoPromedio,
        Valor: a.valor,
        'Último movimiento': a.ultimoMovimiento ?? '',
      })),
      'Existencias',
      `existencias-${todayIso()}.xlsx`,
    );

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat label="Artículos listados" value={items.length} />
        <Stat label="Valor del stock" value={formatCurrency(report?.totalValor ?? 0, currency)} hint="A costo promedio" />
        <Stat label="En o bajo el mínimo" value={low} tone={low > 0 ? 'warn' : 'neutral'} hint={low > 0 ? 'Revisá si hace falta pedir' : undefined} />
      </StatGrid>

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <label className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className={`${inputClass} pl-9`} placeholder="Código, equivalencia o descripción" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="w-44">
            <select className={inputClass} value={rubro} onChange={(e) => setRubro(e.target.value as ArticleRubro | '')}>
              <option value="">Todos los rubros</option>
              {ARTICLE_RUBROS.map((r) => (
                <option key={r} value={r}>{RUBRO_LABEL[r]}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={conSaldo} onChange={(e) => setConSaldo(e.target.checked)} />Solo con saldo</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={bajoMinimo} onChange={(e) => setBajoMinimo(e.target.checked)} />Bajo mínimo</label>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportExcel} disabled={items.length === 0}>Excel</Button>
          <Button variant="primary" onClick={() => onNewMovement('SALIDA')}>Nuevo vale</Button>
        </div>
        {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
        {!report ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No hay artículos con esos filtros.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Código</th>
                  <th className="px-4 py-2.5">Descripción</th>
                  <th className="px-4 py-2.5">Ubicación</th>
                  <th className="px-4 py-2.5 text-right">Saldo</th>
                  <th className="px-4 py-2.5 text-right">Mínimo</th>
                  <th className="px-4 py-2.5 text-right">Costo prom.</th>
                  <th className="px-4 py-2.5 text-right">Valor</th>
                  <th className="px-4 py-2.5">Último mov.</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono font-semibold">{a.codigo}</td>
                    <td className="max-w-xs px-4 py-2.5 text-slate-700">
                      <div className="truncate">{a.descripcion}</div>
                      {a.equivalencias.length > 0 && <div className="truncate text-xs text-slate-400">{a.equivalencias.map((e) => `${e.marca} ${e.codigo}`).join(' · ')}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{a.ubicacion ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {a.bajoMinimo ? <StatusPill tone={a.saldo <= 0 ? 'bad' : 'warn'}>{formatQty(a.saldo)} {UNIT_LABEL[a.unidad]}</StatusPill> : `${formatQty(a.saldo)} ${UNIT_LABEL[a.unidad]}`}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-500">{a.stockMinimo > 0 ? formatQty(a.stockMinimo) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{a.saldo > 0 ? formatCurrency(a.costoPromedio, currency) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(a.valor, currency)}</td>
                    <td className="px-4 py-2.5 text-slate-500">{a.ultimoMovimiento ? formatDate(a.ultimoMovimiento) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => onNewMovement('ENTRADA', a.id)}>Entrada</Button>
                      <Button size="sm" variant="ghost" disabled={a.saldo <= 0} onClick={() => onNewMovement('SALIDA', a.id)}>Salida</Button>
                      <Button size="sm" variant="ghost" onClick={() => onNewMovement('AJUSTE', a.id)}>Ajuste</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
