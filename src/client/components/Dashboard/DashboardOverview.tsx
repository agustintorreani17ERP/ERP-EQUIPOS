/**
 * @file components/Dashboard/DashboardOverview.tsx
 * @description Panel: estado de la flota, vencimientos (DINATRAN y habilitación municipal),
 * últimas lecturas y pedidos pendientes. Todo sale de la API, sin datos de ejemplo.
 */

import React, { useEffect, useState } from 'react';
import { Truck, Wrench } from 'lucide-react';
import type { ProgramRowDto } from '../../../shared/maintenance';
import { dispatchApi } from '../../services/dispatchApi';
import { fleetApi, type DueItem, type FleetMachine } from '../../services/fleetApi';
import { maintenanceApi } from '../../services/maintenanceApi';
import { ordersApi } from '../../services/ordersApi';
import { mastersApi } from '../../services/mastersApi';
import { stockApi } from '../../services/stockApi';
import { formatCurrency } from '../../../shared/calculations';
import { describeError } from '../../services/http';
import { formatDate, formatQty } from '../../utils/format';
import type { AppModule } from '../Navigation/Sidebar';
import { OLD_PENDING_DAYS } from '../Dispatch/common';
import { Card, EmptyState, Page, PageHeader, Stat, StatGrid, StatusPill } from '../../ui';

interface DashboardOverviewProps {
  onNavigate: (module: AppModule) => void;
}

