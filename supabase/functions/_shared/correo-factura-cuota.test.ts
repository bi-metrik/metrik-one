import { describe, expect, it } from 'vitest';
import { PALETA } from '../../../src/lib/marca/paleta.ts';
import { FROM_FACTURACION as FROM_NEXT } from '../../../src/lib/email/remitente-facturacion.ts';
import { FROM_FACTURACION } from './remitente-facturacion.ts';
import {
  COLORES_CORREO_FACTURA,
  correoFactura,
  decidirCorreo,
  destinosCorreoFactura,
  enlacePagosEspacio,
  fechaLarga,
  nombreAdjunto,
  nombreServicio,
  pesos,
  textoDestinos,
  type DatosCorreoFactura,
} from './correo-factura-cuota.ts';

const base: DatosCorreoFactura = {
  numero: 'FE-120',
  numeroCuota: 2,
  totalCuotas: 12,
  servicio: 'Valida',
  empresa: 'CDA El Carmen S.A.S.',
  monto: 150000,
  slugPagador: 'cda-el-carmen',
  anterior: null,
};

describe('el correo de la factura: texto aprobado por Vera (2026-10-28)', () => {
  it('normal: asunto y cuerpo exactos', () => {
    const c = correoFactura(base);
    expect(c.asunto).toBe('Factura FE-120 · cuota 2 de 12 de Valida');
    expect(c.texto).toBe(
      [
        'Hola, CDA El Carmen S.A.S.:',
        'Le enviamos la factura electrónica FE-120 por la cuota 2 de 12 de Valida, por $150.000. Adjuntamos el PDF y el XML.',
        'La persona designada del contrato también la puede descargar en ONE, en el menú Suscripción, pestaña Pagos.',
        'Ir a Pagos: https://cda-el-carmen.metrikone.co/suscripcion?tab=pagos',
        'Si algo no cuadra, responda este correo.',
        'Equipo MéTRIK',
      ].join('\n\n'),
    );
  });

  it('corrección con otro número: asunto con (reenvío) y la línea después del primer párrafo', () => {
    const c = correoFactura({ ...base, numero: 'FE-121', anterior: { numero: 'FE-120', enviadoAt: '2026-10-28T15:00:00Z' } });
    expect(c.asunto).toBe('Factura FE-121 (reenvío) · cuota 2 de 12 de Valida');
    const parrafos = c.texto.split('\n\n');
    expect(parrafos[1]).toMatch(/^Le enviamos la factura electrónica FE-121/);
    expect(parrafos[2]).toBe('Tome esta en lugar de la factura FE-120 que le enviamos el 28 de octubre de 2026.');
    expect(parrafos[3]).toMatch(/^La persona designada/);
  });

  it('corrección con el mismo número', () => {
    const c = correoFactura({ ...base, anterior: { numero: 'FE-120', enviadoAt: '2026-10-28T15:00:00Z' } });
    expect(c.asunto).toBe('Factura FE-120 (reenvío) · cuota 2 de 12 de Valida');
    expect(c.texto.split('\n\n')[2]).toBe('Tome esta en lugar de la que le enviamos el 28 de octubre de 2026.');
  });

  it('el HTML lleva los mismos párrafos escapados, el botón a Pagos y la paleta', () => {
    const c = correoFactura({ ...base, empresa: 'A & B <S.A.S.>' });
    expect(c.html).toContain('Hola, A &amp; B &lt;S.A.S.&gt;:');
    expect(c.html).toContain('href="https://cda-el-carmen.metrikone.co/suscripcion?tab=pagos"');
    expect(c.html).toContain('>Ir a Pagos</a>');
    expect(c.html).toContain(`background:${PALETA.acento}`);
    expect(c.html).toContain('Equipo MéTRIK');
  });

  it('sin nombre de empresa saluda sin coma', () => {
    expect(correoFactura({ ...base, empresa: '  ' }).texto.startsWith('Hola:\n\n')).toBe(true);
  });
});

describe('el correo de la factura: reglas', () => {
  it('solo con PDF y XML', () => {
    expect(decidirCorreo({ pdf_sha256: 'a', xml_sha256: 'b' })).toEqual({ enviar: true });
    expect(decidirCorreo({ pdf_sha256: 'a', xml_sha256: null })).toEqual({ enviar: false, motivo: 'sin_xml' });
    expect(decidirCorreo({ pdf_sha256: null, xml_sha256: 'b' })).toEqual({ enviar: false, motivo: 'sin_pdf' });
  });

  it('para el correo fiscal, copia a la persona designada si es otra', () => {
    expect(destinosCorreoFactura({ correoEmpresa: 'fe@cda.co', correoDesignado: 'ana@cda.co' })).toEqual({ to: ['fe@cda.co'], cc: ['ana@cda.co'] });
    expect(destinosCorreoFactura({ correoEmpresa: 'FE@cda.co', correoDesignado: 'fe@cda.co' })).toEqual({ to: ['FE@cda.co'], cc: [] });
  });

  it('sin correo fiscal va a la persona designada; sin ninguno, null', () => {
    expect(destinosCorreoFactura({ correoEmpresa: null, correoDesignado: 'ana@cda.co' })).toEqual({ to: ['ana@cda.co'], cc: [] });
    expect(destinosCorreoFactura({ correoEmpresa: 'no-es-correo', correoDesignado: ' ' })).toBeNull();
    expect(textoDestinos({ to: ['a@b.co'], cc: ['c@d.co'] })).toBe('para: a@b.co, cc: c@d.co');
  });

  it('«Valida» fijo para Valida; el catálogo para lo demás', () => {
    expect(nombreServicio({ slug: 'valida-cda-licencia', modulo: 'valida_consulta', nombre: 'Licencia Valida por CDA' })).toBe('Valida');
    expect(nombreServicio({ slug: 'sustenta-base', modulo: 'compliance', nombre: 'Sustenta' })).toBe('Sustenta');
  });

  it('pesos, fecha en Bogotá, enlace y adjuntos', () => {
    expect(pesos(150000)).toBe('$150.000');
    expect(pesos(1750000.4)).toBe('$1.750.000');
    expect(pesos(900)).toBe('$900');
    // 02:00 UTC del 29 = 21:00 del 28 en Bogotá.
    expect(fechaLarga('2026-10-29T02:00:00Z')).toBe('28 de octubre de 2026');
    expect(enlacePagosEspacio('x')).toBe('https://x.metrikone.co/suscripcion?tab=pagos');
    expect(nombreAdjunto('FE-1', 'xml')).toBe('FE-1.xml');
  });

  it('la copia de la paleta y el remitente no se separan de Next', () => {
    for (const [k, v] of Object.entries(COLORES_CORREO_FACTURA)) {
      expect(v, k).toBe(PALETA[k as keyof typeof PALETA]);
    }
    expect(FROM_FACTURACION).toBe(FROM_NEXT);
    expect(FROM_FACTURACION).toBe('MéTRIK · Facturación <facturacion@metrik.com.co>');
  });
});
