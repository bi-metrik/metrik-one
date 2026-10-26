/**
 * Un aviso al cliente sale UNA vez por el mismo hecho (SOE-008 / SOE-009, 2026-10-09).
 *
 * Los casos salen de producción (SOENA), medidos el 2026-10-09:
 *   · V0457: reproceso por la UPME el 21-sep; el caso volvió a pasar por Cita → Anexos
 *     el 22-sep con la MISMA cita (24-sep 9:30) y el cliente recibió dos veces «Tu cita
 *     con la DIAN quedó agendada» (correo + WhatsApp).
 *   · V0403: tres avisos de cita (4-sep, 1-oct, 6-oct), cada uno con OTRA cita: eran
 *     reprogramaciones reales y tienen que seguir saliendo.
 *   · V0171: la cita real ya había pasado y la pantalla no dejaba registrar fechas
 *     pasadas; quedó «9-oct 10:00» y el aviso salió a las 9:39 del mismo día.
 */
import { describe, expect, it } from 'vitest';
import {
  type AvisoPrevio,
  citaYaPaso,
  dataEnElMomento,
  datosQueCitaElAviso,
  decidirAvisoAlCliente,
  huellaDelHecho,
} from './aviso-mismo-hecho.ts';

/** El copy real del aviso de Anexos de SOENA (la cita). */
const COPY_CITA = {
  titulo: 'Tu cita con la DIAN quedó agendada',
  mensaje: 'Hola[ {cliente}]. Tu cita con la DIAN[ para tu {vehiculo}] quedó agendada para el {fecha_cita}.',
  mensaje_email: 'Hola[ {cliente}].\n\nFecha y hora: {fecha_cita}',
  mensaje_whatsapp: 'Hola[ {cliente}]. Te acabamos de enviar un correo con la fecha de tu cita.',
};
const CITADOS = datosQueCitaElAviso(COPY_CITA);

/** 8 de octubre de 2026, 15:00 en Bogotá. */
const AHORA = new Date('2026-10-08T20:00:00Z');

const enviado = (canal: string, huella: string | null, created_at = '2026-10-01T15:00:00Z'): AvisoPrevio => ({
  canal, estado: canal === 'email' ? 'enviado' : 'disparado', huella, created_at,
});

describe('qué datos definen el hecho', () => {
  it('el aviso de la cita cita la fecha aunque el WhatsApp remita al correo', () => {
    expect(CITADOS).toEqual(['fecha_cita']);
  });
  it('un aviso sin datos (llegó a la etapa) tiene huella vacía', () => {
    expect(datosQueCitaElAviso({ mensaje: 'Tu trámite pasó a la etapa "{etapa}".' })).toEqual([]);
    expect(huellaDelHecho({})).toBe('{}');
  });
});

describe('reproceso con la misma cita', () => {
  it('NO reenvía (correo ni WhatsApp)', () => {
    const bloques = { cita: { fecha_cita_dian: '2026-10-20T09:30' } };
    const h = huellaDelHecho({ fecha_cita: '2026-10-20T09:30' });
    const previos = [enviado('email', h), enviado('whatsapp', h)];
    for (const canal of ['email', 'whatsapp']) {
      const d = decidirAvisoAlCliente({ canal, citados: CITADOS, bloques, previos, ahora: AHORA });
      expect(d.omitir).toBe(true);
      expect(d.omitir && d.motivo).toBe('duplicado');
    }
  });

  it('V0457: un aviso VIEJO (sin huella) se reconoce por el historial del bloque', () => {
    // Aviso del 21-sep 13:38; el reproceso archivó la cita a las 22:04 y se volvió a
    // registrar la misma.
    const bloques = {
      cita: {
        fecha_cita_dian: '2026-10-24T09:30',
        _ciclos: [{ data: { fecha_cita_dian: '2026-10-24T09:30' }, archivado_at: '2026-10-07T22:04:00Z' }],
      },
    };
    const previos = [enviado('email', null, '2026-10-07T13:38:42Z')];
    const d = decidirAvisoAlCliente({ canal: 'email', citados: CITADOS, bloques, previos, ahora: AHORA });
    expect(d.omitir && d.motivo).toBe('duplicado');
  });

  it('un aviso de etapa sin datos no se repite al volver a entrar', () => {
    const d = decidirAvisoAlCliente({
      canal: 'email', citados: [], bloques: {}, previos: [enviado('email', null)], ahora: AHORA,
    });
    expect(d.omitir && d.motivo).toBe('duplicado');
  });
});

