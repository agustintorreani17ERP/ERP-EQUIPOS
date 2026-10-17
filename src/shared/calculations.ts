/**
 * @file utils/legacyCalculations.ts
 * @description Migración de la lógica de negocio extraída de módulos (.bas),
 * clases (.cls) y procedimientos AfterUpdate/Click de Microsoft Access VBA.
 */

import { TotalizerReading } from './erp';

/**
 * Migración directa de Form_A -> TOTALIZADOR_AfterUpdate():
 *
 * If Nz(DLast("horas")) = 0 Then
 *   DifK = 0
 * Else
 *   DifK = HORAS - Nz(DLast("horas"))
 * End If
 *
 * @param currentHours Valor del control HORAS (horómetro actual)
 * @param lastHours Valor devuelto por DLast("horas") para la máquina
 * @returns Diferencial de horas/km (DifK)
 */
export function calculateHourDifference(
  currentHours: number,
  lastHours: number | null | undefined
): number {
  const safeLast = lastHours ?? 0;
  if (safeLast === 0) {
    return 0;
  }
  // Cálculo exacto preservando la regla operativa
  const diff = currentHours - safeLast;
  return Number.isFinite(diff) ? Math.max(0, diff) : 0;
}

/**
 * Reemplazo tipado para las rutinas de búsqueda con Recordset.Clone de Access:
 *
 * Set rs = Me.Recordset.Clone
 * rs.FindFirst "[FIELD] = '" & Me![Combo] & "'"
 * If Not rs.EOF Then Me.Bookmark = rs.Bookmark
 */
export function findRecordMatch<T>(
  records: T[],
  field: keyof T,
  searchValue: string | number
): T | undefined {
  if (searchValue === '' || searchValue === null || searchValue === undefined) {
    return undefined;
  }

  const normalizedSearch = String(searchValue).trim().toLowerCase();
  return records.find((rec) => {
    const val = rec[field];
    if (val === undefined || val === null) return false;
    return String(val).trim().toLowerCase() === normalizedSearch;
  });
}

/** Decimales por moneda: el guaraní no usa centavos. Cualquier otra moneda usa dos. */
const CURRENCY_DECIMALS: Record<string, number> = { PYG: 0 };

/**
 * Formateo de montos para reportes y controles financieros. La moneda viene de
 * company_settings (por defecto PYG, como en el Access original).
 */
export function formatCurrency(amount: number, currency: string = 'PYG'): string {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  return new Intl.NumberFormat('es-PY', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount || 0);
}

/**
 * Formateo de horas de máquina con precisión de un decimal.
 */
export function formatHours(hours: number): string {
  return `${(hours || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} hs`;
}
