/**
 * @file server/routes/fuel.ts
 * @description Combustibles y lubricantes: productos, depósitos, vales (despacho, entrada, saldo
 * inicial y ajuste) e informes de saldos, consumo y terceros. Reemplaza la tabla ancha ACGAS2012
 * del Access. El saldo de cada depósito y producto sale de los movimientos. Un despacho que lo
 * dejaría en negativo NO se bloquea: se guarda y se devuelve una advertencia con el saldo resultante
 * (en el Access se despacha primero y la entrada se registra después).
 */

import { Router, type RequestHandler, type Response } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import {
  DEFAULT_FUEL_PRODUCTS,
  computeConsumption,
  movementDelta,
  tankCapacityWarning,
  validateFuelMovement,
  wouldGoNegative,
  type ConsumptionUnit,
  type FuelDepositDto,
  type FuelMovementDto,
  type FuelMovementResult,
  type FuelMovementType,
  type FuelProductDto,
} from '../../shared/fuel';
import { validateReading } from '../../shared/fleet';
import { asyncRoute, missingIds, nextDocumentNumber, parseBody, query, Rejected, sqlList, type Row } from './helpers';
import { insertReading, readingNeighbors } from './fleet';

const MOVEMENT_TYPES = ['DESPACHO', 'ENTRADA', 'SALDO_INICIAL', 'AJUSTE'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.');
const uuid = z.uuid();
const text = (max: number) => z.string().trim().max(max).nullable().optional();

const productSchema = z.object({
  codigo: z.string().trim().min(1).max(20),
  nombre: z.string().trim().min(1).max(80),
  unidad: z.enum(['L', 'KG', 'U']).default('L'),
  categoria: z.enum(['COMBUSTIBLE', 'LUBRICANTE', 'GRASA', 'OTRO']).default('OTRO'),
  activo: z.boolean().default(true),
});

const depositSchema = z.object({
  codigo: z.string().trim().min(1).max(20),
  nombre: z.string().trim().min(1).max(80),
  tipo: z.enum(['OBRA', 'CISTERNA', 'OTRO']).default('OBRA'),
  worksiteId: uuid.nullable().optional(),
  machineId: uuid.nullable().optional(),
  activo: z.boolean().default(true),
});

const movementSchema = z.object({
  tipo: z.enum(MOVEMENT_TYPES),
  fecha: isoDate,
  depositId: uuid,
  machineId: uuid.nullable().optional(),
  terceroChapa: text(20),
  proveidoA: text(80),
  descripcion: text(200),
  remision: text(40),
  supplierId: uuid.nullable().optional(),
  lectura: z.number().finite().nonnegative().nullable().optional(),
  motivo: text(200),
  lines: z.array(z.object({ productId: uuid, cantidad: z.number().finite() })),
});
const batchSchema = z.object({ movimientos: z.array(movementSchema).min(1).max(200) });
const annulSchema = z.object({ motivo: z.string().trim().min(3, 'Indicá el motivo de la anulación.').max(200) });
const readingFixSchema = z.object({ valor: z.number().finite().nonnegative(), correccion: z.boolean().default(false), motivo: text(200) });

const movementFiltersSchema = z.object({
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  deposito: uuid.optional(),
  maquina: uuid.optional(),
  chapa: z.string().max(20).optional(),
  producto: uuid.optional(),
  tipo: z.enum(MOVEMENT_TYPES).optional(),
  q: z.string().max(80).optional(),
  incluirAnulados: z.enum(['true', 'false']).optional(),
});
const periodSchema = z.object({ desde: isoDate.optional(), hasta: isoDate.optional(), deposito: uuid.optional(), producto: uuid.optional(), maquina: uuid.optional() });

type MovementBody = z.infer<typeof movementSchema>;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Corre un bloque en transacción y traduce `Rejected` en la respuesta HTTP. */
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

/* ─── Carga de datos ───────────────────────────────────────────────────── */

const toProduct = (r: Row): FuelProductDto => ({
  id: String(r.id),
  codigo: String(r.codigo),
  nombre: String(r.nombre),
  unidad: r.unidad as FuelProductDto['unidad'],
  categoria: r.categoria as FuelProductDto['categoria'],
  activo: Boolean(r.activo),
});

async function loadDeposits(tx: Db, ids?: string[]): Promise<FuelDepositDto[]> {
  const where = ids ? sql`where d.id in ${sqlList(ids)}` : sql``;
  const rows = await query<Row>(
    tx,
    sql`select d.id, d.codigo, d.nombre, d.tipo, d.activo, w.id as wid, w.nombre as wnom, m.id as mid, m.codigo as mcod, m.descripcion as mdes
        from fuel_deposits d left join worksites w on w.id = d.worksite_id left join machines m on m.id = d.machine_id
        ${where} order by d.codigo`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    tipo: r.tipo as FuelDepositDto['tipo'],
    worksite: str(r.wid) ? { id: String(r.wid), nombre: String(r.wnom) } : null,
    machine: str(r.mid) ? { id: String(r.mid), codigo: String(r.mcod), descripcion: String(r.mdes) } : null,
    activo: Boolean(r.activo),
  }));
}

