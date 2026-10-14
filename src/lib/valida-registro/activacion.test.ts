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
  it('hoy los Términos del plan NO están: el marcador sigue en la plantilla', () => {
    expect(terminosPlanListos()).toBe(false)
    expect(activacionAbierta({ VALIDA_ACTIVACION_ABIERTA: '1' })).toBe(false)
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
      precioMensual: 150000,
      licencias: 2,
      limiteMes: 3000,
      ahora: new Date('2026-10-12T15:00:00Z'),
    })
    expect(c).toMatchObject({
      razon_social: 'CDA EJEMPLO S.A.S.',
      nit: '900.123.456-7',
      precio_cifra: '$150.000',
      usuarios_incluidos: '2',
      consultas_incluidas: '3.000',
      fecha_orden: '12 de octubre de 2026',
    })
    // La plantilla de hoy (marcador) pide solo campos que el sistema llena: al pegar el texto
    // aprobado, esta prueba dice cuáles faltan.
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
