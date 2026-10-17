/**
 * @file server/bridge/erp.ts
 * @description Cliente HTTP del ERP (InfraTrack): el único punto por el que el Taller le habla.
 * Pide los números únicos de SF y notas de envío y le entrega pedidos, SF y notas. Las respuestas que
 * no son 2xx se distinguen en "el ERP no está" (reintentar) y "el ERP rechazó el documento" (revisar).
 */

import type { ErpEnv } from '../config/env';

export type TipoNumerado = 'SF' | 'NE';

export interface NumeroErp {
  anio: number;
  numero: number;
}

/** El ERP no respondió o falló (red, 5xx): se puede reintentar. */
export class ErpUnavailable extends Error {}

/** El ERP respondió 4xx: el documento no es válido para él; reintentar no lo arregla. */
export class ErpRejected extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ErpClient {
  /** Pide el próximo número de la secuencia única anual. Idempotente por `externalId`. */
  pedirNumero(tipo: TipoNumerado, fecha: string, externalId: string): Promise<NumeroErp>;
  /** POST a una ruta de integración del ERP (`/api/integracion/…`). */
  enviar(path: string, body: unknown): Promise<void>;
}

const TIMEOUT_MS = 10_000;

export function createErpClient(env: ErpEnv, fetchImpl: typeof fetch = fetch): ErpClient {
  async function post(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(`${env.url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-integration-key': env.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new ErpUnavailable(`No se pudo conectar con el ERP: ${(err as Error).message}`);
    }
    const payload = (await res.json().catch(() => null)) as { data?: unknown; error?: { message?: string } | string; message?: string } | null;
    if (res.ok) return payload?.data;
    const detail =
      typeof payload?.error === 'string' ? payload.error : payload?.error?.message ?? payload?.message ?? `HTTP ${res.status}`;
    // 401/403/404 son de configuración (clave o URL mal): tampoco se arreglan reintentando el mismo documento,
    // pero sí al corregir la configuración, así que se tratan como "no disponible".
    if (res.status >= 500 || res.status === 401 || res.status === 403 || res.status === 404 || res.status === 503) {
      throw new ErpUnavailable(`El ERP respondió ${res.status}: ${detail}`);
    }
    throw new ErpRejected(detail, res.status);
  }

  return {
    async pedirNumero(tipo, fecha, externalId) {
      const data = (await post('/api/integracion/numeracion', { tipo, fecha, externalId })) as Partial<NumeroErp> | undefined;
      if (!data || !Number.isInteger(data.anio) || !Number.isInteger(data.numero)) {
        throw new ErpUnavailable('El ERP devolvió una respuesta de numeración inválida.');
      }
      return { anio: data.anio as number, numero: data.numero as number };
    },
    async enviar(path, body) {
      await post(path, body);
    },
  };
}

let current: ErpClient | null = null;

/** Cliente configurado (null = el Taller funciona solo). Lo fija el arranque del servidor o los tests. */
export function getErp(): ErpClient | null {
  return current;
}

export function configureErp(client: ErpClient | null): void {
  current = client;
}
