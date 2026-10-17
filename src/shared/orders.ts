/**
 * @file shared/orders.ts
 * @description Reglas de pedidos de materiales y recepciones parciales. Reemplazan la
 * regla del Access (ANULADO=No AND PEDIDO CIVCCCSA=No AND RECIB=No AND RECIB B=No)
 * por un cálculo por renglón: pendiente = pedido − Σ recibido.
 */

export type LineStatus = 'PENDIENTE' | 'PARCIAL' | 'RECIBIDO';
export type OrderStatus = 'ANULADO' | 'COMPRA_CENTRAL' | 'RECIBIDO' | 'PARCIAL' | 'PENDIENTE';

/** Redondeo a 3 decimales: las cantidades de repuestos y lubricantes admiten fracciones. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Cantidad todavía no recibida de un renglón. Nunca negativa. */
export function pendingQuantity(cantidad: number, recibida: number): number {
  return Math.max(0, round3(cantidad - recibida));
}

export function lineStatus(cantidad: number, recibida: number): LineStatus {
  if (recibida <= 0) return 'PENDIENTE';
  return pendingQuantity(cantidad, recibida) === 0 ? 'RECIBIDO' : 'PARCIAL';
}

/** Suma las cantidades recibidas por renglón a partir de todas las recepciones del pedido. */
export function receivedByLine(
  receptions: { lines: { orderLineId: string; cantidad: number }[] }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const reception of receptions) {
    for (const line of reception.lines) {
      totals.set(line.orderLineId, round3((totals.get(line.orderLineId) ?? 0) + line.cantidad));
    }
  }
  return totals;
}

/**
 * Estado del pedido completo. La compra central y la anulación ganan sobre las recepciones,
 * como las casillas ANULADO y PEDIDO CIVCCCSA del Access.
 */
export function orderStatus(
  order: { anulado: boolean; compraCentral: boolean },
  lines: { cantidad: number; recibida: number }[],
): OrderStatus {
  if (order.anulado) return 'ANULADO';
  if (order.compraCentral) return 'COMPRA_CENTRAL';
  if (lines.length > 0 && lines.every((l) => lineStatus(l.cantidad, l.recibida) === 'RECIBIDO')) {
    return 'RECIBIDO';
  }
  if (lines.some((l) => l.recibida > 0)) return 'PARCIAL';
  return 'PENDIENTE';
}

/** Días desde la fecha del pedido hasta hoy. Fechas en formato YYYY-MM-DD. */
export function daysPending(fecha: string, hoy: string): number {
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export interface OrderLineDraft {
  cantidad: number;
  descripcion: string;
}

/** Errores de un pedido antes de guardarlo. Lista vacía = válido. */
export function validateOrderDraft(lines: OrderLineDraft[]): string[] {
  const errors: string[] = [];
  if (lines.length === 0) {
    errors.push('El pedido debe tener al menos un renglón.');
  }
  lines.forEach((line, i) => {
    if (!line.descripcion || line.descripcion.trim().length === 0) {
      errors.push(`El renglón ${i + 1} no tiene descripción.`);
    }
    if (!Number.isFinite(line.cantidad) || line.cantidad <= 0) {
      errors.push(`La cantidad del renglón ${i + 1} debe ser mayor a 0.`);
    }
  });
  return errors;
}

export interface ReceptionLineDraft {
  orderLineId: string;
  cantidad: number;
}

/**
 * Errores de una recepción. Un renglón no puede recibir más de lo pendiente: el Access
 * permitía marcar "recibido" sin cantidad, y acá la cantidad es la que cuenta.
 */
export function validateReceptionDraft(
  lines: ReceptionLineDraft[],
  pendingByLine: Map<string, number>,
): string[] {
  const errors: string[] = [];
  if (lines.length === 0) {
    errors.push('La recepción debe incluir al menos un renglón.');
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.orderLineId)) {
      errors.push('Un renglón aparece dos veces en la misma recepción.');
      continue;
    }
    seen.add(line.orderLineId);
    if (!Number.isFinite(line.cantidad) || line.cantidad <= 0) {
      errors.push('Las cantidades recibidas deben ser mayores a 0.');
      continue;
    }
    const pending = pendingByLine.get(line.orderLineId);
    if (pending === undefined) {
      errors.push('Un renglón recibido no pertenece a este pedido.');
    } else if (line.cantidad > pending) {
      errors.push(`No se puede recibir ${line.cantidad}: solo quedan ${pending} pendientes.`);
    }
  }
  return errors;
}
