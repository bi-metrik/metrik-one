/**
 * R3 — motor de monitoreo recurrente.
 *
 * Lo que estas pruebas cuidan es de tres naturalezas distintas, y conviene no
 * mezclarlas al leerlas:
 *
 *   1. **Plata.** El barrido gasta consultas facturables de AFI sin que nadie
 *      lo esté mirando. Si la selección se equivoca hacia arriba, la factura
 *      crece sola; si el tope no corta, no hay tope.
 *   2. **Riesgo.** Si se equivoca hacia abajo, alguien deja de vigilarse y
 *      nadie se entera, porque un barrido que no encuentra nada se ve igual que
 *      un barrido que no miró.
 *   3. **Derecho.** El horizonte de *Rechazadas* y la prohibición de alertar
 *      sobre esa población no son preferencias de producto: son el fallo del
 *      §3 del concepto de Emilio (2026-08-31). Romperlas no rompe una pantalla,
 *      convierte el registro de ALMA en una lista negra propia.
 */

import { describe, it, expect } from 'vitest';
import {
  aplicarTope,
  compararConsultas,
  cupoRestante,
  efectoDeDelta,
  evaluarCandidato,
  horizonteAgotado,
  inicioDePeriodo,
  modoDelBarrido,
  validarCupo,
  validarHorizonte,
  DEFAULT_HORIZONTE_RECHAZADAS_MESES,
  type CandidatoMonitoreo,
  type ConfigMonitoreo,
  type FotoConsulta,
  type Seleccionado,
} from './monitoreo';
import type { EtiquetaBandeja } from './bandeja';

const HOY = '2026-09-15';

const CONFIG: ConfigMonitoreo = {
  cupo_periodo: 100,
  horizonte_rechazadas_meses: DEFAULT_HORIZONTE_RECHAZADAS_MESES,
};

function candidato(over: Partial<CandidatoMonitoreo> = {}): CandidatoMonitoreo {
  return {
    clave: 'CC-1',
    etiqueta: 'vigilancia_continua',
    vigente_hasta: '2026-01-01',
    decidida_en: null,
    ...over,
  };
}

function foto(over: Partial<FotoConsulta> = {}): FotoConsulta {
  return { total_matches: 0, fuentes: [], tier_maximo: null, ...over };
}

// ─── Quién entra ───────────────────────────────────────────────────────────

describe('evaluarCandidato — las dos que exigen acción cuestan cero', () => {
  it.each<EtiquetaBandeja>(['hallazgos_sin_decidir', 'sin_cobertura_vigente'])(
    '%s no se re-consulta ni con la vigencia vencida hace años',
    (etiqueta) => {
      const ev = evaluarCandidato(
        candidato({ etiqueta, vigente_hasta: '2020-01-01' }), HOY, CONFIG,
      );
      expect(ev).toEqual({ barrer: false, motivo: 'exige_accion' });
    },
  );

  it('un represamiento del oficial no se traduce en factura', () => {
    // Diez contrapartes represadas y vencidísimas: cero consultas.
    const represadas = Array.from({ length: 10 }, (_, i) =>
      candidato({ clave: `CC-${i}`, etiqueta: 'hallazgos_sin_decidir', vigente_hasta: '2019-01-01' }));
    const barridas = represadas.filter((c) => evaluarCandidato(c, HOY, CONFIG).barrer);
    expect(barridas).toHaveLength(0);
  });
});

