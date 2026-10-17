/**
 * @file server/routes/stock.ts
 * @description Stock de repuestos del taller: artículos, vales (entrada, salida, saldo inicial y ajuste)
 * e informes de existencias, kardex y consumo. Reemplaza STOCK TALLER CREAR ITEM y STOCK TALLER ENTRADA
 * Y SALIDA del Access. El saldo y el valor de cada artículo salen de los vales vigentes. Una salida que
 * dejaría el saldo en negativo se rechaza. Las entradas de una recepción de pedido se crean desde
 * routes/orders.ts con `createStockMovement`.
 */

import { Router, type RequestHandler, type Response } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import {
  ARTICLE_RUBROS,
  ARTICLE_UNITS,
  STOCK_TYPES,
  applyMovement,
  kardex,
  matchArticle,
  movementDelta,
  normalizeArticleCode,
  validateStockMovement,
  wouldGoNegative,
  type ArticleBatchResult,
  type ArticleDto,
  type ArticleEquivalent,
  type ArticleMatchDto,
  type ArticleRubro,
  type ArticleUnit,
  type ConsumptionRow,
  type KardexReport,
  type StockExistencesReport,
  type StockMovementDto,
  type StockMovementResult,
  type StockMovementType,
  type StockPosition,
} from '../../shared/stock';
import { asyncRoute, missingIds, nextDocumentNumber, parseBody, query, Rejected, sqlList, type Row } from './helpers';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.');
const uuid = z.uuid();
const text = (max: number) => z.string().trim().max(max).nullable().optional();

const equivalentSchema = z.object({
  marca: z.string().trim().min(1, 'Cada equivalencia necesita una marca.').max(30),
  codigo: z.string().trim().min(1, 'Cada equivalencia necesita un código.').max(40),
});

const articleFields = {
  codigo: z.string().trim().min(1, 'El código es obligatorio.').max(40),
  descripcion: z.string().trim().min(1, 'La descripción es obligatoria.').max(200),
  rubro: z.enum(ARTICLE_RUBROS).default('REPUESTOS'),
  unidad: z.enum(ARTICLE_UNITS).default('U'),
  stockMinimo: z.number().finite().nonnegative().default(0),
  ubicacion: text(40),
  equivalencias: z.array(equivalentSchema).max(20).default([]),
  aplicacion: text(500),
  activo: z.boolean().default(true),
};
const articleSchema = z.object(articleFields);

// En la planilla solo se pisan los campos que vienen: un artículo existente conserva lo que la planilla no trae.
const batchArticleSchema = z.object({
  codigo: articleFields.codigo,
  descripcion: articleFields.descripcion,
  rubro: z.enum(ARTICLE_RUBROS).optional(),
  unidad: z.enum(ARTICLE_UNITS).optional(),
  stockMinimo: z.number().finite().nonnegative().optional(),
  ubicacion: text(40),
  equivalencias: z.array(equivalentSchema).max(20).optional(),
  aplicacion: text(500),
  activo: z.boolean().optional(),
  saldoInicial: z.object({ cantidad: z.number().finite().positive(), costoUnitario: z.number().finite().positive() }).nullable().optional(),
});
const articleBatchSchema = z.object({
  fecha: isoDate.optional(),
  articulos: z.array(batchArticleSchema).min(1).max(1000),
});

const lineSchema = z.object({
  articleId: uuid,
  cantidad: z.number().finite(),
  costoUnitario: z.number().finite().nullable().optional(),
});
const movementSchema = z.object({
  tipo: z.enum(STOCK_TYPES),
  fecha: isoDate,
  machineId: uuid.nullable().optional(),
  worksiteId: uuid.nullable().optional(),
  serviceOrderId: uuid.nullable().optional(),
  supplierId: uuid.nullable().optional(),
  remision: text(40),
  motivo: text(200),
  observaciones: text(500),
  lines: z.array(lineSchema),
});
const annulSchema = z.object({ motivo: z.string().trim().min(3, 'Indicá el motivo de la anulación.').max(200) });
const matchSchema = z.object({ codigos: z.array(z.string().max(80)).max(500) });

