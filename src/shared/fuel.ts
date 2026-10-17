/**
 * @file shared/fuel.ts
 * @description Reglas de combustibles y lubricantes. Reemplazan la tabla ancha ACGAS2012 del Access
 * (92 columnas: una de consumo y otra de entrada por producto) por vales con renglones, con:
 * - saldos por depósito y producto calculados de los movimientos (en el Access solo existían en
 *   los informes, como `Sum(ENTRADA) - Sum(GASOIL)`),
 * - consumo derivado de las lecturas de horómetro (en el Access se tipeaban `HS RECORRIDO` y
 *   `KMS RECORRIDO`, y la fórmula no protegía la división por cero).
 * Puro: sin acceso a base de datos, testeable y compartido por cliente y servidor.
 */

import { dayDiff } from './fleet';
import { isValidDocumentDate } from './finance';

export type FuelMovementType = 'DESPACHO' | 'ENTRADA' | 'SALDO_INICIAL' | 'AJUSTE';
export type FuelUnit = 'L' | 'KG' | 'U';
export type FuelCategory = 'COMBUSTIBLE' | 'LUBRICANTE' | 'GRASA' | 'OTRO';
export type FuelDepositType = 'OBRA' | 'CISTERNA' | 'OTRO';
export type ConsumptionUnit = 'HS' | 'KM';

export const FUEL_TYPE_LABEL: Record<FuelMovementType, string> = {
  DESPACHO: 'Despacho',
  ENTRADA: 'Entrada',
  SALDO_INICIAL: 'Saldo inicial',
  AJUSTE: 'Ajuste',
};

/** Una carga se considera atípica si su consumo se aleja de la mediana de la máquina más que esto. */
export const OUTLIER_LOW = 0.5;
export const OUTLIER_HIGH = 2;
/** Tolerancia sobre la capacidad del tanque antes de advertir (carga de más del 110 %). */
export const TANK_TOLERANCE = 1.1;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/* ─── Catálogo predeterminado y mapa del Access ────────────────────────── */

export interface DefaultFuelProduct {
  codigo: string;
  nombre: string;
  unidad: FuelUnit;
  categoria: FuelCategory;
  /** Columnas del Access: [consumo, entrada]. */
  legacy: [string, string | null];
}

/**
 * Productos que realmente se usan en el Access (2025). Los nombres siguen los rótulos del formulario
 * de despacho (A.txt), que difieren del nombre de la columna: SAE 40 es «15W40», SAE 90 es «80W90».
 * Explosivos, cemento, varillas y tubos casi no tienen uso: se crean desde el catálogo si hacen falta.
 */
