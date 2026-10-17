// Stock de repuestos del Access (STOCK TALLER CREAR ITEM y STOCK TALLER ENTRADA Y SALIDA) → artículos y vales.
// El identificador real del artículo es `ARTICULO` (número de parte). Las cantidades vienen como texto.
import { normalizeMachineCode } from '../fleet';
import { normalizeArticleCode } from '../stock';
import { accessDate, accessNumber, cleanText, type Observation } from './common';
import type { AccessRow } from './fleet';

export interface ArticleImport {
  codigo: string;
  codigoNorm: string;
  descripcion: string;
  rubro: 'FILTROS' | 'ACEITES' | 'BATERIAS' | 'CUBIERTAS' | 'REPUESTOS';
  aplicacion: string | null;
  equivalencias: { marca: string; codigo: string }[];
  obs: Observation[];
}

const EQUIVALENCE_COLUMNS: [column: string, marca: string][] = [
  ['No WIX', 'WIX'],
  ['No TECFIL', 'TECFIL'],
  ['No CAT', 'CAT'],
  ['No MANN', 'MANN'],
  ['No VOLVO', 'VOLVO'],
  ['No DONALDSON', 'DONALDSON'],
  ['No CTP', 'CTP'],
];

/** Rubro por la descripción: las casillas de rubro del Access están vacías. */
export function inferRubro(descripcion: string): ArticleImport['rubro'] {
  const d = descripcion.toUpperCase();
  if (/\bFILTRO/.test(d)) return 'FILTROS';
  if (/\bACEITE|\bLUBRICANTE/.test(d)) return 'ACEITES';
  if (/\bBATERIA/.test(d)) return 'BATERIAS';
  if (/\bCUBIERTA|\bNEUMATIC|\bLLANTA/.test(d)) return 'CUBIERTAS';
  return 'REPUESTOS';
}

export function articleFromAccess(row: AccessRow): ArticleImport | null {
  const codigo = cleanText(row['ARTICULO']);
  if (!codigo) return null;
  const obs: Observation[] = [];
  let descripcion = cleanText(row['DESCRIPCION']);
  if (!descripcion) {
    descripcion = codigo;
    obs.push({ code: 'DESCRIPCION_VACIA' });
  }
  const equivalencias: { marca: string; codigo: string }[] = [];
  for (const [column, marca] of EQUIVALENCE_COLUMNS) {
    const code = cleanText(row[column]);
    if (code) equivalencias.push({ marca, codigo: code.slice(0, 40) });
  }
  return {
    codigo: codigo.slice(0, 40),
    codigoNorm: normalizeArticleCode(codigo),
    descripcion: descripcion.slice(0, 200),
    rubro: inferRubro(descripcion),
    aplicacion: cleanText(row['UTILIZACION'])?.slice(0, 500) ?? null,
    equivalencias,
    obs,
  };
}

/**
 * Une las filas del maestro con el mismo código (normalizado): se conserva la primera descripción y se
 * suman las equivalencias que no estén. Devuelve los artículos y cuántas filas se unieron.
 */
export function mergeArticles(list: ArticleImport[]): { articles: ArticleImport[]; merged: number } {
  const byNorm = new Map<string, ArticleImport>();
  let merged = 0;
  for (const a of list) {
    const found = byNorm.get(a.codigoNorm);
    if (!found) {
      byNorm.set(a.codigoNorm, { ...a, equivalencias: [...a.equivalencias], obs: [...a.obs] });
      continue;
    }
    merged += 1;
    for (const e of a.equivalencias) {
      if (!found.equivalencias.some((x) => x.marca === e.marca && x.codigo === e.codigo)) found.equivalencias.push(e);
    }
    if (!found.aplicacion && a.aplicacion) found.aplicacion = a.aplicacion;
    if (!found.obs.some((o) => o.code === 'NUMERO_REPETIDO')) found.obs.push({ code: 'NUMERO_REPETIDO', detail: 'Código repetido en el maestro: las filas se unieron' });
  }
  return { articles: [...byNorm.values()], merged };
}

export interface StockMovementImport {
  legacyId: string;
  tipo: 'ENTRADA' | 'SALIDA';
  fecha: string | null;
  articleCode: string | null;
  cantidad: number | null;
  /** Destino de una salida: el Access escribía el código de la máquina en «OBS SALIDA» («20 64 06»). */
  machineCode: string | null;
  proveedor: string | null;
  remision: string | null;
  nroRecepcionado: string | null;
  notaEnvio: string | null;
  ubicacion: string | null;
  observaciones: string | null;
  obs: Observation[];
}

/** Código de máquina de un texto como «20 64 06» o «206406»: seis dígitos, con o sin espacios. */
export function machineCodeFromText(text: string | null): string | null {
  if (!text) return null;
  const m = /^\s*(\d{2})\s*[- ]?\s*(\d{2})\s*[- ]?\s*(\d{2})\b/.exec(text);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/** Una fila del libro de movimientos: entrada (CANT RECIB) y/o salida (SALIDA), ambas en texto. */
export function stockMovementsFromAccess(row: AccessRow, hoy: string): StockMovementImport[] {
  const fecha = accessDate(row['FECHA'], hoy);
  const base = {
    legacyId: cleanText(row['ID']) ?? '',
    fecha: fecha.fecha,
    articleCode: cleanText(row['ARTICULO']),
    proveedor: cleanText(row['PROVEEDOR']),
    remision: cleanText(row['REMISION RECIB']),
    nroRecepcionado: cleanText(row['NRO RECEPCIONADO']),
    notaEnvio: cleanText(row['NOTA DE ENVIO']),
    ubicacion: cleanText(row['UBICACION']),
  };
  const out: StockMovementImport[] = [];
  const entrada = accessNumber(row['CANT RECIB']);
  const salida = accessNumber(row['SALIDA']);
  const hasEntry = cleanText(row['CANT RECIB']) !== null;
  const hasExit = cleanText(row['SALIDA']) !== null;

  if (hasEntry) {
    const obs: Observation[] = fecha.obs ? [fecha.obs] : [];
    if (entrada === null || entrada <= 0) obs.push({ code: 'CANTIDAD_INVALIDA', detail: String(row['CANT RECIB']) });
    out.push({
      ...base, tipo: 'ENTRADA', cantidad: entrada !== null && entrada > 0 ? entrada : null, machineCode: null,
      observaciones: cleanText(row['OBS RECEPCION']), obs,
    });
  }
  if (hasExit) {
    const obs: Observation[] = fecha.obs ? [fecha.obs] : [];
    if (salida === null || salida <= 0) obs.push({ code: 'CANTIDAD_INVALIDA', detail: String(row['SALIDA']) });
    const destino = cleanText(row['OBS SALIDA']);
    out.push({
      ...base, tipo: 'SALIDA', cantidad: salida !== null && salida > 0 ? salida : null, machineCode: machineCodeFromText(destino),
      observaciones: destino, obs,
    });
  }
  return out;
}

/** Ubicación de estantería normalizada («dep 2», «DEP2», «DEP`2» → «DEP 2»); vacío si no se puede leer. */
export function normalizeLocation(text: string | null): string | null {
  if (!text) return null;
  const t = text.toUpperCase().replace(/[`´'’]/g, ' ').replace(/\s+/g, ' ').trim();
  const dep = /^DEP\s*(\w+)$/.exec(t);
  if (dep) return `DEP ${dep[1]}`.slice(0, 40);
  return t === '' ? null : t.slice(0, 40);
}

export { normalizeMachineCode };