const articleFiltersSchema = z.object({
  q: z.string().max(80).optional(),
  rubro: z.enum(ARTICLE_RUBROS).optional(),
  bajoMinimo: z.enum(['true', 'false']).optional(),
  conSaldo: z.enum(['true', 'false']).optional(),
  activo: z.enum(['true', 'false']).optional(),
});
const movementFiltersSchema = z.object({
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  tipo: z.enum(STOCK_TYPES).optional(),
  articulo: uuid.optional(),
  maquina: uuid.optional(),
  obra: uuid.optional(),
  q: z.string().max(80).optional(),
  incluirAnulados: z.enum(['true', 'false']).optional(),
});
const kardexSchema = z.object({ articulo: uuid, desde: isoDate.optional(), hasta: isoDate.optional() });
const consumptionSchema = z.object({
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  maquina: uuid.optional(),
  obra: uuid.optional(),
  articulo: uuid.optional(),
  rubro: z.enum(ARTICLE_RUBROS).optional(),
});

export type StockMovementInput = z.infer<typeof movementSchema> & { receptionId?: string | null };

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const round4 = (v: number) => Math.round(v * 10000) / 10000;
const round2 = (v: number) => Math.round(v * 100) / 100;

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

interface ArticleFilters {
  ids?: string[];
  q?: string;
  rubro?: ArticleRubro;
  bajoMinimo?: boolean;
  conSaldo?: boolean;
  activo?: boolean;
}

export async function loadArticles(tx: Db, f: ArticleFilters, limit = 3000): Promise<ArticleDto[]> {
  const conditions: SQL[] = [];
  if (f.ids) conditions.push(sql`a.id in ${sqlList(f.ids)}`);
  if (f.rubro) conditions.push(sql`a.rubro = ${f.rubro}`);
  if (f.activo !== undefined) conditions.push(sql`a.activo = ${f.activo}`);
  if (f.bajoMinimo) conditions.push(sql`a.stock_minimo > 0 and coalesce(p.saldo, 0) <= a.stock_minimo`);
  if (f.conSaldo) conditions.push(sql`coalesce(p.saldo, 0) > 0`);
  if (f.q) {
    const like = `%${f.q}%`;
    const norm = normalizeArticleCode(f.q);
    const parts: SQL[] = [sql`a.descripcion ilike ${like}`, sql`a.aplicacion ilike ${like}`, sql`a.ubicacion ilike ${like}`, sql`a.equivalencias::text ilike ${like}`];
    if (norm) {
      parts.push(sql`a.codigo_norm like ${`%${norm}%`}`);
      parts.push(sql`exists (select 1 from jsonb_array_elements(a.equivalencias) e
        where upper(regexp_replace(e->>'codigo', '[\\s\\-./\\\\_]+', '', 'g')) like ${`%${norm}%`})`);
    }
    conditions.push(sql`(${sql.join(parts, sql` or `)})`);
  }
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const rows = await query<Row>(
    tx,
    sql`select a.id, a.codigo, a.descripcion, a.rubro, a.unidad, a.stock_minimo::float8 as stock_minimo, a.ubicacion,
               a.equivalencias, a.aplicacion, a.activo,
               coalesce(p.saldo, 0)::float8 as saldo, coalesce(p.valor, 0)::float8 as valor, p.ultimo::text as ultimo
        from articles a
        left join (
          select l.article_id,
                 sum(case when m.tipo = 'SALIDA' then -l.cantidad else l.cantidad end) as saldo,
                 sum(l.valor) as valor,
                 max(m.fecha) as ultimo
          from stock_movement_lines l join stock_movements m on m.id = l.movement_id
          where m.anulado = false
          group by l.article_id
        ) p on p.article_id = a.id
        ${where}
        order by a.codigo
        limit ${limit}`,
  );
  return rows.map((r) => {
    const saldo = Math.round(Number(r.saldo) * 1000) / 1000;
    const valor = saldo === 0 ? 0 : round2(Number(r.valor));
    const stockMinimo = Number(r.stock_minimo);
    return {
      id: String(r.id),
      codigo: String(r.codigo),
      descripcion: String(r.descripcion),
      rubro: r.rubro as ArticleRubro,
      unidad: r.unidad as ArticleUnit,
      stockMinimo,
      ubicacion: str(r.ubicacion),
      equivalencias: (r.equivalencias as ArticleEquivalent[] | null) ?? [],
      aplicacion: str(r.aplicacion),
      activo: Boolean(r.activo),
      saldo,
      valor,
      costoPromedio: saldo > 0 ? round4(valor / saldo) : 0,
      bajoMinimo: stockMinimo > 0 && saldo <= stockMinimo,
      ultimoMovimiento: str(r.ultimo),
    };
  });
}

