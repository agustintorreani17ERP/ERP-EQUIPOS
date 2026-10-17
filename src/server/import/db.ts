/**
 * @file server/import/db.ts
 * @description Inserción masiva y registro de observaciones para la importación. La importación
 * escribe directo en la base (no por la API) para poder fijar números de documento y cargar decenas
 * de miles de filas; los datos siempre llevan `company_id` explícito.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { query } from '../routes/helpers';
import type { Observation } from '../../shared/import/common';

export interface Col {
  name: string;
  /** Tipo de Postgres al que se convierte el valor (`uuid`, `date`, `jsonb`…). */
  cast?: string;
}

/** Máximo de parámetros por sentencia, con margen bajo el límite de 65.535 del protocolo. */
const MAX_PARAMS = 30_000;

/** Inserta filas en bloques. `rows[i][j]` es el valor de `cols[j]`. */
export async function insertMany(tx: Db, table: string, cols: Col[], rows: unknown[][], onConflict = ''): Promise<void> {
  if (rows.length === 0) return;
  const chunk = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
  const names = sql.raw(cols.map((c) => `"${c.name}"`).join(', '));
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const tuples: SQL[] = slice.map(
      (row) =>
        sql`(${sql.join(
          row.map((value, j) => (cols[j].cast ? sql`${value}${sql.raw(`::${cols[j].cast}`)}` : sql`${value}`)),
          sql`, `,
        )})`,
    );
    await query(tx, sql`insert into ${sql.raw(table)} (${names}) values ${sql.join(tuples, sql`, `)} ${sql.raw(onConflict)}`);
  }
}

export interface IssueInput {
  entidad: string;
  registroId?: string | null;
  legacyId?: string | number | null;
  codigo: string;
  detalle?: string | null;
  rechazado?: boolean;
  datos?: unknown;
}

/** Acumula las observaciones y rechazos de una corrida y los guarda juntos al final de cada bloque. */
export class IssueSink {
  private items: IssueInput[] = [];
  readonly counts = new Map<string, number>();

  add(issue: IssueInput): void {
    this.items.push(issue);
    const key = `${issue.entidad}|${issue.rechazado ? 'RECHAZADO' : 'OBSERVADO'}|${issue.codigo}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  addObservations(entidad: string, registroId: string | null, legacyId: string | number | null, obs: Observation[]): void {
    for (const o of obs) this.add({ entidad, registroId, legacyId, codigo: o.code, detalle: o.detail ?? null });
  }

  get pending(): number {
    return this.items.length;
  }

  async flush(tx: Db, companyId: string, runId: string): Promise<void> {
    const rows = this.items.map((x) => [
      companyId,
      runId,
      x.entidad,
      x.registroId ?? null,
      x.legacyId === null || x.legacyId === undefined ? null : String(x.legacyId),
      x.codigo,
      x.detalle ?? null,
      x.rechazado ?? false,
      x.datos === undefined ? null : JSON.stringify(x.datos),
    ]);
    this.items = [];
    await insertMany(
      tx,
      'import_issues',
      [
        { name: 'company_id' },
        { name: 'run_id' },
        { name: 'entidad' },
        { name: 'registro_id', cast: 'uuid' },
        { name: 'legacy_id' },
        { name: 'codigo' },
        { name: 'detalle' },
        { name: 'rechazado' },
        { name: 'datos', cast: 'jsonb' },
      ],
      rows,
    );
  }
}
