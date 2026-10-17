/**
 * @file shared/finance.ts
 * @description Reglas de caja chica, solicitudes de fondos (SF) y estado de cuentas. Reemplazan:
 * - el «monto en letras» que se escribía a mano en CAJA CHICA,
 * - las casillas RECIBI / A PAGAR / PAGO por estados calculados de los pagos registrados,
 * - `Sum(GS) - Sum(PAGO)` del informe ESTADO DE CUENTAS POR SUPLIDOR, con saldo por moneda.
 * Puro: sin acceso a base de datos, testeable y compartido por cliente y servidor.
 */

import { dayDiff } from './fleet';

export type WordsStyle = 'TRADICIONAL' | 'MODERNO';
export type FundRequestStatus = 'SOLICITADA' | 'PAGO_PARCIAL' | 'PAGADA' | 'ANULADA';

const MAX_WORDS = 999_999_999_999;

/** Redondeo a centavos: los montos se guardan con dos decimales. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ─── Monto en letras ──────────────────────────────────────────────────── */

const UNITS = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const TEENS = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
const TWENTIES = ['VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const TENS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const HUNDREDS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

const CURRENCY_NAMES: Record<string, [string, string]> = {
  PYG: ['GUARANÍ', 'GUARANÍES'],
  USD: ['DÓLAR AMERICANO', 'DÓLARES AMERICANOS'],
};

/** «apocope»: «uno» pasa a «un» delante de un sustantivo (un millón, treinta y un mil, un guaraní). */
function underHundred(n: number, style: WordsStyle, apocope: boolean): string {
  if (n === 0) return '';
  const unit = (d: number) => (d === 1 && apocope ? 'UN' : UNITS[d]);
  if (n < 10) return unit(n);
  if (n < 20) {
    // Estilo del Access: diez y seis… diez y nueve. El moderno junta: dieciséis… diecinueve.
    if (style === 'MODERNO' || n <= 15) return TEENS[n - 10];
    return `DIEZ Y ${unit(n - 10)}`;
  }
  if (n < 30) {
    if (style === 'MODERNO') {
      if (n === 21) return apocope ? 'VEINTIÚN' : 'VEINTIUNO';
      return TWENTIES[n - 20];
    }
    return n === 20 ? 'VEINTE' : `VEINTE Y ${unit(n - 20)}`;
  }
  const tens = Math.floor(n / 10);
  const units = n % 10;
  return units === 0 ? TENS[tens] : `${TENS[tens]} Y ${unit(units)}`;
}

function underThousand(n: number, style: WordsStyle, apocope: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return underHundred(rest, style, apocope);
  if (n === 100) return 'CIEN';
  return rest === 0 ? HUNDREDS[hundreds] : `${HUNDREDS[hundreds]} ${underHundred(rest, style, apocope)}`;
}

function underMillion(n: number, style: WordsStyle, apocopeFinal: boolean): string {
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (thousands > 0) parts.push(thousands === 1 ? 'MIL' : `${underThousand(thousands, style, true)} MIL`);
  if (rest > 0) parts.push(underThousand(rest, style, apocopeFinal));
  return parts.join(' ');
}

/** Número entero a letras, en mayúsculas, hasta 999.999.999.999. */
export function numberToWords(n: number, opts: { style?: WordsStyle; apocopeFinal?: boolean } = {}): string {
  const style = opts.style ?? 'TRADICIONAL';
  const apocopeFinal = opts.apocopeFinal ?? false;
  if (!Number.isInteger(n) || n < 0 || n > MAX_WORDS) {
    throw new RangeError('El número debe ser un entero entre 0 y 999.999.999.999.');
  }
  if (n === 0) return 'CERO';
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  const parts: string[] = [];
  if (millions > 0) parts.push(millions === 1 ? 'UN MILLÓN' : `${underMillion(millions, style, true)} MILLONES`);
  if (rest > 0) parts.push(underMillion(rest, style, apocopeFinal));
  return parts.join(' ');
}

/**
 * Monto en letras con la moneda al final: «DOS MILLONES DE GUARANÍES»,
 * «CIENTO CINCUENTA CON 50/100 DÓLARES AMERICANOS».
 */
export function amountInWords(amount: number, currency: string, style: WordsStyle = 'TRADICIONAL'): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError('El monto debe ser un número igual o mayor a 0.');
  }
  const cents = Math.round(amount * 100);
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  const words = numberToWords(whole, { style, apocopeFinal: true });
  const [singular, plural] = CURRENCY_NAMES[currency] ?? [currency, currency];
  const noun = whole === 1 && rest === 0 ? singular : plural;
  const fraction = rest > 0 ? ` CON ${String(rest).padStart(2, '0')}/100` : '';
  const de = rest === 0 && whole > 0 && whole % 1_000_000 === 0 ? ' DE' : '';
  return `${words}${fraction}${de} ${noun}`;
}

