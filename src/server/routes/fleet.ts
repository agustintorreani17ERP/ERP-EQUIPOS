/**
 * @file server/routes/fleet.ts
 * @description Flota: máquinas (ficha completa, filtros y fluidos), categorías y lecturas de
 * horómetro/odómetro. Las lecturas se validan contra las vecinas en el tiempo: un valor
 * no puede bajar sin una corrección con motivo.
 * La edición (PUT) reemplaza la ficha completa: los campos omitidos quedan vacíos.
 */

import { Router, type RequestHandler } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import {
  complianceStatus,
  differenceSincePrevious,
  normalizeMachineCode,
  validateReading,
  type ComplianceStatus,
  type MachineStatus,
  type MeterUnit,
  type ReadingPoint,
  type ReadingSource,
} from '../../shared/fleet';
import { asyncRoute, missingIds, parseBody, query, sqlList, type Row } from './helpers';

const MACHINE_STATUSES = ['ACTIVA', 'PARADA', 'EN_DESUSO', 'BAJA'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.');
const uuid = z.uuid();
const nullableDate = isoDate.nullable().optional();

const DEFAULT_CATEGORIES = [
  'Topadoras',
  'Palas',
  'Excavadoras',
  'Tractores',
  'Camiones',
  'Camionetas',
  'Motoniveladoras',
  'Compactadores',
  'Mixers',
  'Fresadoras',
  'Motobombas',
  'Generadores',
  'Compresores',
  'Carretas',
  'Otros',
];

const filterSchema = z.object({
  tipo: z.string().trim().min(1).max(60),
  referencia: z.string().trim().max(80).nullable().optional(),
  cantidad: z.number().nonnegative().nullable().optional(),
});

const fluidSchema = z.object({
  punto: z.string().trim().min(1).max(60),
  producto: z.string().trim().max(80).nullable().optional(),
  capacidadLitros: z.number().nonnegative().nullable().optional(),
});

const machineSchema = z.object({
  codigo: z.string().trim().min(1).max(20),
  descripcion: z.string().trim().min(1).max(120),
  marca: z.string().trim().max(60).nullable().optional(),
  modelo: z.string().trim().max(60).nullable().optional(),
  anio: z.number().int().min(1950).max(2100).nullable().optional(),
  procedencia: z.string().trim().max(60).nullable().optional(),
  tipoMotor: z.string().trim().max(60).nullable().optional(),
  hp: z.number().nonnegative().nullable().optional(),
  numeroMotor: z.string().trim().max(60).nullable().optional(),
  numeroSerie: z.string().trim().max(60).nullable().optional(),
  chapa: z.string().trim().max(20).nullable().optional(),
  color: z.string().trim().max(30).nullable().optional(),
  fechaIngreso: nullableDate,
  worksiteId: uuid.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  meterUnit: z.enum(['HS', 'KM']).default('HS'),
  status: z.enum(MACHINE_STATUSES).default('ACTIVA'),
  paradaDesde: nullableDate,
  esMaquina: z.boolean().default(true),
  llevaMantenimiento: z.boolean().default(false),
  monitoreoSatelital: z.boolean().default(false),
  dinatran: z.boolean().default(false),
  dinatranVence: nullableDate,
  habilitacionMunicipalVence: nullableDate,
  observaciones: z.string().max(500).nullable().optional(),
  filters: z.array(filterSchema).optional(),
  fluids: z.array(fluidSchema).optional(),
});

const listFiltersSchema = z.object({
  q: z.string().max(80).optional(),
  obra: uuid.optional(),
  categoria: uuid.optional(),
  estado: z.enum(MACHINE_STATUSES).optional(),
  mantenimiento: z.enum(['true', 'false']).optional(),
  monitoreo: z.enum(['true', 'false']).optional(),
  conChapa: z.enum(['true', 'false']).optional(),
  incluirNoMaquinas: z.enum(['true', 'false']).optional(),
  incluirBaja: z.enum(['true', 'false']).optional(),
  observadas: z.enum(['true', 'false']).optional(),
});

const readingSchema = z.object({
  fecha: isoDate,
  valor: z.number().finite(),
  correccion: z.boolean().default(false),
  motivo: z.string().max(200).nullable().optional(),
});

const categorySchema = z.object({ nombre: z.string().trim().min(1).max(60) });

export interface ReadingInput {
  fecha: string;
  valor: number;
  correccion?: boolean;
  motivo?: string | null;
}

export interface ReadingDto {
  id: string;
  fecha: string;
  valor: number;
  unidad: MeterUnit;
  fuente: ReadingSource;
  correccion: boolean;
  motivo: string | null;
  parteId: string | null;
  diferencial: number;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Lecturas inmediatas anterior y posterior a una fecha, para validar la nueva. Las del mismo día cuentan
 * como anteriores (la última cargada manda): así un servicio hecho hoy puede subir la lectura de hoy.
 */
export async function readingNeighbors(
  tx: Db,
  machineId: string,
  fecha: string,
): Promise<{ previous: ReadingPoint | null; next: ReadingPoint | null }> {
  const prev = await query<Row>(
    tx,
    sql`select fecha::text as fecha, valor::float8 as valor from machine_readings
        where machine_id = ${machineId} and fecha <= ${fecha}::date and observado = false
        order by fecha desc, created_at desc limit 1`,
  );
  const next = await query<Row>(
    tx,
    sql`select fecha::text as fecha, valor::float8 as valor from machine_readings
        where machine_id = ${machineId} and fecha > ${fecha}::date and observado = false
        order by fecha asc, created_at asc limit 1`,
  );
  const toPoint = (r: Row | undefined): ReadingPoint | null =>
    r ? { fecha: String(r.fecha), valor: Number(r.valor) } : null;
  return { previous: toPoint(prev[0]), next: toPoint(next[0]) };
}

/**
 * Valida y registra una lectura dentro de una transacción existente. Devuelve los errores
 * sin escribir nada si la lectura no es válida, así el llamador decide si aborta todo.
 */
export async function insertReading(
  tx: Db,
  companyId: string,
  machine: { id: string; meterUnit: MeterUnit },
  input: ReadingInput,
  fuente: ReadingSource,
  parteId: string | null,
  fuelMovementId: string | null = null,
): Promise<{ errors: string[]; reading?: ReadingDto }> {
  const { previous, next } = await readingNeighbors(tx, machine.id, input.fecha);
  const errors = validateReading({
    previous,
    next,
    fecha: input.fecha,
    valor: input.valor,
    correccion: input.correccion,
    motivo: input.motivo,
  });
  if (errors.length > 0) return { errors };

  const [row] = await query<Row>(
    tx,
    sql`insert into machine_readings (company_id, machine_id, fecha, valor, unidad, fuente, parte_id, fuel_movement_id, correccion, motivo)
        values (${companyId}, ${machine.id}, ${input.fecha}::date, ${input.valor}, ${machine.meterUnit},
                ${fuente}, ${parteId}, ${fuelMovementId}, ${input.correccion ?? false}, ${input.motivo ?? null})
        returning id, fecha::text as fecha, valor::float8 as valor, unidad, fuente, correccion, motivo, parte_id`,
  );
  return {
    errors: [],
    reading: {
      id: String(row.id),
      fecha: String(row.fecha),
      valor: Number(row.valor),
      unidad: row.unidad as MeterUnit,
      fuente: row.fuente as ReadingSource,
      correccion: Boolean(row.correccion),
      motivo: nullableString(row.motivo),
      parteId: nullableString(row.parte_id),
      diferencial: differenceSincePrevious(previous, input.valor),
    },
  };
}

export interface MachineDto {
  id: string;
  codigo: string;
  descripcion: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  chapa: string | null;
  status: MachineStatus;
  /** Cargada por una importación con datos dudosos (por ejemplo, un código sin ficha en el Access). */
  observado: boolean;
  meterUnit: MeterUnit;
  esMaquina: boolean;
  llevaMantenimiento: boolean;
  monitoreoSatelital: boolean;
  worksite: { id: string; nombre: string } | null;
  category: { id: string; nombre: string } | null;
  lecturaActual: { valor: number; fecha: string } | null;
  dinatran: { vence: string | null; estado: ComplianceStatus };
  habilitacionMunicipal: { vence: string | null; estado: ComplianceStatus };
  filters: { tipo: string; referencia: string | null; cantidad: number | null }[];
  fluids: { punto: string; producto: string | null; capacidadLitros: number | null }[];
  observaciones: string | null;
  fechaIngreso: string | null;
  paradaDesde: string | null;
}

/** Máquinas con lectura actual, vencimientos y, si se pide, filtros y fluidos. */
export async function loadMachines(
  tx: Db,
  filters: { ids?: string[]; q?: string; obra?: string; categoria?: string; estado?: MachineStatus; mantenimiento?: boolean;
    monitoreo?: boolean; conChapa?: boolean; incluirNoMaquinas?: boolean; incluirBaja?: boolean; observadas?: boolean },
  opts: { withDetail?: boolean } = {},
): Promise<MachineDto[]> {
  const conditions: SQL[] = [];
  if (filters.ids) conditions.push(sql`m.id in ${sqlList(filters.ids)}`);
  if (filters.q) {
    const q = normalizeMachineCode(filters.q);
    if (q) conditions.push(sql`regexp_replace(upper(m.codigo || ' ' || m.descripcion), '[^A-Z0-9]', '', 'g') like ${`%${q}%`}`);
  }
  if (filters.obra) conditions.push(sql`m.worksite_id = ${filters.obra}::uuid`);
  if (filters.categoria) conditions.push(sql`m.category_id = ${filters.categoria}::uuid`);
  if (filters.estado) conditions.push(sql`m.status = ${filters.estado}`);
  else if (!filters.incluirBaja) conditions.push(sql`m.status <> 'BAJA'`);
  if (filters.mantenimiento !== undefined) conditions.push(sql`m.lleva_mantenimiento = ${filters.mantenimiento}`);
  if (filters.monitoreo !== undefined) conditions.push(sql`m.monitoreo_satelital = ${filters.monitoreo}`);
  if (filters.conChapa) conditions.push(sql`m.chapa is not null and m.chapa <> ''`);
  if (!filters.incluirNoMaquinas) conditions.push(sql`m.es_maquina = true`);
  if (filters.observadas) conditions.push(sql`m.observado = true`);
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;

  const rows = await query<Row>(
    tx,
    sql`select m.id, m.codigo, m.descripcion, m.marca, m.modelo, m.anio, m.chapa, m.status, m.meter_unit,
               m.es_maquina, m.lleva_mantenimiento, m.monitoreo_satelital, m.observaciones, m.observado,
               m.fecha_ingreso::text as fecha_ingreso, m.parada_desde::text as parada_desde,
               m.dinatran_vence::text as dinatran_vence, m.habilitacion_municipal_vence::text as habilitacion_vence,
               w.id as obra_id, w.nombre as obra_nombre,
               c.id as categoria_id, c.nombre as categoria_nombre,
               lr.valor as lectura_valor, lr.fecha as lectura_fecha
        from machines m
        left join worksites w on w.id = m.worksite_id
        left join machine_categories c on c.id = m.category_id
        left join lateral (
          select r.valor::float8 as valor, r.fecha::text as fecha from machine_readings r
          where r.machine_id = m.id and r.observado = false order by r.fecha desc, r.created_at desc limit 1
        ) lr on true
        ${where}
        order by m.codigo`,
  );

  const ids = rows.map((r) => String(r.id));
  const filterRows = opts.withDetail && ids.length > 0
    ? await query<Row>(tx, sql`select machine_id, tipo, referencia, cantidad::float8 as cantidad from machine_filters where machine_id in ${sqlList(ids)} order by tipo`)
    : [];
  const fluidRows = opts.withDetail && ids.length > 0
    ? await query<Row>(tx, sql`select machine_id, punto, producto, capacidad_litros::float8 as capacidad from machine_fluids where machine_id in ${sqlList(ids)} order by punto`)
    : [];

  const hoy = today();
  return rows.map((r) => {
    const id = String(r.id);
    const dinatranVence = nullableString(r.dinatran_vence);
    const habVence = nullableString(r.habilitacion_vence);
    return {
      id,
      codigo: String(r.codigo),
      descripcion: String(r.descripcion),
      marca: nullableString(r.marca),
      modelo: nullableString(r.modelo),
      anio: r.anio === null || r.anio === undefined ? null : Number(r.anio),
      chapa: nullableString(r.chapa),
      status: r.status as MachineStatus,
      observado: Boolean(r.observado),
      meterUnit: r.meter_unit as MeterUnit,
      esMaquina: Boolean(r.es_maquina),
      llevaMantenimiento: Boolean(r.lleva_mantenimiento),
      monitoreoSatelital: Boolean(r.monitoreo_satelital),
      worksite: nullableString(r.obra_id) ? { id: String(r.obra_id), nombre: String(r.obra_nombre) } : null,
      category: nullableString(r.categoria_id) ? { id: String(r.categoria_id), nombre: String(r.categoria_nombre) } : null,
      lecturaActual: nullableString(r.lectura_fecha)
        ? { valor: Number(r.lectura_valor), fecha: String(r.lectura_fecha) }
        : null,
      dinatran: { vence: dinatranVence, estado: complianceStatus(dinatranVence, hoy) },
      habilitacionMunicipal: { vence: habVence, estado: complianceStatus(habVence, hoy) },
      filters: filterRows
        .filter((f) => String(f.machine_id) === id)
        .map((f) => ({ tipo: String(f.tipo), referencia: nullableString(f.referencia), cantidad: f.cantidad === null ? null : Number(f.cantidad) })),
      fluids: fluidRows
        .filter((f) => String(f.machine_id) === id)
        .map((f) => ({ punto: String(f.punto), producto: nullableString(f.producto), capacidadLitros: f.capacidad === null ? null : Number(f.capacidad) })),
      observaciones: nullableString(r.observaciones),
      fechaIngreso: nullableString(r.fecha_ingreso),
      paradaDesde: nullableString(r.parada_desde),
    };
  });
}

async function replaceChildren(tx: Db, companyId: string, machineId: string, body: z.infer<typeof machineSchema>) {
  if (body.filters === undefined && body.fluids === undefined) return;
  if (body.filters !== undefined) {
    await query(tx, sql`delete from machine_filters where machine_id = ${machineId}`);
    for (const f of body.filters) {
      await query(
        tx,
        sql`insert into machine_filters (company_id, machine_id, tipo, referencia, cantidad)
            values (${companyId}, ${machineId}, ${f.tipo}, ${f.referencia ?? null}, ${f.cantidad ?? null})`,
      );
    }
  }
  if (body.fluids !== undefined) {
    await query(tx, sql`delete from machine_fluids where machine_id = ${machineId}`);
    for (const f of body.fluids) {
      await query(
        tx,
        sql`insert into machine_fluids (company_id, machine_id, punto, producto, capacidad_litros)
            values (${companyId}, ${machineId}, ${f.punto}, ${f.producto ?? null}, ${f.capacidadLitros ?? null})`,
      );
    }
  }
}

/** Escribe los campos de la ficha. Sirve para alta (INSERT) y edición (UPDATE). */
async function writeMachine(tx: Db, companyId: string, id: string | null, b: z.infer<typeof machineSchema>): Promise<string> {
  const values = {
    codigo: b.codigo,
    descripcion: b.descripcion,
    marca: b.marca ?? null,
    modelo: b.modelo ?? null,
    anio: b.anio ?? null,
    procedencia: b.procedencia ?? null,
    tipoMotor: b.tipoMotor ?? null,
    hp: b.hp ?? null,
    numeroMotor: b.numeroMotor ?? null,
    numeroSerie: b.numeroSerie ?? null,
    chapa: b.chapa ?? null,
    color: b.color ?? null,
    fechaIngreso: b.fechaIngreso ?? null,
    worksiteId: b.worksiteId ?? null,
    categoryId: b.categoryId ?? null,
    meterUnit: b.meterUnit,
    status: b.status,
    paradaDesde: b.paradaDesde ?? null,
    esMaquina: b.esMaquina,
    llevaMantenimiento: b.llevaMantenimiento,
    monitoreoSatelital: b.monitoreoSatelital,
    dinatran: b.dinatran,
    dinatranVence: b.dinatranVence ?? null,
    habilitacionMunicipalVence: b.habilitacionMunicipalVence ?? null,
    observaciones: b.observaciones ?? null,
  };
  if (id === null) {
    const [row] = await query<{ id: string }>(
      tx,
      sql`insert into machines (company_id, codigo, descripcion, marca, modelo, anio, procedencia, tipo_motor, hp,
            numero_motor, numero_serie, chapa, color, fecha_ingreso, worksite_id, category_id, meter_unit, status,
            parada_desde, es_maquina, lleva_mantenimiento, monitoreo_satelital, dinatran, dinatran_vence,
            habilitacion_municipal_vence, observaciones)
          values (${companyId}, ${values.codigo}, ${values.descripcion}, ${values.marca}, ${values.modelo}, ${values.anio},
            ${values.procedencia}, ${values.tipoMotor}, ${values.hp}, ${values.numeroMotor}, ${values.numeroSerie},
            ${values.chapa}, ${values.color}, ${values.fechaIngreso}::date, ${values.worksiteId}::uuid,
            ${values.categoryId}::uuid, ${values.meterUnit}, ${values.status}, ${values.paradaDesde}::date,
            ${values.esMaquina}, ${values.llevaMantenimiento}, ${values.monitoreoSatelital}, ${values.dinatran},
            ${values.dinatranVence}::date, ${values.habilitacionMunicipalVence}::date, ${values.observaciones})
          returning id`,
    );
    return String(row.id);
  }
  await query(
    tx,
    sql`update machines set codigo = ${values.codigo}, descripcion = ${values.descripcion}, marca = ${values.marca},
          modelo = ${values.modelo}, anio = ${values.anio}, procedencia = ${values.procedencia},
          tipo_motor = ${values.tipoMotor}, hp = ${values.hp}, numero_motor = ${values.numeroMotor},
          numero_serie = ${values.numeroSerie}, chapa = ${values.chapa}, color = ${values.color},
          fecha_ingreso = ${values.fechaIngreso}::date, worksite_id = ${values.worksiteId}::uuid,
          category_id = ${values.categoryId}::uuid, meter_unit = ${values.meterUnit}, status = ${values.status},
          parada_desde = ${values.paradaDesde}::date, es_maquina = ${values.esMaquina},
          lleva_mantenimiento = ${values.llevaMantenimiento}, monitoreo_satelital = ${values.monitoreoSatelital},
          dinatran = ${values.dinatran}, dinatran_vence = ${values.dinatranVence}::date,
          habilitacion_municipal_vence = ${values.habilitacionMunicipalVence}::date,
          observaciones = ${values.observaciones}
        where id = ${id}`,
  );
  return id;
}

/** Obra o categoría que no existen para la empresa (las claves foráneas no aplican RLS). */
async function hasForeignRefs(tx: Db, b: { worksiteId?: string | null; categoryId?: string | null }): Promise<boolean> {
  const missing = [
    ...(await missingIds(tx, 'worksites', [b.worksiteId])),
    ...(await missingIds(tx, 'machine_categories', [b.categoryId])),
  ];
  return missing.length > 0;
}

export function fleetRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  router.use('/api/maquinas', deps.requireAuth);
  router.use('/api/categorias-maquina', deps.requireAuth);

  router.get(
    '/api/maquinas',
    asyncRoute(async (req, res) => {
      const parsed = listFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const machines = await withTenant(db, req.auth!.companyId, (tx) =>
        loadMachines(tx, {
          q: f.q,
          obra: f.obra,
          categoria: f.categoria,
          estado: f.estado,
          mantenimiento: f.mantenimiento === undefined ? undefined : f.mantenimiento === 'true',
          monitoreo: f.monitoreo === undefined ? undefined : f.monitoreo === 'true',
          conChapa: f.conChapa === 'true',
          incluirNoMaquinas: f.incluirNoMaquinas === 'true',
          incluirBaja: f.incluirBaja === 'true',
          observadas: f.observadas === 'true',
        }),
      );
      res.json(machines);
    }),
  );

  router.get(
    '/api/maquinas/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const [machine] = id.success
        ? await withTenant(db, req.auth!.companyId, (tx) => loadMachines(tx, { ids: [id.data], incluirBaja: true, incluirNoMaquinas: true }, { withDetail: true }))
        : [];
      if (!machine) {
        res.status(404).json({ error: 'Máquina no encontrada.' });
        return;
      }
      res.json(machine);
    }),
  );

  router.post(
    '/api/maquinas',
    asyncRoute(async (req, res) => {
      const body = parseBody(machineSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const created = await withTenant(db, companyId, async (tx) => {
        if (await hasForeignRefs(tx, body)) return null;
        const id = await writeMachine(tx, companyId, null, body);
        await replaceChildren(tx, companyId, id, body);
        return (await loadMachines(tx, { ids: [id], incluirBaja: true, incluirNoMaquinas: true }, { withDetail: true }))[0];
      });
      if (!created) {
        res.status(422).json({ error: 'La obra o la categoría elegidas no existen.' });
        return;
      }
      res.status(201).json(created);
    }),
  );

  router.put(
    '/api/maquinas/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Máquina no encontrada.' });
        return;
      }
      const body = parseBody(machineSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const result = await withTenant(db, companyId, async (tx) => {
        const [exists] = await query(tx, sql`select id from machines where id = ${id.data}`);
        if (!exists) return null;
        if (await hasForeignRefs(tx, body)) return 'REFS' as const;
        await writeMachine(tx, companyId, id.data, body);
        await replaceChildren(tx, companyId, id.data, body);
        return (await loadMachines(tx, { ids: [id.data], incluirBaja: true, incluirNoMaquinas: true }, { withDetail: true }))[0];
      });
      if (!result) {
        res.status(404).json({ error: 'Máquina no encontrada.' });
        return;
      }
      if (result === 'REFS') {
        res.status(422).json({ error: 'La obra o la categoría elegidas no existen.' });
        return;
      }
      res.json(result);
    }),
  );

  router.get(
    '/api/maquinas/:id/lecturas',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Máquina no encontrada.' });
        return;
      }
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(
          tx,
          sql`select r.id, r.fecha::text as fecha, r.valor::float8 as valor, r.unidad, r.fuente, r.correccion, r.motivo, r.parte_id, r.observado
              from machine_readings r where r.machine_id = ${id.data}
              order by r.fecha desc, r.created_at desc limit 100`,
        ),
      );
      res.json(
        rows.map((r) => ({
          id: String(r.id),
          fecha: String(r.fecha),
          valor: Number(r.valor),
          unidad: r.unidad,
          fuente: r.fuente,
          correccion: Boolean(r.correccion),
          motivo: nullableString(r.motivo),
          parteId: nullableString(r.parte_id),
          observado: Boolean(r.observado),
        })),
      );
    }),
  );

  router.post(
    '/api/maquinas/:id/lecturas',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Máquina no encontrada.' });
        return;
      }
      const body = parseBody(readingSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const result = await withTenant(db, companyId, async (tx) => {
        const [machine] = await query<Row>(tx, sql`select id, meter_unit from machines where id = ${id.data}`);
        if (!machine) return { status: 404 as const };
        const out = await insertReading(tx, companyId, { id: id.data, meterUnit: machine.meter_unit as MeterUnit }, body, 'MANUAL', null);
        return out.errors.length > 0 ? { status: 422 as const, errors: out.errors } : { status: 201 as const, reading: out.reading };
      });
      if (result.status === 404) res.status(404).json({ error: 'Máquina no encontrada.' });
      else if (result.status === 422) res.status(422).json({ error: 'La lectura no es válida.', detalles: result.errors });
      else res.status(201).json(result.reading);
    }),
  );

  router.get(
    '/api/categorias-maquina',
    asyncRoute(async (req, res) => {
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(tx, sql`select id, nombre from machine_categories order by nombre`),
      );
      res.json(rows.map((r) => ({ id: String(r.id), nombre: String(r.nombre) })));
    }),
  );

  router.post(
    '/api/categorias-maquina',
    asyncRoute(async (req, res) => {
      const body = parseBody(categorySchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const [row] = await withTenant(db, companyId, (tx) =>
        query<Row>(
          tx,
          sql`insert into machine_categories (company_id, nombre) values (${companyId}, ${body.nombre})
              on conflict (company_id, nombre) do update set nombre = excluded.nombre returning id, nombre`,
        ),
      );
      res.status(201).json({ id: String(row.id), nombre: String(row.nombre) });
    }),
  );

  router.post(
    '/api/categorias-maquina/predeterminadas',
    asyncRoute(async (req, res) => {
      const companyId = req.auth!.companyId;
      await withTenant(db, companyId, async (tx) => {
        for (const nombre of DEFAULT_CATEGORIES) {
          await query(
            tx,
            sql`insert into machine_categories (company_id, nombre) values (${companyId}, ${nombre})
                on conflict (company_id, nombre) do nothing`,
          );
        }
      });
      res.json({ cargadas: DEFAULT_CATEGORIES.length });
    }),
  );

  return router;
}
