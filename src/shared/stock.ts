/**
 * @file shared/stock.ts
 * @description Reglas del stock de repuestos del taller. Reemplazan las tablas STOCK TALLER CREAR ITEM
 * y STOCK TALLER ENTRADA Y SALIDA del Access, donde las cantidades eran texto, el saldo solo existía
 * en un informe (`Sum(CANT RECIB) - Sum(SALIDA)`) y nada impedía sacar más de lo que había. Aquí:
 * - el artículo se identifica por su número de parte, comparado sin espacios ni signos,
 * - los movimientos son vales con renglones (entrada, salida, saldo inicial y ajuste),
 * - una salida que dejaría el saldo en negativo se rechaza,
 * - el valor del stock sale del costo promedio ponderado.
 * Puro: sin acceso a base de datos, testeable y compartido por cliente y servidor.
 */

import { isValidDocumentDate } from './finance';

export const STOCK_TYPES = ['ENTRADA', 'SALIDA', 'SALDO_INICIAL', 'AJUSTE'] as const;
export const ARTICLE_RUBROS = ['FILTROS', 'ACEITES', 'BATERIAS', 'CUBIERTAS', 'REPUESTOS', 'OTROS'] as const;
export const ARTICLE_UNITS = ['U', 'L', 'KG', 'M', 'JUEGO'] as const;

export type StockMovementType = (typeof STOCK_TYPES)[number];
export type ArticleRubro = (typeof ARTICLE_RUBROS)[number];
export type ArticleUnit = (typeof ARTICLE_UNITS)[number];

export const STOCK_TYPE_LABEL: Record<StockMovementType, string> = {
  ENTRADA: 'Entrada',
  SALIDA: 'Salida',
  SALDO_INICIAL: 'Saldo inicial',
  AJUSTE: 'Ajuste',
};

export const RUBRO_LABEL: Record<ArticleRubro, string> = {
  FILTROS: 'Filtros',
  ACEITES: 'Aceites',
  BATERIAS: 'Baterías',
  CUBIERTAS: 'Cubiertas',
  REPUESTOS: 'Repuestos',
  OTROS: 'Otros',
};

