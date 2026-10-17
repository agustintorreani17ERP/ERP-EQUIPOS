/**
 * @file server/bridge/sync.ts
 * @description Arranca la conexión con el ERP: configura el cliente y entrega la cola de envíos cada 30 s.
 * Sin ERP_URL no hace nada (el Taller funciona solo).
 */

import type { ErpEnv } from '../config/env';
import type { Db } from '../db/connection';
import { configureErp, createErpClient } from './erp';
import { buildErpPayload } from './erpPayloads';
import { procesarOutbox } from './outbox';

export function iniciarConexionErp(db: Db, erpEnv: ErpEnv | undefined, intervaloMs = 30_000): () => void {
  if (!erpEnv) {
    configureErp(null);
    return () => undefined;
  }
  const client = createErpClient(erpEnv);
  configureErp(client);
  let corriendo = false;
  const timer = setInterval(() => {
    if (corriendo) return;
    corriendo = true;
    procesarOutbox(db, erpEnv.companyId, client, buildErpPayload)
      .catch((err) => console.error('[erp] sincronización:', err))
      .finally(() => {
        corriendo = false;
      });
  }, intervaloMs);
  timer.unref();
  console.log(`Conectado al ERP en ${erpEnv.url}`);
  return () => clearInterval(timer);
}
