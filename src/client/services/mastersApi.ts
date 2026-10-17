/**
 * @file services/mastersApi.ts
 * @description Maestros (obras, proveedores, máquinas) y configuración de la empresa.
 */

import type { CompanySettings } from '../../shared/erp';
import { apiFetch } from './http';

export interface Worksite {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
}

export interface Supplier {
  id: string;
  codigo: string;
  nombre: string;
  ruc: string | null;
}

export interface MachineRef {
  id: string;
  codigo: string;
  descripcion: string;
  worksite: { id: string; nombre: string } | null;
  llevaMantenimiento: boolean;
  status: 'ACTIVA' | 'PARADA' | 'EN_DESUSO' | 'BAJA';
}

const withQuery = (path: string, q?: string) => (q ? `${path}?q=${encodeURIComponent(q)}` : path);

export const mastersApi = {
  worksites: (q?: string) => apiFetch<Worksite[]>(withQuery('/api/obras', q)),
  createWorksite: (body: { codigo: string; nombre: string }) =>
    apiFetch<Worksite>('/api/obras', { method: 'POST', body }),
  suppliers: (q?: string) => apiFetch<Supplier[]>(withQuery('/api/proveedores', q)),
  createSupplier: (body: { codigo: string; nombre: string; ruc?: string | null }) =>
    apiFetch<Supplier>('/api/proveedores', { method: 'POST', body }),
  updateSupplier: (id: string, body: { codigo: string; nombre: string; ruc?: string | null }) =>
    apiFetch<Supplier>(`/api/proveedores/${id}`, { method: 'PUT', body }),
  machines: (q?: string) => apiFetch<MachineRef[]>(withQuery('/api/maquinas', q)),
  settings: () => apiFetch<CompanySettings>('/api/configuracion'),
  saveSettings: (body: CompanySettings) => apiFetch<CompanySettings>('/api/configuracion', { method: 'PUT', body }),
};
