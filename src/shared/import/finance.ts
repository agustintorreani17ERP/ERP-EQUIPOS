// SF y caja chica del Access (tabla única CAJA CHICA) → solicitudes de fondos y rendiciones con
// numeración anual «N/AAAA». No se importan pagos ni se usa la casilla «Recibí SF» (decisión del usuario).
import { LEGACY_NUMBER_BASE, accessDate, accessNumber, cleanText, trendMax, type Observation } from './common';
import type { AccessRow } from './fleet';

export interface AnnualNumber {
  numero: number;
  anio: number;
}

/**
 * Número de documento con año: «385/2025», «10/24» (año de dos cifras) o un entero suelto de hasta
 * 5 cifras (el correlativo global que se usó hasta 2024; el año sale de la fecha del documento).
 */
export function parseAnnualNumber(raw: unknown, fechaIso: string | null): AnnualNumber | null {
  const text = cleanText(raw);
  if (!text) return null;
  const slash = /^(\d{1,5})\s*\/\s*(\d{4}|\d{2})$/.exec(text);
  if (slash) {
    const numero = Number(slash[1]);
    if (numero <= 0) return null;
    const yy = Number(slash[2]);
    const anio = slash[2].length === 2 ? 2000 + yy : yy;
    if (anio < 2000 || anio > 2100) return null;
    return { numero, anio };
  }
  if (/^\d{1,5}$/.test(text) && fechaIso) {
    const numero = Number(text);
    if (numero <= 0) return null;
    return { numero, anio: Number(fechaIso.slice(0, 4)) };
  }
  return null;
}

export interface AnnualDoc {
  key: string;
  raw: unknown;
  /** Fecha del documento (obligatoria: define el año de los que no traen número utilizable). */
  fecha: string;
}

export interface AnnualAssignment {
  numero: number;
  anio: number;
  referenciaAccess: string | null;
  obs: Observation | null;
}

export interface AnnualNumbering {
  byKey: Map<string, AnnualAssignment>;
  /** Mayor número conservado por año: la secuencia de cada año sigue desde acá + 1. */
  maxByYear: Map<number, number>;
}

/**
 * Asigna número y año conservando el del Access. El repetido dentro del año (el más antiguo se
 * queda con el número), el vacío y el ilegible reciben un número de la banda histórica de su año.
 */
export function assignAnnualNumbers(docs: AnnualDoc[]): AnnualNumbering {
  const byKey = new Map<string, AnnualAssignment>();
  const maxByYear = new Map<number, number>();
  const used = new Set<string>();
  const pending: { doc: AnnualDoc; why: Observation }[] = [];

  // Tendencia por año y formato (el entero global y el «N/AA» de 2024 son series distintas): un número tipeado
  // de más no cuenta como el último de la serie.
  const seriesOf = (raw: unknown, parsed: AnnualNumber): string => `${parsed.anio}|${(cleanText(raw) ?? '').includes('/') ? 'B' : 'E'}`;
  const trend = new Map<string, number>();
  const byGroup = new Map<string, { valor: number; fecha: string }[]>();
  for (const doc of docs) {
    const parsed = parseAnnualNumber(doc.raw, doc.fecha);
    if (!parsed) continue;
    const group = byGroup.get(seriesOf(doc.raw, parsed)) ?? [];
    group.push({ valor: parsed.numero, fecha: doc.fecha });
    byGroup.set(seriesOf(doc.raw, parsed), group);
  }
  for (const [group, items] of byGroup) trend.set(group, trendMax(items));

  const ordered = [...docs].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  for (const doc of ordered) {
    const parsed = parseAnnualNumber(doc.raw, doc.fecha);
    const text = cleanText(doc.raw);
    if (!parsed) {
      pending.push({ doc, why: text === null ? { code: 'NUMERO_VACIO' } : { code: 'NUMERO_NO_NUMERICO', detail: text } });
      continue;
    }
    if (parsed.numero > (trend.get(seriesOf(doc.raw, parsed)) ?? 0)) {
      pending.push({ doc, why: { code: 'NUMERO_FUERA_DE_SERIE', detail: text ?? undefined } });
      continue;
    }
    const id = `${parsed.anio}/${parsed.numero}`;
    if (used.has(id)) {
      pending.push({ doc, why: { code: 'NUMERO_REPETIDO', detail: text ?? undefined } });
      continue;
    }
    used.add(id);
    byKey.set(doc.key, { ...parsed, referenciaAccess: null, obs: null });
    maxByYear.set(parsed.anio, Math.max(maxByYear.get(parsed.anio) ?? 0, parsed.numero));
  }

  const legacyCursor = new Map<number, number>();
  for (const { doc, why } of pending) {
    const anio = Number(doc.fecha.slice(0, 4));
    let n = legacyCursor.get(anio) ?? LEGACY_NUMBER_BASE;
    do {
      n += 1;
    } while (used.has(`${anio}/${n}`));
    legacyCursor.set(anio, n);
    used.add(`${anio}/${n}`);
    byKey.set(doc.key, { numero: n, anio, referenciaAccess: cleanText(doc.raw), obs: why });
  }
  return { byKey, maxByYear };
}