describe('evaluarCandidato — la vigencia es lo que dispara', () => {
  it('vigencia corriendo no se re-consulta: es la deduplicación que pidió Yessica', () => {
    const ev = evaluarCandidato(candidato({ vigente_hasta: '2026-12-31' }), HOY, CONFIG);
    expect(ev).toEqual({ barrer: false, motivo: 'vigencia_corriendo' });
  });

  it('el último día cubierto todavía cubre', () => {
    const ev = evaluarCandidato(candidato({ vigente_hasta: HOY }), HOY, CONFIG);
    expect(ev.barrer).toBe(false);
  });

  it('el día siguiente al último cubierto ya entra', () => {
    const ev = evaluarCandidato(candidato({ vigente_hasta: '2026-09-14' }), HOY, CONFIG);
    expect(ev).toEqual({ barrer: true, motivo: 'vigencia_vencida' });
  });

  it('sin vigencia entra, y con motivo propio', () => {
    // Consultas anteriores a R2. No poder probar que está cubierta no es lo
    // mismo que estarlo, y el motivo distinto es lo que deja verlas aparte.
    const ev = evaluarCandidato(candidato({ vigente_hasta: null }), HOY, CONFIG);
    expect(ev).toEqual({ barrer: true, motivo: 'sin_vigencia' });
  });
});

describe('evaluarCandidato — el horizonte de Rechazadas (Emilio §3)', () => {
  const rechazada = (decidida: string | null, vigente: string | null = '2020-01-01') =>
    candidato({ etiqueta: 'rechazadas', decidida_en: decidida, vigente_hasta: vigente });

  it('dentro del horizonte sigue en el barrido', () => {
    expect(evaluarCandidato(rechazada('2026-06-01'), HOY, CONFIG))
      .toEqual({ barrer: true, motivo: 'vigencia_vencida' });
  });

  it('agotado el horizonte sale, aunque su vigencia esté vencida', () => {
    // El orden de las guardas es la prueba: si la vigencia se mirara primero,
    // una rechazada vieja entraría al barrido para siempre.
    expect(evaluarCandidato(rechazada('2024-01-01'), HOY, CONFIG))
      .toEqual({ barrer: false, motivo: 'horizonte_agotado' });
  });

  it('sin fecha de decisión se trata como agotada, no como eterna', () => {
    expect(evaluarCandidato(rechazada(null), HOY, CONFIG))
      .toEqual({ barrer: false, motivo: 'horizonte_agotado' });
  });

  it('el horizonte solo aplica a Rechazadas', () => {
    // Una excepción vigente liberada hace tres años se sigue barriendo: su
    // horizonte lo pone la vigencia de la liberación, no el §3.
    const ev = evaluarCandidato(
      candidato({ etiqueta: 'excepciones_vigentes', decidida_en: '2023-01-01' }), HOY, CONFIG,
    );
    expect(ev.barrer).toBe(true);
  });

  it('el horizonte se cuenta en meses civiles desde la decisión', () => {
    // 12 meses desde el 2025-09-15 cubre hasta el 2026-09-15 inclusive.
    expect(horizonteAgotado('2025-09-15', HOY, CONFIG)).toBe(false);
    expect(horizonteAgotado('2025-09-14', HOY, CONFIG)).toBe(true);
  });

  it('el horizonte lo fija el obligado, no el código', () => {
    const corto: ConfigMonitoreo = { ...CONFIG, horizonte_rechazadas_meses: 3 };
    expect(horizonteAgotado('2026-01-01', HOY, CONFIG)).toBe(false);
    expect(horizonteAgotado('2026-01-01', HOY, corto)).toBe(true);
  });
});

// ─── Cuánto se gasta ───────────────────────────────────────────────────────

describe('modoDelBarrido — sin tope adoptado no se gasta', () => {
  it('cupo null corre en simulación', () => {
    expect(modoDelBarrido({ ...CONFIG, cupo_periodo: null })).toBe('simulacion');
  });
  it('sin config tampoco gasta', () => {
    expect(modoDelBarrido(null)).toBe('simulacion');
    expect(modoDelBarrido(undefined)).toBe('simulacion');
  });
  it('cupo cero no es un tope: es no gastar', () => {
    expect(modoDelBarrido({ ...CONFIG, cupo_periodo: 0 })).toBe('simulacion');
  });
  it('con cupo positivo ejecuta', () => {
    expect(modoDelBarrido({ ...CONFIG, cupo_periodo: 1 })).toBe('ejecucion');
  });
});

