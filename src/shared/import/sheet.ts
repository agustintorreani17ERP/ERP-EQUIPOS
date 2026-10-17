// Planillas (Excel/CSV) que se cargan desde la app: qué columnas lleva cada tipo, cómo se reconocen por su
// encabezado y cómo se convierte cada celda. Lógica pura: la pantalla solo la usa.

export type CellKind = 'text' | 'int' | 'number' | 'date' | 'bool' | 'unit';

export interface SheetColumn {
  key: string;
  label: string;
  /** Nombres de encabezado aceptados (sin tildes ni signos al compararlos). */
  aliases: string[];
  required?: boolean;
  kind: CellKind;
  hint?: string;
}

export type SheetKind = 'proveedores' | 'obras' | 'maquinas' | 'lecturas';

export interface SheetSpec {
  kind: SheetKind;
  label: string;
  description: string;
  columns: SheetColumn[];
  /** Fila de ejemplo para la plantilla descargable. */
  example: Record<string, string | number>;
}

export const SHEET_SPECS: Record<SheetKind, SheetSpec> = {
  proveedores: {
    kind: 'proveedores',
    label: 'Proveedores',
    description: 'Código y nombre. Si el código ya existe se actualiza el nombre.',
    columns: [
      { key: 'codigo', label: 'Código', aliases: ['codigo', 'cod', 'id', 'nro', 'numero'], required: true, kind: 'text' },
      { key: 'nombre', label: 'Nombre', aliases: ['nombre', 'razon social', 'proveedor', 'suplidor'], required: true, kind: 'text' },
      { key: 'ruc', label: 'RUC', aliases: ['ruc', 'ci', 'documento'], kind: 'text' },
    ],
    example: { Código: 'P001', Nombre: 'Repuestos del Sur S.A.', RUC: '80000001-1' },
  },
  obras: {
    kind: 'obras',
    label: 'Obras',
    description: 'Código y nombre de cada obra o ubicación.',
    columns: [
      { key: 'codigo', label: 'Código', aliases: ['codigo', 'cod', 'id', 'nro', 'numero'], required: true, kind: 'text' },
      { key: 'nombre', label: 'Nombre', aliases: ['nombre', 'obra', 'ubicacion', 'descripcion'], required: true, kind: 'text' },
    ],
    example: { Código: 'O01', Nombre: 'Cantera Aguapety' },
  },
  maquinas: {
    kind: 'maquinas',
    label: 'Máquinas',
    description: 'Ficha básica. Si el código ya existe se actualiza lo que la planilla trae; la obra tiene que existir.',
    columns: [
      { key: 'codigo', label: 'Código', aliases: ['codigo', 'idcodigo', 'cod', 'nro', 'numero'], required: true, kind: 'text' },
      { key: 'descripcion', label: 'Descripción', aliases: ['descripcion', 'equipo', 'maquina', 'detalle', 'nombre'], required: true, kind: 'text' },
      { key: 'marca', label: 'Marca', aliases: ['marca'], kind: 'text' },
      { key: 'modelo', label: 'Modelo', aliases: ['modelo'], kind: 'text' },
      { key: 'anio', label: 'Año', aliases: ['anio', 'ano', 'año', 'ejercicio'], kind: 'int' },
      { key: 'chapa', label: 'Chapa', aliases: ['chapa', 'matricula', 'patente'], kind: 'text' },
      { key: 'obra', label: 'Obra', aliases: ['obra', 'ubicacion', 'destino'], kind: 'text', hint: 'Código o nombre de una obra ya cargada.' },
      { key: 'categoria', label: 'Categoría', aliases: ['categoria', 'tipo', 'familia'], kind: 'text' },
      { key: 'unidad', label: 'Unidad', aliases: ['unidad', 'medidor', 'horometro'], kind: 'unit', hint: 'HS (horas) o KM (kilómetros).' },
      { key: 'llevaMantenimiento', label: 'Lleva mantenimiento', aliases: ['lleva mantenimiento', 'mantenimiento', 'con mantenimiento'], kind: 'bool' },
    ],
    example: { Código: '016101', Descripción: 'Retroexcavadora CAT 416', Marca: 'Caterpillar', Modelo: '416F', Año: 2018, Chapa: '', Obra: 'O01', Categoría: 'Retroexcavadoras', Unidad: 'HS', 'Lleva mantenimiento': 'Sí' },
  },
  lecturas: {
    kind: 'lecturas',
    label: 'Lecturas de horómetro',
    description: 'Horas o kilómetros por máquina y fecha. No pueden bajar respecto de la lectura anterior de la máquina.',
    columns: [
      { key: 'maquina', label: 'Máquina', aliases: ['maquina', 'codigo', 'equipo', 'idcodigo'], required: true, kind: 'text', hint: 'Código de la máquina.' },
      { key: 'fecha', label: 'Fecha', aliases: ['fecha', 'dia'], required: true, kind: 'date' },
      { key: 'valor', label: 'Lectura', aliases: ['lectura', 'valor', 'horas', 'hs', 'km', 'kilometros', 'horometro', 'odometro'], required: true, kind: 'number' },
      { key: 'correccion', label: 'Es corrección', aliases: ['correccion', 'es correccion'], kind: 'bool' },
      { key: 'motivo', label: 'Motivo', aliases: ['motivo', 'observacion'], kind: 'text', hint: 'Obligatorio si es una corrección.' },
    ],
    example: { Máquina: '016101', Fecha: '2025-03-10', Lectura: 4830 },
  },
};

