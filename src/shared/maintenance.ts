/**
 * @file shared/maintenance.ts
 * @description Reglas de mantenimiento. Reemplazan:
 * - el tipo de servicio escrito a mano en MANTENIMIENTOS («2000 HS», «00500 HS», «5.000 kmss»),
 * - las hojas «MANT POR OBRAS» que se imprimían con ACTUAL y PRÓXIMO en blanco para completar a mano,
 * - el aviso que no existía: el 61 % de las órdenes se emitía con la máquina ya pasada de horas.
 * El próximo servicio se encadena con las horas reales del último (decisión del usuario, y lo que el
 * Access hacía en el 85 % de los casos): próximas horas = horas reales + intervalo.
 * Puro: sin acceso a base de datos, testeable y compartido por cliente y servidor.
 */

import { dayDiff } from './fleet';
import { isValidDocumentDate } from './finance';

export type ServiceUnit = 'HS' | 'KM';
export type ServiceOrderState = 'EMITIDA' | 'REALIZADA' | 'ANULADA';
export type ServiceStatus = 'VENCIDO' | 'PROXIMO' | 'VIGENTE';
export type LatenessBucket = 'A_TIEMPO' | 'HASTA_50' | 'DE_51_A_150' | 'MAS_DE_150';
export type TaskGroup = 'CAMBIO' | 'CONTROL' | 'DRENAR' | 'LUBRICACION';

export interface ServiceTask {
  grupo: TaskGroup;
  descripcion: string;
}

/** Aviso por defecto: 20 % del intervalo (50 hs en un servicio de 250 hs). */
export const DEFAULT_WARNING_PCT = 20;
/** Días de lecturas que se usan para estimar el uso diario de una máquina. */
export const USAGE_WINDOW_DAYS = 60;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/* ─── Tipos de servicio ────────────────────────────────────────────────── */

/** Código canónico de un tipo: `250 HS`, `5000 KM`. */
export function serviceTypeCode(valor: number, unidad: ServiceUnit): string {
  return `${valor} ${unidad}`;
}

/**
 * Interpreta el tipo de servicio escrito a mano: tolera ceros a la izquierda, separadores de miles
 * con punto o coma, y errores de tipeo en la unidad («HSS», «kmss»). Devuelve null si no es un
 * tipo reconocible (por ejemplo «789» sin unidad, o «5.0000», que es ambiguo).
 */
export function parseServiceType(text: string | null | undefined): { valor: number; unidad: ServiceUnit } | null {
  const t = (text ?? '').toUpperCase().trim();
  const m = /^([0-9][0-9.,\s]*?)\s*(K\w*|H\w*)$/.exec(t);
  if (!m) return null;
  const unidad: ServiceUnit = m[2].startsWith('K') ? 'KM' : 'HS';
  const digits = m[1].replace(/\s/g, '');
  let numeric: string;
  if (/^\d{1,3}([.,]\d{3})+$/.test(digits)) numeric = digits.replace(/[.,]/g, '');
  else if (/^\d+$/.test(digits)) numeric = digits;
  else return null;
  const valor = Number(numeric);
  return Number.isFinite(valor) && valor > 0 ? { valor, unidad } : null;
}

/* ─── Estado del programa ──────────────────────────────────────────────── */

export interface MaintenanceStatusResult {
  estado: ServiceStatus | 'SIN_LECTURA';
  /** Horas o km que faltan para el servicio (negativo si ya se pasó). Null sin lectura. */
  restante: number | null;
  /** Desde cuántas horas o km antes se empieza a avisar. */
  avisoDesde: number;
}

/**
 * Estado de un servicio. `VENCIDO` si ya se pasó de las horas, `PROXIMO` si falta el aviso o menos
 * (por defecto el 20 % del intervalo), `VIGENTE` si falta más. Sin lectura no se puede decidir.
 */
