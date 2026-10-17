/**
 * @file server/routes/events.ts
 * @description Partes diarios de eventos del taller (reemplazan PARTE DIARIO y su familia de
 * informes) e informes de partes, flota y vencimientos. Un parte puede traer una lectura de
 * horómetro: ambos se guardan en la misma transacción o no se guarda ninguno.
 */

import { Router, type RequestHandler } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import {
  complianceStatus,
  EVENT_TYPE_LABEL,
  type ComplianceStatus,
  type EventType,
  type MeterUnit,
  validateReading,
} from '../../shared/fleet';
import { asyncRoute, missingIds, parseBody, pgTextArray, query, sqlList, type Row } from './helpers';
import { insertReading, loadMachines, readingNeighbors } from './fleet';

const EVENT_TYPES = Object.keys(EVENT_TYPE_LABEL) as [EventType, ...EventType[]];
const SIN_ENVIO_NI_TRASLADO: EventType[] = ['ENVIO_REPUESTOS', 'TRASLADO'];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.');
const uuid = z.uuid();

const eventSchema = z.object({
  fecha: isoDate,
  machineId: uuid,
  descripcion: z.string().trim().min(1, 'La descripción es obligatoria.').max(500),
  tipos: z.array(z.enum(EVENT_TYPES)).default([]),
  worksiteId: uuid.nullable().optional(),
  operador: z.string().trim().max(80).nullable().optional(),
  notaEnvio: z.string().trim().max(40).nullable().optional(),
  lectura: z
    .object({
      valor: z.number().finite(),
      correccion: z.boolean().default(false),
      motivo: z.string().max(200).nullable().optional(),
    })
    .nullable()
    .optional(),
});

const batchSchema = z.object({ partes: z.array(eventSchema).min(1).max(200) });

const listFiltersSchema = z.object({
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  maquina: uuid.optional(),
  tipo: z.enum(EVENT_TYPES).optional(),
  q: z.string().max(80).optional(),
  sinEnvioNiTraslado: z.enum(['true', 'false']).optional(),
  sinNotaDeEnvio: z.enum(['true', 'false']).optional(),
  incluirAnulados: z.enum(['true', 'false']).optional(),
});

const reportFiltersSchema = z.object({
  agrupar: z.enum(['fecha', 'maquina', 'tipo']).default('fecha'),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  maquina: uuid.optional(),
});

const fleetReportSchema = z.object({ agrupar: z.enum(['obra', 'categoria', 'estado']).default('estado') });
const dueSchema = z.object({ dias: z.coerce.number().int().min(0).max(365).default(60) });

type EventBody = z.infer<typeof eventSchema>;

