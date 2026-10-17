/**
 * @file services/eventsApi.ts
 * @description Partes diarios de eventos y sus informes contra la API.
 */

import type { EventType } from '../../shared/fleet';
import { apiFetch } from './http';

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
  lectura: { id: string; valor: number; unidad: 'HS' | 'KM'; correccion: boolean; motivo: string | null } | null;
}

export interface EventDraft {
  fecha: string;
  machineId: string;
  descripcion: string;
  tipos: EventType[];
  worksiteId?: string | null;
  operador?: string | null;
  notaEnvio?: string | null;
  lectura?: { valor: number; correccion?: boolean; motivo?: string | null } | null;
}

export interface EventFilters {
  desde?: string;
  hasta?: string;
  maquina?: string;
  tipo?: EventType;
  q?: string;
  sinEnvioNiTraslado?: boolean;
  sinNotaDeEnvio?: boolean;
  incluirAnulados?: boolean;
}

export interface EventReportGroup {
  clave: string;
  partes: number;
  maquinas: number;
  filas: EventDto[];
}

function toQuery(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== false);
  const normalized = entries.map(([k, v]) => [k, v === true ? 'true' : String(v)] as [string, string]);
  return normalized.length === 0 ? '' : `?${new URLSearchParams(normalized).toString()}`;
}

export const eventsApi = {
  list: (filters: EventFilters = {}) => apiFetch<EventDto[]>(`/api/partes${toQuery(filters)}`),
  create: (draft: EventDraft) => apiFetch<EventDto>('/api/partes', { method: 'POST', body: draft }),
  createBatch: (partes: EventDraft[]) => apiFetch<EventDto[]>('/api/partes/lote', { method: 'POST', body: { partes } }),
  update: (id: string, draft: Omit<EventDraft, 'lectura'>) => apiFetch<EventDto>(`/api/partes/${id}`, { method: 'PUT', body: draft }),
  anular: (id: string) => apiFetch<EventDto>(`/api/partes/${id}/anular`, { method: 'POST' }),
  report: (agrupar: 'fecha' | 'maquina' | 'tipo', filters: { desde?: string; hasta?: string } = {}) =>
    apiFetch<{ agrupar: string; grupos: EventReportGroup[] }>(`/api/informes/partes${toQuery({ agrupar, ...filters })}`),
};
