/**
 * @file server/routes/orders.ts
 * @description Pedidos de materiales, recepciones parciales e informe de pendientes.
 * Todo corre dentro de withTenant, así RLS impide ver o modificar datos de otra empresa.
 */

import { Router, type RequestHandler } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import type { OrderStatus } from '../../shared/orders';
import {
  daysPending,
  lineStatus,
  orderStatus,
  pendingQuantity,
  receivedByLine,
  validateOrderDraft,
  validateReceptionDraft,
} from '../../shared/orders';
import type { MaterialOrder, OrderLine, OrderReception, OrderRubro } from '../../shared/erp';
import {
  asyncRoute,
  nextDocumentNumber,
  parseBody,
  pgTextArray,
  missingIds,
  query,
  Rejected,
  sqlList,
  type Row,
} from './helpers';
import { createStockMovement } from './stock';
import { enqueueErp } from '../bridge/outbox';

export const RUBROS = ['FILTROS', 'ACEITES', 'BATERIAS', 'CUBIERTAS', 'OTROS'] as const;
const ESTADOS: readonly OrderStatus[] = ['PENDIENTE', 'PARCIAL', 'RECIBIDO', 'COMPRA_CENTRAL', 'ANULADO'];
const AGRUPACIONES = ['obra', 'maquina', 'rubro', 'fecha'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.');
const uuid = z.uuid();

const orderLineSchema = z.object({
  nroParte: z.string().trim().max(40).nullable().optional(),
  descripcion: z.string().max(200),
  cantidad: z.number().finite(),
  machineId: uuid.nullable().optional(),
});

const orderSchema = z.object({
  fecha: isoDate,
  worksiteId: uuid.nullable().optional(),
  machineId: uuid.nullable().optional(),
  supplierId: uuid.nullable().optional(),
  pedidoDeObra: z.boolean().default(false),
  compraCentral: z.boolean().default(false),
  rubros: z.array(z.enum(RUBROS)).default([]),
  observaciones: z.string().max(500).nullable().optional(),
  lines: z.array(orderLineSchema),
});

const receptionSchema = z.object({
  fecha: isoDate,
  supplierId: uuid.nullable().optional(),
  facturaORemision: z.string().max(60).nullable().optional(),
  observaciones: z.string().max(500).nullable().optional(),
  lines: z.array(
    z.object({
      orderLineId: uuid,
      cantidad: z.number().finite(),
      // Si se indica, la cantidad recibida entra al stock de ese artículo al costo unitario dado.
      stock: z.object({ articleId: uuid, costoUnitario: z.number().finite().positive('El costo unitario debe ser mayor que 0.') }).nullable().optional(),
    }),
  ),
});

const listFiltersSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  obra: uuid.optional(),
  maquina: uuid.optional(),
  rubro: z.enum(RUBROS).optional(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  q: z.string().max(80).optional(),
});

