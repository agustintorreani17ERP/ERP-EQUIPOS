/**
 * @file server/routes/finance.ts
 * @description Cuentas de gasto, solicitudes de fondos (SF), caja chica (rendiciones), pagos a
 * proveedores e informes (SF, estado de cuenta, deuda y gastos por máquina). Reemplaza la tabla
 * única CAJA CHICA del Access: el estado sale de los pagos registrados y no de casillas.
 */

import { Router, type RequestHandler } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import {
  amountInWords,
  buildAccountStatement,
  docYear,
  formatDocNumber,
  fundRequestStatus,
  round2,
  sheetTotals,
  validateFundRequestDraft,
  validatePettyCashLine,
  type FundRequestDto,
  type LedgerMovement,
  type PaymentDto,
  type PettyCashLineDto,
  type PettyCashSheetDto,
} from '../../shared/finance';
import { randomUUID } from 'node:crypto';
import { asyncRoute, missingIds, nextDocumentNumber, nextSharedNumber, parseBody, query, Rejected, sqlList, type Row } from './helpers';
import { enqueueErp } from '../bridge/outbox';

const FUND_STATES = ['SOLICITADA', 'PAGO_PARCIAL', 'PAGADA', 'ANULADA'] as const;
const DEFAULT_ACCOUNTS: { codigo: string; nombre: string }[] = [
  { codigo: '1', nombre: 'Peaje' },
  { codigo: '2', nombre: 'Viático' },
  { codigo: '3', nombre: 'Repuestos' },
  { codigo: '4', nombre: 'Caminera' },
  { codigo: '5', nombre: 'Útiles de taller' },
  { codigo: '6', nombre: 'Insumos de taller' },
  { codigo: '7', nombre: 'Combustible taller' },
  { codigo: '8', nombre: 'Reparaciones' },
];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.');
const uuid = z.uuid();
const text = (max: number) => z.string().trim().max(max).nullable().optional();

const accountSchema = z.object({ codigo: z.string().trim().min(1).max(20), nombre: z.string().trim().min(1).max(80) });

const fundRequestSchema = z.object({
  fecha: isoDate,
  supplierId: uuid,
  monto: z.number().finite(),
  currency: z.string().length(3),
  concepto: z.string().trim().max(300),
  facturaORemision: text(60),
  accountId: uuid.nullable().optional(),
  machineId: uuid.nullable().optional(),
  pedidoNumero: z.number().int().positive().nullable().optional(),
});

const annulSchema = z.object({ motivo: z.string().trim().min(3, 'Indicá el motivo de la anulación.').max(200) });
const sfPaymentSchema = z.object({ fecha: isoDate, monto: z.number().finite(), referencia: text(80) });
const supplierPaymentSchema = sfPaymentSchema.extend({
  currency: z.string().length(3),
  fundRequestId: uuid.nullable().optional(),
  pettyCashLineId: uuid.nullable().optional(),
});

const sheetSchema = z.object({ fechaApertura: isoDate.optional(), observaciones: text(300) });
const lineSchema = z.object({
  fecha: isoDate,
  supplierId: uuid.nullable().optional(),
  facturaORemision: text(60),
  concepto: text(200),
  monto: z.number().finite(),
  accountId: uuid.nullable().optional(),
  machineId: uuid.nullable().optional(),
  aCredito: z.boolean().default(false),
});
const linesBatchSchema = z.object({ lineas: z.array(lineSchema).min(1).max(200) });
const replenishSchema = z.object({ supplierId: uuid.optional() });