export interface FundRequestImport {
  legacyId: string;
  sfRaw: string | null;
  fecha: string | null;
  monto: number | null;
  currency: 'PYG' | 'USD';
  concepto: string;
  factura: string | null;
  cuentaId: string | null;
  machineCode: string | null;
  pedidoRaw: string | null;
  proveedorId: string | null;
  anulado: boolean;
  /** Rótulo de la rendición de caja chica que la repone (NO CAJA CHICA), si lo hay. */
  cajaRaw: string | null;
  pagoRegistrado: boolean;
  obs: Observation[];
}

const DOLLAR = /D[OÓ]LAR|U\$S|USS|US\$/i;

export function fundRequestFromAccess(row: AccessRow, hoy: string): FundRequestImport {
  const obs: Observation[] = [];
  const fecha = accessDate(row['FECHA'], hoy);
  if (fecha.obs) obs.push(fecha.obs);
  const gs = accessNumber(row['GS']);
  const monto = gs !== null && gs > 0 ? gs : null;
  if (monto === null) obs.push({ code: 'MONTO_INVALIDO', detail: String(row['GS'] ?? '') });
  let concepto = cleanText(row['OBS']);
  if (!concepto) {
    concepto = 'Sin concepto';
    obs.push({ code: 'DESCRIPCION_VACIA' });
  }
  const letra = cleanText(row['MONTO EN LETRA']);
  const usd = letra !== null && DOLLAR.test(letra);
  if (usd) obs.push({ code: 'MONEDA_DETECTADA', detail: 'USD por el monto en letras' });
  return {
    legacyId: cleanText(row['ID']) ?? '',
    sfRaw: cleanText(row['NRO SF']),
    fecha: fecha.fecha,
    monto,
    currency: usd ? 'USD' : 'PYG',
    concepto,
    factura: cleanText(row['FACTURA O REMISION']),
    cuentaId: cleanText(row['CUENTA TIPO']),
    machineCode: cleanText(row['IdCódigo']),
    pedidoRaw: cleanText(row['PEDIDO DE MAT No']),
    proveedorId: cleanText(row['PROVEEDOR']),
    anulado: row['ANULADO'] === true,
    cajaRaw: cleanText(row['NO CAJA CHICA']),
    pagoRegistrado: typeof row['PAGO'] === 'number' && row['PAGO'] > 0,
    obs,
  };
}

export interface PettyLineImport {
  legacyId: string;
  cajaRaw: string | null;
  /** Número de SF escrito en el renglón: la SF que repuso esa rendición. */
  sfRaw: string | null;
  fecha: string | null;
  monto: number | null;
  concepto: string | null;
  factura: string | null;
  proveedorId: string | null;
  cuentaId: string | null;
  machineCode: string | null;
  aCredito: boolean;
  pagoRegistrado: boolean;
  obs: Observation[];
}

export function pettyLineFromAccess(row: AccessRow, hoy: string): PettyLineImport {
  const obs: Observation[] = [];
  const fecha = accessDate(row['FECHA'], hoy);
  if (fecha.obs) obs.push(fecha.obs);
  const gs = accessNumber(row['GS']);
  const monto = gs !== null && gs > 0 ? gs : null;
  if (monto === null) obs.push({ code: 'MONTO_INVALIDO', detail: String(row['GS'] ?? '') });
  return {
    legacyId: cleanText(row['ID']) ?? '',
    cajaRaw: cleanText(row['NO CAJA CHICA']),
    sfRaw: cleanText(row['NRO SF']),
    fecha: fecha.fecha,
    monto,
    concepto: cleanText(row['OBS']),
    factura: cleanText(row['FACTURA O REMISION']),
    proveedorId: cleanText(row['PROVEEDOR']),
    cuentaId: cleanText(row['CUENTA TIPO']),
    machineCode: cleanText(row['IdCódigo']),
    aCredito: row['A PAGAR'] === true,
    pagoRegistrado: typeof row['PAGO'] === 'number' && row['PAGO'] > 0,
    obs,
  };
}

/** SF que repuso una rendición: el número de SF más repetido entre sus renglones (sin ceros ni vacíos). */
export function replenishmentRaw(lines: PettyLineImport[]): string | null {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const raw = l.sfRaw;
    if (!raw || raw === '0') continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [raw, n] of counts) {
    if (n > bestCount) {
      best = raw;
      bestCount = n;
    }
  }
  return best;
}
