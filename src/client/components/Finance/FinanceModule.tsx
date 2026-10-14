/**
 * @file components/Finance/FinanceModule.tsx
 * @description Migración de los módulos financieros y de pagos a proveedores:
 * - Form_CAJA CHICA
 * - Form_PROVEEDORES A PAGAR
 * - Form_SFONDOS (Solicitudes de Fondos)
 * - Form_SFONDOS PEND & Form_SFONDOS PEND POR PROVEDDOR
 * - Form_SOLIC DE FONDOS PEND TUBULAR
 *
 * Mapeo de eventos VBA:
 * - Comando40_Click() -> DoCmd.OpenReport "CAJA CHICA" / "SF"
 * - Comando42_Click() -> DoCmd.OutputTo acReport, "POR PROVEEDOR FECHADO"
 * - Comando43_Click() -> DoCmd.SendObject acReport, "SF" (Envío por email)
 * - Comando44_Click() -> DoCmd.GoToRecord , , acNewRec / OpenReport acNormal
 * - Comando47_Click() -> DoCmd.OpenReport "ESTADO DE CUENTAS POR SUPLIDOR"
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building,
  Check,
  CreditCard,
  DollarSign,
  Filter,
  Plus,
  Receipt,
  Search,
  Send,
  Sliders,
  Wallet,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { FundRequest, PettyCashExpense, SupplierAccount } from '../../../shared/erp';
import { formatCurrency, validateFundRequest } from '../../utils/legacyCalculations';

export const FinanceModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'SFONDOS' | 'CAJA_CHICA' | 'PROVEEDORES'>('SFONDOS');
  const [fundRequests, setFundRequests] = useState<FundRequest[]>([]);
  const [pettyCash, setPettyCash] = useState<PettyCashExpense[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filtros especiales de los formularios de Access
  const [filterPendingOnly, setFilterPendingOnly] = useState<boolean>(false);
  const [filterTubularOnly, setFilterTubularOnly] = useState<boolean>(false); // Form_SOLIC DE FONDOS PEND TUBULAR
  const [supplierFilter, setSupplierFilter] = useState<string>('');

  // Modal para nueva solicitud de fondos (acNewRec)
  const [showNewSfModal, setShowNewSfModal] = useState<boolean>(false);
  const [newSfData, setNewSfData] = useState<Partial<FundRequest>>({
    proveedor: '',
    monto: 100000,
    concepto: '',
    esTubular: false,
  });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);


  useEffect(() => {
    loadData();
  }, [filterPendingOnly, filterTubularOnly, supplierFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sfList, pcList, supList] = await Promise.all([
        ErpApi.getFundRequests({
          pendingOnly: filterPendingOnly,
          tubularOnly: filterTubularOnly,
          supplier: supplierFilter,
        }),
        ErpApi.getPettyCashExpenses(),
        ErpApi.getSuppliers(),
      ]);
      setFundRequests(sfList);
      setPettyCash(pcList);
      setSuppliers(supList);
    } catch (err) {
      console.error('Error cargando tesorería:', err);
    } finally {
      setLoading(false);
    }
  };

  // Reemplazo de Comando44_Click(): DoCmd.GoToRecord , , acNewRec
  const handleCreateFundRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = validateFundRequest(newSfData);
    if (!val.isValid) {
      setValidationErrors(val.errors);
      return;
    }
    setValidationErrors([]);

    const newReq: FundRequest = {
      id: `sf-${Date.now()}`,
      numeroSolicitud: `SF-2024-${String(fundRequests.length + 44).padStart(3, '0')}`,
      fecha: new Date().toISOString().split('T')[0],
      proveedor: newSfData.proveedor || 'Proveedor General',
      monto: Number(newSfData.monto) || 0,
      concepto: newSfData.concepto || 'Gastos de obra',
      estado: 'PENDIENTE',
      esTubular: !!newSfData.esTubular,
    };

    try {
      await ErpApi.saveFundRequest(newReq);
      setFundRequests([newReq, ...fundRequests]);
      setShowNewSfModal(false);
      setNewSfData({ proveedor: '', monto: 100000, concepto: '', esTubular: false });
    } catch (err) {
      console.error('Error guardando SF:', err);
    }
  };

  const handleApproveFundRequest = async (sf: FundRequest) => {
    const updated: FundRequest = {
      ...sf,
      estado: 'APROBADA',
      autorizadoPor: 'Gerencia Operativa',
      fechaPagoEstimada: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
    };
    await ErpApi.saveFundRequest(updated);
    setFundRequests(fundRequests.map((item) => (item.id === sf.id ? updated : item)));
  };

  const totalPendingAmount = fundRequests
    .filter((sf) => sf.estado === 'PENDIENTE')
    .reduce((acc, curr) => acc + curr.monto, 0);

  const totalPettyCashAmount = pettyCash.reduce((acc, curr) => acc + curr.monto, 0);

  return (
    <div id="finance-module-container" className="space-y-6">
      {/* Navegación por Pestañas de Tesorería */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-3 gap-4">
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('SFONDOS')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors flex items-center space-x-2 ${
              activeTab === 'SFONDOS'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Wallet className="w-4 h-4" />
            <span>Solicitudes de Fondos</span>
          </button>

          <button
            onClick={() => setActiveTab('CAJA_CHICA')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors flex items-center space-x-2 ${
              activeTab === 'CAJA_CHICA'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Caja Chica</span>
          </button>

          <button
            onClick={() => setActiveTab('PROVEEDORES')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors flex items-center space-x-2 ${
              activeTab === 'PROVEEDORES'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Building className="w-4 h-4" />
            <span>Proveedores a Pagar</span>
          </button>
        </div>

        {/* Acciones Globales del Submódulo */}
        <div className="flex items-center space-x-2">
          {activeTab === 'SFONDOS' && (
            <button
              id="btn-new-fund-request"
              onClick={() => setShowNewSfModal(true)}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5 mr-1 text-emerald-600" />
              Nueva Solicitud
            </button>
          )}

        </div>
      </div>


      {/* VISTA 1: SOLICITUDES DE FONDOS */}
      {activeTab === 'SFONDOS' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                Filtros:
              </span>

              <button
                onClick={() => setFilterPendingOnly(!filterPendingOnly)}
                className={`px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
                  filterPendingOnly
                    ? 'bg-amber-100 border-amber-300 text-amber-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Solo Pendientes ({fundRequests.filter((s) => s.estado === 'PENDIENTE').length})
              </button>

              <button
                onClick={() => setFilterTubularOnly(!filterTubularOnly)}
                className={`px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
                  filterTubularOnly
                    ? 'bg-blue-100 border-blue-300 text-blue-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Partida Tubular
              </button>

              {/* Filtro por Proveedor */}
              <input
                type="text"
                placeholder="Filtrar por proveedor..."
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
              />
            </div>

            {/* Total acumulado pendiente */}
            <div className="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs">
              <span className="text-slate-500 mr-2">Total Pendiente:</span>
              <span className="font-bold text-slate-900">{formatCurrency(totalPendingAmount)}</span>
            </div>
          </div>

          {/* Tabla Principal de Solicitudes de Fondos */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Solicitud</th>
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Proveedor / Beneficiario</th>
                  <th className="p-3">Concepto</th>
                  <th className="p-3 text-right">Monto</th>
                  <th className="p-3 text-center">Estado</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fundRequests.map((sf) => (
                  <tr key={sf.id} className="hover:bg-slate-50/80">
                    <td className="p-3 font-mono font-bold text-slate-900">
                      {sf.numeroSolicitud}
                      {sf.esTubular && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-800">
                          TUBULAR
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">{sf.fecha}</td>
                    <td className="p-3 font-semibold text-slate-800">{sf.proveedor}</td>
                    <td className="p-3 text-slate-600 max-w-xs truncate">{sf.concepto}</td>
                    <td className="p-3 text-right font-mono font-bold text-emerald-700 text-sm">
                      {formatCurrency(sf.monto)}
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          sf.estado === 'APROBADA'
                            ? 'bg-emerald-100 text-emerald-800'
                            : sf.estado === 'PENDIENTE'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {sf.estado}
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                      {sf.estado === 'PENDIENTE' && (
                        <button
                          onClick={() => handleApproveFundRequest(sf)}
                          className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded text-[11px] font-semibold transition-colors"
                        >
                          Aprobar
                        </button>
                      )}


                    </td>
                  </tr>
                ))}
                {fundRequests.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      No se encontraron solicitudes con los criterios seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VISTA 2: CAJA CHICA (Form_CAJA CHICA) */}
      {activeTab === 'CAJA_CHICA' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex justify-between items-center text-xs">
            <div>
              <h3 className="font-bold text-slate-800">Libro de Gastos Menores y Caja Chica</h3>
              <p className="text-slate-500">Comprobantes, vales y facturas de imputación directa.</p>
            </div>
            <div className="flex items-center space-x-3">
              <div className="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 font-mono text-xs">
                <span className="text-slate-500 mr-2">Total Erogado:</span>
                <span className="font-bold text-slate-900">{formatCurrency(totalPettyCashAmount)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Comprobante</th>
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Proveedor</th>
                  <th className="p-3">Concepto / Detalle</th>
                  <th className="p-3">Imputación</th>
                  <th className="p-3">Equipo</th>
                  <th className="p-3 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pettyCash.map((pc) => (
                  <tr key={pc.id} className="hover:bg-slate-50/80">
                    <td className="p-3 font-mono font-bold text-slate-900">{pc.comprobanteNumero}</td>
                    <td className="p-3 text-slate-600">{pc.fecha}</td>
                    <td className="p-3 font-semibold text-slate-800">{pc.proveedor}</td>
                    <td className="p-3 text-slate-600">{pc.concepto}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                        {pc.imputacion}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-blue-700">{pc.codmaqAsignado || '-'}</td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900">
                      {formatCurrency(pc.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VISTA 3: PROVEEDORES A PAGAR (Form_PROVEEDORES A PAGAR) */}
      {activeTab === 'PROVEEDORES' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex justify-between items-center text-xs">
            <div>
              <h3 className="font-bold text-slate-800">Cuentas Corrientes y Saldos a Pagar</h3>
              <p className="text-slate-500">
                Gestión de compromisos financieros por suplidor.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="p-3">Código</th>
                  <th className="p-3">Razón Social</th>
                  <th className="p-3">CUIT</th>
                  <th className="p-3">Condición de Pago</th>
                  <th className="p-3 text-center">Facturas Pend.</th>
                  <th className="p-3 text-right">Saldo Pendiente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suppliers.map((sup) => (
                  <tr key={sup.id} className="hover:bg-slate-50/80">
                    <td className="p-3 font-mono font-bold text-slate-900">{sup.codigoProveedor}</td>
                    <td className="p-3 font-semibold text-slate-800">{sup.nombreProveedor}</td>
                    <td className="p-3 font-mono text-slate-600">{sup.cuit}</td>
                    <td className="p-3 text-slate-600">{sup.condicionPago}</td>
                    <td className="p-3 text-center font-bold text-amber-700">
                      {sup.facturasPendientes}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900 text-sm">
                      {formatCurrency(sup.saldoPendiente)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Form_SFONDOS -> acNewRec */}
      {showNewSfModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-800">
                Nueva Solicitud de Fondos
              </h3>
              <button
                onClick={() => setShowNewSfModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            {validationErrors.length > 0 && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs space-y-1">
                {validationErrors.map((err, i) => (
                  <div key={i} className="flex items-center space-x-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleCreateFundRequest} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Proveedor *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Finning Caterpillar Argentina"
                  value={newSfData.proveedor}
                  onChange={(e) => setNewSfData({ ...newSfData, proveedor: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Monto Solicitado ($) *</label>
                <input
                  type="number"
                  required
                  value={newSfData.monto}
                  onChange={(e) =>
                    setNewSfData({ ...newSfData, monto: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Concepto / Destino del Gasto *</label>
                <textarea
                  rows={2}
                  required
                  placeholder="Justificación del pedido de fondos..."
                  value={newSfData.concepto}
                  onChange={(e) => setNewSfData({ ...newSfData, concepto: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="chk-tubular"
                  checked={newSfData.esTubular || false}
                  onChange={(e) => setNewSfData({ ...newSfData, esTubular: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="chk-tubular" className="text-slate-700 font-medium cursor-pointer">
                  Afectación a Partida Tubular
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewSfModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-xs"
                >
                  Crear Solicitud
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