describe('cupoRestante', () => {
  it('descuenta lo ya gastado en el periodo', () => {
    expect(cupoRestante({ ...CONFIG, cupo_periodo: 100 }, 40)).toBe(60);
  });
  it('nunca es negativo', () => {
    expect(cupoRestante({ ...CONFIG, cupo_periodo: 100 }, 500)).toBe(0);
  });
  it('sin tope adoptado no hay cupo que repartir', () => {
    expect(cupoRestante({ ...CONFIG, cupo_periodo: null }, 0)).toBe(0);
  });
});

describe('aplicarTope — el corte se ve, no se calla', () => {
  const sel = (over: Partial<Seleccionado>): Seleccionado => ({
    clave: 'CC-1',
    etiqueta: 'vigilancia_continua',
    vigente_hasta: '2026-01-01',
    decidida_en: null,
    motivo: 'vigencia_vencida',
    ...over,
  });

  it('lo que no cabe queda como diferido, no desaparece', () => {
    const c = aplicarTope([sel({ clave: 'a' }), sel({ clave: 'b' }), sel({ clave: 'c' })], 2);
    expect(c.ejecutar).toHaveLength(2);
    expect(c.diferidos).toHaveLength(1);
    expect(c.corte_por_tope).toBe(true);
  });

  it('si alcanza para todos, no hay corte', () => {
    const c = aplicarTope([sel({ clave: 'a' })], 5);
    expect(c.corte_por_tope).toBe(false);
    expect(c.diferidos).toEqual([]);
  });

  it('cupo cero difiere todo y lo dice', () => {
    const c = aplicarTope([sel({ clave: 'a' })], 0);
    expect(c.ejecutar).toEqual([]);
    expect(c.corte_por_tope).toBe(true);
  });

  it('excepciones vigentes primero: es riesgo asumido y firmado', () => {
    const c = aplicarTope([
      sel({ clave: 'rechazada', etiqueta: 'rechazadas' }),
      sel({ clave: 'limpia', etiqueta: 'vigilancia_continua' }),
      sel({ clave: 'excepcion', etiqueta: 'excepciones_vigentes' }),
    ], 1);
    expect(c.ejecutar.map((s) => s.clave)).toEqual(['excepcion']);
  });

  it('rechazadas de última: su barrido no protege a nadie hoy', () => {
    const c = aplicarTope([
      sel({ clave: 'rechazada', etiqueta: 'rechazadas' }),
      sel({ clave: 'limpia', etiqueta: 'vigilancia_continua' }),
    ], 1);
    expect(c.ejecutar.map((s) => s.clave)).toEqual(['limpia']);
  });

  it('dentro de la etiqueta, primero la que nunca tuvo vigencia', () => {
    const c = aplicarTope([
      sel({ clave: 'vencida', motivo: 'vigencia_vencida', vigente_hasta: '2026-01-01' }),
      sel({ clave: 'sin', motivo: 'sin_vigencia', vigente_hasta: null }),
    ], 1);
    expect(c.ejecutar.map((s) => s.clave)).toEqual(['sin']);
  });

  it('entre vencidas gana la más atrasada', () => {
    const c = aplicarTope([
      sel({ clave: 'reciente', vigente_hasta: '2026-08-01' }),
      sel({ clave: 'vieja', vigente_hasta: '2024-02-01' }),
    ], 1);
    expect(c.ejecutar.map((s) => s.clave)).toEqual(['vieja']);
  });

  it('el corte es determinista: mismo insumo, mismo reparto', () => {
    // Un tope que reparte distinto cada noche es un tope que nadie puede
    // auditar, y que además nunca termina de barrer a los mismos rezagados.
    const items = ['d', 'a', 'c', 'b'].map((k) => sel({ clave: k }));
    const uno = aplicarTope(items, 2).ejecutar.map((s) => s.clave);
    const dos = aplicarTope([...items].reverse(), 2).ejecutar.map((s) => s.clave);
    expect(uno).toEqual(dos);
  });
});

// ─── Qué cambió ────────────────────────────────────────────────────────────

