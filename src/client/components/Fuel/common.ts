/**
 * @file components/Fuel/common.ts
 * @description Tipos y constantes compartidos por las pestañas de Combustibles.
 */

import type { CompanySettings } from '../../../shared/erp';
import type { FuelDepositDto, FuelMovementType, FuelProductDto } from '../../../shared/fuel';
import type { FleetMachine } from '../../services/fleetApi';
import type { Supplier } from '../../services/mastersApi';

export interface FuelRefs {
  products: FuelProductDto[];
  deposits: FuelDepositDto[];
  machines: FleetMachine[];
  suppliers: Supplier[];
  settings: CompanySettings;
}

export const TYPE_TONE: Record<FuelMovementType, 'warn' | 'good' | 'info' | 'violet'> = {
  DESPACHO: 'warn',
  ENTRADA: 'good',
  SALDO_INICIAL: 'info',
  AJUSTE: 'violet',
};

export const DEPOSIT_TYPE_LABEL = { OBRA: 'Obra', CISTERNA: 'Cisterna', OTRO: 'Otro' } as const;
export const UNIT_LABEL = { L: 'L', KG: 'kg', U: 'u' } as const;

/** Producto principal de un despacho: el gasoil del catálogo. */
export function findGasoil(products: FuelProductDto[]): FuelProductDto | undefined {
  return products.find((p) => p.codigo === 'GASOIL') ?? products.find((p) => p.categoria === 'COMBUSTIBLE' && p.activo);
}
