/**
 * @file components/Finance/common.ts
 * @description Tipos y constantes compartidas por las pestañas de Fondos.
 */

import type { AccountRef, FundRequestDto, FundRequestStatus } from '../../../shared/finance';
import { amountInWords, round2 } from '../../../shared/finance';
import type { CompanySettings } from '../../../shared/erp';
import type { FleetMachine } from '../../services/fleetApi';
import type { Supplier } from '../../services/mastersApi';
import type { CurrencyTotals } from '../../services/financeApi';

export interface FinanceRefs {
  suppliers: Supplier[];
  accounts: AccountRef[];
  machines: FleetMachine[];
  settings: CompanySettings;
}

export const FUND_LABEL: Record<FundRequestStatus, string> = {
  SOLICITADA: 'Solicitada',
  PAGO_PARCIAL: 'Pago parcial',
  PAGADA: 'Pagada',
  ANULADA: 'Anulada',
};

export const FUND_TONE: Record<FundRequestStatus, 'warn' | 'info' | 'good' | 'bad'> = {
  SOLICITADA: 'warn',
  PAGO_PARCIAL: 'info',
  PAGADA: 'good',
  ANULADA: 'bad',
};

export const LETTERHEAD_LABEL: Record<string, string> = {
  ccc: 'C.C.C. S.A.',
  consorcio: 'Consorcio',
  papel_comun: 'Papel común',
};

/** Totales por moneda de una lista de SF, sin contar las anuladas. */
export function totalsOf(list: FundRequestDto[]): CurrencyTotals {
  const out: CurrencyTotals = {};
  for (const sf of list.filter((s) => !s.anulado)) {
    const t = (out[sf.currency] ??= { monto: 0, pagado: 0, saldo: 0 });
    t.monto = round2(t.monto + sf.monto);
    t.pagado = round2(t.pagado + sf.pagado);
    t.saldo = round2(t.saldo + sf.saldo);
  }
  return out;
}

/** Monto en letras para mostrar mientras se escribe: devuelve vacío si el monto todavía no es válido. */
export function wordsPreview(amount: number, currency: string): string {
  try {
    return amountInWords(amount, currency);
  } catch {
    return '';
  }
}
