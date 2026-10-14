/**
 * @file server/db/schema.ts
 * @description Esquema Drizzle de Taller. Cada tabla de negocio tendrá company_id y
 * una política RLS (ver migrations/0001_init.sql). En esta fase solo existe la empresa.
 */

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Id de la organización en Clerk. Una organización = una empresa. */
  clerkOrgId: text('clerk_org_id').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
