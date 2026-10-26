import { afterEach, describe, expect, it } from 'vitest';
import { todayBogotaISO } from './bogota.ts';
import {
  banderaEncendida,
  componenteBotonConfirmacion,
  debeEscalar,
  dosisVencidas,
  esConfirmacionDeRecordatorio,
  eventoDelPayload,
  horaLocalDe,
  instanteBogota,
  normalizarHora,
  payloadConfirmacion,
  type Recordatorio,
} from './wa-recordatorios-reglas.ts';

/**
 * Datos sintéticos: la `etiqueta` de estas pruebas es texto de prueba y nada más. Ninguna
 * fila sale de producción y no hay aquí ningún dato de persona.
 */
const rec = (over: Partial<Recordatorio> = {}): Recordatorio => ({
  id: over.id ?? '11111111-1111-4111-8111-111111111111',
  destinatario_phone: '573000000001',
  escalamiento_phone: null,
  etiqueta: 'pendiente de la tarde',
  horarios: ['07:00:00', '19:00:00', '23:00:00'],
  escalamiento_minutos: 30,
  activo: true,
  ...over,
});

// El cálculo no puede depender de la zona del proceso: Vercel y Deno corren en UTC y el
// desarrollo es en Bogotá. Se ejercitan las dos, más una tercera al otro lado del mundo.
const ZONAS = ['UTC', 'America/Bogota', 'Asia/Tokyo'];
const TZ_ORIGINAL = process.env.TZ;
afterEach(() => { process.env.TZ = TZ_ORIGINAL; });

function enCadaZona(fn: () => void) {
  for (const tz of ZONAS) {
    process.env.TZ = tz;
    fn();
  }
}