interface MovementFilters {
  ids?: string[];
  receptionIds?: string[];
  desde?: string;
  hasta?: string;
  tipo?: StockMovementType;
  articulo?: string;
  maquina?: string;
  obra?: string;
  q?: string;
  incluirAnulados?: boolean;
}

export async function loadStockMovements(tx: Db, f: MovementFilters, limit = 1000): Promise<StockMovementDto[]> {
  const conditions: SQL[] = [];
  if (f.ids) conditions.push(sql`m.id in ${sqlList(f.ids)}`);
  if (f.receptionIds) conditions.push(sql`m.reception_id in ${sqlList(f.receptionIds)}`);
  if (!f.incluirAnulados) conditions.push(sql`m.anulado = false`);
  if (f.desde) conditions.push(sql`m.fecha >= ${f.desde}::date`);
  if (f.hasta) conditions.push(sql`m.fecha <= ${f.hasta}::date`);
  if (f.tipo) conditions.push(sql`m.tipo = ${f.tipo}`);
  if (f.maquina) conditions.push(sql`m.machine_id = ${f.maquina}::uuid`);
  if (f.obra) conditions.push(sql`m.worksite_id = ${f.obra}::uuid`);
  if (f.articulo) conditions.push(sql`exists (select 1 from stock_movement_lines la where la.movement_id = m.id and la.article_id = ${f.articulo}::uuid)`);
  if (f.q) {
    const like = `%${f.q}%`;
    conditions.push(sql`(m.numero::text ilike ${like} or m.remision ilike ${like} or m.motivo ilike ${like} or m.observaciones ilike ${like}
      or exists (select 1 from stock_movement_lines lq join articles aq on aq.id = lq.article_id
                 where lq.movement_id = m.id and (aq.codigo ilike ${like} or aq.descripcion ilike ${like})))`);
  }
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const rows = await query<Row>(
    tx,
    sql`select m.id, m.numero, m.fecha::text as fecha, m.tipo, m.remision, m.motivo, m.observaciones, m.anulado, m.anulado_motivo,
               mc.id as mid, mc.codigo as mcod, mc.descripcion as mdes,
               w.id as wid, w.codigo as wcod, w.nombre as wnom,
               so.id as soid, so.numero as sonum,
               s.id as sid, s.nombre as snom,
               r.id as rid, r.numero as rnum, o.id as oid, o.numero as onum
        from stock_movements m
        left join machines mc on mc.id = m.machine_id
        left join worksites w on w.id = m.worksite_id
        left join service_orders so on so.id = m.service_order_id
        left join suppliers s on s.id = m.supplier_id
        left join order_receptions r on r.id = m.reception_id
        left join material_orders o on o.id = r.order_id
        ${where}
        order by m.fecha desc, m.numero desc
        limit ${limit}`,
  );
  if (rows.length === 0) return [];
  const lineRows = await query<Row>(
    tx,
    sql`select l.movement_id, l.article_id, l.cantidad::float8 as cantidad, l.costo_unitario::float8 as costo, l.valor::float8 as valor,
               a.codigo, a.descripcion, a.unidad
        from stock_movement_lines l join articles a on a.id = l.article_id
        where l.movement_id in ${sqlList(rows.map((r) => String(r.id)))}
        order by a.codigo`,
  );
  return rows.map((r) => {
    const id = String(r.id);
    return {
      id,
      numero: Number(r.numero),
      fecha: String(r.fecha),
      tipo: r.tipo as StockMovementType,
      machine: str(r.mid) ? { id: String(r.mid), codigo: String(r.mcod), descripcion: String(r.mdes) } : null,
      worksite: str(r.wid) ? { id: String(r.wid), codigo: String(r.wcod), nombre: String(r.wnom) } : null,
      serviceOrder: str(r.soid) ? { id: String(r.soid), numero: Number(r.sonum) } : null,
      supplier: str(r.sid) ? { id: String(r.sid), nombre: String(r.snom) } : null,
      remision: str(r.remision),
      reception: str(r.rid) ? { id: String(r.rid), numero: Number(r.rnum), orderId: String(r.oid), orderNumero: Number(r.onum) } : null,
      motivo: str(r.motivo),
      observaciones: str(r.observaciones),
      anulado: Boolean(r.anulado),
      anuladoMotivo: str(r.anulado_motivo),
      lines: lineRows
        .filter((l) => String(l.movement_id) === id)
        .map((l) => ({
          articleId: String(l.article_id),
          articulo: { codigo: String(l.codigo), descripcion: String(l.descripcion), unidad: l.unidad as ArticleUnit },
          cantidad: Number(l.cantidad),
          costoUnitario: Number(l.costo),
          valor: Number(l.valor),
        })),
    };
  });
}