interface MovementFilters {
  ids?: string[];
  desde?: string;
  hasta?: string;
  deposito?: string;
  maquina?: string;
  chapa?: string;
  producto?: string;
  tipo?: FuelMovementType;
  q?: string;
  incluirAnulados?: boolean;
}

async function loadMovements(tx: Db, f: MovementFilters, limit = 1000): Promise<FuelMovementDto[]> {
  const conditions: SQL[] = [];
  if (f.ids) conditions.push(sql`m.id in ${sqlList(f.ids)}`);
  if (!f.incluirAnulados) conditions.push(sql`m.anulado = false`);
  if (f.desde) conditions.push(sql`m.fecha >= ${f.desde}::date`);
  if (f.hasta) conditions.push(sql`m.fecha <= ${f.hasta}::date`);
  if (f.deposito) conditions.push(sql`m.deposit_id = ${f.deposito}::uuid`);
  if (f.maquina) conditions.push(sql`m.machine_id = ${f.maquina}::uuid`);
  if (f.chapa) conditions.push(sql`m.tercero_chapa ilike ${`%${f.chapa}%`}`);
  if (f.tipo) conditions.push(sql`m.tipo = ${f.tipo}`);
  if (f.producto) conditions.push(sql`exists (select 1 from fuel_movement_lines lp where lp.movement_id = m.id and lp.product_id = ${f.producto}::uuid)`);
  if (f.q) {
    const like = `%${f.q}%`;
    conditions.push(sql`(m.numero::text ilike ${like} or m.remision ilike ${like} or m.descripcion ilike ${like} or m.proveido_a ilike ${like})`);
  }
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const rows = await query<Row>(
    tx,
    sql`select m.id, m.numero, m.fecha::text as fecha, m.tipo, m.tercero_chapa, m.proveido_a, m.descripcion, m.remision,
               m.lectura::float8 as lectura, m.lectura_unidad, m.lectura_observada, m.lectura_motivo, m.motivo, m.anulado, m.anulado_motivo,
               d.id as did, d.codigo as dcod, d.nombre as dnom,
               mc.id as mid, mc.codigo as mcod, mc.descripcion as mdes, mc.meter_unit as munit,
               s.id as sid, s.nombre as snom
        from fuel_movements m
        join fuel_deposits d on d.id = m.deposit_id
        left join machines mc on mc.id = m.machine_id
        left join suppliers s on s.id = m.supplier_id
        ${where}
        order by m.fecha desc, m.numero desc
        limit ${limit}`,
  );
  if (rows.length === 0) return [];
  const lineRows = await query<Row>(
    tx,
    sql`select l.movement_id, l.product_id, l.cantidad::float8 as cantidad, p.codigo, p.nombre, p.unidad, p.categoria
        from fuel_movement_lines l join fuel_products p on p.id = l.product_id
        where l.movement_id in ${sqlList(rows.map((r) => String(r.id)))}
        order by p.codigo`,
  );
  return rows.map((r) => {
    const id = String(r.id);
    return {
      id,
      numero: Number(r.numero),
      fecha: String(r.fecha),
      tipo: r.tipo as FuelMovementType,
      deposit: { id: String(r.did), codigo: String(r.dcod), nombre: String(r.dnom) },
      machine: str(r.mid) ? { id: String(r.mid), codigo: String(r.mcod), descripcion: String(r.mdes), meterUnit: r.munit as ConsumptionUnit } : null,
      terceroChapa: str(r.tercero_chapa),
      proveidoA: str(r.proveido_a),
      descripcion: str(r.descripcion),
      remision: str(r.remision),
      supplier: str(r.sid) ? { id: String(r.sid), nombre: String(r.snom) } : null,
      lectura: r.lectura === null || r.lectura === undefined ? null : Number(r.lectura),
      lecturaUnidad: (str(r.lectura_unidad) as ConsumptionUnit | null) ?? null,
      lecturaObservada: Boolean(r.lectura_observada),
      lecturaMotivo: str(r.lectura_motivo),
      motivo: str(r.motivo),
      anulado: Boolean(r.anulado),
      anuladoMotivo: str(r.anulado_motivo),
      lines: lineRows
        .filter((l) => String(l.movement_id) === id)
        .map((l) => ({
          productId: String(l.product_id),
          producto: { codigo: String(l.codigo), nombre: String(l.nombre), unidad: l.unidad as FuelProductDto['unidad'], categoria: l.categoria as FuelProductDto['categoria'] },
          cantidad: Number(l.cantidad),
        })),
    };
  });
}

