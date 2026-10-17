/**
 * @file server/import/context.ts
 * @description Estado compartido de una importación: registros que resuelven obras, proveedores y
 * máquinas del Access a los ids nuevos. Lo que un movimiento menciona y el maestro no tiene se crea
 * al vuelo, marcado como observado, para no perder el movimiento ni dejar referencias sueltas.
 */

import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection';
import { normalizeMachineCode } from '../../shared/fleet';
import { cleanText, normalizeName } from '../../shared/import/common';
import { placeholderMachine } from '../../shared/import/fleet';
import type { SiteNoteEvent } from '../../shared/import/dispatch';
import { IssueSink, insertMany } from './db';

export interface BlockResult {
  bloque: string;
  leidas: number;
  cargadas: number;
  observadas: number;
  rechazadas: number;
}

interface PendingRow {
  values: unknown[];
}

export class WorksiteRegistry {
  /** Id de la lista `Id_Obra` → id nuevo. */
  readonly byObraId = new Map<string, string>();
  /** Id de la lista `OBRA DESTINO` → id nuevo. */
  readonly byDestinoId = new Map<string, string>();
  readonly byName = new Map<string, string>();
  private pending: PendingRow[] = [];
  private seq = 0;

  constructor(private readonly issues: IssueSink) {}

  /** Alta (aún sin escribir) de una obra con nombre propio. */
  add(codigo: string, nombre: string, legacyId: string | null, observacion: string | null): string {
    const key = normalizeName(nombre);
    const existing = key ? this.byName.get(key) : undefined;
    if (existing) return existing;
    const id = randomUUID();
    if (key) this.byName.set(key, id);
    this.pending.push({ values: [id, codigo, nombre, legacyId, observacion !== null, observacion] });
    if (observacion) this.issues.add({ entidad: 'obra', registroId: id, legacyId, codigo: 'OBRA_SIN_REGISTRO', detalle: observacion });
    return id;
  }

  /** Obra por id del Access; `espacio` indica en qué lista buscar primero. */
  byLegacy(value: unknown, espacio: 'OBRA' | 'DESTINO'): string | null {
    const key = cleanText(value);
    if (!key) return null;
    const first = espacio === 'OBRA' ? this.byObraId : this.byDestinoId;
    const second = espacio === 'OBRA' ? this.byDestinoId : this.byObraId;
    return first.get(key) ?? second.get(key) ?? null;
  }

  /** Obra por nombre; si no existe se crea como observada. */
  byNameOrCreate(value: unknown): string | null {
    const nombre = cleanText(value);
    if (!nombre) return null;
    const found = this.byName.get(normalizeName(nombre));
    if (found) return found;
    this.seq += 1;
    return this.add(`X${String(this.seq).padStart(3, '0')}`, nombre, null, `Obra que figura en los movimientos y no en las listas del Access: ${nombre}`);
  }

