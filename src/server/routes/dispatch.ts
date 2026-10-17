/**
 * @file server/routes/dispatch.ts
 * @description Notas de envío: a oficina central (documentos en papel) y a obra (repuestos).
 * Reemplaza NOTA ENVIO del Access, donde el documento se tipeaba y podía enviarse dos veces.
 * Los pedidos, recepciones, SF y rendiciones se eligen de «pendientes de enviar» y quedan
 * enlazados; un documento del ERP solo puede estar en una nota vigente. Los partes de envío de
 * repuestos se agrupan en notas a obra con número automático.
 */

import { Router, type RequestHandler, type Response } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type Db, withTenant } from '../db/connection';
import {
  DEFAULT_DOCUMENT_TYPES,
  canEditNote,
  documentAfterDispatch,
  validateAcknowledge,
  validateOfficeNote,
  validateSiteNote,
  type DispatchState,
  type DocumentTypeDto,
  type OfficeLineDto,
  type OfficeLineKind,
  type OfficeNoteDto,
  type PendingDocumentDto,
  type PendingDocumentsDto,
  type SentDocumentDto,
  type SiteNoteDto,
  type SiteNoteEventDto,
} from '../../shared/dispatch';
import { dayDiff } from '../../shared/fleet';
import { formatDocNumber } from '../../shared/finance';
import { randomUUID } from 'node:crypto';
import { asyncRoute, missingIds, nextSharedNumber, parseBody, query, Rejected, sqlList, type Row } from './helpers';
import { enqueueErp } from '../bridge/outbox';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD.');
const uuid = z.uuid();
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const LINKED_KINDS = ['PEDIDO', 'RECEPCION', 'SF', 'RENDICION'] as const;
type LinkedKind = (typeof LINKED_KINDS)[number];

/** Cuántos días hacia atrás se listan los pendientes si no se indica `desde`. */
const DEFAULT_PENDING_DAYS = 90;

const documentTypeSchema = z.object({
  codigo: z.string().trim().min(1).max(30),
  nombre: z.string().trim().min(1).max(80),
  activo: z.boolean().default(true),
});

const officeLineSchema = z.object({
  kind: z.enum(['PEDIDO', 'RECEPCION', 'SF', 'RENDICION', 'MANUAL']),
  documentId: uuid.nullable().optional(),
  documentTypeId: uuid.nullable().optional(),
  numero: text(60),
  supplierId: uuid.nullable().optional(),
  fechaDocumento: isoDate.nullable().optional(),
  machineId: uuid.nullable().optional(),
  observacion: text(300),
});

const officeNoteSchema = z.object({
  fecha: isoDate,
  observaciones: text(500),
  lines: z.array(officeLineSchema).min(1, 'La nota debe incluir al menos un documento.').max(200),
});

const officeFiltersSchema = z.object({
  estado: z.enum(['ENVIADA', 'RECIBIDA', 'ANULADA']).optional(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  q: z.string().max(80).optional(),
});

const sentFiltersSchema = z.object({
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  proveedor: uuid.optional(),
  maquina: uuid.optional(),
  tipo: z.enum(['PEDIDO', 'RECEPCION', 'SF', 'RENDICION', 'MANUAL']).optional(),
  tipoDocumento: uuid.optional(),
  q: z.string().max(80).optional(),
  incluirAnuladas: z.enum(['true', 'false']).optional(),
});

const pendingFiltersSchema = z.object({ desde: isoDate.optional() });

const ackSchema = z.object({
  fecha: isoDate,
  recibidoPor: z.string().trim().min(1, 'Indicá quién recibió.').max(80, 'El nombre de quien recibió es demasiado largo.'),
});
const cancelSchema = z.object({ motivo: z.string().trim().min(3, 'Indicá el motivo.').max(200) });

const siteNoteSchema = z.object({
  fecha: isoDate,
  worksiteId: uuid,
  chofer: text(80),
  observaciones: text(500),
  eventIds: z.array(uuid).min(1, 'La nota debe incluir al menos un envío.').max(200),
});

const siteFiltersSchema = z.object({
  estado: z.enum(['ENVIADA', 'RECIBIDA', 'ANULADA']).optional(),
  desde: isoDate.optional(),
  hasta: isoDate.optional(),
  obra: uuid.optional(),
  q: z.string().max(80).optional(),
});

const eventsWithoutNoteSchema = z.object({ obra: uuid.optional(), desde: isoDate.optional(), hasta: isoDate.optional() });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const nullableString = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

async function runInTenant<T>(db: Db, res: Response, companyId: string, fn: (tx: Db) => Promise<T>, status = 200): Promise<void> {
  try {
    res.status(status).json(await withTenant(db, companyId, fn));
  } catch (err) {
    if (err instanceof Rejected) {
      res.status(err.status).json({ error: err.errors.length === 1 ? err.errors[0] : 'No se pudo completar la operación.', detalles: err.errors });
      return;
    }
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'Un documento ya está incluido en otra nota de envío vigente.' });
      return;
    }
    throw err;
  }
}

/* ─── Tipos de documento ───────────────────────────────────────────────── */

const mapDocumentType = (r: Row): DocumentTypeDto => ({
  id: String(r.id),
  codigo: String(r.codigo),
  nombre: String(r.nombre),
  activo: Boolean(r.activo),
});

async function loadDocumentTypes(tx: Db): Promise<DocumentTypeDto[]> {
  const rows = await query<Row>(tx, sql`select id, codigo, nombre, activo from document_types order by nombre`);
  return rows.map(mapDocumentType);
}