const fundFiltersSchema = z.object({
  estado: z.enum(FUND_STATES).optional(),
  proveedor: uuid.optional(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  moneda: z.string().length(3).optional(),
  maquina: uuid.optional(),
  q: z.string().max(80).optional(),
});
const fundReportSchema = fundFiltersSchema.extend({ agrupar: z.enum(['proveedor', 'estado', 'mes']).default('proveedor') });
const sheetFiltersSchema = z.object({ estado: z.enum(['ABIERTA', 'CERRADA']).optional(), desde: isoDate.optional(), hasta: isoDate.optional() });
const paymentFiltersSchema = z.object({ proveedor: uuid.optional(), desde: isoDate.optional(), hasta: isoDate.optional(), incluirAnulados: z.enum(['true', 'false']).optional() });
const statementSchema = z.object({ proveedor: uuid, desde: isoDate.optional(), hasta: isoDate.optional() });
const machineExpensesSchema = z.object({
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  maquina: uuid.optional(),
  origen: z.enum(['caja', 'sf', 'todos']).default('todos'),
  incluirSinMaquina: z.enum(['true', 'false']).optional(),
});

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

interface Settings {
  currency: string;
  secondaryCurrency: string;
  pettyCashSupplierId: string | null;
}

async function loadSettings(tx: Db): Promise<Settings> {
  const [row] = await query<Row>(tx, sql`select currency, secondary_currency, petty_cash_supplier_id from company_settings limit 1`);
  return {
    currency: row ? String(row.currency) : 'PYG',
    secondaryCurrency: row ? String(row.secondary_currency) : 'USD',
    pettyCashSupplierId: row ? str(row.petty_cash_supplier_id) : null,
  };
}

/* ─── Carga de datos con estado calculado ──────────────────────────────── */

function toPayment(r: Row): PaymentDto {
  return {
    id: String(r.id),
    numero: Number(r.numero),
    fecha: String(r.fecha),
    monto: Number(r.monto),
    currency: String(r.currency),
    referencia: str(r.referencia),
    supplier: { id: String(r.supplier_id), codigo: String(r.supplier_codigo), nombre: String(r.supplier_nombre) },
    fundRequestId: str(r.fund_request_id),
    pettyCashLineId: str(r.petty_cash_line_id),
    anulado: Boolean(r.anulado),
  };
}

const PAYMENT_SELECT = sql`select p.id, p.numero, p.fecha::text as fecha, p.monto::float8 as monto, p.currency, p.referencia,
       p.supplier_id, s.codigo as supplier_codigo, s.nombre as supplier_nombre, p.fund_request_id,
       p.petty_cash_line_id, p.anulado
    from supplier_payments p join suppliers s on s.id = p.supplier_id`;

interface FundFilters {
  ids?: string[];
  proveedor?: string;
  desde?: string;
  hasta?: string;
  moneda?: string;
  maquina?: string;
  q?: string;
}

async function loadFundRequests(tx: Db, f: FundFilters): Promise<FundRequestDto[]> {
  const conditions: SQL[] = [];
  if (f.ids) conditions.push(sql`f.id in ${sqlList(f.ids)}`);
  if (f.proveedor) conditions.push(sql`f.supplier_id = ${f.proveedor}::uuid`);
  if (f.desde) conditions.push(sql`f.fecha >= ${f.desde}::date`);
  if (f.hasta) conditions.push(sql`f.fecha <= ${f.hasta}::date`);
  if (f.moneda) conditions.push(sql`f.currency = ${f.moneda}`);
  if (f.maquina) conditions.push(sql`f.machine_id = ${f.maquina}::uuid`);
  if (f.q) {
    const like = `%${f.q}%`;
    conditions.push(sql`(f.numero::text ilike ${like} or (f.numero || '/' || f.anio) ilike ${like} or f.concepto ilike ${like} or f.factura_o_remision ilike ${like})`);
  }
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const rows = await query<Row>(
    tx,
    sql`select f.id, f.numero, f.anio, f.fecha::text as fecha, f.monto::float8 as monto, f.currency, f.concepto,
               f.factura_o_remision, f.anulado, f.anulado_motivo,
               s.id as sid, s.codigo as scod, s.nombre as snom,
               a.id as aid, a.codigo as acod, a.nombre as anom,
               m.id as mid, m.codigo as mcod, m.descripcion as mdes,
               o.id as oid, o.numero as onum, sh.id as shid, sh.numero as shnum, sh.anio as shanio
        from fund_requests f
        join suppliers s on s.id = f.supplier_id
        left join expense_accounts a on a.id = f.account_id
        left join machines m on m.id = f.machine_id
        left join material_orders o on o.id = f.order_id
        left join petty_cash_sheets sh on sh.id = f.petty_cash_sheet_id
        ${where}
        order by f.fecha desc, f.numero desc`,
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.id));
  const paymentRows = await query<Row>(tx, sql`${PAYMENT_SELECT} where p.fund_request_id in ${sqlList(ids)} order by p.fecha, p.numero`);
  const payments = paymentRows.map(toPayment);

  return rows.map((r) => {
    const id = String(r.id);
    const pagos = payments.filter((p) => p.fundRequestId === id);
    const monto = Number(r.monto);
    const pagado = round2(pagos.filter((p) => !p.anulado).reduce((a, p) => a + p.monto, 0));
    const anulado = Boolean(r.anulado);
    return {
      id,
      numero: Number(r.numero),
      anio: Number(r.anio),
      fecha: String(r.fecha),
      supplier: { id: String(r.sid), codigo: String(r.scod), nombre: String(r.snom) },
      monto,
      currency: String(r.currency),
      concepto: String(r.concepto),
      facturaORemision: str(r.factura_o_remision),
      account: str(r.aid) ? { id: String(r.aid), codigo: String(r.acod), nombre: String(r.anom) } : null,
      machine: str(r.mid) ? { id: String(r.mid), codigo: String(r.mcod), descripcion: String(r.mdes) } : null,
      order: str(r.oid) ? { id: String(r.oid), numero: Number(r.onum) } : null,
      pettyCashSheet: str(r.shid) ? { id: String(r.shid), numero: Number(r.shnum), anio: Number(r.shanio) } : null,
      anulado,
      anuladoMotivo: str(r.anulado_motivo),
      pagado,
      saldo: round2(Math.max(0, monto - pagado)),
      estado: fundRequestStatus({ anulada: anulado, monto, pagado }),
      montoEnLetras: amountInWords(monto, String(r.currency)),
      pagos,
    };
  });
}

interface SheetFilters {
  ids?: string[];
  estado?: 'ABIERTA' | 'CERRADA';
  desde?: string;
  hasta?: string;
}

async function loadSheets(tx: Db, f: SheetFilters, withLines: boolean): Promise<PettyCashSheetDto[]> {
  const settings = await loadSettings(tx);
  const conditions: SQL[] = [];
  if (f.ids) conditions.push(sql`sh.id in ${sqlList(f.ids)}`);
  if (f.estado) conditions.push(sql`sh.estado = ${f.estado}`);
  if (f.desde) conditions.push(sql`sh.fecha_apertura >= ${f.desde}::date`);
  if (f.hasta) conditions.push(sql`sh.fecha_apertura <= ${f.hasta}::date`);
  const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;

  const rows = await query<Row>(
    tx,
    sql`select sh.id, sh.numero, sh.anio, sh.fecha_apertura::text as fecha_apertura, sh.estado, sh.observaciones,
               sh.cerrada_at::text as cerrada_at,
               (select count(*)::int from petty_cash_lines l where l.sheet_id = sh.id) as line_count,
               (select coalesce(sum(l.monto), 0)::float8 from petty_cash_lines l where l.sheet_id = sh.id) as total,
               (select coalesce(sum(l.monto), 0)::float8 from petty_cash_lines l where l.sheet_id = sh.id and not l.a_credito) as total_efectivo,
               r.id as rid, r.numero as rnum, r.anio as ranio, r.monto::float8 as rmonto,
               (select coalesce(sum(p.monto), 0)::float8 from supplier_payments p
                where p.fund_request_id = r.id and not p.anulado) as rpagado
        from petty_cash_sheets sh
        left join fund_requests r on r.petty_cash_sheet_id = sh.id and r.anulado = false
        ${where}
        order by sh.fecha_apertura desc, sh.numero desc`,
  );
  if (rows.length === 0) return [];

  let lineRows: Row[] = [];
  if (withLines) {
    lineRows = await query<Row>(
      tx,
      sql`select l.id, l.sheet_id, l.position, l.fecha::text as fecha, l.factura_o_remision, l.concepto,
                 l.monto::float8 as monto, l.a_credito,
                 s.id as sid, s.codigo as scod, s.nombre as snom,
                 a.id as aid, a.codigo as acod, a.nombre as anom,
                 m.id as mid, m.codigo as mcod, m.descripcion as mdes
          from petty_cash_lines l
          left join suppliers s on s.id = l.supplier_id
          left join expense_accounts a on a.id = l.account_id
          left join machines m on m.id = l.machine_id
          where l.sheet_id in ${sqlList(rows.map((r) => String(r.id)))}
          order by l.sheet_id, l.position`,
    );
  }

  return rows.map((r) => {
    const id = String(r.id);
    const lines: PettyCashLineDto[] = lineRows
      .filter((l) => String(l.sheet_id) === id)
      .map((l) => ({
        id: String(l.id),
        position: Number(l.position),
        fecha: String(l.fecha),
        supplier: str(l.sid) ? { id: String(l.sid), codigo: String(l.scod), nombre: String(l.snom) } : null,
        facturaORemision: str(l.factura_o_remision),
        concepto: str(l.concepto),
        monto: Number(l.monto),
        account: str(l.aid) ? { id: String(l.aid), codigo: String(l.acod), nombre: String(l.anom) } : null,
        machine: str(l.mid) ? { id: String(l.mid), codigo: String(l.mcod), descripcion: String(l.mdes) } : null,
        aCredito: Boolean(l.a_credito),
      }));
    const total = round2(Number(r.total));
    return {
      id,
      numero: Number(r.numero),
      anio: Number(r.anio),
      fechaApertura: String(r.fecha_apertura),
      estado: r.estado as 'ABIERTA' | 'CERRADA',
      observaciones: str(r.observaciones),
      cerradaAt: str(r.cerrada_at),
      currency: settings.currency,
      total,
      totalEfectivo: round2(Number(r.total_efectivo)),
      totalCredito: round2(total - Number(r.total_efectivo)),
      montoEnLetras: amountInWords(total, settings.currency),
      reposicion: str(r.rid)
        ? {
            id: String(r.rid),
            numero: Number(r.rnum),
            anio: Number(r.ranio),
            estado: fundRequestStatus({ anulada: false, monto: Number(r.rmonto), pagado: Number(r.rpagado) }),
          }
        : null,
      lineCount: Number(r.line_count),
      lines,
      totales: withLines ? sheetTotals(lines.map((l) => ({ monto: l.monto, accountId: l.account?.id, machineId: l.machine?.id }))) : { total, porCuenta: [], porMaquina: [] },
    };
  });
}