export function maintenanceStatus(input: {
  actual: number | null | undefined;
  proximo: number;
  intervalo: number;
  avisoPct?: number;
}): MaintenanceStatusResult {
  const avisoDesde = round1((input.intervalo * (input.avisoPct ?? DEFAULT_WARNING_PCT)) / 100);
  if (input.actual === null || input.actual === undefined) return { estado: 'SIN_LECTURA', restante: null, avisoDesde };
  const restante = round1(input.proximo - input.actual);
  if (restante < 0) return { estado: 'VENCIDO', restante, avisoDesde };
  return { estado: restante <= avisoDesde ? 'PROXIMO' : 'VIGENTE', restante, avisoDesde };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fecha estimada del servicio según el uso diario de los últimos 60 días. Devuelve null si faltan
 * lecturas o la máquina no avanzó. Si ya se pasó, es hoy.
 */
export function projectDueDate(
  readings: { fecha: string; valor: number }[],
  restante: number,
  hoy: string,
  windowDays: number = USAGE_WINDOW_DAYS,
): string | null {
  if (restante <= 0) return hoy;
  const recent = readings.filter((r) => dayDiff(r.fecha, hoy) >= 0 && dayDiff(r.fecha, hoy) <= windowDays).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const days = dayDiff(first.fecha, last.fecha);
  const rate = days > 0 ? (last.valor - first.valor) / days : 0;
  if (rate <= 0) return null;
  return addDays(hoy, Math.ceil(restante / rate));
}

/* ─── Ciclo y atraso ───────────────────────────────────────────────────── */

/** Posición del siguiente servicio en el ciclo (vuelve al principio al llegar al final). */
export function nextCycleIndex(cycleLength: number, index: number): number {
  if (cycleLength <= 0) return 0;
  return (index + 1) % cycleLength;
}

export interface Lateness {
  /** Horas reales menos horas ideales: positivo es tarde. */
  diferencia: number;
  bucket: LatenessBucket;
}

export function lateness(horasReal: number, horasIdeal: number): Lateness {
  const diferencia = round1(horasReal - horasIdeal);
  const bucket: LatenessBucket = diferencia <= 0 ? 'A_TIEMPO' : diferencia <= 50 ? 'HASTA_50' : diferencia <= 150 ? 'DE_51_A_150' : 'MAS_DE_150';
  return { diferencia, bucket };
}

export const LATENESS_LABEL: Record<LatenessBucket, string> = {
  A_TIEMPO: 'A tiempo',
  HASTA_50: 'Hasta 50 h tarde',
  DE_51_A_150: '51 a 150 h tarde',
  MAS_DE_150: 'Más de 150 h tarde',
};

/* ─── Validaciones ─────────────────────────────────────────────────────── */

export function validateServiceCompletion(
  input: { fecha: string; fechaEmision: string; horasReal: number },
  hoy: string,
): string[] {
  const errors: string[] = [];
  if (!isValidDocumentDate(input.fecha, hoy)) errors.push('La fecha de realización no es válida.');
  else if (input.fecha > hoy) errors.push('La fecha de realización no puede ser futura.');
  else if (input.fecha < input.fechaEmision) errors.push('La fecha de realización no puede ser anterior a la emisión de la orden.');
  if (!Number.isFinite(input.horasReal) || input.horasReal < 0) errors.push('Las horas reales deben ser un número igual o mayor a 0.');
  return errors;
}

export function validatePlan(input: { intervalo: number; ciclo: string[]; proximoHoras: number; avisoPct: number }): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.intervalo) || input.intervalo <= 0) errors.push('El intervalo debe ser mayor a 0.');
  if (input.ciclo.length === 0) errors.push('El ciclo necesita al menos un tipo de servicio.');
  if (!Number.isFinite(input.proximoHoras) || input.proximoHoras < 0) errors.push('Las próximas horas deben ser un número igual o mayor a 0.');
  if (!Number.isFinite(input.avisoPct) || input.avisoPct < 0 || input.avisoPct > 100) errors.push('El aviso debe estar entre 0 y 100 %.');
  return errors;
}

/* ─── Catálogo predeterminado ──────────────────────────────────────────── */

