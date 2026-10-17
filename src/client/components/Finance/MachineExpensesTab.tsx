/**
 * @file components/Finance/MachineExpensesTab.tsx
 * @description Gastos por máquina: caja chica y SF juntas, por período y origen. Reemplaza los
 * informes GASTOS DE MAQUINAS y GASTOS DE MAQUINAS SF del Access, que pedían el código de
 * máquina por parámetro y no permitían ver las dos fuentes a la vez.
 */

import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { formatCurrency } from '../../../shared/calculations';
import { describeError } from '../../services/http';
import { financeApi, type MachineExpenseReport } from '../../services/financeApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, todayIso } from '../../utils/format';
import { Button, Card, Field, inputClass } from '../../ui';
import type { FinanceRefs } from './common';

type Origin = 'todos' | 'caja' | 'sf';

export const MachineExpensesTab: React.FC<{ refs: FinanceRefs }> = ({ refs }) => {
  const [desde, setDesde] = useState(`${todayIso().slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(todayIso());
  const [maquina, setMaquina] = useState('');
  const [origen, setOrigen] = useState<Origin>('todos');
  const [sinMaquina, setSinMaquina] = useState(false);
  const [report, setReport] = useState<MachineExpenseReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    financeApi
      .machineExpenses({ desde, hasta, maquina: maquina || undefined, origen, incluirSinMaquina: sinMaquina })
      .then(setReport)
      .catch((err) => setError(describeError(err)));
  }, [desde, hasta, maquina, origen, sinMaquina]);

  const exportExcel = () => {
    if (!report) return;
    exportRowsToExcel(
      report.detalle.map((d) => ({
        Fecha: formatDate(d.fecha),
        Origen: d.origen === 'CAJA' ? 'Caja chica' : 'SF',
        Documento: d.documento,
        Máquina: d.maquina?.codigo ?? 'Sin máquina',
        Proveedor: d.proveedor,
        Cuenta: d.cuenta ?? '',
        Moneda: d.currency,
        Monto: d.monto,
      })),
      'Gastos por máquina',
      `gastos-por-maquina-${desde}-${hasta}.xlsx`,
    );
  };

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
        <Field label="Origen">
          <select className={inputClass} value={origen} onChange={(e) => setOrigen(e.target.value as Origin)}>
            <option value="todos">Caja chica y SF</option>
            <option value="caja">Solo caja chica</option>
            <option value="sf">Solo SF</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={sinMaquina} onChange={(e) => setSinMaquina(e.target.checked)} />
          Incluir gastos sin máquina
        </label>
        <div className="ml-auto">
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!report?.detalle.length} onClick={exportExcel}>Excel</Button>
        </div>
      </div>
      {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
      {report === null ? (
        <div className="p-6 text-sm text-slate-500">Calculando…</div>
      ) : report.resumen.length === 0 ? (
        <div className="p-6 text-sm text-slate-500">No hay gastos con máquina en este período.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Máquina</th>
                <th className="px-4 py-2.5">Moneda</th>
                <th className="px-4 py-2.5 text-right">Caja chica</th>
                <th className="px-4 py-2.5 text-right">SF</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.resumen.map((r) => (
                <tr key={`${r.maquina?.id ?? 'sin'}-${r.currency}`}>
                  <td className="px-4 py-2.5">{r.maquina ? `${r.maquina.codigo} · ${r.maquina.descripcion}` : 'Sin máquina'}</td>
                  <td className="px-4 py-2.5">{r.currency}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(r.caja, r.currency)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(r.sf, r.currency)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(r.total, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