/* ─── Escrituras compartidas ───────────────────────────────────────────── */

async function resolveOrderId(tx: Db, pedidoNumero: number | null | undefined): Promise<{ id: string | null; error?: string }> {
  if (!pedidoNumero) return { id: null };
  const [row] = await query<{ id: string }>(tx, sql`select id from material_orders where numero = ${pedidoNumero}`);
  return row ? { id: String(row.id) } : { id: null, error: `El pedido Nº ${pedidoNumero} no existe.` };
}

async function insertFundRequest(
  tx: Db,
  companyId: string,
  v: {
    fecha: string; supplierId: string; monto: number; currency: string; concepto: string;
    facturaORemision?: string | null; accountId?: string | null; machineId?: string | null;
    orderId?: string | null; sheetId?: string | null;
  },
): Promise<string> {
  // Con el ERP conectado el número sale de su correlativo único anual (el mismo de las SF de las obras)
  const id = randomUUID();
  const { anio, numero } = await nextSharedNumber(tx, companyId, 'SF', v.fecha, id);
  const [row] = await query<{ id: string }>(
    tx,
    sql`insert into fund_requests (id, company_id, numero, anio, fecha, supplier_id, monto, currency, concepto,
          factura_o_remision, account_id, machine_id, order_id, petty_cash_sheet_id)
        values (${id}, ${companyId}, ${numero}, ${anio}, ${v.fecha}::date, ${v.supplierId}, ${v.monto}, ${v.currency}, ${v.concepto},
          ${v.facturaORemision ?? null}, ${v.accountId ?? null}, ${v.machineId ?? null}, ${v.orderId ?? null}, ${v.sheetId ?? null})
        returning id`,
  );
  await enqueueErp(tx, companyId, 'SF', String(row.id));
  return String(row.id);
}

