/**
 * @file services/fuelApi.ts
 * @description Combustibles y lubricantes: productos, depósitos, vales e informes contra la API.
 */

import type {
  ConsumptionLine,
  FuelDepositDto,
  FuelDepositType,
  FuelMovementDto,
  FuelMovementResult,
  FuelMovementType,
  FuelProductDto,
} from '../../shared/fuel';
import { apiFetch } from './http';

export interface ProductDraft {
  codigo: string;
  nombre: string;
  unidad: FuelProductDto['unidad'];
  categoria: FuelProductDto['categoria'];
  activo: boolean;
}

export interface DepositDraft {
  codigo: string;
  nombre: string;
  tipo: FuelDepositType;
  worksiteId?: string | null;
  machineId?: string | null;
  activo: boolean;
}

export interface MovementDraft {
  tipo: FuelMovementType;
  fecha: string;
  depositId: string;
  machineId?: string | null;
  terceroChapa?: string | null;
  proveidoA?: string | null;
  descripcion?: string | null;
  remision?: string | null;
  supplierId?: string | null;
  lectura?: number | null;
  motivo?: string | null;
  lines: { productId: string; cantidad: number }[];
}

export interface MovementFilters {
  desde?: string;
  hasta?: string;
  deposito?: string;
  maquina?: string;
  chapa?: string;
  producto?: string;
  tipo?: FuelMovementType;
  q?: string;
  incluirAnulados?: boolean;
}

export interface PeriodFilters {
  desde?: string;
  hasta?: string;
  deposito?: string;
  producto?: string;
  maquina?: string;
}

export interface BalanceRow {
  deposito: { id: string; codigo: string; nombre: string };
  producto: { id: string; codigo: string; nombre: string; unidad: string };
  saldoInicial: number;
  entradas: number;
  salidas: number;
  ajustes: number;
  saldoFinal: number;
  negativo: boolean;
}

export interface ConsumptionRow {
  maquina: { id: string; codigo: string; descripcion: string; meterUnit: 'HS' | 'KM' };
  unidad: 'L/H' | 'L/100KM';
  cargas: number;
  litros: number;
  sinLectura: number;
  observadas: number;
  atipicas: number;
  recorrido: number;
  consumo: number | null;
  detalle: ConsumptionLine[];
}

export interface ThirdPartyRow {
  chapa: string;
  cargas: number;
  litros: number;
  despachos: FuelMovementDto[];
}

export interface DepositUsageRow {
  deposito: { codigo: string; nombre: string };
  mes: string;
  producto: { codigo: string; nombre: string; unidad: string };
  cantidad: number;
  vales: number;
}

function toQuery(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== false);
  const normalized = entries.map(([k, v]) => [k, v === true ? 'true' : String(v)] as [string, string]);
  return normalized.length === 0 ? '' : `?${new URLSearchParams(normalized).toString()}`;
}

export const fuelApi = {
  products: () => apiFetch<FuelProductDto[]>('/api/combustible/productos'),
  createProduct: (draft: ProductDraft) => apiFetch<FuelProductDto>('/api/combustible/productos', { method: 'POST', body: draft }),
  updateProduct: (id: string, draft: ProductDraft) => apiFetch<FuelProductDto>(`/api/combustible/productos/${id}`, { method: 'PUT', body: draft }),
  loadDefaultProducts: () => apiFetch<{ cargados: number }>('/api/combustible/productos/predeterminados', { method: 'POST' }),

  deposits: () => apiFetch<FuelDepositDto[]>('/api/combustible/depositos'),
  createDeposit: (draft: DepositDraft) => apiFetch<FuelDepositDto>('/api/combustible/depositos', { method: 'POST', body: draft }),
  updateDeposit: (id: string, draft: DepositDraft) => apiFetch<FuelDepositDto>(`/api/combustible/depositos/${id}`, { method: 'PUT', body: draft }),

  movements: (filters: MovementFilters = {}) => apiFetch<FuelMovementDto[]>(`/api/combustible/movimientos${toQuery(filters)}`),
  createMovement: (draft: MovementDraft) => apiFetch<FuelMovementResult>('/api/combustible/movimientos', { method: 'POST', body: draft }),
  createBatch: (movimientos: MovementDraft[]) => apiFetch<FuelMovementResult[]>('/api/combustible/movimientos/lote', { method: 'POST', body: { movimientos } }),
  annul: (id: string, motivo: string) => apiFetch<FuelMovementResult>(`/api/combustible/movimientos/${id}/anular`, { method: 'POST', body: { motivo } }),
  fixReading: (id: string, body: { valor: number; correccion?: boolean; motivo?: string | null }) =>
    apiFetch<FuelMovementDto>(`/api/combustible/movimientos/${id}/lectura`, { method: 'POST', body }),

  balances: (filters: PeriodFilters = {}) => apiFetch<{ desde: string; hasta: string; filas: BalanceRow[] }>(`/api/informes/combustible-saldos${toQuery(filters)}`),
  consumption: (filters: PeriodFilters = {}) => apiFetch<{ desde: string; hasta: string; maquinas: ConsumptionRow[] }>(`/api/informes/combustible-consumo${toQuery(filters)}`),
  thirdParties: (filters: PeriodFilters = {}) => apiFetch<{ desde: string; hasta: string; terceros: ThirdPartyRow[] }>(`/api/informes/combustible-terceros${toQuery(filters)}`),
  byDeposit: (filters: PeriodFilters = {}) => apiFetch<{ desde: string; hasta: string; filas: DepositUsageRow[] }>(`/api/informes/combustible-depositos${toQuery(filters)}`),
};