describe('cita cambiada (reprogramación)', () => {
  it('SÍ envía: otra hora es otro hecho', () => {
    const bloques = { cita: { fecha_cita_dian: '2026-10-20T10:30' } };
    const previos = [enviado('email', huellaDelHecho({ fecha_cita: '2026-10-20T09:30' }))];
    const d = decidirAvisoAlCliente({ canal: 'email', citados: CITADOS, bloques, previos, ahora: AHORA });
    expect(d.omitir).toBe(false);
  });

  it('V0403: avisos viejos con citas anteriores no silencian la nueva', () => {
    const bloques = {
      cita: {
        fecha_cita_dian: '2026-10-27T08:00',
        _ciclos: [
          { data: { fecha_cita_dian: '2026-10-11T14:00' }, archivado_at: '2026-10-01T20:12:00Z' },
          { data: { fecha_cita_dian: '2026-10-22T09:30' }, archivado_at: '2026-10-05T17:17:00Z' },
        ],
      },
    };
    const previos = [
      enviado('email', null, '2026-09-04T20:02:00Z'),
      enviado('email', null, '2026-10-01T21:44:00Z'),
    ];
    const d = decidirAvisoAlCliente({ canal: 'email', citados: CITADOS, bloques, previos, ahora: AHORA });
    expect(d.omitir).toBe(false);
  });

  it('un previo por OTRO canal o que no salió no cuenta', () => {
    const bloques = { cita: { fecha_cita_dian: '2026-10-20T09:30' } };
    const h = huellaDelHecho({ fecha_cita: '2026-10-20T09:30' });
    const previos: AvisoPrevio[] = [
      enviado('whatsapp', h),
      { canal: 'email', estado: 'omitido', huella: h, created_at: '2026-10-01T15:00:00Z' },
      { canal: 'email', estado: 'rebotado', huella: h, created_at: '2026-10-01T15:00:00Z' },
    ];
    const d = decidirAvisoAlCliente({ canal: 'email', citados: CITADOS, bloques, previos, ahora: AHORA });
    expect(d.omitir).toBe(false);
  });

  it('una fila vieja que no se puede reconstruir no calla el aviso', () => {
    // En el instante del aviso viejo la cita estaba vacía: no se sabe qué se dijo.
    const bloques = {
      cita: {
        fecha_cita_dian: '2026-10-20T09:30',
        _ciclos: [{ data: {}, archivado_at: '2026-10-05T00:00:00Z' }],
      },
    };
    const d = decidirAvisoAlCliente({
      canal: 'email', citados: CITADOS, bloques, previos: [enviado('email', null)], ahora: AHORA,
    });
    expect(d.omitir).toBe(false);
  });
});

describe('cita pasada (SOE-009)', () => {
  it('NO envía, aunque sea la primera vez', () => {
    const bloques = { cita: { fecha_cita_dian: '2026-09-10T08:00' } };
    const d = decidirAvisoAlCliente({ canal: 'email', citados: CITADOS, bloques, previos: [], ahora: AHORA });
    expect(d.omitir && d.motivo).toBe('cita_pasada');
  });

  it('la hora cuenta en Bogotá: hoy 14:59 ya pasó, hoy 15:01 no', () => {
    expect(citaYaPaso('2026-10-08T14:59', AHORA)).toBe(true);
    expect(citaYaPaso('2026-10-08T15:01', AHORA)).toBe(false);
    // 20:00 UTC son las 15:00 en Bogotá: leer en UTC la daría por pasada.
    expect(citaYaPaso('2026-10-08T19:00', AHORA)).toBe(false);
  });

  it('una cita de solo día vale hasta que termina ese día', () => {
    expect(citaYaPaso('2026-10-08', AHORA)).toBe(false);
    expect(citaYaPaso('2026-10-07', AHORA)).toBe(true);
  });

  it('un aviso que no cita la fecha no mira la cita', () => {
    const d = decidirAvisoAlCliente({
      canal: 'email', citados: ['link'], bloques: { cita: { fecha_cita_dian: '2020-01-01T08:00' }, documento: { drive_url: 'one://b/x.pdf' } },
      previos: [], ahora: AHORA,
    });
    expect(d.omitir).toBe(false);
  });
});

describe('primer avance normal', () => {
  it('sigue enviando', () => {
    const bloques = { cita: { fecha_cita_dian: '2026-10-20T09:30' } };
    const d = decidirAvisoAlCliente({ canal: 'email', citados: CITADOS, bloques, previos: [], ahora: AHORA });
    expect(d.omitir).toBe(false);
    expect(d.huella).toBe('{"fecha_cita":"2026-10-20T09:30"}');
  });

  it('un certificado reemitido (otro documento) es otro hecho', () => {
    const previos = [enviado('email', huellaDelHecho({ link: 'one://docs/ws/cert-v1.pdf' }))];
    const d = decidirAvisoAlCliente({
      canal: 'email', citados: ['link'], bloques: { documento: { drive_url: 'one://docs/ws/cert-v2.pdf' } },
      previos, ahora: AHORA,
    });
    expect(d.omitir).toBe(false);
  });
});

describe('dataEnElMomento', () => {
  it('toma el primer ciclo archivado después del instante, o el actual', () => {
    const data = {
      x: 'actual',
      _ciclos: [
        { data: { x: 'v2' }, archivado_at: '2026-10-05T00:00:00Z' },
        { data: { x: 'v1' }, archivado_at: '2026-10-01T00:00:00Z' },
      ],
    };
    expect(dataEnElMomento(data, '2026-09-30T00:00:00Z').x).toBe('v1');
    expect(dataEnElMomento(data, '2026-10-03T00:00:00Z').x).toBe('v2');
    expect(dataEnElMomento(data, '2026-10-06T00:00:00Z').x).toBe('actual');
    expect(dataEnElMomento(data).x).toBe('actual');
  });
});
