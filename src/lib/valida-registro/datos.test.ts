import { describe, expect, it } from 'vitest'
import {
  candidatosDeSlug,
  decidirOrigen,
  limpiarCodigoAfi,
  limpiarUtm,
  nitConPuntos,
  problemaDeRazonSocial,
  problemaDelNit,
  textoMotivoValida,
} from './datos'
import { problemaDelSlug } from '@/lib/secop-registro/slug'
import { registroAbierto, tamanoPrueba } from './llave'
import { CONDICIONES_PRUEBA, textosListos } from './condiciones'

describe('NIT y DV en dos campos', () => {
  it('el DV se comprueba con módulo 11 (METRIK IA: 902079601-9)', () => {
    expect(problemaDelNit('902079601', '9')).toBeNull()
    expect(problemaDelNit('902.079.601', '9')).toBeNull()
    expect(problemaDelNit('902079601', '8')).toBe('dv_no_coincide')
  })
  it('lo que falta se dice por campo', () => {
    expect(problemaDelNit('', '9')).toBe('nit_vacio')
    expect(problemaDelNit('902079601', '')).toBe('dv_vacio')
    expect(problemaDelNit('12345', '1')).toBe('nit_forma')
    expect(problemaDelNit('90207960199', '1')).toBe('nit_forma')
  })
  it('el NIT se muestra con puntos mientras se escribe', () => {
    expect(nitConPuntos('902079601')).toBe('902.079.601')
  })
})

describe('razón social', () => {
  it('pide al menos 3 letras y no más de 120', () => {
    expect(problemaDeRazonSocial('  CDA  Ejemplo  S.A.S. ')).toBeNull()
    expect(problemaDeRazonSocial('ab')).not.toBeNull()
    expect(problemaDeRazonSocial('x'.repeat(121))).not.toBeNull()
  })
})

describe('marca de origen', () => {
  it('cualquier señal de AFI gana, y dice cuál fue', () => {
    expect(decidirOrigen({ ref: 'AFI', utm: { utm_medium: 'cpc' } })).toEqual({ origen: 'afi', fuente: 'ref' })
    expect(decidirOrigen({ codigoAfi: 'afi-123' })).toEqual({ origen: 'afi', fuente: 'codigo_afi' })
    expect(decidirOrigen({ recomendadoAfi: true })).toEqual({ origen: 'afi', fuente: 'respuesta_afi' })
  })
  it('pauta solo con un medio pagado; lo demás es directo', () => {
    expect(decidirOrigen({ utm: { utm_source: 'meta', utm_medium: 'paid_social' } })).toEqual({ origen: 'pauta', fuente: 'utm' })
    expect(decidirOrigen({ utm: { utm_source: 'newsletter', utm_medium: 'email' } })).toEqual({ origen: 'directo', fuente: 'ninguna' })
    expect(decidirOrigen({ recomendadoAfi: false, ref: 'otro' })).toEqual({ origen: 'directo', fuente: 'ninguna' })
  })
  it('un código sin forma de código no cuenta', () => {
    expect(limpiarCodigoAfi('a')).toBeNull()
    expect(limpiarCodigoAfi(' afi-77 ')).toBe('AFI-77')
    expect(decidirOrigen({ codigoAfi: '<script>' })).toEqual({ origen: 'directo', fuente: 'ninguna' })
  })
  it('de las UTM solo quedan las cinco llaves conocidas', () => {
    expect(limpiarUtm({ utm_source: ' meta ', gclid: 'x', utm_medium: 'cpc', otra: 1 })).toEqual({ utm_source: 'meta', utm_medium: 'cpc' })
    expect(limpiarUtm('nada')).toEqual({})
  })
})

describe('slug desde la razón social', () => {
  it('si está tomado prueba con número, y todos los candidatos son slugs válidos', () => {
    const base = 'centro-de-diagnostico-automotor'.slice(0, 30)
    const c = candidatosDeSlug(base)
    expect(c[0]).toBe(base)
    expect(c[1].endsWith('-2')).toBe(true)
    expect(c).toHaveLength(9)
    for (const s of c) expect(problemaDelSlug(s)).toBeNull()
  })
})

describe('textos de rechazo', () => {
  it('el NIT tomado no confirma que sea cliente y lleva a la cola humana', () => {
    const t = textoMotivoValida('identificacion_tomada')
    expect(t).toMatch(/Ya tienes cuenta en tu empresa/)
    expect(t).not.toMatch(/NIT/)
  })
})

describe('la llave del registro', () => {
  it('apagado por defecto', () => {
    expect(registroAbierto({}, true)).toBe(false)
  })
  it('en producción solo abre con los textos legales escritos', () => {
    expect(registroAbierto({ VALIDA_REGISTRO_ABIERTO: '1', VERCEL_ENV: 'production' }, false)).toBe(false)
    expect(registroAbierto({ VALIDA_REGISTRO_ABIERTO: '1', VERCEL_ENV: 'production' }, true)).toBe(true)
  })
  it('en un preview abre con la llave aunque falten los textos (para probar el recorrido)', () => {
    expect(registroAbierto({ VALIDA_REGISTRO_ABIERTO: '1', VERCEL_ENV: 'preview' }, false)).toBe(true)
  })
  it('hoy los textos NO están listos: los marcadores siguen ahí', () => {
    expect(textosListos()).toBe(false)
    expect(CONDICIONES_PRUEBA.texto).toMatch(/\[TEXTO EMILIO/)
    expect(textosListos(['Texto definitivo.'])).toBe(true)
  })
})

describe('tamaño de la prueba', () => {
  it('10 consultas en 7 días por defecto (decisión D)', () => {
    expect(tamanoPrueba({})).toEqual({ consultas: 10, dias: 7 })
  })
  it('se cambia por entorno, dentro del tope de Valida', () => {
    expect(tamanoPrueba({ VALIDA_PRUEBA_CONSULTAS: '5', VALIDA_PRUEBA_DIAS: '3' })).toEqual({ consultas: 5, dias: 3 })
    expect(tamanoPrueba({ VALIDA_PRUEBA_CONSULTAS: '500', VALIDA_PRUEBA_DIAS: 'x' })).toEqual({ consultas: 10, dias: 7 })
  })
})
