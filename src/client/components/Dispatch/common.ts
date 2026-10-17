/**
 * @file components/Dispatch/common.ts
 * @description Tipos y constantes compartidos por las pestañas de Notas de envío.
 */

import type { CompanySettings } from '../../../shared/erp';
import type { DispatchState, DocumentTypeDto, OfficeLineKind } from '../../../shared/dispatch';
import type { FleetMachine } from '../../services/fleetApi';
import type { Supplier, Worksite } from '../../services/mastersApi';

export interface DispatchRefs {
  documentTypes: DocumentTypeDto[];
  suppliers: Supplier[];
  machines: FleetMachine[];
  worksites: Worksite[];
  settings: CompanySettings;
}

export const STATE_LABEL: Record<DispatchState, string> = {
  ENVIADA: 'Enviada',
  RECIBIDA: 'Recibida',
  ANULADA: 'Anulada',
};

export const STATE_TONE: Record<DispatchState, 'warn' | 'good' | 'bad'> = {
  ENVIADA: 'warn',
  RECIBIDA: 'good',
  ANULADA: 'bad',
};

export const KIND_SHORT: Record<OfficeLineKind, string> = {
  PEDIDO: 'Pedido',
  RECEPCION: 'Recepción',
  SF: 'SF',
  RENDICION: 'Rendición',
  MANUAL: 'Manual',
};

/** Días a partir de los cuales un documento sin enviar se resalta. */
export const OLD_PENDING_DAYS = 15;
