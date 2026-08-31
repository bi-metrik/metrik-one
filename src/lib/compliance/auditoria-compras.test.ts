/**
 * R5 — cruce de la base de compras contra lo que el oficial sabía y había
 * decidido EN LA FECHA de cada contratación.
 *
 * Por qué tiene pruebas propias y densas: el informe que sale de acá se le
 * entrega a la empresa y señala a personas que se saltaron el procedimiento. Un
 * falso positivo acusa a alguien que hizo lo correcto; un falso negativo deja
 * pasar la contratación que el control existía para detectar.
 *
 * La prueba que más importa es la de retroactividad: si una liberación firmada
 * DESPUÉS de la compra la justificara, bastaría con liberar a todo el mundo al
 * cierre del periodo para que el informe saliera siempre limpio.
 *
 * VERIFICADO POR MUTACIÓN (2026-08-31), contra este archivo + el de la server
 * action. Cada mutación tumbó pruebas:
 *   - quitar el filtro `created_at <= fecha` de `coberturaAlMomento` → caen 4
 *   - evaluar la vigencia contra hoy y no contra la fecha de compra → caen 8
 *   - contar una consulta fallida como concluyente → cae 1
 *   - que el rechazo deje de mandar sobre los demás veredictos → caen 4
 *   - aceptar MM/DD cuando DD/MM no cuadra, en vez de rechazar → cae 1
 */

import { describe, it, expect } from 'vitest';
import {
  auditarCompra,
  coberturaAlMomento,
  esHallazgo,
  ordenarResultados,
  parsearFechaCompra,
  resumirAuditoria,
  type ConsultaParaAuditoria,
  type FilaCompra,
} from './auditoria-compras';
import type { ComplianceLiberacion } from './liberaciones';

const FECHA_COMPRA = '2026-06-15';

function compra(p: Partial<FilaCompra> = {}): FilaCompra {
  return {
    posicion: 2,
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    nombre: 'Acme SAS',
    fecha: FECHA_COMPRA,
    referencia: 'OC-1001',
    comprador: 'Analista de Compras',
    valor: 12_000_000,
    ...p,
  };
}

function consulta(p: Partial<ConsultaParaAuditoria> = {}): ConsultaParaAuditoria {
  return {
    id: 'consulta-1',
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    severidad: 'alto',
    total_matches: 3,
    created_at: '2026-06-01T10:00:00.000Z',
    created_by: 'user-analista',
    ...p,
  };
}

function liberacion(p: Partial<ComplianceLiberacion> = {}): ComplianceLiberacion {
  return {
    id: 'lib-1',
    consulta_id: 'consulta-1',
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    nombre: 'Acme SAS',
    decision: 'liberada',
    justificacion: 'Homonimia verificada.',
    vigente_desde: '2026-06-02',
    vigente_hasta: '2026-12-31',
    control_id: null,
    liberada_por: 'user-oficial',
    created_at: '2026-06-02T10:00:00.000Z',
    ...p,
  };
}

// ─── Retroactividad: el corazón de R5 ──────────────────────────────────────

describe('coberturaAlMomento — nada cubre hacia atrás', () => {
  it('una liberación firmada DESPUÉS de la compra no la cubre', () => {
    const tardia = liberacion({ created_at: '2026-07-01T10:00:00.000Z' });
    expect(coberturaAlMomento([tardia], FECHA_COMPRA).cubierta).toBe(false);
  });

  it('una liberación firmada antes sí cubre', () => {
    expect(coberturaAlMomento([liberacion()], FECHA_COMPRA).cubierta).toBe(true);
  });

  it('una liberación firmada el mismo día cubre', () => {
    const mismoDia = liberacion({ created_at: `${FECHA_COMPRA}T09:00:00.000Z` });
    expect(coberturaAlMomento([mismoDia], FECHA_COMPRA).cubierta).toBe(true);
  });

  // Se evalúa contra la fecha de compra, no contra hoy: una liberación que ya
  // había vencido ese día no cubría, aunque después se haya renovado.
  it('una liberación ya vencida a esa fecha no cubre', () => {
    const vencida = liberacion({ vigente_hasta: '2026-06-01' });
    expect(coberturaAlMomento([vencida], FECHA_COMPRA).motivo).toBe('vencida');
  });

  it('un rechazo posterior no vuelve ilegal una compra que estaba cubierta', () => {
    const rechazoTardio = liberacion({
      id: 'lib-2', decision: 'rechazada', vigente_hasta: null,
      created_at: '2026-08-01T10:00:00.000Z',
    });
    expect(coberturaAlMomento([liberacion(), rechazoTardio], FECHA_COMPRA).cubierta).toBe(true);
  });
});