/** Saldo actual de un depósito por producto, sin contar movimientos anulados. */
async function depositBalances(tx: Db, depositId: string, productIds?: string[]): Promise<Map<string, number>> {
  const filter = productIds && productIds.length > 0 ? sql`and l.product_id in ${sqlList(productIds)}` : sql``;
  const rows = await query<Row>(
    tx,
    sql`select l.product_id, coalesce(sum(case when m.tipo = 'DESPACHO' then -l.cantidad else l.cantidad end), 0)::float8 as saldo
        from fuel_movement_lines l join fuel_movements m on m.id = l.movement_id
        where m.deposit_id = ${depositId} and m.anulado = false ${filter}
        group by l.product_id`,
  );
  return new Map(rows.map((r) => [String(r.product_id), Number(r.saldo)]));
}

/* ─── Alta de un vale ──────────────────────────────────────────────────── */

async function createMovement(tx: Db, companyId: string, body: MovementBody): Promise<{ id: string; advertencias: string[] }> {
  const hoy = today();
  const errors = validateFuelMovement(
    { tipo: body.tipo, fecha: body.fecha, depositId: body.depositId, machineId: body.machineId, terceroChapa: body.terceroChapa, motivo: body.motivo, lines: body.lines },
    hoy,
  );
  if (errors.length > 0) throw new Rejected(errors);

  const missing = [
    ...(await missingIds(tx, 'fuel_deposits', [body.depositId])),
    ...(await missingIds(tx, 'machines', [body.machineId])),
    ...(await missingIds(tx, 'suppliers', [body.supplierId])),
    ...(await missingIds(tx, 'fuel_products', body.lines.map((l) => l.productId))),
  ];
  if (missing.length > 0) throw new Rejected(['El depósito, la máquina, el proveedor o un producto elegidos no existen.']);

  // Se bloquea la fila del depósito mientras dura la transacción: dos vales simultáneos no leen el mismo saldo,
  // así la advertencia de saldo negativo es exacta.
  const [deposit] = await query<Row>(tx, sql`select id, nombre, activo from fuel_deposits where id = ${body.depositId} for update`);
  if (!Boolean(deposit.activo)) throw new Rejected(['El depósito está inactivo.']);

  const products = await query<Row>(tx, sql`select id, codigo, nombre, categoria from fuel_products where id in ${sqlList(body.lines.map((l) => l.productId))}`);
  const byProduct = new Map(products.map((p) => [String(p.id), p]));

  const advertencias: string[] = [];
  const changes = body.lines.map((l) => ({ productId: l.productId, delta: movementDelta(body.tipo, l.cantidad) }));
  if (changes.some((c) => c.delta < 0)) {
    const balances = await depositBalances(tx, body.depositId, changes.map((c) => c.productId));
    const short = wouldGoNegative(balances, changes.filter((c) => c.delta < 0));
    for (const s of short) {
      const name = String(byProduct.get(s.productId)?.nombre ?? 'el producto');
      advertencias.push(
        `Saldo negativo de ${name} en ${String(deposit.nombre)}: quedó en ${s.saldo} (había ${s.disponible}). Registrá la entrada que falta o hacé un ajuste con motivo.`,
      );
    }
  }

  // Lectura: se valida contra las lecturas vecinas. Si baja, el despacho se guarda igual y queda observada.
  let lecturaObservada = false;
  let lecturaMotivo: string | null = null;
  let lecturaUnidad: ConsumptionUnit | null = null;
  let validReading = false;
  let machineMeter: ConsumptionUnit | null = null;
  if (body.tipo === 'DESPACHO' && body.machineId) {
    const [machine] = await query<Row>(tx, sql`select meter_unit from machines where id = ${body.machineId}`);
    machineMeter = machine.meter_unit as ConsumptionUnit;
    if (body.lectura !== null && body.lectura !== undefined) {
      lecturaUnidad = machineMeter;
      const { previous, next } = await readingNeighbors(tx, body.machineId, body.fecha);
      const readingErrors = validateReading({ previous, next, fecha: body.fecha, valor: body.lectura });
      if (readingErrors.length > 0) {
        lecturaObservada = true;
        lecturaMotivo = readingErrors.join(' ');
        advertencias.push(`Lectura observada: ${lecturaMotivo} El despacho se guardó; corregí la lectura para que cuente en el consumo.`);
      } else {
        validReading = true;
      }
    }
    const fuelLiters = body.lines.filter((l) => String(byProduct.get(l.productId)?.categoria) === 'COMBUSTIBLE').reduce((a, l) => a + l.cantidad, 0);
    if (fuelLiters > 0) {
      const [capacity] = await query<Row>(
        tx,
        sql`select max(capacidad_litros)::float8 as capacidad from machine_fluids where machine_id = ${body.machineId} and punto ilike '%combustible%'`,
      );
      const warning = tankCapacityWarning(fuelLiters, capacity?.capacidad === null || capacity?.capacidad === undefined ? null : Number(capacity.capacidad));
      if (warning) advertencias.push(warning);
    }
  }
  if (body.tipo === 'DESPACHO' && !body.machineId && !(body.terceroChapa ?? '').trim()) {
    advertencias.push('El despacho no tiene máquina ni chapa de destino.');
  }

  const numero = await nextDocumentNumber(tx, companyId, 'VALE');
  const [row] = await query<{ id: string }>(
    tx,
    sql`insert into fuel_movements (company_id, numero, fecha, tipo, deposit_id, machine_id, tercero_chapa, proveido_a, descripcion,
          remision, supplier_id, lectura, lectura_unidad, lectura_observada, lectura_motivo, motivo)
        values (${companyId}, ${numero}, ${body.fecha}::date, ${body.tipo}, ${body.depositId}, ${body.machineId ?? null},
          ${(body.terceroChapa ?? '').trim() || null}, ${body.proveidoA ?? null}, ${body.descripcion ?? null}, ${body.remision ?? null},
          ${body.supplierId ?? null}, ${body.lectura ?? null}, ${lecturaUnidad}, ${lecturaObservada}, ${lecturaMotivo}, ${body.motivo ?? null})
        returning id`,
  );
  const id = String(row.id);
  for (const line of body.lines) {
    await query(tx, sql`insert into fuel_movement_lines (company_id, movement_id, product_id, cantidad) values (${companyId}, ${id}, ${line.productId}, ${line.cantidad})`);
  }
  if (validReading && body.machineId && machineMeter && body.lectura !== null && body.lectura !== undefined) {
    const out = await insertReading(tx, companyId, { id: body.machineId, meterUnit: machineMeter }, { fecha: body.fecha, valor: body.lectura }, 'COMBUSTIBLE', null, id);
    if (out.errors.length > 0) {
      await query(tx, sql`update fuel_movements set lectura_observada = true, lectura_motivo = ${out.errors.join(' ')} where id = ${id}`);
      advertencias.push(`Lectura observada: ${out.errors.join(' ')}`);
    }
  }
  return { id, advertencias };
}

