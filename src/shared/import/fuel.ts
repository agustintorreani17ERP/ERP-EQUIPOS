// Combustibles y lubricantes del Access (ACGAS2012, tabla ancha de 92 columnas) → vales con renglones.
// Una fila puede ser un despacho (columnas de consumo), una entrada (columnas «ENVIO»/«ENTRADA») o,
// rara vez, las dos cosas: en ese caso salen dos vales.
import { DEFAULT_FUEL_PRODUCTS, LEGACY_FUEL_COLUMNS } from '../fuel';
import { accessDate, accessNumber, cleanText, type Observation } from './common';
import type { AccessRow } from './fleet';

export interface FuelLineImport {
  /** Código del producto nuevo (`GASOIL`, `15W40`…). */
  producto: string;
  cantidad: number;
}

export interface FuelMovementImport {
  /** Fila del Access (empezando en 1): la tabla no tiene clave propia. */
  legacyId: string;
  tipo: 'DESPACHO' | 'ENTRADA';
  fecha: string;
  /** Id del depósito en la lista de obras (campo «DESPACHADO POR»). */
  depositoKey: string | null;
  machineCode: string | null;
  terceroChapa: string | null;
  proveidoA: string | null;
  descripcion: string | null;
  remision: string | null;
  /** Horas o kilómetros de la máquina en el despacho. */
  lectura: number | null;
  lines: FuelLineImport[];
  obs: Observation[];
}

/** Productos de cada columna, separados por tipo. Las columnas sin producto conocido se ignoran. */
const DISPATCH_COLUMNS = Object.entries(LEGACY_FUEL_COLUMNS).filter(([, v]) => v.tipo === 'DESPACHO');
const ENTRY_COLUMNS = Object.entries(LEGACY_FUEL_COLUMNS).filter(([, v]) => v.tipo === 'ENTRADA');

function linesOf(row: AccessRow, columns: [string, { producto: string }][]): FuelLineImport[] {
  const byProduct = new Map<string, number>();
  for (const [column, { producto }] of columns) {
    const n = accessNumber(row[column]);
    if (n !== null && n > 0) byProduct.set(producto, (byProduct.get(producto) ?? 0) + n);
  }
  return [...byProduct.entries()].map(([producto, cantidad]) => ({ producto, cantidad }));
}

/**
 * Vales de una fila. `enKm` indica si la máquina mide en kilómetros: define cuál columna de lectura
 * se toma primero (`HS/KMS` para km, `HORAS` para horas).
 */
export function fuelMovementsFromAccess(row: AccessRow, index: number, hoy: string, enKm: boolean): FuelMovementImport[] {
  const fecha = accessDate(row['Fecha'], hoy);
  if (!fecha.fecha) return [];
  const legacyId = String(index + 1);
  const common = { legacyId, fecha: fecha.fecha, depositoKey: cleanText(row['DESPACHADO POR']), descripcion: cleanText(row['GASOIL DESCRIPCION']), remision: cleanText(row['REMISION']) };
  const out: FuelMovementImport[] = [];

  const despacho = linesOf(row, DISPATCH_COLUMNS);
  if (despacho.length > 0) {
    const obs: Observation[] = [];
    const machineCode = cleanText(row['Código']);
    let terceroChapa = cleanText(row['CHAPA TERCEROS']);
    let descripcion = common.descripcion;
    if (machineCode && terceroChapa) {
      // El modelo nuevo no admite máquina y tercero a la vez: se conserva la máquina y la chapa pasa al texto.
      descripcion = [descripcion, `Chapa de tercero: ${terceroChapa}`].filter(Boolean).join(' · ');
      terceroChapa = null;
      obs.push({ code: 'OTRO', detail: 'Máquina y chapa de tercero a la vez: la chapa quedó en la descripción' });
    }
    const hs = accessNumber(row['HORAS']);
    const km = accessNumber(row['HS/KMS']);
    const preferred = enKm ? km : hs;
    const fallback = enKm ? hs : km;
    const lectura = preferred !== null && preferred > 0 ? preferred : fallback !== null && fallback > 0 ? fallback : null;
    out.push({
      ...common,
      tipo: 'DESPACHO',
      machineCode,
      terceroChapa,
      proveidoA: cleanText(row['PROVEIDO A']),
      descripcion,
      lectura: machineCode ? lectura : null,
      lines: despacho,
      obs,
    });
  }

  const entrada = linesOf(row, ENTRY_COLUMNS);
  if (entrada.length > 0) {
    out.push({ ...common, tipo: 'ENTRADA', machineCode: null, terceroChapa: null, proveidoA: null, lectura: null, lines: entrada, obs: [] });
  }
  return out;
}

export { DEFAULT_FUEL_PRODUCTS };