// ─── Los siete veredictos ──────────────────────────────────────────────────

describe('auditarCompra', () => {
  it('sin ninguna consulta: se contrató a ciegas', () => {
    const r = auditarCompra(compra(), [], []);
    expect(r.veredicto).toBe('sin_consulta');
    expect(esHallazgo(r.veredicto)).toBe(true);
  });

  it('consultada solo después de contratar: el procedimiento se invirtió', () => {
    const tardia = consulta({ created_at: '2026-07-10T10:00:00.000Z' });
    const r = auditarCompra(compra(), [tardia], []);
    expect(r.veredicto).toBe('consultada_despues');
    expect(r.consulta_posterior?.id).toBe('consulta-1');
    expect(r.consulta_previa).toBeNull();
  });

  it('con hallazgo previo y sin liberación: incumplimiento', () => {
    const r = auditarCompra(compra(), [consulta()], []);
    expect(r.veredicto).toBe('hallazgo_sin_liberacion');
  });

  it('con hallazgo previo y liberación vigente a esa fecha: cubierta', () => {
    const r = auditarCompra(compra(), [consulta()], [liberacion()]);
    expect(r.veredicto).toBe('cubierta');
    expect(esHallazgo(r.veredicto)).toBe(false);
  });

  // El caso que el control existe para encontrar.
  it('la liberación tardía NO limpia la compra', () => {
    const tardia = liberacion({ created_at: '2026-07-01T10:00:00.000Z' });
    const r = auditarCompra(compra(), [consulta()], [tardia]);
    expect(r.veredicto).toBe('hallazgo_sin_liberacion');
  });

  it('con rechazo vigente: contratada pese al rechazo', () => {
    const rechazo = liberacion({ decision: 'rechazada', vigente_hasta: null });
    const r = auditarCompra(compra(), [consulta()], [rechazo]);
    expect(r.veredicto).toBe('contratada_pese_a_rechazo');
  });

  it('el rechazo manda incluso sobre una liberación anterior', () => {
    const rechazo = liberacion({
      id: 'lib-2', decision: 'rechazada', vigente_hasta: null,
      created_at: '2026-06-10T10:00:00.000Z',
    });
    const r = auditarCompra(compra(), [consulta()], [liberacion(), rechazo]);
    expect(r.veredicto).toBe('contratada_pese_a_rechazo');
  });

  it('consultada antes y sin hallazgo: curso normal', () => {
    const limpia = consulta({ severidad: 'sin_hallazgo', total_matches: 0 });
    const r = auditarCompra(compra(), [limpia], []);
    expect(r.veredicto).toBe('sin_hallazgo');
    expect(esHallazgo(r.veredicto)).toBe(false);
  });

  // "No se supo" no es "salió limpia". Es el falso negativo de agosto, ahora en
  // el informe que se le entrega a la empresa.
  it('una consulta previa fallida no cuenta como limpia', () => {
    const fallida = consulta({ severidad: 'error', total_matches: 0 });
    const r = auditarCompra(compra(), [fallida], []);
    expect(r.veredicto).toBe('sin_resultado');
    expect(esHallazgo(r.veredicto)).toBe(true);
  });

  it('manda la consulta previa MÁS RECIENTE, no la primera', () => {
    const vieja = consulta({ id: 'c-vieja', created_at: '2026-01-01T10:00:00.000Z' });
    const nueva = consulta({
      id: 'c-nueva', severidad: 'sin_hallazgo', total_matches: 0,
      created_at: '2026-06-10T10:00:00.000Z',
    });
    const r = auditarCompra(compra(), [vieja, nueva], []);
    expect(r.consulta_previa?.id).toBe('c-nueva');
    expect(r.veredicto).toBe('sin_hallazgo');
  });

  // Sesgo declarado a favor del auditado: la fecha de compra es civil, sin hora.
  it('la consulta del mismo día cuenta como previa', () => {
    const mismoDia = consulta({ created_at: `${FECHA_COMPRA}T16:00:00.000Z` });
    const r = auditarCompra(compra(), [mismoDia], []);
    expect(r.veredicto).toBe('hallazgo_sin_liberacion');
    expect(r.consulta_previa?.id).toBe('consulta-1');
  });

  it('cruza aunque la compra escriba el NIT con puntos y guion', () => {
    const r = auditarCompra(
      compra({ documento_numero: '900.123.456' }),
      [consulta({ documento_numero: '900123456' })],
      [liberacion({ documento_numero: '900123456' })],
    );
    expect(r.veredicto).toBe('cubierta');
  });
});

