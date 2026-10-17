/**
 * @file components/Maintenance/ComplianceTab.tsx
 * @description Cumplimiento: por máquina y tipo, cuántos servicios se hicieron a tiempo o con atraso entre
 * las horas ideales y las reales. En el Access el 43 % se hacía con más de 150 hs de atraso y nadie lo veía.
 */

import React, { useEffect, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { ComplianceRowDto } from '../../../shared/maintenance';
import { describeError } from '../../services/http';
import { maintenanceApi } from '../../services/maintenanceApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatQty, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Stat, StatGrid, inputClass } from '../../ui';
import type { MaintenanceRefs } from './common';

export const ComplianceTab: React.FC<{ refs: MaintenanceRefs }> = ({ refs }) => {
  const [rows, setRows] = useState<ComplianceRowDto[] | null>(null);
  const [obra, setObra] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    maintenanceApi
      .compliance({ obra, desde, hasta })
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [obra, desde, hasta]);

  const total = (rows ?? []).reduce((s, r) => s + r.cantidad, 0);
  const sum = (key: 'aTiempo' | 'hasta50' | 'de51a150' | 'masDe150') => (rows ?? []).reduce((s, r) => s + r[key], 0);
  const pct = (n: number) => (total === 0 ? '—' : `${Math.round((n / total) * 100)} %`);

  const exportExcel = () =>
    exportRowsToExcel(
      (rows ?? []).map((r) => ({
        Máquina: r.machine.codigo,
        Descripción: r.machine.descripcion,
        Tipo: r.tipo,
        Servicios: r.cantidad,
        'Atraso promedio': r.diferenciaPromedio,
        'A tiempo': r.aTiempo,
        'Hasta 50': r.hasta50,
        '51 a 150': r.de51a150,
        'Más de 150': r.masDe150,
        '% a tiempo': r.pctATiempo,
      })),
      'Cumplimiento',
      `cumplimiento-mantenimiento-${todayIso()}.xlsx`,
    );

  return (
    <div className="space-y-6">
      <StatGrid>
        <Stat label="A tiempo" value={pct(sum('aTiempo'))} tone="good" hint={`${sum('aTiempo')} de ${total} servicios`} />
        <Stat label="Hasta 50 h tarde" value={pct(sum('hasta50'))} />
        <Stat label="51 a 150 h tarde" value={pct(sum('de51a150'))} tone="warn" />
        <Stat label="Más de 150 h tarde" value={pct(sum('masDe150'))} tone={sum('masDe150') > 0 ? 'bad' : 'neutral'} />
      </StatGrid>
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card
        title="Cumplimiento por máquina y tipo"
        action={<Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportExcel} disabled={!rows?.length}>Excel</Button>}
        padded={false}
      >
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          <Field label="Obra">
            <select className={inputClass} value={obra} onChange={(e) => setObra(e.target.value)}>
              <option value="">Todas</option>
              {refs.worksites.map((w) => (
                <option key={w.id} value={w.id}>{w.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Emitidas desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
        </div>
        {rows === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Todavía no hay servicios realizados con horas ideales" help="El informe se arma con las órdenes realizadas que tienen horas ideales y reales." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Máquina</th>
                  <th className="px-4 py-2.5">Tipo</th>
                  <th className="px-4 py-2.5 text-right">Servicios</th>
                  <th className="px-4 py-2.5 text-right">Atraso promedio</th>
                  <th className="px-4 py-2.5 text-right">A tiempo</th>
                  <th className="px-4 py-2.5 text-right">Hasta 50</th>
                  <th className="px-4 py-2.5 text-right">51 a 150</th>
                  <th className="px-4 py-2.5 text-right">Más de 150</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={`${r.machine.id}-${r.tipo}`}>
                    <td className="px-4 py-2.5"><span className="font-mono font-semibold">{r.machine.codigo}</span> <span className="text-xs text-slate-500">{r.machine.descripcion}</span></td>
                    <td className="px-4 py-2.5">{r.tipo}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.cantidad}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.diferenciaPromedio > 0 ? '+' : ''}{formatQty(r.diferenciaPromedio)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.aTiempo} <span className="text-xs text-slate-400">({r.pctATiempo} %)</span></td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.hasta50}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.de51a150}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.masDe150}</td>
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
