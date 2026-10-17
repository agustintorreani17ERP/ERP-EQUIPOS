import { describe, expect, it } from 'vitest';
import { docTypeCode, groupOfficeNotes, groupSiteNotes, officeLineFromAccess } from '../import/dispatch';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-16';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('docTypeCode', () => {
  it('mapea los tipos conocidos y deja los demás con su número', () => {
    expect(docTypeCode('4')).toBe('FACTURA');
    expect(docTypeCode('3')).toBe('SF');
    expect(docTypeCode('10')).toBe('T10');
    expect(docTypeCode('24')).toBe('T24');
    expect(docTypeCode(null)).toBe('OTRO');
  });
});

describe('officeLineFromAccess', () => {
  it('convierte un renglón con documento, proveedor y segundo documento', () => {
    const l = officeLineFromAccess(
      { ID: 9, 'NO ENVIO': '300725', 'FECHA DE ENVIO': d('2025-07-30'), FECHA: d('2025-07-25'), 'TIPO DE DOC': '4', 'FACTURA O REMISION': '9973', PROVEEDOR: '39', OBS: 'Urgente', FACUTRA: '001-1', 'PROVEEDOR FACTURA': '12' },
      HOY,
    );
    expect(l).toMatchObject({ legacyId: '9', notaRaw: '300725', fechaEnvio: '2025-07-30', fechaDocumento: '2025-07-25', tipoId: '4', numeroDocumento: '9973', proveedorId: '39' });
    expect(l.observacion).toBe('Urgente · Documento 2: 001-1 · proveedor 12');
  });
  it('una fecha de envío basura queda vacía', () => {
    expect(officeLineFromAccess({ ID: 1, 'FECHA DE ENVIO': new Date('0806-01-01T00:00:00.000Z') }, HOY).fechaEnvio).toBeNull();
  });
});

describe('groupOfficeNotes', () => {
  const line = (id: string, nota: string | null, envio: string | null, doc: string | null = null) =>
    officeLineFromAccess({ ID: id, 'NO ENVIO': nota, 'FECHA DE ENVIO': envio ? d(envio) : null, FECHA: doc ? d(doc) : null }, HOY);

  it('agrupa por número y fecha de envío: el mismo número en otra fecha es otra nota', () => {
    const { groups } = groupOfficeNotes([line('1', '300725', '2025-07-30'), line('2', '300725', '2025-07-30'), line('3', '300725', '2025-08-04')]);
    expect(groups.map((g) => [g.fecha, g.lines.length])).toEqual([['2025-07-30', 2], ['2025-08-04', 1]]);
  });
  it('sin fecha de envío usa la del documento y lo cuenta; sin ninguna, queda aparte', () => {
    const { groups, sinFecha } = groupOfficeNotes([line('1', '1', null, '2025-01-05'), line('2', '1', null, null)]);
    expect(groups[0]).toMatchObject({ fecha: '2025-01-05', fechaSupuesta: 1 });
    expect(sinFecha.map((l) => l.legacyId)).toEqual(['2']);
  });
  it('los renglones sin número forman una nota por fecha', () => {
    const { groups } = groupOfficeNotes([line('1', null, '2025-01-05'), line('2', null, '2025-01-05'), line('3', null, '2025-01-06')]);
    expect(groups.map((g) => [g.notaRaw, g.lines.length])).toEqual([[null, 2], [null, 1]]);
  });
});

describe('groupSiteNotes', () => {
  const ev = (id: string, nota: string | null, obra: string | null, fecha = '2025-07-30', envia = true) => ({ id, fecha, worksiteId: obra, notaRaw: nota, enviaRepuestos: envia });
  it('agrupa por número, obra de destino y fecha', () => {
    const { groups } = groupSiteNotes([ev('a', '300725CA', 'o1'), ev('b', '300725CA', 'o1'), ev('c', '300725CA', 'o2'), ev('d', '300725CA', 'o1', '2025-07-31')]);
    expect(groups.map((g) => [g.worksiteId, g.fecha, g.eventIds])).toEqual([['o1', '2025-07-30', ['a', 'b']], ['o2', '2025-07-30', ['c']], ['o1', '2025-07-31', ['d']]]);
  });
  it('ignora lo que no es un envío con nota y aparta los envíos sin obra', () => {
    const r = groupSiteNotes([ev('a', null, 'o1'), ev('b', 'X', 'o1', '2025-07-30', false), ev('c', 'X', null)]);
    expect(r.groups).toEqual([]);
    expect(r.sinObra.map((e) => e.id)).toEqual(['c']);
  });
});