export interface EventDto {
  id: string;
  fecha: string;
  machine: { id: string; codigo: string; descripcion: string };
  descripcion: string;
  tipos: EventType[];
  worksite: { id: string; nombre: string } | null;
  operador: string | null;
  notaEnvio: string | null;
  /** Nota a obra que agrupa este envío de repuestos, si la hay. */
  siteDispatchNote: { id: string; numero: number } | null;
  anulado: boolean;
  lectura: { id: string; valor: number; unidad: MeterUnit; correccion: boolean; motivo: string | null } | null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

interface EventFilters {
  ids?: string[];
  desde?: string;
  hasta?: string;
  maquina?: string;
  tipo?: EventType;
  q?: string;
  sinEnvioNiTraslado?: boolean;
  sinNotaDeEnvio?: boolean;
  incluirAnulados?: boolean;
}

export async function loadEvents(tx: Db, f: EventFilters): Promise<EventDto[]> {
  const conditions: SQL[] = [];
  if (f.ids) conditions.push(sql`e.id in ${sqlList(f.ids)}`);
  if (!f.incluirAnulados) conditions.push(sql`e.anulado = false`);
  if (f.desde) conditions.push(sql`e.fecha >= ${f.desde}::date`);
  if (f.hasta) conditions.push(sql`e.fecha <= ${f.hasta}::date`);
  if (f.maquina) conditions.push(sql`e.machine_id = ${f.maquina}::uuid`);
  if (f.tipo) conditions.push(sql`${f.tipo}::text = any(e.tipos)`);
  if (f.q) conditions.push(sql`e.descripcion ilike ${`%${f.q}%`}`);
  if (f.sinEnvioNiTraslado) {
    conditions.push(sql`not (e.tipos && ${pgTextArray(SIN_ENVIO_NI_TRASLADO)}::text[])`);
  }
  if (f.sinNotaDeEnvio) {
    conditions.push(sql`'ENVIO_REPUESTOS' = any(e.tipos) and e.site_dispatch_note_id is null`);
  }
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;

  const rows = await query<Row>(
    tx,
    sql`select e.id, e.fecha::text as fecha, e.descripcion, e.tipos, e.operador, e.nota_envio, e.anulado,
               sn.id as sn_id, sn.numero as sn_numero,
               m.id as machine_id, m.codigo as machine_codigo, m.descripcion as machine_descripcion,
               w.id as worksite_id, w.nombre as worksite_nombre,
               r.id as reading_id, r.valor::float8 as reading_valor, r.unidad as reading_unidad,
               r.correccion as reading_correccion, r.motivo as reading_motivo
        from daily_events e
        join machines m on m.id = e.machine_id
        left join worksites w on w.id = e.worksite_id
        left join site_dispatch_notes sn on sn.id = e.site_dispatch_note_id
        left join machine_readings r on r.parte_id = e.id
        ${where}
        order by e.fecha desc, e.created_at desc`,
  );

  return rows.map((r) => ({
    id: String(r.id),
    fecha: String(r.fecha),
    machine: { id: String(r.machine_id), codigo: String(r.machine_codigo), descripcion: String(r.machine_descripcion) },
    descripcion: String(r.descripcion),
    tipos: ((r.tipos as string[] | null) ?? []) as EventType[],
    worksite: nullableString(r.worksite_id) ? { id: String(r.worksite_id), nombre: String(r.worksite_nombre) } : null,
    operador: nullableString(r.operador),
    notaEnvio: nullableString(r.nota_envio),
    siteDispatchNote: r.sn_id ? { id: String(r.sn_id), numero: Number(r.sn_numero) } : null,
    anulado: Boolean(r.anulado),
    lectura: nullableString(r.reading_id)
      ? {
          id: String(r.reading_id),
          valor: Number(r.reading_valor),
          unidad: r.reading_unidad as MeterUnit,
          correccion: Boolean(r.reading_correccion),
          motivo: nullableString(r.reading_motivo),
        }
      : null,
  }));
}

/**
 * Crea un parte dentro de la transacción. Si la lectura no es válida no escribe nada y
 * devuelve los errores, así el llamador puede abortar el lote completo.
 */
async function createEvent(
  tx: Db,
  companyId: string,
  body: EventBody,
): Promise<{ errors: string[]; id?: string }> {
  const [machine] = await query<Row>(tx, sql`select id, meter_unit from machines where id = ${body.machineId}`);
  if (!machine) return { errors: ['La máquina no existe o no es visible para esta empresa.'] };
  if ((await missingIds(tx, 'worksites', [body.worksiteId])).length > 0) return { errors: ['La obra elegida no existe.'] };

  if (body.lectura) {
    const { previous, next } = await readingNeighbors(tx, body.machineId, body.fecha);
    const errors = validateReading({
      previous,
      next,
      fecha: body.fecha,
      valor: body.lectura.valor,
      correccion: body.lectura.correccion,
      motivo: body.lectura.motivo,
    });
    if (errors.length > 0) return { errors };
  }

  const [row] = await query<{ id: string }>(
    tx,
    sql`insert into daily_events (company_id, fecha, machine_id, descripcion, tipos, worksite_id, operador, nota_envio)
        values (${companyId}, ${body.fecha}::date, ${body.machineId}, ${body.descripcion}, ${pgTextArray(body.tipos)}::text[],
                ${body.worksiteId ?? null}, ${body.operador ?? null}, ${body.notaEnvio ?? null})
        returning id`,
  );
  if (body.lectura) {
    const out = await insertReading(
      tx,
      companyId,
      { id: body.machineId, meterUnit: machine.meter_unit as MeterUnit },
      { fecha: body.fecha, valor: body.lectura.valor, correccion: body.lectura.correccion, motivo: body.lectura.motivo },
      'PARTE',
      String(row.id),
    );
    if (out.errors.length > 0) return { errors: out.errors };
  }
  return { errors: [], id: String(row.id) };
}

export function eventsRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  router.use('/api/partes', deps.requireAuth);
  router.use('/api/informes', deps.requireAuth);