describe('la hora local se resuelve en Bogotá, no en la del proceso', () => {
  it('19:00 y 23:59 del 30-sep caen en el 1-oct UTC', () => {
    enCadaZona(() => {
      expect(instanteBogota('2026-09-30', '19:00')?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(instanteBogota('2026-09-30', '23:59')?.toISOString()).toBe('2026-10-01T04:59:00.000Z');
      expect(instanteBogota('2026-09-30', '06:30')?.toISOString()).toBe('2026-09-30T11:30:00.000Z');
    });
  });

  it('el viaje de ida y vuelta devuelve la misma hora local', () => {
    enCadaZona(() => {
      for (const hora of ['00:00', '06:30', '19:00', '23:59']) {
        const i = instanteBogota('2026-09-30', hora)!;
        expect(horaLocalDe(i.toISOString())).toBe(hora);
      }
    });
  });

  it('`time` de Postgres llega con segundos y se normaliza', () => {
    expect(normalizarHora('07:00:00')).toBe('07:00');
    expect(normalizarHora('7:05')).toBe('07:05');
    expect(normalizarHora('24:00')).toBeNull();
    expect(normalizarHora('07:60')).toBeNull();
    expect(normalizarHora('mañana')).toBeNull();
  });
});

describe('qué dosis están vencidas', () => {
  it('a las 19:30 de Bogotá (ya 1-oct en UTC) van las de las 07:00 y 19:00, no la de las 23:00', () => {
    enCadaZona(() => {
      const ahora = new Date('2026-10-01T00:30:00Z'); // 19:30 del 30-sep en Bogotá
      // El día civil que se usa es el de Bogotá, no el del reloj UTC.
      expect(todayBogotaISO(ahora)).toBe('2026-09-30');
      const d = dosisVencidas([rec()], todayBogotaISO(ahora), ahora);
      expect(d.map((x) => x.hora_local)).toEqual(['07:00', '19:00']);
      expect(d[1].programado_para).toBe('2026-10-01T00:00:00.000Z');
    });
  });

  it('a las 23:59 de Bogotá van las tres', () => {
    enCadaZona(() => {
      const ahora = new Date('2026-10-01T04:59:00Z');
      expect(dosisVencidas([rec()], todayBogotaISO(ahora), ahora).map((x) => x.hora_local))
        .toEqual(['07:00', '19:00', '23:00']);
    });
  });

  it('pasada la medianoche de Bogotá arranca un día nuevo y no resucita la dosis de las 23:00', () => {
    enCadaZona(() => {
      const ahora = new Date('2026-10-01T05:10:00Z'); // 00:10 del 1-oct en Bogotá
      expect(todayBogotaISO(ahora)).toBe('2026-10-01');
      expect(dosisVencidas([rec()], todayBogotaISO(ahora), ahora)).toEqual([]);
    });
  });

  it('la dosis exacta de la hora sale (>=, no >)', () => {
    const ahora = new Date('2026-10-01T00:00:00Z'); // 19:00 en punto
    expect(dosisVencidas([rec({ horarios: ['19:00'] })], '2026-09-30', ahora)).toHaveLength(1);
    const unMinutoAntes = new Date('2026-09-30T23:59:00Z');
    expect(dosisVencidas([rec({ horarios: ['19:00'] })], '2026-09-30', unMinutoAntes)).toEqual([]);
  });

  it('un recordatorio inactivo no produce dosis y un horario ilegible no tumba los demás', () => {
    const ahora = new Date('2026-10-01T04:00:00Z');
    expect(dosisVencidas([rec({ activo: false })], '2026-09-30', ahora)).toEqual([]);
    const d = dosisVencidas([rec({ horarios: ['07:00', 'ayer', '19:00'] })], '2026-09-30', ahora);
    expect(d.map((x) => x.hora_local)).toEqual(['07:00', '19:00']);
  });
});

describe('cuándo se escala', () => {
  const base = { id: 'e1', recordatorio_id: 'r1', programado_para: '2026-10-01T00:00:00.000Z' };

  it('a los N minutos del envío, no de la hora programada', () => {
    const evento = { ...base, enviado_at: '2026-10-01T00:20:00.000Z' };
    // 30 min después de la hora PROGRAMADA, pero solo 10 del envío: todavía no.
    expect(debeEscalar(evento, 30, new Date('2026-10-01T00:30:00Z'))).toBe(false);
    expect(debeEscalar(evento, 30, new Date('2026-10-01T00:50:00Z'))).toBe(true);
  });

  it('no escala lo que no salió, lo ya confirmado ni lo ya escalado', () => {
    const tarde = new Date('2026-10-01T09:00:00Z');
    expect(debeEscalar({ ...base, enviado_at: null }, 30, tarde)).toBe(false);
    expect(debeEscalar({ ...base, enviado_at: base.programado_para, confirmado_at: '2026-10-01T00:05:00Z' }, 30, tarde)).toBe(false);
    expect(debeEscalar({ ...base, enviado_at: base.programado_para, escalado_at: '2026-10-01T00:40:00Z' }, 30, tarde)).toBe(false);
  });
});

describe('el payload del botón', () => {
  const id = '22222222-2222-4222-8222-222222222222';

  it('con id se resuelve la dosis exacta', () => {
    expect(payloadConfirmacion(id)).toBe(`rec_ok:${id}`);
    expect(esConfirmacionDeRecordatorio(payloadConfirmacion(id))).toBe(true);
    expect(eventoDelPayload(payloadConfirmacion(id))).toBe(id);
  });

  it('el payload estático se reconoce igual, y ahí no hay dosis en el payload', () => {
    expect(esConfirmacionDeRecordatorio('rec_ok')).toBe(true);
    expect(eventoDelPayload('rec_ok')).toBeNull();
  });

  it('un payload ajeno o basura no se atiende', () => {
    for (const p of [null, undefined, '', 'ACEPTO', 'rec_okotro', 'rec_ok_x']) {
      expect(esConfirmacionDeRecordatorio(p)).toBe(false);
    }
    // Con prefijo correcto pero id que no es uuid: se atiende, y se resuelve por teléfono.
    expect(esConfirmacionDeRecordatorio('rec_ok:no-es-uuid')).toBe(true);
    expect(eventoDelPayload('rec_ok:no-es-uuid')).toBeNull();
  });

  it('el componente del botón va en el índice 0 como quick_reply', () => {
    expect(componenteBotonConfirmacion(id)).toEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: `rec_ok:${id}` }],
    });
  });
});

describe('la bandera', () => {
  it('solo "on" prende; ausente, vacío o cualquier otra cosa deja apagado', () => {
    expect(banderaEncendida('on')).toBe(true);
    expect(banderaEncendida(' ON ')).toBe(true);
    for (const v of [undefined, null, '', 'off', 'true', '1', 'si']) {
      expect(banderaEncendida(v)).toBe(false);
    }
  });
});
