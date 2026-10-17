/**
 * @file services/importApi.ts
 * @description Carga de planillas (proveedores, obras, máquinas, lecturas) e historial de cargas.
 */

import type { SheetKind } from '../../shared/import/sheet';
import { apiFetch } from './http';

export interface ImportResult {
  creados?: number;
  actualizados?: number;
  cargadas?: number;
}

export interface ImportRun {
  id: string;
  origen: 'ACCESS' | 'EXCEL';
  archivo: string | null;
  tipo: string;
  estado: string;
  leidas: number;
  cargadas: number;
  observadas: number;
  rechazadas: number;
  usuario: string | null;
  fecha: string;
}

export const importApi = {
  /** Envía las filas ya convertidas. Todo o nada: si una fila no es válida, la API responde 422 con los errores por fila. */
  upload: (kind: SheetKind, filas: Record<string, unknown>[], archivo: string) =>
    apiFetch<ImportResult>(`/api/importar/${kind}`, { method: 'POST', body: { filas, archivo } }),
  runs: () => apiFetch<ImportRun[]>('/api/importar/corridas'),
};