/* ─── Notas a oficina ──────────────────────────────────────────────────── */

const KIND_ORDER = sql`case l.kind when 'PEDIDO' then 1 when 'RECEPCION' then 2 when 'SF' then 3 when 'RENDICION' then 4 else 5 end`;

const LINE_SELECT = sql`
  select l.id, l.note_id, l.position, l.kind,
         coalesce(l.order_id, l.reception_id, l.fund_request_id, l.petty_cash_sheet_id) as document_id,
         l.document_type_id, dt.nombre as document_type_nombre, l.numero,
         s.id as supplier_id, s.nombre as supplier_nombre,
         l.fecha_documento::text as fecha_documento,
         m.id as machine_id, m.codigo as machine_codigo, m.descripcion as machine_descripcion,
         l.observacion,
         case l.kind when 'RECEPCION' then r.factura_o_remision when 'SF' then f.concepto else null end as detalle
  from office_dispatch_lines l
  left join document_types dt on dt.id = l.document_type_id
  left join suppliers s on s.id = l.supplier_id
  left join machines m on m.id = l.machine_id
  left join order_receptions r on r.id = l.reception_id
  left join fund_requests f on f.id = l.fund_request_id`;

const mapLine = (r: Row): OfficeLineDto => ({
  id: String(r.id),
  position: Number(r.position),
  kind: r.kind as OfficeLineKind,
  documentId: nullableString(r.document_id),
  documentTypeId: nullableString(r.document_type_id),
  documentTypeNombre: nullableString(r.document_type_nombre),
  numero: nullableString(r.numero),
  supplier: r.supplier_id ? { id: String(r.supplier_id), nombre: String(r.supplier_nombre) } : null,
  fechaDocumento: nullableString(r.fecha_documento),
  machine: r.machine_id
    ? { id: String(r.machine_id), codigo: String(r.machine_codigo), descripcion: String(r.machine_descripcion) }
    : null,
  observacion: nullableString(r.observacion),
  detalle: nullableString(r.detalle),
});

function mapOfficeNote(r: Row): OfficeNoteDto {
  return {
    id: String(r.id),
    numero: Number(r.numero),
    fecha: String(r.fecha),
    estado: r.estado as DispatchState,
    recibidoFecha: nullableString(r.recibido_fecha),
    recibidoPor: nullableString(r.recibido_por),
    observaciones: nullableString(r.observaciones),
    anuladoMotivo: nullableString(r.anulado_motivo),
    lineCount: Number(r.line_count ?? 0),
  };
}

const OFFICE_NOTE_SELECT = sql`
  select n.id, n.numero, n.fecha::text as fecha, n.estado, n.recibido_fecha::text as recibido_fecha,
         n.recibido_por, n.observaciones, n.anulado_motivo,
         (select count(*) from office_dispatch_lines x where x.note_id = n.id) as line_count
  from office_dispatch_notes n`;

export async function loadOfficeNote(tx: Db, id: string): Promise<OfficeNoteDto | null> {
  const [row] = await query<Row>(tx, sql`${OFFICE_NOTE_SELECT} where n.id = ${id}`);
  if (!row) return null;
  const note = mapOfficeNote(row);
  const lines = await query<Row>(tx, sql`${LINE_SELECT} where l.note_id = ${id} order by l.position`);
  note.lines = lines.map(mapLine);
  const late = note.lines.filter((l) => l.fechaDocumento && documentAfterDispatch(l.fechaDocumento, note.fecha));
  if (late.length > 0) {
    note.advertencias = [`${late.length} documento(s) tienen fecha posterior a la del envío.`];
  }
  return note;
}

interface ResolvedLine {
  kind: OfficeLineKind;
  orderId: string | null;
  receptionId: string | null;
  fundRequestId: string | null;
  sheetId: string | null;
  documentTypeId: string | null;
  numero: string;
  supplierId: string | null;
  fechaDocumento: string | null;
  machineId: string | null;
  observacion: string | null;
}

const LINKED_LABEL: Record<LinkedKind, string> = {
  PEDIDO: 'El pedido',
  RECEPCION: 'La recepción',
  SF: 'La solicitud de fondos',
  RENDICION: 'La rendición',
};

