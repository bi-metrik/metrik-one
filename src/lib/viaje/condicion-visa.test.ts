/**
 * Visa en trámite (decisión de Mauricio 2026-10-29, QA Trappvel V8-2 y H8-1): la condición que
 * va en el PDF y en el mensaje de confirmación. Datos ficticios.
 */
import { describe, expect, it } from 'vitest'
import { CONDICION_VISA_EN_TRAMITE, TITULO_CONDICION_VISA, terminosConCondicionVisa, visaEnTramite } from './condicion-visa'
import { bloquesDeTerminos } from '@/lib/pdf/html/trappvel/plantilla'
import { estructurarTerminos } from '@/lib/cotizaciones/terminos-cotizacion'

describe('visaEnTramite (texto libre de «Requisitos especiales»)', () => {
  it('el caso del viaje 08 y sus variantes', () => {
    expect(visaEnTramite('VISA DE ESTEBAN EN TRÁMITE CON CITA EN ENERO. ANIVERSARIO, MIRADOR')).toBe(true)
    expect(visaEnTramite('visa pendiente')).toBe(true)
    expect(visaEnTramite('Tiene cita para la visa americana el 3 de feb')).toBe(true)
    expect(visaEnTramite('Visa: en tramite')).toBe(true)
    // Solo «visa», sin decir nada más: se trata como pendiente (más vale la condición de sobra).
    expect(visaEnTramite('Visa')).toBe(true)
  })

  it('sin visa pendiente no hay condición', () => {
    expect(visaEnTramite(null)).toBe(false)
    expect(visaEnTramite('')).toBe(false)
    expect(visaEnTramite('Aniversario, habitación con vista al mar')).toBe(false)
    expect(visaEnTramite('No requiere visa')).toBe(false)
    expect(visaEnTramite('sin visa')).toBe(false)
    expect(visaEnTramite('Visa aprobada')).toBe(false)
    expect(visaEnTramite('Ya tienen la visa vigente')).toBe(false)
    // «Visanet», «revisar» no son una visa.
    expect(visaEnTramite('Pago por Visanet; revisar acomodación')).toBe(false)
  })

  it('si una dice aprobada pero otra sigue en trámite, hay condición', () => {
    expect(visaEnTramite('Visa de Ana aprobada; la de Esteban en trámite')).toBe(true)
  })
})

describe('la condición en los términos del PDF', () => {
  it('se agrega como su propia tarjeta, sin tocar lo que ya estaba', () => {
    const base = 'Condiciones generales\n- Las tarifas están sujetas a cambios.'
    const t = terminosConCondicionVisa(base, true)!
    expect(t.startsWith(base)).toBe(true)
    expect(bloquesDeTerminos(t)).toEqual([
      { titulo: 'Condiciones generales', puntos: ['Las tarifas están sujetas a cambios.'] },
      { titulo: TITULO_CONDICION_VISA, puntos: [CONDICION_VISA_EN_TRAMITE] },
    ])
    // El motor @react-pdf también la ve como un subtítulo con su viñeta.
    expect(JSON.stringify(estructurarTerminos(t))).toContain(CONDICION_VISA_EN_TRAMITE)
  })

  it('sin visa en trámite, los términos quedan iguales; sin términos, sale sola', () => {
    expect(terminosConCondicionVisa('X', false)).toBe('X')
    expect(terminosConCondicionVisa(null, false)).toBeNull()
    expect(bloquesDeTerminos(terminosConCondicionVisa(null, true))).toEqual([{ titulo: TITULO_CONDICION_VISA, puntos: [CONDICION_VISA_EN_TRAMITE] }])
  })

  it('el texto va en usted y dice las dos cosas: para qué es el anticipo y qué pasa si niegan la visa', () => {
    expect(CONDICION_VISA_EN_TRAMITE).toMatch(/anticipo/)
    expect(CONDICION_VISA_EN_TRAMITE).toMatch(/niegan la visa/)
    expect(CONDICION_VISA_EN_TRAMITE).toMatch(/política de cancelación/)
    expect(CONDICION_VISA_EN_TRAMITE).not.toMatch(/no responde por el valor pagado/)
    expect(CONDICION_VISA_EN_TRAMITE).not.toMatch(/\b(tu|tú|te|tienes)\b/i)
  })
})
