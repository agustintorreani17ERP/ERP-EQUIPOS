/**
 * @file components/Suppliers/SupplierDetail.tsx
 * @description Ficha de proveedor: datos y estado de cuenta por moneda con saldo corrido, registro de
 * pagos (a cuenta o imputados a una SF) y estado de cuenta imprimible. Reemplaza ESTADO DE CUENTAS
 * POR SUPLIDOR y PROVEEDORES A PAGAR del Access, que dependían de pagos casi nunca cargados.
 */

import React, { useEffect, useState } from 'react';
import { formatDocNumber } from '../../../shared/finance';
import { Download, Printer } from 'lucide-react';
import type { CompanySettings } from '../../../shared/erp';
import type { FundRequestDto } from '../../../shared/finance';
import { formatCurrency } from '../../../shared/calculations';
import { describeError } from '../../services/http';
import { financeApi, type StatementReport } from '../../services/financeApi';
import { mastersApi, type Supplier } from '../../services/mastersApi';
import { printArea } from '../../utils/print';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, todayIso } from '../../utils/format';
import { Button, Card, Field, Modal, cx, inputClass } from '../../ui';

export const SupplierDetail: React.FC<{
  supplier: Supplier | null;
  settings: CompanySettings;
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
}> = ({ supplier, settings, onClose, onSaved }) => {
  const [current, setCurrent] = useState<Supplier | null>(supplier);
  const [tab, setTab] = useState<'DATOS' | 'CUENTA'>(supplier ? 'CUENTA' : 'DATOS');
  const [codigo, setCodigo] = useState(supplier?.codigo ?? '');
  const [nombre, setNombre] = useState(supplier?.nombre ?? '');
  const [ruc, setRuc] = useState(supplier?.ruc ?? '');
  const [errors, setErrors] = useState<string[]>([]);

  const save = async () => {
    if (!codigo.trim() || !nombre.trim()) {
      setErrors(['El código y el nombre son obligatorios.']);
      return;
    }
    try {
      const body = { codigo: codigo.trim(), nombre: nombre.trim(), ruc: ruc.trim() || null };
      const saved = current ? await mastersApi.updateSupplier(current.id, body) : await mastersApi.createSupplier(body);
      setCurrent(saved);
      setErrors([]);
      onSaved(saved);
    } catch (err) {
      setErrors([describeError(err)]);
    }
  };

  return (
    <Modal
      title={current ? `${current.codigo} · ${current.nombre}` : 'Nuevo proveedor'}
      size="lg"
      onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>Cerrar</Button>}
    >
      <div className="space-y-5">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
          {(['DATOS', 'CUENTA'] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={t === 'CUENTA' && !current}
              onClick={() => setTab(t)}
              className={cx(
                'whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition disabled:opacity-40',
                tab === t ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50',
              )}
            >
              {t === 'DATOS' ? 'Datos' : 'Estado de cuenta'}
            </button>
          ))}
        </div>

        {tab === 'DATOS' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Código"><input className={inputClass} value={codigo} onChange={(e) => setCodigo(e.target.value)} /></Field>
              <Field label="Nombre"><input className={inputClass} value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
              <Field label="RUC"><input className={inputClass} value={ruc} onChange={(e) => setRuc(e.target.value)} /></Field>
            </div>
            <Button variant="primary" onClick={save}>Guardar proveedor</Button>
            {errors.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errors.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'CUENTA' && current && <AccountTab supplier={current} settings={settings} />}
      </div>
    </Modal>
  );
};