/** Resuelve un documento del ERP y toma de él número, proveedor, fecha y máquina. */
async function resolveLinked(tx: Db, kind: LinkedKind, id: string): Promise<ResolvedLine> {
  const base: ResolvedLine = {
    kind,
    orderId: null,
    receptionId: null,
    fundRequestId: null,
    sheetId: null,
    documentTypeId: null,
    numero: '',
    supplierId: null,
    fechaDocumento: null,
    machineId: null,
    observacion: null,
  };
  let row: Row | undefined;
  if (kind === 'PEDIDO') {
    [row] = await query<Row>(tx, sql`select numero, fecha::text as fecha, supplier_id, machine_id, anulado from material_orders where id = ${id}`);
    if (row?.anulado) throw new Rejected([`${LINKED_LABEL[kind]} ${row.numero} está anulado.`], 409);
    base.orderId = id;
  } else if (kind === 'RECEPCION') {
    [row] = await query<Row>(
      tx,
      sql`select r.numero, r.fecha::text as fecha, coalesce(r.supplier_id, o.supplier_id) as supplier_id, o.machine_id, o.anulado
          from order_receptions r join material_orders o on o.id = r.order_id where r.id = ${id}`,
    );
    if (row?.anulado) throw new Rejected([`${LINKED_LABEL[kind]} ${row.numero} pertenece a un pedido anulado.`], 409);
    base.receptionId = id;
  } else if (kind === 'SF') {
    [row] = await query<Row>(tx, sql`select numero, anio, fecha::text as fecha, supplier_id, machine_id, anulado from fund_requests where id = ${id}`);
    if (row?.anulado) throw new Rejected([`${LINKED_LABEL[kind]} ${row.numero} está anulada.`], 409);
    base.fundRequestId = id;
  } else {
    [row] = await query<Row>(tx, sql`select numero, anio, fecha_apertura::text as fecha, estado from petty_cash_sheets where id = ${id}`);
    if (row && String(row.estado) !== 'CERRADA') throw new Rejected([`${LINKED_LABEL[kind]} ${row.numero} sigue abierta: cerrala antes de enviarla.`], 409);
    base.sheetId = id;
  }
  if (!row) throw new Rejected([`${LINKED_LABEL[kind]} no existe.`], 404);
  base.numero = kind === 'SF' || kind === 'RENDICION' ? formatDocNumber(Number(row.numero), Number(row.anio)) : String(row.numero);
  base.fechaDocumento = nullableString(row.fecha);
  base.supplierId = nullableString(row.supplier_id);
  base.machineId = nullableString(row.machine_id);
  return base;
}

async function resolveLines(tx: Db, lines: z.infer<typeof officeLineSchema>[]): Promise<ResolvedLine[]> {
  const manual = lines.filter((l) => l.kind === 'MANUAL');
  const missing = [
    ...(await missingIds(tx, 'document_types', manual.map((l) => l.documentTypeId))),
    ...(await missingIds(tx, 'suppliers', manual.map((l) => l.supplierId))),
    ...(await missingIds(tx, 'machines', manual.map((l) => l.machineId))),
  ];
  if (missing.length > 0) throw new Rejected(['Tipo de documento, proveedor o máquina no encontrado.'], 404);

  const out: ResolvedLine[] = [];
  for (const line of lines) {
    if (line.kind === 'MANUAL') {
      out.push({
        kind: 'MANUAL',
        orderId: null,
        receptionId: null,
        fundRequestId: null,
        sheetId: null,
        documentTypeId: line.documentTypeId ?? null,
        numero: (line.numero ?? '').trim(),
        supplierId: line.supplierId ?? null,
        fechaDocumento: line.fechaDocumento ?? null,
        machineId: line.machineId ?? null,
        observacion: line.observacion ?? null,
      });
    } else {
      const resolved = await resolveLinked(tx, line.kind, line.documentId as string);
      resolved.observacion = line.observacion ?? null;
      out.push(resolved);
    }
  }
  return out;
}

/** Documentos ya incluidos en otra nota vigente. */
async function alreadySent(tx: Db, lines: ResolvedLine[], exceptNoteId: string | null): Promise<string[]> {
  const ids = {
    order: lines.map((l) => l.orderId).filter((x): x is string => !!x),
    reception: lines.map((l) => l.receptionId).filter((x): x is string => !!x),
    fund: lines.map((l) => l.fundRequestId).filter((x): x is string => !!x),
    sheet: lines.map((l) => l.sheetId).filter((x): x is string => !!x),
  };
  const parts: SQL[] = [];
  if (ids.order.length) parts.push(sql`l.order_id in ${sqlList(ids.order)}`);
  if (ids.reception.length) parts.push(sql`l.reception_id in ${sqlList(ids.reception)}`);
  if (ids.fund.length) parts.push(sql`l.fund_request_id in ${sqlList(ids.fund)}`);
  if (ids.sheet.length) parts.push(sql`l.petty_cash_sheet_id in ${sqlList(ids.sheet)}`);
  if (parts.length === 0) return [];
  const rows = await query<Row>(
    tx,
    sql`select l.kind, l.numero, n.numero as nota
        from office_dispatch_lines l join office_dispatch_notes n on n.id = l.note_id
        where l.vigente and (${sql.join(parts, sql` or `)})
          ${exceptNoteId ? sql`and l.note_id <> ${exceptNoteId}` : sql``}`,
  );
  const label: Record<string, string> = { PEDIDO: 'El pedido', RECEPCION: 'La recepción', SF: 'La SF', RENDICION: 'La rendición' };
  return rows.map((r) => `${label[String(r.kind)] ?? 'El documento'} ${r.numero} ya está en la nota ${r.nota}.`);
}

async function insertLines(tx: Db, companyId: string, noteId: string, lines: ResolvedLine[]): Promise<void> {
  let position = 1;
  for (const l of lines) {
    await query(
      tx,
      sql`insert into office_dispatch_lines
            (company_id, note_id, position, kind, order_id, reception_id, fund_request_id, petty_cash_sheet_id,
             document_type_id, numero, supplier_id, fecha_documento, machine_id, observacion)
          values (${companyId}, ${noteId}, ${position++}, ${l.kind}, ${l.orderId}, ${l.receptionId}, ${l.fundRequestId},
                  ${l.sheetId}, ${l.documentTypeId}, ${l.numero}, ${l.supplierId}, ${l.fechaDocumento}::date,
                  ${l.machineId}, ${l.observacion})`,
    );
  }
}