  async flush(tx: Db, companyId: string): Promise<number> {
    const rows = this.pending.map((p) => [companyId, ...p.values, 'ACCESS']);
    const n = rows.length;
    this.pending = [];
    await insertMany(
      tx,
      'worksites',
      [{ name: 'company_id' }, { name: 'id', cast: 'uuid' }, { name: 'codigo' }, { name: 'nombre' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' }, { name: 'origen' }],
      rows,
    );
    return n;
  }
}

export class SupplierRegistry {
  readonly byId = new Map<string, string>();
  readonly byName = new Map<string, string>();
  private pending: PendingRow[] = [];
  private seq = 0;

  constructor(private readonly issues: IssueSink) {}

  add(codigo: string, nombre: string, legacyId: string | null, observacion: string | null): string {
    const id = randomUUID();
    const key = normalizeName(nombre);
    if (key && !this.byName.has(key)) this.byName.set(key, id);
    this.pending.push({ values: [id, codigo, nombre, legacyId, observacion !== null, observacion] });
    if (observacion) this.issues.add({ entidad: 'proveedor', registroId: id, legacyId, codigo: 'PROVEEDOR_SIN_REGISTRO', detalle: observacion });
    return id;
  }

  byLegacy(value: unknown): string | null {
    const key = cleanText(value);
    return key ? (this.byId.get(key) ?? null) : null;
  }

  /** Proveedor por nombre libre (los pedidos lo escribían a mano); si no existe se crea observado. */
  byNameOrCreate(value: unknown): string | null {
    const nombre = cleanText(value);
    if (!nombre) return null;
    const found = this.byName.get(normalizeName(nombre));
    if (found) return found;
    this.seq += 1;
    return this.add(`SN${String(this.seq).padStart(4, '0')}`, nombre, null, `Proveedor escrito a mano en los pedidos y sin registro: ${nombre}`);
  }

  async flush(tx: Db, companyId: string): Promise<number> {
    const rows = this.pending.map((p) => [companyId, ...p.values, 'ACCESS']);
    const n = rows.length;
    this.pending = [];
    await insertMany(
      tx,
      'suppliers',
      [{ name: 'company_id' }, { name: 'id', cast: 'uuid' }, { name: 'codigo' }, { name: 'nombre' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' }, { name: 'origen' }],
      rows,
    );
    return n;
  }
}

export class MachineRegistry {
  /** Código normalizado → id nuevo. */
  readonly byKey = new Map<string, string>();
  /** Máquinas creadas porque aparecen en los movimientos y no en la ficha. */
  readonly placeholders: { id: string; codigo: string }[] = [];
  private pendingPlaceholders: { id: string; codigo: string }[] = [];

  constructor(private readonly issues: IssueSink) {}

  register(codigo: string, id: string): void {
    this.byKey.set(normalizeMachineCode(codigo), id);
  }

  /** Id de la máquina por código; crea una máquina «sin ficha» si el código no existe. */
  idFor(value: unknown): string | null {
    const codigo = cleanText(value);
    if (!codigo) return null;
    const key = normalizeMachineCode(codigo);
    if (!key) return null;
    const found = this.byKey.get(key);
    if (found) return found;
    const id = randomUUID();
    this.byKey.set(key, id);
    this.placeholders.push({ id, codigo });
    this.pendingPlaceholders.push({ id, codigo });
    this.issues.add({ entidad: 'maquina', registroId: id, legacyId: codigo, codigo: 'MAQUINA_SIN_FICHA', detalle: codigo });
    return id;
  }

  /** Lookup sin crear (para preguntar si el código existe). */
  find(value: unknown): string | null {
    const codigo = cleanText(value);
    return codigo ? (this.byKey.get(normalizeMachineCode(codigo)) ?? null) : null;
  }

  async flush(tx: Db, companyId: string): Promise<number> {
    const list = this.pendingPlaceholders;
    this.pendingPlaceholders = [];
    const rows = list.map(({ id, codigo }) => {
      const m = placeholderMachine(codigo);
      return [id, companyId, m.codigo, m.descripcion, m.observaciones, codigo, 'ACCESS', true, 'Sin ficha en el Access'];
    });
    await insertMany(
      tx,
      'machines',
      [
        { name: 'id', cast: 'uuid' },
        { name: 'company_id' },
        { name: 'codigo' },
        { name: 'descripcion' },
        { name: 'observaciones' },
        { name: 'legacy_id' },
        { name: 'origen' },
        { name: 'observado' },
        { name: 'observacion' },
      ],
      rows,
    );
    return list.length;
  }
}

/** Lectura de horómetro/odómetro a cargar al final, cuando se conocen las de todas las fuentes. */
export interface PendingReading {
  machineId: string;
  fecha: string;
  valor: number;
  fuente: 'PARTE' | 'COMBUSTIBLE' | 'SERVICIO';
  parteId?: string | null;
  fuelMovementId?: string | null;
  legacyId?: string | null;
}

/** Datos de un documento ya cargado que las notas de envío copian al enlazarlo. */
export interface DocMeta {
  numero: string;
  supplierId: string | null;
  machineId: string | null;
  fecha: string | null;
}

export interface ImportContext {
  companyId: string;
  hoy: string;
  runId: string;
  issues: IssueSink;
  worksites: WorksiteRegistry;
  suppliers: SupplierRegistry;
  machines: MachineRegistry;
  /** Cuenta de gasto: id del Access → id nuevo. */
  accounts: Map<string, string>;
  categories: Map<string, string>;
  /** Número de pedido tal como estaba en el Access (texto) → id del pedido que lo conservó. */
  orderByRaw: Map<string, string>;
  /** Unidad del horómetro de cada máquina (las no listadas son en horas). */
  machineUnits: Map<string, 'HS' | 'KM'>;
  /** Estado de cada máquina de la ficha (ACTIVA, PARADA, EN_DESUSO, BAJA). */
  machineStatus: Map<string, string>;
  /** Pedidos y SF cargados (por id), para enlazarlos en las notas de envío. */
  docMeta: Map<string, DocMeta>;
  /** Número de SF tal como estaba en el Access → id de la SF que lo conservó. */
  sfByRaw: Map<string, string>;
  /** Partes cargados, para armar las notas a obra. */
  events: SiteNoteEvent[];
  readings: PendingReading[];
  results: BlockResult[];
}

export function createContext(input: { companyId: string; hoy: string; runId: string }): ImportContext {
  const issues = new IssueSink();
  return {
    ...input,
    issues,
    worksites: new WorksiteRegistry(issues),
    suppliers: new SupplierRegistry(issues),
    machines: new MachineRegistry(issues),
    accounts: new Map(),
    categories: new Map(),
    orderByRaw: new Map(),
    machineUnits: new Map(),
    machineStatus: new Map(),
    docMeta: new Map(),
    sfByRaw: new Map(),
    events: [],
    readings: [],
    results: [],
  };
}
