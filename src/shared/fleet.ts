/**
 * @file shared/fleet.ts
 * @description Reglas de flota y partes diarios. Reemplazan:
 * - la búsqueda por código con espacios de los informes (`01 61 01` vs `016101`),
 * - el control de horómetro que el Access no tenía (la lectura puede bajar sin aviso),
 * - las 33 casillas de PARTE DIARIO DE MAQUINAS EN TALLER, convertidas en etiquetas.
 * Puro: sin acceso a base de datos, testeable y compartido por cliente y servidor.
 */

import { calculateHourDifference } from './calculations';

export type MachineStatus = 'ACTIVA' | 'PARADA' | 'EN_DESUSO' | 'BAJA';
export type MeterUnit = 'HS' | 'KM';
export type ReadingSource = 'PARTE' | 'MANUAL' | 'COMBUSTIBLE' | 'SERVICIO';
export type ComplianceStatus = 'VIGENTE' | 'POR_VENCER' | 'VENCIDO' | 'SIN_DATO';

export type EventType =
  | 'ENVIO_REPUESTOS'
  | 'ELEVAR_INGENIERIA'
  | 'TRASLADO'
  | 'FILTROS'
  | 'CUBIERTAS'
  | 'BATERIAS'
  | 'CUCHILLAS'
  | 'PUNTERAS'
  | 'ACEITES'
  | 'ZARANDA'
  | 'CEMENTO'
  | 'TUBOS'
  | 'TERMINO_RESPONSABILIDAD'
  | 'CAL'
  | 'HERRAMIENTAS'
  | 'LABORATORIO'
  | 'MANUALES'
  | 'HABILITACION_MUNICIPAL'
  | 'ORDEN_SERVICIO'
  | 'REJILLA_TANQUE'
  | 'MONITOREO_SATELITAL'
  | 'FRENOS'
  | 'EMBRAGUE';

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  ENVIO_REPUESTOS: 'Envío de repuestos',
  ELEVAR_INGENIERIA: 'Elevar a ingeniería',
  TRASLADO: 'Traslado',
  FILTROS: 'Filtros',
  CUBIERTAS: 'Cubiertas',
  BATERIAS: 'Baterías',
  CUCHILLAS: 'Cuchillas',
  PUNTERAS: 'Punteras',
  ACEITES: 'Aceites',
  ZARANDA: 'Zaranda',
  CEMENTO: 'Cemento',
  TUBOS: 'Tubos',
  TERMINO_RESPONSABILIDAD: 'Término de responsabilidad',
  CAL: 'Cal',
  HERRAMIENTAS: 'Herramientas',
  LABORATORIO: 'Laboratorio',
  MANUALES: 'Manuales',
  HABILITACION_MUNICIPAL: 'Habilitación municipal',
  ORDEN_SERVICIO: 'Orden de servicio',
  REJILLA_TANQUE: 'Rejilla de tanque',
  MONITOREO_SATELITAL: 'Monitoreo satelital',
  FRENOS: 'Frenos',
  EMBRAGUE: 'Embrague',
};

/**
 * Casillas del Access (nombre de columna) → etiqueta nueva. Las 9 casillas que nunca
 * se marcaron desde 2024 (brocas, electrodos, bolsones, manual de máquina, radios VHF,
 * DINATRAN, logos, presupuesto, reporte de máquinas) no tienen entrada: se descartan.
 * Dos manuales distintos pasan a una sola etiqueta.
 */
