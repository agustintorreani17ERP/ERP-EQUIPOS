// Partes diarios del Access (PARTE DIARIO DE MAQUINAS EN TALLER) → partes con etiquetas y lectura.
import { eventTypesFromLegacyFlags, type EventType } from '../fleet';
import { accessDate, accessNumber, cleanMemo, cleanText, type Observation } from './common';
import type { AccessRow } from './fleet';

export interface EventImport {
  legacyId: string;
  fecha: string | null;
  machineCode: string | null;
  descripcion: string;
  tipos: EventType[];
  /** Id de la obra de origen (lista `Id_Obra`) y de destino (lista `OBRA DESTINO`). */
  obraId: string | null;
  destinoId: string | null;
  operador: string | null;
  /** Número de nota de envío tal como estaba escrito: queda como dato histórico. */
  notaEnvio: string | null;
  /** Horas o kilómetros del horómetro; null si no hay lectura. */
  lectura: number | null;
  obs: Observation[];
}

/** Las casillas del parte que se convierten en etiquetas (el resto de las columnas no son casillas). */
const FLAG_COLUMNS = [
  'ENVIO REPUESTOS', 'PARTE A ING MAURICIO', 'TRASLADO', 'FILTROS', 'CUBIERTAS', 'BATERIAS', 'CUCHILLAS', 'PUNTERAS', 'ACEITES', 'ZARANDA', 'CEMENTO',
  'TUBOS Ho', 'TERMINO DE RESP', 'CAL', 'HERRAMIENTAS', 'LABORATORIO', 'MANUAL DE PARTES', 'MANUAL DE MANT Y OP', 'HAB MUNIC', 'ORDEN DE SERVICIO',
  'REJILLA TANQUE COMB', 'MONITOREO SATELITAL', 'FRENOS', 'EMBRAGUE',
];

export function eventFromAccess(row: AccessRow, hoy: string): EventImport {
  const obs: Observation[] = [];
  const fecha = accessDate(row['Fecha'], hoy);
  if (fecha.obs) obs.push(fecha.obs);
  let descripcion = cleanMemo(row['Descrip']);
  if (!descripcion) {
    descripcion = 'Sin descripción';
    obs.push({ code: 'DESCRIPCION_VACIA' });
  }
  const flags: Record<string, boolean> = {};
  for (const column of FLAG_COLUMNS) flags[column] = row[column] === true;
  const lectura = accessNumber(row['HORA/KM/MILLAS']);
  return {
    legacyId: cleanText(row['ID']) ?? '',
    fecha: fecha.fecha,
    machineCode: cleanText(row['Código']),
    descripcion,
    tipos: eventTypesFromLegacyFlags(flags),
    obraId: cleanText(row['OBRA']),
    destinoId: cleanText(row['OBRA DESTINO']),
    operador: cleanText(row['ChofOper2']) ?? cleanText(row['CHOFER']),
    notaEnvio: cleanText(row['NOTA DE ENVIO']),
    lectura: lectura !== null && lectura > 0 ? lectura : null,
    obs,
  };
}
