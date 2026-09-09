/**
 * @file App.tsx
 * @description Aplicación Web principal de ERP de Gestión Operativa,
 * migrada desde Microsoft Access VBA a React 19 y TypeScript.
 */

import React, { useState } from 'react';
import { DailyReportsModule } from './components/DailyReports/DailyReportsModule';
import { DashboardOverview } from './components/Dashboard/DashboardOverview';
import { FinanceModule } from './components/Finance/FinanceModule';
import { MachinesModule } from './components/Machines/MachinesModule';
import { MigrationGuide } from './components/Migration/MigrationGuide';
import { AppModule, Sidebar } from './components/Navigation/Sidebar';
import { OrdersModule } from './components/Orders/OrdersModule';
import { ReportsCenter } from './components/Reports/ReportsCenter';
import { ReportViewerModal } from './components/Reports/ReportViewerModal';
import { MaintenanceServicesModule } from './components/Services/MaintenanceServicesModule';

export default function App() {
  const [currentModule, setCurrentModule] = useState<AppModule>('DASHBOARD');

  // Estado global para el Visor de Informes (DoCmd.OpenReport / DoCmd.OutputTo)
  const [activeReport, setActiveReport] = useState<{
    name: string;
    payload: any;
  } | null>(null);

  const handleOpenReport = (reportName: string, data: any) => {
    setActiveReport({
      name: reportName,
      payload: data,
    });
  };

  const handleCloseReport = () => {
    setActiveReport(null);
  };

  const handleSendEmailReport = async (reportName: string) => {
    // Simula DoCmd.SendObject acReport
    await new Promise((resolve) => setTimeout(resolve, 800));
  };

  return (
    <div className="flex h-screen w-full bg-slate-100 text-slate-900 font-sans overflow-hidden">
      {/* Sidebar de Navegación (Migración de Form_SWITCHBOARD) */}
      <Sidebar currentModule={currentModule} onSelectModule={setCurrentModule} />

      {/* Área de Trabajo Principal */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Barra Superior de Estado */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-2xs">
          <div className="flex items-center space-x-3">
            <h2 className="text-base font-black text-slate-800 tracking-tight">
              {currentModule === 'DASHBOARD' && 'Panel de Control Operativo'}
              {currentModule === 'MACHINES' && 'Gestión de Maquinaria y Horómetros (Form_AMAQUINAS / Form_A)'}
              {currentModule === 'SERVICES' && 'Protocolos de Mantenimiento 1000/2000 HS'}
              {currentModule === 'ORDERS' && 'Pedidos de Materiales e Inventario (Form_EDITAR PEDIDO)'}
              {currentModule === 'DAILY_REPORTS' && 'Partes Diarios y Remitos de Envío'}
              {currentModule === 'FINANCE' && 'Tesorería y Solicitudes de Fondos (Form_SFONDOS)'}
              {currentModule === 'REPORTS_CENTER' && 'Centro de Informes y Consultas de Access'}
              {currentModule === 'MIGRATION_SPEC' && 'Especificación Técnica de Migración VBA'}
            </h2>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <button
              onClick={() => setCurrentModule('MIGRATION_SPEC')}
              className={`px-3 py-1.5 rounded-lg border font-semibold transition-all ${
                currentModule === 'MIGRATION_SPEC'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              Ver Mapeo VBA &rarr; React / TS
            </button>
            <div className="h-4 w-px bg-slate-200"></div>
            <span className="text-slate-500 font-medium hidden sm:inline">
              Usuario: <strong className="text-slate-800">Operaciones Taller</strong>
            </span>
          </div>
        </header>

        {/* Contenedor del Módulo Activo */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            {currentModule === 'DASHBOARD' && (
              <DashboardOverview
                onNavigate={setCurrentModule}
                onOpenReport={handleOpenReport}
              />
            )}

            {currentModule === 'MACHINES' && (
              <MachinesModule onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'SERVICES' && (
              <MaintenanceServicesModule onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'ORDERS' && (
              <OrdersModule onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'DAILY_REPORTS' && (
              <DailyReportsModule onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'FINANCE' && (
              <FinanceModule
                onOpenReport={handleOpenReport}
                onSendEmail={handleSendEmailReport}
              />
            )}

            {currentModule === 'REPORTS_CENTER' && (
              <ReportsCenter onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'MIGRATION_SPEC' && <MigrationGuide />}
          </div>
        </main>
      </div>

      {/* Visor de Informes de Access (DoCmd.OpenReport) */}
      {activeReport && (
        <ReportViewerModal
          reportName={activeReport.name}
          data={activeReport.payload}
          onClose={handleCloseReport}
          onSendEmail={handleSendEmailReport}
        />
      )}
    </div>
  );
}
