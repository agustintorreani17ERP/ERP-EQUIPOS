/**
 * @file server/import/partes.ts
 * @description Bloque 4 de la importación: partes diarios de eventos. La máquina sale del campo
 * `Código`; los partes sin máquina (6 %) se asocian a una máquina «sin ficha» para que sigan visibles.
 * El número de nota de envío queda como dato histórico; las lecturas se cargan aparte (readings.ts).
 */

import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection';
import type { Observation } from '../../shared/import/common';
import { eventFromAccess } from '../../shared/import/events';
import type { TableSource } from './access';
import type { BlockResult, ImportContext } from './context';
import { insertMany } from './db';

const obsText = (obs: Observation[]): string | null => (obs.length > 0 ? [...new Set(obs.map((o) => o.code))].join(', ') : null);
const SIN_MAQUINA = 'SIN-MAQUINA';

export async function importPartes(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const rows = src.table('PARTE DIARIO DE MAQUINAS EN TALLER');
  const result: BlockResult = { bloque: 'partes diarios', leidas: rows.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  ctx.results.push(result);

  const out: unknown[][] = [];
  for (const row of rows) {
    const e = eventFromAccess(row, ctx.hoy);
    if (e.fecha === null) {
      result.rechazadas += 1;
      ctx.issues.add({
        entidad: 'parte',
        legacyId: e.legacyId,
        codigo: e.obs.find((o) => o.code === 'FECHA_FUERA_DE_RANGO') ? 'FECHA_FUERA_DE_RANGO' : 'SIN_FECHA',
        detalle: `Parte de ${e.machineCode ?? 'máquina sin código'}`,
        rechazado: true,
        datos: { maquina: e.machineCode, descripcion: e.descripcion.slice(0, 300), tipos: e.tipos, lectura: e.lectura, nota: e.notaEnvio },
      });
      continue;
    }
    const obs: Observation[] = [...e.obs];
    let machineId: string | null;
    if (e.machineCode) {
      machineId = ctx.machines.idFor(e.machineCode);
    } else {
      machineId = ctx.machines.idFor(SIN_MAQUINA);
      obs.push({ code: 'MAQUINA_SIN_FICHA', detail: 'Parte sin código de máquina' });
    }
    let worksiteId = e.destinoId ? ctx.worksites.byLegacy(e.destinoId, 'DESTINO') : null;
    if (e.destinoId && !worksiteId) obs.push({ code: 'OBRA_SIN_REGISTRO', detail: `Destino ${e.destinoId}` });
    if (!worksiteId && e.obraId) {
      worksiteId = ctx.worksites.byLegacy(e.obraId, 'OBRA');
      if (!worksiteId) obs.push({ code: 'OBRA_SIN_REGISTRO', detail: `Obra ${e.obraId}` });
    }
    const id = randomUUID();
    if (e.lectura !== null && machineId) {
      ctx.readings.push({ machineId, fecha: e.fecha, valor: e.lectura, fuente: 'PARTE', parteId: id, legacyId: e.legacyId });
    }
    if (obs.length > 0) {
      result.observadas += 1;
      ctx.issues.addObservations('parte', id, e.legacyId, obs);
    }
    ctx.events.push({ id, fecha: e.fecha, worksiteId, notaRaw: e.notaEnvio, enviaRepuestos: e.tipos.includes('ENVIO_REPUESTOS') });
    out.push([id, ctx.companyId, e.fecha, machineId, e.descripcion, `{${e.tipos.join(',')}}`, worksiteId, e.operador, e.notaEnvio, 'ACCESS', e.legacyId, obs.length > 0, obsText(obs)]);
  }

  await ctx.machines.flush(tx, ctx.companyId);
  await insertMany(
    tx,
    'daily_events',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'fecha', cast: 'date' }, { name: 'machine_id', cast: 'uuid' }, { name: 'descripcion' },
      { name: 'tipos', cast: 'text[]' }, { name: 'worksite_id', cast: 'uuid' }, { name: 'operador' }, { name: 'nota_envio' }, { name: 'origen' }, { name: 'legacy_id' },
      { name: 'observado' }, { name: 'observacion' },
    ],
    out,
  );
  result.cargadas = out.length;
}