/** Saldo y valor actuales por artículo, sin contar vales anulados. */
async function positions(tx: Db, articleIds: string[]): Promise<Map<string, StockPosition>> {
  const rows = await query<Row>(
    tx,
    sql`select l.article_id,
               coalesce(sum(case when m.tipo = 'SALIDA' then -l.cantidad else l.cantidad end), 0)::float8 as saldo,
               coalesce(sum(l.valor), 0)::float8 as valor
        from stock_movement_lines l join stock_movements m on m.id = l.movement_id
        where m.anulado = false and l.article_id in ${sqlList(articleIds)}
        group by l.article_id`,
  );
  return new Map(
    rows.map((r) => {
      const saldo = Math.round(Number(r.saldo) * 1000) / 1000;
      return [String(r.article_id), { saldo, valor: saldo === 0 ? 0 : round2(Number(r.valor)) }];
    }),
  );
}

/** Bloquea las filas de los artículos (en orden fijo, para no trabarse entre vales simultáneos). */
async function lockArticles(tx: Db, articleIds: string[]): Promise<Map<string, Row>> {
  const rows = await query<Row>(
    tx,
    sql`select id, codigo, descripcion, activo, stock_minimo::float8 as stock_minimo from articles
        where id in ${sqlList(articleIds)} order by id for update`,
  );
  return new Map(rows.map((r) => [String(r.id), r]));
}

/* ─── Alta de un vale ──────────────────────────────────────────────────── */

/**
 * Crea un vale de stock. Valida, verifica las referencias de la empresa, bloquea los artículos, rechaza
 * lo que dejaría un saldo negativo y valoriza cada renglón. Lanza `Rejected` ante cualquier problema.
 */
export async function createStockMovement(tx: Db, companyId: string, input: StockMovementInput): Promise<{ id: string; advertencias: string[] }> {
  const errors = validateStockMovement(
    {
      tipo: input.tipo,
      fecha: input.fecha,
      machineId: input.machineId,
      worksiteId: input.worksiteId,
      serviceOrderId: input.serviceOrderId,
      motivo: input.motivo,
      lines: input.lines,
    },
    today(),
  );
  if (errors.length > 0) throw new Rejected(errors);

  const missing = [
    ...(await missingIds(tx, 'machines', [input.machineId])),
    ...(await missingIds(tx, 'worksites', [input.worksiteId])),
    ...(await missingIds(tx, 'suppliers', [input.supplierId])),
    ...(await missingIds(tx, 'service_orders', [input.serviceOrderId])),
    ...(await missingIds(tx, 'order_receptions', [input.receptionId])),
    ...(await missingIds(tx, 'articles', input.lines.map((l) => l.articleId))),
  ];
  if (missing.length > 0) throw new Rejected(['La máquina, la obra, el proveedor, la orden de servicio o un artículo elegidos no existen.']);

  let machineId = input.machineId ?? null;
  if (input.serviceOrderId) {
    const [order] = await query<Row>(tx, sql`select machine_id from service_orders where id = ${input.serviceOrderId}`);
    if (machineId && machineId !== String(order.machine_id)) throw new Rejected(['La orden de servicio es de otra máquina.']);
    machineId = String(order.machine_id);
  }

  const articleIds = input.lines.map((l) => l.articleId);
  const locked = await lockArticles(tx, articleIds);
  const inactive = [...locked.values()].filter((a) => !Boolean(a.activo));
  if (inactive.length > 0) throw new Rejected([`Artículo inactivo: ${inactive.map((a) => String(a.codigo)).join(', ')}.`]);

  const current = await positions(tx, articleIds);
  const applied = input.lines.map((line) => {
    const position = current.get(line.articleId) ?? { saldo: 0, valor: 0 };
    return { line, position, result: applyMovement(position, input.tipo, line.cantidad, line.costoUnitario) };
  });

  const short = wouldGoNegative(
    new Map(applied.map((a) => [a.line.articleId, a.position.saldo])),
    applied.map((a) => ({ articleId: a.line.articleId, delta: a.result.delta })),
  );
  if (short.length > 0) {
    throw new Rejected(
      short.map((s) => {
        const code = String(locked.get(s.articleId)?.codigo ?? 'el artículo');
        return `Saldo insuficiente de ${code}: hay ${s.disponible} y la operación lo dejaría en ${s.saldo}. Registrá la entrada que falta o hacé un ajuste con motivo.`;
      }),
    );
  }

  const advertencias: string[] = [];
  for (const a of applied) {
    const minimo = Number(locked.get(a.line.articleId)?.stock_minimo ?? 0);
    if (a.result.delta < 0 && minimo > 0 && a.result.position.saldo <= minimo) {
      advertencias.push(`${String(locked.get(a.line.articleId)?.codigo)} quedó en ${a.result.position.saldo}, en o por debajo del mínimo (${minimo}).`);
    }
  }

  const numero = await nextDocumentNumber(tx, companyId, 'STOCK');
  const [row] = await query<{ id: string }>(
    tx,
    sql`insert into stock_movements (company_id, numero, fecha, tipo, machine_id, worksite_id, service_order_id, supplier_id, remision,
          reception_id, motivo, observaciones)
        values (${companyId}, ${numero}, ${input.fecha}::date, ${input.tipo}, ${machineId}, ${input.worksiteId ?? null},
          ${input.serviceOrderId ?? null}, ${input.supplierId ?? null}, ${input.remision ?? null}, ${input.receptionId ?? null},
          ${input.motivo ?? null}, ${input.observaciones ?? null})
        returning id`,
  );
  const id = String(row.id);
  for (const a of applied) {
    await query(
      tx,
      sql`insert into stock_movement_lines (company_id, movement_id, article_id, cantidad, costo_unitario, valor)
          values (${companyId}, ${id}, ${a.line.articleId}, ${a.line.cantidad}, ${round4(a.result.costoUnitario)}, ${a.result.valor})`,
    );
  }
  return { id, advertencias };
}