const reportFiltersSchema = z.object({
  agrupar: z.enum(AGRUPACIONES).default('obra'),
  obra: uuid.optional(),
  maquina: uuid.optional(),
  rubro: z.enum(RUBROS).optional(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
});

interface LoadFilters {
  ids?: string[];
  desde?: string;
  hasta?: string;
  obra?: string;
  maquina?: string;
  rubro?: string;
  q?: string;
}

/** Trae pedidos con renglones, recepciones y estado calculado. Un solo camino para todas las lecturas. */
export async function loadOrders(tx: Db, filters: LoadFilters): Promise<MaterialOrder[]> {
  const conditions: SQL[] = [];
  if (filters.ids) conditions.push(sql`o.id in ${sqlList(filters.ids)}`);
  if (filters.desde) conditions.push(sql`o.fecha >= ${filters.desde}::date`);
  if (filters.hasta) conditions.push(sql`o.fecha <= ${filters.hasta}::date`);
  if (filters.obra) conditions.push(sql`o.worksite_id = ${filters.obra}::uuid`);
  if (filters.maquina) {
    conditions.push(sql`(o.machine_id = ${filters.maquina}::uuid or exists (
      select 1 from material_order_lines lm where lm.order_id = o.id and lm.machine_id = ${filters.maquina}::uuid))`);
  }
  if (filters.rubro) conditions.push(sql`${filters.rubro}::text = any(o.rubros)`);
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(sql`(o.numero::text ilike ${like} or o.observaciones ilike ${like} or exists (
      select 1 from material_order_lines lq where lq.order_id = o.id
        and (lq.descripcion ilike ${like} or lq.nro_parte ilike ${like})))`);
  }
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;

  const headers = await query<Row>(
    tx,
    sql`select o.id, o.numero, o.fecha::text as fecha, o.anulado, o.compra_central, o.pedido_de_obra,
               o.rubros, o.observaciones,
               w.id as obra_id, w.codigo as obra_codigo, w.nombre as obra_nombre,
               m.id as maquina_id, m.codigo as maquina_codigo, m.descripcion as maquina_descripcion,
               s.id as proveedor_id, s.nombre as proveedor_nombre
        from material_orders o
        left join worksites w on w.id = o.worksite_id
        left join machines m on m.id = o.machine_id
        left join suppliers s on s.id = o.supplier_id
        ${where}
        order by o.fecha desc, o.numero desc`,
  );
  if (headers.length === 0) return [];

  const ids = headers.map((h) => String(h.id));
  const lineRows = await query<Row>(
    tx,
    sql`select l.id, l.order_id, l.position, l.nro_parte, l.descripcion, l.cantidad::float8 as cantidad,
               l.machine_id, lm.codigo as maquina_codigo
        from material_order_lines l
        left join machines lm on lm.id = l.machine_id
        where l.order_id in ${sqlList(ids)}
        order by l.order_id, l.position`,
  );
  const receptionRows = await query<Row>(
    tx,
    sql`select r.id, r.order_id, r.numero, r.fecha::text as fecha, r.supplier_id, r.factura_o_remision,
               rl.order_line_id, rl.cantidad::float8 as cantidad
        from order_receptions r
        left join order_reception_lines rl on rl.reception_id = r.id
        where r.order_id in ${sqlList(ids)}
        order by r.numero, rl.order_line_id`,
  );

  const stockRows =
    receptionRows.length === 0
      ? []
      : await query<Row>(
          tx,
          sql`select id, numero, reception_id from stock_movements
              where anulado = false and reception_id in ${sqlList([...new Set(receptionRows.map((r) => String(r.id)))])}`,
        );
  const stockByReception = new Map(stockRows.map((r) => [String(r.reception_id), { id: String(r.id), numero: Number(r.numero) }]));

  return headers.map((h) => {
    const orderId = String(h.id);
    const receptions = buildReceptions(receptionRows.filter((r) => String(r.order_id) === orderId), stockByReception);
    const recibidas = receivedByLine(receptions);
    const lines: OrderLine[] = lineRows
      .filter((l) => String(l.order_id) === orderId)
      .map((l) => {
        const cantidad = Number(l.cantidad);
        const recibida = recibidas.get(String(l.id)) ?? 0;
        return {
          id: String(l.id),
          position: Number(l.position),
          nroParte: nullableString(l.nro_parte),
          descripcion: String(l.descripcion),
          cantidad,
          machineId: nullableString(l.machine_id),
          maquinaCodigo: nullableString(l.maquina_codigo),
          recibida,
          pendiente: pendingQuantity(cantidad, recibida),
          estado: lineStatus(cantidad, recibida),
        };
      });
    const anulado = Boolean(h.anulado);
    const compraCentral = Boolean(h.compra_central);
    return {
      id: orderId,
      numero: Number(h.numero),
      fecha: String(h.fecha),
      anulado,
      compraCentral,
      pedidoDeObra: Boolean(h.pedido_de_obra),
      rubros: (h.rubros as OrderRubro[] | null) ?? [],
      observaciones: nullableString(h.observaciones),
      worksite: nullableString(h.obra_id)
        ? { id: String(h.obra_id), codigo: String(h.obra_codigo), nombre: String(h.obra_nombre) }
        : null,
      machine: nullableString(h.maquina_id)
        ? { id: String(h.maquina_id), codigo: String(h.maquina_codigo), descripcion: String(h.maquina_descripcion) }
        : null,
      supplier: nullableString(h.proveedor_id)
        ? { id: String(h.proveedor_id), nombre: String(h.proveedor_nombre) }
        : null,
      estado: orderStatus(
        { anulado, compraCentral },
        lines.map((l) => ({ cantidad: l.cantidad, recibida: l.recibida })),
      ),
      lines,
      receptions,
    };
  });
}

