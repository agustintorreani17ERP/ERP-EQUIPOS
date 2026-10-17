/**
 * @file server/routes/maintenance.ts
 * @description Mantenimiento: tipos de servicio, plan por máquina, programa con estados, órdenes de
 * servicio e informe de cumplimiento. Reemplaza la tabla MANTENIMIENTOS del Access. Las horas reales
 * de un servicio se registran como lectura de la máquina con la misma regla que Flota.
 */

import { Router, type RequestHandler, type Response } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import {
  DEFAULT_SERVICE_TYPES,
  lateness,
  maintenanceStatus,
  nextCycleIndex,
  projectDueDate,
  serviceTypeCode,
  validatePlan,
  validateServiceCompletion,
  USAGE_WINDOW_DAYS,
  type ComplianceRowDto,
  type MaintenancePlanDto,
  type ProgramRowDto,
  type ProgramStatus,
  type ServiceOrderDto,
  type ServiceOrderState,
  type ServiceTask,
  type ServiceTypeDto,
  type ServiceUnit,
} from '../../shared/maintenance';
import { matchesMachineSearch } from '../../shared/fleet';
import { asyncRoute, missingIds, nextDocumentNumber, parseBody, query, Rejected, sqlList, type Row } from './helpers';
import { insertReading, loadMachines, type MachineDto } from './fleet';
import { createMaterialOrder } from './orders';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.');
const uuid = z.uuid();
const GROUPS = ['CAMBIO', 'CONTROL', 'DRENAR', 'LUBRICACION'] as const;
const PROGRAM_STATES = ['VENCIDO', 'PROXIMO', 'VIGENTE', 'SIN_LECTURA', 'SIN_PLAN'] as const;
const ORDER_STATES = ['EMITIDA', 'REALIZADA', 'ANULADA'] as const;

const taskSchema = z.object({ grupo: z.enum(GROUPS), descripcion: z.string().trim().min(1).max(200) });

const typeCreateSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  valor: z.number().int().positive().max(1_000_000),
  unidad: z.enum(['HS', 'KM']),
  tareas: z.array(taskSchema).max(60).default([]),
});

const typeUpdateSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  tareas: z.array(taskSchema).max(60),
  activo: z.boolean().default(true),
});

const planSchema = z.object({
  intervalo: z.number().int().positive().max(1_000_000),
  ciclo: z.array(z.string().trim().min(1).max(20)).min(1).max(30),
  proximoIndice: z.number().int().min(0).default(0),
  proximoHoras: z.number().finite(),
  avisoPct: z.number().finite().default(20),
  activo: z.boolean().default(true),
});

const completionSchema = z.object({
  fecha: isoDate,
  horasReal: z.number().finite(),
  correccion: z.boolean().default(false),
  motivo: z.string().max(200).nullable().optional(),
  fechaDevuelta: isoDate.nullable().optional(),
});

const emitSchema = z.object({
  machineId: uuid,
  fechaEmision: isoDate,
  tipoCodigo: z.string().trim().max(20).nullable().optional(),
  worksiteId: uuid.nullable().optional(),
  horasIdeal: z.number().finite().nullable().optional(),
  generarPedido: z.boolean().default(true),
  observaciones: z.string().max(500).nullable().optional(),
  /** Registrar un servicio que ya se hizo (arranque sin importador): se crea ya realizado. */
  realizado: completionSchema.optional(),
});

const cancelSchema = z.object({ motivo: z.string().trim().min(3).max(200) });

const programFiltersSchema = z.object({
  obra: uuid.optional(),
  estado: z.enum(PROGRAM_STATES).optional(),
  q: z.string().max(80).optional(),
});