const DUE_LABEL = { DINATRAN: 'DINATRAN', HABILITACION_MUNICIPAL: 'Habilitación municipal' } as const;

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ onNavigate }) => {
  const [machines, setMachines] = useState<FleetMachine[]>([]);
  const [due, setDue] = useState<DueItem[]>([]);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [services, setServices] = useState<ProgramRowDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatchStats, setDispatchStats] = useState<{ old: number; total: number; sinAcuse: number } | null>(null);

  const [stockStats, setStockStats] = useState<{ low: number; total: number; valor: string } | null>(null);

  // El stock tampoco frena el Panel: sin artículos cargados la tarjeta no aparece.
  useEffect(() => {
    Promise.all([stockApi.existences({ activo: true }), mastersApi.settings()])
      .then(([r, settings]) =>
        setStockStats(
          r.items.length === 0
            ? null
            : { low: r.items.filter((a) => a.bajoMinimo).length, total: r.items.length, valor: formatCurrency(r.totalValor, settings.currency) },
        ),
      )
      .catch(() => setStockStats(null));
  }, []);

  // Las notas de envío no frenan el resto del Panel si fallan.
  useEffect(() => {
    Promise.all([dispatchApi.pending(), dispatchApi.officeNotes({ estado: 'ENVIADA' })])
      .then(([p, notes]) =>
        setDispatchStats({ old: p.items.filter((i) => i.dias > OLD_PENDING_DAYS).length, total: p.items.length, sinAcuse: notes.length }),
      )
      .catch(() => setDispatchStats(null));
  }, []);

  useEffect(() => {
    Promise.all([fleetApi.list({}), fleetApi.dueItems(60), ordersApi.list(), maintenanceApi.program()])
      .then(([m, v, o, p]) => {
        setServices(p.filter((r) => r.estado === 'VENCIDO' || r.estado === 'PROXIMO'));
        setMachines(m);
        setDue(v.items);
        setPendingOrders(o.filter((x) => x.estado === 'PENDIENTE' || x.estado === 'PARCIAL').length);
      })
      .catch((err) => setError(describeError(err)))
      .finally(() => setLoading(false));
  }, []);

  const activas = machines.filter((m) => m.status === 'ACTIVA').length;
  const paradas = machines.filter((m) => m.status === 'PARADA').length;
  const recent = machines
    .filter((m) => m.lecturaActual !== null)
    .sort((a, b) => (b.lecturaActual!.fecha).localeCompare(a.lecturaActual!.fecha))
    .slice(0, 5);

  return (
    <Page>
      <PageHeader title="Panel" help="Estado de la flota, vencimientos y últimas lecturas." />

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <StatGrid>
        <Stat label="Flota total" value={machines.length} hint={`${activas} activas · ${paradas} paradas`} />
        <Stat
          label="Servicios vencidos"
          value={services.filter((r) => r.estado === 'VENCIDO').length}
          tone={services.some((r) => r.estado === 'VENCIDO') ? 'bad' : 'neutral'}
          hint={`${services.filter((r) => r.estado === 'PROXIMO').length} más próximos a servicio`}
        />
        <Stat
          label="Vencimientos"
          value={due.length}
          tone={due.length ? 'warn' : 'neutral'}
          hint="DINATRAN o habilitación en 60 días o vencidos"
        />
        <Stat label="Pedidos pendientes" value={pendingOrders} tone={pendingOrders ? 'brand' : 'neutral'} hint="Sin recibir o recepción parcial" />
      </StatGrid>

      {stockStats && (
        <button type="button" onClick={() => onNavigate('STOCK')} className="block w-full text-left">
          <StatGrid>
            <Stat
              label="Repuestos en o bajo el mínimo"
              value={stockStats.low}
              tone={stockStats.low ? 'warn' : 'neutral'}
              hint={`de ${stockStats.total} artículos activos`}
            />
            <Stat label="Valor del stock" value={stockStats.valor} hint="A costo promedio" />
          </StatGrid>
        </button>
      )}

      {dispatchStats && (
        <button type="button" onClick={() => onNavigate('DISPATCH')} className="block w-full text-left">
          <StatGrid>
            <Stat
              label="Sin enviar a oficina"
              value={dispatchStats.old}
              tone={dispatchStats.old ? 'warn' : 'neutral'}
              hint={`con más de ${OLD_PENDING_DAYS} días · ${dispatchStats.total} en total`}
            />
            <Stat
              label="Notas sin acuse"
              value={dispatchStats.sinAcuse}
              tone={dispatchStats.sinAcuse ? 'brand' : 'neutral'}
              hint="Enviadas a oficina, sin recibido"
            />
          </StatGrid>
        </button>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Vencimientos próximos"
          action={<button onClick={() => onNavigate('MACHINES')} className="text-xs font-medium text-brand-700 hover:underline">Ver flota</button>}
          padded={false}
        >
          {loading ? null : due.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<Truck className="h-8 w-8" />} title="Sin vencimientos cercanos" help="Aparecen aquí DINATRAN y habilitaciones municipales por vencer o vencidas." />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {due.map((d) => (
                <li key={`${d.maquina.id}-${d.tipo}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{d.maquina.codigo} · {d.maquina.descripcion}</p>
                    <p className="text-xs text-slate-500">{DUE_LABEL[d.tipo]} · {formatDate(d.vence)}</p>
                  </div>
                  <StatusPill tone={d.estado === 'VENCIDO' ? 'bad' : 'warn'}>{d.estado === 'VENCIDO' ? 'Vencido' : 'Por vencer'}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Próximos a servicio"
          action={<button onClick={() => onNavigate('SERVICES')} className="text-xs font-medium text-brand-700 hover:underline">Ver mantenimiento</button>}
          padded={false}
        >
          {loading ? null : services.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<Wrench className="h-8 w-8" />} title="Sin servicios por hacer" help="Aparecen aquí las máquinas con servicio vencido o dentro del aviso de su plan de mantenimiento." />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {services.slice(0, 6).map((r) => (
                <li key={r.machine.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{r.machine.codigo} · {r.machine.descripcion}</p>
                    <p className="text-xs text-slate-500">
                      {r.proximoTipo} · {r.restante !== null && r.restante < 0 ? `pasado por ${formatQty(Math.abs(r.restante))}` : `faltan ${formatQty(r.restante ?? 0)}`} {r.machine.meterUnit.toLowerCase()}
                    </p>
                  </div>
                  <StatusPill tone={r.estado === 'VENCIDO' ? 'bad' : 'warn'}>{r.estado === 'VENCIDO' ? 'Vencido' : 'Próximo'}</StatusPill>
                </li>
              ))}
              {services.length > 6 && <li className="px-5 py-3 text-xs text-slate-500">y {services.length - 6} más en Mantenimiento</li>}
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
              <EmptyState title="Sin lecturas" help="Las lecturas de horómetro aparecen aquí al cargar un parte o registrar una lectura en la ficha." />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{m.codigo} · {m.descripcion}</p>
                    <p className="text-xs text-slate-500">{formatDate(m.lecturaActual!.fecha)}</p>
                  </div>
                  <span className="text-xs font-medium tabular-nums text-slate-600">
                    {formatQty(m.lecturaActual!.valor)} {m.meterUnit.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
};
