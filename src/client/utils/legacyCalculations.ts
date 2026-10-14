/**
 * @file utils/legacyCalculations.ts
 * @description Migración de la lógica de negocio extraída de módulos (.bas),
 * clases (.cls) y procedimientos AfterUpdate/Click de Microsoft Access VBA.
 */

import { FundRequest, MaterialOrder, OrderItem, TotalizerReading } from '../types/erp';

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
 * Calcula el total de línea en Form_EDITAR ART CON CALCULO
 * Cantidad * Precio Unitario
 */
export function calculateOrderItemTotal(quantity: number, unitPrice: number): number {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  const price = Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0;
  return Math.round(qty * price * 100) / 100;
}

/**
 * Recalcula subtotales, IVA y total de una orden de materiales completa.
 */
export function calculateOrderTotals(items: OrderItem[], taxRate: number = 0.21): {
  subtotal: number;
  impuestos: number;
  total: number;
} {
  const subtotal = items.reduce((acc, item) => {
    const itemTotal = item.totalCalculado || calculateOrderItemTotal(item.cantidadPedida, item.precioUnitario);
    return acc + itemTotal;
  }, 0);

  const impuestos = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + impuestos) * 100) / 100;

  return { subtotal, impuestos, total };
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

/**
 * Evaluación de estado de mantenimiento preventivo (1000 HS o 2000 HS).
 * Identifica cuándo una máquina superó o está cerca de su ciclo de servicio.
 */
export function evaluateMaintenanceDue(
  currentHours: number,
  lastServiceHours: number,
  intervalHours: 1000 | 2000
): {
  hoursSinceLastService: number;
  hoursRemaining: number;
  isOverdue: boolean;
  isWarning: boolean;
  statusText: string;
} {
  const hoursSince = Math.max(0, currentHours - lastServiceHours);
  const remaining = intervalHours - hoursSince;
  const isOverdue = remaining <= 0;
  const isWarning = !isOverdue && remaining <= 100;

  let statusText = 'Normal';
  if (isOverdue) {
    statusText = `¡Vencido por ${Math.abs(remaining).toFixed(1)} hs!`;
  } else if (isWarning) {
    statusText = `Próximo a vencer (${remaining.toFixed(1)} hs)`;
  } else {
    statusText = `Vigente (${remaining.toFixed(1)} hs restantes)`;
  }

  return {
    hoursSinceLastService: hoursSince,
    hoursRemaining: remaining,
    isOverdue,
    isWarning,
    statusText,
  };
}

/**
 * Validaciones operativas para Solicitudes de Fondos (Form_SFONDOS)
 */
export function validateFundRequest(data: Partial<FundRequest>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data.proveedor || data.proveedor.trim().length === 0) {
    errors.push('El proveedor es obligatorio.');
  }

  if (data.monto === undefined || data.monto === null || data.monto <= 0) {
    errors.push('El monto solicitado debe ser mayor a 0.');
  }

  if (!data.concepto || data.concepto.trim().length < 3) {
    errors.push('Debe especificar un concepto o justificación de gasto.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Formateo de moneda local para reportes y controles financieros.
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
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
