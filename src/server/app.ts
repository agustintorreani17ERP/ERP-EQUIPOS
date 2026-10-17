/**
 * @file server/app.ts
 * @description Aplicación Express de Taller. Monta el manifest público, la identidad de
 * la sesión y las rutas de negocio (que se agregan por fase). Recibe sus dependencias
 * para poder probarse sin red ni base real.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { sql } from 'drizzle-orm';
import { createAuthMiddleware, type AuthDeps } from './auth/auth';
import type { ServerEnv } from './config/env';
import { type Db, withTenant } from './db/connection';
import { companies } from './db/schema';
import { moduleManifest } from './module/manifest';
import { ordersRouter } from './routes/orders';
import { mastersRouter } from './routes/masters';
import { fleetRouter } from './routes/fleet';
import { eventsRouter } from './routes/events';
import { financeRouter } from './routes/finance';
import { fuelRouter } from './routes/fuel';
import { maintenanceRouter } from './routes/maintenance';
import { stockRouter } from './routes/stock';
import { dispatchRouter } from './routes/dispatch';
import { importsRouter } from './routes/imports';
import { erpRouter } from './routes/erp';

export interface AppDeps {
  env: ServerEnv;
  db: Db;
}

export function createApp({ env, db }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const findCompanyIdByClerkOrg: AuthDeps['findCompanyIdByClerkOrg'] = async (clerkOrgId) => {
    const rows = await db.execute<{ id: string }>(
      sql`select company_id_for_clerk_org(${clerkOrgId}) as id`,
    );
    const id = (rows.rows?.[0] as { id: string | null } | undefined)?.id;
    return id ?? undefined;
  };
  const requireAuth = createAuthMiddleware({ env, findCompanyIdByClerkOrg });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Público: no contiene datos de ninguna empresa.
  app.get('/api/module/manifest', (_req, res) => {
    res.json(moduleManifest);
  });

  app.get('/api/me', requireAuth, async (req, res, next) => {
    try {
      const auth = req.auth!;
      const [company] = await withTenant(db, auth.companyId, (tx) =>
        tx.select({ id: companies.id, name: companies.name }).from(companies),
      );
      if (!company) {
        res.status(403).json({ error: 'La empresa no existe o no es visible para esta sesión.' });
        return;
      }
      res.json({ userId: auth.userId, company });
    } catch (err) {
      next(err);
    }
  });

  app.use(ordersRouter({ db, requireAuth }));
  app.use(mastersRouter({ db, requireAuth }));
  app.use(fleetRouter({ db, requireAuth }));
  app.use(eventsRouter({ db, requireAuth }));
  app.use(financeRouter({ db, requireAuth }));
  app.use(fuelRouter({ db, requireAuth }));
  app.use(maintenanceRouter({ db, requireAuth }));
  app.use(stockRouter({ db, requireAuth }));
  app.use(dispatchRouter({ db, requireAuth }));
  app.use(importsRouter({ db, requireAuth }));
  app.use(erpRouter({ db, requireAuth, env }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  });

  return app;
}