export const DEFAULT_FUEL_PRODUCTS: DefaultFuelProduct[] = [
  { codigo: 'GASOIL', nombre: 'Gasoil', unidad: 'L', categoria: 'COMBUSTIBLE', legacy: ['GASOIL', 'ENTRADA'] },
  { codigo: '15W40', nombre: 'Aceite 15W40', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['SAE 40', 'SAE 40 ENVIO'] },
  { codigo: '80W90', nombre: 'Aceite 80W90', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['SAE 90', 'SAE 90 ENVIO'] },
  { codigo: 'TO4', nombre: 'Aceite TO4 50', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['AC50 TO4', 'AC50TO4 ENVIO'] },
  { codigo: 'AC68', nombre: 'Aceite hidráulico 68', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['TELLUS 68', 'TELLUS 68 ENVIO'] },
  { codigo: 'HIDR46', nombre: 'Aceite hidráulico 46', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['SAE 40W', 'SAE 40W ENVIO'] },
  { codigo: 'AC150', nombre: 'Aceite AC 150', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['SAE 50', 'SAE 50 ENVIO'] },
  { codigo: 'AC10', nombre: 'Aceite AC 10', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['SAE 10', 'SAE 10 ENVIO'] },
  { codigo: 'SAE30', nombre: 'Aceite SAE 30', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['SAE 30', 'SAE 30 ENVIO'] },
  { codigo: 'ATF', nombre: 'ATF', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['ATF', 'ATF ENVIO'] },
  { codigo: 'GEAR220', nombre: 'Gear 220', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['GEAR 220', 'GEAR 220 ENVIO'] },
  { codigo: 'TERMICO', nombre: 'Aceite térmico', unidad: 'L', categoria: 'LUBRICANTE', legacy: ['AC TERMICO', 'AC TERMICO ENVIO'] },
  { codigo: 'GRASA', nombre: 'Grasa', unidad: 'KG', categoria: 'GRASA', legacy: ['GRASA KG', 'GRASA KG ENVIO'] },
  { codigo: 'GRASA-ASF', nombre: 'Grasa asfáltica', unidad: 'KG', categoria: 'GRASA', legacy: ['GRASA ASF', 'GRASA ASF ENV'] },
  { codigo: 'CAP', nombre: 'CAP (asfalto)', unidad: 'L', categoria: 'OTRO', legacy: ['CAP', 'CAP ENTRADA'] },
  { codigo: 'FUEL-OIL', nombre: 'Fuel oil', unidad: 'L', categoria: 'COMBUSTIBLE', legacy: ['FUEL OIL', 'FUEL OIL ENTRADA'] },
  { codigo: 'GASOIL-CALDERA', nombre: 'Gasoil caldera', unidad: 'L', categoria: 'COMBUSTIBLE', legacy: ['GASOIL CALDERA', 'GASOIL CALDERA ENTRADA'] },
  { codigo: 'MC30', nombre: 'MC 30 (asfalto)', unidad: 'L', categoria: 'OTRO', legacy: ['MC 30', 'MC30 ENTRADA'] },
];

/** Columna del Access → producto y tipo de movimiento, para el importador futuro. */
export const LEGACY_FUEL_COLUMNS: Record<string, { producto: string; tipo: 'DESPACHO' | 'ENTRADA' }> = Object.fromEntries(
  DEFAULT_FUEL_PRODUCTS.flatMap((p) => [
    [p.legacy[0], { producto: p.codigo, tipo: 'DESPACHO' as const }],
    ...(p.legacy[1] ? [[p.legacy[1], { producto: p.codigo, tipo: 'ENTRADA' as const }]] : []),
  ]),
);

/* ─── Saldos ───────────────────────────────────────────────────────────── */

/** Efecto de un renglón sobre el saldo: el despacho resta; entrada y saldo inicial suman; el ajuste lleva su signo. */
export function movementDelta(tipo: FuelMovementType, cantidad: number): number {
  return tipo === 'DESPACHO' ? -cantidad : cantidad;
}

export interface BalanceMovement {
  tipo: FuelMovementType;
  anulado?: boolean;
  lines: { productId: string; cantidad: number }[];
}

/** Saldo por producto de un conjunto de movimientos, sin contar los anulados. */
export function computeBalances(movements: BalanceMovement[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const m of movements) {
    if (m.anulado) continue;
    for (const line of m.lines) {
      balances.set(line.productId, round3((balances.get(line.productId) ?? 0) + movementDelta(m.tipo, line.cantidad)));
    }
  }
  return balances;
}

/** Productos que quedarían con saldo negativo al aplicar los cambios. Sirve para advertir: no frena el vale. */
export function wouldGoNegative(
  current: Map<string, number>,
  changes: { productId: string; delta: number }[],
): { productId: string; saldo: number; disponible: number }[] {
  const net = new Map<string, number>();
  for (const c of changes) net.set(c.productId, round3((net.get(c.productId) ?? 0) + c.delta));
  const short: { productId: string; saldo: number; disponible: number }[] = [];
  for (const [productId, delta] of net) {
    const disponible = current.get(productId) ?? 0;
    const saldo = round3(disponible + delta);
    if (saldo < 0) short.push({ productId, saldo, disponible });
  }
  return short;
}

/* ─── Validaciones ─────────────────────────────────────────────────────── */

