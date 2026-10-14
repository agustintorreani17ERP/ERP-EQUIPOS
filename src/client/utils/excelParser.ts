import * as XLSX from 'xlsx';

export interface ParsedExcelSheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, any>[];
  totalRows: number;
}

/**
 * Lee un archivo Excel binario (.xlsx / .xls) y devuelve las hojas con sus registros.
 */
export async function parseExcelFile(file: File): Promise<ParsedExcelSheet[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const result: ParsedExcelSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    // Convertir a JSON con encabezados en la primera fila
    const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
      defval: '',
      raw: false, // Convertir fechas y números formateados a cadenas legibles
    });

    // Detectar encabezados
    const headers: string[] = [];
    if (rawData.length > 0) {
      Object.keys(rawData[0]).forEach((h) => {
        if (h && !headers.includes(h)) headers.push(h);
      });
    }

    result.push({
      sheetName,
      headers,
      rows: rawData,
      totalRows: rawData.length,
    });
  }

  return result;
}
