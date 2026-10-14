/**
 * @file components/Dashboard/DashboardOverview.tsx
 * @description Panel de Control Central Operativo.
 * Diseñado para arrancar el día de trabajo con visión clara de maquinaria,
 * horas cargadas, alertas de mantenimiento y acceso rápido a carga de datos.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Boxes,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Fuel,
  Gauge,
  Plus,
  Sparkles,
  Truck,
  UploadCloud,
  Wallet,
  Wrench,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { EquipmentServiceRecord, Machine, MaterialOrder, TotalizerReading } from '../../types/erp';
import { exportFullDatabaseToExcel } from '../../utils/excelExporter';
import { formatCurrency, formatHours } from '../../utils/legacyCalculations';
import { AppModule } from '../Navigation/Sidebar';

interface DashboardOverviewProps {
  onNavigate: (module: AppModule) => void;
  onOpenReport?: (reportName: string, data: any) => void;
  onOpenQuickAction?: () => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  onNavigate,
  onOpenReport,
  onOpenQuickAction,
}) => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [services, setServices] = useState<EquipmentServiceRecord[]>([]);
  const [orders, setOrders] = useState<MaterialOrder[]>([]);
  const [totalizers, setTotalizers] = useState<TotalizerReading[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const [machList, svcList, ordList, totList] = await Promise.all([
        ErpApi.getMachines(),
        ErpApi.getServiceRecords(),
        ErpApi.getOrders(),
        ErpApi.getTotalizers(),
      ]);
      setMachines(machList);
      setServices(svcList);
      setOrders(ordList);
      setTotalizers(totList);
    } catch (err) {
      console.error('Error cargando métricas:', err);
    } finally {
      setLoading(false);
    }
  };

  const operationalCount = machines.filter((m) => m.estado === 'OPERATIVA').length;
  const inWorkshopCount = machines.filter((m) => m.estado === 'EN_MANTENIMIENTO' || m.estado === 'EN_TALLER').length;
  const pendingOrders = orders.filter((o) => o.estado === 'PENDIENTE');
  const activeServices = services.filter((s) => s.estado === 'EN_PROCESO');

  // Máquinas que se acercan a ciclo de 1000/2000 hs
  const nearServiceMachines = machines.filter((m) => {
    const hoursSinceService = m.horasActuales - (m.ultimoServicioHoras || 0);
    return hoursSinceService >= 850;
  });

  const recentTotalizers = [...totalizers].reverse().slice(0, 5);

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-500 space-y-3">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto" />
        <p className="text-xs font-semibold">Cargando estado operativo de la empresa...</p>
      </div>
    );
  }

  return (
    <div id="dashboard-overview-container" className="space-y-6">
      {/* Encabezado Limpio del Dashboard (Fondo blanco y acentos en azul) */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 inline-block"></span>
            <h2 className="text-lg font-black text-slate-900 tracking-tight">
              Panel de Control de Flota y Taller
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Monitoreo en tiempo real de maquinarias, partes diarios (DifK) y órdenes de taller.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onOpenQuickAction && (
            <button
              onClick={onOpenQuickAction}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>+ Registrar Parte Diario</span>
            </button>
          )}

          <button
            onClick={() => onNavigate('EXCEL_MIGRATION')}
            className="px-3.5 py-2 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4 text-blue-600" />
            <span>Migrar 16 Planillas</span>
          </button>

          <button
            onClick={() => exportFullDatabaseToExcel()}
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl border border-slate-200 transition-all flex items-center gap-1.5"
          >
            <ArrowDownToLine className="w-3.5 h-3.5 text-blue-600" />
            <span>Exportar Excel</span>
          </button>
        </div>
      </div>

      {/* 4 Métricas Clave (Fondo blanco, detalles en azul) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Flota */}
        <div
          onClick={() => onNavigate('MACHINES')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs hover:border-blue-500 transition-all cursor-pointer space-y-2 group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Flota Total</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {machines.length}{' '}
            <span className="text-xs font-semibold text-slate-500">equipos</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <span className="text-blue-700 font-bold">{operationalCount} Operativas</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-500">{inWorkshopCount} En Taller</span>
          </div>
        </div>

        {/* Partes Diarios y Horómetros */}
        <div
          onClick={() => onNavigate('DAILY_REPORTS')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs hover:border-blue-500 transition-all cursor-pointer space-y-2 group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Partes Diarios</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {totalizers.length}{' '}
            <span className="text-xs font-semibold text-slate-500">lecturas</span>
          </div>
          <div className="text-xs text-blue-700 font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
            <span>Cálculo DifK automático</span>
          </div>
        </div>

        {/* Mantenimientos */}
        <div
          onClick={() => onNavigate('SERVICES')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs hover:border-blue-500 transition-all cursor-pointer space-y-2 group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Taller y Services</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <Wrench className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {activeServices.length}{' '}
            <span className="text-xs font-semibold text-slate-500">en proceso</span>
          </div>
          <div className="text-xs text-slate-700 font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block"></span>
            <span>{nearServiceMachines.length} próximas a ciclo 1000/2000 hs</span>
          </div>
        </div>

        {/* Pedidos */}
        <div
          onClick={() => onNavigate('ORDERS')}
          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs hover:border-blue-500 transition-all cursor-pointer space-y-2 group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Pedidos Repuestos</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {pendingOrders.length}{' '}
            <span className="text-xs font-semibold text-slate-500">pendientes</span>
          </div>
          <div className="text-xs text-blue-700 font-semibold">
            {orders.length} órdenes (IVA 21% desglosado)
          </div>
        </div>
      </div>

      {/* Contenido Principal: Estado de Flota + Partes Recientes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda: Flota de Maquinaria */}
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                Estado Actual de la Flota en Frentes de Obra
              </h3>
              <p className="text-[11px] text-slate-500">
                Horómetros acumulados y ubicación operativa
              </p>
            </div>
            <button
              onClick={() => onNavigate('MACHINES')}
              className="text-xs font-bold text-blue-600 hover:text-blue-800"
            >
              Ver toda la flota →
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {machines.slice(0, 5).map((mach) => (
              <div
                key={mach.id}
                className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 px-2 rounded-xl transition-colors"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-black font-mono text-xs shrink-0">
                    {mach.codmaq.slice(0, 4)}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-black text-slate-900 truncate">
                      {mach.codmaq} — {mach.descripcion}
                    </h4>
                    <p className="text-[11px] text-slate-500 truncate">
                      {mach.ubicacionActual}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 shrink-0 text-right">
                  <div>
                    <span className="font-mono font-black text-xs text-slate-900 block">
                      {formatHours(mach.horasActuales)}
                    </span>
                    <span className="text-[10px] text-slate-400">horómetro</span>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      mach.estado === 'OPERATIVA'
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {mach.estado}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Columna Derecha: Últimas Lecturas de Horómetro (DifK) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                Partes Diarios Recientes
              </h3>
              <p className="text-[11px] text-slate-500">Últimos registros de obra</p>
            </div>
            <button
              onClick={() => onNavigate('DAILY_REPORTS')}
              className="text-xs font-bold text-blue-600 hover:text-blue-800"
            >
              Ver todos →
            </button>
          </div>

          {recentTotalizers.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No hay partes cargados aún. Use el botón superior para registrar uno.
            </div>
          ) : (
            <div className="space-y-3">
              {recentTotalizers.map((tot) => (
                <div
                  key={tot.id}
                  className="p-3 bg-white hover:bg-slate-50/70 rounded-xl border border-slate-200 text-xs space-y-1.5 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-blue-800">{tot.codmaq}</span>
                    <span className="text-[11px] text-slate-500">{tot.fecha}</span>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600">Horómetro: <strong>{tot.horas.toFixed(1)} hs</strong></span>
                    <span className="font-mono font-black text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                      +{tot.difK.toFixed(1)} hs
                    </span>
                  </div>

                  {tot.litrosGasoil > 0 && (
                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Fuel className="w-3 h-3 text-blue-600" />
                      <span>{tot.litrosGasoil} Lts gasoil • {tot.chofer || 'Operador'}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
