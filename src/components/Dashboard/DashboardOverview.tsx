/**
 * @file components/Dashboard/DashboardOverview.tsx
 * @description Panel de control central del ERP con resumen operativo y acceso rápido.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle,
  Clock,
  DollarSign,
  Fuel,
  Printer,
  Truck,
  Wallet,
  Wrench,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { EquipmentServiceRecord, FundRequest, Machine, MaterialOrder } from '../../types/erp';
import { formatCurrency, formatHours } from '../../utils/legacyCalculations';
import { AppModule } from '../Navigation/Sidebar';

interface DashboardOverviewProps {
  onNavigate: (module: AppModule) => void;
  onOpenReport: (reportName: string, data: any) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  onNavigate,
  onOpenReport,
}) => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [services, setServices] = useState<EquipmentServiceRecord[]>([]);
  const [orders, setOrders] = useState<MaterialOrder[]>([]);
  const [fundRequests, setFundRequests] = useState<FundRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const [machList, svcList, ordList, sfList] = await Promise.all([
        ErpApi.getMachines(),
        ErpApi.getServiceRecords(),
        ErpApi.getOrders(),
        ErpApi.getFundRequests(),
      ]);
      setMachines(machList);
      setServices(svcList);
      setOrders(ordList);
      setFundRequests(sfList);
    } catch (err) {
      console.error('Error cargando métricas:', err);
    } finally {
      setLoading(false);
    }
  };

  const pendingOrders = orders.filter((o) => o.estado === 'PENDIENTE');
  const pendingFunds = fundRequests.filter((sf) => sf.estado === 'PENDIENTE');
  const activeServices = services.filter((s) => s.estado === 'EN_PROCESO');

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
        Consolidando indicadores operativos del ERP...
      </div>
    );
  }

  return (
    <div id="dashboard-overview-container" className="space-y-6">
      {/* Tarjetas de Métricas Principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigate('MACHINES')}
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-blue-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Flota de Equipos</span>
            <Truck className="w-5 h-5 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {machines.length} <span className="text-xs font-medium text-slate-500">unidades</span>
          </div>
          <div className="text-xs text-emerald-600 font-semibold mt-1">
            {machines.filter((m) => m.estado === 'OPERATIVA').length} operativas en frente
          </div>
        </div>

        <div
          onClick={() => onNavigate('SERVICES')}
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-blue-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Mantenimiento</span>
            <Wrench className="w-5 h-5 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {activeServices.length} <span className="text-xs font-medium text-slate-500">en taller</span>
          </div>
          <div className="text-xs text-amber-600 font-semibold mt-1">
            Protocolos 1000/2000 HS activos
          </div>
        </div>

        <div
          onClick={() => onNavigate('ORDERS')}
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-blue-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Pedidos Repuestos</span>
            <Boxes className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {pendingOrders.length} <span className="text-xs font-medium text-slate-500">pendientes</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {orders.length} pedidos totales registrados
          </div>
        </div>

        <div
          onClick={() => onNavigate('FINANCE')}
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-blue-300 transition-all cursor-pointer"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Solicitudes Fondos</span>
            <Wallet className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2 font-mono">
            {pendingFunds.length}
          </div>
          <div className="text-xs text-emerald-600 font-semibold mt-1">
            {formatCurrency(pendingFunds.reduce((acc, c) => acc + c.monto, 0))} a autorizar
          </div>
        </div>
      </div>

      {/* Secciones Informativas Resumidas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tabla de Equipos y Estado de Servicio */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex justify-between items-center border-b border-slate-100 pb-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Estado de Maquinaria Pesada en Obra
            </h3>
            <button
              onClick={() => onNavigate('MACHINES')}
              className="text-xs text-blue-600 font-semibold hover:underline"
            >
              Ver Todas &rarr;
            </button>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 font-semibold">
                <tr>
                  <th className="p-2.5">Código</th>
                  <th className="p-2.5">Equipo</th>
                  <th className="p-2.5">Ubicación</th>
                  <th className="p-2.5 font-mono">Horas</th>
                  <th className="p-2.5 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {machines.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono font-bold text-slate-900">{m.codmaq}</td>
                    <td className="p-2.5 font-medium text-slate-800">{m.descripcion}</td>
                    <td className="p-2.5 text-slate-600">{m.ubicacionActual}</td>
                    <td className="p-2.5 font-mono font-bold text-blue-700">
                      {formatHours(m.horasActuales)}
                    </td>
                    <td className="p-2.5 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          m.estado === 'OPERATIVA'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {m.estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Acceso Directo a Informes de Access */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
            <Printer className="w-4 h-4 text-slate-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Informes Frecuentes (DoCmd.OpenReport)
            </h3>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => onOpenReport('Ficha general de equipos', machines[0])}
              className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-xs flex justify-between items-center"
            >
              <div>
                <span className="font-semibold text-slate-800 block">Ficha General de Equipos</span>
                <span className="text-[10px] text-slate-400">Form_AMAQUINAS</span>
              </div>
              <Printer className="w-3.5 h-3.5 text-slate-400" />
            </button>

            <button
              onClick={() => onOpenReport('PEDIDO DE MATERIALES A4', orders[0])}
              className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-xs flex justify-between items-center"
            >
              <div>
                <span className="font-semibold text-slate-800 block">Pedido de Materiales A4</span>
                <span className="text-[10px] text-slate-400">Form_AGREGAR PEDIDO</span>
              </div>
              <Printer className="w-3.5 h-3.5 text-slate-400" />
            </button>

            <button
              onClick={() => onOpenReport('SF', fundRequests[0])}
              className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-xs flex justify-between items-center"
            >
              <div>
                <span className="font-semibold text-slate-800 block">Solicitud de Fondos (SF)</span>
                <span className="text-[10px] text-slate-400">Form_SFONDOS</span>
              </div>
              <Printer className="w-3.5 h-3.5 text-slate-400" />
            </button>

            <button
              onClick={() => onOpenReport('CAJA CHICA', {})}
              className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-xs flex justify-between items-center"
            >
              <div>
                <span className="font-semibold text-slate-800 block">Libro de Caja Chica</span>
                <span className="text-[10px] text-slate-400">Form_CAJA CHICA</span>
              </div>
              <Printer className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
