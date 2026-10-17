// Notas de envío: a oficina central (documentos en papel) y a obra (repuestos).
// Dominio puro, sin acceso a datos. Reemplaza NOTA ENVIO y los partes con «envío repuestos».
import { dayDiff } from './fleet';
import { isValidDocumentDate } from './finance';

export type DispatchState = 'ENVIADA' | 'RECIBIDA' | 'ANULADA';
export type OfficeLineKind = 'PEDIDO' | 'RECEPCION' | 'SF' | 'RENDICION' | 'MANUAL';
export type DelayBucket = 'HASTA_3' | 'DE_4_A_15' | 'DE_16_A_60' | 'MAS_DE_60';

export const OFFICE_LINE_KIND_LABEL: Record<OfficeLineKind, string> = {
  PEDIDO: 'Pedido de materiales',
  RECEPCION: 'Recepción',
  SF: 'Solicitud de fondos',
  RENDICION: 'Rendición de caja chica',
  MANUAL: 'Documento manual',
};

export const DELAY_BUCKET_LABEL: Record<DelayBucket, string> = {
  HASTA_3: 'Hasta 3 días',
  DE_4_A_15: '4 a 15 días',
  DE_16_A_60: '16 a 60 días',
  MAS_DE_60: 'Más de 60 días',
};

/** Tipos del catálogo del Access sin los de recursos humanos (sueldos, renuncia, reposo…). */
export const DEFAULT_DOCUMENT_TYPES: { codigo: string; nombre: string }[] = [
  { codigo: 'FACTURA', nombre: 'Factura' },
  { codigo: 'NOTA_CREDITO', nombre: 'Nota de crédito' },
  { codigo: 'REMISION', nombre: 'Nota de remisión' },
  { codigo: 'RECIBO', nombre: 'Recibo de dinero' },
  { codigo: 'PROVISION', nombre: 'Provisión de materiales' },
  { codigo: 'CEDULA_VERDE', nombre: 'Cédula verde' },
  { codigo: 'CHEQUE_DEVUELTO', nombre: 'Cheque devuelto' },
  { codigo: 'PRESUPUESTO', nombre: 'Presupuesto' },
  { codigo: 'RETENCION', nombre: 'Comprobante de retención' },
  { codigo: 'COMUNICACION', nombre: 'Comunicación interna' },
  { codigo: 'ALQUILER', nombre: 'Reporte mensual de alquiler de máquinas' },
  { codigo: 'SOBRE_OBRA', nombre: 'Sobre de obra' },
  { codigo: 'COMBUSTIBLE', nombre: 'Reporte de combustible' },
  { codigo: 'ENVIO_INTERNO', nombre: 'Envío interno' },
  { codigo: 'OTRO', nombre: 'Otro' },
];

export function canEditNote(state: DispatchState): boolean {
  return state === 'ENVIADA';
}

export interface OfficeLineDraft {
  kind: OfficeLineKind;
  /** Id del documento del ERP; obligatorio salvo en renglones manuales. */
  documentId?: string | null;
  documentTypeId?: string | null;
  numero?: string | null;
  fechaDocumento?: string | null;
}

/** Clave para detectar el mismo documento dos veces dentro de una nota. */
export function lineKey(line: OfficeLineDraft): string {
  if (line.kind === 'MANUAL') {
    return `M|${line.documentTypeId ?? ''}|${(line.numero ?? '').trim().toUpperCase()}`;
  }
  return `${line.kind}|${line.documentId ?? ''}`;
}

export function validateOfficeNote(
  draft: { fecha: string; lines: OfficeLineDraft[] },
  hoy: string,
): string[] {
  const errors: string[] = [];
  if (!isValidDocumentDate(draft.fecha, hoy)) errors.push('La fecha de envío no es válida.');
  if (draft.lines.length === 0) errors.push('La nota debe incluir al menos un documento.');
  const seen = new Set<string>();
  draft.lines.forEach((line, i) => {
    const n = i + 1;
    if (line.kind === 'MANUAL') {
      if (!line.documentTypeId) errors.push(`Renglón ${n}: falta el tipo de documento.`);
      if (!line.numero || line.numero.trim().length === 0) errors.push(`Renglón ${n}: falta el número del documento.`);
      if (line.fechaDocumento && !isValidDocumentDate(line.fechaDocumento, hoy)) {
        errors.push(`Renglón ${n}: la fecha del documento no es válida.`);
      }
    } else if (!line.documentId) {
      errors.push(`Renglón ${n}: falta elegir el documento.`);
    }
    const key = lineKey(line);
    if (seen.has(key)) errors.push(`Renglón ${n}: el documento está repetido en la nota.`);
    seen.add(key);
  });
  return errors;
}