function buildReceptions(rows: Row[], stockByReception: Map<string, { id: string; numero: number }>): OrderReception[] {
  const byId = new Map<string, OrderReception>();
  for (const r of rows) {
    const id = String(r.id);
    let reception = byId.get(id);
    if (!reception) {
      reception = {
        id,
        numero: Number(r.numero),
        fecha: String(r.fecha),
        supplierId: nullableString(r.supplier_id),
        facturaORemision: nullableString(r.factura_o_remision),
        lines: [],
        stockMovement: stockByReception.get(id) ?? null,
      };
      byId.set(id, reception);
    }
    if (r.order_line_id) {
      reception.lines.push({ orderLineId: String(r.order_line_id), cantidad: Number(r.cantidad) });
    }
  }
  return [...byId.values()];
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Inserta renglones con su posición. Los renglones son hijos del pedido y se reemplazan completos. */
async function insertLines(
  tx: Db,
  companyId: string,
  orderId: string,
  lines: z.infer<typeof orderLineSchema>[],
): Promise<void> {
  for (const [index, line] of lines.entries()) {
    await query(
      tx,
      sql`insert into material_order_lines (company_id, order_id, position, nro_parte, descripcion, cantidad, machine_id)
          values (${companyId}, ${orderId}, ${index + 1}, ${line.nroParte ?? null}, ${line.descripcion},
                  ${line.cantidad}, ${line.machineId ?? null})`,
    );
  }
}

/**
 * Crea un pedido de materiales con sus renglones y le asigna el siguiente número. Lo usan el alta de
 * pedidos y otros módulos (mantenimiento genera el pedido de repuestos). El llamador verifica que la
 * obra, la máquina y el proveedor existan para la empresa (hasForeignRefs).
 */
export async function createMaterialOrder(tx: Db, companyId: string, body: z.infer<typeof orderSchema>): Promise<string> {
  const numero = await nextDocumentNumber(tx, companyId, 'PEDIDO');
  const [row] = await query<{ id: string }>(
    tx,
    sql`insert into material_orders (company_id, numero, fecha, worksite_id, machine_id, supplier_id,
                                     pedido_de_obra, rubros, compra_central, observaciones)
        values (${companyId}, ${numero}, ${body.fecha}::date, ${body.worksiteId ?? null},
                ${body.machineId ?? null}, ${body.supplierId ?? null}, ${body.pedidoDeObra},
                ${pgTextArray(body.rubros)}::text[], ${body.compraCentral}, ${body.observaciones ?? null})
        returning id`,
  );
  await insertLines(tx, companyId, row.id, body.lines);
  // El ERP ve todos los pedidos del Taller y puede pasarlos a orden de compra
  await enqueueErp(tx, companyId, 'PEDIDO', row.id);
  return row.id;
}

/** Obra, máquinas o proveedor que no existen para la empresa (las claves foráneas no aplican RLS). */
async function hasForeignRefs(tx: Db, b: { worksiteId?: string | null; machineId?: string | null; supplierId?: string | null; lines: { machineId?: string | null }[] }): Promise<boolean> {
  const missing = [
    ...(await missingIds(tx, 'worksites', [b.worksiteId])),
    ...(await missingIds(tx, 'machines', [b.machineId, ...b.lines.map((l) => l.machineId)])),
    ...(await missingIds(tx, 'suppliers', [b.supplierId])),
  ];
  return missing.length > 0;
}

export function ordersRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  router.use('/api/pedidos', deps.requireAuth);
  router.use('/api/informes', deps.requireAuth);

  router.get(
    '/api/pedidos',
    asyncRoute(async (req, res) => {
      const parsed = listFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const orders = await withTenant(db, req.auth!.companyId, (tx) =>
        loadOrders(tx, {
          desde: f.desde,
          hasta: f.hasta,
          obra: f.obra,
          maquina: f.maquina,
          rubro: f.rubro,
          q: f.q,
        }),
      );
      res.json(f.estado ? orders.filter((o) => o.estado === f.estado) : orders);
    }),
  );

  router.get(
    '/api/pedidos/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const [order] = id.success
        ? await withTenant(db, req.auth!.companyId, (tx) => loadOrders(tx, { ids: [id.data] }))
        : [];
      if (!order) {
        res.status(404).json({ error: 'Pedido no encontrado.' });
        return;
      }
      res.json(order);
    }),
  );

  router.post(
    '/api/pedidos',
    asyncRoute(async (req, res) => {
      const body = parseBody(orderSchema, req, res);
      if (!body) return;
      const errors = validateOrderDraft(body.lines);
      if (errors.length > 0) {
        res.status(422).json({ error: 'El pedido no es válido.', detalles: errors });
        return;
      }
      const companyId = req.auth!.companyId;
      const created = await withTenant(db, companyId, async (tx) => {
        if (await hasForeignRefs(tx, body)) return null;
        const id = await createMaterialOrder(tx, companyId, body);
        return (await loadOrders(tx, { ids: [id] }))[0];
      });
      if (!created) {
        res.status(422).json({ error: 'La obra, la máquina o el proveedor elegidos no existen.' });
        return;
      }
      res.status(201).json(created);
    }),
  );

  router.put(
    '/api/pedidos/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Pedido no encontrado.' });
        return;
      }
      const body = parseBody(orderSchema, req, res);
      if (!body) return;
      const errors = validateOrderDraft(body.lines);
      if (errors.length > 0) {
        res.status(422).json({ error: 'El pedido no es válido.', detalles: errors });
        return;
      }
      const companyId = req.auth!.companyId;
      const result = await withTenant(db, companyId, async (tx) => {
        const [current] = await loadOrders(tx, { ids: [id.data] });
        if (!current) return { status: 404 as const };
        if (await hasForeignRefs(tx, body)) return { status: 422 as const };
        if (current.receptions.length > 0 || current.anulado) {
          return { status: 409 as const, error: 'Un pedido con recepciones o anulado no se puede modificar.' };
        }
        const [erp] = await query<Row>(tx, sql`select erp_tomado from material_orders where id = ${id.data}`);
        if (erp?.erp_tomado) return { status: 409 as const, error: 'El ERP ya está comprando este pedido: no se puede modificar.' };
        await query(
          tx,
          sql`update material_orders set fecha = ${body.fecha}::date, worksite_id = ${body.worksiteId ?? null},
                machine_id = ${body.machineId ?? null}, supplier_id = ${body.supplierId ?? null},
                pedido_de_obra = ${body.pedidoDeObra}, rubros = ${pgTextArray(body.rubros)}::text[],
                compra_central = ${body.compraCentral}, observaciones = ${body.observaciones ?? null}
              where id = ${id.data}`,
        );
        await query(tx, sql`delete from material_order_lines where order_id = ${id.data}`);
        await insertLines(tx, companyId, id.data, body.lines);
        await enqueueErp(tx, companyId, 'PEDIDO', id.data);
        return { status: 200 as const, order: (await loadOrders(tx, { ids: [id.data] }))[0] };
      });
      if (result.status === 200) res.json(result.order);
      else if (result.status === 422) res.status(422).json({ error: 'La obra, la máquina o el proveedor elegidos no existen.' });
      else if (result.status === 409) res.status(409).json({ error: result.error });
      else res.status(404).json({ error: 'Pedido no encontrado.' });
    }),
  );

  router.post(
    '/api/pedidos/:id/anular',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Pedido no encontrado.' });
        return;
      }
      const order = await withTenant(db, req.auth!.companyId, async (tx) => {
        await query(tx, sql`update material_orders set anulado = true where id = ${id.data}`);
        await enqueueErp(tx, req.auth!.companyId, 'PEDIDO', id.data);
        return (await loadOrders(tx, { ids: [id.data] }))[0];
      });
      if (!order) {
        res.status(404).json({ error: 'Pedido no encontrado.' });
        return;
      }
      res.json(order);
    }),
  );

  router.post(
    '/api/pedidos/:id/recepciones',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Pedido no encontrado.' });
        return;
      }
      const body = parseBody(receptionSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const result = await withTenant(db, companyId, async (tx) => {
        const [order] = await loadOrders(tx, { ids: [id.data] });
        if (!order) return { status: 404 as const };
        if (order.anulado || order.compraCentral) {
          return { status: 409 as const, error: 'No se puede recibir un pedido anulado o de compra central.' };
        }
        if ((await missingIds(tx, 'suppliers', [body.supplierId])).length > 0) {
          return { status: 422 as const, errors: ['El proveedor elegido no existe.'] };
        }
        const pendingByLine = new Map(order.lines.map((l) => [l.id, l.pendiente]));
        const errors = validateReceptionDraft(body.lines, pendingByLine);
        if (errors.length > 0) return { status: 422 as const, errors };

        const numero = await nextDocumentNumber(tx, companyId, 'RECEPCION');
        const [row] = await query<{ id: string }>(
          tx,
          sql`insert into order_receptions (company_id, order_id, numero, fecha, supplier_id,
                                            factura_o_remision, observaciones)
              values (${companyId}, ${id.data}, ${numero}, ${body.fecha}::date, ${body.supplierId ?? null},
                      ${body.facturaORemision ?? null}, ${body.observaciones ?? null})
              returning id`,
        );
        for (const line of body.lines) {
          await query(
            tx,
            sql`insert into order_reception_lines (company_id, reception_id, order_line_id, cantidad)
                values (${companyId}, ${row.id}, ${line.orderLineId}, ${line.cantidad})`,
          );
        }

        // Los renglones con artículo entran al stock en un solo vale enlazado a la recepción. Dos renglones
        // del mismo artículo se suman y su costo se promedia. Si el vale no es válido, `Rejected` deshace la recepción.
        const stockLines = new Map<string, { cantidad: number; importe: number }>();
        for (const line of body.lines) {
          if (!line.stock || line.cantidad <= 0) continue;
          const acc = stockLines.get(line.stock.articleId) ?? { cantidad: 0, importe: 0 };
          acc.cantidad += line.cantidad;
          acc.importe += line.cantidad * line.stock.costoUnitario;
          stockLines.set(line.stock.articleId, acc);
        }
        if (stockLines.size > 0) {
          await createStockMovement(tx, companyId, {
            tipo: 'ENTRADA',
            fecha: body.fecha,
            supplierId: body.supplierId ?? null,
            remision: body.facturaORemision ?? null,
            receptionId: row.id,
            observaciones: `Recepción Nº ${numero} del pedido Nº ${order.numero}`,
            lines: [...stockLines].map(([articleId, a]) => ({ articleId, cantidad: Math.round(a.cantidad * 1000) / 1000, costoUnitario: a.importe / a.cantidad })),
          });
        }
        return { status: 201 as const, order: (await loadOrders(tx, { ids: [id.data] }))[0] };
      }).catch((err: unknown) => {
        if (err instanceof Rejected) return { status: 422 as const, errors: err.errors };
        throw err;
      });
      if (result.status === 201) res.status(201).json(result.order);
      else if (result.status === 422) res.status(422).json({ error: 'La recepción no es válida.', detalles: result.errors });
      else if (result.status === 409) res.status(409).json({ error: result.error });
      else res.status(404).json({ error: 'Pedido no encontrado.' });
    }),
  );

  router.get(
    '/api/informes/pedidos-pendientes',
    asyncRoute(async (req, res) => {
      const parsed = reportFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const hoy = new Date().toISOString().slice(0, 10);
      const orders = await withTenant(db, req.auth!.companyId, (tx) =>
        loadOrders(tx, { desde: f.desde, hasta: f.hasta, obra: f.obra, maquina: f.maquina, rubro: f.rubro }),
      );
      const filas = orders
        .filter((o) => !o.anulado && !o.compraCentral)
        .flatMap((o) =>
          o.lines
            .filter((l) => l.pendiente > 0)
            .map((l) => ({
              pedidoId: o.id,
              pedidoNumero: o.numero,
              fecha: o.fecha,
              dias: daysPending(o.fecha, hoy),
              obra: o.worksite?.nombre ?? 'Sin obra',
              maquina: l.maquinaCodigo ?? o.machine?.codigo ?? 'Sin máquina',
              rubro: o.rubros[0] ?? 'SIN RUBRO',
              proveedor: o.supplier?.nombre ?? null,
              nroParte: l.nroParte,
              descripcion: l.descripcion,
              cantidad: l.cantidad,
              recibida: l.recibida,
              pendiente: l.pendiente,
            })),
        );

      const clave = (fila: (typeof filas)[number]): string => {
        switch (f.agrupar) {
          case 'obra':
            return fila.obra;
          case 'maquina':
            return fila.maquina;
          case 'rubro':
            return fila.rubro;
          case 'fecha':
            return fila.fecha.slice(0, 7);
        }
      };
      const grupos = new Map<string, typeof filas>();
      for (const fila of filas) {
        const k = clave(fila);
        grupos.set(k, [...(grupos.get(k) ?? []), fila]);
      }
      res.json({
        agrupar: f.agrupar,
        hoy,
        grupos: [...grupos.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([clave, items]) => ({
            clave,
            lineas: items.length,
            pedidos: new Set(items.map((i) => i.pedidoId)).size,
            diasMaxPendiente: Math.max(...items.map((i) => i.dias)),
            filas: items.sort((a, b) => b.dias - a.dias),
          })),
      });
    }),
  );

  return router;
}

