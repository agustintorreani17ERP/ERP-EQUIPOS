/**
 * @file utils/excel.ts
 * @description Exporta filas planas a un libro de Excel de una hoja.
 */

import * as XLSX from 'xlsx';

export function exportRowsToExcel(rows: Record<string, string | number | boolean | null>[], sheetName: string, fileName: string): void {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), sheetName.slice(0, 31));
  XLSX.writeFile(book, fileName);
}