/* ─── Estados y validaciones ───────────────────────────────────────────── */

/** Estado de una SF a partir de lo pagado. La anulación gana sobre los pagos. */
export function fundRequestStatus(input: { anulada: boolean; monto: number; pagado: number }): FundRequestStatus {
  if (input.anulada) return 'ANULADA';
  const pagado = round2(input.pagado);
  if (pagado >= round2(input.monto)) return 'PAGADA';
  if (pagado > 0) return 'PAGO_PARCIAL';
  return 'SOLICITADA';
}

/**
 * Fechas válidas para documentos: formato AAAA-MM-DD, no anteriores al 2000 ni más de un año
 * hacia adelante. El Access tenía fechas de 1961 y de 2032.
 */
export function isValidDocumentDate(fecha: string, hoy: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const parsed = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fecha) return false;
  return fecha >= '2000-01-01' && dayDiff(hoy, fecha) <= 366;
}

function validateAmount(monto: number): string | null {
  if (!Number.isFinite(monto) || monto <= 0) return 'El monto debe ser mayor a 0.';
  if (monto > 9_999_999_999_999) return 'El monto es demasiado grande.';
  return null;
}

export function validateFundRequestDraft(
  draft: { fecha: string; supplierId?: string | null; monto: number; currency: string; concepto: string },
  hoy: string,
  currencies: string[],
): string[] {
  const errors: string[] = [];
  if (!draft.supplierId) errors.push('El proveedor es obligatorio.');
  const amountError = validateAmount(draft.monto);
  if (amountError) errors.push(amountError);
  if (!isValidDocumentDate(draft.fecha, hoy)) errors.push('La fecha no es válida.');
  if (!draft.concepto || draft.concepto.trim().length < 3) errors.push('Debe especificar un concepto o justificación.');
  if (!currencies.includes(draft.currency)) errors.push(`La moneda debe ser ${currencies.join(' o ')}.`);
  return errors;
}

export function validatePettyCashLine(
  line: { fecha: string; supplierId?: string | null; monto: number; aCredito?: boolean },
  hoy: string,
): string[] {
  const errors: string[] = [];
  // El proveedor es opcional (peajes, viáticos), salvo a crédito: sin él no hay cuenta a la que cargar.
  if (line.aCredito && !line.supplierId) errors.push('Un gasto a crédito necesita proveedor.');
  const amountError = validateAmount(line.monto);
  if (amountError) errors.push(amountError);
  if (!isValidDocumentDate(line.fecha, hoy)) errors.push('La fecha no es válida.');
  return errors;
}

/* ─── Totales de rendición ─────────────────────────────────────────────── */

export interface SheetTotals {
  total: number;
  porCuenta: { clave: string | null; total: number }[];
  porMaquina: { clave: string | null; total: number }[];
}

function groupTotals(lines: { monto: number }[], keyOf: (i: number) => string | null): { clave: string | null; total: number }[] {
  const totals = new Map<string | null, number>();
  lines.forEach((l, i) => totals.set(keyOf(i), round2((totals.get(keyOf(i)) ?? 0) + l.monto)));
  return [...totals.entries()].map(([clave, total]) => ({ clave, total })).sort((a, b) => b.total - a.total);
}

/** Total de una rendición y su desglose por cuenta y por máquina. */
export function sheetTotals(lines: { monto: number; accountId?: string | null; machineId?: string | null }[]): SheetTotals {
  return {
    total: round2(lines.reduce((acc, l) => acc + l.monto, 0)),
    porCuenta: groupTotals(lines, (i) => lines[i].accountId ?? null),
    porMaquina: groupTotals(lines, (i) => lines[i].machineId ?? null),
  };
}

/* ─── Estado de cuenta ─────────────────────────────────────────────────── */

export interface LedgerMovement {
  fecha: string;
  currency: string;
  monto: number;
  documento: string;
  descripcion: string;
}

export interface StatementLine {
  fecha: string;
  tipo: 'CARGO' | 'PAGO';
  documento: string;
  descripcion: string;
  monto: number;
  saldo: number;
}

export interface CurrencyStatement {
  currency: string;
  saldoInicial: number;
  totalCargos: number;
  totalPagos: number;
  saldoFinal: number;
  movimientos: StatementLine[];
}

/**
 * Estado de cuenta de un proveedor, por moneda. Saldo positivo = se le debe al proveedor.
 * Saldo inicial = cargos − pagos anteriores al período. Dentro del período, a igual fecha el
 * cargo va antes que el pago, para que el saldo corrido no quede negativo por orden.
 */
