/**
 * @file server/routes/masters.ts
 * @description Maestros mínimos (obras, proveedores, máquinas) y configuración por empresa
 * (moneda, IVA y membretes). Reemplazan las listas fijas del Access.
 */

import { Router, type RequestHandler } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import { asyncRoute, parseBody, query, type Row } from './helpers';

const codigo = z.string().trim().min(1).max(20);
const nombre = z.string().trim().min(1).max(120);

const worksiteSchema = z.object({ codigo, nombre });
const supplierSchema = z.object({ codigo, nombre, ruc: z.string().trim().max(30).nullable().optional() });

const settingsSchema = z.object({
  currency: z.string().length(3),
  secondaryCurrency: z.string().length(3),
  taxRate: z.number().min(0).max(1),
  letterheads: z.record(z.string(), z.string().max(200)),
  // Beneficiario de la reposición de caja chica. Si no se envía, se conserva el valor guardado.
  pettyCashSupplierId: z.uuid().nullable().optional(),
});

const DEFAULT_SETTINGS = {
  currency: 'PYG',
  secondaryCurrency: 'USD',
  taxRate: 0,
  letterheads: { ccc: 'C.C.C. S.A.', consorcio: 'Consorcio', papel_comun: '' },
  pettyCashSupplierId: null,
};

export function mastersRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  router.use('/api/obras', deps.requireAuth);
  router.use('/api/proveedores', deps.requireAuth);
  router.use('/api/configuracion', deps.requireAuth);

  const search = (req: { query: Record<string, unknown> }) =>
    typeof req.query.q === 'string' && req.query.q.trim() !== '' ? `%${req.query.q.trim()}%` : null;

  router.get(
    '/api/obras',
    asyncRoute(async (req, res) => {
      const like = search(req);
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(
          tx,
          sql`select id, codigo, nombre, activa from worksites
              where (${like}::text is null or codigo ilike ${like} or nombre ilike ${like})
              order by codigo`,
        ),
      );
      res.json(rows);
    }),
  );

  router.post(
    '/api/obras',
    asyncRoute(async (req, res) => {
      const body = parseBody(worksiteSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const [row] = await withTenant(db, companyId, (tx) =>
        query<Row>(
          tx,
          sql`insert into worksites (company_id, codigo, nombre) values (${companyId}, ${body.codigo}, ${body.nombre})
              returning id, codigo, nombre, activa`,
        ),
      );
      res.status(201).json(row);
    }),
  );

  router.get(
    '/api/proveedores',
    asyncRoute(async (req, res) => {
      const like = search(req);
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(
          tx,
          sql`select id, codigo, nombre, ruc from suppliers
              where (${like}::text is null or codigo ilike ${like} or nombre ilike ${like} or ruc ilike ${like})
              order by nombre`,
        ),
      );
      res.json(rows);
    }),
  );

  router.post(
    '/api/proveedores',
    asyncRoute(async (req, res) => {
      const body = parseBody(supplierSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const [row] = await withTenant(db, companyId, (tx) =>
        query<Row>(
          tx,
          sql`insert into suppliers (company_id, codigo, nombre, ruc)
              values (${companyId}, ${body.codigo}, ${body.nombre}, ${body.ruc ?? null})
              returning id, codigo, nombre, ruc`,
        ),
      );
      res.status(201).json(row);
    }),
  );

  router.get(
    '/api/proveedores/:id',
    asyncRoute(async (req, res) => {
      const id = z.uuid().safeParse(req.params.id);
      const [row] = id.success
        ? await withTenant(db, req.auth!.companyId, (tx) =>
            query<Row>(tx, sql`select id, codigo, nombre, ruc from suppliers where id = ${id.data}`),
          )
        : [];
      if (!row) {
        res.status(404).json({ error: 'Proveedor no encontrado.' });
        return;
      }
      res.json(row);
    }),
  );

  router.put(
    '/api/proveedores/:id',
    asyncRoute(async (req, res) => {
      const id = z.uuid().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Proveedor no encontrado.' });
        return;
      }
      const body = parseBody(supplierSchema, req, res);
      if (!body) return;
      const [row] = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(
          tx,
          sql`update suppliers set codigo = ${body.codigo}, nombre = ${body.nombre}, ruc = ${body.ruc ?? null}
              where id = ${id.data} returning id, codigo, nombre, ruc`,
        ),
      );
      if (!row) {
        res.status(404).json({ error: 'Proveedor no encontrado.' });
        return;
      }
      res.json(row);
    }),
  );

  router.get(
    '/api/configuracion',
    asyncRoute(async (req, res) => {
      const [row] = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(
          tx,
          sql`select currency, secondary_currency, tax_rate::float8 as tax_rate, letterheads, petty_cash_supplier_id
              from company_settings where company_id = ${req.auth!.companyId}`,
        ),
      );
      if (!row) {
        res.json(DEFAULT_SETTINGS);
        return;
      }
      res.json({
        currency: row.currency,
        secondaryCurrency: row.secondary_currency,
        taxRate: row.tax_rate,
        letterheads: row.letterheads,
        pettyCashSupplierId: row.petty_cash_supplier_id ?? null,
      });
    }),
  );

  router.put(
    '/api/configuracion',
    asyncRoute(async (req, res) => {
      const body = parseBody(settingsSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const keepSupplier = body.pettyCashSupplierId === undefined;
      const rejected = await withTenant(db, companyId, async (tx) => {
        if (body.pettyCashSupplierId) {
          const [exists] = await query(tx, sql`select id from suppliers where id = ${body.pettyCashSupplierId}`);
          if (!exists) return true;
        }
        await query(
          tx,
          sql`insert into company_settings (company_id, currency, secondary_currency, tax_rate, letterheads,
                                            petty_cash_supplier_id, updated_at)
              values (${companyId}, ${body.currency}, ${body.secondaryCurrency}, ${body.taxRate},
                      ${JSON.stringify(body.letterheads)}::jsonb, ${body.pettyCashSupplierId ?? null}, now())
              on conflict (company_id) do update set currency = excluded.currency,
                secondary_currency = excluded.secondary_currency, tax_rate = excluded.tax_rate,
                letterheads = excluded.letterheads,
                petty_cash_supplier_id = case when ${keepSupplier} then company_settings.petty_cash_supplier_id
                                              else excluded.petty_cash_supplier_id end,
                updated_at = now()`,
        );
        return false;
      });
      if (rejected) {
        res.status(422).json({ error: 'El proveedor elegido no existe.' });
        return;
      }
      res.json(body);
    }),
  );

  return router;
}