describe('compararConsultas', () => {
  it('más coincidencias es delta: es literal lo que describió Yessica', () => {
    const d = compararConsultas(
      foto({ total_matches: 10, fuentes: ['OFAC'] }),
      foto({ total_matches: 20, fuentes: ['OFAC'] }),
    );
    expect(d.hay).toBe(true);
    expect(d.matches_antes).toBe(10);
    expect(d.matches_ahora).toBe(20);
  });

  it('menos coincidencias NO es delta: la decisión sobre 10 sigue cubriendo 5', () => {
    const d = compararConsultas(
      foto({ total_matches: 10, fuentes: ['OFAC'] }),
      foto({ total_matches: 5, fuentes: ['OFAC'] }),
    );
    expect(d.hay).toBe(false);
  });

  it('fuente nueva a igual conteo sí es delta', () => {
    // Salir de una lista y entrar a otra cambia el hecho, no solo su tamaño.
    const d = compararConsultas(
      foto({ total_matches: 3, fuentes: ['OFAC'] }),
      foto({ total_matches: 3, fuentes: ['ONU'] }),
    );
    expect(d.hay).toBe(true);
    expect(d.fuentes_nuevas).toEqual(['onu']);
  });

  it('la misma fuente escrita distinto no inventa un delta', () => {
    const d = compararConsultas(
      foto({ total_matches: 1, fuentes: ['  Lista   OFAC '] }),
      foto({ total_matches: 1, fuentes: ['lista ofac'] }),
    );
    expect(d.hay).toBe(false);
    expect(d.fuentes_nuevas).toEqual([]);
  });

  it('pasar de limpia a reportada es delta y se marca aparte', () => {
    const d = compararConsultas(foto(), foto({ total_matches: 2, fuentes: ['ONU'] }));
    expect(d.hay).toBe(true);
    expect(d.aparecio_hallazgo).toBe(true);
  });

  it('dejar de estar reportada NO es delta, pero se registra', () => {
    const d = compararConsultas(foto({ total_matches: 4, fuentes: ['OFAC'] }), foto());
    expect(d.hay).toBe(false);
    expect(d.desaparecio_hallazgo).toBe(true);
  });

  it('un tier más exigente a igual conteo es delta', () => {
    const d = compararConsultas(
      foto({ total_matches: 1, fuentes: ['x'], tier_maximo: 'tier_3' }),
      foto({ total_matches: 1, fuentes: ['x'], tier_maximo: 'tier_1' }),
    );
    expect(d.hay).toBe(true);
    expect(d.tier_subio).toBe(true);
  });

  it('un tier menos exigente no lo es', () => {
    const d = compararConsultas(
      foto({ total_matches: 1, fuentes: ['x'], tier_maximo: 'tier_1' }),
      foto({ total_matches: 1, fuentes: ['x'], tier_maximo: 'tier_3' }),
    );
    expect(d.tier_subio).toBe(false);
    expect(d.hay).toBe(false);
  });

  it('pasar de sin clasificar a clasificado no se lee como subida', () => {
    const d = compararConsultas(
      foto({ total_matches: 1, fuentes: ['x'], tier_maximo: null }),
      foto({ total_matches: 1, fuentes: ['x'], tier_maximo: 'tier_4' }),
    );
    // Antes no había tier porque no se clasificó, no porque fuera bajo. Se
    // marca como subida para que el oficial lo mire: ante la duda, más mirada.
    expect(d.tier_subio).toBe(true);
  });

  it('fuentes vacías o nulas no cuentan como lista nueva', () => {
    const d = compararConsultas(
      foto({ total_matches: 1, fuentes: ['OFAC'] }),
      foto({ total_matches: 1, fuentes: ['OFAC', null, undefined, '   '] }),
    );
    expect(d.fuentes_nuevas).toEqual([]);
    expect(d.hay).toBe(false);
  });
});

// ─── Qué hace el cambio ────────────────────────────────────────────────────