  router.get(
    '/api/partes',
    asyncRoute(async (req, res) => {
      const parsed = listFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const events = await withTenant(db, req.auth!.companyId, (tx) =>
        loadEvents(tx, {
          desde: f.desde,
          hasta: f.hasta,
          maquina: f.maquina,
          tipo: f.tipo,
          q: f.q,
          sinEnvioNiTraslado: f.sinEnvioNiTraslado === 'true',
          sinNotaDeEnvio: f.sinNotaDeEnvio === 'true',
          incluirAnulados: f.incluirAnulados === 'true',
        }),
      );
      res.json(events);
    }),
  );

  router.get(
    '/api/partes/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const [event] = id.success
        ? await withTenant(db, req.auth!.companyId, (tx) => loadEvents(tx, { ids: [id.data], incluirAnulados: true }))
        : [];
      if (!event) {
        res.status(404).json({ error: 'Parte no encontrado.' });
        return;
      }
      res.json(event);
    }),
  );

  router.post(
    '/api/partes',
    asyncRoute(async (req, res) => {
      const body = parseBody(eventSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const result = await withTenant(db, companyId, async (tx) => {
        const out = await createEvent(tx, companyId, body);
        if (out.errors.length > 0) return { errors: out.errors };
        return { event: (await loadEvents(tx, { ids: [out.id!], incluirAnulados: true }))[0] };
      });
      if ('errors' in result) res.status(422).json({ error: 'El parte no es válido.', detalles: result.errors });
      else res.status(201).json(result.event);
    }),
  );

  router.post(
    '/api/partes/lote',
    asyncRoute(async (req, res) => {
      const body = parseBody(batchSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const rejected: { indice: number; errores: string[] }[] = [];
      const created = await withTenant(db, companyId, async (tx) => {
        const ids: string[] = [];
        for (const [indice, parte] of body.partes.entries()) {
          const out = await createEvent(tx, companyId, parte);
          if (out.errors.length > 0) rejected.push({ indice, errores: out.errors });
          else ids.push(out.id!);
        }
        // Un error en cualquier parte deshace todo el lote, sin escrituras a medias.
        if (rejected.length > 0) throw new BatchRejectedError();
        return loadEvents(tx, { ids, incluirAnulados: true });
      }).catch((err: unknown) => {
        if (err instanceof BatchRejectedError) return null;
        throw err;
      });
      if (created === null) {
        res.status(422).json({ error: 'El lote no se guardó: hay partes con errores.', rechazados: rejected });
        return;
      }
      res.status(201).json(created);
    }),
  );

  router.put(
    '/api/partes/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Parte no encontrado.' });
        return;
      }
      const body = parseBody(eventSchema.omit({ lectura: true }), req, res);
      if (!body) return;
      let refsRejected = false;
      let blocked: string | null = null;
      const result = await withTenant(db, req.auth!.companyId, async (tx) => {
        const [exists] = await query<Row>(
          tx,
          sql`select e.id, n.numero as nota from daily_events e
              left join site_dispatch_notes n on n.id = e.site_dispatch_note_id where e.id = ${id.data}`,
        );
        if (!exists) return null;
        if (exists.nota !== null && exists.nota !== undefined && !body.tipos.includes('ENVIO_REPUESTOS')) {
          blocked = `El parte está en la nota a obra ${exists.nota}: no puede dejar de ser un envío de repuestos.`;
          return null;
        }
        const missing = [
          ...(await missingIds(tx, 'machines', [body.machineId])),
          ...(await missingIds(tx, 'worksites', [body.worksiteId])),
        ];
        if (missing.length > 0) {
          refsRejected = true;
          return null;
        }
        await query(
          tx,
          sql`update daily_events set fecha = ${body.fecha}::date, machine_id = ${body.machineId},
                descripcion = ${body.descripcion}, tipos = ${pgTextArray(body.tipos)}::text[],
                worksite_id = ${body.worksiteId ?? null}, operador = ${body.operador ?? null},
                nota_envio = ${body.notaEnvio ?? null}
              where id = ${id.data}`,
        );
        return (await loadEvents(tx, { ids: [id.data], incluirAnulados: true }))[0];
      });
      if (blocked) {
        res.status(409).json({ error: blocked });
        return;
      }
      if (refsRejected) {
        res.status(422).json({ error: 'La máquina o la obra elegidas no existen.' });
        return;
      }
      if (!result) {
        res.status(404).json({ error: 'Parte no encontrado.' });
        return;
      }
      res.json(result);
    }),
  );

  router.post(
    '/api/partes/:id/anular',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Parte no encontrado.' });
        return;
      }
      let blocked: string | null = null;
      const result = await withTenant(db, req.auth!.companyId, async (tx) => {
        const [inNote] = await query<Row>(
          tx,
          sql`select n.numero from daily_events e join site_dispatch_notes n on n.id = e.site_dispatch_note_id where e.id = ${id.data}`,
        );
        if (inNote) {
          blocked = `El parte está en la nota a obra ${inNote.numero}: anulá la nota o quitalo de ella primero.`;
          return undefined;
        }
        await query(tx, sql`update daily_events set anulado = true where id = ${id.data}`);
        return (await loadEvents(tx, { ids: [id.data], incluirAnulados: true }))[0];
      });
      if (blocked) {
        res.status(409).json({ error: blocked });
        return;
      }
      if (!result) {
        res.status(404).json({ error: 'Parte no encontrado.' });
        return;
      }
      res.json(result);
    }),
  );

  router.get(
    '/api/informes/partes',
    asyncRoute(async (req, res) => {
      const parsed = reportFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const events = await withTenant(db, req.auth!.companyId, (tx) =>
        loadEvents(tx, { desde: f.desde, hasta: f.hasta, maquina: f.maquina }),
      );
      const groups = new Map<string, EventDto[]>();
      for (const e of events) {
        const keys =
          f.agrupar === 'fecha'
            ? [e.fecha]
            : f.agrupar === 'maquina'
              ? [e.machine.codigo]
              : e.tipos.length > 0 ? e.tipos.map((t) => EVENT_TYPE_LABEL[t]) : ['Sin etiqueta'];
        for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), e]);
      }
      res.json({
        agrupar: f.agrupar,
        grupos: [...groups.entries()]
          .sort(([a], [b]) => (f.agrupar === 'fecha' ? b.localeCompare(a) : a.localeCompare(b)))
          .map(([clave, items]) => ({
            clave,
            partes: items.length,
            maquinas: new Set(items.map((i) => i.machine.codigo)).size,
            filas: items,
          })),
      });
    }),
  );

  router.get(
    '/api/informes/flota',
    asyncRoute(async (req, res) => {
      const parsed = fleetReportSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const agrupar = parsed.data.agrupar;
      const machines = await withTenant(db, req.auth!.companyId, (tx) => loadMachines(tx, { incluirBaja: true }));
      const keyOf = (m: (typeof machines)[number]) =>
        agrupar === 'obra' ? (m.worksite?.nombre ?? 'Sin obra') : agrupar === 'categoria' ? (m.category?.nombre ?? 'Sin categoría') : m.status;
      const groups = new Map<string, typeof machines>();
      for (const m of machines) groups.set(keyOf(m), [...(groups.get(keyOf(m)) ?? []), m]);
      res.json({
        agrupar,
        grupos: [...groups.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([clave, items]) => ({
            clave,
            cantidad: items.length,
            conLectura: items.filter((m) => m.lecturaActual !== null).length,
            codigos: items.map((m) => m.codigo),
          })),
      });
    }),
  );

  router.get(
    '/api/informes/vencimientos',
    asyncRoute(async (req, res) => {
      const parsed = dueSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const dias = parsed.data.dias;
      const hoy = new Date().toISOString().slice(0, 10);
      const machines = await withTenant(db, req.auth!.companyId, (tx) => loadMachines(tx, {}));
      const items: { maquina: { id: string; codigo: string; descripcion: string }; tipo: 'DINATRAN' | 'HABILITACION_MUNICIPAL'; vence: string; estado: ComplianceStatus }[] = [];
      for (const m of machines) {
        const checks = [
          { tipo: 'DINATRAN' as const, vence: m.dinatran.vence },
          { tipo: 'HABILITACION_MUNICIPAL' as const, vence: m.habilitacionMunicipal.vence },
        ];
        for (const c of checks) {
          const estado = complianceStatus(c.vence, hoy, dias);
          if (c.vence && (estado === 'VENCIDO' || estado === 'POR_VENCER')) {
            items.push({ maquina: { id: m.id, codigo: m.codigo, descripcion: m.descripcion }, tipo: c.tipo, vence: c.vence, estado });
          }
        }
      }
      items.sort((a, b) => a.vence.localeCompare(b.vence));
      res.json({ hoy, dias, items });
    }),
  );

  return router;
}

class BatchRejectedError extends Error {}
