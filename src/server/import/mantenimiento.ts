/**
 * @file server/import/mantenimiento.ts
 * @description Bloque 6 de la importación: órdenes de mantenimiento, catálogo de tipos y plan de cada
 * máquina. El plan se deriva del historial (ciclo estándar, posición por los últimos servicios y próximas
 * horas = horas reales del último + intervalo) solo para máquinas atendidas en los últimos 18 meses.
 * Las horas reales de cada servicio realizado se cargan como lectura de la máquina (origen «servicio»).
 */

import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection';
import type { Observation } from '../../shared/import/common';
import { derivePlan, serviceOrderFromAccess, type RealizedService, type ServiceOrderImport } from '../../shared/import/maintenance';
import { DEFAULT_SERVICE_TYPES, type ServiceUnit } from '../../shared/maintenance';
import type { TableSource } from './access';
import type { BlockResult, ImportContext } from './context';
import { insertMany } from './db';
import { setSequence } from './pedidos';

const obsText = (obs: Observation[]): string | null => (obs.length > 0 ? [...new Set(obs.map((o) => o.code))].join(', ') : null);

interface OrderDraft {
  id: string;
  o: ServiceOrderImport;
  fechaEmision: string;
  machineId: string;
  estado: 'EMITIDA' | 'REALIZADA' | 'ANULADA';
  anuladoMotivo: string | null;
}

