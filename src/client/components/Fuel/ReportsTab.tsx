/**
 * @file components/Fuel/ReportsTab.tsx
 * @description Informes de combustibles: saldos por depósito y producto, consumo por máquina y
 * despachos a terceros. Reemplazan ACEITES Y GASOIL GLOBAL / FECHADO, CONSUMOS EN HORAS / KMS,
 * HORAS TRABAJADAS MAQUINAS y GASOIL PARTICULARES (~12 informes) del Access.
 */

import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { describeError } from '../../services/http';
import { fuelApi, type BalanceRow, type ConsumptionRow, type ThirdPartyRow } from '../../services/fuelApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { Button, Card, Field, Modal, StatusPill, cx, inputClass } from '../../ui';
import type { FuelRefs } from './common';

type Report = 'SALDOS' | 'CONSUMO' | 'TERCEROS';
const REPORT_LABEL: Record<Report, string> = { SALDOS: 'Saldos', CONSUMO: 'Consumo por máquina', TERCEROS: 'Terceros' };

export const ReportsTab: React.FC<{ refs: FuelRefs }> = ({ refs }) => {
  const [report, setReport] = useState<Report>('SALDOS');
  const [desde, setDesde] = useState(`${todayIso().slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(todayIso());
  const [deposito, setDeposito] = useState('');
  const [maquina, setMaquina] = useState('');
  const [producto, setProducto] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
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
        <Field label="Desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
        <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
        <Field label="Depósito">
          <select className={inputClass} value={deposito} onChange={(e) => setDeposito(e.target.value)}>
            <option value="">Todos</option>
            {refs.deposits.map((d) => (
              <option key={d.id} value={d.id}>{d.codigo} · {d.nombre}</option>
            ))}
          </select>
        </Field>
        {report === 'SALDOS' && (
          <Field label="Producto">
            <select className={inputClass} value={producto} onChange={(e) => setProducto(e.target.value)}>
              <option value="">Todos</option>
              {refs.products.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </Field>
        )}
        {report === 'CONSUMO' && (
          <Field label="Máquina">
            <select className={inputClass} value={maquina} onChange={(e) => setMaquina(e.target.value)}>
              <option value="">Todas</option>
              {refs.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.codigo} · {m.descripcion}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}
      {report === 'SALDOS' && <BalancesView filters={{ desde, hasta, deposito: deposito || undefined, producto: producto || undefined }} onError={setError} />}
      {report === 'CONSUMO' && <ConsumptionView filters={{ desde, hasta, deposito: deposito || undefined, maquina: maquina || undefined }} onError={setError} />}
      {report === 'TERCEROS' && <ThirdPartiesView filters={{ desde, hasta, deposito: deposito || undefined }} onError={setError} />}
    </Card>
  );
};

interface ViewProps<F> {
  filters: F;
  onError: (message: string | null) => void;
}

const BalancesView: React.FC<ViewProps<{ desde: string; hasta: string; deposito?: string; producto?: string }>> = ({ filters, onError }) => {
  const [rows, setRows] = useState<BalanceRow[] | null>(null);
  useEffect(() => {
    onError(null);
    fuelApi
      .balances(filters)
      .then((r) => setRows(r.filas))
      .catch((err) => onError(describeError(err)));
  }, [filters.desde, filters.hasta, filters.deposito, filters.producto]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportExcel = () =>
    rows &&
    exportRowsToExcel(
      rows.map((r) => ({ Depósito: `${r.deposito.codigo} ${r.deposito.nombre}`, Producto: r.producto.nombre, Unidad: r.producto.unidad, 'Saldo inicial': r.saldoInicial, Entradas: r.entradas, Salidas: r.salidas, Ajustes: r.ajustes, 'Saldo final': r.saldoFinal })),
      'Saldos',
      `saldos-combustible-${filters.hasta}.xlsx`,
    );

  if (rows === null) return <div className="p-6 text-sm text-slate-500">Calculando…</div>;
  if (rows.length === 0) return <div className="p-6 text-sm text-slate-500">No hay movimientos hasta esta fecha. Cargá un saldo inicial en «Entradas y ajustes».</div>;
  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportExcel}>Excel</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Depósito</th>
              <th className="px-4 py-2.5">Producto</th>
              <th className="px-4 py-2.5 text-right">Saldo inicial</th>
              <th className="px-4 py-2.5 text-right">Entradas</th>
              <th className="px-4 py-2.5 text-right">Salidas</th>
              <th className="px-4 py-2.5 text-right">Ajustes</th>
              <th className="px-4 py-2.5 text-right">Saldo final</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={`${r.deposito.id}-${r.producto.id}`}>
                <td className="px-4 py-2.5">{r.deposito.codigo} · {r.deposito.nombre}</td>
                <td className="px-4 py-2.5">{r.producto.nombre}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatQty(r.saldoInicial)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatQty(r.entradas)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatQty(r.salidas)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatQty(r.ajustes)}</td>
                <td className={cx('px-4 py-2.5 text-right font-mono font-semibold', r.negativo && 'text-rose-700')}>{formatQty(r.saldoFinal)} {r.producto.unidad.toLowerCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

const MOTIVO_LABEL: Record<string, string> = {
  PRIMERA_LECTURA: 'Primera lectura',
  SIN_LECTURA: 'Sin lectura',
  LECTURA_OBSERVADA: 'Lectura observada',
  SIN_AVANCE: 'Sin avance',
};

const ConsumptionView: React.FC<ViewProps<{ desde: string; hasta: string; deposito?: string; maquina?: string }>> = ({ filters, onError }) => {
  const [rows, setRows] = useState<ConsumptionRow[] | null>(null);
  const [detail, setDetail] = useState<ConsumptionRow | null>(null);
  useEffect(() => {
    onError(null);
    fuelApi
      .consumption(filters)
      .then((r) => setRows(r.maquinas))
      .catch((err) => onError(describeError(err)));
  }, [filters.desde, filters.hasta, filters.deposito, filters.maquina]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportExcel = () =>
    rows &&
    exportRowsToExcel(
      rows.map((r) => ({ Máquina: r.maquina.codigo, Descripción: r.maquina.descripcion, Cargas: r.cargas, Litros: r.litros, Recorrido: r.recorrido, Consumo: r.consumo, Unidad: r.unidad, 'Sin lectura': r.sinLectura, Observadas: r.observadas, Atípicas: r.atipicas })),
      'Consumo',
      `consumo-combustible-${filters.hasta}.xlsx`,
    );

  if (rows === null) return <div className="p-6 text-sm text-slate-500">Calculando…</div>;
  if (rows.length === 0) return <div className="p-6 text-sm text-slate-500">No hay despachos a máquinas en este período.</div>;
  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportExcel}>Excel</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Máquina</th>
              <th className="px-4 py-2.5 text-right">Cargas</th>
              <th className="px-4 py-2.5 text-right">Litros</th>
              <th className="px-4 py-2.5 text-right">Recorrido</th>
              <th className="px-4 py-2.5 text-right">Consumo</th>
              <th className="px-4 py-2.5">Calidad de datos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.maquina.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetail(r)}>
                <td className="px-4 py-2.5">{r.maquina.codigo} · {r.maquina.descripcion}</td>
                <td className="px-4 py-2.5 text-right font-mono">{r.cargas}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatQty(r.litros)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{r.recorrido > 0 ? `${formatQty(r.recorrido)} ${r.maquina.meterUnit.toLowerCase()}` : '—'}</td>
                <td className="px-4 py-2.5 text-right font-mono font-semibold">{r.consumo !== null ? `${formatQty(r.consumo)} ${r.unidad.toLowerCase()}` : '—'}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1 text-xs">
                    {r.sinLectura > 0 && <StatusPill tone="neutral">{r.sinLectura} sin lectura</StatusPill>}
                    {r.observadas > 0 && <StatusPill tone="warn">{r.observadas} observadas</StatusPill>}
                    {r.atipicas > 0 && <StatusPill tone="bad">{r.atipicas} atípicas</StatusPill>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && (
        <Modal title={`${detail.maquina.codigo} · ${detail.maquina.descripcion}`} size="lg" onClose={() => setDetail(null)} footer={<Button variant="ghost" onClick={() => setDetail(null)}>Cerrar</Button>}>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2 text-right">Litros</th>
                  <th className="px-3 py-2 text-right">Lectura</th>
                  <th className="px-3 py-2 text-right">Recorrido</th>
                  <th className="px-3 py-2 text-right">Consumo</th>
                  <th className="px-3 py-2">Nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.detalle.map((d) => (
                  <tr key={d.id} className={cx(d.atipica && 'bg-rose-50')}>
                    <td className="px-3 py-2">{formatDate(d.fecha)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatQty(d.litros)}</td>
                    <td className="px-3 py-2 text-right font-mono">{d.lectura !== null ? formatQty(d.lectura) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{d.recorrido !== null ? formatQty(d.recorrido) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{d.consumo !== null ? formatQty(d.consumo) : '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{d.atipica ? 'Atípica' : d.motivo ? MOTIVO_LABEL[d.motivo] : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
};

const ThirdPartiesView: React.FC<ViewProps<{ desde: string; hasta: string; deposito?: string }>> = ({ filters, onError }) => {
  const [rows, setRows] = useState<ThirdPartyRow[] | null>(null);
  useEffect(() => {
    onError(null);
    fuelApi
      .thirdParties(filters)
      .then((r) => setRows(r.terceros))
      .catch((err) => onError(describeError(err)));
  }, [filters.desde, filters.hasta, filters.deposito]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportExcel = () =>
    rows &&
    exportRowsToExcel(
      rows.flatMap((t) => t.despachos.map((d) => ({ Chapa: t.chapa, Fecha: formatDate(d.fecha), Depósito: d.deposit.codigo, Vale: d.numero, Remisión: d.remision ?? '', 'Proveído a': d.proveidoA ?? '', Litros: d.lines.reduce((a, l) => a + l.cantidad, 0) }))),
      'Terceros',
      `combustible-terceros-${filters.hasta}.xlsx`,
    );

  if (rows === null) return <div className="p-6 text-sm text-slate-500">Calculando…</div>;
  if (rows.length === 0) return <div className="p-6 text-sm text-slate-500">No hay despachos a terceros en este período.</div>;
  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportExcel}>Excel</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Chapa</th>
              <th className="px-4 py-2.5 text-right">Cargas</th>
              <th className="px-4 py-2.5 text-right">Litros</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((t) => (
              <tr key={t.chapa}>
                <td className="px-4 py-2.5 font-mono font-semibold">{t.chapa}</td>
                <td className="px-4 py-2.5 text-right font-mono">{t.cargas}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatQty(t.litros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
