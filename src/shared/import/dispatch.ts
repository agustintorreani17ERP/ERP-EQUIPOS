// Notas de envío del Access: NOTA ENVIO (documentos a oficina, un renglón por documento) y los partes de
// «envío de repuestos» (notas a obra). La nota del Access se identificaba por su número escrito a mano
// (la fecha en texto, con sufijos); acá se agrupa por número + fecha y recibe un correlativo nuevo.
import { accessDate, cleanText, type Observation } from './common';
import type { AccessRow } from './fleet';

/** Tipos de documento del Access (TIPO DE DOC) → código nuevo. Los no listados usan `T{id}`. */
export const DOC_TYPE_CODE_BY_ACCESS_ID: Record<string, string> = {
  '1': 'PEDIDO',
  '2': 'RECEPCION',
  '3': 'SF',
  '4': 'FACTURA',
  '5': 'NOTA_CREDITO',
  '6': 'REMISION',
  '7': 'RECIBO',
  '8': 'PROVISION',
  '9': 'CEDULA_VERDE',
  '11': 'CHEQUE_DEVUELTO',
  '12': 'PRESUPUESTO',
  '13': 'RETENCION',
  '17': 'COMUNICACION',
  '19': 'ALQUILER',
  '20': 'SOBRE_OBRA',
  '21': 'COMBUSTIBLE',
  '22': 'ENVIO_INTERNO',
};

export function docTypeCode(accessId: string | null): string {
  if (!accessId) return 'OTRO';
  return DOC_TYPE_CODE_BY_ACCESS_ID[accessId] ?? `T${accessId}`;
}

export interface OfficeLineImport {
  legacyId: string;
  /** Número de la nota tal como estaba escrito («300725»). */
  notaRaw: string | null;
  /** Fecha de envío válida, o null. */
  fechaEnvio: string | null;
  fechaDocumento: string | null;
  tipoId: string | null;
  /** Número del documento (pedido, SF, factura…). */
  numeroDocumento: string | null;
  proveedorId: string | null;
  machineCode: string | null;
  observacion: string | null;
  obs: Observation[];
}

export function officeLineFromAccess(row: AccessRow, hoy: string): OfficeLineImport {
  const obs: Observation[] = [];
  const envio = accessDate(row['FECHA DE ENVIO'], hoy);
  const doc = accessDate(row['FECHA'], hoy);
  const segunda = [cleanText(row['FACUTRA']), cleanText(row['FACTURA O REMISION II']), cleanText(row['PROVEEDOR FACTURA']) ? `proveedor ${cleanText(row['PROVEEDOR FACTURA'])}` : null]
    .filter((x): x is string => x !== null)
    .join(' · ');
  const notes = [cleanText(row['OBS']), segunda ? `Documento 2: ${segunda}` : null].filter((x): x is string => x !== null).join(' · ');
  return {
    legacyId: cleanText(row['ID']) ?? '',
    notaRaw: cleanText(row['NO ENVIO']),
    fechaEnvio: envio.fecha,
    fechaDocumento: doc.fecha,
    tipoId: cleanText(row['TIPO DE DOC']),
    numeroDocumento: cleanText(row['FACTURA O REMISION']),
    proveedorId: cleanText(row['PROVEEDOR']),
    machineCode: cleanText(row['IdCódigo']),
    observacion: notes === '' ? null : notes.slice(0, 300),
    obs,
  };
}

export interface OfficeNoteGroup {
  key: string;
  notaRaw: string | null;
  fecha: string;
  lines: OfficeLineImport[];
  /** Cuántos renglones tomaron la fecha del documento por no tener una fecha de envío válida. */
  fechaSupuesta: number;
}

/**
 * Agrupa los renglones en notas por número + fecha de envío. Un renglón sin fecha de envío válida usa
 * la de su documento; si tampoco la tiene, queda fuera (se devuelve aparte para rechazarlo con sus datos).
 */
export function groupOfficeNotes(lines: OfficeLineImport[]): { groups: OfficeNoteGroup[]; sinFecha: OfficeLineImport[] } {
  const groups = new Map<string, OfficeNoteGroup>();
  const sinFecha: OfficeLineImport[] = [];
  for (const line of lines) {
    const fecha = line.fechaEnvio ?? line.fechaDocumento;
    if (!fecha) {
      sinFecha.push(line);
      continue;
    }
    const key = `${line.notaRaw ?? 'SIN-NUMERO'}|${fecha}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, notaRaw: line.notaRaw, fecha, lines: [], fechaSupuesta: 0 };
      groups.set(key, g);
    }
    g.lines.push(line);
    if (!line.fechaEnvio) g.fechaSupuesta += 1;
  }
  return { groups: [...groups.values()], sinFecha };
}

export interface SiteNoteEvent {
  id: string;
  fecha: string;
  worksiteId: string | null;
  notaRaw: string | null;
  enviaRepuestos: boolean;
}

export interface SiteNoteGroup {
  key: string;
  notaRaw: string;
  fecha: string;
  worksiteId: string;
  eventIds: string[];
}

/**
 * Notas a obra a partir de los partes de envío de repuestos con número de nota: una por número + obra de
 * destino + fecha. Los partes sin obra de destino no se pueden agrupar (la nota exige obra) y se devuelven aparte.
 */
export function groupSiteNotes(events: SiteNoteEvent[]): { groups: SiteNoteGroup[]; sinObra: SiteNoteEvent[] } {
  const groups = new Map<string, SiteNoteGroup>();
  const sinObra: SiteNoteEvent[] = [];
  for (const e of events) {
    if (!e.enviaRepuestos || !e.notaRaw) continue;
    if (!e.worksiteId) {
      sinObra.push(e);
      continue;
    }
    const key = `${e.notaRaw}|${e.worksiteId}|${e.fecha}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, notaRaw: e.notaRaw, fecha: e.fecha, worksiteId: e.worksiteId, eventIds: [] };
      groups.set(key, g);
    }
    g.eventIds.push(e.id);
  }
  return { groups: [...groups.values()], sinObra };
}