/* ─── Artículos: alta y edición ────────────────────────────────────────── */

type ArticleBody = z.infer<typeof articleSchema>;

async function insertArticle(tx: Db, companyId: string, body: ArticleBody): Promise<string> {
  const [row] = await query<{ id: string }>(
    tx,
    sql`insert into articles (company_id, codigo, codigo_norm, descripcion, rubro, unidad, stock_minimo, ubicacion, equivalencias, aplicacion, activo)
        values (${companyId}, ${body.codigo}, ${normalizeArticleCode(body.codigo)}, ${body.descripcion}, ${body.rubro}, ${body.unidad},
                ${body.stockMinimo}, ${body.ubicacion ?? null}, ${JSON.stringify(body.equivalencias)}::jsonb, ${body.aplicacion ?? null}, ${body.activo})
        returning id`,
  );
  return String(row.id);
}

async function updateArticle(tx: Db, id: string, body: ArticleBody): Promise<void> {
  await query(
    tx,
    sql`update articles set codigo = ${body.codigo}, codigo_norm = ${normalizeArticleCode(body.codigo)}, descripcion = ${body.descripcion},
          rubro = ${body.rubro}, unidad = ${body.unidad}, stock_minimo = ${body.stockMinimo}, ubicacion = ${body.ubicacion ?? null},
          equivalencias = ${JSON.stringify(body.equivalencias)}::jsonb, aplicacion = ${body.aplicacion ?? null}, activo = ${body.activo}
        where id = ${id}`,
  );
}

async function assertCodeFree(tx: Db, codigo: string, exceptId: string | null): Promise<void> {
  const norm = normalizeArticleCode(codigo);
  if (!norm) throw new Rejected(['El código no puede quedar vacío.']);
  const [dup] = await query<Row>(
    tx,
    exceptId
      ? sql`select codigo from articles where codigo_norm = ${norm} and id <> ${exceptId}`
      : sql`select codigo from articles where codigo_norm = ${norm}`,
  );
  if (dup) throw new Rejected([`Ya existe el artículo ${String(dup.codigo)} (los códigos se comparan sin espacios ni signos).`], 409);
}

/* ─── Rutas ────────────────────────────────────────────────────────────── */