async function prepareOfficeLines(
  tx: Db,
  body: z.infer<typeof officeNoteSchema>,
  exceptNoteId: string | null,
): Promise<ResolvedLine[]> {
  const errors = validateOfficeNote(
    {
      fecha: body.fecha,
      lines: body.lines.map((l) => ({
        kind: l.kind,
        documentId: l.documentId,
        documentTypeId: l.documentTypeId,
        numero: l.numero,
        fechaDocumento: l.fechaDocumento,
      })),
    },
    today(),
  );
  if (errors.length > 0) throw new Rejected(errors);
  const resolved = await resolveLines(tx, body.lines);
  const taken = await alreadySent(tx, resolved, exceptNoteId);
  if (taken.length > 0) throw new Rejected(taken, 409);
  return resolved;
}

/* ─── Pendientes de enviar ─────────────────────────────────────────────── */

async function loadPending(tx: Db, desde: string): Promise<PendingDocumentsDto> {
  const hoy = today();
  const rows = await query<Row>(
    tx,
    sql`select * from (
          select 'PEDIDO' as kind, o.id, o.numero, o.fecha::text as fecha, s.id as supplier_id, s.nombre as supplier_nombre,
                 m.id as machine_id, m.codigo as machine_codigo, m.descripcion as machine_descripcion, null::text as detalle, null::int as anio
          from material_orders o
          left join suppliers s on s.id = o.supplier_id
          left join machines m on m.id = o.machine_id
          where not o.anulado and o.fecha >= ${desde}::date
            and not exists (select 1 from office_dispatch_lines l where l.vigente and l.order_id = o.id)
          union all
          select 'RECEPCION', r.id, r.numero, r.fecha::text, s.id, s.nombre, m.id, m.codigo, m.descripcion, r.factura_o_remision, null::int
          from order_receptions r
          join material_orders o on o.id = r.order_id and not o.anulado
          left join suppliers s on s.id = coalesce(r.supplier_id, o.supplier_id)
          left join machines m on m.id = o.machine_id
          where r.fecha >= ${desde}::date
            and not exists (select 1 from office_dispatch_lines l where l.vigente and l.reception_id = r.id)
          union all
          select 'SF', f.id, f.numero, f.fecha::text, s.id, s.nombre, m.id, m.codigo, m.descripcion, f.concepto, f.anio
          from fund_requests f
          left join suppliers s on s.id = f.supplier_id
          left join machines m on m.id = f.machine_id
          where not f.anulado and f.fecha >= ${desde}::date
            and not exists (select 1 from office_dispatch_lines l where l.vigente and l.fund_request_id = f.id)
          union all
          select 'RENDICION', c.id, c.numero, c.fecha_apertura::text, null, null, null, null, null, c.observaciones, c.anio
          from petty_cash_sheets c
          where c.estado = 'CERRADA' and c.fecha_apertura >= ${desde}::date
            and not exists (select 1 from office_dispatch_lines l where l.vigente and l.petty_cash_sheet_id = c.id)
        ) p
        order by p.fecha, p.kind, p.numero`,
  );
  const conteo = { PEDIDO: 0, RECEPCION: 0, SF: 0, RENDICION: 0 };
  const items: PendingDocumentDto[] = rows.map((r) => {
    const kind = r.kind as LinkedKind;
    conteo[kind] += 1;
    return {
      kind,
      id: String(r.id),
      numero: Number(r.numero),
      anio: r.anio === null || r.anio === undefined ? null : Number(r.anio),
      fecha: String(r.fecha),
      supplier: r.supplier_id ? { id: String(r.supplier_id), nombre: String(r.supplier_nombre) } : null,
      machine: r.machine_id
        ? { id: String(r.machine_id), codigo: String(r.machine_codigo), descripcion: String(r.machine_descripcion) }
        : null,
      detalle: nullableString(r.detalle),
      dias: dayDiff(String(r.fecha), hoy),
    };
  });
  return { hoy, desde, conteo, items };
}

/* ─── Notas a obra ─────────────────────────────────────────────────────── */

const SITE_NOTE_SELECT = sql`
  select n.id, n.numero, n.fecha::text as fecha, n.estado, n.chofer, n.recibido_fecha::text as recibido_fecha,
         n.recibido_por, n.observaciones, n.anulado_motivo, w.id as worksite_id, w.nombre as worksite_nombre,
         (select count(*) from daily_events e where e.site_dispatch_note_id = n.id) as event_count
  from site_dispatch_notes n
  join worksites w on w.id = n.worksite_id`;

function mapSiteNote(r: Row): SiteNoteDto {
  return {
    id: String(r.id),
    numero: Number(r.numero),
    fecha: String(r.fecha),
    estado: r.estado as DispatchState,
    worksite: { id: String(r.worksite_id), nombre: String(r.worksite_nombre) },
    chofer: nullableString(r.chofer),
    recibidoFecha: nullableString(r.recibido_fecha),
    recibidoPor: nullableString(r.recibido_por),
    observaciones: nullableString(r.observaciones),
    anuladoMotivo: nullableString(r.anulado_motivo),
    eventCount: Number(r.event_count ?? 0),
  };
}

const mapSiteEvent = (r: Row): SiteNoteEventDto => ({
  id: String(r.id),
  fecha: String(r.fecha),
  machine: { id: String(r.machine_id), codigo: String(r.machine_codigo), descripcion: String(r.machine_descripcion) },
  descripcion: String(r.descripcion),
});

const SITE_EVENT_SELECT = sql`
  select e.id, e.fecha::text as fecha, e.descripcion, m.id as machine_id, m.codigo as machine_codigo,
         m.descripcion as machine_descripcion
  from daily_events e join machines m on m.id = e.machine_id`;

