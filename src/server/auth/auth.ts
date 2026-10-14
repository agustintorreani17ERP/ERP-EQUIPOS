/**
 * @file server/auth/auth.ts
 * @description Autenticación de Taller. En producción valida el JWT de Clerk y toma
 * la organización como empresa (tenant). En desarrollo, con AUTH_BYPASS=true, acepta
 * cabeceras X-Dev-User y X-Dev-Company (nunca disponible en producción).
 */

import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '@clerk/backend';
import type { ServerEnv } from '../config/env';

export interface AuthContext {
  userId: string;
  /** Id interno de la empresa (companies.id). */
  companyId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export interface AuthDeps {
  env: ServerEnv;
  /** Traduce la organización de Clerk a companies.id. Devuelve undefined si la empresa no existe. */
  findCompanyIdByClerkOrg: (clerkOrgId: string) => Promise<string | undefined>;
}

/** Extrae el id de organización del JWT de Clerk (claim `org_id` o `o.id` según la versión del token). */
export function organizationFromClaims(claims: Record<string, unknown>): string | undefined {
  if (typeof claims.org_id === 'string') return claims.org_id;
  const o = claims.o as { id?: unknown } | undefined;
  return typeof o?.id === 'string' ? o.id : undefined;
}

export function createAuthMiddleware({ env, findCompanyIdByClerkOrg }: AuthDeps) {
  return async function requireAuth(req: Request, res: Response, next: NextFunction) {
    try {
      if (env.authBypass) {
        const userId = req.header('x-dev-user');
        const companyId = req.header('x-dev-company');
        if (!userId || !companyId) {
          res.status(401).json({ error: 'Faltan cabeceras X-Dev-User y X-Dev-Company (AUTH_BYPASS).' });
          return;
        }
        req.auth = { userId, companyId };
        next();
        return;
      }

      const header = req.header('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (!token) {
        res.status(401).json({ error: 'Falta el token de sesión.' });
        return;
      }

      const claims = await verifyToken(token, {
        secretKey: env.clerkSecretKey,
        jwtKey: env.clerkJwtKey,
      });
      const clerkOrgId = organizationFromClaims(claims as unknown as Record<string, unknown>);
      if (!clerkOrgId) {
        res.status(403).json({ error: 'La sesión no tiene una empresa activa.' });
        return;
      }

      const companyId = await findCompanyIdByClerkOrg(clerkOrgId);
      if (!companyId) {
        res.status(403).json({ error: 'La empresa no está habilitada para Taller.' });
        return;
      }

      req.auth = { userId: String(claims.sub), companyId };
      next();
    } catch {
      res.status(401).json({ error: 'Sesión inválida o vencida.' });
    }
  };
}
