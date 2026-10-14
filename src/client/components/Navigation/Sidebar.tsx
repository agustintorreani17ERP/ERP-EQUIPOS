/**
 * @file components/Navigation/Sidebar.tsx
 * @description Barra de Navegación Operativa del ERP.
 * Diseñada para empresas viales, constructoras y talleres mecánicos.
 * Permite acceso directo a la operación diaria y al Centro de Migración de Excel.
 */

import React from 'react';
import {
  Boxes,
  Building,
  Calendar,
  Clock,
  Database,
  FileSpreadsheet,
  FileText,
  HardHat,
  LayoutDashboard,
  PackageCheck,
  Receipt,
  Sparkles,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';

export type AppModule =
  | 'DASHBOARD'
  | 'DAILY_REPORTS'
  | 'MACHINES'
  | 'SERVICES'
  | 'ORDERS'
  | 'STOCK'
  | 'FINANCE'
  | 'SUPPLIERS'
  | 'REPORTS_CENTER'
  | 'EXCEL_MIGRATION'
  | 'MIGRATION_SPEC';

interface SidebarProps {
  currentModule: AppModule;
  onSelectModule: (module: AppModule) => void;
  onOpenQuickAction: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentModule,
  onSelectModule,
  onOpenQuickAction,
}) => {
  const navSections = [
    {
      title: 'OPERACIONES DIARIAS',
      items: [
        {
          id: 'DASHBOARD' as AppModule,
          label: 'Panel de Control',
          icon: <LayoutDashboard className="w-4 h-4" />,
        },
        {
          id: 'DAILY_REPORTS' as AppModule,
          label: 'Partes Diarios & Horas',
          badge: 'DifK Auto',
          icon: <Clock className="w-4 h-4" />,
        },
        {
          id: 'MACHINES' as AppModule,
          label: 'Flota de Maquinarias',
          icon: <Truck className="w-4 h-4" />,
        },
        {
          id: 'SERVICES' as AppModule,
          label: 'Taller & Services',
          badge: '1000/2000 HS',
          icon: <Wrench className="w-4 h-4" />,
        },
      ],
    },
    {
      title: 'LOGÍSTICA & INVENTARIO',
      items: [
        {
          id: 'ORDERS' as AppModule,
          label: 'Pedidos de Materiales',
          badge: 'IVA 21%',
          icon: <Boxes className="w-4 h-4" />,
        },
        {
          id: 'STOCK' as AppModule,
          label: 'Stock de Repuestos',
          icon: <PackageCheck className="w-4 h-4" />,
        },
      ],
    },
    {
      title: 'ADMINISTRACIÓN & OBRAS',
      items: [
        {
          id: 'FINANCE' as AppModule,
          label: 'Caja Chica & Gastos',
          icon: <Receipt className="w-4 h-4" />,
        },
        {
          id: 'SUPPLIERS' as AppModule,
          label: 'Proveedores & Obras',
          icon: <Users className="w-4 h-4" />,
        },
      ],
    },
    {
      title: 'PUESTA EN MARCHA',
      items: [
        {
          id: 'EXCEL_MIGRATION' as AppModule,
          label: 'Migración de Excel',
          badge: '16 Planillas',
          highlight: true,
          icon: <FileSpreadsheet className="w-4 h-4" />,
        },
      ],
    },
  ];

  return (
    <aside
      id="erp-sidebar"
      className="w-64 bg-white text-slate-700 flex flex-col shrink-0 border-r border-slate-200 select-none"
    >
      {/* Brand Header */}
      <div className="h-16 px-5 border-b border-slate-100 flex items-center space-x-3 shrink-0 bg-white">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black shadow-xs">
          <HardHat className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-black text-slate-900 tracking-tight leading-none">
            VialTrack ERP
          </h1>
          <span className="text-[11px] text-slate-500 font-medium">
            Maquinaria y Operaciones
          </span>
        </div>
      </div>

      {/* Botón de Acción Rápida */}
      <div className="p-3 border-b border-slate-100 bg-white">
        <button
          onClick={onOpenQuickAction}
          className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl transition-all shadow-xs flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4 text-blue-200" />
          <span>+ Cargar Operación Rápida</span>
        </button>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navSections.map((sec, idx) => (
          <div key={idx} className="space-y-1">
            <h3 className="px-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
              {sec.title}
            </h3>

            <div className="space-y-0.5 pt-1">
              {sec.items.map((item) => {
                const isActive = currentModule === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectModule(item.id)}
                    className={`group w-full text-left px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between transition-all ${
                      isActive
                        ? 'bg-blue-600 text-white font-bold shadow-xs'
                        : 'text-slate-600 hover:bg-blue-50/70 hover:text-blue-700'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span className={`shrink-0 ${isActive ? 'text-white' : 'text-blue-600'}`}>
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </div>

                    {item.badge && (
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-500 space-y-1">
        <div className="flex items-center justify-between text-[10px] text-slate-600">
          <span>Base de Datos</span>
          <span className="text-blue-700 font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block animate-pulse" />
            Activa (Local)
          </span>
        </div>
        <div className="text-[10px] text-slate-400 truncate">
          Compatible con Excel (.xlsx) de Access
        </div>
      </div>
    </aside>
  );
};
