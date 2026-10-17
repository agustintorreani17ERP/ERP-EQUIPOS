/**
 * @file services/stockApi.ts
 * @description Stock de repuestos: artículos, vales e informes contra la API.
 */

import type {
  ArticleBatchResult,
  ArticleDto,
  ArticleEquivalent,
  ArticleMatchDto,
  ArticleRubro,
  ArticleUnit,
  ConsumptionRow,
  KardexReport,
  StockExistencesReport,
  StockMovementDto,
  StockMovementResult,
  StockMovementType,
} from '../../shared/stock';
import { apiFetch } from './http';

export interface ArticleDraft {
  codigo: string;
  descripcion: string;
  rubro: ArticleRubro;
  unidad: ArticleUnit;
  stockMinimo: number;
  ubicacion?: string | null;
  equivalencias: ArticleEquivalent[];
  aplicacion?: string | null;
  activo: boolean;
}

export interface ArticleBatchItem extends Partial<Omit<ArticleDraft, 'codigo' | 'descripcion'>> {
  codigo: string;
  descripcion: string;
  saldoInicial?: { cantidad: number; costoUnitario: number } | null;
}

export interface ArticleFilters {
  q?: string;
  rubro?: ArticleRubro;
  bajoMinimo?: boolean;
  conSaldo?: boolean;
  activo?: boolean;
}

export interface StockMovementDraft {
  tipo: StockMovementType;
  fecha: string;
  machineId?: string | null;
  worksiteId?: string | null;
  serviceOrderId?: string | null;
  supplierId?: string | null;
  remision?: string | null;
  motivo?: string | null;
  observaciones?: string | null;
  lines: { articleId: string; cantidad: number; costoUnitario?: number | null }[];
}

export interface StockMovementFilters {
  desde?: string;
  hasta?: string;
  tipo?: StockMovementType;
  articulo?: string;
  maquina?: string;
  obra?: string;
  q?: string;
  incluirAnulados?: boolean;
}

export interface ConsumptionFilters {
  desde?: string;
  hasta?: string;
  maquina?: string;
  obra?: string;
  articulo?: string;
  rubro?: ArticleRubro;
}

function toQuery(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== false);
  const normalized = entries.map(([k, v]) => [k, v === true ? 'true' : String(v)] as [string, string]);
  return normalized.length === 0 ? '' : `?${new URLSearchParams(normalized).toString()}`;
}

export const stockApi = {
  articles: (filters: ArticleFilters = {}) => apiFetch<ArticleDto[]>(`/api/stock/articulos${toQuery(filters)}`),
  createArticle: (draft: ArticleDraft) => apiFetch<ArticleDto>('/api/stock/articulos', { method: 'POST', body: draft }),
  updateArticle: (id: string, draft: ArticleDraft) => apiFetch<ArticleDto>(`/api/stock/articulos/${id}`, { method: 'PUT', body: draft }),
  matchArticles: (codigos: string[]) => apiFetch<ArticleMatchDto[]>('/api/stock/articulos/coincidencias', { method: 'POST', body: { codigos } }),
  importArticles: (articulos: ArticleBatchItem[], fecha?: string) =>
    apiFetch<ArticleBatchResult>('/api/stock/articulos/lote', { method: 'POST', body: { articulos, fecha } }),

  movements: (filters: StockMovementFilters = {}) => apiFetch<StockMovementDto[]>(`/api/stock/movimientos${toQuery(filters)}`),
  createMovement: (draft: StockMovementDraft) => apiFetch<StockMovementResult>('/api/stock/movimientos', { method: 'POST', body: draft }),
  annul: (id: string, motivo: string) => apiFetch<StockMovementDto>(`/api/stock/movimientos/${id}/anular`, { method: 'POST', body: { motivo } }),

  existences: (filters: ArticleFilters = {}) => apiFetch<StockExistencesReport>(`/api/informes/stock-existencias${toQuery(filters)}`),
  kardex: (filters: { articulo: string; desde?: string; hasta?: string }) => apiFetch<KardexReport>(`/api/informes/stock-kardex${toQuery(filters)}`),
  consumption: (filters: ConsumptionFilters = {}) =>
    apiFetch<{ totalValor: number; filas: ConsumptionRow[] }>(`/api/informes/stock-consumo${toQuery(filters)}`),
};
