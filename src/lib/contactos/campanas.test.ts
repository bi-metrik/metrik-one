import { describe, it, expect } from 'vitest'
import { resumenCampanasContacto, ordenarRecientesPrimero, type InteraccionCampana } from './campanas'

/**
 * La primera campaña es el dato con el que se atribuye un cierre. Estas pruebas
 * fijan las decisiones que NO son obvias leyendo el código:
 *
 *  - de dónde sale el nombre y de dónde la fecha (de la MISMA fuente, siempre)
 *  - qué pasa cuando `custom_data.origen` existe pero su `campaign_name` es null
 *  - que el orden lo pone el módulo y no quien llama
 *
 * Casos calcados de producción (workspace SOENA, medidos el 2026-09-02).
 */

function inter(campana: string | null, ocurrida: string | null, creada = '2026-01-01T00:00:00Z'): InteraccionCampana {
  return {
    payload: campana === null ? { field_data: [] } : { campaign_name: campana },
    ocurrida_at: ocurrida,
    created_at: creada,
  }
}

describe('resumenCampanasContacto', () => {
  it('sin interacciones ni origen no hay resumen', () => {
    expect(resumenCampanasContacto([], null)).toBeNull()
  })

  it('interacciones sin campaña no producen resumen', () => {
    // Un lead de WhatsApp o manual no trae `campaign_name`.
    expect(resumenCampanasContacto([inter(null, '2026-08-01T10:00:00Z')], null)).toBeNull()
  })

  it('un solo formulario: primera = última y no se muestran las dos', () => {
    const r = resumenCampanasContacto([inter('CAMPAÑA A', '2026-07-30T09:37:22Z')], null)
    expect(r).not.toBeNull()
    expect(r!.formularios).toBe(1)
    expect(r!.primeraNombre).toBe('CAMPAÑA A')
    expect(r!.primeraFecha).toBe('2026-07-30T09:37:22Z')
    expect(r!.hayVarias).toBe(false)
  })

  it('caso V0329 de producción: origen SIN campaign_name cae a la interacción más vieja', () => {
    // LAURA CATALINA LÓPEZ CALDERON: 2 formularios, y su `custom_data.origen`
    // trae `first_at` con `campaign_name` en null. La primera campaña tiene que
    // salir de la interacción más vieja, con SU fecha — no la de `origen`.
    const origen = { campaign_name: null, first_at: '2026-07-30T09:37:22.000Z' }
    const r = resumenCampanasContacto(
      [
        inter('CLIENTES POTENCIALES AGO 2026 PLUS', '2026-08-20T13:37:25Z'),
        inter('CLIENTES POTENCIALES JUL/AGO 2026', '2026-07-30T09:37:22Z'),
      ],
      origen,
    )
    expect(r!.formularios).toBe(2)
    expect(r!.primeraNombre).toBe('CLIENTES POTENCIALES JUL/AGO 2026')
    expect(r!.primeraFecha).toBe('2026-07-30T09:37:22Z')
    expect(r!.ultimaNombre).toBe('CLIENTES POTENCIALES AGO 2026 PLUS')
    expect(r!.hayVarias).toBe(true)
  })

  it('con origen poblado manda el origen, y la fecha sale de ahí también', () => {
    const r = resumenCampanasContacto(
      [inter('CAMPAÑA POSTERIOR', '2026-08-20T13:00:00Z')],
      { campaign_name: 'CAMPAÑA DEL PRIMER TOQUE', first_at: '2026-02-04T08:00:00Z' },
    )
    expect(r!.primeraNombre).toBe('CAMPAÑA DEL PRIMER TOQUE')
    expect(r!.primeraFecha).toBe('2026-02-04T08:00:00Z')
  })

  it('el origen sirve aunque el contacto ya no tenga interacciones vivas', () => {
    // Todas descartadas o convertidas antes de que se guardara el historial.
    const r = resumenCampanasContacto([], { campaign_name: 'CAMPAÑA VIEJA', first_at: '2026-03-01T00:00:00Z' })
    expect(r!.primeraNombre).toBe('CAMPAÑA VIEJA')
    expect(r!.formularios).toBe(0)
    expect(r!.hayVarias).toBe(false)
  })

  it('el resultado no depende del orden en que llegan las filas', () => {
    const viejas = inter('PRIMERA', '2026-01-10T00:00:00Z')
    const nuevas = inter('ULTIMA', '2026-05-10T00:00:00Z')
    const desc = resumenCampanasContacto([nuevas, viejas], null)
    const asc = resumenCampanasContacto([viejas, nuevas], null)
    expect(asc).toEqual(desc)
    expect(desc!.primeraNombre).toBe('PRIMERA')
    expect(desc!.ultimaNombre).toBe('ULTIMA')
  })

  it('una campaña en blanco cuenta como ausente', () => {
    expect(resumenCampanasContacto([inter('   ', '2026-01-01T00:00:00Z')], null)).toBeNull()
    expect(resumenCampanasContacto([], { campaign_name: '  ', first_at: '2026-01-01T00:00:00Z' })).toBeNull()
  })
})

describe('ordenarRecientesPrimero', () => {
  it('deja las filas sin ocurrida_at al final y desempata por created_at', () => {
    const sinFecha = inter('C', null, '2026-06-01T00:00:00Z')
    const media = inter('B', '2026-04-01T00:00:00Z')
    const nueva = inter('A', '2026-09-01T00:00:00Z')
    const orden = ordenarRecientesPrimero([media, sinFecha, nueva])
    expect(orden.map((i) => i.payload?.campaign_name)).toEqual(['A', 'B', 'C'])
  })

  it('no muta el arreglo que recibe', () => {
    const entrada = [inter('B', '2026-01-01T00:00:00Z'), inter('A', '2026-09-01T00:00:00Z')]
    ordenarRecientesPrimero(entrada)
    expect(entrada[0].payload?.campaign_name).toBe('B')
  })
})
