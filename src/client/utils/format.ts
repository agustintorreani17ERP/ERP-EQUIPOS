/**
 * @file utils/format.ts
 * @description Formatos de fecha y cantidad compartidos por los módulos de Taller.
 */

export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD → DD/MM/YYYY. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatQty(value: number): string {
  return value.toLocaleString('es-PY', { maximumFractionDigits: 3 });
}
