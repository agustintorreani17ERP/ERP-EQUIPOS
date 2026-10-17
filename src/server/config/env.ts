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
  /**
   * Conexión con el ERP (InfraTrack). Sin ERP_URL el Taller funciona solo: numera sus propios
   * documentos y no sincroniza nada. Con ERP_URL, las SF y las notas de envío toman su número del
   * ERP y los pedidos, SF y notas se le envían.
   */
  erp: ErpEnv | undefined;
}

export interface ErpEnv {
  /** URL base del ERP, p. ej. http://localhost:3000 */
  url: string;
  /** Clave compartida (INTEGRACION_TALLER_KEY del ERP). También autentica los avisos que él manda. */
  key: string;
  /** Empresa (companies.id) a la que pertenecen los avisos del ERP: la integración no usa sesión de usuario. */
  companyId: string;
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
    erp: loadErpEnv(source),
  };
}

function loadErpEnv(source: NodeJS.ProcessEnv): ErpEnv | undefined {
  const url = source.ERP_URL?.trim();
  if (!url) return undefined;
  const key = source.ERP_INTEGRATION_KEY?.trim();
  const companyId = source.ERP_COMPANY_ID?.trim();
  if (!key || !companyId) {
    throw new Error('Con ERP_URL también hacen falta ERP_INTEGRATION_KEY y ERP_COMPANY_ID.');
  }
  return { url: url.replace(/\/+$/, ''), key, companyId };
}
