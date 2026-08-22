import { describe, it, expect } from 'vitest'
import { computeRanking } from './comercial-ranking'
import type { ComercialResumenRow } from './comercial-types'

/**
 * Los nombres y las cifras son los del workspace SOENA medidos el 2026-08-10, para que
 * la prueba falle si alguien vuelve a meter a quien lidera dentro de la competencia.
 */
function fila(p: Partial<ComercialResumenRow> & { nombre: string }): ComercialResumenRow {
  return {
    responsable_id: p.responsable_id ?? p.nombre.toLowerCase().replace(/\s/g, '-'),
    nombre: p.nombre,
    position: p.position ?? null,
    es_lider: p.es_lider ?? false,
    sin_responsable: p.sin_responsable ?? false,
    negocios_total: p.negocios_total ?? 0,
    negocios_abiertos: p.negocios_abiertos ?? 0,
    en_venta: 0,
    en_ejecucion: 0,
    en_cobro: 0,
    cerrados: 0,
    num_ventas: p.num_ventas ?? 0,
    // Por defecto, todas las ventas bonifican: asi las pruebas viejas siguen midiendo
    // lo que median (el orden por ventas) y las nuevas declaran su propio escenario.
    num_bonificables: p.num_bonificables === undefined ? (p.num_ventas ?? 0) : p.num_bonificables,
    valor_aprobado: p.valor_aprobado ?? 0,
    valor_aprobado_con_iva: p.valor_aprobado_con_iva ?? 0,
    honorario_recaudado: p.honorario_recaudado ?? 0,
    tarifa_recaudada: 0,
  }
}

const RESUMEN: ComercialResumenRow[] = [
  fila({ nombre: 'Jessica Tejada', num_ventas: 40, negocios_total: 144, negocios_abiertos: 141 }),
  fila({ nombre: 'Jenny Cepeda', num_ventas: 12, negocios_total: 39, negocios_abiertos: 33 }),
  fila({ nombre: 'Daniela Jativa', es_lider: true, position: 'Supervisor Comercial', num_ventas: 30, negocios_total: 35, negocios_abiertos: 34 }),
  fila({ nombre: 'Esperanza Verdugo', num_ventas: 6, negocios_total: 21, negocios_abiertos: 19 }),
  fila({ nombre: 'Juan Bruce', es_lider: true, position: 'Founder', num_ventas: 3, negocios_total: 6, negocios_abiertos: 6 }),
  fila({ nombre: '(sin responsable)', responsable_id: null, sin_responsable: true, negocios_total: 9, negocios_abiertos: 6 }),
]

describe('computeRanking', () => {
  it('deja fuera del ranking a quien lidera el equipo', () => {
    const r = computeRanking(RESUMEN)
    expect(r.personas.map(p => p.nombre)).toEqual(['Jessica Tejada', 'Jenny Cepeda', 'Esperanza Verdugo'])
    expect(r.total).toBe(3)
  })

  it('devuelve a los lideres aparte, no los desaparece', () => {
    // Ocultarlos del todo dejaria 41 negocios sin explicacion en la suma del equipo.
    const r = computeRanking(RESUMEN)
    expect(r.lideres.map(l => l.nombre).sort()).toEqual(['Daniela Jativa', 'Juan Bruce'])
  })

  it('un lider con muchas ventas NO desplaza a nadie del podio', () => {
    // Daniela tiene 30 ventas: si entrara al ranking seria segunda y correria a todos.
    const r = computeRanking(RESUMEN)
    const jenny = r.personas.find(p => p.nombre === 'Jenny Cepeda')!
    expect(jenny.rank_ventas).toBe(2)
    expect(r.personas.find(p => p.nombre === 'Jessica Tejada')!.rank_ventas).toBe(1)
  })

  it('el bucket sin responsable sigue fuera del ranking y aparte de los lideres', () => {
    const r = computeRanking(RESUMEN)
    expect(r.sinResponsable?.negocios_total).toBe(9)
    expect(r.lideres.some(l => l.sin_responsable)).toBe(false)
  })

  it('el cumplimiento de meta se calcula solo sobre quienes compiten', () => {
    const metas = new Map<string, number | null>([
      ['jessica-tejada', 20],
      ['daniela-jativa', 10], // meta de la lider: no debe producir fila de ranking
    ])
    const r = computeRanking(RESUMEN, metas)
    expect(r.personas.find(p => p.nombre === 'Jessica Tejada')!.pct_cumplimiento).toBe(200)
    expect(r.personas.some(p => p.nombre === 'Daniela Jativa')).toBe(false)
  })

  it('sin lideres en el resumen, se comporta como antes', () => {
    const soloEjecutores = RESUMEN.filter(r => !r.es_lider)
    const r = computeRanking(soloEjecutores)
    expect(r.lideres).toEqual([])
    expect(r.total).toBe(3)
  })
})