export interface FuelMovementDraft {
  tipo: FuelMovementType;
  fecha: string;
  depositId?: string | null;
  machineId?: string | null;
  terceroChapa?: string | null;
  motivo?: string | null;
  lines: { productId: string; cantidad: number }[];
}

/** Errores de un vale antes de guardarlo. Lista vacía = válido. */
export function validateFuelMovement(draft: FuelMovementDraft, hoy: string): string[] {
  const errors: string[] = [];
  if (!draft.depositId) errors.push('El depósito es obligatorio.');
  if (!isValidDocumentDate(draft.fecha, hoy)) errors.push('La fecha no es válida.');
  if (draft.lines.length === 0) errors.push('El vale debe tener al menos un renglón.');

  const seen = new Set<string>();
  for (const line of draft.lines) {
    if (!line.productId) {
      errors.push('Hay un renglón sin producto.');
      continue;
    }
    if (seen.has(line.productId)) errors.push('Un producto aparece dos veces en el mismo vale.');
    seen.add(line.productId);
    if (!Number.isFinite(line.cantidad) || line.cantidad === 0) {
      errors.push('Las cantidades deben ser distintas de 0.');
    } else if (draft.tipo !== 'AJUSTE' && line.cantidad < 0) {
      errors.push('Solo un ajuste puede tener cantidades negativas.');
    }
  }

  if (draft.tipo === 'AJUSTE' && (draft.motivo ?? '').trim().length < 3) {
    errors.push('Un ajuste necesita un motivo.');
  }
  const hasDestination = Boolean(draft.machineId) || Boolean((draft.terceroChapa ?? '').trim());
  if (draft.tipo !== 'DESPACHO' && hasDestination) {
    errors.push('Solo un despacho tiene máquina o chapa de destino.');
  }
  if (draft.machineId && (draft.terceroChapa ?? '').trim()) {
    errors.push('El destino es una máquina o un tercero, no los dos.');
  }
  return errors;
}

/** Aviso si la carga supera la capacidad del tanque de la ficha de la máquina (con 10 % de tolerancia). */
export function tankCapacityWarning(litros: number, capacidad: number | null | undefined): string | null {
  if (!capacidad || capacidad <= 0) return null;
  if (litros <= capacidad * TANK_TOLERANCE) return null;
  return `La carga (${litros} L) supera la capacidad del tanque (${capacidad} L).`;
}

/* ─── Consumo ──────────────────────────────────────────────────────────── */

export interface FuelFill {
  id: string;
  fecha: string;
  litros: number;
  lectura: number | null;
  /** Lectura marcada como dudosa: no se usa para el consumo. */
  observada?: boolean;
}

export interface ConsumptionLine {
  id: string;
  fecha: string;
  litros: number;
  lectura: number | null;
  /** Litros del tramo hasta esta lectura (incluye cargas intermedias sin lectura). */
  litrosTramo: number | null;
  /** Horas o kilómetros desde la lectura válida anterior. */
  recorrido: number | null;
  consumo: number | null;
  atipica: boolean;
  motivo: 'PRIMERA_LECTURA' | 'SIN_LECTURA' | 'LECTURA_OBSERVADA' | 'SIN_AVANCE' | null;
}

