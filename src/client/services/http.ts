/**
 * @file services/http.ts
 * @description Cliente HTTP de Taller. En desarrollo envía las cabeceras de AUTH_BYPASS
 * (empresa y usuario de prueba). En producción el token de Clerk se agregará aquí.
 */

/** Empresa de la base local de desarrollo (ver DEV_COMPANY_ID en server/db/connection.ts). */
const DEV_COMPANY_ID = '00000000-0000-4000-8000-000000000001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detalles: string[] = [],
  ) {
    super(message);
  }
}

function authHeaders(): Record<string, string> {
  if (!import.meta.env.DEV) return {};
  return {
    'X-Dev-User': 'dev',
    'X-Dev-Company': import.meta.env.VITE_DEV_COMPANY_ID ?? DEV_COMPANY_ID,
  };
}

/** Mensaje legible para mostrar al usuario, con los detalles de validación si los hay. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.detalles.length > 0 ? `${err.message} ${err.detalles.join(' ')}` : err.message;
  }
  return 'No se pudo completar la operación. Revisá la conexión e intentá de nuevo.';
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      ...authHeaders(),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data?.detalles ?? []);
  }
  return data as T;
}