const CONTROLS: ServiceTask[] = [
  { grupo: 'DRENAR', descripcion: 'Drenar el agua del tanque de combustible' },
  { grupo: 'CONTROL', descripcion: 'Controlar el electrolito de las baterías y rellenar según sea necesario' },
  { grupo: 'CONTROL', descripcion: 'Controlar el apretado de las terminales de las baterías' },
  { grupo: 'CONTROL', descripcion: 'Controlar los niveles de fluidos y rellenar según sea necesario' },
  { grupo: 'CONTROL', descripcion: 'Controlar si hay basura acumulada en el radiador y limpiar' },
  { grupo: 'CONTROL', descripcion: 'Controlar desgaste o fugas: correas, poleas, mangueras y aspas del ventilador' },
  { grupo: 'LUBRICACION', descripcion: 'Lubricación general de la máquina' },
];

const ENGINE_OIL: ServiceTask[] = [
  { grupo: 'CAMBIO', descripcion: 'Cambio de aceite del motor' },
  { grupo: 'CAMBIO', descripcion: 'Cambio del filtro de aceite del motor' },
];

const FUEL_FILTERS: ServiceTask[] = [
  { grupo: 'CAMBIO', descripcion: 'Cambio de filtros de combustible' },
  { grupo: 'CAMBIO', descripcion: 'Cambio del filtro trampa de agua' },
];

const AIR_HYDRAULIC: ServiceTask[] = [
  { grupo: 'CAMBIO', descripcion: 'Cambio de filtros de aire 1 y 2' },
  { grupo: 'CAMBIO', descripcion: 'Cambio de filtros hidráulicos' },
  { grupo: 'CAMBIO', descripcion: 'Cambio de aceite y filtro de transmisión' },
  { grupo: 'CONTROL', descripcion: 'Limpiar la rejilla del tanque hidráulico' },
];

const MAJOR_HOURS: ServiceTask[] = [
  { grupo: 'CAMBIO', descripcion: 'Cambio de líquido refrigerante' },
  { grupo: 'CONTROL', descripcion: 'Verificación y regulación de válvulas' },
  { grupo: 'CAMBIO', descripcion: 'Cambio de aceite de mandos finales, diferenciales y sistema hidráulico' },
  { grupo: 'LUBRICACION', descripcion: 'Lubricación de la tornameza en excavadoras' },
];

const AXLES_GEARBOX: ServiceTask[] = [
  { grupo: 'CAMBIO', descripcion: 'Cambio de aceite de diferencial delantero' },
  { grupo: 'CAMBIO', descripcion: 'Cambio de aceite de diferencial trasero' },
  { grupo: 'CAMBIO', descripcion: 'Cambio de aceite de caja de cambios' },
  { grupo: 'CAMBIO', descripcion: 'Cambio de aceite de caja reductora' },
  { grupo: 'CAMBIO', descripcion: 'Cambio de aceite y filtro hidráulico del trompo (solo mixers)' },
  { grupo: 'CAMBIO', descripcion: 'Cambio del filtro de transmisión y del filtro secante' },
];

export interface DefaultServiceType {
  codigo: string;
  nombre: string;
  valor: number;
  unidad: ServiceUnit;
  tareas: ServiceTask[];
}

/** Los seis tipos que el Access usa de verdad, con las tareas de sus plantillas. Editables. */
export const DEFAULT_SERVICE_TYPES: DefaultServiceType[] = [
  { codigo: '250 HS', nombre: 'Servicio de 250 hs', valor: 250, unidad: 'HS', tareas: [...ENGINE_OIL, ...CONTROLS] },
  { codigo: '500 HS', nombre: 'Servicio de 500 hs', valor: 500, unidad: 'HS', tareas: [...ENGINE_OIL, ...FUEL_FILTERS, ...CONTROLS] },
  { codigo: '1000 HS', nombre: 'Servicio de 1.000 hs', valor: 1000, unidad: 'HS', tareas: [...ENGINE_OIL, ...FUEL_FILTERS, ...AIR_HYDRAULIC, ...CONTROLS] },
  { codigo: '2000 HS', nombre: 'Servicio de 2.000 hs', valor: 2000, unidad: 'HS', tareas: [...ENGINE_OIL, ...FUEL_FILTERS, ...AIR_HYDRAULIC, ...MAJOR_HOURS, ...CONTROLS] },
  { codigo: '5000 KM', nombre: 'Servicio de 5.000 km', valor: 5000, unidad: 'KM', tareas: [...ENGINE_OIL, ...FUEL_FILTERS, { grupo: 'CAMBIO', descripcion: 'Cambio de filtros de aire 1 y 2' }, ...CONTROLS] },
  { codigo: '20000 KM', nombre: 'Servicio de 20.000 km', valor: 20000, unidad: 'KM', tareas: [...ENGINE_OIL, ...FUEL_FILTERS, { grupo: 'CAMBIO', descripcion: 'Cambio de filtros de aire 1 y 2' }, ...AXLES_GEARBOX, ...CONTROLS] },
];