export async function loadSiteNote(tx: Db, id: string): Promise<SiteNoteDto | null> {
  const [row] = await query<Row>(tx, sql`${SITE_NOTE_SELECT} where n.id = ${id}`);
  if (!row) return null;
  const note = mapSiteNote(row);
  const events = await query<Row>(tx, sql`${SITE_EVENT_SELECT} where e.site_dispatch_note_id = ${id} order by e.fecha, m.codigo`);
  note.events = events.map(mapSiteEvent);
  return note;
}

/** Valida y devuelve los partes: envíos de repuestos vigentes y sin nota (o ya en esta nota). */
async function checkEvents(tx: Db, eventIds: string[], noteId: string | null): Promise<void> {
  if ((await missingIds(tx, 'daily_events', eventIds)).length > 0) throw new Rejected(['Algún parte no existe.'], 404);
  const rows = await query<Row>(
    tx,
    sql`select e.id, e.anulado, e.tipos, e.site_dispatch_note_id, n.numero as nota
        from daily_events e left join site_dispatch_notes n on n.id = e.site_dispatch_note_id
        where e.id in ${sqlList(eventIds)}`,
  );
  const errors: string[] = [];
  for (const r of rows) {
    const tipos = (r.tipos as string[] | null) ?? [];
    if (r.anulado) errors.push('Un parte anulado no puede incluirse en una nota.');
    else if (!tipos.includes('ENVIO_REPUESTOS')) errors.push('Solo los partes de «envío de repuestos» van en una nota a obra.');
    else if (r.site_dispatch_note_id && String(r.site_dispatch_note_id) !== noteId) {
      errors.push(`Un parte ya está en la nota a obra ${r.nota}.`);
    }
  }
  if (errors.length > 0) throw new Rejected([...new Set(errors)], 409);
}

async function assignEvents(tx: Db, noteId: string, eventIds: string[]): Promise<void> {
  await query(tx, sql`update daily_events set site_dispatch_note_id = null where site_dispatch_note_id = ${noteId}`);
  await query(tx, sql`update daily_events set site_dispatch_note_id = ${noteId} where id in ${sqlList(eventIds)}`);
}

/* ─── Rutas ────────────────────────────────────────────────────────────── */

