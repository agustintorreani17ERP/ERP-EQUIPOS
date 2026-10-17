// Órdenes de mantenimiento del Access (MANTENIMIENTOS) → órdenes de servicio, y plan de cada máquina
// derivado de su historial. El tipo se escribía a mano: se reconoce con `parseServiceType`.
import { dayDiff } from '../fleet';
import { CYCLE_PRESETS, parseServiceType, serviceTypeCode, type ServiceUnit } from '../maintenance';
import { accessDate, accessNumber, cleanMemo, cleanText, type Observation } from './common';
import type { AccessRow } from './fleet';

export interface ServiceOrderImport {
  legacyId: string;
  machineCode: string | null;
  fechaEmision: string | null;
  fechaPedido: string | null;
  fechaDevuelta: string | null;
  fechaRealizado: string | null;
  horasIdeal: number | null;
  horasActual: number | null;
  horasReal: number | null;
  /** Id de la obra en la lista de destinos. */
  obraId: string | null;
  /** Número del pedido de repuestos (PS), si había. */
  pedidoRaw: string | null;
  realizada: boolean;
  tipoRaw: string | null;
  /** Tipo reconocido; null si el texto no se pudo interpretar. */
  tipo: { valor: number; unidad: ServiceUnit; codigo: string } | null;
  tipoProximoRaw: string | null;
  observaciones: string | null;
  obs: Observation[];
}

const positive = (v: unknown): number | null => {
  const n = accessNumber(v);
  return n !== null && n > 0 ? n : null;
};

export function serviceOrderFromAccess(row: AccessRow, hoy: string): ServiceOrderImport {
  const obs: Observation[] = [];
  const f1 = accessDate(row['Fech1'], hoy).fecha;
  const f2 = accessDate(row['Fech2'], hoy).fecha;
  const f4 = accessDate(row['Fech4'], hoy).fecha;
  const f5 = accessDate(row['Fech5'], hoy).fecha;
  const realizada = row['Ok'] === true || f4 !== null;

  // La emisión puede faltar o ser basura: se toma la primera fecha válida de la orden.
  let fechaEmision = f1;
  if (!fechaEmision) {
    fechaEmision = f2 ?? f5 ?? f4;
    if (fechaEmision) obs.push({ code: 'SIN_FECHA', detail: 'Sin fecha de emisión válida: se usó la primera fecha válida de la orden' });
  }

  const horasActual = positive(row['Hs2']);
  const horasIdeal = positive(row['Hs1']);
  let horasReal = positive(row['Hs4']);
  let fechaRealizado = f4;
  if (realizada) {
    if (!fechaRealizado) {
      fechaRealizado = f5 ?? f2 ?? fechaEmision;
      obs.push({ code: 'SIN_FECHA', detail: 'Realizada sin fecha de realización: se usó otra fecha de la orden' });
    }
    if (horasReal === null) {
      horasReal = horasActual ?? horasIdeal;
      if (horasReal !== null) obs.push({ code: 'OTRO', detail: 'Realizada sin horas reales: se usaron las horas de la emisión' });
    }
    if (horasReal === null) obs.push({ code: 'OTRO', detail: 'Realizada sin horas registradas en el Access' });
    // El modelo nuevo no admite realizar antes de emitir (pasaba 6 veces en el Access).
    if (fechaRealizado && fechaEmision && fechaRealizado < fechaEmision) {
      obs.push({ code: 'OTRO', detail: `Realizada (${fechaRealizado}) antes de emitirse (${fechaEmision}): se igualó a la emisión` });
      fechaRealizado = fechaEmision;
    }
  }

  const tipoRaw = cleanText(row['TIPO DE MANTENIMIENTO']);
  const parsed = parseServiceType(tipoRaw);
  const ps = positive(row['PS']);
  return {
    legacyId: cleanText(row['Id']) ?? '',
    machineCode: cleanText(row['IdCód']),
    fechaEmision,
    fechaPedido: f2,
    fechaDevuelta: f5,
    fechaRealizado: realizada ? fechaRealizado : null,
    horasIdeal,
    horasActual,
    horasReal: realizada ? horasReal : null,
    obraId: cleanText(row['Obra']),
    pedidoRaw: ps !== null ? String(Math.round(ps)) : null,
    realizada,
    tipoRaw,
    tipo: parsed ? { ...parsed, codigo: serviceTypeCode(parsed.valor, parsed.unidad) } : null,
    tipoProximoRaw: cleanText(row['TIPO PROXIMO MANTENIMIENTO']),
    observaciones: cleanMemo(row['Obs']),
    obs,
  };
}

export interface PlanImport {
  unidad: ServiceUnit;
  intervalo: number;
  ciclo: string[];
  proximoIndice: number;
  proximoHoras: number;
  /** Código del próximo servicio, para informar. */
  proximoTipo: string;
}

/**
 * Posición del último servicio dentro de un ciclo repetido: el índice donde coinciden más tipos
 * consecutivos hacia atrás con los últimos servicios realizados. Devuelve -1 si el último tipo no está.
 */
export function locateInCycle(ciclo: string[], recientes: string[]): number {
  let best = -1;
  let bestScore = 0;
  const n = ciclo.length;
  for (let i = 0; i < n; i++) {
    let score = 0;
    for (let k = 0; k < Math.min(recientes.length, n); k++) {
      if (ciclo[(((i - k) % n) + n) % n] === recientes[recientes.length - 1 - k]) score += 1;
      else break;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore > 0 ? best : -1;
}

/** Máximo de días desde el último servicio para armar un plan (más de 18 meses = ya no se atiende). */
export const PLAN_MAX_AGE_DAYS = 548;

export interface RealizedService {
  fechaRealizado: string;
  tipoCodigo: string;
  unidad: ServiceUnit;
  valor: number;
  horasReal: number;
}

/**
 * Plan de una máquina a partir de sus servicios realizados (ordenados por fecha, el último al final).
 * El próximo servicio se calcula desde las horas reales del último más el intervalo del ciclo.
 * Devuelve null si no hay servicios o el último es demasiado viejo.
 */
export function derivePlan(services: RealizedService[], hoy: string): PlanImport | null {
  if (services.length === 0) return null;
  const last = services[services.length - 1];
  if (dayDiff(last.fechaRealizado, hoy) > PLAN_MAX_AGE_DAYS) return null;
  const preset = CYCLE_PRESETS.find((p) => p.unidad === last.unidad && p.id !== 'hs-250-simple');
  const recientes = services.slice(-4).map((s) => s.tipoCodigo);
  let ciclo: string[];
  let intervalo: number;
  let index: number;
  const pos = preset ? locateInCycle(preset.ciclo, recientes) : -1;
  if (preset && pos >= 0) {
    ciclo = preset.ciclo;
    intervalo = preset.intervalo;
    index = (pos + 1) % ciclo.length;
  } else {
    // Tipo fuera de los ciclos habituales: la máquina repite ese mismo servicio.
    ciclo = [last.tipoCodigo];
    intervalo = last.valor;
    index = 0;
  }
  return { unidad: last.unidad, intervalo, ciclo, proximoIndice: index, proximoHoras: last.horasReal + intervalo, proximoTipo: ciclo[index] };
}
