import { describe, expect, it } from 'vitest'
import { activacionAbierta, plazoTerminos, textoErrorActivacion } from './activacion'
import { compararRut, razonParaComparar } from './rut'
import { TERMINOS_PLAN, camposDeLaOrden, camposDePlantilla, llenarPlantilla, nitLegible, terminosPlanListos } from './terminos-plan'

describe('la llave de la activación', () => {
  it('apagada por defecto, y sin Términos aprobados no abre ni con la llave (tampoco en preview)', () => {
    expect(activacionAbierta({}, true)).toBe(false)
    expect(activacionAbierta({ VALIDA_ACTIVACION_ABIERTA: '1' }, false)).toBe(false)
    expect(activacionAbierta({ VALIDA_ACTIVACION_ABIERTA: '1', VERCEL_ENV: 'preview' }, false)).toBe(false)
    expect(activacionAbierta({ VALIDA_ACTIVACION_ABIERTA: '1' }, true)).toBe(true)
  })
  it('los Términos de autoservicio v2.0 ya están: sin marcador, la llave decide', () => {
    expect(terminosPlanListos()).toBe(true)
    expect(activacionAbierta({ VALIDA_ACTIVACION_ABIERTA: '1' })).toBe(true)
    expect(activacionAbierta({})).toBe(false)
  })
  it('con tarjeta, el botón no activa: el plan nace con el primer cobro al terminar la prueba', () => {
    expect(textoErrorActivacion('cobro_al_terminar_prueba')).toContain('se activa solo al terminar la prueba')
  })
})

describe('los Términos de la empresa', () => {
  it('no devuelven texto con un campo sin llenar', () => {
    const p = 'EL CLIENTE: {razon_social}, NIT {nit}. Domicilio: {domicilio}.'
    expect(camposDePlantilla(p)).toEqual(['razon_social', 'nit', 'domicilio'])
    expect(llenarPlantilla(p, { razon_social: 'CDA X', nit: '900.1-2' })).toEqual({ ok: false, faltan: ['domicilio'] })
    expect(llenarPlantilla(p, { razon_social: 'CDA X', nit: '900.1-2', domicilio: '  ' })).toEqual({ ok: false, faltan: ['domicilio'] })
    expect(llenarPlantilla(p, { razon_social: 'CDA X', nit: '900.1-2', domicilio: 'Florencia' })).toEqual({
      ok: true,
      texto: 'EL CLIENTE: CDA X, NIT 900.1-2. Domicilio: Florencia.',
    })
  })
  it('los campos que el sistema conoce', () => {
    const c = camposDeLaOrden({
      razonSocial: 'CDA EJEMPLO S.A.S.',
      nit: '900123456',
      dv: '7',
      correo: 'gerencia@cda.co',
      recomendadoAfi: false,
      // 15:00 de Bogotá; la prueba vence 7 días después, a la misma hora.
      aceptadoMs: Date.parse('2026-10-12T20:00:00Z'),
      duracionPruebaMs: 7 * 86_400_000,
      huellaParteII: 'f'.repeat(64),
    })
    expect(c).toMatchObject({
      razon_social: 'CDA EJEMPLO S.A.S.',
      nit: '900.123.456-7',
      correo_notificaciones: 'gerencia@cda.co',
      fecha_registro: '12 de octubre de 2026',
      fecha_publicacion: '12 de octubre de 2026',
      recomendado_afi: 'no',
      huella_sha256: 'f'.repeat(64),
    })
    expect(c.fecha_hora_vence_prueba).toMatch(/^lunes, 19 de octubre de 2026, 3:00\s?p\.\s?m\. \(hora de Colombia\)$/)
    // La plantilla pide SOLO campos que el registro llena.
    expect(llenarPlantilla(TERMINOS_PLAN.plantilla, c).ok).toBe(true)
  })
  it('NIT legible con puntos y DV', () => {
    expect(nitLegible('900123456', '7')).toBe('900.123.456-7')
    expect(nitLegible('12345678', null)).toBe('12.345.678')
  })
})

describe('el RUT al activar', () => {
  const declarado = { nit: '900123456', dv: '7', razonSocial: 'CDA Ejemplo S.A.S.' }
  it('coincide con otra puntuación, tildes o forma societaria', () => {
    expect(razonParaComparar('C.D.A. Éjemplo SAS')).toBe(razonParaComparar('CDA EJEMPLO S.A.S.'))
    expect(compararRut(declarado, { nit: '900.123.456', dv: '7', razonSocial: 'CDA EJEMPLO SAS', confianza: 0.95 })).toBe('coincide')
  })
  it('otro NIT, otro DV u otra razón social no coinciden', () => {
    expect(compararRut(declarado, { nit: '900123457', dv: '7', razonSocial: 'CDA EJEMPLO SAS', confianza: 0.95 })).toBe('no_coincide')
    expect(compararRut(declarado, { nit: '900123456', dv: '8', razonSocial: 'CDA EJEMPLO SAS', confianza: 0.95 })).toBe('no_coincide')
    expect(compararRut(declarado, { nit: '900123456', dv: '7', razonSocial: 'OTRO CDA SAS', confianza: 0.95 })).toBe('no_coincide')
  })
  it('una lectura dudosa o incompleta es ilegible, no una coincidencia', () => {
    expect(compararRut(declarado, { nit: '900123456', dv: '7', razonSocial: 'CDA EJEMPLO SAS', confianza: 0.6 })).toBe('ilegible')
    expect(compararRut(declarado, { nit: null, dv: null, razonSocial: 'CDA EJEMPLO SAS', confianza: 0.95 })).toBe('ilegible')
  })
})

describe('el plazo para aceptar los Términos', () => {
  it('hasta el último día de la prueba (Bogotá), o hoy si ya terminó', () => {
    expect(plazoTerminos('2026-10-16T15:00:00.000Z', '2026-10-12')).toBe('2026-10-16')
    // 02:00 UTC del 17 es el 16 en Bogotá.
    expect(plazoTerminos('2026-10-17T02:00:00.000Z', '2026-10-12')).toBe('2026-10-16')
    expect(plazoTerminos('2026-10-09T15:00:00.000Z', '2026-10-12')).toBe('2026-10-12')
    expect(plazoTerminos(null, '2026-10-12')).toBe('2026-10-12')
  })
})

describe('los mensajes', () => {
  it('no revelan que un NIT ya es cliente', () => {
    expect(textoErrorActivacion('nit_con_contrato')).not.toMatch(/cliente|contrato|ya tiene/i)
  })
})
