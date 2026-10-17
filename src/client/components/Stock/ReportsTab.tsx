/**
 * @file components/Stock/ReportsTab.tsx
 * @description Informes de stock: kardex de un artículo (saldo y valor después de cada vale) y consumo
 * valorizado por máquina u obra. El consumo es un informe aparte y no se suma a los gastos por máquina de
 * Fondos: un repuesto comprado con caja chica y después sacado del stock se contaría dos veces.
 */

import React, { useEffect, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { formatCurrency } from '../../../shared/calculations';
import { ARTICLE_RUBROS, RUBRO_LABEL, STOCK_TYPE_LABEL, type ArticleRubro, type KardexReport } from '../../../shared/stock';
import { describeError } from '../../services/http';
import { stockApi } from '../../services/stockApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { printArea } from '../../utils/print';
import { Button, Card, Field, cx, inputClass } from '../../ui';
import { ArticlePicker } from './ArticlePicker';
import { UNIT_LABEL, type StockRefs } from './common';

type Report = 'KARDEX' | 'CONSUMO';
const REPORT_LABEL: Record<Report, string> = { KARDEX: 'Kardex por artículo', CONSUMO: 'Consumo por máquina u obra' };

interface PrintData {
  title: string;
  subtitle: string;
  head: string[];
  rows: string[][];
  align: ('left' | 'right')[];
}

export const ReportsTab: React.FC<{ refs: StockRefs; reloadKey: number }> = ({ refs, reloadKey }) => {
  const [report, setReport] = useState<Report>('KARDEX');
  const [printData, setPrintData] = useState<PrintData | null>(null);

  useEffect(() => {
    if (!printData) return;
    const restore = printArea();
    return restore;
  }, [printData]);

  // Al cerrar el diálogo de impresión se limpia la marca; el área se retira en el próximo evento.
  useEffect(() => {
    if (!printData) return;
    const clear = () => setPrintData(null);
    window.addEventListener('afterprint', clear, { once: true });
    return () => window.removeEventListener('afterprint', clear);
  }, [printData]);

  return (
    <>
      <div className="space-y-4">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
          {(Object.keys(REPORT_LABEL) as Report[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReport(r)}
              className={cx('whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition', report === r ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50')}
            >
              {REPORT_LABEL[r]}
            </button>
          ))}
        </div>
        {report === 'KARDEX' ? <KardexReportView refs={refs} reloadKey={reloadKey} onPrint={setPrintData} /> : <ConsumptionView refs={refs} reloadKey={reloadKey} onPrint={setPrintData} />}
      </div>
      {printData && <PrintableReport data={printData} letterhead={Object.values(refs.settings.letterheads)[0] ?? ''} />}
    </>
  );
};

const KardexReportView: React.FC<{ refs: StockRefs; reloadKey: number; onPrint: (d: PrintData) => void }> = ({ refs, reloadKey, onPrint }) => {
  const [articleId, setArticleId] = useState('');
  const [desde, setDesde] = useState(`${todayIso().slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(todayIso());
  const [data, setData] = useState<KardexReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = refs.settings.currency;

  useEffect(() => {
    if (!articleId) {
      setData(null);
      return;
    }
    stockApi
      .kardex({ articulo: articleId, desde: desde || undefined, hasta: hasta || undefined })
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [articleId, desde, hasta, reloadKey]);

  const unit = data ? UNIT_LABEL[data.articulo.unidad] : '';
  const tableRows = (data?.filas ?? []).map((f) => ({
    fecha: formatDate(f.fecha),
    vale: String(f.numero),
    tipo: STOCK_TYPE_LABEL[f.tipo],
    detalle: f.destino ?? '',
    entra: f.delta > 0 ? formatQty(f.delta) : '',
    sale: f.delta < 0 ? formatQty(-f.delta) : '',
    saldo: formatQty(f.saldo),
    valor: formatCurrency(f.valorSaldo, currency),
  }));

  const exportExcel = () => {
    if (!data) return;
    exportRowsToExcel(
      [
        { Fecha: 'Saldo anterior', Vale: '', Tipo: '', Detalle: '', Entra: '', Sale: '', Saldo: data.anterior.saldo, 'Valor del saldo': data.anterior.valor },
        ...data.filas.map((f) => ({
          Fecha: f.fecha,
          Vale: f.numero,
          Tipo: STOCK_TYPE_LABEL[f.tipo],
          Detalle: f.destino ?? '',
          Entra: f.delta > 0 ? f.delta : '',
          Sale: f.delta < 0 ? -f.delta : '',
          Saldo: f.saldo,
          'Valor del saldo': f.valorSaldo,
        })),
      ] as unknown as Record<string, string | number | boolean | null>[],
      'Kardex',
      `kardex-${data.articulo.codigo.replace(/[^\w-]+/g, '_')}-${todayIso()}.xlsx`,
    );
  };

  const print = () => {
    if (!data) return;
    onPrint({
      title: `Kardex — ${data.articulo.codigo} ${data.articulo.descripcion}`,
      subtitle: `Del ${desde ? formatDate(desde) : 'inicio'} al ${hasta ? formatDate(hasta) : formatDate(todayIso())}. Saldo anterior: ${formatQty(data.anterior.saldo)} ${unit}`,
      head: ['Fecha', 'Vale', 'Tipo', 'Detalle', 'Entra', 'Sale', 'Saldo', 'Valor'],
      rows: tableRows.map((r) => [r.fecha, r.vale, r.tipo, r.detalle, r.entra, r.sale, r.saldo, r.valor]),
      align: ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right'],
    });
  };

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
        <Field label="Artículo" className="min-w-[20rem] flex-1">
          <ArticlePicker articles={refs.articles} value={articleId} onChange={setArticleId} listId="stock-kardex-articles" showBalance={false} />
        </Field>
        <Field label="Desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
        <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!data} onClick={exportExcel}>Excel</Button>
        <Button variant="secondary" icon={<Printer className="h-4 w-4" />} disabled={!data} onClick={print}>Imprimir</Button>
      </div>
      {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
      {!data ? (
        <div className="p-6 text-sm text-slate-500">Elegí un artículo para ver sus movimientos con el saldo después de cada vale.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5">Vale</th>
                <th className="px-4 py-2.5">Tipo</th>
                <th className="px-4 py-2.5">Destino u origen</th>
                <th className="px-4 py-2.5 text-right">Entra</th>
                <th className="px-4 py-2.5 text-right">Sale</th>
                <th className="px-4 py-2.5 text-right">Saldo</th>
                <th className="px-4 py-2.5 text-right">Valor del saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/60 text-slate-600">
                <td className="px-4 py-2" colSpan={6}>Saldo anterior al período</td>
                <td className="px-4 py-2 text-right font-mono">{formatQty(data.anterior.saldo)} {unit}</td>
                <td className="px-4 py-2 text-right font-mono">{formatCurrency(data.anterior.valor, currency)}</td>
              </tr>
              {tableRows.length === 0 && (
                <tr><td className="px-4 py-4 text-slate-500" colSpan={8}>No hubo movimientos en el período.</td></tr>
              )}
              {tableRows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{r.fecha}</td>
                  <td className="px-4 py-2 font-mono">{r.vale}</td>
                  <td className="px-4 py-2">{r.tipo}</td>
                  <td className="px-4 py-2 text-slate-600">{r.detalle}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-700">{r.entra}</td>
                  <td className="px-4 py-2 text-right font-mono text-amber-700">{r.sale}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{r.saldo}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.valor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

const ConsumptionView: React.FC<{ refs: StockRefs; reloadKey: number; onPrint: (d: PrintData) => void }> = ({ refs, reloadKey, onPrint }) => {
  const [desde, setDesde] = useState(`${todayIso().slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(todayIso());
  const [maquina, setMaquina] = useState('');
  const [obra, setObra] = useState('');
  const [rubro, setRubro] = useState<ArticleRubro | ''>('');
  const [data, setData] = useState<Awaited<ReturnType<typeof stockApi.consumption>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = refs.settings.currency;

  useEffect(() => {
    stockApi
      .consumption({ desde: desde || undefined, hasta: hasta || undefined, maquina: maquina || undefined, obra: obra || undefined, rubro: rubro || undefined })
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [desde, hasta, maquina, obra, rubro, reloadKey]);

  const rows = data?.filas ?? [];
  const subtotals = new Map<string, number>();
  for (const r of rows) subtotals.set(r.destinoId, (subtotals.get(r.destinoId) ?? 0) + r.valor);

  const exportExcel = () =>
    exportRowsToExcel(
      rows.map((r) => ({
        Tipo: r.destinoTipo === 'MAQUINA' ? 'Máquina' : 'Obra',
        Destino: r.destino,
        Código: r.codigo,
        Descripción: r.descripcion,
        Cantidad: r.cantidad,
        Unidad: UNIT_LABEL[r.unidad],
        Valor: r.valor,
      })),
      'Consumo',
      `consumo-stock-${todayIso()}.xlsx`,
    );

  const print = () =>
    onPrint({
      title: 'Consumo de repuestos del stock',
      subtitle: `Del ${desde ? formatDate(desde) : 'inicio'} al ${hasta ? formatDate(hasta) : formatDate(todayIso())}. Total: ${formatCurrency(data?.totalValor ?? 0, currency)}`,
      head: ['Destino', 'Código', 'Descripción', 'Cantidad', 'Valor'],
      rows: rows.map((r) => [r.destino, r.codigo, r.descripcion, `${formatQty(r.cantidad)} ${UNIT_LABEL[r.unidad]}`, formatCurrency(r.valor, currency)]),
      align: ['left', 'left', 'left', 'right', 'right'],
    });

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
        <Field label="Desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
        <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
        <Field label="Máquina">
          <select className={inputClass} value={maquina} onChange={(e) => setMaquina(e.target.value)}>
            <option value="">Todas</option>
            {refs.machines.map((m) => (
              <option key={m.id} value={m.id}>{m.codigo} · {m.descripcion}</option>
            ))}
          </select>
        </Field>
        <Field label="Obra">
          <select className={inputClass} value={obra} onChange={(e) => setObra(e.target.value)}>
            <option value="">Todas</option>
            {refs.worksites.map((w) => (
              <option key={w.id} value={w.id}>{w.nombre}</option>
            ))}
          </select>
        </Field>
        <Field label="Rubro">
          <select className={inputClass} value={rubro} onChange={(e) => setRubro(e.target.value as ArticleRubro | '')}>
            <option value="">Todos</option>
            {ARTICLE_RUBROS.map((r) => (
              <option key={r} value={r}>{RUBRO_LABEL[r]}</option>
            ))}
          </select>
        </Field>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={rows.length === 0} onClick={exportExcel}>Excel</Button>
        <Button variant="secondary" icon={<Printer className="h-4 w-4" />} disabled={rows.length === 0} onClick={print}>Imprimir</Button>
      </div>
      {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
      {!data ? (
        <div className="p-6 text-sm text-slate-500">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-sm text-slate-500">No hubo salidas en ese período.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Destino</th>
                <th className="px-4 py-2.5">Artículo</th>
                <th className="px-4 py-2.5 text-right">Cantidad</th>
                <th className="px-4 py-2.5 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => {
                const first = i === 0 || rows[i - 1].destinoId !== r.destinoId;
                return (
                  <tr key={`${r.destinoId}-${r.articleId}`}>
                    <td className="px-4 py-2 align-top">
                      {first && (
                        <div>
                          <span className="font-medium">{r.destino}</span> <span className="text-xs text-slate-400">{r.destinoTipo === 'MAQUINA' ? 'máquina' : 'obra'}</span>
                          <div className="text-xs text-slate-500">Subtotal {formatCurrency(subtotals.get(r.destinoId) ?? 0, currency)}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2"><span className="font-mono font-semibold">{r.codigo}</span> <span className="text-slate-600">{r.descripcion}</span></td>
                    <td className="px-4 py-2 text-right font-mono">{formatQty(r.cantidad)} {UNIT_LABEL[r.unidad]}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatCurrency(r.valor, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <td className="px-4 py-2.5" colSpan={3}>Total</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(data.totalValor, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
};

const PrintableReport: React.FC<{ data: PrintData; letterhead: string }> = ({ data, letterhead }) => (
  <div className="print-area text-sm text-black">
    <div className="mb-4 border-b border-black pb-2">
      <div className="text-lg font-bold">{letterhead}</div>
      <div className="font-semibold">{data.title}</div>
      <div className="text-xs">{data.subtitle}</div>
    </div>
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-black">
          {data.head.map((h, i) => (
            <th key={h} className={cx('py-1', data.align[i] === 'right' ? 'text-right' : 'text-left')}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, r) => (
          <tr key={r} className="border-b border-slate-300">
            {row.map((cell, c) => (
              <td key={c} className={cx('py-1', data.align[c] === 'right' ? 'text-right' : 'text-left')}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
