import { describe, it, expect } from 'vitest'
import type { CampoExtraccion, CampoResultado } from '@/lib/ai/extract-fields'
import { aplicarNormalizaciones, CONFIANZA_REVISAR } from './normalizaciones'

/**
 * La casilla 26 del RUT con el código de la casilla 25 pegado delante (2026-09-24).
 *
 * Los cinco casos son las lecturas REALES de SOENA (bloque `rut`, extracción del modelo,
 * casilla 25 «Cédula de Ciudadanía»), tal como estaban guardadas antes de la corrección.
 * Fixture de campos igual a la config de producción: `nit`, `dv` con `dv_desde_nit`,
 * `numero_identificacion`, `tipo_documento` y `nit_completo`.
 */

function campo(slug: string, extra: Partial<CampoExtraccion> = {}): CampoExtraccion {
  return { slug, label: slug, tipo: 'texto', required: true, descripcion_ai: '', ...extra }
}

const RUT: CampoExtraccion[] = [
  campo('nit'),
  campo('dv', { normalizar: 'dv_desde_nit', normalizar_desde: 'nit' }),
  campo('numero_identificacion'),
  campo('tipo_documento', { required: false }),
  campo('nit_completo', { required: false }),
]
/** `rut_solicitante_2` no lee el tipo de documento. */
const RUT_2: CampoExtraccion[] = [campo('nit'), campo('dv'), campo('numero_identificacion')]

const leido = (value: string, confidence = 0.98): CampoResultado => ({ value, confidence, manual: false })

function rut(ni: string, nit: string, dv: string, tipo: string | null = 'Cédula de Ciudadanía') {
  const r: Record<string, CampoResultado> = {
    nit: leido(nit),
    dv: leido(dv),
    numero_identificacion: leido(ni),
  }
  if (tipo !== null) r.tipo_documento = leido(tipo, 0.95)
  return r
}

describe('casilla 26 con el código del tipo de documento pegado', () => {
  it.each([
    ['V0521', '1380180688', '80180688', '9'],
    ['V0254', '1379907467', '79907467', '7'],
    ['V0110', '1379485203', '79485203', '7'],
    ['V0395', '137556326', '7556326', '8'],
    ['V0177', '132747706', '32747706', '4'],
  ])('%s: %s → %s, y lo leído queda de testigo', (_cod, ni, nit, dv) => {
    const r = rut(ni, nit, dv)
    aplicarNormalizaciones(RUT, r)
    expect(r.numero_identificacion.value).toBe(nit)
    expect(r.numero_identificacion.leido).toBe(ni)
    // Es una corrección con testigo (la casilla 5), no una duda: no baja de banda.
    expect(r.numero_identificacion.confidence).toBe(0.98)
    expect(r.nit.value).toBe(nit)
  })

  it('rut_solicitante_2, sin tipo de documento, también se limpia', () => {
    const r = rut('1380180688', '80180688', '9', null)
    aplicarNormalizaciones(RUT_2, r)
    expect(r.numero_identificacion.value).toBe('80180688')
  })

  it('con cédula de extranjería no se toca nada (la casilla 26 difiere por diseño)', () => {
    const r = rut('13650107', '650107', '1', 'Cédula de Extranjería')
    aplicarNormalizaciones(RUT, r)
    expect(r.numero_identificacion.value).toBe('13650107')
    expect(r.numero_identificacion.confidence).toBe(0.98)
  })

  it('una cédula real de 10 dígitos (11…) contra una casilla 5 sin el «1» NO se recorta: queda para revisar', () => {
    const r = rut('1122456789', '122456789', '0')
    aplicarNormalizaciones(RUT, r)
    expect(r.numero_identificacion.value).toBe('1122456789')
    expect(r.numero_identificacion.confidence).toBe(CONFIANZA_REVISAR)
    expect(r.nit.confidence).toBe(CONFIANZA_REVISAR)
  })

  it('con cédula de ciudadanía, casillas 5 y 26 distintas sin patrón: las dos a «Verificar», sin cambiar valores', () => {
    const r = rut('1022424289', '1022424269', '5')
    aplicarNormalizaciones(RUT, r)
    expect(r.numero_identificacion.value).toBe('1022424289')
    expect(r.numero_identificacion.confidence).toBe(CONFIANZA_REVISAR)
    expect(r.nit.value).toBe('1022424269')
    expect(r.nit.confidence).toBe(CONFIANZA_REVISAR)
  })

  it('un RUT limpio no se toca', () => {
    const r = rut('80180688', '80180688', '9')
    aplicarNormalizaciones(RUT, r)
    expect(r.numero_identificacion).toEqual(leido('80180688'))
    expect(r.nit.confidence).toBe(0.98)
  })

  it('una casilla 26 corregida a mano no se toca aunque tenga el prefijo', () => {
    const r = rut('1380180688', '80180688', '9')
    r.numero_identificacion = {
      ...leido('1380180688', 1),
      manual: true,
      edicion: { editado_por_id: 'x', editado_por_nombre: 'Deisy', editado_en: '2026-09-24T00:00:00Z' },
    }
    aplicarNormalizaciones(RUT, r)
    expect(r.numero_identificacion.value).toBe('1380180688')
  })

  it('casilla 5 con el DV pegado y casilla 26 con el prefijo: sale todo limpio', () => {
    // El NIT se limpia primero (con el DV leído de testigo) y después la casilla 26.
    const r = rut('1380180688', '801806889', '9')
    aplicarNormalizaciones(RUT, r)
    expect(r.nit.value).toBe('80180688')
    expect(r.numero_identificacion.value).toBe('80180688')
    expect(r.dv.value).toBe('9')
  })
})

describe('nit_completo con el DV dos veces', () => {
  it('V0254: «799074677-7» → «79907467-7»', () => {
    const r = rut('79907467', '79907467', '7')
    r.nit_completo = leido('799074677-7')
    aplicarNormalizaciones(RUT, r)
    expect(r.nit_completo.value).toBe('79907467-7')
  })

  it('un nit_completo bueno no se toca', () => {
    const r = rut('79907467', '79907467', '7')
    r.nit_completo = leido('79907467-7')
    aplicarNormalizaciones(RUT, r)
    expect(r.nit_completo.value).toBe('79907467-7')
  })
})
