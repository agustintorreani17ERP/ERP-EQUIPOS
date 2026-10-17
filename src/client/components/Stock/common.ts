/**
 * @file components/Stock/common.ts
 * @description Tipos y constantes compartidos por las pestañas de Stock.
 */

import type { CompanySettings } from '../../../shared/erp';
import type { ArticleDto, ArticleUnit, StockMovementType } from '../../../shared/stock';
import type { FleetMachine } from '../../services/fleetApi';
import type { Supplier, Worksite } from '../../services/mastersApi';

export interface StockRefs {
  articles: ArticleDto[];
  machines: FleetMachine[];
  worksites: Worksite[];
  suppliers: Supplier[];
  settings: CompanySettings;
}

export const TYPE_TONE: Record<StockMovementType, 'warn' | 'good' | 'info' | 'violet'> = {
  SALIDA: 'warn',
  ENTRADA: 'good',
  SALDO_INICIAL: 'info',
  AJUSTE: 'violet',
};

export const UNIT_LABEL: Record<ArticleUnit, string> = { U: 'u', L: 'L', KG: 'kg', M: 'm', JUEGO: 'juego' };

/** Normaliza un texto de planilla a un número, o null si está vacío o no es numérico. */
export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(String(value).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
