import { describe, it, expect } from 'vitest'
import { esBloqueReactivado, instanciaVacia, reactivacionActiva } from './bloque-reactivado'
import { cumpleCondicion } from './condicion-bloque'

/**
 * Los casos usan la topología REAL de SOENA leída de producción el 2026-08-20:
 * `titularidad` vive en la etapa de orden 5 con el campo `modalidad_solicitante`
 * (`unico` | `copropiedad` | `leasing`), y `rut_solicitante_2` vive en la etapa 6
 * condicionado a `copropiedad`. Es el caso que motivó el módulo.
 */
const CONDICION_RUT2 = {
  field: 'modalidad_solicitante',
  value: 'copropiedad',
  source_bloque_slug: 'titularidad',
  source_etapa_orden: 5,
}

const configRut2 = { label: '007A_RUT_2', condition: CONDICION_RUT2 }

const fuentesCon = (modalidad: string) => ({
  porSlug: { titularidad: { modalidad_solicitante: modalidad } },
  porEtapaOrden: { 5: { modalidad_solicitante: modalidad } },
})

describe('reactivacionActiva', () => {
  it('sin config de linea NO activa', () => {
    expect(reactivacionActiva(null)).toBe(false)
    expect(reactivacionActiva({})).toBe(false)
  })

  it('exige el booleano exacto, no un valor con verdad', () => {
    expect(reactivacionActiva({ reactivar_bloques: { activa: 'true' } })).toBe(false)
    expect(reactivacionActiva({ reactivar_bloques: { activa: true } })).toBe(true)
  })
})

describe('instanciaVacia', () => {
  it('null y objeto sin claves estan vacios', () => {
    expect(instanciaVacia(null)).toBe(true)
    expect(instanciaVacia({})).toBe(true)
  })

  it('la marca del backfill NO cuenta como respuesta', () => {
    // 119 de los 261 abiertos de SOENA tienen `titularidad` así: nadie contestó.
    expect(instanciaVacia({ _migrado: true })).toBe(true)
  })

  it('un valor real la llena', () => {
    expect(instanciaVacia({ _migrado: true, modalidad_solicitante: 'unico' })).toBe(false)
  })

  it('los defaults vacios de un bloque recien nacido no la llenan', () => {
    expect(instanciaVacia({ drive_url: '', file_name: null, campos: {} })).toBe(true)
  })

  it('un documento con archivo NO esta vacio', () => {
    expect(instanciaVacia({ drive_url: 'https://drive/x', campos: { nit: { value: '8163544' } } })).toBe(false)
  })
})

describe('esBloqueReactivado', () => {
  const base = { activa: true, configExtra: configRut2, data: null, estado: null }

  it('el caso que lo motivo: titularidad corregida a copropiedad, RUT 2 sin instancia', () => {
    expect(esBloqueReactivado({ ...base, fuentes: fuentesCon('copropiedad') })).toBe(true)
  })

  it('mientras la titularidad diga UNICO el bloque no aplica', () => {
    expect(esBloqueReactivado({ ...base, fuentes: fuentesCon('unico') })).toBe(false)
  })

  it('sin el opt-in de la linea nunca reactiva', () => {
    expect(esBloqueReactivado({ ...base, activa: false, fuentes: fuentesCon('copropiedad') })).toBe(false)
  })

  it('un bloque SIN condicion no se reactiva aunque este vacio', () => {
    // Si no, el historial se llenaría de todo lo que alguna vez nadie llenó.
    expect(esBloqueReactivado({ ...base, configExtra: { label: 'X' }, fuentes: fuentesCon('copropiedad') })).toBe(false)
  })

  it('un bloque que YA tiene el documento no se toca', () => {
    expect(esBloqueReactivado({
      ...base,
      data: { drive_url: 'https://drive/rut2.pdf' },
      estado: 'completo',
      fuentes: fuentesCon('copropiedad'),
    })).toBe(false)
  })

  it('completo pero vacio tampoco: el estado manda sobre el dato', () => {
    // Un bloque cerrado a mano es una decisión de alguien; reabrirlo la pisaría.
    expect(esBloqueReactivado({ ...base, estado: 'completo', fuentes: fuentesCon('copropiedad') })).toBe(false)
  })

  it('un heredado readonly NUNCA se reactiva: escribiria en el lugar equivocado', () => {
    // Los heredados de `rut_solicitante_2` viven en Pago UPME (8) y Certificación (9).
    const heredado = { ...configRut2, readonly: true, source_bloque_slug: 'rut_solicitante_2', source_etapa_orden: 6 }
    expect(esBloqueReactivado({ ...base, configExtra: heredado, fuentes: fuentesCon('copropiedad') })).toBe(false)
  })

  it('un bloque desactivado sigue fuera del flujo', () => {
    const off = { ...configRut2, desactivado: true }
    expect(esBloqueReactivado({ ...base, configExtra: off, fuentes: fuentesCon('copropiedad') })).toBe(false)
  })

  it('el SILENCIO no reactiva: sin respuesta en titularidad la condicion no se cumple', () => {
    const fuentes = { porSlug: { titularidad: { _migrado: true } }, porEtapaOrden: { 5: {} } }
    expect(esBloqueReactivado({ ...base, fuentes })).toBe(false)
  })

  it('con el bloque fuente ausente del todo, tampoco', () => {
    expect(esBloqueReactivado({ ...base, fuentes: { porSlug: {}, porEtapaOrden: {} } })).toBe(false)
  })
})

describe('cumpleCondicion', () => {
  it('sin condicion, el bloque aplica siempre', () => {
    expect(cumpleCondicion(undefined, { porSlug: {}, porEtapaOrden: {} })).toBe(true)
  })

  it('prefiere el slug y cae al orden de etapa cuando el slug no resuelve', () => {
    const soloOrden = { porSlug: {}, porEtapaOrden: { 5: { modalidad_solicitante: 'copropiedad' } } }
    expect(cumpleCondicion(CONDICION_RUT2, soloOrden)).toBe(true)
  })

  it('`value` compara EXACTO — no normaliza, y eso es deliberado', () => {
    const fuentes = { porSlug: { titularidad: { modalidad_solicitante: 'Copropiedad' } }, porEtapaOrden: {} }
    expect(cumpleCondicion(CONDICION_RUT2, fuentes)).toBe(false)
  })

  it('`value_in` SI normaliza tildes y mayusculas', () => {
    const cond = { field: 'via', value_in: ['agenda', 'PQRS'], source_bloque_slug: 'x' }
    const fuentes = { porSlug: { x: { via: 'pqrs' } }, porEtapaOrden: {} }
    expect(cumpleCondicion(cond, fuentes)).toBe(true)
  })
})
