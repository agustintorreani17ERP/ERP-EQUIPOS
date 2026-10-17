// Utilidades comunes de la importación desde el Access (y desde planillas con las mismas columnas).
// Funciones puras: no leen archivos ni tocan la base. Los datos reales nunca entran al repo.
import { isValidDocumentDate } from '../finance';

export type ObservationCode =
  | 'FECHA_VACIA'
  | 'FECHA_FUERA_DE_RANGO'
  | 'NUMERO_VACIO'
  | 'NUMERO_REPETIDO'
  | 'NUMERO_NO_NUMERICO'
  | 'NUMERO_FUERA_DE_SERIE'
  | 'MAQUINA_SIN_FICHA'
  | 'PROVEEDOR_SIN_REGISTRO'
  | 'OBRA_SIN_REGISTRO'
  | 'LECTURA_BAJA'
  | 'MONTO_INVALIDO'
  | 'CANTIDAD_INVALIDA'
  | 'TEXTO_NO_NUMERICO'
  | 'SIN_RENGLONES'
  | 'SIN_ENCABEZADO'
  | 'SIN_FECHA'
  | 'PAGO_NO_IMPORTADO'
  | 'MONEDA_DETECTADA'
  | 'DESCRIPCION_VACIA'
  | 'OTRO';

export interface Observation {
  code: ObservationCode;
  detail?: string;
}

/** Texto limpio: sin espacios sobrantes; vacío → null. */
export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/** Fecha del Access (Date de mdb-reader o texto) → 'AAAA-MM-DD' en UTC, o null. */
function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const text = cleanText(value);
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Fecha de un documento: válida si es del 2000 en adelante y no más de un año hacia adelante
 * (las mismas reglas que se aplican al cargar en la app). Si no, devuelve null con la observación
 * para que el dato original no se pierda en silencio.
 */
export function accessDate(value: unknown, hoy: string): { fecha: string | null; obs?: Observation } {
  const iso = toIsoDate(value);
  if (value === null || value === undefined || cleanText(value) === null) return { fecha: null, obs: { code: 'FECHA_VACIA' } };
  if (!iso) return { fecha: null, obs: { code: 'FECHA_FUERA_DE_RANGO', detail: String(value).slice(0, 40) } };
  if (!isValidDocumentDate(iso, hoy)) return { fecha: null, obs: { code: 'FECHA_FUERA_DE_RANGO', detail: iso } };
  return { fecha: iso };
}

/** Número decimal de un campo de texto o numérico; acepta coma decimal. Vacío o ilegible → null. */
export function accessNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cleanText(value);
  if (!text) return null;
  const normalized = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Cifras máximas de un número de documento «de serie» (los de más cifras son tipeos). */
export const SERIES_MAX_DIGITS = 5;

export interface ClassifiedNumber {
  kind: 'ENTERO' | 'TEXTO' | 'VACIO';
  /** Valor entero cuando el campo es solo dígitos (sin los ceros a la izquierda). */
  entero: number | null;
  texto: string | null;
  /** Entero positivo de hasta SERIES_MAX_DIGITS cifras: cuenta para el máximo de la secuencia. */
  enSerie: boolean;
}

/** Clasifica un número de documento tal como se escribía a mano en el Access. */
export function classifyNumber(raw: unknown): ClassifiedNumber {
  const texto = cleanText(raw);
  if (texto === null) return { kind: 'VACIO', entero: null, texto: null, enSerie: false };
  if (/^\d+$/.test(texto)) {
    const entero = Number(texto.replace(/^0+(?=\d)/, ''));
    const digits = String(entero).length;
    const safe = Number.isSafeInteger(entero) && entero <= 2_147_483_647;
    return { kind: 'ENTERO', entero: safe ? entero : null, texto, enSerie: safe && entero > 0 && digits <= SERIES_MAX_DIGITS };
  }
  return { kind: 'TEXTO', entero: null, texto, enSerie: false };
}

