/**
 * @file server/routes/imports.ts
 * @description Carga de planillas (Excel/CSV) desde la app: proveedores, obras, máquinas y lecturas de
 * horómetro. Cada carga es todo o nada: si una fila no es válida no se guarda ninguna y la respuesta
 * lista los errores por fila («Fila 7: …»). Los maestros se actualizan por código (se pueden volver a
 * subir con correcciones). Cada carga queda registrada en `import_runs`. Las lecturas pasan por la misma
 * validación que Flota (no pueden bajar), así que no se puede ensuciar el historial desde una planilla.
 */

import { Router, type RequestHandler, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import { normalizeMachineCode } from '../../shared/fleet';
import { normalizeName } from '../../shared/import/common';
import { insertMany } from '../import/db';
import { asyncRoute, parseBody, query, Rejected, type Row } from './helpers';
import { insertReading } from './fleet';

const MAX_ROWS = 5000;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.');
const text = (max: number) => z.string().trim().max(max).nullable().optional();

const supplierRow = z.object({
  codigo: z.string().trim().min(1, 'Falta el código.').max(20, 'El código es demasiado largo.'),
  nombre: z.string().trim().min(1, 'Falta el nombre.').max(120),
  ruc: text(30),
});
const worksiteRow = z.object({
  codigo: z.string().trim().min(1, 'Falta el código.').max(20, 'El código es demasiado largo.'),
  nombre: z.string().trim().min(1, 'Falta el nombre.').max(120),
});
const machineRow = z.object({
  codigo: z.string().trim().min(1, 'Falta el código.').max(20, 'El código es demasiado largo.'),
  descripcion: z.string().trim().min(1, 'Falta la descripción.').max(120),
  marca: text(60),
  modelo: text(60),
  anio: z.number().int().min(1950, 'El año no es válido.').max(2100, 'El año no es válido.').nullable().optional(),
  chapa: text(20),
  obra: text(120),
  categoria: text(60),
  unidad: z.enum(['HS', 'KM']).nullable().optional(),
  llevaMantenimiento: z.boolean().nullable().optional(),
});
const readingRow = z.object({
  maquina: z.string().trim().min(1, 'Falta el código de la máquina.').max(20),
  fecha: isoDate,
  valor: z.number().finite('El valor no es un número.').nonnegative('El valor no puede ser negativo.'),
  correccion: z.boolean().nullable().optional(),
  motivo: text(200),
});

const batchSchema = z
  .object({ archivo: text(200), filas: z.array(z.unknown()).min(1, 'La planilla no tiene filas.').max(MAX_ROWS, `Hasta ${MAX_ROWS} filas por carga.`) })
  .transform((b) => ({ archivo: b.archivo ?? null, filas: b.filas }));

interface Parsed<T> {
  rows: T[];
  errors: string[];
}

/** Valida cada fila con su esquema y junta los errores como «Fila N: mensaje» (la fila 1 es la primera de datos). */
function parseRows<T extends z.ZodType>(row: T, filas: unknown[]): Parsed<z.infer<T>> {
  const rows: z.infer<T>[] = [];
  const errors: string[] = [];
  filas.forEach((raw, i) => {
    const parsed = row.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
    else for (const issue of parsed.error.issues) errors.push(`Fila ${i + 1}: ${issue.message}`);
  });
  return { rows, errors };
}

async function runInTenant<T>(db: Db, res: Response, companyId: string, fn: (tx: Db) => Promise<T>, status = 200): Promise<void> {
  try {
    res.status(status).json(await withTenant(db, companyId, fn));
  } catch (err) {
    if (err instanceof Rejected) {
      res.status(err.status).json({ error: err.errors.length === 1 ? err.errors[0] : 'La planilla no se cargó: hay filas con errores.', detalles: err.errors });
      return;
    }
    throw err;
  }
}

async function recordRun(tx: Db, companyId: string, tipo: string, archivo: string | null, usuario: string | null, leidas: number, cargadas: number): Promise<string> {
  const id = randomUUID();
  await insertMany(
    tx,
    'import_runs',
    [{ name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'origen' }, { name: 'archivo' }, { name: 'tipo' }, { name: 'estado' }, { name: 'filas_leidas' }, { name: 'filas_cargadas' }, { name: 'usuario' }, { name: 'terminada_at', cast: 'timestamptz' }],
    [[id, companyId, 'EXCEL', archivo, tipo, 'OK', leidas, cargadas, usuario, new Date().toISOString()]],
  );
  return id;
}

/** Duplicados dentro de la planilla, por clave normalizada. */
function duplicates<T>(rows: T[], keyOf: (r: T) => string): string[] {
  const seen = new Map<string, number>();
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const key = keyOf(r);
    const first = seen.get(key);
    if (first !== undefined) errors.push(`Fila ${i + 1}: el código está repetido en la planilla (ya figura en la fila ${first + 1}).`);
    else seen.set(key, i);
  });
  return errors;
}