const orderFiltersSchema = z.object({
  estado: z.enum(ORDER_STATES).optional(),
  maquina: uuid.optional(),
  obra: uuid.optional(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
});

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Arreglo de texto con comillas: los códigos llevan espacios («250 HS»). */
function textArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/(["\\])/g, '\\$1')}"`).join(',')}}`;
}
function toTextArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.replace(/^\{|\}$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).filter(Boolean);
  return [];
}
function jsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

async function runInTenant<T>(db: Db, res: Response, companyId: string, fn: (tx: Db) => Promise<T>, status = 200): Promise<void> {
  try {
    res.status(status).json(await withTenant(db, companyId, fn));
  } catch (err) {
    if (err instanceof Rejected) {
      res.status(err.status).json({ error: err.errors.length === 1 ? err.errors[0] : 'No se pudo completar la operación.', detalles: err.errors });
      return;
    }
    throw err;
  }
}

/* ─── Tipos de servicio ────────────────────────────────────────────────── */

function mapType(r: Row): ServiceTypeDto {
  return {
    id: String(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    valor: Number(r.valor),
    unidad: r.unidad as ServiceUnit,
    tareas: jsonValue<ServiceTask[]>(r.tareas, []),
    activo: Boolean(r.activo),
  };
}

async function loadTypes(tx: Db): Promise<ServiceTypeDto[]> {
  const rows = await query<Row>(
    tx,
    sql`select id, codigo, nombre, valor::float8 as valor, unidad, tareas, activo from service_types order by unidad, valor`,
  );
  return rows.map(mapType);
}

/* ─── Planes ───────────────────────────────────────────────────────────── */

function mapPlan(r: Row): MaintenancePlanDto {
  return {
    machineId: String(r.machine_id),
    machineCodigo: String(r.codigo),
    machineDescripcion: String(r.descripcion),
    unidad: r.unidad as ServiceUnit,
    intervalo: Number(r.intervalo),
    ciclo: toTextArray(r.ciclo),
    proximoIndice: Number(r.proximo_indice),
    proximoHoras: Number(r.proximo_horas),
    avisoPct: Number(r.aviso_pct),
    activo: Boolean(r.activo),
  };
}

async function loadPlans(tx: Db, machineId?: string): Promise<MaintenancePlanDto[]> {
  const where: SQL = machineId ? sql`where p.machine_id = ${machineId}::uuid` : sql``;
  const rows = await query<Row>(
    tx,
    sql`select p.machine_id, m.codigo, m.descripcion, p.unidad, p.intervalo::float8 as intervalo, p.ciclo,
               p.proximo_indice, p.proximo_horas::float8 as proximo_horas, p.aviso_pct::float8 as aviso_pct, p.activo
        from maintenance_plans p join machines m on m.id = p.machine_id
        ${where} order by m.codigo`,
  );
  return rows.map(mapPlan);
}

/* ─── Órdenes ──────────────────────────────────────────────────────────── */

function mapOrder(r: Row): ServiceOrderDto {
  const horasIdeal = num(r.horas_ideal);
  const horasReal = num(r.horas_real);
  return {
    id: String(r.id),
    numero: Number(r.numero),
    machine: { id: String(r.machine_id), codigo: String(r.mcodigo), descripcion: String(r.mdescripcion) },
    worksite: r.obra_id ? { id: String(r.obra_id), nombre: String(r.obra_nombre) } : null,
    tipo: { codigo: String(r.tipo_codigo), nombre: String(r.tipo_nombre) },
    unidad: r.unidad as ServiceUnit,
    estado: r.estado as ServiceOrderState,
    fechaEmision: String(r.fecha_emision),
    horasIdeal,
    horasActual: num(r.horas_actual),
    fechaPedido: str(r.fecha_pedido),
    fechaDevuelta: str(r.fecha_devuelta),
    fechaRealizado: str(r.fecha_realizado),
    horasReal,
    atraso: horasIdeal !== null && horasReal !== null ? lateness(horasReal, horasIdeal) : null,
    pedido: r.pedido_id ? { id: String(r.pedido_id), numero: Number(r.pedido_numero) } : null,
    tareas: jsonValue(r.tareas, []),
    filtros: jsonValue(r.filtros, []),
    capacidades: jsonValue(r.capacidades, []),
    proximoHoras: num(r.proximo_horas),
    proximoTipo: str(r.proximo_tipo),
    observaciones: str(r.observaciones),
    anuladoMotivo: str(r.anulado_motivo),
  };
}

async function loadOrders(
  tx: Db,
  f: { ids?: string[]; estado?: ServiceOrderState; maquina?: string; obra?: string; desde?: string; hasta?: string },
): Promise<ServiceOrderDto[]> {
  const conditions: SQL[] = [];
  if (f.ids) conditions.push(sql`o.id in ${sqlList(f.ids)}`);
  if (f.estado) conditions.push(sql`o.estado = ${f.estado}`);
  if (f.maquina) conditions.push(sql`o.machine_id = ${f.maquina}::uuid`);
  if (f.obra) conditions.push(sql`o.worksite_id = ${f.obra}::uuid`);
  if (f.desde) conditions.push(sql`o.fecha_emision >= ${f.desde}::date`);
  if (f.hasta) conditions.push(sql`o.fecha_emision <= ${f.hasta}::date`);
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const rows = await query<Row>(
    tx,
    sql`select o.id, o.numero, o.machine_id, m.codigo as mcodigo, m.descripcion as mdescripcion,
               w.id as obra_id, w.nombre as obra_nombre, o.tipo_codigo, o.tipo_nombre, o.unidad, o.estado,
               o.fecha_emision::text as fecha_emision, o.horas_ideal::float8 as horas_ideal,
               o.horas_actual::float8 as horas_actual, o.fecha_pedido::text as fecha_pedido,
               o.fecha_devuelta::text as fecha_devuelta, o.fecha_realizado::text as fecha_realizado,
               o.horas_real::float8 as horas_real, mo.id as pedido_id, mo.numero as pedido_numero,
               o.tareas, o.filtros, o.capacidades, o.proximo_horas::float8 as proximo_horas, o.proximo_tipo,
               o.observaciones, o.anulado_motivo
        from service_orders o
        join machines m on m.id = o.machine_id
        left join worksites w on w.id = o.worksite_id
        left join material_orders mo on mo.id = o.order_id
        ${where}
        order by o.fecha_emision desc, o.numero desc`,
  );
  return rows.map(mapOrder);
}

interface PlanRow {
  intervalo: number;
  ciclo: string[];
  proximoIndice: number;
  proximoHoras: number;
  avisoPct: number;
  activo: boolean;
}

async function planRow(tx: Db, machineId: string): Promise<PlanRow | null> {
  const [r] = await query<Row>(
    tx,
    sql`select intervalo::float8 as intervalo, ciclo, proximo_indice, proximo_horas::float8 as proximo_horas,
               aviso_pct::float8 as aviso_pct, activo
        from maintenance_plans where machine_id = ${machineId}::uuid`,
  );
  if (!r) return null;
  return {
    intervalo: Number(r.intervalo),
    ciclo: toTextArray(r.ciclo),
    proximoIndice: Number(r.proximo_indice),
    proximoHoras: Number(r.proximo_horas),
    avisoPct: Number(r.aviso_pct),
    activo: Boolean(r.activo),
  };
}

/**
 * Registra la lectura de las horas reales y calcula el próximo servicio: horas reales + intervalo,
 * con el ciclo avanzado desde el tipo realizado. Solo mueve el plan si es el servicio más reciente
 * de la máquina (registrar uno histórico no lo hace retroceder).
 */
async function applyCompletion(
  tx: Db,
  companyId: string,
  machine: MachineDto,
  order: { id: string | null; tipoCodigo: string; fechaEmision: string },
  input: z.infer<typeof completionSchema>,
): Promise<{ proximoHoras: number | null; proximoTipo: string | null }> {
  const errors = validateServiceCompletion({ fecha: input.fecha, fechaEmision: order.fechaEmision, horasReal: input.horasReal }, today());
  if (errors.length > 0) throw new Rejected(errors);
  const reading = await insertReading(
    tx,
    companyId,
    { id: machine.id, meterUnit: machine.meterUnit },
    { fecha: input.fecha, valor: input.horasReal, correccion: input.correccion, motivo: input.motivo },
    'SERVICIO',
    null,
  );
  if (reading.errors.length > 0) throw new Rejected(reading.errors);

  const plan = await planRow(tx, machine.id);
  if (!plan || !plan.activo) return { proximoHoras: null, proximoTipo: null };
  const proximoHoras = Math.round((input.horasReal + plan.intervalo) * 10) / 10;
  const done = plan.ciclo.indexOf(order.tipoCodigo);
  const fromIndex = plan.ciclo[plan.proximoIndice] === order.tipoCodigo ? plan.proximoIndice : done >= 0 ? done : plan.proximoIndice;
  const nextIndex = nextCycleIndex(plan.ciclo.length, fromIndex);
  const proximoTipo = plan.ciclo[nextIndex] ?? null;

  const later = await query<Row>(
    tx,
    sql`select 1 from service_orders where machine_id = ${machine.id}::uuid and estado = 'REALIZADA'
        and fecha_realizado > ${input.fecha}::date and id is distinct from ${order.id}::uuid limit 1`,
  );
  if (later.length === 0) {
    await query(
      tx,
      sql`update maintenance_plans set proximo_indice = ${nextIndex}, proximo_horas = ${proximoHoras}, updated_at = now()
          where machine_id = ${machine.id}::uuid`,
    );
  }
  return { proximoHoras, proximoTipo };
}

/** Crea la orden: emitida, o ya realizada si se registra un servicio histórico. */
async function createOrder(tx: Db, companyId: string, body: z.infer<typeof emitSchema>): Promise<{ id: string; advertencias: string[] }> {
  const missing = [...(await missingIds(tx, 'machines', [body.machineId])), ...(await missingIds(tx, 'worksites', [body.worksiteId]))];
  if (missing.length > 0) throw new Rejected(['La máquina o la obra elegidas no existen.']);
  const [machine] = await loadMachines(tx, { ids: [body.machineId], incluirBaja: true, incluirNoMaquinas: true }, { withDetail: true });
  const plan = await planRow(tx, machine.id);

  const tipoCodigo = body.tipoCodigo?.trim() || (plan?.activo ? plan.ciclo[plan.proximoIndice] : undefined);
  if (!tipoCodigo) throw new Rejected(['La máquina no tiene plan: elegí el tipo de servicio.']);
  const [tipo] = await query<Row>(tx, sql`select codigo, nombre, unidad, tareas, activo from service_types where codigo = ${tipoCodigo}`);
  if (!tipo || !Boolean(tipo.activo)) throw new Rejected([`El tipo de servicio «${tipoCodigo}» no existe o está inactivo.`]);
  if (tipo.unidad !== machine.meterUnit) {
    throw new Rejected([`El tipo es en ${tipo.unidad} y la máquina se mide en ${machine.meterUnit}.`]);
  }

  if (!body.realizado) {
    const open = await query<Row>(tx, sql`select numero from service_orders where machine_id = ${machine.id}::uuid and estado = 'EMITIDA' limit 1`);
    if (open.length > 0) throw new Rejected([`La máquina ya tiene la orden abierta N.º ${open[0].numero}. Realizala o anulala antes de emitir otra.`], 409);
  }

  const horasActual = machine.lecturaActual?.valor ?? null;
  const horasIdeal = body.horasIdeal ?? (plan?.activo ? plan.proximoHoras : null);
  const worksiteId = body.worksiteId ?? machine.worksite?.id ?? null;
  const numero = await nextDocumentNumber(tx, companyId, 'SERVICIO');
  const advertencias: string[] = [];

  let proximo: { proximoHoras: number | null; proximoTipo: string | null } = { proximoHoras: null, proximoTipo: null };
  if (body.realizado) {
    proximo = await applyCompletion(tx, companyId, machine, { id: null, tipoCodigo, fechaEmision: body.fechaEmision }, body.realizado);
  }

  const done = body.realizado;
  const [row] = await query<{ id: string }>(
    tx,
    sql`insert into service_orders (company_id, numero, machine_id, worksite_id, tipo_codigo, tipo_nombre, unidad, estado,
                                    fecha_emision, horas_ideal, horas_actual, fecha_devuelta, fecha_realizado, horas_real,
                                    tareas, filtros, capacidades, proximo_horas, proximo_tipo, observaciones)
        values (${companyId}, ${numero}, ${machine.id}, ${worksiteId}, ${String(tipo.codigo)}, ${String(tipo.nombre)}, ${String(tipo.unidad)},
                ${done ? 'REALIZADA' : 'EMITIDA'}, ${body.fechaEmision}::date, ${horasIdeal}, ${horasActual},
                ${done?.fechaDevuelta ?? null}::date, ${done?.fecha ?? null}::date, ${done?.horasReal ?? null},
                ${JSON.stringify(jsonValue(tipo.tareas, []))}::jsonb, ${JSON.stringify(machine.filters)}::jsonb,
                ${JSON.stringify(machine.fluids)}::jsonb, ${proximo.proximoHoras}, ${proximo.proximoTipo}, ${body.observaciones ?? null})
        returning id`,
  );

  if (!done && body.generarPedido) {
    const lines = machine.filters
      .filter((f) => (f.cantidad ?? 0) > 0)
      .map((f) => ({ nroParte: f.referencia, descripcion: `Filtro ${f.tipo}`, cantidad: f.cantidad as number, machineId: machine.id }));
    if (lines.length === 0) {
      advertencias.push('La máquina no tiene filtros cargados: la orden se emitió sin pedido de repuestos.');
    } else {
      const orderId = await createMaterialOrder(tx, companyId, {
        fecha: body.fechaEmision,
        worksiteId,
        machineId: machine.id,
        supplierId: null,
        pedidoDeObra: false,
        compraCentral: false,
        rubros: ['FILTROS'],
        observaciones: `Servicio ${tipo.nombre} — orden de servicio N.º ${numero}`,
        lines,
      });
      await query(tx, sql`update service_orders set order_id = ${orderId}::uuid, fecha_pedido = ${body.fechaEmision}::date where id = ${row.id}::uuid`);
    }
  }
  return { id: row.id, advertencias };
}

/* ─── Programa ─────────────────────────────────────────────────────────── */

const STATE_RANK: Record<ProgramStatus, number> = { VENCIDO: 0, PROXIMO: 1, VIGENTE: 2, SIN_LECTURA: 3, SIN_PLAN: 4 };

export async function loadProgram(tx: Db, f: { obra?: string; estado?: ProgramStatus; q?: string }): Promise<ProgramRowDto[]> {
  const machines = (await loadMachines(tx, { obra: f.obra, mantenimiento: true })).filter((m) => !f.q || matchesMachineSearch(m, f.q));
  if (machines.length === 0) return [];
  const ids = machines.map((m) => m.id);
  const plans = new Map((await loadPlans(tx)).map((p) => [p.machineId, p]));
  const open = await query<Row>(
    tx,
    sql`select id, numero, machine_id, tipo_codigo from service_orders where estado = 'EMITIDA' and machine_id in ${sqlList(ids)}`,
  );
  const openByMachine = new Map(open.map((r) => [String(r.machine_id), { id: String(r.id), numero: Number(r.numero), tipo: String(r.tipo_codigo) }]));
  const hoy = today();
  const readingRows = await query<Row>(
    tx,
    sql`select machine_id, fecha::text as fecha, valor::float8 as valor from machine_readings
        where machine_id in ${sqlList(ids)} and observado = false and fecha >= ${hoy}::date - ${USAGE_WINDOW_DAYS}::int order by fecha`,
  );
  const readings = new Map<string, { fecha: string; valor: number }[]>();
  for (const r of readingRows) {
    const list = readings.get(String(r.machine_id)) ?? [];
    list.push({ fecha: String(r.fecha), valor: Number(r.valor) });
    readings.set(String(r.machine_id), list);
  }

  const rows = machines.map((m): ProgramRowDto => {
    const plan = plans.get(m.id);
    const base = {
      machine: { id: m.id, codigo: m.codigo, descripcion: m.descripcion, meterUnit: m.meterUnit },
      worksite: m.worksite,
      lectura: m.lecturaActual,
      ordenAbierta: openByMachine.get(m.id) ?? null,
    };
    if (!plan || !plan.activo) {
      return { ...base, plan: null, proximoHoras: null, proximoTipo: null, restante: null, estado: 'SIN_PLAN', fechaEstimada: null };
    }
    const status = maintenanceStatus({ actual: m.lecturaActual?.valor, proximo: plan.proximoHoras, intervalo: plan.intervalo, avisoPct: plan.avisoPct });
    return {
      ...base,
      plan: { intervalo: plan.intervalo, ciclo: plan.ciclo, proximoIndice: plan.proximoIndice, avisoPct: plan.avisoPct },
      proximoHoras: plan.proximoHoras,
      proximoTipo: plan.ciclo[plan.proximoIndice] ?? null,
      restante: status.restante,
      estado: status.estado,
      fechaEstimada: status.restante === null ? null : projectDueDate(readings.get(m.id) ?? [], status.restante, hoy),
    };
  });
  return rows
    .filter((r) => !f.estado || r.estado === f.estado)
    .sort((a, b) => STATE_RANK[a.estado] - STATE_RANK[b.estado] || (a.restante ?? 0) - (b.restante ?? 0) || a.machine.codigo.localeCompare(b.machine.codigo));
}

/* ─── Router ───────────────────────────────────────────────────────────── */

export function maintenanceRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  router.use('/api/mantenimiento', deps.requireAuth);
  router.use('/api/informes/mantenimiento-cumplimiento', deps.requireAuth);

  /* Tipos */
  router.get(
    '/api/mantenimiento/tipos',
    asyncRoute(async (req, res) => {
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadTypes(tx)));
    }),
  );

  router.post(
    '/api/mantenimiento/tipos/predeterminados',
    asyncRoute(async (req, res) => {
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        for (const t of DEFAULT_SERVICE_TYPES) {
          await query(
            tx,
            sql`insert into service_types (company_id, codigo, nombre, valor, unidad, tareas)
                values (${companyId}, ${t.codigo}, ${t.nombre}, ${t.valor}, ${t.unidad}, ${JSON.stringify(t.tareas)}::jsonb)
                on conflict (company_id, codigo) do nothing`,
          );
        }
        return loadTypes(tx);
      });
    }),
  );

  router.post(
    '/api/mantenimiento/tipos',
    asyncRoute(async (req, res) => {
      const body = parseBody(typeCreateSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(
        db,
        res,
        companyId,
        async (tx) => {
          const codigo = serviceTypeCode(body.valor, body.unidad);
          const dup = await query<Row>(tx, sql`select 1 from service_types where codigo = ${codigo}`);
          if (dup.length > 0) throw new Rejected([`Ya existe el tipo «${codigo}».`], 409);
          const [row] = await query<Row>(
            tx,
            sql`insert into service_types (company_id, codigo, nombre, valor, unidad, tareas)
                values (${companyId}, ${codigo}, ${body.nombre}, ${body.valor}, ${body.unidad}, ${JSON.stringify(body.tareas)}::jsonb)
                returning id, codigo, nombre, valor::float8 as valor, unidad, tareas, activo`,
          );
          return mapType(row);
        },
        201,
      );
    }),
  );

  router.put(
    '/api/mantenimiento/tipos/:id',
    asyncRoute(async (req, res) => {
      const body = parseBody(typeUpdateSchema, req, res);
      if (!body) return;
      const id = String(req.params.id);
      if (!uuid.safeParse(id).success) {
        res.status(404).json({ error: 'Tipo de servicio no encontrado.' });
        return;
      }
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [row] = await query<Row>(
          tx,
          sql`update service_types set nombre = ${body.nombre}, tareas = ${JSON.stringify(body.tareas)}::jsonb, activo = ${body.activo}
              where id = ${id}::uuid
              returning id, codigo, nombre, valor::float8 as valor, unidad, tareas, activo`,
        );
        if (!row) throw new Rejected(['Tipo de servicio no encontrado.'], 404);
        return mapType(row);
      });
    }),
  );

  /* Planes */
  router.get(
    '/api/mantenimiento/planes',
    asyncRoute(async (req, res) => {
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadPlans(tx)));
    }),
  );

  router.put(
    '/api/mantenimiento/planes/:machineId',
    asyncRoute(async (req, res) => {
      const body = parseBody(planSchema, req, res);
      if (!body) return;
      const machineId = String(req.params.machineId);
      if (!uuid.safeParse(machineId).success) {
        res.status(404).json({ error: 'Máquina no encontrada.' });
        return;
      }
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        if ((await missingIds(tx, 'machines', [machineId])).length > 0) throw new Rejected(['Máquina no encontrada.'], 404);
        const [machine] = await loadMachines(tx, { ids: [machineId], incluirBaja: true, incluirNoMaquinas: true });
        const errors = validatePlan({ intervalo: body.intervalo, ciclo: body.ciclo, proximoHoras: body.proximoHoras, avisoPct: body.avisoPct });
        if (body.proximoIndice >= body.ciclo.length) errors.push('La posición en el ciclo no existe.');
        const types = await loadTypes(tx);
        for (const code of new Set(body.ciclo)) {
          const t = types.find((x) => x.codigo === code && x.activo);
          if (!t) errors.push(`El tipo «${code}» del ciclo no existe o está inactivo.`);
          else if (t.unidad !== machine.meterUnit) errors.push(`El tipo «${code}» es en ${t.unidad} y la máquina se mide en ${machine.meterUnit}.`);
        }
        if (errors.length > 0) throw new Rejected(errors);
        await query(
          tx,
          sql`insert into maintenance_plans (company_id, machine_id, unidad, intervalo, ciclo, proximo_indice, proximo_horas, aviso_pct, activo)
              values (${companyId}, ${machineId}::uuid, ${machine.meterUnit}, ${body.intervalo}, ${textArray(body.ciclo)}::text[],
                      ${body.proximoIndice}, ${body.proximoHoras}, ${body.avisoPct}, ${body.activo})
              on conflict (company_id, machine_id) do update set
                unidad = excluded.unidad, intervalo = excluded.intervalo, ciclo = excluded.ciclo,
                proximo_indice = excluded.proximo_indice, proximo_horas = excluded.proximo_horas,
                aviso_pct = excluded.aviso_pct, activo = excluded.activo, updated_at = now()`,
        );
        return (await loadPlans(tx, machineId))[0];
      });
    }),
  );

  /* Programa */
  router.get(
    '/api/mantenimiento/programa',
    asyncRoute(async (req, res) => {
      const parsed = programFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadProgram(tx, parsed.data)));
    }),
  );

  /* Órdenes */
  router.get(
    '/api/mantenimiento/ordenes',
    asyncRoute(async (req, res) => {
      const parsed = orderFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadOrders(tx, parsed.data)));
    }),
  );

  router.get(
    '/api/mantenimiento/ordenes/:id',
    asyncRoute(async (req, res) => {
      const id = String(req.params.id);
      const order = uuid.safeParse(id).success
        ? (await withTenant(db, req.auth!.companyId, (tx) => loadOrders(tx, { ids: [id] })))[0]
        : undefined;
      if (!order) {
        res.status(404).json({ error: 'Orden de servicio no encontrada.' });
        return;
      }
      res.json(order);
    }),
  );

  router.post(
    '/api/mantenimiento/ordenes',
    asyncRoute(async (req, res) => {
      const body = parseBody(emitSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(
        db,
        res,
        companyId,
        async (tx) => {
          const { id, advertencias } = await createOrder(tx, companyId, body);
          return { ...(await loadOrders(tx, { ids: [id] }))[0], advertencias };
        },
        201,
      );
    }),
  );

  router.post(
    '/api/mantenimiento/ordenes/:id/realizar',
    asyncRoute(async (req, res) => {
      const body = parseBody(completionSchema, req, res);
      if (!body) return;
      const id = String(req.params.id);
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        const [order] = uuid.safeParse(id).success
          ? await query<Row>(tx, sql`select id, machine_id, estado, tipo_codigo, fecha_emision::text as fecha_emision from service_orders where id = ${id}::uuid for update`)
          : [];
        if (!order) throw new Rejected(['Orden de servicio no encontrada.'], 404);
        if (order.estado !== 'EMITIDA') throw new Rejected([`La orden está ${String(order.estado).toLowerCase()}: solo se puede realizar una orden emitida.`], 409);
        const [machine] = await loadMachines(tx, { ids: [String(order.machine_id)], incluirBaja: true, incluirNoMaquinas: true });
        const proximo = await applyCompletion(tx, companyId, machine, { id, tipoCodigo: String(order.tipo_codigo), fechaEmision: String(order.fecha_emision) }, body);
        await query(
          tx,
          sql`update service_orders set estado = 'REALIZADA', fecha_realizado = ${body.fecha}::date, horas_real = ${body.horasReal},
                 fecha_devuelta = coalesce(${body.fechaDevuelta ?? null}::date, fecha_devuelta),
                 proximo_horas = ${proximo.proximoHoras}, proximo_tipo = ${proximo.proximoTipo}
              where id = ${id}::uuid`,
        );
        return (await loadOrders(tx, { ids: [id] }))[0];
      });
    }),
  );

  router.post(
    '/api/mantenimiento/ordenes/:id/anular',
    asyncRoute(async (req, res) => {
      const body = parseBody(cancelSchema, req, res);
      if (!body) return;
      const id = String(req.params.id);
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [order] = uuid.safeParse(id).success ? await query<Row>(tx, sql`select estado from service_orders where id = ${id}::uuid for update`) : [];
        if (!order) throw new Rejected(['Orden de servicio no encontrada.'], 404);
        if (order.estado !== 'EMITIDA') throw new Rejected(['Solo se puede anular una orden emitida.'], 409);
        await query(tx, sql`update service_orders set estado = 'ANULADA', anulado_motivo = ${body.motivo} where id = ${id}::uuid`);
        return (await loadOrders(tx, { ids: [id] }))[0];
      });
    }),
  );

  /* Informe de cumplimiento */
  router.get(
    '/api/informes/mantenimiento-cumplimiento',
    asyncRoute(async (req, res) => {
      const parsed = orderFiltersSchema.pick({ obra: true, desde: true, hasta: true }).safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const orders = await withTenant(db, req.auth!.companyId, (tx) => loadOrders(tx, { ...parsed.data, estado: 'REALIZADA' }));
      const groups = new Map<string, ComplianceRowDto & { sum: number }>();
      for (const o of orders) {
        if (!o.atraso) continue;
        const key = `${o.machine.id}|${o.tipo.codigo}`;
        const g = groups.get(key) ?? {
          machine: o.machine, tipo: o.tipo.codigo, cantidad: 0, diferenciaPromedio: 0, aTiempo: 0, hasta50: 0, de51a150: 0, masDe150: 0, pctATiempo: 0, sum: 0,
        };
        g.cantidad += 1;
        g.sum += o.atraso.diferencia;
        if (o.atraso.bucket === 'A_TIEMPO') g.aTiempo += 1;
        else if (o.atraso.bucket === 'HASTA_50') g.hasta50 += 1;
        else if (o.atraso.bucket === 'DE_51_A_150') g.de51a150 += 1;
        else g.masDe150 += 1;
        groups.set(key, g);
      }
      const rows: ComplianceRowDto[] = [...groups.values()]
        .map(({ sum, ...g }) => ({
          ...g,
          diferenciaPromedio: Math.round((sum / g.cantidad) * 10) / 10,
          pctATiempo: Math.round((g.aTiempo / g.cantidad) * 100),
        }))
        .sort((a, b) => a.machine.codigo.localeCompare(b.machine.codigo) || a.tipo.localeCompare(b.tipo));
      res.json(rows);
    }),
  );

  return router;
}