export interface ArticleEquivalent {
  marca: string;
  codigo: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/* ─── Códigos de artículo ──────────────────────────────────────────────── */

/**
 * Forma comparable de un número de parte: mayúsculas y sin espacios, guiones, puntos ni barras.
 * En el Access el mismo repuesto aparece como «W 950/12» y «W950-12».
 */
export function normalizeArticleCode(code: string | null | undefined): string {
  return (code ?? '').toUpperCase().replace(/[\s\-./\\_]+/g, '');
}

export interface MatchableArticle {
  id: string;
  codigo: string;
  equivalencias: ArticleEquivalent[];
}

export interface ArticleMatch {
  articleId: string;
  via: 'CODIGO' | 'EQUIVALENCIA';
}

/**
 * Artículo que corresponde a un número de parte de un pedido. Primero el código propio; si no, una
 * equivalencia (WIX, CAT, TECFIL…). Si la equivalencia la comparten varios artículos no se adivina.
 */
export function matchArticle(nroParte: string | null | undefined, articles: MatchableArticle[]): ArticleMatch | null {
  const wanted = normalizeArticleCode(nroParte);
  if (!wanted) return null;
  const own = articles.find((a) => normalizeArticleCode(a.codigo) === wanted);
  if (own) return { articleId: own.id, via: 'CODIGO' };
  const viaEquivalent = articles.filter((a) => a.equivalencias.some((e) => normalizeArticleCode(e.codigo) === wanted));
  if (viaEquivalent.length === 1) return { articleId: viaEquivalent[0].id, via: 'EQUIVALENCIA' };
  return null;
}

/* ─── Saldo y costo promedio ───────────────────────────────────────────── */

/** Efecto de un renglón sobre el saldo: la salida resta; entrada y saldo inicial suman; el ajuste lleva su signo. */
export function movementDelta(tipo: StockMovementType, cantidad: number): number {
  return tipo === 'SALIDA' ? -cantidad : cantidad;
}

export interface StockPosition {
  saldo: number;
  valor: number;
}

export function averageCost(position: StockPosition): number {
  return position.saldo > 0 ? position.valor / position.saldo : 0;
}

export interface AppliedLine {
  /** Variación del saldo (con signo). */
  delta: number;
  /** Variación del valor (con el mismo signo que `delta`). */
  valor: number;
  costoUnitario: number;
  position: StockPosition;
}

/**
 * Aplica un renglón a la posición de un artículo.
 * - Entrada y saldo inicial: suman al costo indicado.
 * - Salida y ajuste negativo: restan al promedio vigente; si vacían el artículo se llevan todo el valor,
 *   así no queda un resto por redondeos.
 * - Ajuste positivo: entra al costo indicado o, si no se indica, al promedio vigente.
 * Una salida ya hecha no se revaloriza si después se carga una entrada con fecha anterior.
 */
export function applyMovement(
  position: StockPosition,
  tipo: StockMovementType,
  cantidad: number,
  costoUnitario?: number | null,
): AppliedLine {
  const delta = movementDelta(tipo, cantidad);
  const saldo = round3(position.saldo + delta);
  let valor: number;
  let costo: number;
  if (delta > 0) {
    costo = costoUnitario !== null && costoUnitario !== undefined ? costoUnitario : averageCost(position);
    valor = round2(delta * costo);
  } else {
    const leaves = Math.abs(delta);
    if (saldo === 0) {
      valor = -position.valor;
    } else {
      valor = -round2(leaves * averageCost(position));
    }
    costo = leaves > 0 ? Math.abs(valor) / leaves : 0;
  }
  const newValor = saldo === 0 ? 0 : round2(position.valor + valor);
  return { delta, valor, costoUnitario: costo, position: { saldo, valor: newValor } };
}

/** Artículos que quedarían con saldo negativo al aplicar los cambios. */
export function wouldGoNegative(
  current: Map<string, number>,
  changes: { articleId: string; delta: number }[],
): { articleId: string; saldo: number; disponible: number }[] {
  const net = new Map<string, number>();
  for (const c of changes) net.set(c.articleId, round3((net.get(c.articleId) ?? 0) + c.delta));
  const short: { articleId: string; saldo: number; disponible: number }[] = [];
  for (const [articleId, delta] of net) {
    const disponible = current.get(articleId) ?? 0;
    const saldo = round3(disponible + delta);
    if (saldo < 0) short.push({ articleId, saldo, disponible });
  }
  return short;
}

/* ─── Validaciones ─────────────────────────────────────────────────────── */

export interface StockMovementDraft {
  tipo: StockMovementType;
  fecha: string;
  machineId?: string | null;
  worksiteId?: string | null;
  serviceOrderId?: string | null;
  motivo?: string | null;
  lines: { articleId: string; cantidad: number; costoUnitario?: number | null }[];
}

/** Errores de un vale antes de guardarlo. Lista vacía = válido. */
export function validateStockMovement(draft: StockMovementDraft, hoy: string): string[] {
  const errors: string[] = [];
  if (!isValidDocumentDate(draft.fecha, hoy)) errors.push('La fecha no es válida.');
  if (draft.lines.length === 0) errors.push('El vale debe tener al menos un renglón.');

  const seen = new Set<string>();
  const messages = new Set<string>();
  for (const line of draft.lines) {
    if (!line.articleId) {
      messages.add('Hay un renglón sin artículo.');
      continue;
    }
    if (seen.has(line.articleId)) messages.add('Un artículo aparece dos veces en el mismo vale.');
    seen.add(line.articleId);
    if (!Number.isFinite(line.cantidad) || line.cantidad === 0) {
      messages.add('Las cantidades deben ser distintas de 0.');
    } else if (draft.tipo !== 'AJUSTE' && line.cantidad < 0) {
      messages.add('Solo un ajuste puede tener cantidades negativas.');
    }
    const hasCost = line.costoUnitario !== null && line.costoUnitario !== undefined;
    if (hasCost && (!Number.isFinite(line.costoUnitario as number) || (line.costoUnitario as number) < 0)) {
      messages.add('El costo unitario no puede ser negativo.');
    }
    if ((draft.tipo === 'ENTRADA' || draft.tipo === 'SALDO_INICIAL') && (!hasCost || (line.costoUnitario as number) <= 0)) {
      messages.add('Cada renglón de una entrada o de un saldo inicial necesita un costo unitario mayor que 0.');
    }
  }
  errors.push(...messages);

  if (draft.tipo === 'AJUSTE' && (draft.motivo ?? '').trim().length < 3) {
    errors.push('Un ajuste necesita un motivo.');
  }
  const hasDestination = Boolean(draft.machineId) || Boolean(draft.worksiteId) || Boolean(draft.serviceOrderId);
  if (draft.tipo === 'SALIDA' && !hasDestination) {
    errors.push('Una salida necesita una máquina u obra de destino.');
  }
  if (draft.tipo !== 'SALIDA' && hasDestination) {
    errors.push('Solo una salida tiene máquina, obra u orden de servicio de destino.');
  }
  return errors;
}

/* ─── Kardex ───────────────────────────────────────────────────────────── */

export interface KardexInput {
  id: string;
  fecha: string;
  numero: number;
  tipo: StockMovementType;
  cantidad: number;
  valor: number;
}

export interface KardexRow extends KardexInput {
  delta: number;
  saldo: number;
  valorSaldo: number;
  costoPromedio: number;
}

/** Saldo y valor acumulados renglón por renglón, a partir de una posición inicial. */
export function kardex(rows: KardexInput[], opening: StockPosition = { saldo: 0, valor: 0 }): KardexRow[] {
  const ordered = [...rows].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero - b.numero);
  let saldo = opening.saldo;
  let valorSaldo = opening.valor;
  return ordered.map((r) => {
    const delta = movementDelta(r.tipo, r.cantidad);
    saldo = round3(saldo + delta);
    valorSaldo = saldo === 0 ? 0 : round2(valorSaldo + r.valor);
    return { ...r, delta, saldo, valorSaldo, costoPromedio: saldo > 0 ? valorSaldo / saldo : 0 };
  });
}