export function importsRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  router.use('/api/importar', deps.requireAuth);

  router.post(
    '/api/importar/proveedores',
    asyncRoute(async (req, res) => {
      const body = parseBody(batchSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        const { rows, errors } = parseRows(supplierRow, body.filas);
        errors.push(...duplicates(rows, (r) => normalizeMachineCode(r.codigo)));
        if (errors.length > 0) throw new Rejected(errors);
        let creados = 0;
        let actualizados = 0;
        for (const r of rows) {
          const [row] = await query<Row>(
            tx,
            sql`insert into suppliers (company_id, codigo, nombre, ruc, origen) values (${companyId}, ${r.codigo}, ${r.nombre}, ${r.ruc ?? null}, 'EXCEL')
                on conflict (company_id, codigo) do update set nombre = excluded.nombre, ruc = coalesce(excluded.ruc, suppliers.ruc)
                returning (xmax = 0) as creado`,
          );
          if (row.creado) creados += 1;
          else actualizados += 1;
        }
        await recordRun(tx, companyId, 'PROVEEDORES', body.archivo, req.auth!.userId ?? null, rows.length, creados + actualizados);
        return { creados, actualizados };
      });
    }),
  );

  router.post(
    '/api/importar/obras',
    asyncRoute(async (req, res) => {
      const body = parseBody(batchSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        const { rows, errors } = parseRows(worksiteRow, body.filas);
        errors.push(...duplicates(rows, (r) => normalizeMachineCode(r.codigo)));
        if (errors.length > 0) throw new Rejected(errors);
        let creados = 0;
        let actualizados = 0;
        for (const r of rows) {
          const [row] = await query<Row>(
            tx,
            sql`insert into worksites (company_id, codigo, nombre, origen) values (${companyId}, ${r.codigo}, ${r.nombre}, 'EXCEL')
                on conflict (company_id, codigo) do update set nombre = excluded.nombre
                returning (xmax = 0) as creado`,
          );
          if (row.creado) creados += 1;
          else actualizados += 1;
        }
        await recordRun(tx, companyId, 'OBRAS', body.archivo, req.auth!.userId ?? null, rows.length, creados + actualizados);
        return { creados, actualizados };
      });
    }),
  );

  router.post(
    '/api/importar/maquinas',
    asyncRoute(async (req, res) => {
      const body = parseBody(batchSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        const { rows, errors } = parseRows(machineRow, body.filas);
        errors.push(...duplicates(rows, (r) => normalizeMachineCode(r.codigo)));

        // Obras (por código o por nombre) y categorías existentes.
        const worksites = await query<Row>(tx, sql`select id, codigo, nombre from worksites`);
        const siteBy = new Map<string, string>();
        for (const w of worksites) {
          siteBy.set(normalizeName(w.codigo), String(w.id));
          siteBy.set(normalizeName(w.nombre), String(w.id));
        }
        const categories = await query<Row>(tx, sql`select id, nombre from machine_categories`);
        const catBy = new Map(categories.map((c) => [normalizeName(c.nombre), String(c.id)]));
        const existing = await query<Row>(tx, sql`select id, codigo from machines`);
        const machineBy = new Map(existing.map((m) => [normalizeMachineCode(String(m.codigo)), String(m.id)]));

        rows.forEach((r, i) => {
          if (r.obra && !siteBy.has(normalizeName(r.obra))) errors.push(`Fila ${i + 1}: la obra «${r.obra}» no existe (cargala primero en Obras).`);
        });
        if (errors.length > 0) throw new Rejected(errors);

        let creados = 0;
        let actualizados = 0;
        for (const r of rows) {
          let categoryId: string | null = null;
          if (r.categoria) {
            categoryId = catBy.get(normalizeName(r.categoria)) ?? null;
            if (!categoryId) {
              const [c] = await query<Row>(tx, sql`insert into machine_categories (company_id, nombre) values (${companyId}, ${r.categoria}) returning id`);
              categoryId = String(c.id);
              catBy.set(normalizeName(r.categoria), categoryId);
            }
          }
          const worksiteId = r.obra ? (siteBy.get(normalizeName(r.obra)) ?? null) : null;
          const id = machineBy.get(normalizeMachineCode(r.codigo));
          if (id) {
            await query(
              tx,
              sql`update machines set descripcion = ${r.descripcion}, marca = coalesce(${r.marca ?? null}, marca), modelo = coalesce(${r.modelo ?? null}, modelo),
                    anio = coalesce(${r.anio ?? null}, anio), chapa = coalesce(${r.chapa ?? null}, chapa), worksite_id = coalesce(${worksiteId}::uuid, worksite_id),
                    category_id = coalesce(${categoryId}::uuid, category_id), lleva_mantenimiento = coalesce(${r.llevaMantenimiento ?? null}, lleva_mantenimiento)
                  where id = ${id}`,
            );
            actualizados += 1;
          } else {
            await query(
              tx,
              sql`insert into machines (company_id, codigo, descripcion, marca, modelo, anio, chapa, worksite_id, category_id, meter_unit, lleva_mantenimiento, origen)
                  values (${companyId}, ${r.codigo}, ${r.descripcion}, ${r.marca ?? null}, ${r.modelo ?? null}, ${r.anio ?? null}, ${r.chapa ?? null}, ${worksiteId}::uuid,
                    ${categoryId}::uuid, ${r.unidad ?? 'HS'}, ${r.llevaMantenimiento ?? false}, 'EXCEL')`,
            );
            creados += 1;
          }
        }
        await recordRun(tx, companyId, 'MAQUINAS', body.archivo, req.auth!.userId ?? null, rows.length, creados + actualizados);
        return { creados, actualizados };
      });
    }),
  );

  router.post(
    '/api/importar/lecturas',
    asyncRoute(async (req, res) => {
      const body = parseBody(batchSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        const { rows, errors } = parseRows(readingRow, body.filas);
        const machines = await query<Row>(tx, sql`select id, codigo, meter_unit from machines`);
        const byCode = new Map(machines.map((m) => [normalizeMachineCode(String(m.codigo)), { id: String(m.id), meterUnit: m.meter_unit as 'HS' | 'KM' }]));
        const indexed = rows.map((r, i) => ({ r, line: i + 1 }));
        indexed.forEach(({ r, line }) => {
          if (!byCode.has(normalizeMachineCode(r.maquina))) errors.push(`Fila ${line}: la máquina «${r.maquina}» no existe.`);
        });
        if (errors.length > 0) throw new Rejected(errors);

        // Se cargan en orden de fecha por máquina: cada lectura se valida contra las anteriores, incluidas las de la misma planilla.
        indexed.sort((a, b) => (a.r.fecha < b.r.fecha ? -1 : a.r.fecha > b.r.fecha ? 1 : a.line - b.line));
        const problems: string[] = [];
        let cargadas = 0;
        for (const { r, line } of indexed) {
          const machine = byCode.get(normalizeMachineCode(r.maquina))!;
          const out = await insertReading(tx, companyId, machine, { fecha: r.fecha, valor: r.valor, correccion: r.correccion ?? false, motivo: r.motivo ?? null }, 'MANUAL', null);
          if (out.errors.length > 0) for (const e of out.errors) problems.push(`Fila ${line}: ${e}`);
          else cargadas += 1;
        }
        if (problems.length > 0) throw new Rejected(problems.sort((a, b) => Number(a.slice(5, a.indexOf(':'))) - Number(b.slice(5, b.indexOf(':')))));
        await recordRun(tx, companyId, 'LECTURAS', body.archivo, req.auth!.userId ?? null, rows.length, cargadas);
        return { cargadas };
      });
    }),
  );

  router.get(
    '/api/importar/corridas',
    asyncRoute(async (req, res) => {
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(
          tx,
          sql`select id, origen, archivo, tipo, estado, filas_leidas, filas_cargadas, filas_observadas, filas_rechazadas, usuario, iniciada_at::text as iniciada
              from import_runs order by iniciada_at desc limit 100`,
        ),
      );
      res.json(
        rows.map((r) => ({
          id: String(r.id),
          origen: String(r.origen),
          archivo: r.archivo === null ? null : String(r.archivo),
          tipo: String(r.tipo),
          estado: String(r.estado),
          leidas: Number(r.filas_leidas),
          cargadas: Number(r.filas_cargadas),
          observadas: Number(r.filas_observadas),
          rechazadas: Number(r.filas_rechazadas),
          usuario: r.usuario === null ? null : String(r.usuario),
          fecha: String(r.iniciada),
        })),
      );
    }),
  );

  return router;
}