// ── Punto #31: el ranking premia la venta COMPLETA, no el primer pago ───────────
describe('computeRanking · metrica primaria = ventas bonificables', () => {
  // Quien mas cobro anticipos no es quien mas casos saco adelante. Este escenario
  // los separa a proposito: por ventas el orden seria A, B, C; por bonificables, C, B, A.
  const CRUZADO: ComercialResumenRow[] = [
    fila({ nombre: 'A cobra y no avanza', num_ventas: 30, num_bonificables: 2 }),
    fila({ nombre: 'B intermedia', num_ventas: 20, num_bonificables: 10 }),
    fila({ nombre: 'C saca adelante', num_ventas: 10, num_bonificables: 9 }),
  ]

  it('ordena por bonificables, no por ventas', () => {
    const r = computeRanking(CRUZADO)
    expect(r.personas.map(p => p.nombre)).toEqual([
      'B intermedia', 'C saca adelante', 'A cobra y no avanza',
    ])
    expect(r.personas.map(p => p.rank_bonificables)).toEqual([1, 2, 3])
  })

  it('conserva el ranking por ventas como columna aparte', () => {
    // Las tres definiciones conviven: quitar num_ventas seria cambiar la #12, que NO
    // se toco. La pantalla tiene que poder decir cual esta mirando.
    const r = computeRanking(CRUZADO)
    const a = r.personas.find(p => p.nombre === 'A cobra y no avanza')!
    expect(a.rank_ventas).toBe(1)
    expect(a.rank_bonificables).toBe(3)
  })

  it('empates en bonificables comparten posicion', () => {
    const r = computeRanking([
      fila({ nombre: 'X', num_ventas: 9, num_bonificables: 5 }),
      fila({ nombre: 'Y', num_ventas: 3, num_bonificables: 5 }),
      fila({ nombre: 'Z', num_ventas: 1, num_bonificables: 1 }),
    ])
    expect(r.personas.map(p => p.rank_bonificables)).toEqual([1, 1, 3])
  })

  it('quien NO se pudo medir queda FUERA del ranking, no de ultimo con cero', () => {
    // Sin dato no es cero: si `null` se tratara como 0, esta persona caeria al fondo
    // por una medicion que nadie hizo, y su bono se leeria como un desempeno malo.
    const r = computeRanking([
      fila({ nombre: 'Medida alta', num_ventas: 4, num_bonificables: 4 }),
      fila({ nombre: 'Sin umbral', num_ventas: 12, num_bonificables: null }),
      fila({ nombre: 'Medida baja', num_ventas: 1, num_bonificables: 1 }),
    ])
    const sinUmbral = r.personas.find(p => p.nombre === 'Sin umbral')!
    expect(sinUmbral.num_bonificables).toBeNull()
    expect(sinUmbral.rank_bonificables).toBe(0)
    // Las medibles conservan posiciones consecutivas: la no medida no ocupa un puesto.
    expect(r.personas.find(p => p.nombre === 'Medida alta')!.rank_bonificables).toBe(1)
    expect(r.personas.find(p => p.nombre === 'Medida baja')!.rank_bonificables).toBe(2)
    // Y va al final de la lista, no al frente por tener 12 ventas.
    expect(r.personas[r.personas.length - 1].nombre).toBe('Sin umbral')
  })

  it('con TODAS sin medir, el orden cae a las ventas y nadie tiene posicion', () => {
    const r = computeRanking([
      fila({ nombre: 'P', num_ventas: 2, num_bonificables: null }),
      fila({ nombre: 'Q', num_ventas: 7, num_bonificables: null }),
    ])
    expect(r.personas.map(p => p.nombre)).toEqual(['Q', 'P'])
    expect(r.personas.every(p => p.rank_bonificables === 0)).toBe(true)
  })
})