/** Nombre comparable: mayúsculas, sin tildes ni signos, espacios colapsados. */
export function normalizeName(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export interface NumberedDocument {
  /** Identificador del documento dentro de la importación (fila, id del Access…). */
  key: string;
  raw: unknown;
  /** Fecha del documento: el más antiguo conserva el número cuando hay repetidos. */
  fecha: string | null;
}

export interface AssignedNumber {
  numero: number;
  /** Número tal como estaba en el Access, solo si no se conservó. */
  referenciaAccess: string | null;
  obs: Observation | null;
}

export interface NumberAssignment {
  byKey: Map<string, AssignedNumber>;
  /** Mayor número «de serie» encontrado: la secuencia sigue desde acá (+ 1). */
  seriesMax: number;
  /** Último número asignado: con `legacyBase` es el último de la banda histórica; si no, sigue la serie. */
  lastAssigned: number;
}

/**
 * Mayor número de la tendencia de una serie de documentos: la subsecuencia estrictamente creciente más larga
 * cuando se ordena por fecha (y por número dentro de la misma fecha). Un valor tipeado de más no entra en
 * ella porque haría imposible el resto. Devuelve 0 si no hay elementos.
 */
export function trendMax(items: { valor: number; fecha: string }[]): number {
  const sorted = [...items].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.valor - b.valor));
  // Cadena ESTRICTAMENTE creciente: un número repetido no es una bajada, y entre un pico y la serie gana la serie
  // (la cola mínima de la cadena más larga).
  const tails: number[] = [];
  for (const { valor } of sorted) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] >= valor) hi = mid;
      else lo = mid + 1;
    }
    tails[lo] = valor;
  }
  return tails.length === 0 ? 0 : tails[tails.length - 1];
}

/**
 * Primer número de la banda reservada para los documentos históricos que no conservan su número
 * (texto, repetidos, vacíos, fuera de serie). Queda lejos de la serie viva, que sigue desde el máximo.
 */
export const LEGACY_NUMBER_BASE = 9_000_000;

export interface AssignOptions {
  /** Si se indica, los números nuevos salen de esta banda y no continúan la serie. */
  legacyBase?: number;
}

/**
 * Asigna el número de cada documento conservando el del Access cuando es un entero de serie
 * y no está repetido. Los repetidos (el más antiguo se queda con el número), los vacíos, los de
 * texto y los fuera de serie reciben un número nuevo a partir del máximo y quedan observados,
 * con el original guardado como referencia.
 */
export function assignDocumentNumbers(docs: NumberedDocument[], options: AssignOptions = {}): NumberAssignment {
  const classified = docs.map((d, index) => ({ d, index, c: classifyNumber(d.raw) }));
  // El máximo de la serie sale de la tendencia por fecha: un número tipeado de más (70045 entre pedidos de 23.000)
  // no cuenta, así la numeración nueva sigue donde corresponde.
  const inSeries = classified.filter((x) => x.c.enSerie);
  const seriesMax = trendMax(inSeries.filter((x) => x.d.fecha).map((x) => ({ valor: x.c.entero as number, fecha: x.d.fecha as string })));
  const aboveTrend = (x: (typeof classified)[number]): boolean => x.c.enSerie && (x.c.entero as number) > seriesMax;

  const byKey = new Map<string, AssignedNumber>();
  const used = new Set<number>();
  const ordered = [...classified].sort((a, b) => {
    const fa = a.d.fecha ?? '9999-12-31';
    const fb = b.d.fecha ?? '9999-12-31';
    return fa < fb ? -1 : fa > fb ? 1 : a.index - b.index;
  });

  const pending: typeof ordered = [];
  for (const x of ordered) {
    if (x.c.enSerie && !aboveTrend(x) && !used.has(x.c.entero as number)) {
      used.add(x.c.entero as number);
      byKey.set(x.d.key, { numero: x.c.entero as number, referenciaAccess: null, obs: null });
    } else {
      pending.push(x);
    }
  }

  let cursor = options.legacyBase !== undefined ? options.legacyBase : seriesMax;
  for (const x of pending) {
    cursor += 1;
    while (used.has(cursor)) cursor += 1;
    used.add(cursor);
    const original = x.c.texto;
    let obs: Observation;
    if (x.c.kind === 'VACIO') obs = { code: 'NUMERO_VACIO' };
    else if (x.c.kind === 'TEXTO') obs = { code: 'NUMERO_NO_NUMERICO', detail: original ?? undefined };
    else if (!x.c.enSerie || aboveTrend(x)) obs = { code: 'NUMERO_FUERA_DE_SERIE', detail: original ?? undefined };
    else obs = { code: 'NUMERO_REPETIDO', detail: original ?? undefined };
    byKey.set(x.d.key, { numero: cursor, referenciaAccess: original, obs });
  }
  return { byKey, seriesMax, lastAssigned: cursor };
}

/** Texto largo (memo) con sus saltos de línea: normaliza `\r\n`, recorta y deja un máximo de una línea en blanco. */
export function cleanMemo(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text === '' ? null : text;
}