export function buildAccountStatement(input: {
  cargos: LedgerMovement[];
  pagos: LedgerMovement[];
  desde: string;
  hasta: string;
}): CurrencyStatement[] {
  const currencies = [...new Set([...input.cargos, ...input.pagos].map((m) => m.currency))].sort();
  return currencies.map((currency) => {
    const cargos = input.cargos.filter((m) => m.currency === currency);
    const pagos = input.pagos.filter((m) => m.currency === currency);
    const before = (m: LedgerMovement) => m.fecha < input.desde;
    const within = (m: LedgerMovement) => m.fecha >= input.desde && m.fecha <= input.hasta;

    const saldoInicial = round2(
      cargos.filter(before).reduce((a, m) => a + m.monto, 0) - pagos.filter(before).reduce((a, m) => a + m.monto, 0),
    );
    const entries = [
      ...cargos.filter(within).map((m) => ({ ...m, tipo: 'CARGO' as const })),
      ...pagos.filter(within).map((m) => ({ ...m, tipo: 'PAGO' as const })),
    ].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.tipo === b.tipo ? 0 : a.tipo === 'CARGO' ? -1 : 1) || a.documento.localeCompare(b.documento));

    let saldo = saldoInicial;
    const movimientos: StatementLine[] = entries.map((e) => {
      saldo = round2(saldo + (e.tipo === 'CARGO' ? e.monto : -e.monto));
      return { fecha: e.fecha, tipo: e.tipo, documento: e.documento, descripcion: e.descripcion, monto: e.monto, saldo };
    });
    return {
      currency,
      saldoInicial,
      totalCargos: round2(cargos.filter(within).reduce((a, m) => a + m.monto, 0)),
      totalPagos: round2(pagos.filter(within).reduce((a, m) => a + m.monto, 0)),
      saldoFinal: saldo,
      movimientos,
    };
  });
}

/* ─── Tipos de la API ──────────────────────────────────────────────────── */

export interface SupplierRef {
  id: string;
  codigo: string;
  nombre: string;
}

export interface AccountRef {
  id: string;
  codigo: string;
  nombre: string;
}

export interface MachineRefDto {
  id: string;
  codigo: string;
  descripcion: string;
}

export interface PaymentDto {
  id: string;
  numero: number;
  fecha: string;
  monto: number;
  currency: string;
  referencia: string | null;
  supplier: SupplierRef;
  fundRequestId: string | null;
  pettyCashLineId: string | null;
  anulado: boolean;
}

export interface FundRequestDto {
  id: string;
  numero: number;
  /** Año de la numeración: el documento se muestra como «numero/anio». */
  anio: number;
  fecha: string;
  supplier: SupplierRef;
  monto: number;
  currency: string;
  concepto: string;
  facturaORemision: string | null;
  account: AccountRef | null;
  machine: MachineRefDto | null;
  order: { id: string; numero: number } | null;
  pettyCashSheet: { id: string; numero: number; anio: number } | null;
  anulado: boolean;
  anuladoMotivo: string | null;
  pagado: number;
  saldo: number;
  estado: FundRequestStatus;
  montoEnLetras: string;
  pagos: PaymentDto[];
}

export interface PettyCashLineDto {
  id: string;
  position: number;
  fecha: string;
  supplier: SupplierRef | null;
  facturaORemision: string | null;
  concepto: string | null;
  monto: number;
  account: AccountRef | null;
  machine: MachineRefDto | null;
  aCredito: boolean;
}

export interface PettyCashSheetDto {
  id: string;
  numero: number;
  anio: number;
  fechaApertura: string;
  estado: 'ABIERTA' | 'CERRADA';
  observaciones: string | null;
  cerradaAt: string | null;
  currency: string;
  /** Total de la rendición: efectivo + a crédito. */
  total: number;
  /** Lo gastado en efectivo: es lo que se repone. Los renglones a crédito van a la cuenta del proveedor. */
  totalEfectivo: number;
  totalCredito: number;
  montoEnLetras: string;
  reposicion: { id: string; numero: number; anio: number; estado: FundRequestStatus } | null;
  lineCount: number;
  lines: PettyCashLineDto[];
  totales: SheetTotals;
}

/** Número de un documento con numeración anual: «385/2025». Sin año (pedidos, recepciones) es solo el número. */
export function formatDocNumber(numero: number | string, anio?: number | null): string {
  return anio === null || anio === undefined ? String(numero) : `${numero}/${anio}`;
}

/** Año de una fecha 'AAAA-MM-DD': es el de la secuencia anual de SF y cajas chicas. */
export function docYear(fecha: string): number {
  return Number(fecha.slice(0, 4));
}
