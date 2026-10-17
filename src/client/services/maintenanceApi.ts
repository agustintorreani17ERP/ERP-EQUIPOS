/**
 * @file services/maintenanceApi.ts
 * @description Mantenimiento: tipos de servicio, planes, programa, órdenes e informe de cumplimiento.
 */

import type {
  ComplianceRowDto,
  MaintenancePlanDto,
  ProgramRowDto,
  ProgramStatus,
  ServiceOrderDto,
  ServiceOrderState,
  ServiceTask,
  ServiceTypeDto,
  ServiceUnit,
} from '../../shared/maintenance';
import { apiFetch } from './http';

export interface TypeDraft {
  nombre: string;
  valor: number;
  unidad: ServiceUnit;
  tareas: ServiceTask[];
}

export interface PlanDraft {
  intervalo: number;
  ciclo: string[];
  proximoIndice: number;
  proximoHoras: number;
  avisoPct: number;
  activo: boolean;
}

export interface CompletionDraft {
  fecha: string;
  horasReal: number;
  correccion?: boolean;
  motivo?: string | null;
  fechaDevuelta?: string | null;
}

export interface EmitDraft {
  machineId: string;
  fechaEmision: string;
  tipoCodigo?: string | null;
  worksiteId?: string | null;
  horasIdeal?: number | null;
  generarPedido: boolean;
  observaciones?: string | null;
  realizado?: CompletionDraft;
}

export interface ProgramFilters {
  obra?: string;
  estado?: ProgramStatus;
  q?: string;
}

export interface OrderFilters {
  estado?: ServiceOrderState;
  maquina?: string;
  obra?: string;
  desde?: string;
  hasta?: string;
}

function toQuery(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null);
  return entries.length === 0 ? '' : `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)] as [string, string])).toString()}`;
}

export const maintenanceApi = {
  types: () => apiFetch<ServiceTypeDto[]>('/api/mantenimiento/tipos'),
  createType: (draft: TypeDraft) => apiFetch<ServiceTypeDto>('/api/mantenimiento/tipos', { method: 'POST', body: draft }),
  updateType: (id: string, draft: { nombre: string; tareas: ServiceTask[]; activo: boolean }) =>
    apiFetch<ServiceTypeDto>(`/api/mantenimiento/tipos/${id}`, { method: 'PUT', body: draft }),
  loadDefaultTypes: () => apiFetch<ServiceTypeDto[]>('/api/mantenimiento/tipos/predeterminados', { method: 'POST' }),

  plans: () => apiFetch<MaintenancePlanDto[]>('/api/mantenimiento/planes'),
  savePlan: (machineId: string, draft: PlanDraft) => apiFetch<MaintenancePlanDto>(`/api/mantenimiento/planes/${machineId}`, { method: 'PUT', body: draft }),

  program: (filters: ProgramFilters = {}) => apiFetch<ProgramRowDto[]>(`/api/mantenimiento/programa${toQuery(filters)}`),

  orders: (filters: OrderFilters = {}) => apiFetch<ServiceOrderDto[]>(`/api/mantenimiento/ordenes${toQuery(filters)}`),
  emit: (draft: EmitDraft) => apiFetch<ServiceOrderDto>('/api/mantenimiento/ordenes', { method: 'POST', body: draft }),
  complete: (id: string, draft: CompletionDraft) => apiFetch<ServiceOrderDto>(`/api/mantenimiento/ordenes/${id}/realizar`, { method: 'POST', body: draft }),
  cancel: (id: string, motivo: string) => apiFetch<ServiceOrderDto>(`/api/mantenimiento/ordenes/${id}/anular`, { method: 'POST', body: { motivo } }),

  compliance: (filters: { obra?: string; desde?: string; hasta?: string } = {}) =>
    apiFetch<ComplianceRowDto[]>(`/api/informes/mantenimiento-cumplimiento${toQuery(filters)}`),
};