export function validateSiteNote(
  draft: { fecha: string; worksiteId?: string | null; eventIds: string[] },
  hoy: string,
): string[] {
  const errors: string[] = [];
  if (!isValidDocumentDate(draft.fecha, hoy)) errors.push('La fecha no es válida.');
  if (!draft.worksiteId) errors.push('Falta la obra de destino.');
  if (draft.eventIds.length === 0) errors.push('La nota debe incluir al menos un envío.');
  if (new Set(draft.eventIds).size !== draft.eventIds.length) errors.push('Hay envíos repetidos en la nota.');
  return errors;
}

export function validateAcknowledge(
  input: { fechaEnvio: string; fechaRecibido: string; recibidoPor?: string | null },
  hoy: string,
): string[] {
  const errors: string[] = [];
  if (!isValidDocumentDate(input.fechaRecibido, hoy)) errors.push('La fecha de recibido no es válida.');
  else if (input.fechaRecibido < input.fechaEnvio) errors.push('La fecha de recibido no puede ser anterior al envío.');
  if (!input.recibidoPor || input.recibidoPor.trim().length < 2) errors.push('Indicá quién recibió.');
  return errors;
}

/** Días entre el documento y su envío a la oficina. Negativo si el envío es anterior (dato sospechoso). */
export function dispatchDelayDays(fechaDocumento: string, fechaEnvio: string): number {
  return dayDiff(fechaDocumento, fechaEnvio);
}

export function dispatchDelayBucket(fechaDocumento: string, fechaEnvio: string): DelayBucket {
  const days = dispatchDelayDays(fechaDocumento, fechaEnvio);
  if (days <= 3) return 'HASTA_3';
  if (days <= 15) return 'DE_4_A_15';
  if (days <= 60) return 'DE_16_A_60';
  return 'MAS_DE_60';
}

/** Advertencia (no bloqueo) cuando el documento es posterior al envío. */
export function documentAfterDispatch(fechaDocumento: string, fechaEnvio: string): boolean {
  return fechaDocumento > fechaEnvio;
}

/** Número de nota del Access: la fecha como DDMMAA («300725» = 2025-07-30). Solo para validar contra datos reales. */
export function parseLegacyNoteNumber(text: string | null | undefined): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec((text ?? '').trim());
  if (!m) return null;
  const iso = `20${m[3]}-${m[2]}-${m[1]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/* ─── DTOs de la API ───────────────────────────────────────────────────── */

export interface DocumentTypeDto {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
}

export interface RefDto {
  id: string;
  nombre: string;
}

export interface MachineRefDto {
  id: string;
  codigo: string;
  descripcion: string;
}

export interface OfficeLineDto {
  id: string;
  position: number;
  kind: OfficeLineKind;
  /** Id del pedido, recepción, SF o rendición; null en los manuales. */
  documentId: string | null;
  documentTypeId: string | null;
  documentTypeNombre: string | null;
  numero: string | null;
  supplier: RefDto | null;
  fechaDocumento: string | null;
  machine: MachineRefDto | null;
  observacion: string | null;
  /** Factura o remisión (recepción) o concepto (SF). */
  detalle: string | null;
}

export interface OfficeNoteDto {
  id: string;
  numero: number;
  fecha: string;
  estado: DispatchState;
  recibidoFecha: string | null;
  recibidoPor: string | null;
  observaciones: string | null;
  anuladoMotivo: string | null;
  lineCount: number;
  /** Solo en el detalle. */
  lines?: OfficeLineDto[];
  /** Documentos con fecha posterior al envío (advertencia). */
  advertencias?: string[];
}

export interface PendingDocumentDto {
  kind: Exclude<OfficeLineKind, 'MANUAL'>;
  id: string;
  numero: number;
  /** Año de la numeración anual (SF y rendiciones); null en pedidos y recepciones. */
  anio: number | null;
  fecha: string;
  supplier: RefDto | null;
  machine: MachineRefDto | null;
  detalle: string | null;
  dias: number;
}

export interface PendingDocumentsDto {
  hoy: string;
  desde: string;
  conteo: Record<Exclude<OfficeLineKind, 'MANUAL'>, number>;
  items: PendingDocumentDto[];
}

export interface SiteNoteEventDto {
  id: string;
  fecha: string;
  machine: MachineRefDto;
  descripcion: string;
}

export interface SiteNoteDto {
  id: string;
  numero: number;
  fecha: string;
  estado: DispatchState;
  worksite: RefDto;
  chofer: string | null;
  recibidoFecha: string | null;
  recibidoPor: string | null;
  observaciones: string | null;
  anuladoMotivo: string | null;
  eventCount: number;
  /** Solo en el detalle. */
  events?: SiteNoteEventDto[];
}

/** Un renglón enviado a oficina, con los datos de su nota (consulta «documentos enviados»). */
export interface SentDocumentDto extends OfficeLineDto {
  noteId: string;
  noteNumero: number;
  noteFecha: string;
  noteEstado: DispatchState;
}
