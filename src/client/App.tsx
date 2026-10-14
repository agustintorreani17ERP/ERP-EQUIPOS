/**
 * @file App.tsx
 * @description Shell de Taller: menú lateral, encabezado y el módulo elegido.
 */

import React, { useState } from 'react';
import { DailyReportsModule } from './components/DailyReports/DailyReportsModule';
import { DashboardOverview } from './components/Dashboard/DashboardOverview';
import { FinanceModule } from './components/Finance/FinanceModule';
import { MachinesModule } from './components/Machines/MachinesModule';
import { OrdersModule } from './components/Orders/OrdersModule';
import { AppModule, Sidebar } from './components/Navigation/Sidebar';
import { MaintenanceServicesModule } from './components/Services/MaintenanceServicesModule';
import { StockModule } from './components/Stock/StockModule';
import { SuppliersModule } from './components/Suppliers/SuppliersModule';
import { SidebarInset, SidebarProvider, SidebarTrigger } from './ui/sidebar';

const TITLES: Record<AppModule, string> = {
  DASHBOARD: 'Panel',
  MACHINES: 'Flota',
  DAILY_REPORTS: 'Partes diarios',
  SERVICES: 'Mantenimiento',
  ORDERS: 'Pedidos',
  STOCK: 'Stock',
  FINANCE: 'Fondos',
  SUPPLIERS: 'Proveedores',
};

export default function App() {
  const [currentModule, setCurrentModule] = useState<AppModule>('DASHBOARD');

  return (
    <SidebarProvider>
      <Sidebar currentModule={currentModule} onSelectModule={setCurrentModule} />

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <SidebarTrigger />
          <h2 className="text-sm font-semibold text-slate-900">{TITLES[currentModule]}</h2>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-50 p-6">
          <div className="mx-auto w-full max-w-7xl">
            {currentModule === 'DASHBOARD' && <DashboardOverview onNavigate={setCurrentModule} />}
            {currentModule === 'MACHINES' && <MachinesModule onNavigate={setCurrentModule} />}
            {currentModule === 'DAILY_REPORTS' && <DailyReportsModule />}
            {currentModule === 'SERVICES' && <MaintenanceServicesModule />}
            {currentModule === 'ORDERS' && <OrdersModule />}
            {currentModule === 'STOCK' && <StockModule />}
            {currentModule === 'FINANCE' && <FinanceModule />}
            {currentModule === 'SUPPLIERS' && <SuppliersModule />}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
