/**
 * @file server/routes/erp.ts
 * @description Integración con el ERP desde el lado del Taller:
 *  - POST /api/erp/eventos: avisos del ERP (máquina a máquina, con la clave de integración, sin sesión);
 *  - notas que oficina u obra le mandan al Taller y que el Taller recibe;
 *  - estado de la sincronización y envío inmediato de lo pendiente.
 */

import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import type { ServerEnv } from '../config/env';
import { aplicarEventoErp } from '../bridge/erpEvents';
import { enqueueErp, procesarOutbox } from '../bridge/outbox';
import { buildErpPayload } from '../bridge/erpPayloads';
import { getErp } from '../bridge/erp';
import { validateAcknowledge } from '../../shared/dispatch';
import { asyncRoute, parseBody, query, Rejected, type Row } from './helpers';

const uuid = z.string().uuid();
const eventoSchema = z.object({ id: z.number().int().positive(), tipo: z.string().min(1), payload: z.unknown() });
const recibirSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recibidoPor: z.string().min(1),
});

const today = () => new Date().toISOString().slice(0, 10);

const mapIncoming = (r: Row) => ({
  id: String(r.id),
  anio: Number(r.anio),
  numero: Number(r.numero),
  etiqueta: `${r.numero}/${r.anio}`,
  fecha: String(r.fecha),
  sistemaOrigen: String(r.sistema_origen),
  origenTipo: String(r.origen_tipo),
  destinoTipo: String(r.destino_tipo),
  contenido: String(r.contenido),
  chofer: r.chofer ? String(r.chofer) : null,
  observaciones: r.observaciones ? String(r.observaciones) : null,
  lineas: (r.lineas as { descripcion: string; cantidad?: number | null; unidad?: string | null }[]) ?? [],
  estado: String(r.estado),
  recibidoFecha: r.recibido_fecha ? String(r.recibido_fecha) : null,
  recibidoPor: r.recibido_por ? String(r.recibido_por) : null,
  anuladoMotivo: r.anulado_motivo ? String(r.anulado_motivo) : null,
});

const INCOMING_SELECT = sql`
  select id, anio, numero, fecha::text as fecha, sistema_origen, origen_tipo, destino_tipo, contenido, chofer, observaciones,
         lineas, estado, recibido_fecha::text as recibido_fecha, recibido_por, anulado_motivo
  from erp_incoming_notes`;

export function erpRouter(deps: { db: Db; requireAuth: RequestHandler; env: ServerEnv }): Router {
  const router = Router();
  const { db, env } = deps;

  /** Clave de máquina: el ERP se identifica con la clave compartida, no con un usuario. */
  const requireErpKey: RequestHandler = (req, res, next) => {
    if (!env.erp) {
      res.status(503).json({ error: 'La integración con el ERP no está configurada (ERP_URL).' });
      return;
    }
    const recibida = Buffer.from(String(req.header('x-integration-key') ?? ''));
    const esperada = Buffer.from(env.erp.key);
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
      res.status(401).json({ error: 'Clave de integración inválida.' });
      return;
    }
    next();
  };

  router.post(
    '/api/erp/eventos',
    requireErpKey,
    asyncRoute(async (req, res) => {
      const body = parseBody(eventoSchema, req, res);
      if (!body) return;
      const companyId = env.erp!.companyId;
      try {
        const r = await withTenant(db, companyId, (tx) => aplicarEventoErp(tx, companyId, { id: body.id, tipo: body.tipo, payload: body.payload }));
        res.json({ ok: true, ...r });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(422).json({ error: 'El aviso no tiene el formato esperado.', detalles: err.issues.map((i) => i.message) });
          return;
        }
        throw err;
      }
    }),
  );

  // ─── Notas que le mandan al Taller ──────────────────────────────────────────

  router.get(
    '/api/envios/entrantes',
    deps.requireAuth,
    asyncRoute(async (req, res) => {
      const estado = z.enum(['ENVIADA', 'RECIBIDA', 'ANULADA']).optional().safeParse(req.query.estado);
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(tx, sql`${INCOMING_SELECT} ${estado.success && estado.data ? sql`where estado = ${estado.data}` : sql``} order by fecha desc, numero desc limit 500`),
      );
      res.json(rows.map(mapIncoming));
    }),
  );

  router.post(
    '/api/envios/entrantes/:id/recibir',
    deps.requireAuth,
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = parseBody(recibirSchema, req, res);
      if (!id.success) {
        res.status(404).json({ error: 'Nota no encontrada.' });
        return;
      }
      if (!body) return;
      const companyId = req.auth!.companyId;
      try {
        const nota = await withTenant(db, companyId, async (tx) => {
          const [n] = await query<Row>(tx, sql`select estado, fecha::text as fecha from erp_incoming_notes where id = ${id.data} for update`);
          if (!n) throw new Rejected(['Nota no encontrada.'], 404);
          if (n.estado !== 'ENVIADA') throw new Rejected(['Solo se puede recibir una nota enviada.'], 409);
          const errors = validateAcknowledge({ fechaEnvio: String(n.fecha), fechaRecibido: body.fecha, recibidoPor: body.recibidoPor }, today());
          if (errors.length > 0) throw new Rejected(errors);
          await query(
            tx,
            sql`update erp_incoming_notes set estado = 'RECIBIDA', recibido_fecha = ${body.fecha}::date, recibido_por = ${body.recibidoPor}
                where id = ${id.data}`,
          );
          // El ERP (o la obra) que la mandó se entera de que llegó
          await enqueueErp(tx, companyId, 'NOTA_RECIBIDA', id.data);
          const [row] = await query<Row>(tx, sql`${INCOMING_SELECT} where id = ${id.data}`);
          return mapIncoming(row);
        });
        res.json(nota);
      } catch (err) {
        if (err instanceof Rejected) {
          res.status(err.status).json({ error: err.errors.length === 1 ? err.errors[0] : 'No se pudo completar la operación.', detalles: err.errors });
          return;
        }
        throw err;
      }
    }),
  );

  // ─── Estado de la sincronización ────────────────────────────────────────────

  router.get(
    '/api/erp/estado',
    deps.requireAuth,
    asyncRoute(async (req, res) => {
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(tx, sql`select estado, count(*)::int as n from erp_outbox where estado <> 'ENVIADO' group by estado`),
      );
      const n = (estado: string) => Number(rows.find((r) => r.estado === estado)?.n ?? 0);
      res.json({ conectado: Boolean(env.erp), pendientes: n('PENDIENTE'), fallidos: n('FALLIDO') });
    }),
  );

  router.post(
    '/api/erp/sincronizar',
    deps.requireAuth,
    asyncRoute(async (req, res) => {
      const erp = getErp();
      if (!erp) {
        res.status(409).json({ error: 'La integración con el ERP no está configurada.' });
        return;
      }
      res.json(await procesarOutbox(db, req.auth!.companyId, erp, buildErpPayload));
    }),
  );

  return router;
}
