// Pedidos de materiales del Access (PEDIDOS DE MATERIALES + PEDIDO DE MATERIALES REPUESTOS) →
// pedidos con renglones y recepciones. Reglas de conciliación del inventario §10.
import { accessDate, accessNumber, cleanText, type Observation } from './common';
import type { AccessRow } from './fleet';

export interface OrderHeaderImport {
  legacyId: string;
  /** Número tal como estaba escrito (texto). */
  pedidoRaw: string | null;
  fecha: string | null;
  machineCode: string | null;
  /** Id del proveedor en la lista de proveedores. */
  proveedorId: string | null;
  /** Nombre escrito a mano cuando no hay id. */
  suplidorNombre: string | null;
  obraNombre: string | null;
  anulado: boolean;
  compraCentral: boolean;
  pedidoDeObra: boolean;
  rubros: string[];
  observaciones: string | null;
  // Datos de la recepción que estaban en la cabecera.
  fechaRecepcionado: string | null;
  fechaRecepcion2: string | null;
  recepcionNo: string | null;
  recepcionNoB: string | null;
  proveedorBId: string | null;
  factura: string | null;
  factura2: string | null;
  obsRecepcion: string | null;
  obs: Observation[];
}

export interface OrderLineImport {
  legacyId: string;
  pedidoRaw: string | null;
  nroParte: string | null;
  descripcion: string;
  /** null si no es un número mayor que cero: el renglón se rechaza. */
  cantidad: number | null;
  machineCode: string | null;
  recib: boolean;
  recibB: boolean;
  cantRecib: number | null;
  nroRecepcionado: string | null;
  fechaRecepcionado: string | null;
  proveedorId: string | null;
  proveedorBId: string | null;
  factura: string | null;
  obs: Observation[];
}

const RUBRO_COLUMNS: [string, string][] = [
  ['FILTROS', 'FILTROS'],
  ['ACEITES', 'ACEITES'],
  ['BATERIAS', 'BATERIAS'],
  ['CUBIERTAS', 'CUBIERTAS'],
];

export function orderHeaderFromAccess(row: AccessRow, hoy: string): OrderHeaderImport {
  const obs: Observation[] = [];
  const fecha = accessDate(row['FECHA'], hoy);
  if (fecha.obs) obs.push(fecha.obs);
  const pedidoDeObra = cleanText(row['PEDIDO DE OBRA']);
  const notes = [
    cleanText(row['OBS PEDIDO']),
    pedidoDeObra ? `Pedido de obra N.º ${pedidoDeObra}` : null,
    cleanText(row['PROVEEDR SJ']) ? `Proveedor (nota): ${cleanText(row['PROVEEDR SJ'])}` : null,
  ].filter((x): x is string => x !== null);
  return {
    legacyId: cleanText(row['ID PEDIDO']) ?? '',
    pedidoRaw: cleanText(row['PEDIDO']),
    fecha: fecha.fecha,
    machineCode: cleanText(row['Código']),
    proveedorId: cleanText(row['PROVEEDOR']),
    suplidorNombre: cleanText(row['SUPLIDOR']),
    obraNombre: cleanText(row['OBRA O UBICACION']),
    anulado: row['ANULADO'] === true,
    compraCentral: row['PEDIDO CIVCCCSA'] === true,
    pedidoDeObra: pedidoDeObra !== null,
    rubros: RUBRO_COLUMNS.filter(([column]) => row[column] === true).map(([, rubro]) => rubro),
    observaciones: notes.length > 0 ? notes.join(' · ').slice(0, 500) : null,
    fechaRecepcionado: accessDate(row['FECHA RECEPCIONADO'], hoy).fecha,
    fechaRecepcion2: accessDate(row['FECHA RECEPCION 2'], hoy).fecha,
    recepcionNo: cleanText(row['RECEPCION No']),
    recepcionNoB: cleanText(row['RECEPCION No B']),
    proveedorBId: cleanText(row['PROVEEDOR B']),
    factura: cleanText(row['FACTURA O REMISION']),
    factura2: cleanText(row['FACTURA 2']),
    obsRecepcion: cleanText(row['OBS RECEPCION']),
    obs,
  };
}