const AccountTab: React.FC<{ supplier: Supplier; settings: CompanySettings }> = ({ supplier, settings }) => {
  const [desde, setDesde] = useState(`${todayIso().slice(0, 4)}-01-01`);
  const [hasta, setHasta] = useState(todayIso());
  const [report, setReport] = useState<StatementReport | null>(null);
  const [pending, setPending] = useState<FundRequestDto[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [printing, setPrinting] = useState(false);

  const [payFecha, setPayFecha] = useState(todayIso());
  const [payMonto, setPayMonto] = useState('');
  const [payCurrency, setPayCurrency] = useState(settings.currency);
  const [payRef, setPayRef] = useState('');
  const [payFund, setPayFund] = useState('');

  useEffect(() => {
    setErrors([]);
    Promise.all([financeApi.statement(supplier.id, desde, hasta), financeApi.fundRequests({ proveedor: supplier.id })])
      .then(([r, sfs]) => {
        setReport(r);
        setPending(sfs.filter((s) => s.estado === 'SOLICITADA' || s.estado === 'PAGO_PARCIAL'));
      })
      .catch((err) => setErrors([describeError(err)]));
  }, [supplier.id, desde, hasta, reloadKey]);

  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(false);
    return restore;
  }, [printing]);

  const imputable = pending.filter((s) => s.currency === payCurrency);

  const pay = async () => {
    setMessage(null);
    const monto = Number(payMonto);
    if (!Number.isFinite(monto) || monto <= 0) {
      setErrors(['Ingresá un monto mayor a 0.']);
      return;
    }
    try {
      await financeApi.paySupplier(supplier.id, { fecha: payFecha, monto, currency: payCurrency, referencia: payRef || null, fundRequestId: payFund || null });
      setErrors([]);
      setMessage('Pago registrado.');
      setPayMonto('');
      setPayRef('');
      setPayFund('');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setErrors([describeError(err)]);
    }
  };

  const exportExcel = () => {
    if (!report) return;
    exportRowsToExcel(
      report.monedas.flatMap((m) =>
        m.movimientos.map((l) => ({
          Moneda: m.currency,
          Fecha: formatDate(l.fecha),
          Tipo: l.tipo === 'CARGO' ? 'Cargo' : 'Pago',
          Documento: l.documento,
          Detalle: l.descripcion,
          Monto: l.monto,
          Saldo: l.saldo,
        })),
      ),
      'Estado de cuenta',
      `estado-de-cuenta-${supplier.codigo}-${hasta}.xlsx`,
    );
  };

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} disabled={!report} onClick={() => setPrinting(true)}>Imprimir</Button>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!report} onClick={exportExcel}>Excel</Button>
          </div>
        </div>

        {report && report.monedas.length === 0 && (
          <p className="text-sm text-slate-500">Este proveedor todavía no tiene cargos ni pagos. Los cargos salen de las SF y de los renglones de caja chica a crédito.</p>
        )}

        {report?.monedas.map((m) => (
          <div key={m.currency}>
          <Card title={`Cuenta en ${m.currency}`} padded={false}>
            <div className="grid gap-2 border-b border-slate-100 px-5 py-3 text-sm sm:grid-cols-4">
              <div>Saldo inicial <span className="font-semibold">{formatCurrency(m.saldoInicial, m.currency)}</span></div>
              <div>Cargos <span className="font-semibold">{formatCurrency(m.totalCargos, m.currency)}</span></div>
              <div>Pagos <span className="font-semibold">{formatCurrency(m.totalPagos, m.currency)}</span></div>
              <div>Saldo final <span className="font-semibold">{formatCurrency(m.saldoFinal, m.currency)}</span></div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Fecha</th>
                    <th className="px-4 py-2">Documento</th>
                    <th className="px-4 py-2">Detalle</th>
                    <th className="px-4 py-2 text-right">Cargo</th>
                    <th className="px-4 py-2 text-right">Pago</th>
                    <th className="px-4 py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {m.movimientos.length === 0 && <tr><td colSpan={6} className="px-4 py-3 text-slate-500">Sin movimientos en el período.</td></tr>}
                  {m.movimientos.map((l, i) => (
                    <tr key={`${l.documento}-${i}`}>
                      <td className="px-4 py-2">{formatDate(l.fecha)}</td>
                      <td className="px-4 py-2">{l.documento}</td>
                      <td className="max-w-xs truncate px-4 py-2 text-slate-600">{l.descripcion}</td>
                      <td className="px-4 py-2 text-right font-mono">{l.tipo === 'CARGO' ? formatCurrency(l.monto, m.currency) : ''}</td>
                      <td className="px-4 py-2 text-right font-mono">{l.tipo === 'PAGO' ? formatCurrency(l.monto, m.currency) : ''}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">{formatCurrency(l.saldo, m.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          </div>
        ))}

        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800">Registrar pago</h3>
          <div className="grid gap-3 sm:grid-cols-5">
            <Field label="Fecha"><input type="date" className={inputClass} value={payFecha} onChange={(e) => setPayFecha(e.target.value)} /></Field>
            <Field label="Monto"><input type="number" min="0" step="any" className={cx(inputClass, 'text-right')} value={payMonto} onChange={(e) => setPayMonto(e.target.value)} /></Field>
            <Field label="Moneda">
              <select className={inputClass} value={payCurrency} onChange={(e) => { setPayCurrency(e.target.value); setPayFund(''); }}>
                {[settings.currency, settings.secondaryCurrency].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Referencia"><input className={inputClass} value={payRef} onChange={(e) => setPayRef(e.target.value)} /></Field>
            <Field label="Imputar a" hint="Opcional">
              <select className={inputClass} value={payFund} onChange={(e) => setPayFund(e.target.value)}>
                <option value="">Pago a cuenta</option>
                {imputable.map((s) => (
                  <option key={s.id} value={s.id}>SF Nº {formatDocNumber(s.numero, s.anio)} · saldo {formatCurrency(s.saldo, s.currency)}</option>
                ))}
              </select>
            </Field>
          </div>
          <Button variant="primary" onClick={pay}>Registrar pago</Button>
        </div>

        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
        {errors.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
      </div>

      {printing && report && (
        <div className="print-area text-sm text-black">
          <div className="mb-4 border-b border-black pb-2">
            <div className="text-lg font-bold">Estado de cuenta</div>
            <div>{report.supplier.codigo} · {report.supplier.nombre}{report.supplier.ruc ? ` · RUC ${report.supplier.ruc}` : ''}</div>
            <div>Del {formatDate(report.desde)} al {formatDate(report.hasta)}</div>
          </div>
          {report.monedas.map((m) => (
            <div key={m.currency} className="mb-6">
              <div className="mb-1 font-bold">Cuenta en {m.currency} · saldo inicial {formatCurrency(m.saldoInicial, m.currency)}</div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-black text-left">
                    <th className="py-1">Fecha</th><th className="py-1">Documento</th><th className="py-1">Detalle</th>
                    <th className="py-1 text-right">Cargo</th><th className="py-1 text-right">Pago</th><th className="py-1 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {m.movimientos.map((l, i) => (
                    <tr key={`${l.documento}-${i}`} className="border-b border-slate-300">
                      <td className="py-1">{formatDate(l.fecha)}</td><td className="py-1">{l.documento}</td><td className="py-1">{l.descripcion}</td>
                      <td className="py-1 text-right">{l.tipo === 'CARGO' ? formatCurrency(l.monto, m.currency) : ''}</td>
                      <td className="py-1 text-right">{l.tipo === 'PAGO' ? formatCurrency(l.monto, m.currency) : ''}</td>
                      <td className="py-1 text-right">{formatCurrency(l.saldo, m.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-right font-bold">Saldo a la fecha: {formatCurrency(m.saldoFinal, m.currency)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};