export const LEGACY_FLAG_TO_EVENT: Record<string, EventType> = {
  'ENVIO REPUESTOS': 'ENVIO_REPUESTOS',
  'PARTE A ING MAURICIO': 'ELEVAR_INGENIERIA',
  TRASLADO: 'TRASLADO',
  FILTROS: 'FILTROS',
  CUBIERTAS: 'CUBIERTAS',
  BATERIAS: 'BATERIAS',
  CUCHILLAS: 'CUCHILLAS',
  PUNTERAS: 'PUNTERAS',
  ACEITES: 'ACEITES',
  ZARANDA: 'ZARANDA',
  CEMENTO: 'CEMENTO',
  'TUBOS Ho': 'TUBOS',
  'TERMINO DE RESP': 'TERMINO_RESPONSABILIDAD',
  CAL: 'CAL',
  HERRAMIENTAS: 'HERRAMIENTAS',
  LABORATORIO: 'LABORATORIO',
  'MANUAL DE PARTES': 'MANUALES',
  'MANUAL DE MANT Y OP': 'MANUALES',
  'HAB MUNIC': 'HABILITACION_MUNICIPAL',
  'ORDEN DE SERVICIO': 'ORDEN_SERVICIO',
  'REJILLA TANQUE COMB': 'REJILLA_TANQUE',
  'MONITOREO SATELITAL': 'MONITOREO_SATELITAL',
  FRENOS: 'FRENOS',
  EMBRAGUE: 'EMBRAGUE',
};

/** Convierte las casillas marcadas de un parte legado en etiquetas, sin duplicados y en orden estable. */
export function eventTypesFromLegacyFlags(flags: Record<string, boolean | null | undefined>): EventType[] {
  const found = new Set<EventType>();
  for (const [flag, value] of Object.entries(flags)) {
    if (value !== true) continue;
    const type = LEGACY_FLAG_TO_EVENT[flag];
    if (type) found.add(type);
  }
  return Object.keys(EVENT_TYPE_LABEL).filter((t) => found.has(t as EventType)) as EventType[];
}

/** Quita espacios, guiones y símbolos: `01 61 01` y `016101` quedan iguales. */
export function normalizeMachineCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Búsqueda tolerante: el texto buscado se compara normalizado contra código y descripción. */
export function matchesMachineSearch(machine: { codigo: string; descripcion: string }, query: string): boolean {
  const q = normalizeMachineCode(query);
  if (q === '') return true;
  return normalizeMachineCode(machine.codigo).includes(q) || normalizeMachineCode(machine.descripcion).includes(q);
}

export interface ReadingPoint {
  fecha: string;
  valor: number;
}

/** Días con signo entre dos fechas YYYY-MM-DD (positivo si `to` es posterior). */
export function dayDiff(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Valida una lectura de horómetro/odómetro contra las lecturas vecinas en el tiempo.
 * El valor no puede bajar respecto de la lectura anterior ni superar a la posterior.
 * Solo una corrección con motivo explícito lo permite. Lista vacía = válida.
 */
export function validateReading(input: {
  previous?: ReadingPoint | null;
  next?: ReadingPoint | null;
  fecha: string;
  valor: number;
  correccion?: boolean;
  motivo?: string | null;
}): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.valor) || input.valor < 0) {
    return ['El valor de la lectura debe ser un número igual o mayor a 0.'];
  }
  const hasMotivo = (input.motivo ?? '').trim().length > 0;
  const permitted = input.correccion === true && hasMotivo;

  if (input.previous && input.valor < input.previous.valor && !permitted) {
    errors.push(
      `El horómetro no puede bajar: la lectura anterior fue ${input.previous.valor} el ${formatIso(input.previous.fecha)}.`,
    );
  }
  if (input.next && input.valor > input.next.valor && !permitted) {
    errors.push(
      `El valor supera la lectura posterior (${input.next.valor} el ${formatIso(input.next.fecha)}).`,
    );
  }
  if (input.correccion === true && !hasMotivo) {
    errors.push('Una corrección necesita un motivo.');
  }
  return errors;
}

/** Horas o kilómetros desde la lectura anterior. Reutiliza la regla de horómetro compartida. */
export function differenceSincePrevious(previous: ReadingPoint | null | undefined, valor: number): number {
  return calculateHourDifference(valor, previous?.valor ?? null);
}

/**
 * Estado de un vencimiento (DINATRAN, habilitación municipal). El Access guardaba la fecha
 * pero nadie la comparaba con hoy: esta regla es nueva.
 */
export function complianceStatus(vence: string | null | undefined, hoy: string, avisoDias: number = 60): ComplianceStatus {
  if (!vence) return 'SIN_DATO';
  const days = dayDiff(hoy, vence);
  if (days < 0) return 'VENCIDO';
  if (days <= avisoDias) return 'POR_VENCER';
  return 'VIGENTE';
}

function formatIso(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
