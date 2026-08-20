import { describe, it, expect } from 'vitest'
import { recolectarReferenciasFuente, referenciasFaltantes, aplanarDataBloque } from './referencias-fuente'

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

// El caso V0141 (SOENA): `rut_solicitante_2` vive en Documentación y se activa con
// `titularidad`, pero el negocio está en Cita. Las bolsas llegan vacías porque
// ningún bloque de Cita referencia esa fuente.
const RUT_SOLICITANTE_2 = {
  condition: { field: 'modalidad_solicitante', value_in: ['copropiedad'], source_bloque_slug: 'titularidad' },
}

describe('referenciasFaltantes', () => {
  it('pide la fuente que un bloque del historial declara y nadie resolvió', () => {
    const faltan = referenciasFaltantes([RUT_SOLICITANTE_2], { porSlug: {}, porEtapaOrden: {} })
    expect(faltan.slugs).toEqual(['titularidad'])
  })

  it('no vuelve a pedir lo que las bolsas ya traen', () => {
    const faltan = referenciasFaltantes([RUT_SOLICITANTE_2], {
      porSlug: { titularidad: { modalidad_solicitante: 'copropiedad' } },
      porEtapaOrden: {},
    })
    expect(faltan.slugs).toEqual([])
  })

  it('una bolsa vacía para ese slug NO cuenta como resuelta', () => {
    // Un `{}` es indistinguible de "el bloque no tiene data", pero la clave existe:
    // si el índice ya la registró, volver a consultarla no cambia nada.
    const faltan = referenciasFaltantes([RUT_SOLICITANTE_2], {
      porSlug: { titularidad: {} },
      porEtapaOrden: {},
    })
    expect(faltan.slugs).toEqual([])
  })

  it('pide también la etapa origen de la vía legacy', () => {
    const faltan = referenciasFaltantes(
      [{ condition: { field: 'requiere_certificacion_upme', value: 'true', source_etapa_orden: 5 } }],
      { porSlug: {}, porEtapaOrden: {} }
    )
    expect(faltan.etapaOrdens).toEqual([5])
  })

  it('no pide una etapa que la pasada principal ya cargó', () => {
    const faltan = referenciasFaltantes(
      [{ condition: { field: 'requiere_certificacion_upme', value: 'true', source_etapa_orden: 5 } }],
      { porSlug: {}, porEtapaOrden: { 5: { requiere_certificacion_upme: 'true' } } }
    )
    expect(faltan.etapaOrdens).toEqual([])
  })

  it('no pide nada cuando ningún bloque declara referencias', () => {
    const faltan = referenciasFaltantes([{ fields: [{}] }, null, undefined], { porSlug: {}, porEtapaOrden: {} })
    expect(faltan).toEqual({ slugs: [], etapaOrdens: [] })
  })
})
