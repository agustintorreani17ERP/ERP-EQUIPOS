/**
 * @file services/financeApi.ts
 * @description Solicitudes de fondos, pagos, caja chica e informes financieros contra la API.
 */

import type {
  AccountRef,
  CurrencyStatement,
  FundRequestDto,
  FundRequestStatus,
  PaymentDto,
  PettyCashSheetDto,
} from '../../shared/finance';
import { apiFetch } from './http';

export interface FundRequestDraft {
  fecha: string;
  supplierId: string;
  monto: number;
  currency: string;
  concepto: string;
  facturaORemision?: string | null;
  accountId?: string | null;
  machineId?: string | null;
  pedidoNumero?: number | null;
}

export interface FundRequestFilters {
  estado?: FundRequestStatus;
  proveedor?: string;
  desde?: string;
  hasta?: string;
  moneda?: string;
  maquina?: string;
  q?: string;
}

export interface PaymentDraft {
  fecha: string;
  monto: number;
  referencia?: string | null;
}

export interface SupplierPaymentDraft extends PaymentDraft {
  currency: string;
  fundRequestId?: string | null;
  pettyCashLineId?: string | null;
}

export interface LineDraft {
  fecha: string;
  supplierId: string;
  facturaORemision?: string | null;
  concepto?: string | null;
  monto: number;
  accountId?: string | null;
  machineId?: string | null;
  aCredito: boolean;
}

export type CurrencyTotals = Record<string, { monto: number; pagado: number; saldo: number }>;

export interface FundReport {
  agrupar: 'proveedor' | 'estado' | 'mes';
  totales: CurrencyTotals;
  grupos: { clave: string; cantidad: number; totales: CurrencyTotals; filas: FundRequestDto[] }[];
}

export interface StatementReport {
  supplier: { id: string; codigo: string; nombre: string; ruc: string | null };
  desde: string;
  hasta: string;
  monedas: CurrencyStatement[];
}

export interface DebtReport {
  hoy: string;
  totales: Record<string, number>;
  items: { supplier: { id: string; codigo: string; nombre: string }; currency: string; saldo: number }[];
}

export interface MachineExpenseReport {
  resumen: { maquina: { id: string; codigo: string; descripcion: string } | null; currency: string; caja: number; sf: number; total: number }[];
  detalle: {
    fecha: string;
    origen: 'CAJA' | 'SF';
    documento: string;
    proveedor: string;
    cuenta: string | null;
    maquina: { id: string; codigo: string; descripcion: string } | null;
    monto: number;
    currency: string;
  }[];
}

function toQuery(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== false);
  const normalized = entries.map(([k, v]) => [k, v === true ? 'true' : String(v)] as [string, string]);
  return normalized.length === 0 ? '' : `?${new URLSearchParams(normalized).toString()}`;
}

export const financeApi = {
  accounts: () => apiFetch<(AccountRef)[]>('/api/cuentas-gasto'),
  loadDefaultAccounts: () => apiFetch<{ cargadas: number }>('/api/cuentas-gasto/predeterminadas', { method: 'POST' }),

  fundRequests: (filters: FundRequestFilters = {}) => apiFetch<FundRequestDto[]>(`/api/solicitudes-fondos${toQuery(filters)}`),
  fundRequest: (id: string) => apiFetch<FundRequestDto>(`/api/solicitudes-fondos/${id}`),
  createFundRequest: (draft: FundRequestDraft) => apiFetch<FundRequestDto>('/api/solicitudes-fondos', { method: 'POST', body: draft }),
  updateFundRequest: (id: string, draft: FundRequestDraft) => apiFetch<FundRequestDto>(`/api/solicitudes-fondos/${id}`, { method: 'PUT', body: draft }),
  annulFundRequest: (id: string, motivo: string) => apiFetch<FundRequestDto>(`/api/solicitudes-fondos/${id}/anular`, { method: 'POST', body: { motivo } }),
  payFundRequest: (id: string, draft: PaymentDraft) => apiFetch<FundRequestDto>(`/api/solicitudes-fondos/${id}/pagos`, { method: 'POST', body: draft }),

  paySupplier: (supplierId: string, draft: SupplierPaymentDraft) => apiFetch<PaymentDto>(`/api/proveedores/${supplierId}/pagos`, { method: 'POST', body: draft }),
  annulPayment: (id: string) => apiFetch<PaymentDto>(`/api/pagos/${id}/anular`, { method: 'POST' }),

  sheets: (filters: { estado?: 'ABIERTA' | 'CERRADA'; desde?: string; hasta?: string } = {}) => apiFetch<PettyCashSheetDto[]>(`/api/caja-chica${toQuery(filters)}`),
  sheet: (id: string) => apiFetch<PettyCashSheetDto>(`/api/caja-chica/${id}`),
  createSheet: (observaciones?: string) => apiFetch<PettyCashSheetDto>('/api/caja-chica', { method: 'POST', body: { observaciones: observaciones ?? null } }),
  addLines: (sheetId: string, lineas: LineDraft[]) => apiFetch<PettyCashSheetDto>(`/api/caja-chica/${sheetId}/lineas/lote`, { method: 'POST', body: { lineas } }),
  deleteLine: (sheetId: string, lineId: string) => apiFetch<PettyCashSheetDto>(`/api/caja-chica/${sheetId}/lineas/${lineId}`, { method: 'DELETE' }),
  closeSheet: (id: string) => apiFetch<PettyCashSheetDto>(`/api/caja-chica/${id}/cerrar`, { method: 'POST' }),
  replenish: (id: string, supplierId?: string) => apiFetch<FundRequestDto>(`/api/caja-chica/${id}/reponer`, { method: 'POST', body: supplierId ? { supplierId } : {} }),

  fundReport: (agrupar: FundReport['agrupar'], filters: FundRequestFilters = {}) =>
    apiFetch<FundReport>(`/api/informes/solicitudes-fondos${toQuery({ agrupar, ...filters })}`),
  statement: (proveedor: string, desde?: string, hasta?: string) =>
    apiFetch<StatementReport>(`/api/informes/estado-cuenta${toQuery({ proveedor, desde, hasta })}`),
  debt: () => apiFetch<DebtReport>('/api/informes/deuda-proveedores'),
  machineExpenses: (filters: { desde?: string; hasta?: string; maquina?: string; origen?: 'caja' | 'sf' | 'todos'; incluirSinMaquina?: boolean } = {}) =>
    apiFetch<MachineExpenseReport>(`/api/informes/gastos-maquina${toQuery(filters)}`),
};
