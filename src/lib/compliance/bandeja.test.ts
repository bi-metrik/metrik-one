/**
 * Las cinco etiquetas de la bandeja del oficial (dictamen Lucía 2026-08-24).
 *
 * Por qué tiene pruebas propias: la etiqueta decide qué ve el oficial como
 * urgente. Si "Sin cobertura vigente" se cuela dentro de "Hallazgos sin
 * decidir", la contraparte que está operando con el permiso caducado se pierde
 * dentro de una cola de trabajo y nadie la ve — y ese es el único estado donde
 * la empresa está expuesta sin que nadie lo haya decidido así.
 *
 * VERIFICADO POR MUTACIÓN (2026-08-31), contra este archivo + el de la server
 * action. Cada mutación tumbó pruebas:
 *   - mapear 'vencida' a 'hallazgos_sin_decidir' (el corte viejo del tablero) → caen 6
 *   - ignorar si hay hallazgo y mirar solo la cobertura → caen 6
 *   - mapear 'rechazada' a 'sin_cobertura_vigente' → caen 5
 *   - invertir `exigeAccion` (y con ella `consumeCuotaDeReconsulta`) → caen 4
 *   - volver a `Math.floor` en el día juliano → caen 2
 *
 * El `floor` NO es hipotético: así se escribió primero, y el barrido contra
 * `Date.UTC` de más abajo fue lo que lo destapó.
 */

import { describe, it, expect } from 'vitest';
import {
  ETIQUETAS,
  ETIQUETAS_ORDENADAS,
  calcularIndicadores,
  consumeCuotaDeReconsulta,
  diasEntreISO,
  etiquetaDeContraparte,
  exigeAccion,
  type EtiquetaBandeja,
} from './bandeja';
import type { MotivoCobertura } from './liberaciones';

const HOY = '2026-08-31';

// ─── La tabla del dictamen, celda por celda ────────────────────────────────

describe('etiquetaDeContraparte — la tabla completa', () => {
  const conHallazgo: Array<[MotivoCobertura, EtiquetaBandeja]> = [
    ['vigente', 'excepciones_vigentes'],
    ['rechazada', 'rechazadas'],
    ['sin_registro', 'hallazgos_sin_decidir'],
    ['vencida', 'sin_cobertura_vigente'],
  ];

  it.each(conHallazgo)('con hallazgo + cobertura %s -> %s', (motivo, esperada) => {
    expect(etiquetaDeContraparte(true, motivo)).toBe(esperada);
  });

  const motivos: MotivoCobertura[] = ['vigente', 'rechazada', 'sin_registro', 'vencida'];
  it.each(motivos)('sin hallazgo la cobertura no se mira (%s)', (motivo) => {
    expect(etiquetaDeContraparte(false, motivo)).toBe('vigilancia_continua');
  });

  // El caso que motiva todo: una contraparte limpia hoy que alguna vez fue
  // liberada NO es una excepción vigente. Contarla como tal infla la lista de
  // riesgo asumido con casos que ya no lo son.
  it('liberada pero hoy sin hallazgo no cuenta como excepción', () => {
    expect(etiquetaDeContraparte(false, 'vigente')).toBe('vigilancia_continua');
  });
});

// ─── El corte que el tablero viejo no hacía ────────────────────────────────

describe('las tres que el corte viejo metía en el mismo cajón', () => {
  // `pendientes` = todo lo no cubierto. Tres situaciones distintas juntas.
  it('sin_registro, vencida y rechazada dan tres etiquetas distintas', () => {
    const etiquetas = new Set([
      etiquetaDeContraparte(true, 'sin_registro'),
      etiquetaDeContraparte(true, 'vencida'),
      etiquetaDeContraparte(true, 'rechazada'),
    ]);
    expect(etiquetas.size).toBe(3);
  });

  it('la vencida es alarma, no cola de trabajo', () => {
    const e = etiquetaDeContraparte(true, 'vencida');
    expect(ETIQUETAS[e].naturaleza).toBe('alarma');
    expect(ETIQUETAS[e].orden).toBe(0);
  });

  it('la rechazada es un caso cerrado: no pide acción', () => {
    expect(exigeAccion(etiquetaDeContraparte(true, 'rechazada'))).toBe(false);
  });
});