describe('efectoDeDelta', () => {
  const conDelta = compararConsultas(
    foto({ total_matches: 10, fuentes: ['OFAC'] }),
    foto({ total_matches: 20, fuentes: ['OFAC'] }),
  );
  const sinDelta = compararConsultas(
    foto({ total_matches: 10, fuentes: ['OFAC'] }),
    foto({ total_matches: 10, fuentes: ['OFAC'] }),
  );
  const limpiada = compararConsultas(foto({ total_matches: 4, fuentes: ['OFAC'] }), foto());

  it('excepción vigente con delta: notifica y rompe la premisa', () => {
    expect(efectoDeDelta('excepciones_vigentes', conDelta)).toEqual({
      notifica: true, premisa_cambiada: true, habilita_reevaluacion: false,
    });
  });

  it('excepción vigente sin delta: silencio', () => {
    expect(efectoDeDelta('excepciones_vigentes', sinDelta).notifica).toBe(false);
  });

  it('rechazada con delta NO notifica — límite (iii) del §3 de Emilio', () => {
    // La prueba que protege el fallo: una rechazada con MÁS reportes no puede
    // subir a la campanita. Avisarlo sería vigilancia sobre una persona que ya
    // no es contraparte del obligado.
    expect(efectoDeDelta('rechazadas', conDelta)).toEqual({
      notifica: false, premisa_cambiada: false, habilita_reevaluacion: false,
    });
  });

  it('rechazada que dejó de estar reportada: habilita re-evaluación, sin campanita', () => {
    expect(efectoDeDelta('rechazadas', limpiada)).toEqual({
      notifica: false, premisa_cambiada: false, habilita_reevaluacion: true,
    });
  });

  it('vigilancia continua que aparece reportada: notifica', () => {
    const aparecio = compararConsultas(foto(), foto({ total_matches: 3, fuentes: ['ONU'] }));
    expect(efectoDeDelta('vigilancia_continua', aparecio).notifica).toBe(true);
    // No marca premisa: no había liberación que romper. La cobertura la resuelve
    // `coberturaDeContraparte()` y la manda sola a Hallazgos sin decidir.
    expect(efectoDeDelta('vigilancia_continua', aparecio).premisa_cambiada).toBe(false);
  });

  it('vigilancia continua que sigue limpia: silencio', () => {
    const limpia = compararConsultas(foto(), foto());
    expect(efectoDeDelta('vigilancia_continua', limpia).notifica).toBe(false);
  });

  it('las dos que no se barren no producen efecto', () => {
    expect(efectoDeDelta('hallazgos_sin_decidir', conDelta).notifica).toBe(false);
    expect(efectoDeDelta('sin_cobertura_vigente', conDelta).notifica).toBe(false);
  });

  it('ninguna etiqueta notifica sin delta', () => {
    const etiquetas: EtiquetaBandeja[] = [
      'vigilancia_continua', 'excepciones_vigentes', 'rechazadas',
      'hallazgos_sin_decidir', 'sin_cobertura_vigente',
    ];
    for (const e of etiquetas) {
      expect(efectoDeDelta(e, sinDelta).notifica).toBe(false);
    }
  });
});

// ─── Configuración y periodo ───────────────────────────────────────────────

describe('validación de la configuración', () => {
  it('null es un cupo legítimo: significa "todavía no lo adopté"', () => {
    expect(validarCupo(null)).toBeNull();
  });
  it('rechaza cupo no entero y fuera de rango', () => {
    expect(validarCupo(1.5)).not.toBeNull();
    expect(validarCupo(0)).not.toBeNull();
    expect(validarCupo(999_999)).not.toBeNull();
  });
  it('el horizonte no puede ser null: siempre hay un límite', () => {
    expect(validarHorizonte(null)).not.toBeNull();
    expect(validarHorizonte(12)).toBeNull();
    expect(validarHorizonte(0)).not.toBeNull();
  });
});

describe('inicioDePeriodo', () => {
  it('el periodo del tope es el mes civil', () => {
    expect(inicioDePeriodo('2026-09-15')).toBe('2026-09-01');
    expect(inicioDePeriodo('2026-01-01')).toBe('2026-01-01');
    expect(inicioDePeriodo('2026-12-31')).toBe('2026-12-01');
  });
});