export function stockRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  router.use('/api/stock', deps.requireAuth);
  router.use('/api/informes/stock-existencias', deps.requireAuth);
  router.use('/api/informes/stock-kardex', deps.requireAuth);
  router.use('/api/informes/stock-consumo', deps.requireAuth);

  /* Artículos */
  router.get(
    '/api/stock/articulos',
    asyncRoute(async (req, res) => {
      const parsed = articleFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      res.json(
        await withTenant(db, req.auth!.companyId, (tx) =>
          loadArticles(tx, {
            q: f.q,
            rubro: f.rubro,
            bajoMinimo: f.bajoMinimo === 'true',
            conSaldo: f.conSaldo === 'true',
            activo: f.activo === undefined ? undefined : f.activo === 'true',
          }),
        ),
      );
    }),
  );

  router.post(
    '/api/stock/articulos',
    asyncRoute(async (req, res) => {
      const body = parseBody(articleSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        await assertCodeFree(tx, body.codigo, null);
        return (await loadArticles(tx, { ids: [await insertArticle(tx, companyId, body)] }))[0];
      }, 201);
    }),
  );

  router.put(
    '/api/stock/articulos/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Artículo no encontrado.' });
        return;
      }
      const body = parseBody(articleSchema, req, res);
      if (!body) return;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [current] = await query(tx, sql`select id from articles where id = ${id.data} for update`);
        if (!current) throw new Rejected(['Artículo no encontrado.'], 404);
        await assertCodeFree(tx, body.codigo, id.data);
        await updateArticle(tx, id.data, body);
        return (await loadArticles(tx, { ids: [id.data] }))[0];
      });
    }),
  );

  // Sugerencia de artículo para los números de parte de una recepción (por código propio o equivalencia).
  router.post(
    '/api/stock/articulos/coincidencias',
    asyncRoute(async (req, res) => {
      const body = parseBody(matchSchema, req, res);
      if (!body) return;
      res.json(
        await withTenant(db, req.auth!.companyId, async (tx): Promise<ArticleMatchDto[]> => {
          const all = await loadArticles(tx, { activo: true });
          const matchable = all.map((a) => ({ id: a.id, codigo: a.codigo, equivalencias: a.equivalencias }));
          return body.codigos.map((codigo) => {
            const match = matchArticle(codigo, matchable);
            return { codigo, articulo: match ? (all.find((a) => a.id === match.articleId) ?? null) : null, via: match?.via ?? null };
          });
        }),
      );
    }),
  );

  // Carga inicial desde una planilla: alta o actualización por código y, si hay conteo físico, un vale de saldo inicial.
  router.post(
    '/api/stock/articulos/lote',
    asyncRoute(async (req, res) => {
      const body = parseBody(articleBatchSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx): Promise<ArticleBatchResult> => {
        const rejected: string[] = [];
        const seen = new Set<string>();
        let creados = 0;
        let actualizados = 0;
        const opening: { articleId: string; cantidad: number; costoUnitario: number }[] = [];
        for (const [i, item] of body.articulos.entries()) {
          const label = `Fila ${i + 1} (${item.codigo})`;
          const norm = normalizeArticleCode(item.codigo);
          if (!norm) {
            rejected.push(`${label}: el código no puede quedar vacío.`);
            continue;
          }
          if (seen.has(norm)) {
            rejected.push(`${label}: el código está repetido en la planilla.`);
            continue;
          }
          seen.add(norm);
          const { saldoInicial, ...given } = item;
          const [existing] = await query<Row>(
            tx,
            sql`select id, rubro, unidad, stock_minimo::float8 as stock_minimo, ubicacion, equivalencias, aplicacion, activo
                from articles where codigo_norm = ${norm} for update`,
          );
          let articleId: string;
          if (existing) {
            articleId = String(existing.id);
            const defined = Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined));
            await updateArticle(tx, articleId, {
              rubro: existing.rubro as ArticleRubro,
              unidad: existing.unidad as ArticleUnit,
              stockMinimo: Number(existing.stock_minimo),
              ubicacion: str(existing.ubicacion),
              equivalencias: (existing.equivalencias as ArticleEquivalent[] | null) ?? [],
              aplicacion: str(existing.aplicacion),
              activo: Boolean(existing.activo),
              ...defined,
            } as ArticleBody);
            actualizados++;
          } else {
            articleId = await insertArticle(tx, companyId, articleSchema.parse(given));
            creados++;
          }
          if (saldoInicial) {
            const [used] = await query(tx, sql`select 1 from stock_movement_lines where article_id = ${articleId} limit 1`);
            if (used) rejected.push(`${label}: ya tiene movimientos, el saldo inicial se carga con un ajuste.`);
            else opening.push({ articleId, cantidad: saldoInicial.cantidad, costoUnitario: saldoInicial.costoUnitario });
          }
        }
        if (rejected.length > 0) throw new Rejected(rejected);
        let movimiento: StockMovementDto | null = null;
        if (opening.length > 0) {
          const { id } = await createStockMovement(tx, companyId, {
            tipo: 'SALDO_INICIAL',
            fecha: body.fecha ?? today(),
            motivo: 'Carga inicial por conteo físico',
            lines: opening,
          });
          movimiento = (await loadStockMovements(tx, { ids: [id], incluirAnulados: true }))[0];
        }
        return { creados, actualizados, movimiento };
      }, 201);
    }),
  );

  /* Vales */
  router.get(
    '/api/stock/movimientos',
    asyncRoute(async (req, res) => {
      const parsed = movementFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadStockMovements(tx, { ...f, incluirAnulados: f.incluirAnulados === 'true' })));
    }),
  );

  router.get(
    '/api/stock/movimientos/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const [movement] = id.success ? await withTenant(db, req.auth!.companyId, (tx) => loadStockMovements(tx, { ids: [id.data], incluirAnulados: true })) : [];
      if (!movement) {
        res.status(404).json({ error: 'Vale no encontrado.' });
        return;
      }
      res.json(movement);
    }),
  );

  router.post(
    '/api/stock/movimientos',
    asyncRoute(async (req, res) => {
      const body = parseBody(movementSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx): Promise<StockMovementResult> => {
        const { id, advertencias } = await createStockMovement(tx, companyId, body);
        const [movement] = await loadStockMovements(tx, { ids: [id], incluirAnulados: true });
        return { ...movement, advertencias };
      }, 201);
    }),
  );

  router.post(
    '/api/stock/movimientos/:id/anular',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Vale no encontrado.' });
        return;
      }
      const body = parseBody(annulSchema, req, res);
      if (!body) return;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [movement] = await loadStockMovements(tx, { ids: [id.data], incluirAnulados: true });
        if (!movement) throw new Rejected(['Vale no encontrado.'], 404);
        if (movement.anulado) throw new Rejected(['El vale ya está anulado.'], 409);
        const articleIds = movement.lines.map((l) => l.articleId);
        const locked = await lockArticles(tx, articleIds);
        // Anular una entrada, un saldo inicial o un ajuste positivo resta saldo: no puede dejarlo en negativo.
        const removal = movement.lines.map((l) => ({ articleId: l.articleId, delta: -movementDelta(movement.tipo, l.cantidad) })).filter((c) => c.delta < 0);
        if (removal.length > 0) {
          const current = await positions(tx, removal.map((c) => c.articleId));
          const short = wouldGoNegative(new Map([...current].map(([k, p]) => [k, p.saldo])), removal);
          if (short.length > 0) {
            throw new Rejected(
              short.map(
                (s) => `No se puede anular: ${String(locked.get(s.articleId)?.codigo ?? 'el artículo')} quedaría en ${s.saldo} (hay ${s.disponible}). Anulá antes las salidas que lo usaron.`,
              ),
              409,
            );
          }
        }
        await query(tx, sql`update stock_movements set anulado = true, anulado_motivo = ${body.motivo} where id = ${id.data}`);
        return (await loadStockMovements(tx, { ids: [id.data], incluirAnulados: true }))[0];
      });
    }),
  );

  /* Informes */
  router.get(
    '/api/informes/stock-existencias',
    asyncRoute(async (req, res) => {
      const parsed = articleFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const report = await withTenant(db, req.auth!.companyId, async (tx): Promise<StockExistencesReport> => {
        const items = await loadArticles(tx, {
          q: f.q,
          rubro: f.rubro,
          bajoMinimo: f.bajoMinimo === 'true',
          conSaldo: f.conSaldo === 'true',
          activo: f.activo === undefined ? undefined : f.activo === 'true',
        });
        return { totalValor: round2(items.reduce((acc, a) => acc + a.valor, 0)), items };
      });
      res.json(report);
    }),
  );

  router.get(
    '/api/informes/stock-kardex',
    asyncRoute(async (req, res) => {
      const parsed = kardexSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      await runInTenant(db, res, req.auth!.companyId, async (tx): Promise<KardexReport> => {
        const [article] = await loadArticles(tx, { ids: [f.articulo] });
        if (!article) throw new Rejected(['Artículo no encontrado.'], 404);
        let anterior: StockPosition = { saldo: 0, valor: 0 };
        if (f.desde) {
          const [row] = await query<Row>(
            tx,
            sql`select coalesce(sum(case when m.tipo = 'SALIDA' then -l.cantidad else l.cantidad end), 0)::float8 as saldo, coalesce(sum(l.valor), 0)::float8 as valor
                from stock_movement_lines l join stock_movements m on m.id = l.movement_id
                where m.anulado = false and l.article_id = ${f.articulo}::uuid and m.fecha < ${f.desde}::date`,
          );
          const saldo = Math.round(Number(row.saldo) * 1000) / 1000;
          anterior = { saldo, valor: saldo === 0 ? 0 : round2(Number(row.valor)) };
        }
        const conditions: SQL[] = [sql`m.anulado = false`, sql`l.article_id = ${f.articulo}::uuid`];
        if (f.desde) conditions.push(sql`m.fecha >= ${f.desde}::date`);
        if (f.hasta) conditions.push(sql`m.fecha <= ${f.hasta}::date`);
        const rows = await query<Row>(
          tx,
          sql`select m.id, m.fecha::text as fecha, m.numero, m.tipo, l.cantidad::float8 as cantidad, l.valor::float8 as valor,
                     coalesce(mc.codigo || ' ' || mc.descripcion, w.nombre, s.nombre, m.motivo) as destino
              from stock_movement_lines l
              join stock_movements m on m.id = l.movement_id
              left join machines mc on mc.id = m.machine_id
              left join worksites w on w.id = m.worksite_id
              left join suppliers s on s.id = m.supplier_id
              where ${sql.join(conditions, sql` and `)}
              order by m.fecha, m.numero`,
        );
        const lines = kardex(
          rows.map((r) => ({ id: String(r.id), fecha: String(r.fecha), numero: Number(r.numero), tipo: r.tipo as StockMovementType, cantidad: Number(r.cantidad), valor: Number(r.valor) })),
          anterior,
        );
        const destinos = new Map(rows.map((r) => [String(r.id), str(r.destino)]));
        return {
          articulo: { id: article.id, codigo: article.codigo, descripcion: article.descripcion, unidad: article.unidad },
          anterior,
          filas: lines.map((l) => ({ ...l, destino: destinos.get(l.id) ?? null })),
        };
      });
    }),
  );

  router.get(
    '/api/informes/stock-consumo',
    asyncRoute(async (req, res) => {
      const parsed = consumptionSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const report = await withTenant(db, req.auth!.companyId, async (tx) => {
        const conditions: SQL[] = [sql`m.anulado = false`, sql`m.tipo = 'SALIDA'`];
        if (f.desde) conditions.push(sql`m.fecha >= ${f.desde}::date`);
        if (f.hasta) conditions.push(sql`m.fecha <= ${f.hasta}::date`);
        if (f.maquina) conditions.push(sql`m.machine_id = ${f.maquina}::uuid`);
        if (f.obra) conditions.push(sql`m.worksite_id = ${f.obra}::uuid`);
        if (f.articulo) conditions.push(sql`l.article_id = ${f.articulo}::uuid`);
        if (f.rubro) conditions.push(sql`a.rubro = ${f.rubro}`);
        const rows = await query<Row>(
          tx,
          sql`select case when m.machine_id is not null then 'MAQUINA' else 'OBRA' end as destino_tipo,
                     coalesce(m.machine_id, m.worksite_id) as destino_id,
                     coalesce(mc.codigo || ' ' || mc.descripcion, w.nombre) as destino,
                     a.id as article_id, a.codigo, a.descripcion, a.unidad,
                     sum(l.cantidad)::float8 as cantidad, (-sum(l.valor))::float8 as valor
              from stock_movement_lines l
              join stock_movements m on m.id = l.movement_id
              join articles a on a.id = l.article_id
              left join machines mc on mc.id = m.machine_id
              left join worksites w on w.id = m.worksite_id
              where ${sql.join(conditions, sql` and `)}
              group by 1, 2, 3, a.id, a.codigo, a.descripcion, a.unidad
              order by 3, a.codigo`,
        );
        const filas: ConsumptionRow[] = rows.map((r) => ({
          destinoTipo: r.destino_tipo as ConsumptionRow['destinoTipo'],
          destinoId: String(r.destino_id),
          destino: String(r.destino),
          articleId: String(r.article_id),
          codigo: String(r.codigo),
          descripcion: String(r.descripcion),
          unidad: r.unidad as ArticleUnit,
          cantidad: Number(r.cantidad),
          valor: round2(Number(r.valor)),
        }));
        return { totalValor: round2(filas.reduce((acc, r) => acc + r.valor, 0)), filas };
      });
      res.json(report);
    }),
  );

  return router;
}
