/**
 * @file server/config/env.ts
 * @description Configuración del servidor de Taller leída desde variables de entorno.
 * Falla al arrancar si falta algo necesario en producción.
 */

export interface ServerEnv {
  port: number;
  databaseUrl: string | undefined;
  clerkSecretKey: string | undefined;
  clerkJwtKey: string | undefined;
  /** Solo desarrollo: permite identificar empresa y usuario por cabeceras. Nunca en producción. */
  authBypass: boolean;
  isProduction: boolean;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const isProduction = source.NODE_ENV === 'production';
  const authBypass = source.AUTH_BYPASS === 'true';

  if (authBypass && isProduction) {
    throw new Error('AUTH_BYPASS no puede estar activo con NODE_ENV=production.');
  }

  return {
    port: Number(source.PORT ?? 3101),
    databaseUrl: source.DATABASE_URL,
    clerkSecretKey: source.CLERK_SECRET_KEY,
    clerkJwtKey: source.CLERK_JWT_KEY,
    authBypass,
    isProduction,
  };
}