export function dispatchRouter(deps: { db: Db; requireAuth: RequestHandler }): Router {
  const router = Router();
  const { db } = deps;
  router.use('/api/envios', deps.requireAuth);

  /* Tipos de documento */
  router.get(
    '/api/envios/tipos-documento',
    asyncRoute(async (req, res) => {
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadDocumentTypes(tx)));
    }),
  );

  router.post(
    '/api/envios/tipos-documento/predeterminados',
    asyncRoute(async (req, res) => {
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        for (const t of DEFAULT_DOCUMENT_TYPES) {
          await query(
            tx,
            sql`insert into document_types (company_id, codigo, nombre) values (${companyId}, ${t.codigo}, ${t.nombre})
                on conflict (company_id, codigo) do nothing`,
          );
        }
        return loadDocumentTypes(tx);
      });
    }),
  );

  router.post(
    '/api/envios/tipos-documento',
    asyncRoute(async (req, res) => {
      const body = parseBody(documentTypeSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(
        db,
        res,
        companyId,
        async (tx) => {
          const dup = await query<Row>(tx, sql`select 1 from document_types where codigo = ${body.codigo}`);
          if (dup.length > 0) throw new Rejected([`Ya existe el tipo «${body.codigo}».`], 409);
          const [row] = await query<Row>(
            tx,
            sql`insert into document_types (company_id, codigo, nombre, activo)
                values (${companyId}, ${body.codigo}, ${body.nombre}, ${body.activo}) returning id, codigo, nombre, activo`,
          );
          return mapDocumentType(row);
        },
        201,
      );
    }),
  );

  router.put(
    '/api/envios/tipos-documento/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = parseBody(documentTypeSchema, req, res);
      if (!id.success) {
        res.status(404).json({ error: 'Tipo no encontrado.' });
        return;
      }
      if (!body) return;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const dup = await query<Row>(tx, sql`select 1 from document_types where codigo = ${body.codigo} and id <> ${id.data}`);
        if (dup.length > 0) throw new Rejected([`Ya existe el tipo «${body.codigo}».`], 409);
        const [row] = await query<Row>(
          tx,
          sql`update document_types set codigo = ${body.codigo}, nombre = ${body.nombre}, activo = ${body.activo}
              where id = ${id.data} returning id, codigo, nombre, activo`,
        );
        if (!row) throw new Rejected(['Tipo no encontrado.'], 404);
        return mapDocumentType(row);
      });
    }),
  );

  /* Pendientes de enviar */
  router.get(
    '/api/envios/oficina/pendientes',
    asyncRoute(async (req, res) => {
      const f = pendingFiltersSchema.safeParse(req.query);
      if (!f.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: f.error.issues.map((i) => i.message) });
        return;
      }
      const hoy = today();
      const fallback = new Date(Date.parse(`${hoy}T00:00:00Z`) - DEFAULT_PENDING_DAYS * 86_400_000).toISOString().slice(0, 10);
      res.json(await withTenant(db, req.auth!.companyId, (tx) => loadPending(tx, f.data.desde ?? fallback)));
    }),
  );

  /** ¿En qué nota vigente está este pedido, recepción, SF o rendición? Null si no se envió. */
  router.get(
    '/api/envios/oficina/de-documento/:kind/:id',
    asyncRoute(async (req, res) => {
      const kind = z.enum(LINKED_KINDS).safeParse(req.params.kind);
      const id = uuid.safeParse(req.params.id);
      if (!kind.success || !id.success) {
        res.status(404).json({ error: 'Documento no encontrado.' });
        return;
      }
      const column = { PEDIDO: 'order_id', RECEPCION: 'reception_id', SF: 'fund_request_id', RENDICION: 'petty_cash_sheet_id' }[kind.data];
      const [row] = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(
          tx,
          sql`select n.id, n.numero, n.fecha::text as fecha, n.estado
              from office_dispatch_lines l join office_dispatch_notes n on n.id = l.note_id
              where l.vigente and l.${sql.raw(column)} = ${id.data}`,
        ),
      );
      res.json(row ? { id: String(row.id), numero: Number(row.numero), fecha: String(row.fecha), estado: row.estado as DispatchState } : null);
    }),
  );

  /* Consulta de documentos enviados */
  router.get(
    '/api/envios/documentos',
    asyncRoute(async (req, res) => {
      const f = sentFiltersSchema.safeParse(req.query);
      if (!f.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: f.error.issues.map((i) => i.message) });
        return;
      }
      const q = f.data;
      const conditions: SQL[] = [];
      if (q.incluirAnuladas !== 'true') conditions.push(sql`n.estado <> 'ANULADA'`);
      if (q.desde) conditions.push(sql`n.fecha >= ${q.desde}::date`);
      if (q.hasta) conditions.push(sql`n.fecha <= ${q.hasta}::date`);
      if (q.proveedor) conditions.push(sql`l.supplier_id = ${q.proveedor}::uuid`);
      if (q.maquina) conditions.push(sql`l.machine_id = ${q.maquina}::uuid`);
      if (q.tipo) conditions.push(sql`l.kind = ${q.tipo}`);
      if (q.tipoDocumento) conditions.push(sql`l.document_type_id = ${q.tipoDocumento}::uuid`);
      if (q.q) conditions.push(sql`(l.numero ilike ${`%${q.q}%`} or l.observacion ilike ${`%${q.q}%`})`);
      const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(
          tx,
          sql`${LINE_SELECT} join office_dispatch_notes n on n.id = l.note_id ${where}
              order by n.fecha desc, n.numero desc, l.position limit 2000`,
        ),
      );
      // La nota se junta en una segunda pasada para no duplicar el select de renglones.
      const noteIds = [...new Set(rows.map((r) => String(r.note_id)))];
      const notes = noteIds.length
        ? await withTenant(db, req.auth!.companyId, (tx) =>
            query<Row>(tx, sql`select id, numero, fecha::text as fecha, estado from office_dispatch_notes where id in ${sqlList(noteIds)}`),
          )
        : [];
      const byId = new Map(notes.map((n) => [String(n.id), n]));
      const out: SentDocumentDto[] = rows.map((r) => {
        const n = byId.get(String(r.note_id))!;
        return { ...mapLine(r), noteId: String(n.id), noteNumero: Number(n.numero), noteFecha: String(n.fecha), noteEstado: n.estado as DispatchState };
      });
      res.json(out);
    }),
  );

  /* Notas a oficina */
  router.get(
    '/api/envios/oficina',
    asyncRoute(async (req, res) => {
      const f = officeFiltersSchema.safeParse(req.query);
      if (!f.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: f.error.issues.map((i) => i.message) });
        return;
      }
      const conditions: SQL[] = [];
      if (f.data.estado) conditions.push(sql`n.estado = ${f.data.estado}`);
      if (f.data.desde) conditions.push(sql`n.fecha >= ${f.data.desde}::date`);
      if (f.data.hasta) conditions.push(sql`n.fecha <= ${f.data.hasta}::date`);
      if (f.data.q) {
        conditions.push(
          sql`(n.numero::text = ${f.data.q} or n.observaciones ilike ${`%${f.data.q}%`}
               or exists (select 1 from office_dispatch_lines l where l.note_id = n.id and l.numero ilike ${`%${f.data.q}%`}))`,
        );
      }
      const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(tx, sql`${OFFICE_NOTE_SELECT} ${where} order by n.fecha desc, n.numero desc limit 500`),
      );
      res.json(rows.map(mapOfficeNote));
    }),
  );

  router.get(
    '/api/envios/oficina/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const note = id.success ? await withTenant(db, req.auth!.companyId, (tx) => loadOfficeNote(tx, id.data)) : null;
      if (!note) {
        res.status(404).json({ error: 'Nota no encontrada.' });
        return;
      }
      res.json(note);
    }),
  );

  router.post(
    '/api/envios/oficina',
    asyncRoute(async (req, res) => {
      const body = parseBody(officeNoteSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(
        db,
        res,
        companyId,
        async (tx) => {
          const resolved = await prepareOfficeLines(tx, body, null);
          // Número único anual compartido con las notas de la oficina y las obras (el del ERP, si está conectado)
          const noteId = randomUUID();
          const { anio, numero, fromErp } = await nextSharedNumber(tx, companyId, 'NE', body.fecha, noteId);
          const [row] = await query<Row>(
            tx,
            sql`insert into office_dispatch_notes (id, company_id, numero, anio, numero_erp, fecha, observaciones)
                values (${noteId}, ${companyId}, ${numero}, ${anio}, ${fromErp}, ${body.fecha}::date, ${body.observaciones ?? null}) returning id`,
          );
          await insertLines(tx, companyId, String(row.id), resolved);
          await enqueueErp(tx, companyId, 'NOTA_OFICINA', String(row.id));
          return (await loadOfficeNote(tx, String(row.id)))!;
        },
        201,
      );
    }),
  );

  router.put(
    '/api/envios/oficina/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = parseBody(officeNoteSchema, req, res);
      if (!id.success) {
        res.status(404).json({ error: 'Nota no encontrada.' });
        return;
      }
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(db, res, companyId, async (tx) => {
        const [note] = await query<Row>(tx, sql`select estado from office_dispatch_notes where id = ${id.data} for update`);
        if (!note) throw new Rejected(['Nota no encontrada.'], 404);
        if (!canEditNote(note.estado as DispatchState)) throw new Rejected(['Solo se puede editar una nota enviada.'], 409);
        const resolved = await prepareOfficeLines(tx, body, id.data);
        await query(tx, sql`delete from office_dispatch_lines where note_id = ${id.data}`);
        await query(
          tx,
          sql`update office_dispatch_notes set fecha = ${body.fecha}::date, observaciones = ${body.observaciones ?? null} where id = ${id.data}`,
        );
        await insertLines(tx, companyId, id.data, resolved);
        await enqueueErp(tx, companyId, 'NOTA_OFICINA', id.data);
        return (await loadOfficeNote(tx, id.data))!;
      });
    }),
  );

  const acknowledge = (table: 'office_dispatch_notes' | 'site_dispatch_notes') =>
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = parseBody(ackSchema, req, res);
      if (!id.success) {
        res.status(404).json({ error: 'Nota no encontrada.' });
        return;
      }
      if (!body) return;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [note] = await query<Row>(tx, sql`select estado, numero_erp, fecha::text as fecha from ${sql.raw(table)} where id = ${id.data} for update`);
        if (!note) throw new Rejected(['Nota no encontrada.'], 404);
        if (note.estado !== 'ENVIADA') throw new Rejected(['Solo se puede registrar el recibido de una nota enviada.'], 409);
        if (note.numero_erp) {
          throw new Rejected([table === 'office_dispatch_notes' ? 'Esta nota la recibe la oficina desde el ERP.' : 'Esta nota la recibe la obra desde el ECMS.'], 409);
        }
        const errors = validateAcknowledge({ fechaEnvio: String(note.fecha), fechaRecibido: body.fecha, recibidoPor: body.recibidoPor }, today());
        if (errors.length > 0) throw new Rejected(errors);
        await query(
          tx,
          sql`update ${sql.raw(table)} set estado = 'RECIBIDA', recibido_fecha = ${body.fecha}::date, recibido_por = ${body.recibidoPor}
              where id = ${id.data}`,
        );
        return table === 'office_dispatch_notes' ? (await loadOfficeNote(tx, id.data))! : (await loadSiteNote(tx, id.data))!;
      });
    });

  router.post('/api/envios/oficina/:id/recibir', acknowledge('office_dispatch_notes'));
  router.post('/api/envios/obra/:id/recibir', acknowledge('site_dispatch_notes'));

  router.post(
    '/api/envios/oficina/:id/anular',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = parseBody(cancelSchema, req, res);
      if (!id.success) {
        res.status(404).json({ error: 'Nota no encontrada.' });
        return;
      }
      if (!body) return;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [note] = await query<Row>(tx, sql`select estado from office_dispatch_notes where id = ${id.data} for update`);
        if (!note) throw new Rejected(['Nota no encontrada.'], 404);
        if (!canEditNote(note.estado as DispatchState)) throw new Rejected(['Solo se puede anular una nota enviada.'], 409);
        await query(tx, sql`update office_dispatch_notes set estado = 'ANULADA', anulado_motivo = ${body.motivo} where id = ${id.data}`);
        // Libera los documentos para que puedan incluirse en otra nota.
        await query(tx, sql`update office_dispatch_lines set vigente = false where note_id = ${id.data}`);
        await enqueueErp(tx, req.auth!.companyId, 'NOTA_OFICINA', id.data);
        return (await loadOfficeNote(tx, id.data))!;
      });
    }),
  );

  /* Notas a obra */
  router.get(
    '/api/envios/obra/partes-sin-nota',
    asyncRoute(async (req, res) => {
      const f = eventsWithoutNoteSchema.safeParse(req.query);
      if (!f.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: f.error.issues.map((i) => i.message) });
        return;
      }
      const conditions: SQL[] = [
        sql`e.anulado = false`,
        sql`e.site_dispatch_note_id is null`,
        sql`'ENVIO_REPUESTOS' = any(e.tipos)`,
      ];
      if (f.data.obra) conditions.push(sql`e.worksite_id = ${f.data.obra}::uuid`);
      if (f.data.desde) conditions.push(sql`e.fecha >= ${f.data.desde}::date`);
      if (f.data.hasta) conditions.push(sql`e.fecha <= ${f.data.hasta}::date`);
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(tx, sql`${SITE_EVENT_SELECT} where ${sql.join(conditions, sql` and `)} order by e.fecha desc, m.codigo limit 500`),
      );
      res.json(rows.map(mapSiteEvent));
    }),
  );

  router.get(
    '/api/envios/obra',
    asyncRoute(async (req, res) => {
      const f = siteFiltersSchema.safeParse(req.query);
      if (!f.success) {
        res.status(400).json({ error: 'Filtros inválidos.', detalles: f.error.issues.map((i) => i.message) });
        return;
      }
      const conditions: SQL[] = [];
      if (f.data.estado) conditions.push(sql`n.estado = ${f.data.estado}`);
      if (f.data.desde) conditions.push(sql`n.fecha >= ${f.data.desde}::date`);
      if (f.data.hasta) conditions.push(sql`n.fecha <= ${f.data.hasta}::date`);
      if (f.data.obra) conditions.push(sql`n.worksite_id = ${f.data.obra}::uuid`);
      if (f.data.q) conditions.push(sql`(n.numero::text = ${f.data.q} or n.chofer ilike ${`%${f.data.q}%`} or n.observaciones ilike ${`%${f.data.q}%`})`);
      const where = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
      const rows = await withTenant(db, req.auth!.companyId, (tx) =>
        query<Row>(tx, sql`${SITE_NOTE_SELECT} ${where} order by n.fecha desc, n.numero desc limit 500`),
      );
      res.json(rows.map(mapSiteNote));
    }),
  );

  router.get(
    '/api/envios/obra/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const note = id.success ? await withTenant(db, req.auth!.companyId, (tx) => loadSiteNote(tx, id.data)) : null;
      if (!note) {
        res.status(404).json({ error: 'Nota no encontrada.' });
        return;
      }
      res.json(note);
    }),
  );

  router.post(
    '/api/envios/obra',
    asyncRoute(async (req, res) => {
      const body = parseBody(siteNoteSchema, req, res);
      if (!body) return;
      const companyId = req.auth!.companyId;
      await runInTenant(
        db,
        res,
        companyId,
        async (tx) => {
          const errors = validateSiteNote({ fecha: body.fecha, worksiteId: body.worksiteId, eventIds: body.eventIds }, today());
          if (errors.length > 0) throw new Rejected(errors);
          if ((await missingIds(tx, 'worksites', [body.worksiteId])).length > 0) throw new Rejected(['Obra no encontrada.'], 404);
          await checkEvents(tx, body.eventIds, null);
          const noteId = randomUUID();
          const { anio, numero, fromErp } = await nextSharedNumber(tx, companyId, 'NE', body.fecha, noteId);
          const [row] = await query<Row>(
            tx,
            sql`insert into site_dispatch_notes (id, company_id, numero, anio, numero_erp, fecha, worksite_id, chofer, observaciones)
                values (${noteId}, ${companyId}, ${numero}, ${anio}, ${fromErp}, ${body.fecha}::date, ${body.worksiteId}, ${body.chofer ?? null}, ${body.observaciones ?? null})
                returning id`,
          );
          await assignEvents(tx, String(row.id), body.eventIds);
          await enqueueErp(tx, companyId, 'NOTA_OBRA', String(row.id));
          return (await loadSiteNote(tx, String(row.id)))!;
        },
        201,
      );
    }),
  );

  router.put(
    '/api/envios/obra/:id',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = parseBody(siteNoteSchema, req, res);
      if (!id.success) {
        res.status(404).json({ error: 'Nota no encontrada.' });
        return;
      }
      if (!body) return;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [note] = await query<Row>(tx, sql`select estado from site_dispatch_notes where id = ${id.data} for update`);
        if (!note) throw new Rejected(['Nota no encontrada.'], 404);
        if (!canEditNote(note.estado as DispatchState)) throw new Rejected(['Solo se puede editar una nota enviada.'], 409);
        const errors = validateSiteNote({ fecha: body.fecha, worksiteId: body.worksiteId, eventIds: body.eventIds }, today());
        if (errors.length > 0) throw new Rejected(errors);
        if ((await missingIds(tx, 'worksites', [body.worksiteId])).length > 0) throw new Rejected(['Obra no encontrada.'], 404);
        await checkEvents(tx, body.eventIds, id.data);
        await query(
          tx,
          sql`update site_dispatch_notes set fecha = ${body.fecha}::date, worksite_id = ${body.worksiteId},
                chofer = ${body.chofer ?? null}, observaciones = ${body.observaciones ?? null} where id = ${id.data}`,
        );
        await assignEvents(tx, id.data, body.eventIds);
        await enqueueErp(tx, req.auth!.companyId, 'NOTA_OBRA', id.data);
        return (await loadSiteNote(tx, id.data))!;
      });
    }),
  );

  router.post(
    '/api/envios/obra/:id/anular',
    asyncRoute(async (req, res) => {
      const id = uuid.safeParse(req.params.id);
      const body = parseBody(cancelSchema, req, res);
      if (!id.success) {
        res.status(404).json({ error: 'Nota no encontrada.' });
        return;
      }
      if (!body) return;
      await runInTenant(db, res, req.auth!.companyId, async (tx) => {
        const [note] = await query<Row>(tx, sql`select estado from site_dispatch_notes where id = ${id.data} for update`);
        if (!note) throw new Rejected(['Nota no encontrada.'], 404);
        if (!canEditNote(note.estado as DispatchState)) throw new Rejected(['Solo se puede anular una nota enviada.'], 409);
        await query(tx, sql`update site_dispatch_notes set estado = 'ANULADA', anulado_motivo = ${body.motivo} where id = ${id.data}`);
        // Libera los partes: la nota anulada ya no los agrupa.
        await query(tx, sql`update daily_events set site_dispatch_note_id = null where site_dispatch_note_id = ${id.data}`);
        await enqueueErp(tx, req.auth!.companyId, 'NOTA_OBRA', id.data);
        return (await loadSiteNote(tx, id.data))!;
      });
    }),
  );

  return router;
}
