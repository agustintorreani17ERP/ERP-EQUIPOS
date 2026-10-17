/**
 * @file services/dispatchApi.ts
 * @description Notas de envío a oficina y a obra, pendientes de enviar y tipos de documento contra la API.
 */

import type {
  DispatchState,
  DocumentTypeDto,
  OfficeLineKind,
  OfficeNoteDto,
  PendingDocumentsDto,
  SentDocumentDto,
  SiteNoteDto,
  SiteNoteEventDto,
} from '../../shared/dispatch';
import { apiFetch } from './http';

export interface OfficeLineDraft {
  kind: OfficeLineKind;
  documentId?: string | null;
  documentTypeId?: string | null;
  numero?: string | null;
  supplierId?: string | null;
  fechaDocumento?: string | null;
  machineId?: string | null;
  observacion?: string | null;
}

export interface OfficeNoteDraft {
  fecha: string;
  observaciones?: string | null;
  lines: OfficeLineDraft[];
}

export interface SiteNoteDraft {
  fecha: string;
  worksiteId: string;
  chofer?: string | null;
  observaciones?: string | null;
  eventIds: string[];
}

export interface NoteFilters {
  estado?: DispatchState;
  desde?: string;
  hasta?: string;
  q?: string;
  obra?: string;
}

export interface SentFilters {
  desde?: string;
  hasta?: string;
  proveedor?: string;
  maquina?: string;
  tipo?: OfficeLineKind;
  tipoDocumento?: string;
  q?: string;
  incluirAnuladas?: boolean;
}

export interface DocumentTypeDraft {
  codigo: string;
  nombre: string;
  activo: boolean;
}

function toQuery(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== false);
  const normalized = entries.map(([k, v]) => [k, v === true ? 'true' : String(v)] as [string, string]);
  return normalized.length === 0 ? '' : `?${new URLSearchParams(normalized).toString()}`;
}

export const dispatchApi = {
  documentTypes: () => apiFetch<DocumentTypeDto[]>('/api/envios/tipos-documento'),
  createDocumentType: (draft: DocumentTypeDraft) => apiFetch<DocumentTypeDto>('/api/envios/tipos-documento', { method: 'POST', body: draft }),
  updateDocumentType: (id: string, draft: DocumentTypeDraft) =>
    apiFetch<DocumentTypeDto>(`/api/envios/tipos-documento/${id}`, { method: 'PUT', body: draft }),
  loadDefaultDocumentTypes: () => apiFetch<DocumentTypeDto[]>('/api/envios/tipos-documento/predeterminados', { method: 'POST' }),

  /** Nota vigente que incluye el documento, o null si todavía no se envió. */
  noteOfDocument: (kind: Exclude<OfficeLineKind, 'MANUAL'>, id: string) =>
    apiFetch<{ id: string; numero: number; fecha: string; estado: DispatchState } | null>(`/api/envios/oficina/de-documento/${kind}/${id}`),

  pending: (desde?: string) => apiFetch<PendingDocumentsDto>(`/api/envios/oficina/pendientes${toQuery({ desde })}`),
  sent: (filters: SentFilters = {}) => apiFetch<SentDocumentDto[]>(`/api/envios/documentos${toQuery(filters)}`),

  officeNotes: (filters: NoteFilters = {}) => apiFetch<OfficeNoteDto[]>(`/api/envios/oficina${toQuery(filters)}`),
  officeNote: (id: string) => apiFetch<OfficeNoteDto>(`/api/envios/oficina/${id}`),
  createOfficeNote: (draft: OfficeNoteDraft) => apiFetch<OfficeNoteDto>('/api/envios/oficina', { method: 'POST', body: draft }),
  updateOfficeNote: (id: string, draft: OfficeNoteDraft) => apiFetch<OfficeNoteDto>(`/api/envios/oficina/${id}`, { method: 'PUT', body: draft }),
  acknowledgeOfficeNote: (id: string, body: { fecha: string; recibidoPor: string }) =>
    apiFetch<OfficeNoteDto>(`/api/envios/oficina/${id}/recibir`, { method: 'POST', body }),
  cancelOfficeNote: (id: string, motivo: string) => apiFetch<OfficeNoteDto>(`/api/envios/oficina/${id}/anular`, { method: 'POST', body: { motivo } }),

  siteNotes: (filters: NoteFilters = {}) => apiFetch<SiteNoteDto[]>(`/api/envios/obra${toQuery(filters)}`),
  siteNote: (id: string) => apiFetch<SiteNoteDto>(`/api/envios/obra/${id}`),
  eventsWithoutNote: (filters: { obra?: string; desde?: string; hasta?: string } = {}) =>
    apiFetch<SiteNoteEventDto[]>(`/api/envios/obra/partes-sin-nota${toQuery(filters)}`),
  createSiteNote: (draft: SiteNoteDraft) => apiFetch<SiteNoteDto>('/api/envios/obra', { method: 'POST', body: draft }),
  updateSiteNote: (id: string, draft: SiteNoteDraft) => apiFetch<SiteNoteDto>(`/api/envios/obra/${id}`, { method: 'PUT', body: draft }),
  acknowledgeSiteNote: (id: string, body: { fecha: string; recibidoPor: string }) =>
    apiFetch<SiteNoteDto>(`/api/envios/obra/${id}/recibir`, { method: 'POST', body }),
  cancelSiteNote: (id: string, motivo: string) => apiFetch<SiteNoteDto>(`/api/envios/obra/${id}/anular`, { method: 'POST', body: { motivo } }),
};

/** Nota que otra parte (oficina central o una obra, vía el ERP) le manda al Taller. */
export interface IncomingNoteDto {
  id: string;
  anio: number;
  numero: number;
  etiqueta: string;
  fecha: string;
  sistemaOrigen: string;
  origenTipo: string;
  destinoTipo: string;
  contenido: 'DOCUMENTOS' | 'MATERIALES';
  chofer: string | null;
  observaciones: string | null;
  lineas: { descripcion: string; cantidad?: number | null; unidad?: string | null }[];
  estado: DispatchState;
  recibidoFecha: string | null;
  recibidoPor: string | null;
  anuladoMotivo: string | null;
}

export const incomingApi = {
  list: (estado?: DispatchState) => apiFetch<IncomingNoteDto[]>(`/api/envios/entrantes${toQuery({ estado })}`),
  acknowledge: (id: string, body: { fecha: string; recibidoPor: string }) =>
    apiFetch<IncomingNoteDto>(`/api/envios/entrantes/${id}/recibir`, { method: 'POST', body }),
};
