import { describe, it, expect } from 'vitest'
import { recolectarReferenciasFuente, aplanarDataBloque } from './referencias-fuente'

// La topología real que destapó el defecto (SOENA, etapa Notificación): los tres
// bloques dependen de `via_solicitud`, que se responde en la etapa anterior (Cita)
// y se referencia SOLO por slug. Ninguno declara `source_etapa_orden`.
const NOTIFICACION = [
  { condition: { field: 'via_solicitud', value: 'agenda', source_bloque_slug: 'via_solicitud_cita' } },
  { condition: { field: 'via_solicitud', value: 'pqrs', source_bloque_slug: 'via_solicitud_cita' } },
  {
    condition: { field: 'via_solicitud', value: 'pqrs', source_bloque_slug: 'via_solicitud_cita' },
    fields: [{ auto_fill: { source_bloque_slug: 'fecha_cita_dian', source_etapa_orden: 16 } }],
  },
]

describe('recolectarReferenciasFuente', () => {
  it('recoge el slug de una condición que NO declara orden de etapa', () => {
    const { bloqueSlugs } = recolectarReferenciasFuente(NOTIFICACION)
    expect(bloqueSlugs.has('via_solicitud_cita')).toBe(true)
  })

  it('no inventa órdenes de etapa cuando solo se declaró el slug', () => {
    const { etapaOrdens } = recolectarReferenciasFuente(NOTIFICACION.slice(0, 2))
    expect([...etapaOrdens]).toEqual([])
  })

  it('sigue recogiendo el orden de etapa de la vía legacy', () => {
    const { etapaOrdens } = recolectarReferenciasFuente([
      { condition: { field: 'tipo_persona', value: 'natural', source_etapa_orden: 1 } },
    ])
    expect([...etapaOrdens]).toEqual([1])
  })

  it('recoge ambas formas cuando la referencia declara las dos', () => {
    const { etapaOrdens, bloqueSlugs } = recolectarReferenciasFuente(NOTIFICACION)
    expect([...etapaOrdens]).toEqual([16])
    expect([...bloqueSlugs].sort()).toEqual(['fecha_cita_dian', 'via_solicitud_cita'])
  })

  it('recoge referencias de auto_fill y de lock_when, no solo de condition', () => {
    const { bloqueSlugs } = recolectarReferenciasFuente([
      {
        fields: [
          { auto_fill: { source_bloque_slug: 'factura_venta_vehiculo' } },
          { lock_when: { source_bloque_slug: 'titularidad' } },
        ],
      },
    ])
    expect([...bloqueSlugs].sort()).toEqual(['factura_venta_vehiculo', 'titularidad'])
  })

  it('tolera bloques sin config, sin fields y con referencias nulas', () => {
    const { etapaOrdens, bloqueSlugs } = recolectarReferenciasFuente([
      null,
      undefined,
      {},
      { condition: null, fields: null },
      { fields: [{ auto_fill: null, lock_when: null }] },
    ])
    expect(etapaOrdens.size).toBe(0)
    expect(bloqueSlugs.size).toBe(0)
  })
})

describe('aplanarDataBloque', () => {
  it('sube los campos extraídos por IA al nivel donde la condición los busca', () => {
    const plano = aplanarDataBloque({
      via_solicitud: 'pqrs',
      campos: { marca: { value: 'BYD' }, linea: { value: null } },
    })
    expect(plano.via_solicitud).toBe('pqrs')
    expect(plano.marca).toBe('BYD')
  })

  it('omite los campos extraídos sin valor en vez de escribir null', () => {
    const plano = aplanarDataBloque({ campos: { linea: { value: null } } })
    expect('linea' in plano).toBe(false)
  })

  it('devuelve un objeto vacío cuando el bloque no tiene data', () => {
    expect(aplanarDataBloque(null)).toEqual({})
  })
})