/* ─── DTOs compartidos con el cliente ──────────────────────────────────── */

export interface ArticleDto {
  id: string;
  codigo: string;
  descripcion: string;
  rubro: ArticleRubro;
  unidad: ArticleUnit;
  stockMinimo: number;
  ubicacion: string | null;
  equivalencias: ArticleEquivalent[];
  aplicacion: string | null;
  activo: boolean;
  saldo: number;
  valor: number;
  costoPromedio: number;
  bajoMinimo: boolean;
  ultimoMovimiento: string | null;
}

export interface StockMovementLineDto {
  articleId: string;
  articulo: { codigo: string; descripcion: string; unidad: ArticleUnit };
  cantidad: number;
  costoUnitario: number;
  valor: number;
}

export interface StockMovementDto {
  id: string;
  numero: number;
  fecha: string;
  tipo: StockMovementType;
  machine: { id: string; codigo: string; descripcion: string } | null;
  worksite: { id: string; codigo: string; nombre: string } | null;
  serviceOrder: { id: string; numero: number } | null;
  supplier: { id: string; nombre: string } | null;
  remision: string | null;
  reception: { id: string; numero: number; orderId: string; orderNumero: number } | null;
  motivo: string | null;
  observaciones: string | null;
  anulado: boolean;
  anuladoMotivo: string | null;
  lines: StockMovementLineDto[];
}

export type StockMovementResult = StockMovementDto & { advertencias: string[] };

export interface StockExistencesReport {
  totalValor: number;
  items: ArticleDto[];
}

export interface ArticleMatchDto {
  codigo: string;
  articulo: ArticleDto | null;
  via: ArticleMatch['via'] | null;
}

export interface ArticleBatchResult {
  creados: number;
  actualizados: number;
  movimiento: StockMovementDto | null;
}

export interface KardexReport {
  articulo: { id: string; codigo: string; descripcion: string; unidad: ArticleUnit };
  anterior: StockPosition;
  filas: (KardexRow & { destino: string | null })[];
}

export interface ConsumptionRow {
  destinoTipo: 'MAQUINA' | 'OBRA';
  destinoId: string;
  destino: string;
  articleId: string;
  codigo: string;
  descripcion: string;
  unidad: ArticleUnit;
  cantidad: number;
  valor: number;
}
