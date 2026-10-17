/**
 * @file server/import/access.ts
 * @description Lectura del back-end del Access con mdb-reader (JavaScript puro, solo lectura, sin
 * Access ni COM). Siempre se trabaja sobre una COPIA del archivo: nunca sobre el original.
 */

import { readFileSync } from 'node:fs';
import MDBReader from 'mdb-reader';
import type { AccessRow } from '../../shared/import/fleet';

/** Origen de datos de una importación. Los tests lo reemplazan con tablas en memoria. */
export interface TableSource {
  /** Filas de la tabla; vacío si no existe (así una copia parcial no corta la importación). */
  table(name: string): AccessRow[];
  hasTable(name: string): boolean;
}

export function openAccess(path: string): TableSource {
  const reader = new MDBReader(readFileSync(path));
  const names = new Set(reader.getTableNames());
  return {
    hasTable: (name) => names.has(name),
    table: (name) => (names.has(name) ? (reader.getTable(name).getData() as AccessRow[]) : []),
  };
}

/** Fuente en memoria, para pruebas y ensayos con datos sintéticos. */
export function memorySource(tables: Record<string, AccessRow[]>): TableSource {
  return {
    hasTable: (name) => name in tables,
    table: (name) => tables[name] ?? [],
  };
}
