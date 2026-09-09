/**
 * @file components/Navigation/Sidebar.tsx
 * @description Migración de Form_SWITCHBOARD (Panel Principal de Control de Access).
 * Proporciona el menú estructurado para los módulos operativos del ERP.
 */

import React from 'react';
import {
  Boxes,
  Briefcase,
  Calendar,
  FileCheck,
  FileText,
  Gauge,
  Layers,
  LayoutDashboard,
  Receipt,
  Truck,
  Wrench,
} from 'lucide-react';

export type AppModule = 'DASHBOARD' | 'MACHINES' | 'SERVICES' | 'ORDERS' | 'DAILY_REPORTS' | 'FINANCE' | 'REPORTS_CENTER' | 'MIGRATION_SPEC';

interface SidebarProps {
  currentModule: AppModule;
  onSelectModule: (module: AppModule) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentModule, onSelectModule }) => {
  const menuItems: { id: AppModule; label: string; vbaSource: string; icon: React.ReactNode }[] = [
    {
      id: 'DASHBOARD',
      label: 'Panel General',
      vbaSource: 'Form_SWITCHBOARD',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'MACHINES',
      label: 'Flota y Maquinarias',
      vbaSource: 'Form_AMAQUINAS / Form_A',
      icon: <Truck className="w-4 h-4" />,
    },
    {
      id: 'SERVICES',
      label: 'Servicios 1000/2000 HS',
      vbaSource: 'Form_CAT 416 / FREZADORA',
      icon: <Wrench className="w-4 h-4" />,
    },
    {
      id: 'ORDERS',
      label: 'Pedidos de Materiales',
      vbaSource: 'Form_AGREGAR/EDITAR PEDIDO',
      icon: <Boxes className="w-4 h-4" />,
    },
    {
      id: 'DAILY_REPORTS',
      label: 'Partes Diarios y Envíos',
      vbaSource: 'Form_PARTE DIARIO / ENVIO',
      icon: <Calendar className="w-4 h-4" />,
    },
    {
      id: 'FINANCE',
      label: 'Tesorería y Solicitudes',
      vbaSource: 'Form_SFONDOS / CAJA CHICA',
      icon: <Receipt className="w-4 h-4" />,
    },
    {
      id: 'REPORTS_CENTER',
      label: 'Centro de Informes',
      vbaSource: 'DoCmd.OpenReport (Global)',
      icon: <FileText className="w-4 h-4" />,
    },
    {
      id: 'MIGRATION_SPEC',
      label: 'Arquitectura y Mapeo VBA',
      vbaSource: 'Informe de Migración Senior',
      icon: <Layers className="w-4 h-4" />,
    },
  ];

  return (
    <aside
      id="erp-sidebar"
      className="w-72 bg-slate-900 text-slate-200 flex flex-col shrink-0 border-r border-slate-800"
    >
      {/* Encabezado del Sistema */}
      <div className="p-5 border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-black text-white text-base shadow-sm">
            ERP
          </div>
          <div>
            <h1 className="text-sm font-black tracking-tight text-white uppercase">
              Gestión Operativa
            </h1>
            <p className="text-[10px] text-slate-400 font-mono">
              Access v7.0 &rarr; React / TS
            </p>
          </div>
        </div>
      </div>

      {/* Menú de Navegación de Formularios */}
      <div className="p-3 flex-1 overflow-y-auto space-y-1">
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Formularios de Operación
        </div>

        {menuItems.map((item) => {
          const isActive = currentModule === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectModule(item.id)}
              className={`w-full text-left p-2.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-xs font-bold'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <span className={isActive ? 'text-white' : 'text-slate-400'}>{item.icon}</span>
                <span>{item.label}</span>
              </div>
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                  isActive ? 'bg-blue-700 text-blue-100' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {item.vbaSource.split(' ')[0]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Pie del Menú con Estado Operativo */}
      <div className="p-4 border-t border-slate-800 text-[11px] bg-slate-950/50">
        <div className="flex items-center justify-between text-slate-400">
          <span>Backend Conector:</span>
          <span className="text-emerald-400 font-mono font-bold">API REST Simulada</span>
        </div>
        <div className="flex items-center justify-between text-slate-400 mt-1">
          <span>Persistencia:</span>
          <span className="text-blue-400 font-mono">Local Storage Sync</span>
        </div>
      </div>
    </aside>
  );
};