/* ─── Rutas ────────────────────────────────────────────────────────────── */

export function fuelRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  router.use('/api/combustible', deps.requireAuth);
  router.use('/api/informes', deps.requireAuth);

  /* Productos */
  router.get(
    '/api/combustible/productos',
    asyncRoute(async (req, res) => {
      const rows = await withTenant(db, req.auth!.companyId, (tx) => query<Row>(tx, sql`select id, codigo, nombre, unidad, categoria, activo from fuel_products order by categoria, codigo`));
      res.json(rows.map(toProduct));
    }),
  );

  router.post(
    '/api/combustible/productos',
    asyncRoute(async (req, res) => {
      const body = parseBody(productSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        const [dup] = await query(tx, sql`select id from fuel_products where codigo = ${body.codigo}`);
        if (dup) throw new Rejected(['Ya existe un producto con ese código.'], 409);
        const [row] = await query<Row>(
          tx,
          sql`insert into fuel_products (company_id, codigo, nombre, unidad, categoria, activo) values (${companyId}, ${body.codigo}, ${body.nombre}, ${body.unidad}, ${body.categoria}, ${body.activo})
              returning id, codigo, nombre, unidad, categoria, activo`,
        );
        return toProduct(row);
      }, 201);
    }),
  );

  router.put(
    '/api/combustible/productos/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Producto no encontrado.' });
        return;
      }
      const body = parseBody(productSchema, req, res);
      if (!body) return;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [dup] = await query(tx, sql`select id from fuel_products where codigo = ${body.codigo} and id <> ${id.data}`);
        if (dup) throw new Rejected(['Ya existe un producto con ese código.'], 409);
        const [row] = await query<Row>(
          tx,
          sql`update fuel_products set codigo = ${body.codigo}, nombre = ${body.nombre}, unidad = ${body.unidad}, categoria = ${body.categoria}, activo = ${body.activo}
              where id = ${id.data} returning id, codigo, nombre, unidad, categoria, activo`,
        );
        if (!row) throw new Rejected(['Producto no encontrado.'], 404);
        return toProduct(row);
      });
    }),
  );

  router.post(
    '/api/combustible/productos/predeterminados',
    asyncRoute(async (req, res) => {
      const companyId = req.auth!.companyId;
      await withTenant(db, companyId, async (tx) => {
        for (const p of DEFAULT_FUEL_PRODUCTS) {
          await query(
            tx,
            sql`insert into fuel_products (company_id, codigo, nombre, unidad, categoria) values (${companyId}, ${p.codigo}, ${p.nombre}, ${p.unidad}, ${p.categoria})
                on conflict (company_id, codigo) do nothing`,
          );
        }
      });
      res.json({ cargados: DEFAULT_FUEL_PRODUCTS.length });
    }),
  );

  /* Depósitos */
  router.get(
    '/api/combustible/depositos',
    asyncRoute(async (req, res) => {
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadDeposits(tx)));
    }),
  );

  const writeDeposit = async (tx: Db, companyId: string, body: z.infer<typeof depositSchema>, id: string | null) => {
    const missing = [...(await missingIds(tx, 'worksites', [body.worksiteId])), ...(await missingIds(tx, 'machines', [body.machineId]))];
    if (missing.length > 0) throw new Rejected(['La obra o la máquina elegidas no existen.']);
    const [dup] = await query(tx, id ? sql`select id from fuel_deposits where codigo = ${body.codigo} and id <> ${id}` : sql`select id from fuel_deposits where codigo = ${body.codigo}`);
    if (dup) throw new Rejected(['Ya existe un depósito con ese código.'], 409);
    if (id === null) {
      const [row] = await query<{ id: string }>(
        tx,
        sql`insert into fuel_deposits (company_id, codigo, nombre, tipo, worksite_id, machine_id, activo)
            values (${companyId}, ${body.codigo}, ${body.nombre}, ${body.tipo}, ${body.worksiteId ?? null}, ${body.machineId ?? null}, ${body.activo}) returning id`,
      );
      return String(row.id);
    }
    const updated = await query(
      tx,
      sql`update fuel_deposits set codigo = ${body.codigo}, nombre = ${body.nombre}, tipo = ${body.tipo}, worksite_id = ${body.worksiteId ?? null},
            machine_id = ${body.machineId ?? null}, activo = ${body.activo} where id = ${id} returning id`,
    );
    if (updated.length === 0) throw new Rejected(['Depósito no encontrado.'], 404);
    return id;
  };

  router.post(
    '/api/combustible/depositos',
    asyncRoute(async (req, res) => {
      const body = parseBody(depositSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => (await loadDeposits(tx, [await writeDeposit(tx, companyId, body, null)]))[0], 201);
    }),
  );

  router.put(
    '/api/combustible/depositos/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Depósito no encontrado.' });
        return;
      }
      const body = parseBody(depositSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => (await loadDeposits(tx, [await writeDeposit(tx, companyId, body, id.data)]))[0]);
    }),
  );

  /* Vales */
  router.get(
    '/api/combustible/movimientos',
    asyncRoute(async (req, res) => {
      const parsed = movementFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadMovements(tx, { ...f, incluirAnulados: f.incluirAnulados === 'true' })));
    }),
  );

  router.get(
    '/api/combustible/movimientos/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const [movement] = id.success ? await withTenant(db, req.auth!.companyId, (tx) => loadMovements(tx, { ids: [id.data], incluirAnulados: true })) : [];
      if (!movement) {
        res.status(404).json({ error: 'Vale no encontrado.' });
        return;
      }
      res.json(movement);
    }),
  );

  router.post(
    '/api/combustible/movimientos',
    asyncRoute(async (req, res) => {
      const body = parseBody(movementSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx): Promise<FuelMovementResult> => {
        const { id, advertencias } = await createMovement(tx, companyId, body);
        const [movement] = await loadMovements(tx, { ids: [id], incluirAnulados: true });
        return { ...movement, advertencias };
      }, 201);
    }),
  );

  router.post(
    '/api/combustible/movimientos/lote',
    asyncRoute(async (req, res) => {
      const body = parseBody(batchSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx): Promise<FuelMovementResult[]> => {
        const ids: { id: string; advertencias: string[] }[] = [];
        const rejected: string[] = [];
        for (const [i, movement] of body.movimientos.entries()) {
          try {
            ids.push(await createMovement(tx, companyId, movement));
          } catch (err) {
            if (err instanceof Rejected) rejected.push(...err.errors.map((e) => `Fila ${i + 1}: ${e}`));
            else throw err;
          }
        }
        // Un vale inválido deshace todo el lote: nada queda a medias.
        if (rejected.length > 0) throw new Rejected(rejected);
        const loaded = await loadMovements(tx, { ids: ids.map((x) => x.id), incluirAnulados: true });
        return ids.map(({ id, advertencias }) => ({ ...(loaded.find((m) => m.id === id) as FuelMovementDto), advertencias }));
      }, 201);
    }),
  );

  router.post(
    '/api/combustible/movimientos/:id/anular',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Vale no encontrado.' });
        return;
      }
      const body = parseBody(annulSchema, req, res);
      if (!body) return;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [movement] = await loadMovements(tx, { ids: [id.data], incluirAnulados: true });
        if (!movement) throw new Rejected(['Vale no encontrado.'], 404);
        if (movement.anulado) throw new Rejected(['El vale ya está anulado.'], 409);
        await query(tx, sql`select id from fuel_deposits where id = ${movement.deposit.id} for update`);
        // Anular una entrada, un saldo inicial o un ajuste positivo resta saldo: se permite y se advierte si queda en negativo.
        const advertencias: string[] = [];
        const removal = movement.lines.map((l) => ({ productId: l.productId, delta: -movementDelta(movement.tipo, l.cantidad) })).filter((c) => c.delta < 0);
        if (removal.length > 0) {
          const balances = await depositBalances(tx, movement.deposit.id, removal.map((c) => c.productId));
          for (const short of wouldGoNegative(balances, removal)) {
            const name = movement.lines.find((l) => l.productId === short.productId)?.producto.nombre ?? 'el producto';
            advertencias.push(`Saldo negativo de ${name} en ${movement.deposit.nombre}: quedó en ${short.saldo} al anular este vale.`);
          }
        }
        await query(tx, sql`update fuel_movements set anulado = true, anulado_motivo = ${body.motivo} where id = ${id.data}`);
        // La lectura de un despacho anulado no debe contar para consumos ni avisos.
        await query(tx, sql`delete from machine_readings where fuel_movement_id = ${id.data}`);
        const annulled = (await loadMovements(tx, { ids: [id.data], incluirAnulados: true }))[0];
        return { ...annulled, advertencias } satisfies FuelMovementResult;
      });
    }),
  );

  router.post(
    '/api/combustible/movimientos/:id/lectura',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Vale no encontrado.' });
        return;
      }
      const body = parseBody(readingFixSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        const [movement] = await loadMovements(tx, { ids: [id.data] });
        if (!movement) throw new Rejected(['Vale no encontrado.'], 404);
        if (movement.tipo !== 'DESPACHO' || !movement.machine) throw new Rejected(['Solo un despacho a una máquina tiene lectura.'], 409);
        const out = await insertReading(tx, companyId, { id: movement.machine.id, meterUnit: movement.machine.meterUnit }, { fecha: movement.fecha, valor: body.valor, correccion: body.correccion, motivo: body.motivo }, 'COMBUSTIBLE', null, id.data);
        if (out.errors.length > 0) throw new Rejected(out.errors);
        await query(tx, sql`delete from machine_readings where fuel_movement_id = ${id.data} and id <> ${out.reading!.id}`);
        await query(
          tx,
          sql`update fuel_movements set lectura = ${body.valor}, lectura_unidad = ${movement.machine.meterUnit}, lectura_observada = false, lectura_motivo = null where id = ${id.data}`,
        );
        return (await loadMovements(tx, { ids: [id.data] }))[0];
      });
    }),
  );

  /* Informes */
  router.get(
    '/api/informes/combustible-saldos',
    asyncRoute(async (req, res) => {
      const parsed = periodSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const hasta = f.hasta ?? today();
      const desde = f.desde ?? `${hasta.slice(0, 4)}-01-01`;
      const conditions: SQL[] = [sql`m.anulado = false`, sql`m.fecha <= ${hasta}::date`];
      if (f.deposito) conditions.push(sql`m.deposit_id = ${f.deposito}::uuid`);
      if (f.producto) conditions.push(sql`l.product_id = ${f.producto}::uuid`);
      const delta = sql`case when m.tipo = 'DESPACHO' then -l.cantidad else l.cantidad end`;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const rows = await query<Row>(
          tx,
          sql`select d.id as did, d.codigo as dcod, d.nombre as dnom, p.id as pid, p.codigo as pcod, p.nombre as pnom, p.unidad,
                     coalesce(sum(case when m.fecha < ${desde}::date then ${delta} else 0 end), 0)::float8 as inicial,
                     coalesce(sum(case when m.fecha >= ${desde}::date and m.tipo in ('ENTRADA', 'SALDO_INICIAL') then l.cantidad else 0 end), 0)::float8 as entradas,
                     coalesce(sum(case when m.fecha >= ${desde}::date and m.tipo = 'DESPACHO' then l.cantidad else 0 end), 0)::float8 as salidas,
                     coalesce(sum(case when m.fecha >= ${desde}::date and m.tipo = 'AJUSTE' then l.cantidad else 0 end), 0)::float8 as ajustes,
                     coalesce(sum(${delta}), 0)::float8 as final
              from fuel_movement_lines l
              join fuel_movements m on m.id = l.movement_id
              join fuel_deposits d on d.id = m.deposit_id
              join fuel_products p on p.id = l.product_id
              where ${sql.join(conditions, sql` and `)}
              group by d.id, d.codigo, d.nombre, p.id, p.codigo, p.nombre, p.unidad
              order by d.codigo, p.codigo`,
        );
        return {
          desde,
          hasta,
          filas: rows.map((r) => ({
            deposito: { id: String(r.did), codigo: String(r.dcod), nombre: String(r.dnom) },
            producto: { id: String(r.pid), codigo: String(r.pcod), nombre: String(r.pnom), unidad: String(r.unidad) },
            saldoInicial: Math.round(Number(r.inicial) * 1000) / 1000,
            entradas: Math.round(Number(r.entradas) * 1000) / 1000,
            salidas: Math.round(Number(r.salidas) * 1000) / 1000,
            ajustes: Math.round(Number(r.ajustes) * 1000) / 1000,
            saldoFinal: Math.round(Number(r.final) * 1000) / 1000,
            negativo: Number(r.final) < 0,
          })),
        };
      });
    }),
  );

  router.get(
    '/api/informes/combustible-consumo',
    asyncRoute(async (req, res) => {
      const parsed = periodSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const hasta = f.hasta ?? today();
      const desde = f.desde ?? `${hasta.slice(0, 4)}-01-01`;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        // Toda la serie hasta el fin del período: la carga anterior al período sirve de punto de partida.
        const movements = await loadMovements(tx, { hasta, deposito: f.deposito, maquina: f.maquina, tipo: 'DESPACHO' }, 20000);
        const byMachine = new Map<string, FuelMovementDto[]>();
        for (const m of movements) {
          if (!m.machine) continue;
          byMachine.set(m.machine.id, [...(byMachine.get(m.machine.id) ?? []), m]);
        }
        const fuelOnly = (m: FuelMovementDto) =>
          m.lines.filter((l) => l.producto.categoria === 'COMBUSTIBLE' && l.producto.unidad === 'L').reduce((a, l) => a + l.cantidad, 0);
        const out = [];
        for (const list of byMachine.values()) {
          const machine = list[0].machine!;
          const chronological = [...list].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero - b.numero);
          // Un vale sin combustible (solo aceite) no es una recarga: no entra a la serie.
          const fills = chronological
            .filter((m) => fuelOnly(m) > 0)
            .map((m) => ({ id: m.id, fecha: m.fecha, litros: fuelOnly(m), lectura: m.lectura, observada: m.lecturaObservada }));
          const full = computeConsumption(fills, machine.meterUnit);
          const inPeriod = full.detalle.filter((d) => d.fecha >= desde && d.litros > 0);
          if (inPeriod.length === 0) continue;
          const segments = inPeriod.filter((d) => d.consumo !== null);
          const litrosTramos = segments.reduce((a, d) => a + (d.litrosTramo ?? 0), 0);
          const recorrido = segments.reduce((a, d) => a + (d.recorrido ?? 0), 0);
          const factor = machine.meterUnit === 'HS' ? 1 : 100;
          out.push({
            maquina: machine,
            unidad: machine.meterUnit === 'HS' ? 'L/H' : 'L/100KM',
            cargas: inPeriod.length,
            litros: Math.round(inPeriod.reduce((a, d) => a + d.litros, 0) * 100) / 100,
            sinLectura: inPeriod.filter((d) => d.motivo === 'SIN_LECTURA').length,
            observadas: inPeriod.filter((d) => d.motivo === 'LECTURA_OBSERVADA').length,
            atipicas: inPeriod.filter((d) => d.atipica).length,
            recorrido: Math.round(recorrido * 100) / 100,
            consumo: recorrido > 0 ? Math.round(((litrosTramos * factor) / recorrido) * 100) / 100 : null,
            detalle: inPeriod,
          });
        }
        out.sort((a, b) => a.maquina.codigo.localeCompare(b.maquina.codigo));
        return { desde, hasta, maquinas: out };
      });
    }),
  );

  router.get(
    '/api/informes/combustible-terceros',
    asyncRoute(async (req, res) => {
      const parsed = periodSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const hasta = f.hasta ?? today();
      const desde = f.desde ?? `${hasta.slice(0, 4)}-01-01`;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const movements = (await loadMovements(tx, { desde, hasta, deposito: f.deposito, tipo: 'DESPACHO' }, 20000)).filter((m) => m.terceroChapa);
        const groups = new Map<string, { chapa: string; cargas: number; litros: number; despachos: FuelMovementDto[] }>();
        for (const m of movements) {
          const key = (m.terceroChapa as string).toUpperCase();
          const g = groups.get(key) ?? { chapa: key, cargas: 0, litros: 0, despachos: [] };
          g.cargas++;
          g.litros = Math.round((g.litros + m.lines.filter((l) => l.producto.unidad === 'L').reduce((a, l) => a + l.cantidad, 0)) * 100) / 100;
          g.despachos.push(m);
          groups.set(key, g);
        }
        return { desde, hasta, terceros: [...groups.values()].sort((a, b) => b.litros - a.litros) };
      });
    }),
  );

  router.get(
    '/api/informes/combustible-depositos',
    asyncRoute(async (req, res) => {
      const parsed = periodSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const hasta = f.hasta ?? today();
      const desde = f.desde ?? `${hasta.slice(0, 4)}-01-01`;
      const conditions: SQL[] = [sql`m.anulado = false`, sql`m.tipo = 'DESPACHO'`, sql`m.fecha >= ${desde}::date`, sql`m.fecha <= ${hasta}::date`];
      if (f.deposito) conditions.push(sql`m.deposit_id = ${f.deposito}::uuid`);
      if (f.producto) conditions.push(sql`l.product_id = ${f.producto}::uuid`);
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const rows = await query<Row>(
          tx,
          sql`select d.codigo as dcod, d.nombre as dnom, to_char(m.fecha, 'YYYY-MM') as mes, p.codigo as pcod, p.nombre as pnom, p.unidad,
                     sum(l.cantidad)::float8 as cantidad, count(distinct m.id)::int as vales
              from fuel_movement_lines l
              join fuel_movements m on m.id = l.movement_id
              join fuel_deposits d on d.id = m.deposit_id
              join fuel_products p on p.id = l.product_id
              where ${sql.join(conditions, sql` and `)}
              group by d.codigo, d.nombre, to_char(m.fecha, 'YYYY-MM'), p.codigo, p.nombre, p.unidad
              order by mes desc, d.codigo, p.codigo`,
        );
        return {
          desde,
          hasta,
          filas: rows.map((r) => ({
            deposito: { codigo: String(r.dcod), nombre: String(r.dnom) },
            mes: String(r.mes),
            producto: { codigo: String(r.pcod), nombre: String(r.pnom), unidad: String(r.unidad) },
            cantidad: Math.round(Number(r.cantidad) * 1000) / 1000,
            vales: Number(r.vales),
          })),
        };
      });
    }),
  );

  return router;
}

