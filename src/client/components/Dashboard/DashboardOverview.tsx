/**
 * @file components/Dashboard/DashboardOverview.tsx
 * @description Panel: estado de la flota, servicios próximos y últimas lecturas.
 */

import React, { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import { ErpApi } from '../../services/api';
import { Machine, TotalizerReading } from '../../../shared/erp';
import { AppModule } from '../Navigation/Sidebar';
import { Card, EmptyState, Page, PageHeader, Stat, StatGrid, StatusPill } from '../../ui';
import { formatHours } from '../../utils/legacyCalculations';

/** Horas desde el último servicio a partir de las cuales la máquina aparece como "próxima". */
const SERVICE_WARNING_HOURS = 850;

interface DashboardOverviewProps {
  onNavigate: (module: AppModule) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onNavigate }) => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [totalizers, setTotalizers] = useState<TotalizerReading[]>([]);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [m, t, o] = await Promise.all([ErpApi.getMachines(), ErpApi.getTotalizers(), ErpApi.getOrders()]);
        setMachines(m);
        setTotalizers(t);
        setPendingOrders(o.filter((x) => x.estado === 'PENDIENTE').length);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const operational = machines.filter((m) => m.estado === 'OPERATIVA').length;
  const inWorkshop = machines.filter((m) => m.estado === 'EN_MANTENIMIENTO' || m.estado === 'EN_REPARACION').length;
  const nearService = machines.filter((m) => m.horasActuales - (m.ultimoServicioHoras || 0) >= SERVICE_WARNING_HOURS);
  const recent = [...totalizers].reverse().slice(0, 5);

  return (
    <Page>
      <PageHeader title="Panel" help="Estado de la flota, servicios próximos y últimas lecturas." />

      <StatGrid>
        <Stat label="Flota total" value={machines.length} hint={`${operational} operativas · ${inWorkshop} en taller`} />
        <Stat label="Lecturas cargadas" value={totalizers.length} hint="Horómetro y gasoil" />
        <Stat label="Próximos a servicio" value={nearService.length} tone={nearService.length ? 'warn' : 'neutral'} hint="Cerca de 1000 / 2000 hs" />
        <Stat label="Pedidos pendientes" value={pendingOrders} tone={pendingOrders ? 'brand' : 'neutral'} hint="Esperando recepción" />
      </StatGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Máquinas próximas a servicio"
          action={<button onClick={() => onNavigate('SERVICES')} className="text-xs font-medium text-brand-700 hover:underline">Ver mantenimiento</button>}
          padded={false}
        >
          {loading ? null : nearService.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<Truck className="h-8 w-8" />} title="Nada próximo a servicio" help="Las máquinas aparecen aquí al acercarse a 850 hs desde su último servicio." />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {nearService.map((m) => {
                const since = m.horasActuales - (m.ultimoServicioHoras || 0);
                return (
                  <li key={m.codmaq} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{m.codmaq} · {m.descripcion}</p>
                      <p className="text-xs text-slate-500">{formatHours(since)} desde el último servicio</p>
                    </div>
                    <StatusPill tone="warn">Próximo</StatusPill>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Últimas lecturas"
          action={<button onClick={() => onNavigate('DAILY_REPORTS')} className="text-xs font-medium text-brand-700 hover:underline">Ver partes</button>}
          padded={false}
        >
          {loading ? null : recent.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Sin lecturas" help="Las lecturas de horómetro aparecen aquí al cargar un parte diario." />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((t, i) => (
                <li key={`${t.codmaq}-${t.fecha}-${i}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{t.codmaq}</p>
                    <p className="text-xs text-slate-500">{t.fecha} · {formatHours(t.horas)}</p>
                  </div>
                  <span className="text-xs font-medium tabular-nums text-slate-600">+{formatHours(t.difK)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
};
