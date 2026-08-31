/**
 * R2 — periodicidad de revalidación.
 *
 * Lo que estas pruebas cuidan: la vigencia decide cuándo una contraparte vuelve
 * a mirarse. Si se calcula larga de más, la empresa queda sin vigilar a alguien
 * que su propia política decía revisar; si se calcula corta de más, el motor de
 * R3 gasta cuota facturable de AFI sin razón.
 *
 * La regla que más importa es que gana el nivel MÁS EXIGENTE presente, no el
 * tier máximo. La diferencia solo aparece cuando la configuración del cliente no
 * sigue el mismo orden que la precedencia jurídica, que es un caso que el
 * software no puede impedir porque los meses los pone el oficial.
 *
 * VERIFICADO POR MUTACIÓN (2026-08-31) — cada mutación tumbó pruebas:
 *   - tomar el máximo de meses en vez del mínimo → caen 4
 *   - leer solo `tiersPresentes[0]` en vez de todos → caen 3
 *   - ignorar `catalogoOpera` → cae 1
 *   - `vigenteHasta <= hoy` en vez de `<` para 'vencida' → cae 1
 *   - aplanar `sin_vigencia` contra `vencida` → cae 1
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SUGERIDO,
  NIVELES,
  calcularVigencia,
  esNivel,
  estadoDeVigencia,
  sumarDiasISO,
  validarMeses,
  type ConfigPeriodicidad,
} from './periodicidad';

const HOY = '2026-08-31';
const CONFIG: ConfigPeriodicidad = DEFAULT_SUGERIDO;

// ─── El cuadro de la oficial de cumplimiento ───────────────────────────────

describe('calcularVigencia — el cuadro que dictó Yessica', () => {
  it('sin coincidencias revalida a 12 meses', () => {
    const v = calcularVigencia(HOY, [], CONFIG, true);
    expect(v.nivel).toBe('sin_hallazgo');
    expect(v.meses).toBe(12);
    expect(v.vigente_hasta).toBe('2027-08-31');
  });

  it('una lista vinculante revalida a 3 meses', () => {
    const v = calcularVigencia(HOY, ['tier_1'], CONFIG, true);
    expect(v.meses).toBe(3);
    expect(v.vigente_hasta).toBe('2026-11-30');
  });

  it('un PEP revalida a 6 meses', () => {
    expect(calcularVigencia(HOY, ['tier_3'], CONFIG, true).meses).toBe(6);
  });

  it('una mención de prensa sola revalida a 12 meses', () => {
    expect(calcularVigencia(HOY, ['medios'], CONFIG, true).meses).toBe(12);
  });
});

// ─── Gana el más exigente, no el tier máximo ───────────────────────────────

describe('gana el nivel más exigente presente', () => {
  it('con tier_1 y medios juntos manda el tier_1', () => {
    const v = calcularVigencia(HOY, ['tier_1', 'medios'], CONFIG, true);
    expect(v.nivel).toBe('tier_1');
    expect(v.meses).toBe(3);
  });

  // El caso que separa "más exigente" de "tier máximo": si el oficial configura
  // medios más corto que una sanción extranjera, manda medios. La regla no
  // depende de que su configuración siga la precedencia jurídica.
  it('si el oficial pone medios más corto que tier_2, manda medios', () => {
    const rara: ConfigPeriodicidad = { ...DEFAULT_SUGERIDO, medios: 1, tier_2: 6 };
    const v = calcularVigencia(HOY, ['tier_2', 'medios'], rara, true);
    expect(v.nivel).toBe('medios');
    expect(v.meses).toBe(1);
  });

  it('mira todos los tiers presentes, no solo el primero', () => {
    const v = calcularVigencia(HOY, ['medios', 'tier_4', 'tier_1'], CONFIG, true);
    expect(v.meses).toBe(3);
  });
});

// ─── Las dos formas de duda caen del lado exigente ─────────────────────────

describe('ante la duda, la frecuencia más corta', () => {
  it('una fuente sin clasificar revalida con el default más corto', () => {
    expect(calcularVigencia(HOY, ['sin_clasificar'], CONFIG, true).meses).toBe(3);
  });

  // C2 del concepto de Emilio: sin firma jurídica no sabemos con qué autoridad
  // clasificamos, así que la vigencia se calcula con el nivel más corto de toda
  // la configuración, sea cual sea el tier que salió.
  it('con el catálogo sin firmar, hasta una consulta limpia va a la más corta', () => {
    const v = calcularVigencia(HOY, [], CONFIG, false);
    expect(v.meses).toBe(3);
  });

  // No se deja sin vigencia: eso sacaría a la contraparte del barrido, que es lo
  // contrario de lo que exige la duda.
  it('el catálogo sin firmar nunca deja la consulta sin vigencia', () => {
    expect(calcularVigencia(HOY, ['medios'], CONFIG, false).vigente_hasta).not.toBeNull();
  });
});

// ─── Configuración incompleta ──────────────────────────────────────────────

describe('configuración incompleta', () => {
  it('sin nada configurado no inventa una vigencia', () => {
    const v = calcularVigencia(HOY, ['tier_1'], {}, true);
    expect(v).toEqual({ vigente_hasta: null, meses: null, nivel: null });
  });

  it('con solo algunos niveles usa los que hay', () => {
    const v = calcularVigencia(HOY, ['tier_1', 'medios'], { medios: 9 }, true);
    expect(v.nivel).toBe('medios');
    expect(v.meses).toBe(9);
  });
});

// ─── Aritmética de fechas ──────────────────────────────────────────────────

describe('la vigencia se cuenta en calendario', () => {
  it('31 de enero más 1 mes se topa en el último día de febrero', () => {
    expect(calcularVigencia('2026-01-31', [], { sin_hallazgo: 1 }, true).vigente_hasta)
      .toBe('2026-02-28');
  });

  it('cruza el año', () => {
    expect(calcularVigencia('2026-11-30', [], { sin_hallazgo: 3 }, true).vigente_hasta)
      .toBe('2027-02-28');
  });
});

describe('sumarDiasISO — sin Date', () => {
  it('suma dentro del mes', () => {
    expect(sumarDiasISO('2026-08-01', 30)).toBe('2026-08-31');
  });

  it('cruza de mes', () => {
    expect(sumarDiasISO('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('cruza de año', () => {
    expect(sumarDiasISO('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('cruza febrero bisiesto', () => {
    expect(sumarDiasISO('2024-02-28', 2)).toBe('2024-03-01');
  });

  it('cruza febrero no bisiesto', () => {
    expect(sumarDiasISO('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('coincide con la aritmética UTC en 800 días', () => {
    const inicio = Date.UTC(2026, 0, 1);
    for (let d = 0; d < 800; d++) {
      const iso = new Date(inicio + d * 86400000).toISOString().slice(0, 10);
      expect(sumarDiasISO('2026-01-01', d)).toBe(iso);
    }
  });

  it('rechaza una fecha ilegible', () => {
    expect(() => sumarDiasISO('mañana', 1)).toThrow(/fecha_invalida/);
  });
});

// ─── Estado de vigencia ────────────────────────────────────────────────────

describe('estadoDeVigencia', () => {
  it('el último día todavía cubre', () => {
    expect(estadoDeVigencia(HOY, HOY)).toBe('por_vencer');
    expect(estadoDeVigencia('2026-08-30', HOY)).toBe('vencida');
  });

  it('dentro de los 30 días de aviso es por vencer', () => {
    expect(estadoDeVigencia('2026-09-15', HOY)).toBe('por_vencer');
    expect(estadoDeVigencia('2026-09-30', HOY)).toBe('por_vencer');
  });

  it('más allá del aviso es vigente', () => {
    expect(estadoDeVigencia('2026-10-01', HOY)).toBe('vigente');
    expect(estadoDeVigencia('2027-08-31', HOY)).toBe('vigente');
  });

  // Sin vigencia NO es lo mismo que vencida: son las consultas anteriores a R2,
  // que nunca tuvieron fecha. Aplanarlas contra vencidas inflaría la alarma con
  // historia y taparía las que sí vencieron.
  it('sin fecha es sin_vigencia, no vencida', () => {
    expect(estadoDeVigencia(null, HOY)).toBe('sin_vigencia');
    expect(estadoDeVigencia(undefined, HOY)).toBe('sin_vigencia');
  });
});

// ─── Validación ────────────────────────────────────────────────────────────

describe('validarMeses', () => {
  it('acepta un entero en rango, venga como número o como texto', () => {
    expect(validarMeses(6)).toBeNull();
    expect(validarMeses(' 12 ')).toBeNull();
  });

  it('rechaza cero, negativos y el absurdo', () => {
    expect(validarMeses(0)).toContain('minimo');
    expect(validarMeses(-3)).toContain('minimo');
    expect(validarMeses(120)).toContain('maximo');
  });

  it('rechaza decimales y texto', () => {
    expect(validarMeses(1.5)).toBe('meses_no_entero');
    expect(validarMeses('anual')).toBe('meses_no_numerico');
    expect(validarMeses(null)).toBe('meses_no_numerico');
  });
});

describe('vocabulario', () => {
  it('el default sugerido cubre todos los niveles', () => {
    for (const n of NIVELES) expect(typeof DEFAULT_SUGERIDO[n]).toBe('number');
  });

  it('esNivel rechaza lo que no está en el catálogo', () => {
    expect(esNivel('tier_1')).toBe(true);
    expect(esNivel('alto')).toBe(false);
    expect(esNivel(null)).toBe(false);
  });
});
