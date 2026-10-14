import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  candidatosDeSlug,
  casillasDesdeNit,
  dvParaNit,
  listoParaEnviar,
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

describe('el DV se llena solo al escribir el NIT', () => {
  it('se calcula con la fórmula de la DIAN sobre el NIT entero', () => {
    expect(dvParaNit('902079601')).toBe('9')
    expect(dvParaNit('902.079.601')).toBe('9')
    // Bancolombia: la trampa de `separarNitDv` (8 es también el DV de 89090393). Aquí no se parte nada.
    expect(dvParaNit('890903938')).toBe('8')
    expect(casillasDesdeNit('890903938')).toEqual({ nit: '890903938', dv: '8', conGuion: false })
  })
  it('a medio escribir no propone DV', () => {
    expect(dvParaNit('')).toBe('')
    expect(dvParaNit('90207')).toBe('')
    expect(casillasDesdeNit('90207')).toEqual({ nit: '90207', dv: '', conGuion: false })
  })
  it('lo que llena siempre pasa la comprobación del servidor', () => {
    for (const nit of ['902079601', '890903938', '800197268', '1020304050', '123456']) {
      expect(problemaDelNit(nit, dvParaNit(nit))).toBeNull()
    }
  })
  it('con guion separa: el DV traído se respeta y, si no cuadra, sale el aviso', () => {
    expect(casillasDesdeNit('902079601-9')).toEqual({ nit: '902079601', dv: '9', conGuion: true })
    const mal = casillasDesdeNit('902.079.601-8')
    expect(mal).toEqual({ nit: '902079601', dv: '8', conGuion: true })
    expect(problemaDelNit(mal.nit, mal.dv)).toBe('dv_no_coincide')
    // El guion recién escrito, sin DV todavía: se calcula y el foco pasa a la casilla del DV.
    expect(casillasDesdeNit('902079601-')).toEqual({ nit: '902079601', dv: '9', conGuion: true })
  })
  it('el NIT no pasa de 10 dígitos', () => {
    expect(casillasDesdeNit('12345678901234').nit).toBe('1234567890')
  })
  it('si la persona cambia el DV y no cuadra, el aviso de siempre', () => {
    expect(problemaDelNit('902079601', '3')).toBe('dv_no_coincide')
  })
})

describe('cuándo se deja tocar «Empezar» (sin tipo de empresa)', () => {
  const completo = { razonSocial: 'Empresa Ejemplo S.A.S.', nit: '902079601', dv: '9', acepta: true, recomendadoAfi: false }
  it('con razón social, NIT válido, casilla y respuesta de AFI basta: no pide tipo de empresa', () => {
    expect(listoParaEnviar(completo)).toBe(true)
  })
  it('falta cualquiera de esos y no deja', () => {
    expect(listoParaEnviar({ ...completo, razonSocial: 'ab' })).toBe(false)
    expect(listoParaEnviar({ ...completo, dv: '8' })).toBe(false)
    expect(listoParaEnviar({ ...completo, acepta: false })).toBe(false)
    expect(listoParaEnviar({ ...completo, recomendadoAfi: null })).toBe(false)
  })
  it('ni la pantalla, ni la ruta, ni el servidor vuelven a pedir el tipo de empresa', () => {
    const pantalla = readFileSync('src/app/(marketing)/valida/empezar/registro-client.tsx', 'utf8')
    const ruta = readFileSync('src/app/api/valida/registro/route.ts', 'utf8')
    const servidor = readFileSync('src/lib/valida-registro/registro-servidor.ts', 'utf8')
    expect(pantalla).not.toMatch(/tipo_entidad|Tipo de empresa|tipoEntidad/)
    expect(ruta).not.toMatch(/tipo_entidad|tipoEntidad/)
    expect(servidor).not.toMatch(/esTipoEntidad|tipoEntidad|campo: 'tipo_entidad'/)
    // La columna nullable queda en null: el segmento sale del RUT al activar.
    expect(servidor).toMatch(/tipo_entidad: null,/)
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
  it('los textos aprobados (2026-10-11) ya no tienen marcadores', () => {
    expect(textosListos()).toBe(true)
    expect(CONDICIONES_PRUEBA.texto).not.toMatch(/\[TEXTO/)
    expect(textosListos(['[TEXTO LUCÍA: pendiente]'])).toBe(false)
  })
  it('en producción no abre si el entorno pide una prueba distinta de la que prometen las Condiciones', () => {
    const prod = { VALIDA_REGISTRO_ABIERTO: '1', VERCEL_ENV: 'production' }
    expect(registroAbierto({ ...prod, VALIDA_PRUEBA_CONSULTAS: '20' }, true)).toBe(false)
    expect(registroAbierto({ ...prod, VALIDA_PRUEBA_DIAS: '5' }, true)).toBe(false)
    expect(registroAbierto({ ...prod, VALIDA_PRUEBA_CONSULTAS: '10', VALIDA_PRUEBA_DIAS: '7' }, true)).toBe(true)
    // En un preview sí, para poder probar otra prueba.
    expect(registroAbierto({ VALIDA_REGISTRO_ABIERTO: '1', VERCEL_ENV: 'preview', VALIDA_PRUEBA_CONSULTAS: '20' }, true)).toBe(true)
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