export interface ConsumptionResult {
  unidad: ConsumptionUnit;
  cargas: number;
  sinLectura: number;
  observadas: number;
  litrosTramos: number;
  recorrido: number;
  /** L/h para HS, L/100 km para KM. Null si no hay recorrido medible. */
  consumo: number | null;
  detalle: ConsumptionLine[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Consumo por el método de tanque lleno a tanque lleno. Entre dos lecturas válidas consecutivas se
 * suman los litros de todas las cargas posteriores a la primera (las cargas intermedias sin lectura
 * cuentan: reponen lo consumido). La primera lectura solo fija el punto de partida. Las lecturas
 * observadas no se usan. Con menos de 3 tramos no se marcan cargas atípicas.
 */
export function computeConsumption(fills: FuelFill[], unidad: ConsumptionUnit): ConsumptionResult {
  const sorted = [...fills].sort((a, b) => dayDiff(b.fecha, a.fecha) || 0);
  const detalle: ConsumptionLine[] = [];
  let last: { lectura: number } | null = null;
  let pending = 0;
  let sinLectura = 0;
  let observadas = 0;
  let litrosTramos = 0;
  let recorrido = 0;
  const factor = unidad === 'HS' ? 1 : 100;

  for (const fill of sorted) {
    const base = { id: fill.id, fecha: fill.fecha, litros: fill.litros, lectura: fill.lectura, litrosTramo: null, recorrido: null, consumo: null, atipica: false };
    if (fill.lectura === null) {
      sinLectura++;
      if (last) pending += fill.litros;
      detalle.push({ ...base, motivo: 'SIN_LECTURA' });
      continue;
    }
    if (fill.observada) {
      observadas++;
      if (last) pending += fill.litros;
      detalle.push({ ...base, motivo: 'LECTURA_OBSERVADA' });
      continue;
    }
    if (!last) {
      last = { lectura: fill.lectura };
      detalle.push({ ...base, motivo: 'PRIMERA_LECTURA' });
      continue;
    }
    const delta = round3(fill.lectura - last.lectura);
    const segmentLiters = round3(pending + fill.litros);
    if (delta <= 0) {
      pending = 0;
      last = { lectura: fill.lectura };
      detalle.push({ ...base, litrosTramo: segmentLiters, recorrido: delta, motivo: 'SIN_AVANCE' });
      continue;
    }
    litrosTramos = round3(litrosTramos + segmentLiters);
    recorrido = round3(recorrido + delta);
    detalle.push({ ...base, litrosTramo: segmentLiters, recorrido: delta, consumo: round3((segmentLiters * factor) / delta), motivo: null });
    pending = 0;
    last = { lectura: fill.lectura };
  }

  const segments = detalle.filter((d) => d.consumo !== null);
  if (segments.length >= 3) {
    const mid = median(segments.map((s) => s.consumo as number));
    for (const s of segments) {
      s.atipica = (s.consumo as number) < mid * OUTLIER_LOW || (s.consumo as number) > mid * OUTLIER_HIGH;
    }
  }
  return {
    unidad,
    cargas: fills.length,
    sinLectura,
    observadas,
    litrosTramos,
    recorrido,
    consumo: recorrido > 0 ? round3((litrosTramos * factor) / recorrido) : null,
    detalle,
  };
}

/* ─── Tipos de la API ──────────────────────────────────────────────────── */

export interface FuelProductDto {
  id: string;
  codigo: string;
  nombre: string;
  unidad: FuelUnit;
  categoria: FuelCategory;
  activo: boolean;
}

export interface FuelDepositDto {
  id: string;
  codigo: string;
  nombre: string;
  tipo: FuelDepositType;
  worksite: { id: string; nombre: string } | null;
  machine: { id: string; codigo: string; descripcion: string } | null;
  activo: boolean;
}

export interface FuelMovementDto {
  id: string;
  numero: number;
  fecha: string;
  tipo: FuelMovementType;
  deposit: { id: string; codigo: string; nombre: string };
  machine: { id: string; codigo: string; descripcion: string; meterUnit: ConsumptionUnit } | null;
  terceroChapa: string | null;
  proveidoA: string | null;
  descripcion: string | null;
  remision: string | null;
  supplier: { id: string; nombre: string } | null;
  lectura: number | null;
  lecturaUnidad: ConsumptionUnit | null;
  lecturaObservada: boolean;
  lecturaMotivo: string | null;
  motivo: string | null;
  anulado: boolean;
  anuladoMotivo: string | null;
  lines: { productId: string; producto: { codigo: string; nombre: string; unidad: FuelUnit; categoria: FuelCategory }; cantidad: number }[];
}

/** Respuesta de un alta: el vale y las advertencias que no lo frenaron. */
export type FuelMovementResult = FuelMovementDto & { advertencias: string[] };