// ─── Informe ───────────────────────────────────────────────────────────────

describe('resumen y orden', () => {
  const resultados = [
    auditarCompra(compra({ posicion: 2, fecha: '2026-06-20' }), [consulta()], [liberacion()]),
    auditarCompra(compra({ posicion: 3, fecha: '2026-06-10' }), [], []),
    auditarCompra(
      compra({ posicion: 4, fecha: '2026-06-05' }),
      [consulta()],
      [liberacion({ decision: 'rechazada', vigente_hasta: null })],
    ),
  ];

  it('cuenta hallazgos sin contar el curso normal', () => {
    const r = resumirAuditoria(resultados, 0);
    expect(r.hallazgos).toBe(2);
    expect(r.por_veredicto.cubierta).toBe(1);
  });

  it('las filas ilegibles se suman al total y se reportan aparte', () => {
    const r = resumirAuditoria(resultados, 2);
    expect(r.total_filas).toBe(5);
    expect(r.filas_invalidas).toBe(2);
  });

  it('el periodo sale de las fechas efectivas', () => {
    const r = resumirAuditoria(resultados, 0);
    expect(r.periodo_desde).toBe('2026-06-05');
    expect(r.periodo_hasta).toBe('2026-06-20');
  });

  it('lo peor va primero', () => {
    expect(ordenarResultados(resultados).map((r) => r.veredicto)).toEqual([
      'contratada_pese_a_rechazo',
      'sin_consulta',
      'cubierta',
    ]);
  });
});

// ─── Fechas ────────────────────────────────────────────────────────────────

describe('parsearFechaCompra — no adivina', () => {
  it('acepta ISO', () => {
    expect(parsearFechaCompra('2026-06-15')).toBe('2026-06-15');
  });

  it('acepta el formato colombiano DD/MM/AAAA', () => {
    expect(parsearFechaCompra('15/06/2026')).toBe('2026-06-15');
  });

  it('acepta un solo dígito en día y mes', () => {
    expect(parsearFechaCompra('3/4/2026')).toBe('2026-04-03');
  });

  // Si aceptara MM/DD, esto sería el 4 de marzo y el veredicto podría cambiar.
  it('lee 03/04/2026 como 3 de abril, la convención declarada', () => {
    expect(parsearFechaCompra('03/04/2026')).toBe('2026-04-03');
  });

  it('rechaza un mes imposible en vez de intercambiar día y mes', () => {
    expect(parsearFechaCompra('06/15/2026')).toBeNull();
  });

  it('rechaza el 31 de febrero', () => {
    expect(parsearFechaCompra('31/02/2026')).toBeNull();
  });

  it('acepta el 29 de febrero bisiesto', () => {
    expect(parsearFechaCompra('29/02/2024')).toBe('2024-02-29');
  });

  it('rechaza el 29 de febrero no bisiesto', () => {
    expect(parsearFechaCompra('29/02/2026')).toBeNull();
  });

  it('rechaza texto libre y vacío en vez de inventar una fecha', () => {
    expect(parsearFechaCompra('junio')).toBeNull();
    expect(parsearFechaCompra('')).toBeNull();
    expect(parsearFechaCompra(null)).toBeNull();
  });
});
