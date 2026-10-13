/**
 * @file App.tsx
 * @description Aplicación Web de Gestión Operativa, Flota y Taller (VialTrack ERP).
 * Interfaz moderna y simplificada para que una empresa migre sus datos de Excel
 * y comience a trabajar hoy mismo con facilidad.
 */

import React, { useState } from 'react';
import { DailyReportsModule } from './components/DailyReports/DailyReportsModule';
import { DashboardOverview } from './components/Dashboard/DashboardOverview';
import { FinanceModule } from './components/Finance/FinanceModule';
import { MachinesModule } from './components/Machines/MachinesModule';
import { ExcelMigrationCenter } from './components/Migration/ExcelMigrationCenter';
import { MigrationGuide } from './components/Migration/MigrationGuide';
import { QuickActionModal, QuickActionType } from './components/Navigation/QuickActionModal';
import { AppModule, Sidebar } from './components/Navigation/Sidebar';
import { OrdersModule } from './components/Orders/OrdersModule';
import { ReportsCenter } from './components/Reports/ReportsCenter';
import { ReportViewerModal } from './components/Reports/ReportViewerModal';
import { MaintenanceServicesModule } from './components/Services/MaintenanceServicesModule';
import { StockModule } from './components/Stock/StockModule';
import { SuppliersModule } from './components/Suppliers/SuppliersModule';
import { exportFullDatabaseToExcel } from './utils/excelExporter';
import {
  ArrowDownToLine,
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';

export default function App() {
  const [currentModule, setCurrentModule] = useState<AppModule>('DASHBOARD');

  // Estado del Modal Global de Acciones Rápidas
  const [isQuickActionOpen, setIsQuickActionOpen] = useState<boolean>(false);
  const [quickActionInitialTab, setQuickActionInitialTab] = useState<QuickActionType>('DAILY_HOURS');

  // Notificación de éxito flotante
  const [notificationToast, setNotificationToast] = useState<string | null>(null);

  // Estado para el Visor de Informes para Imprimir (DoCmd.OpenReport)
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
    await new Promise((resolve) => setTimeout(resolve, 800));
    showToast(`Informe ${reportName} enviado por correo exitosamente.`);
  };

  const showToast = (message: string) => {
    setNotificationToast(message);
    setTimeout(() => {
      setNotificationToast(null);
    }, 4000);
  };

  const handleOpenQuickModal = (type: QuickActionType = 'DAILY_HOURS') => {
    setQuickActionInitialTab(type);
    setIsQuickActionOpen(true);
  };

  const handleExportFullExcel = async () => {
    try {
      await exportFullDatabaseToExcel();
      showToast('Copia de seguridad en Excel (.xlsx) generada y descargada.');
    } catch (e: any) {
      alert('Error al exportar a Excel: ' + e.message);
    }
  };

  return (
    <div className="flex h-screen w-full bg-white text-slate-900 font-sans overflow-hidden">
      {/* Barra Lateral Operativa */}
      <Sidebar
        currentModule={currentModule}
        onSelectModule={setCurrentModule}
        onOpenQuickAction={() => handleOpenQuickModal('DAILY_HOURS')}
      />

      {/* Contenedor Principal */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
        {/* Barra Superior Operativa */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-2xs">
          <div className="flex items-center space-x-3">
            <h2 className="text-base font-black text-slate-900 tracking-tight">
              {currentModule === 'DASHBOARD' && 'Panel de Control Operativo'}
              {currentModule === 'DAILY_REPORTS' && 'Partes Diarios y Control de Horómetros'}
              {currentModule === 'MACHINES' && 'Flota de Maquinarias Pesadas y Equipos'}
              {currentModule === 'SERVICES' && 'Taller y Mantenimientos 1000/2000 HS'}
              {currentModule === 'ORDERS' && 'Pedidos de Materiales y Repuestos'}
              {currentModule === 'STOCK' && 'Inventario y Stock de Repuestos de Taller'}
              {currentModule === 'FINANCE' && 'Caja Chica y Rendiciones de Obra'}
              {currentModule === 'SUPPLIERS' && 'Directorio de Proveedores y Frentes de Obra'}
              {currentModule === 'REPORTS_CENTER' && 'Centro de Informes y Fichas para Imprimir'}
              {currentModule === 'EXCEL_MIGRATION' && 'Centro de Migración y Carga de Planillas Excel'}
              {currentModule === 'MIGRATION_SPEC' && 'Documentación y Mapeo de Fórmulas'}
            </h2>
          </div>

          <div className="flex items-center space-x-2.5 text-xs">
            {/* Botón de Carga Rápida */}
            <button
              onClick={() => handleOpenQuickModal('DAILY_HOURS')}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-all shadow-xs flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>+ Cargar Operación</span>
            </button>

            {/* Acceso a Migración de Excel */}
            <button
              onClick={() => setCurrentModule('EXCEL_MIGRATION')}
              className={`px-3 py-1.5 rounded-lg border font-bold transition-all flex items-center gap-1.5 ${
                currentModule === 'EXCEL_MIGRATION'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
              <span>Migrar 16 Planillas Excel</span>
            </button>

            {/* Descargar Todo en Excel */}
            <button
              onClick={handleExportFullExcel}
              title="Descargar copia de seguridad en Excel con todas las hojas"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold transition-all flex items-center gap-1.5"
            >
              <ArrowDownToLine className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden sm:inline">Exportar Excel</span>
            </button>

            <div className="h-4 w-px bg-slate-200"></div>

            <div className="text-[11px] text-slate-500 font-medium hidden md:flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-600 inline-block"></span>
              <span>Operaciones Taller</span>
            </div>
          </div>
        </header>

        {/* Notificación Flotante */}
        {notificationToast && (
          <div className="bg-blue-600 text-white px-4 py-2.5 text-xs font-bold flex items-center justify-between shadow-md transition-all animate-in slide-in-from-top duration-200">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-blue-200" />
              <span>{notificationToast}</span>
            </div>
            <button
              onClick={() => setNotificationToast(null)}
              className="text-blue-200 hover:text-white ml-4"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Área de Trabajo de Módulos */}
        <main className="flex-1 overflow-y-auto p-6 bg-white">
          <div className="max-w-7xl mx-auto">
            {currentModule === 'DASHBOARD' && (
              <DashboardOverview
                onNavigate={setCurrentModule}
                onOpenReport={handleOpenReport}
                onOpenQuickAction={() => handleOpenQuickModal('DAILY_HOURS')}
              />
            )}

            {currentModule === 'DAILY_REPORTS' && (
              <DailyReportsModule onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'MACHINES' && (
              <MachinesModule
                onOpenReport={handleOpenReport}
                onNavigate={(mod) => setCurrentModule(mod as AppModule)}
              />
            )}

            {currentModule === 'SERVICES' && (
              <MaintenanceServicesModule onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'ORDERS' && (
              <OrdersModule onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'STOCK' && (
              <StockModule onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'FINANCE' && (
              <FinanceModule
                onOpenReport={handleOpenReport}
                onSendEmail={handleSendEmailReport}
              />
            )}

            {currentModule === 'SUPPLIERS' && <SuppliersModule />}

            {currentModule === 'REPORTS_CENTER' && (
              <ReportsCenter onOpenReport={handleOpenReport} />
            )}

            {currentModule === 'EXCEL_MIGRATION' && (
              <ExcelMigrationCenter
                onNavigate={setCurrentModule}
                onSuccessNotification={showToast}
              />
            )}

            {currentModule === 'MIGRATION_SPEC' && <MigrationGuide />}
          </div>
        </main>
      </div>

      {/* Modal Global de Acciones Rápidas (Formularios Sencillos) */}
      <QuickActionModal
        isOpen={isQuickActionOpen}
        initialAction={quickActionInitialTab}
        onClose={() => setIsQuickActionOpen(false)}
        onSuccess={showToast}
      />

      {/* Visor de Informes Oficiales para Imprimir / PDF */}
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
