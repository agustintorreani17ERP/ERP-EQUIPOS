/**
 * @file server/import/readings.ts
 * @description Carga de las lecturas de horómetro y odómetro de todas las fuentes (partes, combustible,
 * servicios) juntas. Se ordenan por fecha y cada lectura se compara con la mayor aceptada hasta ese día:
 * la que baja entra marcada como «observada» (el historial del Access tiene 19–27 % de lecturas que bajan)
 * y no cuenta como referencia para validar las lecturas nuevas.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { query } from '../routes/helpers';
import { sqlList } from '../routes/helpers';
import type { BlockResult, ImportContext, PendingReading } from './context';
import { insertMany } from './db';

const SOURCE_ORDER: Record<PendingReading['fuente'], number> = { PARTE: 0, COMBUSTIBLE: 1, SERVICIO: 2 };

export interface MarkedReading extends PendingReading {
  observada: boolean;
  /** Mayor lectura aceptada antes de esta (solo si es observada). */
  anterior: number | null;
}

/**
 * Marca como observadas las lecturas que no encajan en la serie creciente de su máquina.
 * Se conserva la subsecuencia no decreciente MÁS LARGA: así un valor erróneo (un pico de 99.999 o un
 * horómetro tipeado de menos) se descarta solo a sí mismo, en lugar de hacer «bajar» todo lo que sigue.
 * Entre varias subsecuencias igual de largas se prefiere la de valores más altos y la que llega hasta la
 * lectura más reciente.
 */
export function markDecreasingReadings(readings: PendingReading[]): MarkedReading[] {
  const byMachine = new Map<string, { r: PendingReading; index: number }[]>();
  readings.forEach((r, index) => {
    const list = byMachine.get(r.machineId);
    if (list) list.push({ r, index });
    else byMachine.set(r.machineId, [{ r, index }]);
  });
  const out: MarkedReading[] = [];
  for (const list of byMachine.values()) {
    list.sort((a, b) => (a.r.fecha < b.r.fecha ? -1 : a.r.fecha > b.r.fecha ? 1 : SOURCE_ORDER[a.r.fuente] - SOURCE_ORDER[b.r.fuente] || a.index - b.index));
    const n = list.length;
    const dp = new Array<number>(n).fill(1);
    const prev = new Array<number>(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const vi = list[i].r.valor;
      for (let j = 0; j < i; j++) {
        const vj = list[j].r.valor;
        if (vj > vi) continue;
        const better = dp[j] + 1 > dp[i] || (dp[j] + 1 === dp[i] && prev[i] >= 0 && vj >= list[prev[i]].r.valor);
        if (better) {
          dp[i] = dp[j] + 1;
          prev[i] = j;
        }
      }
    }
    // Fin de la mejor serie: la más larga y, a igual largo, la más reciente.
    let end = 0;
    for (let i = 1; i < n; i++) if (dp[i] >= dp[end]) end = i;
    const kept = new Set<number>();
    for (let i = end; i >= 0; i = prev[i]) kept.add(i);
    // Para informar contra qué lectura quedó observada: la mayor conservada hasta esa fecha.
    let maxKept = 0;
    list.forEach(({ r }, i) => {
      if (kept.has(i)) {
        maxKept = Math.max(maxKept, r.valor);
        out.push({ ...r, observada: false, anterior: null });
      } else {
        out.push({ ...r, observada: true, anterior: maxKept > 0 ? maxKept : null });
      }
    });
  }
  return out;
}

export async function flushReadings(tx: Db, ctx: ImportContext): Promise<void> {
  const result: BlockResult = { bloque: 'lecturas de horómetro', leidas: ctx.readings.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  ctx.results.push(result);
  const marked = markDecreasingReadings(ctx.readings);
  ctx.readings = [];

  const rows: unknown[][] = [];
  const observedFuel: string[] = [];
  for (const r of marked) {
    const id = randomUUID();
    if (r.observada) {
      result.observadas += 1;
      ctx.issues.add({ entidad: 'lectura', registroId: id, legacyId: r.legacyId ?? null, codigo: 'LECTURA_BAJA', detalle: `${r.valor} no encaja con la serie (${r.fecha}; mayor anterior ${r.anterior ?? 'ninguna'})` });
      if (r.fuelMovementId) observedFuel.push(r.fuelMovementId);
    }
    rows.push([
      id, ctx.companyId, r.machineId, r.fecha, r.valor, ctx.machineUnits.get(r.machineId) ?? 'HS', r.fuente, r.parteId ?? null, r.fuelMovementId ?? null,
      'ACCESS', r.legacyId ?? null, r.observada, r.observada ? `LECTURA_BAJA: ${r.valor} no encaja con la serie` : null,
    ]);
  }
  await insertMany(
    tx,
    'machine_readings',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'machine_id', cast: 'uuid' }, { name: 'fecha', cast: 'date' }, { name: 'valor' }, { name: 'unidad' },
      { name: 'fuente' }, { name: 'parte_id', cast: 'uuid' }, { name: 'fuel_movement_id', cast: 'uuid' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' },
      { name: 'observacion' },
    ],
    rows,
  );
  result.cargadas = rows.length;

  // El vale de combustible también guarda si su lectura quedó observada.
  for (let i = 0; i < observedFuel.length; i += 5000) {
    const slice = observedFuel.slice(i, i + 5000);
    await query(tx, sql`update fuel_movements set lectura_observada = true where id in ${sqlList(slice)}`);
  }
}
