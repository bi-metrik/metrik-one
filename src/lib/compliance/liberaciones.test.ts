/**
 * Regla de cobertura de liberaciones (R4).
 *
 * Es la regla que decide si una contraparte con hallazgo puede contratarse. Si
 * se equivoca hacia el "sí", ONE autoriza contratar a alguien que el oficial
 * rechazó o cuya liberación venció — que es justo el riesgo que R4 vino a
 * cerrar. Por eso tiene pruebas propias y no solo cobertura indirecta desde las
 * server actions.
 *
 * VERIFICADO POR MUTACIÓN (2026-08-21) — cada mutación tumbó pruebas:
 *   - tomar la fila MÁS ANTIGUA en vez de la más reciente → caen 3
 *   - `vigente_hasta > hoy` en vez de `>=` → cae "el último día todavía cubre"
 *   - ignorar `decision` y mirar solo la vigencia → caen los 2 de rechazo
 *   - devolver `cubierta: true` cuando no hay filas → cae "sin ninguna fila"
 *   - quitar la normalización de `claveContraparte` → caen los 2 de agrupación
 */

import { describe, it, expect } from 'vitest';
import {
  claveContraparte,
  coberturaDeContraparte,
  indexarCoberturas,
  puedeLiberarContrapartes,
  sumarMesesISO,
  validarLiberacion,
  type ComplianceLiberacion,
} from './liberaciones';

const HOY = '2026-08-21';

function fila(p: Partial<ComplianceLiberacion> = {}): ComplianceLiberacion {
  return {
    id: p.id ?? 'lib-1',
    consulta_id: p.consulta_id ?? 'consulta-1',
    documento_tipo: p.documento_tipo ?? 'NIT',
    documento_numero: p.documento_numero ?? '900123456',
    nombre: p.nombre ?? 'Acme SAS',
    decision: p.decision ?? 'liberada',
    justificacion: p.justificacion ?? 'Coincidencia por homonimia, verificada con cédula.',
    vigente_desde: p.vigente_desde ?? '2026-08-01',
    vigente_hasta: p.vigente_hasta !== undefined ? p.vigente_hasta : '2026-11-01',
    control_id: p.control_id ?? null,
    liberada_por: p.liberada_por ?? 'user-oficial',
    created_at: p.created_at ?? '2026-08-01T10:00:00.000Z',
  };
}

// ─── Los cuatro casos que definen la regla ─────────────────────────────────

describe('coberturaDeContraparte — los cuatro estados', () => {
  it('liberación vigente cubre', () => {
    const r = coberturaDeContraparte([fila({ vigente_hasta: '2026-12-31' })], HOY);
    expect(r.cubierta).toBe(true);
    expect(r.motivo).toBe('vigente');
    expect(r.liberacion?.id).toBe('lib-1');
  });

  it('liberación vencida NO cubre — y nadie tuvo que ir a marcarla', () => {
    const r = coberturaDeContraparte([fila({ vigente_hasta: '2026-08-20' })], HOY);
    expect(r.cubierta).toBe(false);
    expect(r.motivo).toBe('vencida');
    // La fila sigue ahí: la bitácora no se reescribe, solo dejó de cubrir.
    expect(r.liberacion?.vigente_hasta).toBe('2026-08-20');
  });

  it('un rechazo POSTERIOR revoca la liberación anterior', () => {
    const r = coberturaDeContraparte(
      [
        fila({ id: 'lib-vieja', decision: 'liberada', vigente_hasta: '2027-01-01', created_at: '2026-08-01T10:00:00.000Z' }),
        fila({ id: 'lib-revoca', decision: 'rechazada', vigente_hasta: null, created_at: '2026-08-15T09:00:00.000Z' }),
      ],
      HOY,
    );
    expect(r.cubierta).toBe(false);
    expect(r.motivo).toBe('rechazada');
    expect(r.liberacion?.id).toBe('lib-revoca');
  });

  it('contraparte sin ninguna fila no está cubierta', () => {
    const r = coberturaDeContraparte([], HOY);
    expect(r.cubierta).toBe(false);
    expect(r.motivo).toBe('sin_registro');
    expect(r.liberacion).toBeNull();
  });
});

