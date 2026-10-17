/**
 * @file services/ordersApi.ts
 * @description Pedidos de materiales, recepciones e informe de pendientes contra la API.
 */

import type { MaterialOrder, OrderRubro, PendingReport } from '../../shared/erp';
import type { OrderStatus } from '../../shared/orders';
import { apiFetch } from './http';

export interface OrderLineDraft {
  nroParte: string | null;
  descripcion: string;
  cantidad: number;
  machineId: string | null;
}

export interface OrderDraft {
  fecha: string;
  worksiteId: string | null;
  machineId: string | null;
  supplierId: string | null;
  pedidoDeObra: boolean;
  compraCentral: boolean;
  rubros: OrderRubro[];
  observaciones: string | null;
  lines: OrderLineDraft[];
}

export interface ReceptionDraft {
  fecha: string;
  supplierId: string | null;
  facturaORemision: string | null;
  observaciones: string | null;
  /** `stock` hace que la cantidad recibida entre al stock de ese artículo, al costo unitario indicado. */
  lines: { orderLineId: string; cantidad: number; stock?: { articleId: string; costoUnitario: number } | null }[];
}

export interface OrderFilters {
  estado?: OrderStatus;
  obra?: string;
  maquina?: string;
  rubro?: OrderRubro;
  desde?: string;
  hasta?: string;
  q?: string;
}

export interface PendingFilters {
  agrupar: 'obra' | 'maquina' | 'rubro' | 'fecha';
  obra?: string;
  maquina?: string;
  rubro?: OrderRubro;
  desde?: string;
  hasta?: string;
}

function toQuery(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null);
  return entries.length === 0 ? '' : `?${new URLSearchParams(entries as [string, string][]).toString()}`;
}

export const ordersApi = {
  list: (filters: OrderFilters = {}) => apiFetch<MaterialOrder[]>(`/api/pedidos${toQuery(filters)}`),
  get: (id: string) => apiFetch<MaterialOrder>(`/api/pedidos/${id}`),
  create: (draft: OrderDraft) => apiFetch<MaterialOrder>('/api/pedidos', { method: 'POST', body: draft }),
  update: (id: string, draft: OrderDraft) =>
    apiFetch<MaterialOrder>(`/api/pedidos/${id}`, { method: 'PUT', body: draft }),
  anular: (id: string) => apiFetch<MaterialOrder>(`/api/pedidos/${id}/anular`, { method: 'POST' }),
  receive: (id: string, draft: ReceptionDraft) =>
    apiFetch<MaterialOrder>(`/api/pedidos/${id}/recepciones`, { method: 'POST', body: draft }),
  pendingReport: (filters: PendingFilters) =>
    apiFetch<PendingReport>(`/api/informes/pedidos-pendientes${toQuery(filters)}`),
};