describe('naturaleza — solo dos de las cinco piden acción', () => {
  it('exactamente dos exigen acción humana', () => {
    const conAccion = ETIQUETAS_ORDENADAS.filter((d) => exigeAccion(d.etiqueta));
    expect(conAccion.map((d) => d.etiqueta)).toEqual([
      'sin_cobertura_vigente',
      'hallazgos_sin_decidir',
    ]);
  });

  it('la alarma va primero en pantalla', () => {
    expect(ETIQUETAS_ORDENADAS[0].etiqueta).toBe('sin_cobertura_vigente');
  });
});

// ─── La regla de costo ─────────────────────────────────────────────────────

describe('consumeCuotaDeReconsulta — el represamiento no se paga en factura', () => {
  it('las que exigen acción NO se re-consultan', () => {
    expect(consumeCuotaDeReconsulta('hallazgos_sin_decidir')).toBe(false);
    expect(consumeCuotaDeReconsulta('sin_cobertura_vigente')).toBe(false);
  });

  it('las tres de reposo sí se re-consultan', () => {
    expect(consumeCuotaDeReconsulta('vigilancia_continua')).toBe(true);
    expect(consumeCuotaDeReconsulta('excepciones_vigentes')).toBe(true);
    expect(consumeCuotaDeReconsulta('rechazadas')).toBe(true);
  });
});

// ─── Antigüedad ────────────────────────────────────────────────────────────

describe('diasEntreISO — días de calendario, sin Date', () => {
  it('cuenta días completos', () => {
    expect(diasEntreISO('2026-08-01', '2026-08-31')).toBe(30);
  });

  it('mismo día es cero', () => {
    expect(diasEntreISO('2026-08-31', '2026-08-31')).toBe(0);
  });

  // Con `new Date(iso)` esto se calcula en UTC y en Bogotá se corre un día.
  it('cruza fin de año sin correrse', () => {
    expect(diasEntreISO('2025-12-31', '2026-01-01')).toBe(1);
  });

  it('cruza año bisiesto', () => {
    expect(diasEntreISO('2024-02-28', '2024-03-01')).toBe(2);
  });

  // Barrido contra un oráculo independiente. `Date.UTC` sí es seguro para
  // fechas civiles (no interpreta zona), a diferencia de `new Date(iso)`.
  // Este barrido es el que habría atrapado de entrada el `floor` por `trunc`:
  // el desfase solo aparece de marzo en adelante y solo al cruzar de mes.
  it('coincide con la aritmética UTC en 3 años día a día', () => {
    const inicio = Date.UTC(2024, 0, 1);
    const base = '2024-01-01';
    for (let d = 0; d < 1100; d++) {
      const t = new Date(inicio + d * 86400000);
      const iso = t.toISOString().slice(0, 10);
      expect(diasEntreISO(base, iso)).toBe(d);
    }
  });

  it('rechaza una fecha ilegible en vez de devolver NaN', () => {
    expect(() => diasEntreISO('ayer', HOY)).toThrow(/fecha_invalida/);
  });
});

// ─── Indicadores ───────────────────────────────────────────────────────────

describe('calcularIndicadores', () => {
  it('toma la antigüedad del hallazgo MÁS viejo, no del último', () => {
    const r = calcularIndicadores(
      ['2026-08-29T10:00:00.000Z', '2026-06-01T10:00:00.000Z', '2026-08-30T10:00:00.000Z'],
      0,
      HOY,
    );
    expect(r.antiguedad_max_sin_decidir_dias).toBe(91);
  });

  // Sin cola no hay represamiento: null dice "no aplica", cero diría "hay uno de hoy".
  it('sin hallazgos represados el indicador es null, no cero', () => {
    expect(calcularIndicadores([], 0, HOY).antiguedad_max_sin_decidir_dias).toBeNull();
  });

  it('pasa el conteo de expuestas tal cual', () => {
    expect(calcularIndicadores([], 3, HOY).sin_cobertura_vigente).toBe(3);
  });
});