describe('coberturaDeContraparte — solo decide la fila más reciente', () => {
  it('una liberación posterior reactiva a quien había sido rechazado', () => {
    const r = coberturaDeContraparte(
      [
        fila({ id: 'rechazo', decision: 'rechazada', vigente_hasta: null, created_at: '2026-08-05T10:00:00.000Z' }),
        fila({ id: 'nueva', decision: 'liberada', vigente_hasta: '2026-12-31', created_at: '2026-08-18T10:00:00.000Z' }),
      ],
      HOY,
    );
    expect(r.cubierta).toBe(true);
    expect(r.liberacion?.id).toBe('nueva');
  });

  it('el orden en que llegan las filas no cambia el resultado', () => {
    const filas = [
      fila({ id: 'b', decision: 'rechazada', vigente_hasta: null, created_at: '2026-08-15T09:00:00.000Z' }),
      fila({ id: 'a', decision: 'liberada', vigente_hasta: '2027-01-01', created_at: '2026-08-01T10:00:00.000Z' }),
      fila({ id: 'c', decision: 'liberada', vigente_hasta: '2027-02-01', created_at: '2026-08-19T08:00:00.000Z' }),
    ];
    const directo = coberturaDeContraparte(filas, HOY);
    const alReves = coberturaDeContraparte([...filas].reverse(), HOY);
    expect(directo.liberacion?.id).toBe('c');
    expect(alReves.liberacion?.id).toBe('c');
    expect(directo.cubierta).toBe(true);
  });

  it('una liberación vieja y vigente NO tapa un rechazo reciente', () => {
    const r = coberturaDeContraparte(
      [
        fila({ id: 'vieja', decision: 'liberada', vigente_hasta: '2030-01-01', created_at: '2026-01-01T10:00:00.000Z' }),
        fila({ id: 'rechazo', decision: 'rechazada', vigente_hasta: null, created_at: '2026-08-20T10:00:00.000Z' }),
      ],
      HOY,
    );
    expect(r.cubierta).toBe(false);
    expect(r.motivo).toBe('rechazada');
  });

  it('empate exacto de created_at: gana la decisión más restrictiva', () => {
    const mismoInstante = '2026-08-15T09:00:00.000Z';
    const r = coberturaDeContraparte(
      [
        fila({ id: 'libera', decision: 'liberada', vigente_hasta: '2027-01-01', created_at: mismoInstante }),
        fila({ id: 'rechaza', decision: 'rechazada', vigente_hasta: null, created_at: mismoInstante }),
      ],
      HOY,
    );
    expect(r.cubierta).toBe(false);
    expect(r.liberacion?.id).toBe('rechaza');
  });
});

describe('coberturaDeContraparte — bordes de la vigencia', () => {
  it('el último día de vigencia TODAVÍA cubre', () => {
    const r = coberturaDeContraparte([fila({ vigente_hasta: HOY })], HOY);
    expect(r.cubierta).toBe(true);
  });

  it('el día siguiente al último ya no cubre', () => {
    const r = coberturaDeContraparte([fila({ vigente_hasta: '2026-08-20' })], '2026-08-21');
    expect(r.cubierta).toBe(false);
    expect(r.motivo).toBe('vencida');
  });

  it('liberada sin fecha de fin no cubre para siempre por omisión', () => {
    const r = coberturaDeContraparte([fila({ decision: 'liberada', vigente_hasta: null })], HOY);
    expect(r.cubierta).toBe(false);
    expect(r.motivo).toBe('vencida');
  });
});

// ─── Identidad de la contraparte ───────────────────────────────────────────

describe('claveContraparte', () => {
  it('el mismo NIT escrito de dos formas es la misma contraparte', () => {
    expect(claveContraparte('NIT', '900.123.456-7')).toBe(claveContraparte('nit', '9001234567'));
  });

  it('el mismo número con distinto tipo de documento NO es la misma contraparte', () => {
    expect(claveContraparte('NIT', '123456')).not.toBe(claveContraparte('CC', '123456'));
  });

  it('sin documento no hay clave — una consulta por nombre no se puede liberar por documento', () => {
    expect(claveContraparte('CC', null)).toBeNull();
    expect(claveContraparte(null, '123')).toBeNull();
    expect(claveContraparte('CC', '   ')).toBeNull();
  });
});