export async function importMantenimiento(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const rows = src.table('MANTENIMIENTOS');
  const rOrders: BlockResult = { bloque: 'mantenimiento (órdenes)', leidas: rows.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  const rPlans: BlockResult = { bloque: 'mantenimiento (planes)', leidas: 0, cargadas: 0, observadas: 0, rechazadas: 0 };
  ctx.results.push(rOrders, rPlans);
  if (rows.length === 0) return;

  /* ── Órdenes que el modelo nuevo puede contener ── */
  const drafts: OrderDraft[] = [];
  for (const row of rows) {
    const o = serviceOrderFromAccess(row, ctx.hoy);
    const reject = (codigo: 'SIN_FECHA' | 'OTRO', detalle: string): void => {
      rOrders.rechazadas += 1;
      ctx.issues.add({
        entidad: 'mantenimiento',
        legacyId: o.legacyId,
        codigo,
        detalle,
        rechazado: true,
        datos: { maquina: o.machineCode, tipo: o.tipoRaw, emision: o.fechaEmision, realizado: o.fechaRealizado, horasReal: o.horasReal, obra: o.obraId },
      });
    };
    if (!o.machineCode) {
      reject('OTRO', 'Orden sin código de máquina');
      continue;
    }
    if (!o.fechaEmision) {
      reject('SIN_FECHA', 'Orden sin ninguna fecha válida');
      continue;
    }
    const machineId = ctx.machines.idFor(o.machineCode) as string;
    drafts.push({ id: randomUUID(), o, fechaEmision: o.fechaEmision, machineId, estado: o.realizada ? 'REALIZADA' : 'EMITIDA', anuladoMotivo: null });
  }

  // Una sola orden abierta por máquina: si el Access tenía varias, queda abierta la más reciente.
  const openByMachine = new Map<string, OrderDraft[]>();
  for (const d of drafts) if (d.estado === 'EMITIDA') openByMachine.set(d.machineId, [...(openByMachine.get(d.machineId) ?? []), d]);
  for (const list of openByMachine.values()) {
    list.sort((a, b) => (a.fechaEmision < b.fechaEmision ? 1 : a.fechaEmision > b.fechaEmision ? -1 : 0));
    for (const old of list.slice(1)) {
      old.estado = 'ANULADA';
      old.anuladoMotivo = 'Había otra orden abierta más reciente para la misma máquina (importación)';
    }
  }

  /* ── Catálogo de tipos: los seis habituales y los otros que se hayan usado ── */
  const typeRows: unknown[][] = DEFAULT_SERVICE_TYPES.map((t) => [ctx.companyId, t.codigo, t.nombre, t.valor, t.unidad, JSON.stringify(t.tareas)]);
  const known = new Set(DEFAULT_SERVICE_TYPES.map((t) => t.codigo));
  const typeName = new Map(DEFAULT_SERVICE_TYPES.map((t) => [t.codigo, t.nombre]));
  for (const d of drafts) {
    const t = d.o.tipo;
    if (t && !known.has(t.codigo)) {
      known.add(t.codigo);
      const nombre = `Servicio de ${t.valor.toLocaleString('es-PY')} ${t.unidad === 'KM' ? 'km' : 'hs'}`;
      typeName.set(t.codigo, nombre);
      typeRows.push([ctx.companyId, t.codigo, nombre, t.valor, t.unidad, '[]']);
    }
  }
  await insertMany(
    tx,
    'service_types',
    [{ name: 'company_id' }, { name: 'codigo' }, { name: 'nombre' }, { name: 'valor' }, { name: 'unidad' }, { name: 'tareas', cast: 'jsonb' }],
    typeRows,
  );

  /* ── Órdenes numeradas por fecha ── */
  drafts.sort((a, b) => (a.fechaEmision < b.fechaEmision ? -1 : a.fechaEmision > b.fechaEmision ? 1 : Number(a.o.legacyId) - Number(b.o.legacyId)));
  const orderRows: unknown[][] = [];
  let numero = 0;
  const realized = new Map<string, RealizedService[]>();
  for (const d of drafts) {
    numero += 1;
    const o = d.o;
    const obs: Observation[] = [...o.obs];
    const unidad: ServiceUnit = o.tipo?.unidad ?? ctx.machineUnits.get(d.machineId) ?? 'HS';
    const tipoCodigo = o.tipo?.codigo ?? o.tipoRaw ?? 'SIN-TIPO';
    const tipoNombre = o.tipo ? (typeName.get(o.tipo.codigo) ?? tipoCodigo) : (o.tipoRaw ?? 'Sin tipo (importada)');
    if (!o.tipo) obs.push({ code: 'OTRO', detail: `Tipo de servicio no reconocido: ${o.tipoRaw ?? '(vacío)'}` });
    let worksiteId = o.obraId ? ctx.worksites.byLegacy(o.obraId, 'DESTINO') : null;
    if (o.obraId && !worksiteId) {
      worksiteId = ctx.worksites.byLegacy(o.obraId, 'OBRA');
      if (!worksiteId) obs.push({ code: 'OBRA_SIN_REGISTRO', detail: `Obra ${o.obraId}` });
    }
    const pedidoId = o.pedidoRaw ? (ctx.orderByRaw.get(o.pedidoRaw) ?? null) : null;
    if (obs.length > 0) {
      rOrders.observadas += 1;
      ctx.issues.addObservations('mantenimiento', d.id, o.legacyId, obs);
    }
    orderRows.push([
      d.id, ctx.companyId, numero, d.machineId, worksiteId, tipoCodigo, tipoNombre, unidad, d.estado, d.fechaEmision, o.horasIdeal, o.horasActual, o.fechaPedido, o.fechaDevuelta,
      d.estado === 'REALIZADA' ? o.fechaRealizado : null, d.estado === 'REALIZADA' ? o.horasReal : null, pedidoId, o.observaciones, d.anuladoMotivo,
      'ACCESS', o.legacyId, obs.length > 0, obsText(obs), o.legacyId,
    ]);
    if (d.estado === 'REALIZADA' && o.fechaRealizado && o.horasReal !== null) {
      ctx.readings.push({ machineId: d.machineId, fecha: o.fechaRealizado, valor: o.horasReal, fuente: 'SERVICIO', legacyId: o.legacyId });
      if (o.tipo) {
        const list = realized.get(d.machineId) ?? [];
        list.push({ fechaRealizado: o.fechaRealizado, tipoCodigo: o.tipo.codigo, unidad: o.tipo.unidad, valor: o.tipo.valor, horasReal: o.horasReal });
        realized.set(d.machineId, list);
      }
    }
  }
  await ctx.worksites.flush(tx, ctx.companyId);
  await ctx.machines.flush(tx, ctx.companyId);
  await insertMany(
    tx,
    'service_orders',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'numero' }, { name: 'machine_id', cast: 'uuid' }, { name: 'worksite_id', cast: 'uuid' }, { name: 'tipo_codigo' },
      { name: 'tipo_nombre' }, { name: 'unidad' }, { name: 'estado' }, { name: 'fecha_emision', cast: 'date' }, { name: 'horas_ideal' }, { name: 'horas_actual' },
      { name: 'fecha_pedido', cast: 'date' }, { name: 'fecha_devuelta', cast: 'date' }, { name: 'fecha_realizado', cast: 'date' }, { name: 'horas_real' }, { name: 'order_id', cast: 'uuid' },
      { name: 'observaciones' }, { name: 'anulado_motivo' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' }, { name: 'referencia_access' },
    ],
    orderRows,
  );
  rOrders.cargadas = orderRows.length;
  await setSequence(tx, ctx.companyId, 'SERVICIO', numero);

  /* ── Planes derivados del historial ── */
  const planRows: unknown[][] = [];
  for (const [machineId, services] of realized) {
    rPlans.leidas += 1;
    if (ctx.machineStatus.get(machineId) === 'BAJA') continue;
    services.sort((a, b) => (a.fechaRealizado < b.fechaRealizado ? -1 : a.fechaRealizado > b.fechaRealizado ? 1 : 0));
    const plan = derivePlan(services, ctx.hoy);
    if (!plan) continue;
    planRows.push([ctx.companyId, machineId, plan.unidad, plan.intervalo, `{${plan.ciclo.map((c) => `"${c}"`).join(',')}}`, plan.proximoIndice, plan.proximoHoras, 20]);
  }
  await insertMany(
    tx,
    'maintenance_plans',
    [{ name: 'company_id' }, { name: 'machine_id', cast: 'uuid' }, { name: 'unidad' }, { name: 'intervalo' }, { name: 'ciclo', cast: 'text[]' }, { name: 'proximo_indice' }, { name: 'proximo_horas' }, { name: 'aviso_pct' }],
    planRows,
  );
  rPlans.cargadas = planRows.length;
}