export function orderLineFromAccess(row: AccessRow, hoy: string): OrderLineImport {
  const obs: Observation[] = [];
  let descripcion = cleanText(row['DESCRIPCION']);
  if (!descripcion) {
    descripcion = 'Sin descripción';
    obs.push({ code: 'DESCRIPCION_VACIA' });
  }
  const cantidad = typeof row['CANTIDAD'] === 'number' && row['CANTIDAD'] > 0 ? row['CANTIDAD'] : accessNumber(row['CANTIDAD']);
  const cantidadValida = cantidad !== null && cantidad > 0 ? cantidad : null;
  if (cantidadValida === null) obs.push({ code: 'CANTIDAD_INVALIDA', detail: String(row['CANTIDAD'] ?? '') });
  return {
    legacyId: cleanText(row['ID']) ?? '',
    pedidoRaw: cleanText(row['PEDIDO']),
    nroParte: cleanText(row['NRO PARTE']),
    descripcion,
    cantidad: cantidadValida,
    machineCode: cleanText(row['Código']),
    recib: row['RECIB'] === true,
    recibB: row['RECIB B'] === true,
    cantRecib: accessNumber(row['CANT RECIB']),
    nroRecepcionado: cleanText(row['NRO RECEPCIONADO']),
    fechaRecepcionado: accessDate(row['FECHA RECEPCIONADO'], hoy).fecha,
    proveedorId: cleanText(row['PROVEEDOR']),
    proveedorBId: cleanText(row['PROVEEDOR B']),
    factura: cleanText(row['FACTURA O REMISION']),
    obs,
  };
}

export interface PlannedReceptionLine {
  /** Posición del renglón dentro de las líneas pasadas a `planReceptions`. */
  lineIndex: number;
  cantidad: number;
}

export interface PlannedReception {
  /** Letra de la recepción en el Access: A (la primera) o B (la segunda). */
  via: 'A' | 'B';
  fecha: string;
  proveedorId: string | null;
  factura: string | null;
  /** Número de recepción tal como estaba en el Access (de los renglones o de la cabecera). */
  referenciaAccess: string | null;
  observaciones: string | null;
  lines: PlannedReceptionLine[];
  obs: Observation[];
}

/**
 * Recepciones de un pedido a partir de la marca y la cantidad recibida de cada renglón:
 * - recibido sin cantidad cargada → completo (recibida = pedida);
 * - sin marca pero con cantidad ≥ pedida → completo;
 * - marcado con cantidad parcial → parcial, se conserva la cantidad;
 * - marcado con cantidad 0 → sigue pendiente (no genera recepción);
 * - marcado A y B → dos recepciones sucesivas: la A con lo cargado y la B con el resto.
 * Los renglones que se entregaron juntos (mismo número, fecha, proveedor y factura) van en una recepción.
 */
export function planReceptions(header: OrderHeaderImport, orderFecha: string, lines: OrderLineImport[]): PlannedReception[] {
  const groups = new Map<string, PlannedReception>();

  const add = (via: 'A' | 'B', line: OrderLineImport, lineIndex: number, cantidad: number, obs: Observation[]): void => {
    const fechaLinea = line.fechaRecepcionado;
    const fecha = fechaLinea ?? (via === 'B' ? (header.fechaRecepcion2 ?? header.fechaRecepcionado) : header.fechaRecepcionado) ?? orderFecha;
    const proveedorId = via === 'B' ? (line.proveedorBId ?? header.proveedorBId) : (line.proveedorId ?? header.proveedorId);
    const factura = line.factura ?? (via === 'B' ? header.factura2 : header.factura);
    const referencia = line.nroRecepcionado ?? (via === 'B' ? header.recepcionNoB : header.recepcionNo);
    const key = [via, fecha, proveedorId ?? '', factura ?? '', referencia ?? ''].join('|');
    let group = groups.get(key);
    if (!group) {
      group = { via, fecha, proveedorId, factura, referenciaAccess: referencia, observaciones: header.obsRecepcion, lines: [], obs: [] };
      groups.set(key, group);
    }
    group.lines.push({ lineIndex, cantidad });
    group.obs.push(...obs);
    if (!fechaLinea && !(via === 'B' ? (header.fechaRecepcion2 ?? header.fechaRecepcionado) : header.fechaRecepcionado)) {
      group.obs.push({ code: 'FECHA_VACIA', detail: 'Recepción sin fecha: se usó la del pedido' });
    }
  };

  lines.forEach((line, index) => {
    if (line.cantidad === null) return;
    const pedida = line.cantidad;
    const cant = line.cantRecib;
    // Recibido por la vía A.
    let recibidoA = 0;
    if (line.recib) {
      if (cant === null) recibidoA = pedida;
      else if (cant > 0) recibidoA = cant;
      // marcado con cantidad 0: pendiente
    } else if (!line.recibB && cant !== null && cant >= pedida) {
      recibidoA = pedida;
    }
    if (recibidoA > 0) add('A', line, index, recibidoA, []);

    if (line.recibB) {
      let resto = recibidoA > 0 ? pedida - recibidoA : cant !== null && cant > 0 ? cant : pedida;
      if (recibidoA === 0 && cant === 0) resto = 0;
      if (resto > 0) add('B', line, index, resto, []);
      else if (line.recib) {
        // Marcado en A y en B sin saldo: la B no agrega nada, queda constancia.
        const g = [...groups.values()].find((x) => x.via === 'A' && x.lines.some((l) => l.lineIndex === index));
        g?.obs.push({ code: 'OTRO', detail: 'Marcado recibido en A y en B sin saldo pendiente' });
      }
    }
  });
  return [...groups.values()];
}