describe('indexarCoberturas', () => {
  it('agrupa por contraparte y aplica la regla a cada una por separado', () => {
    const mapa = indexarCoberturas(
      [
        fila({ id: 'a1', documento_numero: '900111', decision: 'liberada', vigente_hasta: '2026-12-31' }),
        fila({ id: 'b1', documento_numero: '900222', decision: 'liberada', vigente_hasta: '2026-08-01' }),
        fila({ id: 'b2', documento_numero: '900222', decision: 'rechazada', vigente_hasta: null, created_at: '2026-08-10T10:00:00.000Z' }),
      ],
      HOY,
    );
    expect(mapa.get('NIT:900111')?.cubierta).toBe(true);
    expect(mapa.get('NIT:900222')?.cubierta).toBe(false);
    expect(mapa.get('NIT:900222')?.motivo).toBe('rechazada');
    expect(mapa.has('NIT:900333')).toBe(false);
  });

  it('la liberación de un NIT con puntos cubre a la consulta que lo guardó sin puntos', () => {
    const mapa = indexarCoberturas(
      [fila({ documento_numero: '900.123.456-7', vigente_hasta: '2026-12-31' })],
      HOY,
    );
    expect(mapa.get(claveContraparte('NIT', '9001234567')!)?.cubierta).toBe(true);
  });
});

// ─── Validación del formulario ─────────────────────────────────────────────

describe('validarLiberacion', () => {
  const base = { consulta_id: 'c-1', decision: 'liberada' as const, justificacion: 'Homónimo verificado.' };

  it('acepta una liberación completa', () => {
    expect(validarLiberacion({ ...base, vigente_hasta: '2026-12-31' }, HOY)).toBeNull();
  });

  it('justificación vacía se rechaza — también en un rechazo', () => {
    expect(validarLiberacion({ ...base, justificacion: '   ', vigente_hasta: '2026-12-31' }, HOY)).toBe('justificacion_requerida');
    expect(validarLiberacion({ ...base, decision: 'rechazada', justificacion: '' }, HOY)).toBe('justificacion_requerida');
  });

  it('liberación sin vigencia se rechaza: no vencería nunca', () => {
    expect(validarLiberacion({ ...base, vigente_hasta: null }, HOY)).toContain('vigencia_requerida');
  });

  it('liberación con vigencia ya pasada se rechaza: nacería vencida', () => {
    expect(validarLiberacion({ ...base, vigente_hasta: '2026-08-20' }, HOY)).toContain('vigencia_en_el_pasado');
  });

  it('vigencia que vence hoy se acepta — hoy todavía cubre', () => {
    expect(validarLiberacion({ ...base, vigente_hasta: HOY }, HOY)).toBeNull();
  });

  it('un rechazo no necesita vigencia', () => {
    expect(validarLiberacion({ consulta_id: 'c-1', decision: 'rechazada', justificacion: 'Reporte OFAC confirmado.' }, HOY)).toBeNull();
  });

  it('decisión fuera del par liberada/rechazada se rechaza', () => {
    expect(
      // @ts-expect-error — el punto de la prueba es el input que llega del cliente sin tipos
      validarLiberacion({ ...base, decision: 'valida_falso_negativo', vigente_hasta: '2026-12-31' }, HOY),
    ).toContain('decision_invalida');
  });
});

// ─── Aritmética de vigencia ────────────────────────────────────────────────

describe('sumarMesesISO', () => {
  it('suma los meses del cuadro de la oficial de cumplimiento', () => {
    expect(sumarMesesISO('2026-08-21', 3)).toBe('2026-11-21');
    expect(sumarMesesISO('2026-08-21', 6)).toBe('2027-02-21');
    expect(sumarMesesISO('2026-08-21', 12)).toBe('2027-08-21');
  });

  it('se topa al último día del mes destino', () => {
    expect(sumarMesesISO('2026-01-31', 1)).toBe('2026-02-28');
    expect(sumarMesesISO('2028-01-31', 1)).toBe('2028-02-29');
    expect(sumarMesesISO('2026-05-31', 1)).toBe('2026-06-30');
  });

  it('cruza el año', () => {
    expect(sumarMesesISO('2026-12-15', 3)).toBe('2027-03-15');
  });
});

// ─── Permisos ──────────────────────────────────────────────────────────────

describe('puedeLiberarContrapartes', () => {
  it('libera el oficial de cumplimiento (owner/admin)', () => {
    expect(puedeLiberarContrapartes('owner')).toBe(true);
    expect(puedeLiberarContrapartes('admin')).toBe(true);
  });

  it('quien consulta listas NO libera', () => {
    expect(puedeLiberarContrapartes('operator')).toBe(false);
    expect(puedeLiberarContrapartes('supervisor')).toBe(false);
    expect(puedeLiberarContrapartes('read_only')).toBe(false);
    expect(puedeLiberarContrapartes(null)).toBe(false);
    expect(puedeLiberarContrapartes(undefined)).toBe(false);
  });
});