/** Para comparar encabezados: sin tildes, sin signos y en minúscula. */
export function stripHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Para cada columna de la planilla, el encabezado del archivo que le corresponde (por alias), o null. */
export function matchColumns(headers: string[], columns: SheetColumn[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const taken = new Set<string>();
  for (const col of columns) {
    const wanted = [col.label, ...col.aliases].map(stripHeader);
    const found = headers.find((h) => !taken.has(h) && wanted.includes(stripHeader(h))) ?? null;
    out[col.key] = found;
    if (found) taken.add(found);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha de una celda: serie de Excel, Date, «AAAA-MM-DD» o «DD/MM/AAAA». Devuelve null si no se entiende. */
export function parseSheetDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return null;
    const d = new Date(Math.round((value - 25569) * 86_400_000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  let y: number, mo: number, da: number;
  if (m) [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text))) {
    da = Number(m[1]);
    mo = Number(m[2]);
    y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  } else return null;
  const iso = `${y}-${pad(mo)}-${pad(da)}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Número de una celda: acepta coma decimal y punto de miles («1.234,5»). */
export function parseSheetNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

export function parseSheetBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  const t = stripHeader(String(value ?? ''));
  if (['si', 'sí', 's', 'true', 'verdadero', '1', 'x', 'yes'].includes(t)) return true;
  if (['no', 'n', 'false', 'falso', '0'].includes(t)) return false;
  return null;
}

export function parseSheetUnit(value: unknown): 'HS' | 'KM' | null {
  const t = stripHeader(String(value ?? ''));
  if (['hs', 'h', 'hora', 'horas'].includes(t)) return 'HS';
  if (['km', 'kms', 'kilometro', 'kilometros'].includes(t)) return 'KM';
  return null;
}

export interface CoercedRow {
  /** Número de fila de datos (1 = la primera después del encabezado), el mismo que usa la API. */
  line: number;
  values: Record<string, unknown>;
  problems: string[];
}

/** Convierte las filas del archivo en filas listas para enviar, con los problemas de cada una. */
export function coerceRows(rows: Record<string, unknown>[], mapping: Record<string, string | null>, columns: SheetColumn[]): CoercedRow[] {
  return rows.map((raw, i) => {
    const values: Record<string, unknown> = {};
    const problems: string[] = [];
    for (const col of columns) {
      const header = mapping[col.key];
      const cell = header ? raw[header] : undefined;
      const empty = cell === undefined || cell === null || String(cell).trim() === '';
      if (empty) {
        if (col.required) problems.push(`Falta ${col.label.toLowerCase()}.`);
        continue;
      }
      switch (col.kind) {
        case 'text':
          values[col.key] = String(cell).trim();
          break;
        case 'int':
        case 'number': {
          const n = parseSheetNumber(cell);
          if (n === null || (col.kind === 'int' && !Number.isInteger(n))) problems.push(`${col.label}: «${String(cell)}» no es un número${col.kind === 'int' ? ' entero' : ''}.`);
          else values[col.key] = n;
          break;
        }
        case 'date': {
          const d = parseSheetDate(cell);
          if (!d) problems.push(`${col.label}: «${String(cell)}» no es una fecha (usá DD/MM/AAAA).`);
          else values[col.key] = d;
          break;
        }
        case 'bool': {
          const b = parseSheetBool(cell);
          if (b === null) problems.push(`${col.label}: «${String(cell)}» no es sí/no.`);
          else values[col.key] = b;
          break;
        }
        case 'unit': {
          const u = parseSheetUnit(cell);
          if (!u) problems.push(`${col.label}: «${String(cell)}» no es HS ni KM.`);
          else values[col.key] = u;
          break;
        }
      }
    }
    return { line: i + 1, values, problems };
  });
}
