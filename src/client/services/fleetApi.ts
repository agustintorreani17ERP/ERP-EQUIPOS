/**
 * @file services/fleetApi.ts
 * @description Flota: máquinas, categorías, lecturas y vencimientos contra la API.
 */

import type { ComplianceStatus, MachineStatus, MeterUnit, ReadingSource } from '../../shared/fleet';
import { apiFetch } from './http';

export interface FleetMachine {
  id: string;
  codigo: string;
  descripcion: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  chapa: string | null;
  status: MachineStatus;
  meterUnit: MeterUnit;
  esMaquina: boolean;
  llevaMantenimiento: boolean;
  monitoreoSatelital: boolean;
  /** Cargada por una importación con datos dudosos. */
  observado?: boolean;
  worksite: { id: string; nombre: string } | null;
  category: { id: string; nombre: string } | null;
  lecturaActual: { valor: number; fecha: string } | null;
  dinatran: { vence: string | null; estado: ComplianceStatus };
  habilitacionMunicipal: { vence: string | null; estado: ComplianceStatus };
  filters: { tipo: string; referencia: string | null; cantidad: number | null }[];
  fluids: { punto: string; producto: string | null; capacidadLitros: number | null }[];
  observaciones: string | null;
  fechaIngreso: string | null;
  paradaDesde: string | null;
}

export interface MachineDraft {
  codigo: string;
  descripcion: string;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  procedencia?: string | null;
  tipoMotor?: string | null;
  hp?: number | null;
  numeroMotor?: string | null;
  numeroSerie?: string | null;
  chapa?: string | null;
  color?: string | null;
  fechaIngreso?: string | null;
  worksiteId?: string | null;
  categoryId?: string | null;
  meterUnit: MeterUnit;
  status: MachineStatus;
  paradaDesde?: string | null;
  esMaquina: boolean;
  llevaMantenimiento: boolean;
  monitoreoSatelital: boolean;
  dinatran: boolean;
  dinatranVence?: string | null;
  habilitacionMunicipalVence?: string | null;
  observaciones?: string | null;
  filters: { tipo: string; referencia?: string | null; cantidad?: number | null }[];
  fluids: { punto: string; producto?: string | null; capacidadLitros?: number | null }[];
}

export interface MachineFilters {
  q?: string;
  obra?: string;
  categoria?: string;
  estado?: MachineStatus;
  mantenimiento?: boolean;
  monitoreo?: boolean;
  conChapa?: boolean;
  incluirNoMaquinas?: boolean;
  incluirBaja?: boolean;
  observadas?: boolean;
}

export interface Reading {
  id: string;
  fecha: string;
  valor: number;
  unidad: MeterUnit;
  fuente: ReadingSource;
  correccion: boolean;
  motivo: string | null;
  parteId: string | null;
  diferencial?: number;
  /** Lectura importada que baja respecto de la anterior: no cuenta como referencia. */
  observado?: boolean;
}

export interface CategoryRef {
  id: string;
  nombre: string;
}

export interface DueItem {
  maquina: { id: string; codigo: string; descripcion: string };
  tipo: 'DINATRAN' | 'HABILITACION_MUNICIPAL';
  vence: string;
  estado: ComplianceStatus;
}

function toQuery(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== false);
  const normalized = entries.map(([k, v]) => [k, v === true ? 'true' : String(v)] as [string, string]);
  return normalized.length === 0 ? '' : `?${new URLSearchParams(normalized).toString()}`;
}

export const fleetApi = {
  list: (filters: MachineFilters = {}) => apiFetch<FleetMachine[]>(`/api/maquinas${toQuery(filters)}`),
  get: (id: string) => apiFetch<FleetMachine>(`/api/maquinas/${id}`),
  create: (draft: MachineDraft) => apiFetch<FleetMachine>('/api/maquinas', { method: 'POST', body: draft }),
  update: (id: string, draft: MachineDraft) => apiFetch<FleetMachine>(`/api/maquinas/${id}`, { method: 'PUT', body: draft }),
  readings: (id: string) => apiFetch<Reading[]>(`/api/maquinas/${id}/lecturas`),
  addReading: (id: string, body: { fecha: string; valor: number; correccion?: boolean; motivo?: string | null }) =>
    apiFetch<Reading>(`/api/maquinas/${id}/lecturas`, { method: 'POST', body }),
  categories: () => apiFetch<CategoryRef[]>('/api/categorias-maquina'),
  addCategory: (nombre: string) => apiFetch<CategoryRef>('/api/categorias-maquina', { method: 'POST', body: { nombre } }),
  loadDefaultCategories: () => apiFetch<{ cargadas: number }>('/api/categorias-maquina/predeterminadas', { method: 'POST' }),
  dueItems: (dias = 60) => apiFetch<{ hoy: string; dias: number; items: DueItem[] }>(`/api/informes/vencimientos?dias=${dias}`),
  fleetByStatus: () => apiFetch<{ agrupar: string; grupos: { clave: string; cantidad: number; conLectura: number; codigos: string[] }[] }>(
    '/api/informes/flota?agrupar=estado',
  ),
};