export interface CyclePreset {
  id: string;
  nombre: string;
  intervalo: number;
  unidad: ServiceUnit;
  ciclo: string[];
}

/** Ciclos que explican las transiciones reales del Access. Cada máquina puede usar el suyo. */
export const CYCLE_PRESETS: CyclePreset[] = [
  { id: 'hs-250', nombre: 'Maquinaria cada 250 hs (250, 500, 250, 1.000, 250, 500, 250, 2.000)', intervalo: 250, unidad: 'HS', ciclo: ['250 HS', '500 HS', '250 HS', '1000 HS', '250 HS', '500 HS', '250 HS', '2000 HS'] },
  { id: 'hs-250-simple', nombre: 'Solo servicios de 250 hs', intervalo: 250, unidad: 'HS', ciclo: ['250 HS'] },
  { id: 'km-5000', nombre: 'Camiones cada 5.000 km (5.000 ×3 y 20.000)', intervalo: 5000, unidad: 'KM', ciclo: ['5000 KM', '5000 KM', '5000 KM', '20000 KM'] },
];

/* ─── Contratos de la API (compartidos con el cliente) ─────────────────── */

export interface ServiceTypeDto {
  id: string;
  codigo: string;
  nombre: string;
  valor: number;
  unidad: ServiceUnit;
  tareas: ServiceTask[];
  activo: boolean;
}

export interface MaintenancePlanDto {
  machineId: string;
  machineCodigo: string;
  machineDescripcion: string;
  unidad: ServiceUnit;
  intervalo: number;
  ciclo: string[];
  proximoIndice: number;
  proximoHoras: number;
  avisoPct: number;
  activo: boolean;
}

export type ProgramStatus = ServiceStatus | 'SIN_LECTURA' | 'SIN_PLAN';

export interface ProgramRowDto {
  machine: { id: string; codigo: string; descripcion: string; meterUnit: ServiceUnit };
  worksite: { id: string; nombre: string } | null;
  lectura: { valor: number; fecha: string } | null;
  plan: { intervalo: number; ciclo: string[]; proximoIndice: number; avisoPct: number } | null;
  proximoHoras: number | null;
  proximoTipo: string | null;
  restante: number | null;
  estado: ProgramStatus;
  fechaEstimada: string | null;
  ordenAbierta: { id: string; numero: number; tipo: string } | null;
}

export interface ServiceOrderDto {
  id: string;
  numero: number;
  machine: { id: string; codigo: string; descripcion: string };
  worksite: { id: string; nombre: string } | null;
  tipo: { codigo: string; nombre: string };
  unidad: ServiceUnit;
  estado: ServiceOrderState;
  fechaEmision: string;
  horasIdeal: number | null;
  horasActual: number | null;
  fechaPedido: string | null;
  fechaDevuelta: string | null;
  fechaRealizado: string | null;
  horasReal: number | null;
  atraso: Lateness | null;
  pedido: { id: string; numero: number } | null;
  tareas: ServiceTask[];
  filtros: { tipo: string; referencia: string | null; cantidad: number | null }[];
  capacidades: { punto: string; producto: string | null; capacidadLitros: number | null }[];
  proximoHoras: number | null;
  proximoTipo: string | null;
  observaciones: string | null;
  anuladoMotivo: string | null;
  advertencias?: string[];
}

export interface ComplianceRowDto {
  machine: { id: string; codigo: string; descripcion: string };
  tipo: string;
  cantidad: number;
  diferenciaPromedio: number;
  aTiempo: number;
  hasta50: number;
  de51a150: number;
  masDe150: number;
  pctATiempo: number;
}
