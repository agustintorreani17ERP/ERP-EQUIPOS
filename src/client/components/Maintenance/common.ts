/**
 * @file components/Maintenance/common.ts
 * @description Tipos y constantes compartidos por las pestañas de Mantenimiento.
 */

import type { CompanySettings } from '../../../shared/erp';
import type { LatenessBucket, ProgramStatus, ServiceOrderState, ServiceTypeDto } from '../../../shared/maintenance';
import type { PillTone } from '../../ui';
import type { Worksite } from '../../services/mastersApi';

export interface MaintenanceRefs {
  types: ServiceTypeDto[];
  worksites: Worksite[];
  settings: CompanySettings;
}

export const STATUS_LABEL: Record<ProgramStatus, string> = {
  VENCIDO: 'Vencido',
  PROXIMO: 'Próximo',
  VIGENTE: 'Vigente',
  SIN_LECTURA: 'Sin lectura',
  SIN_PLAN: 'Sin plan',
};

export const STATUS_TONE: Record<ProgramStatus, PillTone> = {
  VENCIDO: 'bad',
  PROXIMO: 'warn',
  VIGENTE: 'good',
  SIN_LECTURA: 'neutral',
  SIN_PLAN: 'neutral',
};

export const ORDER_LABEL: Record<ServiceOrderState, string> = { EMITIDA: 'Emitida', REALIZADA: 'Realizada', ANULADA: 'Anulada' };
export const ORDER_TONE: Record<ServiceOrderState, PillTone> = { EMITIDA: 'warn', REALIZADA: 'good', ANULADA: 'neutral' };

export const BUCKET_TONE: Record<LatenessBucket, PillTone> = { A_TIEMPO: 'good', HASTA_50: 'info', DE_51_A_150: 'warn', MAS_DE_150: 'bad' };

export const GROUP_LABEL = { CAMBIO: 'Cambio', CONTROL: 'Control', DRENAR: 'Drenar', LUBRICACION: 'Lubricación' } as const;

export const unitLabel = (unit: 'HS' | 'KM') => (unit === 'HS' ? 'hs' : 'km');
