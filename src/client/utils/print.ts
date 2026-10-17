/**
 * @file utils/print.ts
 * @description Imprime solo el área marcada con .print-area (ver index.css, body.print-doc).
 */

/** Abre el diálogo de impresión y limpia la marca al terminar, también si se cancela. */
export function printArea(): () => void {
  document.body.classList.add('print-doc');
  const done = () => document.body.classList.remove('print-doc');
  window.addEventListener('afterprint', done, { once: true });
  window.print();
  return () => window.removeEventListener('afterprint', done);
}
