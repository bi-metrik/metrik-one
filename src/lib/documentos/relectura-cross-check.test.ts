/**
 * La relectura del veredicto guardado de un documento. Datos INVENTADOS con la forma de
 * los casos medidos en SOENA el 2026-10-01.
 */
import { describe, expect, it } from 'vitest'
import { absolverCrossCheck, type SpecRelectura } from './relectura-cross-check'
import type { CrossCheckGuardado } from './refrescar-vigencia'

const RUT = { source_bloque_slug: 'rut', source_etapa_orden: 6, source_bloque_nombre: 'RUT' }
const CHECKS: SpecRelectura[] = [
  { ...RUT, slug: 'nombre', match_mode: 'tokens', source_field: 'razon_social' },
  { ...RUT, slug: 'documento', match_mode: 'id_prefix', source_field: 'numero_identificacion' },
  {
    slug: 'nombre_2',
    match_mode: 'tokens',
    optional: true,
    required_when: { field: 'modalidad', value: 'copropiedad', source_bloque_slug: 'titularidad' },
    source_bloque_slug: 'rut_2',
    source_etapa_orden: 6,
    source_bloque_nombre: 'RUT 2',
    source_field: 'razon_social',
  },
  { slug: 'cita', match_mode: 'vigencia', source_bloque_slug: 'cita', source_etapa_orden: 9, source_bloque_nombre: 'Cita', source_field: 'fecha' },
]

const fila = (slug: string, expected: string, extracted: string, ok = false) =>
  ({ slug, label: slug, expected, extracted, ok, estado: ok ? 'ok' : 'falla', mode: 'tokens' }) as const

const guardado = (...results: ReturnType<typeof fila>[]): CrossCheckGuardado =>
  ({ passed: results.every(r => r.ok), solo_alerta: true, results: results.map(r => ({ ...r })) })

describe('absolverCrossCheck', () => {
  it('una falla que hoy coincide pasa a ok (la regla cambió)', () => {
    const cc = guardado(fila('nombre', 'GARCIA MEJIA PEDRO', 'GARCIA MEJIA PEDRΟ'), fila('documento', '12345678', '12345678', true))
    const r = absolverCrossCheck(cc, CHECKS, { porSlug: { rut: { razon_social: 'GARCIA MEJIA PEDRO' } } })
    expect(r?.passed).toBe(true)
    expect(r?.results[0]).toMatchObject({ ok: true, estado: 'ok' })
  })

  it('una falla con «esperado: vacío» pasa a ok cuando el RUT llegó después y coincide', () => {
    const cc = guardado(fila('documento', '', '12345678'))
    const r = absolverCrossCheck(cc, CHECKS, { porSlug: { rut: { numero_identificacion: '12345678' } } })
    expect(r?.results[0]).toMatchObject({ ok: true, expected: '12345678' })
  })

  it('una falla que sigue sin coincidir se queda como estaba (mismo objeto)', () => {
    const cc = guardado(fila('nombre', 'GARCIA MEJIA PEDRO', 'LOPEZ ROJAS ANA'))
    expect(absolverCrossCheck(cc, CHECKS, { porSlug: { rut: { razon_social: 'GARCIA MEJIA PEDRO' } } })).toBe(cc)
  })

  it('nunca condena: un ok guardado sigue ok aunque hoy no coincida', () => {
    const cc = guardado(fila('nombre', 'GARCIA MEJIA PEDRO', 'GARCIA MEJIA PEDRO', true))
    expect(absolverCrossCheck(cc, CHECKS, { porSlug: { rut: { razon_social: 'OTRO NOMBRE DISTINTO' } } })).toBe(cc)
  })

  it('sin el bloque fuente en la lectura no se absuelve nada', () => {
    const cc = guardado(fila('nombre', 'GARCIA MEJIA PEDRO', 'GARCIA MEJIA PEDRΟ'))
    expect(absolverCrossCheck(cc, CHECKS, { porSlug: {} })).toBe(cc)
  })

  it('la vigencia no pasa por aquí', () => {
    const cc = guardado({ ...fila('cita', '2026-10-30', '2026-01-01') })
    expect(absolverCrossCheck(cc, CHECKS, { porSlug: { cita: { fecha: '2026-10-30' } } })).toBe(cc)
  })

  it('un valor extraído vacío sigue fallando (el dato que falta sigue faltando)', () => {
    const cc = guardado(fila('nombre_2', '', ''))
    const datos = { porSlug: { titularidad: { modalidad: 'copropiedad' }, rut_2: {} } }
    expect(absolverCrossCheck(cc, CHECKS, datos)).toBe(cc)
  })

  describe('la sociedad que acompaña al titular en el 2º lugar', () => {
    const cc = () => guardado(fila('nombre_2', '', 'PROYECTOS SOLARES DEL VALLE SAS'))

    it('negocio de un solo titular y sin RUT del segundo: se absuelve', () => {
      const r = absolverCrossCheck(cc(), CHECKS, { porSlug: { titularidad: { modalidad: 'unico' } } })
      expect(r?.results[0]).toMatchObject({ ok: true, estado: 'ok' })
    })

    it('copropiedad: el lugar es obligatorio y la sociedad no es un titular', () => {
      const c = cc()
      expect(absolverCrossCheck(c, CHECKS, { porSlug: { titularidad: { modalidad: 'copropiedad' } } })).toBe(c)
    })

    it('sin saber la titularidad no se absuelve', () => {
      const c = cc()
      expect(absolverCrossCheck(c, CHECKS, { porSlug: {} })).toBe(c)
    })

    it('una PERSONA NATURAL en el 2º lugar sin RUT del segundo sigue avisando', () => {
      const c = guardado(fila('nombre_2', '', 'LOPEZ ROJAS ANA'))
      expect(absolverCrossCheck(c, CHECKS, { porSlug: { titularidad: { modalidad: 'unico' } } })).toBe(c)
    })

    it('si HAY contra qué compararla y no coincide, sigue avisando', () => {
      const c = cc()
      const datos = { porSlug: { titularidad: { modalidad: 'unico' }, rut_2: { razon_social: 'OTRA SOCIEDAD SAS' } } }
      expect(absolverCrossCheck(c, CHECKS, datos)).toBe(c)
    })
  })
})