/** Valida y registra un pago. Devuelve errores sin escribir nada si no es válido. */
async function createPayment(
  tx: Db,
  companyId: string,
  input: { supplierId: string; fecha: string; monto: number; currency: string; referencia?: string | null; fundRequestId?: string | null; pettyCashLineId?: string | null },
  settings: Settings,
): Promise<{ errors: string[]; id?: string }> {
  const errors: string[] = [];
  if (!Number.isFinite(input.monto) || input.monto <= 0) errors.push('El monto del pago debe ser mayor a 0.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) errors.push('La fecha no es válida.');
  if (errors.length > 0) return { errors };
  if ((await missingIds(tx, 'suppliers', [input.supplierId])).length > 0) return { errors: ['El proveedor no existe.'] };

  if (input.fundRequestId) {
    const [sf] = await query<Row>(
      tx,
      sql`select f.supplier_id, f.monto::float8 as monto, f.currency, f.anulado,
                 (select coalesce(sum(p.monto), 0)::float8 from supplier_payments p where p.fund_request_id = f.id and not p.anulado) as pagado
          from fund_requests f where f.id = ${input.fundRequestId}`,
    );
    if (!sf) return { errors: ['La SF no existe.'] };
    if (String(sf.supplier_id) !== input.supplierId) return { errors: ['La SF es de otro proveedor.'] };
    if (Boolean(sf.anulado)) return { errors: ['La SF está anulada.'] };
    if (String(sf.currency) !== input.currency) return { errors: [`La SF está en ${String(sf.currency)}.`] };
    const saldo = round2(Number(sf.monto) - Number(sf.pagado));
    if (input.monto > saldo) return { errors: [`El pago supera el saldo de la SF (${saldo}).`] };
  } else if (input.pettyCashLineId) {
    const [line] = await query<Row>(
      tx,
      sql`select l.supplier_id, l.monto::float8 as monto, l.a_credito,
                 (select coalesce(sum(p.monto), 0)::float8 from supplier_payments p where p.petty_cash_line_id = l.id and not p.anulado) as pagado
          from petty_cash_lines l where l.id = ${input.pettyCashLineId}`,
    );
    if (!line) return { errors: ['El renglón de caja no existe.'] };
    if (String(line.supplier_id) !== input.supplierId) return { errors: ['El renglón es de otro proveedor.'] };
    if (!Boolean(line.a_credito)) return { errors: ['El renglón se pagó en efectivo: no admite pagos.'] };
    if (input.currency !== settings.currency) return { errors: [`Los renglones de caja están en ${settings.currency}.`] };
    const saldo = round2(Number(line.monto) - Number(line.pagado));
    if (input.monto > saldo) return { errors: [`El pago supera el saldo del renglón (${saldo}).`] };
  } else if (![settings.currency, settings.secondaryCurrency].includes(input.currency)) {
    return { errors: [`La moneda debe ser ${settings.currency} o ${settings.secondaryCurrency}.`] };
  }

  const numero = await nextDocumentNumber(tx, companyId, 'PAGO');
  const [row] = await query<{ id: string }>(
    tx,
    sql`insert into supplier_payments (company_id, numero, supplier_id, fecha, monto, currency, referencia, fund_request_id, petty_cash_line_id)
        values (${companyId}, ${numero}, ${input.supplierId}, ${input.fecha}::date, ${input.monto}, ${input.currency},
                ${input.referencia ?? null}, ${input.fundRequestId ?? null}, ${input.pettyCashLineId ?? null})
        returning id`,
  );
  return { errors: [], id: String(row.id) };
}

async function loadPayment(tx: Db, id: string): Promise<PaymentDto | undefined> {
  const [row] = await query<Row>(tx, sql`${PAYMENT_SELECT} where p.id = ${id}`);
  return row ? toPayment(row) : undefined;
}

/** Cargos y pagos de proveedores para estados de cuenta y deuda. */
async function loadLedger(tx: Db, supplierId: string | null, settings: Settings) {
  const sup = supplierId ? sql`and f.supplier_id = ${supplierId}::uuid` : sql``;
  const supLine = supplierId ? sql`and l.supplier_id = ${supplierId}::uuid` : sql``;
  const supPay = supplierId ? sql`and p.supplier_id = ${supplierId}::uuid` : sql``;
  const sf = await query<Row>(
    tx,
    sql`select f.supplier_id, f.fecha::text as fecha, f.currency, f.monto::float8 as monto,
               'SF Nº ' || f.numero || '/' || f.anio as documento, f.concepto as descripcion
        from fund_requests f where f.anulado = false ${sup}`,
  );
  const credit = await query<Row>(
    tx,
    sql`select l.supplier_id, l.fecha::text as fecha, l.monto::float8 as monto, 'Caja Nº ' || sh.numero || '/' || sh.anio as documento,
               coalesce(l.concepto, l.factura_o_remision, '') as descripcion
        from petty_cash_lines l join petty_cash_sheets sh on sh.id = l.sheet_id
        where l.a_credito = true ${supLine}`,
  );
  const pay = await query<Row>(
    tx,
    sql`select p.supplier_id, p.fecha::text as fecha, p.currency, p.monto::float8 as monto,
               'Pago Nº ' || p.numero as documento, coalesce(p.referencia, '') as descripcion
        from supplier_payments p where p.anulado = false ${supPay}`,
  );
  const toMovement = (r: Row, currency: string): LedgerMovement & { supplierId: string } => ({
    supplierId: String(r.supplier_id),
    fecha: String(r.fecha),
    currency,
    monto: Number(r.monto),
    documento: String(r.documento),
    descripcion: String(r.descripcion),
  });
  return {
    cargos: [...sf.map((r) => toMovement(r, String(r.currency))), ...credit.map((r) => toMovement(r, settings.currency))],
    pagos: pay.map((r) => toMovement(r, String(r.currency))),
  };
}

function totalsByCurrency(items: { currency: string; monto: number; pagado: number; saldo: number }[]) {
  const out: Record<string, { monto: number; pagado: number; saldo: number }> = {};
  for (const i of items) {
    const t = (out[i.currency] ??= { monto: 0, pagado: 0, saldo: 0 });
    t.monto = round2(t.monto + i.monto);
    t.pagado = round2(t.pagado + i.pagado);
    t.saldo = round2(t.saldo + i.saldo);
  }
  return out;
}

export function financeRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  for (const base of ['/api/cuentas-gasto', '/api/solicitudes-fondos', '/api/pagos', '/api/caja-chica', '/api/proveedores', '/api/informes']) {
    router.use(base, deps.requireAuth);
  }

  /** Corre un bloque en transacción y traduce `Rejected` en la respuesta HTTP correspondiente. */
  const run = <T>(res: Parameters<Parameters<typeof asyncRoute>[0]>[1], companyId: string, fn: (tx: Db) => Promise<T>, status = 200) =>
    withTenant(db, companyId, fn)
      .then((out) => {
        res.status(status).json(out);
      })
      .catch((err: unknown) => {
        if (err instanceof Rejected) {
          const msg = err.errors.length === 1 ? err.errors[0] : 'No se pudo completar la operación.';
          res.status(err.status).json({ error: msg, detalles: err.errors });
          return;
        }
        throw err;
      });

  /* ── Cuentas de gasto ─────────────────────────────────────────────── */
  router.get(
    '/api/cuentas-gasto',
    asyncRoute(async (req, res) => {
      const rows = await withTenant(db, req.auth!.companyId, (tx) => query<Row>(tx, sql`select id, codigo, nombre from expense_accounts order by codigo::text`));
      res.json(rows.map((r) => ({ id: String(r.id), codigo: String(r.codigo), nombre: String(r.nombre) })));
    }),
  );

  router.post(
    '/api/cuentas-gasto',
    asyncRoute(async (req, res) => {
      const body = parseBody(accountSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      const [row] = await withTenant(db, companyId, (tx) =>
        query<Row>(
          tx,
          sql`insert into expense_accounts (company_id, codigo, nombre) values (${companyId}, ${body.codigo}, ${body.nombre})
              on conflict (company_id, codigo) do update set nombre = excluded.nombre returning id, codigo, nombre`,
        ),
      );
      res.status(201).json({ id: String(row.id), codigo: String(row.codigo), nombre: String(row.nombre) });
    }),
  );

  router.post(
    '/api/cuentas-gasto/predeterminadas',
    asyncRoute(async (req, res) => {
      const companyId = req.auth!.companyId;
      await withTenant(db, companyId, async (tx) => {
        for (const a of DEFAULT_ACCOUNTS) {
          await query(tx, sql`insert into expense_accounts (company_id, codigo, nombre) values (${companyId}, ${a.codigo}, ${a.nombre}) on conflict (company_id, codigo) do nothing`);
        }
      });
      res.json({ cargadas: DEFAULT_ACCOUNTS.length });
    }),
  );

  /* ── Solicitudes de fondos ────────────────────────────────────────── */
  router.get(
    '/api/solicitudes-fondos',
    asyncRoute(async (req, res) => {
      const parsed = fundFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const list = await withTenant(db, req.auth!.companyId, (tx) => loadFundRequests(tx, f));
      res.json(f.estado ? list.filter((s) => s.estado === f.estado) : list);
    }),
  );

  router.get(
    '/api/solicitudes-fondos/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const [sf] = id.success ? await withTenant(db, req.auth!.companyId, (tx) => loadFundRequests(tx, { ids: [id.data] })) : [];
      if (!sf) {
        res.status(404).json({ error: 'Solicitud de fondos no encontrada.' });
        return;
      }
      res.json(sf);
    }),
  );

  const writeFundRequest = async (tx: Db, companyId: string, body: z.infer<typeof fundRequestSchema>, id: string | null) => {
    const settings = await loadSettings(tx);
    const errors = validateFundRequestDraft(
      { fecha: body.fecha, supplierId: body.supplierId, monto: body.monto, currency: body.currency, concepto: body.concepto },
      today(),
      [settings.currency, settings.secondaryCurrency],
    );
    if (errors.length > 0) throw new Rejected(errors);
    const missing = [
      ...(await missingIds(tx, 'suppliers', [body.supplierId])),
      ...(await missingIds(tx, 'expense_accounts', [body.accountId])),
      ...(await missingIds(tx, 'machines', [body.machineId])),
    ];
    if (missing.length > 0) throw new Rejected(['El proveedor, la cuenta o la máquina elegidos no existen.']);
    const order = await resolveOrderId(tx, body.pedidoNumero);
    if (order.error) throw new Rejected([order.error]);

    if (id === null) {
      return insertFundRequest(tx, companyId, { ...body, orderId: order.id });
    }
    await query(
      tx,
      sql`update fund_requests set fecha = ${body.fecha}::date, supplier_id = ${body.supplierId}, monto = ${body.monto},
            currency = ${body.currency}, concepto = ${body.concepto}, factura_o_remision = ${body.facturaORemision ?? null},
            account_id = ${body.accountId ?? null}, machine_id = ${body.machineId ?? null}, order_id = ${order.id}
          where id = ${id}`,
    );
    await enqueueErp(tx, companyId, 'SF', id);
    return id;
  };

  router.post(
    '/api/solicitudes-fondos',
    asyncRoute(async (req, res) => {
      const body = parseBody(fundRequestSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await run(res, companyId, async (tx) => {
        const id = await writeFundRequest(tx, companyId, body, null);
        return (await loadFundRequests(tx, { ids: [id] }))[0];
      }, 201);
    }),
  );

  router.put(
    '/api/solicitudes-fondos/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Solicitud de fondos no encontrada.' });
        return;
      }
      const body = parseBody(fundRequestSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await run(res, companyId, async (tx) => {
        const [current] = await loadFundRequests(tx, { ids: [id.data] });
        if (!current) throw new Rejected(['Solicitud de fondos no encontrada.'], 404);
        if (current.anulado || current.pagos.some((p) => !p.anulado)) {
          throw new Rejected(['Una SF anulada o con pagos no se puede modificar.'], 409);
        }
        if (current.pettyCashSheet) throw new Rejected(['La SF de reposición se genera desde la caja chica y no se edita.'], 409);
        await writeFundRequest(tx, companyId, body, id.data);
        return (await loadFundRequests(tx, { ids: [id.data] }))[0];
      });
    }),
  );

  router.post(
    '/api/solicitudes-fondos/:id/anular',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Solicitud de fondos no encontrada.' });
        return;
      }
      const body = parseBody(annulSchema, req, res);
      if (!body) return;
      await run(res, req.auth!.companyId, async (tx) => {
        const [current] = await loadFundRequests(tx, { ids: [id.data] });
        if (!current) throw new Rejected(['Solicitud de fondos no encontrada.'], 404);
        if (current.pagos.some((p) => !p.anulado)) throw new Rejected(['Anulá primero los pagos de esta SF.'], 409);
        await query(tx, sql`update fund_requests set anulado = true, anulado_motivo = ${body.motivo} where id = ${id.data}`);
        await enqueueErp(tx, req.auth!.companyId, 'SF', id.data);
        return (await loadFundRequests(tx, { ids: [id.data] }))[0];
      });
    }),
  );

  router.post(
    '/api/solicitudes-fondos/:id/pagos',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Solicitud de fondos no encontrada.' });
        return;
      }
      const body = parseBody(sfPaymentSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await run(res, companyId, async (tx) => {
        const [sf] = await loadFundRequests(tx, { ids: [id.data] });
        if (!sf) throw new Rejected(['Solicitud de fondos no encontrada.'], 404);
        const settings = await loadSettings(tx);
        const out = await createPayment(tx, companyId, { supplierId: sf.supplier.id, fecha: body.fecha, monto: body.monto, currency: sf.currency, referencia: body.referencia, fundRequestId: sf.id }, settings);
        if (out.errors.length > 0) throw new Rejected(out.errors);
        return (await loadFundRequests(tx, { ids: [id.data] }))[0];
      }, 201);
    }),
  );

  /* ── Pagos a proveedores ──────────────────────────────────────────── */
  router.post(
    '/api/proveedores/:id/pagos',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Proveedor no encontrado.' });
        return;
      }
      const body = parseBody(supplierPaymentSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await run(res, companyId, async (tx) => {
        if ((await missingIds(tx, 'suppliers', [id.data])).length > 0) throw new Rejected(['Proveedor no encontrado.'], 404);
        const settings = await loadSettings(tx);
        const out = await createPayment(tx, companyId, { ...body, supplierId: id.data }, settings);
        if (out.errors.length > 0) throw new Rejected(out.errors);
        return loadPayment(tx, out.id!);
      }, 201);
    }),
  );

  router.get(
    '/api/pagos',
    asyncRoute(async (req, res) => {
      const parsed = paymentFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const conditions: SQL[] = [];
      if (f.proveedor) conditions.push(sql`p.supplier_id = ${f.proveedor}::uuid`);
      if (f.desde) conditions.push(sql`p.fecha >= ${f.desde}::date`);
      if (f.hasta) conditions.push(sql`p.fecha <= ${f.hasta}::date`);
      if (f.incluirAnulados !== 'true') conditions.push(sql`p.anulado = false`);
      const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
      const rows = await withTenant(db, req.auth!.companyId, (tx) => query<Row>(tx, sql`${PAYMENT_SELECT} ${where} order by p.fecha desc, p.numero desc`));
      res.json(rows.map(toPayment));
    }),
  );

  router.post(
    '/api/pagos/:id/anular',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Pago no encontrado.' });
        return;
      }
      await run(res, req.auth!.companyId, async (tx) => {
        await query(tx, sql`update supplier_payments set anulado = true where id = ${id.data}`);
        const payment = await loadPayment(tx, id.data);
        if (!payment) throw new Rejected(['Pago no encontrado.'], 404);
        return payment;
      });
    }),
  );

  /* ── Caja chica ───────────────────────────────────────────────────── */
  router.get(
    '/api/caja-chica',
    asyncRoute(async (req, res) => {
      const parsed = sheetFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadSheets(tx, parsed.data, false)));
    }),
  );

  router.post(
    '/api/caja-chica',
    asyncRoute(async (req, res) => {
      const body = parseBody(sheetSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await run(res, companyId, async (tx) => {
        const apertura = body.fechaApertura ?? today();
        const anio = docYear(apertura);
        const numero = await nextDocumentNumber(tx, companyId, `CAJA:${anio}`);
        const [row] = await query<{ id: string }>(
          tx,
          sql`insert into petty_cash_sheets (company_id, numero, anio, fecha_apertura, observaciones)
              values (${companyId}, ${numero}, ${anio}, ${apertura}::date, ${body.observaciones ?? null}) returning id`,
        );
        return (await loadSheets(tx, { ids: [String(row.id)] }, true))[0];
      }, 201);
    }),
  );

  router.get(
    '/api/caja-chica/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const [sheet] = id.success ? await withTenant(db, req.auth!.companyId, (tx) => loadSheets(tx, { ids: [id.data] }, true)) : [];
      if (!sheet) {
        res.status(404).json({ error: 'Rendición no encontrada.' });
        return;
      }
      res.json(sheet);
    }),
  );

  /** Valida un renglón y lo inserta al final de la rendición (que debe estar abierta). */
  const addLine = async (tx: Db, companyId: string, sheetId: string, line: z.infer<typeof lineSchema>): Promise<void> => {
    const errors = validatePettyCashLine({ fecha: line.fecha, supplierId: line.supplierId, monto: line.monto, aCredito: line.aCredito }, today());
    if (errors.length > 0) throw new Rejected(errors);
    const missing = [
      ...(await missingIds(tx, 'suppliers', [line.supplierId])),
      ...(await missingIds(tx, 'expense_accounts', [line.accountId])),
      ...(await missingIds(tx, 'machines', [line.machineId])),
    ];
    if (missing.length > 0) throw new Rejected(['El proveedor, la cuenta o la máquina elegidos no existen.']);
    const [pos] = await query<{ next: number }>(tx, sql`select coalesce(max(position), 0) + 1 as next from petty_cash_lines where sheet_id = ${sheetId}`);
    await query(
      tx,
      sql`insert into petty_cash_lines (company_id, sheet_id, position, fecha, supplier_id, factura_o_remision, concepto, monto, account_id, machine_id, a_credito)
          values (${companyId}, ${sheetId}, ${Number(pos.next)}, ${line.fecha}::date, ${line.supplierId ?? null}, ${line.facturaORemision ?? null},
                  ${line.concepto ?? null}, ${line.monto}, ${line.accountId ?? null}, ${line.machineId ?? null}, ${line.aCredito})`,
    );
  };

  const requireOpenSheet = async (tx: Db, sheetId: string): Promise<void> => {
    const [sheet] = await query<Row>(tx, sql`select estado from petty_cash_sheets where id = ${sheetId}`);
    if (!sheet) throw new Rejected(['Rendición no encontrada.'], 404);
    if (String(sheet.estado) !== 'ABIERTA') throw new Rejected(['La rendición está cerrada y no admite cambios.'], 409);
  };

  router.post(
    '/api/caja-chica/:id/lineas',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Rendición no encontrada.' });
        return;
      }
      const body = parseBody(lineSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await run(res, companyId, async (tx) => {
        await requireOpenSheet(tx, id.data);
        await addLine(tx, companyId, id.data, body);
        return (await loadSheets(tx, { ids: [id.data] }, true))[0];
      }, 201);
    }),
  );

  router.post(
    '/api/caja-chica/:id/lineas/lote',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Rendición no encontrada.' });
        return;
      }
      const body = parseBody(linesBatchSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await run(res, companyId, async (tx) => {
        await requireOpenSheet(tx, id.data);
        const rejected: string[] = [];
        for (const [i, line] of body.lineas.entries()) {
          try {
            await addLine(tx, companyId, id.data, line);
          } catch (err) {
            if (err instanceof Rejected) rejected.push(...err.errors.map((e) => `Renglón ${i + 1}: ${e}`));
            else throw err;
          }
        }
        // Un renglón inválido deshace todo el lote.
        if (rejected.length > 0) throw new Rejected(rejected);
        return (await loadSheets(tx, { ids: [id.data] }, true))[0];
      }, 201);
    }),
  );

  router.put(
    '/api/caja-chica/:id/lineas/:lineId',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const lineId = uuid.safeParse(req.params.lineId);
      if (!id.success || !lineId.success) {
        res.status(404).json({ error: 'Renglón no encontrado.' });
        return;
      }
      const body = parseBody(lineSchema, req, res);
      if (!body) return;
      await run(res, req.auth!.companyId, async (tx) => {
        await requireOpenSheet(tx, id.data);
        const errors = validatePettyCashLine({ fecha: body.fecha, supplierId: body.supplierId, monto: body.monto, aCredito: body.aCredito }, today());
        if (errors.length > 0) throw new Rejected(errors);
        const missing = [
          ...(await missingIds(tx, 'suppliers', [body.supplierId])),
          ...(await missingIds(tx, 'expense_accounts', [body.accountId])),
          ...(await missingIds(tx, 'machines', [body.machineId])),
        ];
        if (missing.length > 0) throw new Rejected(['El proveedor, la cuenta o la máquina elegidos no existen.']);
        const [paid] = await query<Row>(tx, sql`select count(*)::int as n from supplier_payments where petty_cash_line_id = ${lineId.data} and anulado = false`);
        if (Number(paid.n) > 0) throw new Rejected(['El renglón tiene pagos registrados y no se puede modificar.'], 409);
        const updated = await query(
          tx,
          sql`update petty_cash_lines set fecha = ${body.fecha}::date, supplier_id = ${body.supplierId ?? null},
                factura_o_remision = ${body.facturaORemision ?? null}, concepto = ${body.concepto ?? null}, monto = ${body.monto},
                account_id = ${body.accountId ?? null}, machine_id = ${body.machineId ?? null}, a_credito = ${body.aCredito}
              where id = ${lineId.data} and sheet_id = ${id.data} returning id`,
        );
        if (updated.length === 0) throw new Rejected(['Renglón no encontrado.'], 404);
        return (await loadSheets(tx, { ids: [id.data] }, true))[0];
      });
    }),
  );

  router.delete(
    '/api/caja-chica/:id/lineas/:lineId',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const lineId = uuid.safeParse(req.params.lineId);
      if (!id.success || !lineId.success) {
        res.status(404).json({ error: 'Renglón no encontrado.' });
        return;
      }
      await run(res, req.auth!.companyId, async (tx) => {
        await requireOpenSheet(tx, id.data);
        const [paid] = await query<Row>(tx, sql`select count(*)::int as n from supplier_payments where petty_cash_line_id = ${lineId.data}`);
        if (Number(paid.n) > 0) throw new Rejected(['El renglón tiene pagos registrados y no se puede borrar.'], 409);
        const deleted = await query(tx, sql`delete from petty_cash_lines where id = ${lineId.data} and sheet_id = ${id.data} returning id`);
        if (deleted.length === 0) throw new Rejected(['Renglón no encontrado.'], 404);
        return (await loadSheets(tx, { ids: [id.data] }, true))[0];
      });
    }),
  );

  router.post(
    '/api/caja-chica/:id/cerrar',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Rendición no encontrada.' });
        return;
      }
      await run(res, req.auth!.companyId, async (tx) => {
        await requireOpenSheet(tx, id.data);
        const [count] = await query<Row>(tx, sql`select count(*)::int as n from petty_cash_lines where sheet_id = ${id.data}`);
        if (Number(count.n) === 0) throw new Rejected(['La rendición no tiene renglones.'], 422);
        await query(tx, sql`update petty_cash_sheets set estado = 'CERRADA', cerrada_at = now() where id = ${id.data}`);
        return (await loadSheets(tx, { ids: [id.data] }, true))[0];
      });
    }),
  );

  router.post(
    '/api/caja-chica/:id/reponer',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: 'Rendición no encontrada.' });
        return;
      }
      const body = parseBody(replenishSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await run(res, companyId, async (tx) => {
        const [sheet] = await loadSheets(tx, { ids: [id.data] }, false);
        if (!sheet) throw new Rejected(['Rendición no encontrada.'], 404);
        if (sheet.estado !== 'CERRADA') throw new Rejected(['Cerrá la rendición antes de pedir la reposición.'], 409);
        if (sheet.reposicion) throw new Rejected([`La rendición ya tiene la SF Nº ${formatDocNumber(sheet.reposicion.numero, sheet.reposicion.anio)} de reposición.`], 409);
        if (sheet.totalEfectivo <= 0) throw new Rejected(['La rendición no tiene gastos en efectivo para reponer.'], 422);

        const settings = await loadSettings(tx);
        const supplierId = body.supplierId ?? settings.pettyCashSupplierId;
        if (!supplierId) throw new Rejected(['Elegí el proveedor que recibe la reposición de caja chica.'], 422);
        if ((await missingIds(tx, 'suppliers', [supplierId])).length > 0) throw new Rejected(['El proveedor elegido no existe.'], 422);
        if (body.supplierId && !settings.pettyCashSupplierId) {
          // La primera vez queda guardado como beneficiario habitual.
          await query(tx, sql`insert into company_settings (company_id, petty_cash_supplier_id) values (${companyId}, ${body.supplierId}) on conflict (company_id) do update set petty_cash_supplier_id = excluded.petty_cash_supplier_id`);
        }
        const sfId = await insertFundRequest(tx, companyId, {
          fecha: today(),
          supplierId,
          monto: sheet.totalEfectivo,
          currency: settings.currency,
          concepto: `Reposición de caja chica Nº ${formatDocNumber(sheet.numero, sheet.anio)}`,
          sheetId: sheet.id,
        });
        return (await loadFundRequests(tx, { ids: [sfId] }))[0];
      }, 201);
    }),
  );

  /* ── Informes ─────────────────────────────────────────────────────── */
  router.get(
    '/api/informes/solicitudes-fondos',
    asyncRoute(async (req, res) => {
      const parsed = fundReportSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const all = await withTenant(db, req.auth!.companyId, (tx) => loadFundRequests(tx, f));
      const list = f.estado ? all.filter((s) => s.estado === f.estado) : all;
      const groups = new Map<string, FundRequestDto[]>();
      for (const sf of list) {
        const key = f.agrupar === 'proveedor' ? sf.supplier.nombre : f.agrupar === 'estado' ? sf.estado : sf.fecha.slice(0, 7);
        groups.set(key, [...(groups.get(key) ?? []), sf]);
      }
      res.json({
        agrupar: f.agrupar,
        totales: totalsByCurrency(list.filter((s) => !s.anulado)),
        grupos: [...groups.entries()]
          .sort(([a], [b]) => (f.agrupar === 'mes' ? b.localeCompare(a) : a.localeCompare(b)))
          .map(([clave, items]) => ({
            clave,
            cantidad: items.length,
            totales: totalsByCurrency(items.filter((s) => !s.anulado)),
            filas: items,
          })),
      });
    }),
  );

  router.get(
    '/api/informes/estado-cuenta',
    asyncRoute(async (req, res) => {
      const parsed = statementSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      const hasta = f.hasta ?? today();
      const desde = f.desde ?? `${hasta.slice(0, 4)}-01-01`;
      await run(res, req.auth!.companyId, async (tx) => {
        const [supplier] = await query<Row>(tx, sql`select id, codigo, nombre, ruc from suppliers where id = ${f.proveedor}`);
        if (!supplier) throw new Rejected(['Proveedor no encontrado.'], 404);
        const settings = await loadSettings(tx);
        const ledger = await loadLedger(tx, f.proveedor, settings);
        return {
          supplier: { id: String(supplier.id), codigo: String(supplier.codigo), nombre: String(supplier.nombre), ruc: str(supplier.ruc) },
          desde,
          hasta,
          monedas: buildAccountStatement({ cargos: ledger.cargos, pagos: ledger.pagos, desde, hasta }),
        };
      });
    }),
  );

  router.get(
    '/api/informes/deuda-proveedores',
    asyncRoute(async (req, res) => {
      await run(res, req.auth!.companyId, async (tx) => {
        const settings = await loadSettings(tx);
        const ledger = await loadLedger(tx, null, settings);
        const names = await query<Row>(tx, sql`select id, codigo, nombre from suppliers`);
        const byId = new Map(names.map((n) => [String(n.id), n]));
        const balance = new Map<string, number>();
        const add = (supplierId: string, currency: string, delta: number) => {
          const key = `${supplierId}|${currency}`;
          balance.set(key, round2((balance.get(key) ?? 0) + delta));
        };
        for (const c of ledger.cargos) add(c.supplierId, c.currency, c.monto);
        for (const p of ledger.pagos) add(p.supplierId, p.currency, -p.monto);
        const items = [...balance.entries()]
          .filter(([, saldo]) => saldo > 0)
          .map(([key, saldo]) => {
            const [supplierId, currency] = key.split('|');
            const s = byId.get(supplierId);
            return { supplier: { id: supplierId, codigo: String(s?.codigo ?? ''), nombre: String(s?.nombre ?? '') }, currency, saldo };
          })
          .sort((a, b) => b.saldo - a.saldo);
        const totales: Record<string, number> = {};
        for (const i of items) totales[i.currency] = round2((totales[i.currency] ?? 0) + i.saldo);
        return { hoy: today(), totales, items };
      });
    }),
  );

  router.get(
    '/api/informes/gastos-maquina',
    asyncRoute(async (req, res) => {
      const parsed = machineExpensesSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const f = parsed.data;
      await run(res, req.auth!.companyId, async (tx) => {
        const settings = await loadSettings(tx);
        const cajaWhere: SQL[] = [];
        const sfWhere: SQL[] = [sql`f.anulado = false`];
        if (f.desde) { cajaWhere.push(sql`l.fecha >= ${f.desde}::date`); sfWhere.push(sql`f.fecha >= ${f.desde}::date`); }
        if (f.hasta) { cajaWhere.push(sql`l.fecha <= ${f.hasta}::date`); sfWhere.push(sql`f.fecha <= ${f.hasta}::date`); }
        if (f.maquina) { cajaWhere.push(sql`l.machine_id = ${f.maquina}::uuid`); sfWhere.push(sql`f.machine_id = ${f.maquina}::uuid`); }
        if (f.incluirSinMaquina !== 'true') { cajaWhere.push(sql`l.machine_id is not null`); sfWhere.push(sql`f.machine_id is not null`); }
        const cw = cajaWhere.length > 0 ? sql`where ${sql.join(cajaWhere, sql` and `)}` : sql``;
        const sw = sql`where ${sql.join(sfWhere, sql` and `)}`;

        const caja = f.origen === 'sf' ? [] : await query<Row>(
          tx,
          sql`select l.fecha::text as fecha, 'CAJA' as origen, 'Caja Nº ' || sh.numero || '/' || sh.anio as documento, s.nombre as proveedor,
                     a.nombre as cuenta, m.id as mid, m.codigo as mcod, m.descripcion as mdes, l.monto::float8 as monto
              from petty_cash_lines l join petty_cash_sheets sh on sh.id = l.sheet_id left join suppliers s on s.id = l.supplier_id
              left join expense_accounts a on a.id = l.account_id left join machines m on m.id = l.machine_id
              ${cw} order by l.fecha`,
        );
        const sf = f.origen === 'caja' ? [] : await query<Row>(
          tx,
          sql`select f.fecha::text as fecha, 'SF' as origen, 'SF Nº ' || f.numero || '/' || f.anio as documento, s.nombre as proveedor,
                     a.nombre as cuenta, m.id as mid, m.codigo as mcod, m.descripcion as mdes, f.monto::float8 as monto, f.currency
              from fund_requests f join suppliers s on s.id = f.supplier_id
              left join expense_accounts a on a.id = f.account_id left join machines m on m.id = f.machine_id
              ${sw} order by f.fecha`,
        );
        type DetailSource = Row & { currency: string };
        const sources: DetailSource[] = [
          ...caja.map((r): DetailSource => ({ ...r, currency: settings.currency })),
          ...sf.map((r): DetailSource => ({ ...r, currency: String(r.currency) })),
        ];
        const detalle = sources.map((r) => ({
          fecha: String(r.fecha),
          origen: String(r.origen) as 'CAJA' | 'SF',
          documento: String(r.documento),
          proveedor: str(r.proveedor) ?? 'Sin proveedor',
          cuenta: str(r.cuenta),
          maquina: str(r.mid) ? { id: String(r.mid), codigo: String(r.mcod), descripcion: String(r.mdes) } : null,
          monto: Number(r.monto),
          currency: r.currency,
        }));
        const summary = new Map<string, { maquina: { id: string; codigo: string; descripcion: string } | null; currency: string; caja: number; sf: number }>();
        for (const d of detalle) {
          const key = `${d.maquina?.id ?? 'sin'}|${d.currency}`;
          const row = summary.get(key) ?? { maquina: d.maquina, currency: d.currency, caja: 0, sf: 0 };
          if (d.origen === 'CAJA') row.caja = round2(row.caja + d.monto);
          else row.sf = round2(row.sf + d.monto);
          summary.set(key, row);
        }
        return {
          resumen: [...summary.values()]
            .map((r) => ({ ...r, total: round2(r.caja + r.sf) }))
            .sort((a, b) => b.total - a.total),
          detalle,
        };
      });
    }),
  );

  return router;
}

