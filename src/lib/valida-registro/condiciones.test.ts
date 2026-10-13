import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POLITICA_DATOS_VALIDA } from '@/lib/valida-api/politica'
import { epaycoHabilitado, llavePublicaEpayco } from '@/lib/suscripciones/pasarela/epayco'
import {
  AVISO_DATOS_FORMULARIO,
  AVISO_DATOS_FORMULARIO_CON_COBRO,
  AVISO_REGISTRO,
  CONDICIONES_PRUEBA,
  CONDICIONES_PRUEBA_CON_COBRO,
  PRUEBA_DE_LAS_CONDICIONES,
  TEXTO_CASILLA,
  TEXTO_CASILLA_CON_COBRO,
  VERSION_ACEPTADA,
  VIGENTES_CON_COBRO,
  VIGENTES_SIN_COBRO,
  avisoComoSeLee,
  condicionesVigentes,
  epaycoPuedeTokenizar,
  textoAceptado,
  textoJuntoATarjeta,
  versionAceptada,
} from './condiciones'
import { CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION, COBRO_TRAS_PRUEBA } from './condiciones-cobro'
import { LICENCIAS_INCLUIDAS, LIMITE_CONSULTAS_MES_POR_DEFECTO, PRECIO_MENSUAL_VALIDA } from './plan'
import { huellaAceptacion } from './registro-servidor'
import { PRUEBA_POR_DEFECTO } from './llave'

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

/**
 * Huellas fijadas. Si una prueba de huella falla, cambió una letra de lo que la persona lee: hay que
 * subir la versión que corresponda (Condiciones o aviso) y, solo entonces, actualizar el valor.
 *
 *   - sin cobro: Condiciones v1.0 + aviso v1.1 + casilla v1.0 (2026-10-12, aviso sin «tipo de empresa»);
 *   - con cobro: Condiciones v2.0 + aviso v1.2 + casilla con cobro (2026-10-12, texto de Vera aplicado
 *     por Emilio en los archivos legales).
 */
const HUELLA_SIN_COBRO = '88ddf9d4d3050e5b309041c6693dbf3d0174bd0d2e7020e1fa32f957a5d2ae80'
const HUELLA_CON_COBRO = '2c1f8f4f4ef03a9ebc609612c97ccb0c0cbb462ed563158ba6f6b29b97c98d85'

const EPAYCO = { EPAYCO_HABILITADO: '1', EPAYCO_PUBLIC_KEY_METRIK: 'pub_prueba' }
const COBRO = { VALIDA_COBRO_TRAS_PRUEBA: '1', ...EPAYCO }

describe('sin cobro: Condiciones v1.0 con el aviso v1.1', () => {
  it('versiones', () => {
    expect(CONDICIONES_PRUEBA.version).toBe('1.0')
    expect(AVISO_REGISTRO.version).toBe('1.1')
    expect(VERSION_ACEPTADA).toBe('condiciones-1.0+aviso-1.1')
    expect(versionAceptada()).toBe('condiciones-1.0+aviso-1.1')
  })

  it('las Condiciones v1.0 traen los tres bloques y nada del cobro', () => {
    expect(CONDICIONES_PRUEBA.texto).toMatch(/^CONDICIONES DE LA PRUEBA GRATIS DE VALIDA · Versión 1\.0/)
    expect(CONDICIONES_PRUEBA.texto).toContain('7. Al terminar la prueba.')
    expect(CONDICIONES_PRUEBA.texto).not.toMatch(/Medio de pago y cobro|\$150\.000/)
  })

  it('el aviso v1.1 ya no nombra el tipo de empresa (el registro no lo pregunta)', () => {
    expect(AVISO_DATOS_FORMULARIO).not.toContain('tipo de empresa')
    expect(AVISO_DATOS_FORMULARIO).toContain('Usamos su correo, la razón social, el NIT, cómo llegó a Valida')
    expect(AVISO_DATOS_FORMULARIO.endsWith('están en la')).toBe(true)
    expect(AVISO_DATOS_FORMULARIO).not.toContain('ePayco')
  })

  it('los números que prometen las Condiciones son los de la prueba por defecto', () => {
    expect(PRUEBA_DE_LAS_CONDICIONES).toEqual(PRUEBA_POR_DEFECTO)
    expect(CONDICIONES_PRUEBA.texto).toContain('La prueba da 10 consultas de listas restrictivas y vinculantes durante 7 días calendario')
  })

  it('la casilla sin cobro es la de siempre', () => {
    expect(TEXTO_CASILLA).toBe(
      'Acepto, en nombre de la empresa, las Condiciones de la prueba gratis, incluido el encargo de los datos de las personas que consulte, y autorizo el tratamiento de mis datos según este aviso.',
    )
  })
})

describe('con cobro: Condiciones v2.0 completas, aviso v1.2 y casilla con cobro', () => {
  const t = CONDICIONES_PRUEBA_CON_COBRO.texto

  it('versión 2.0 y aviso 1.2', () => {
    expect(t).toMatch(/^CONDICIONES DE LA PRUEBA GRATIS DE VALIDA · Versión 2\.0/)
    expect(versionAceptada(VIGENTES_CON_COBRO)).toBe('condiciones-2.0+aviso-1.2')
  })

  it('el numeral 1 ya no dice que no pide tarjeta, y autoriza el cobro de cada mes (Vera)', () => {
    expect(t).not.toContain('no pide tarjeta')
    expect(t).not.toContain('solo se le cobra el primer mes')
    expect(t).toContain(
      'Para abrirla, la Empresa registra un medio de pago. Si no cancela a tiempo, a ese medio de pago se le cobra el plan mensual de Valida: el primer mes al cumplirse los 7 días y después cada mes, hasta que se retire, como dicen los numerales 7.1 y 7.4.',
    )
  })

  it('el 7 ya no dice «al terminar la prueba» y el 7.1 promete «después, nunca antes»', () => {
    expect(t).toContain('7. Medio de pago y cobro al cumplirse los 7 días de la prueba.')
    expect(t).not.toContain('al terminar la prueba')
    expect(t).not.toContain('Al terminar la prueba')
    expect(t).toContain('el cobro se hace después de ese momento, nunca antes.')
    expect(t).toContain('El cobro no se adelanta aunque las 10 consultas se agoten antes.')
  })

  it('los valores de la cláusula van escritos y coinciden con los del código', () => {
    expect(t).toContain(`la pasarela ${COBRO_TRAS_PRUEBA.pasarela}.`)
    expect(t).toContain('$150.000, valor total, sin IVA que sumar')
    expect(COBRO_TRAS_PRUEBA.precio).toBe(PRECIO_MENSUAL_VALIDA)
    expect(t).toContain('con hasta 3.000 consultas al mes')
    expect(COBRO_TRAS_PRUEBA.limiteMensual).toBe(LIMITE_CONSULTAS_MES_POR_DEFECTO)
    expect(t).toContain(`al menos ${COBRO_TRAS_PRUEBA.horasAviso} horas antes del cobro, con la fecha, el valor y cómo cancelar`)
    expect(t).toContain(`el botón "${COBRO_TRAS_PRUEBA.botonCancelar}" de su cuenta en Valida`)
    expect(t).not.toMatch(/\{[a-z_]+\}/)
    expect(LICENCIAS_INCLUIDAS).toBe(2)
  })

  it('recupera la supresión (7.6) y el 8 nombra la referencia del medio de pago', () => {
    expect(t).toContain(
      '7.6. Supresión. La Empresa puede pedir la supresión de los datos de su cuenta, salvo los que la ley o el numeral 6.5 obligan a conservar.',
    )
    expect(t).toContain('la dirección IP y la referencia del medio de pago registrado en la pasarela.')
  })

  it('numerales 2 a 6 iguales a la v1.0', () => {
    const desde2 = (x: string) => x.slice(x.indexOf('2. Quién puede usarla.'), x.indexOf('\n\n7. '))
    expect(desde2(t)).toBe(desde2(CONDICIONES_PRUEBA.texto))
  })

  it('el aviso v1.2 nombra a ePayco y lo que guarda METRIK', () => {
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO).toContain('pasarela ePayco (EPAYCO.COM S.A.S.)')
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO).toContain('una referencia de la tarjeta (token)')
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO.endsWith('están en la')).toBe(true)
  })

  it('la casilla con cobro autoriza el primer mes y cada mes siguiente', () => {
    expect(TEXTO_CASILLA_CON_COBRO).toContain('(el primer mes y después cada mes hasta que me retire)')
    expect(TEXTO_CASILLA_CON_COBRO).toContain('los Términos de Uso de Valida')
  })

  it('el texto junto a la tarjeta lleva la fecha y la hora en que se cumplen los 7 días', () => {
    const x = textoJuntoATarjeta('martes, 20 de octubre de 2026, 3:00 p. m.')
    expect(x).toContain('Si no cancela antes del martes, 20 de octubre de 2026, 3:00 p. m., después de ese momento se cobran $150.000')
    expect(x).not.toContain('{')
  })
})

describe('la huella cubre Condiciones, aviso y casilla DE LA VERSIÓN QUE SE MOSTRÓ', () => {
  it('sin cobro es el sha256 de textoAceptado() y está fijada', () => {
    expect(huellaAceptacion()).toBe(sha(textoAceptado()))
    expect(huellaAceptacion()).toBe(HUELLA_SIN_COBRO)
  })

  it('con cobro lleva el aviso v1.2 y la casilla con cobro, no los de la v1.1 (fila 15 de Vera)', () => {
    const tx = textoAceptado(VIGENTES_CON_COBRO)
    expect(tx).toContain(avisoComoSeLee(AVISO_DATOS_FORMULARIO_CON_COBRO))
    expect(tx).toContain(`Casilla: ${TEXTO_CASILLA_CON_COBRO}`)
    expect(tx).toContain('Aviso del formulario de registro · v1.2')
    expect(tx).not.toContain(`Casilla: ${TEXTO_CASILLA}`)
    expect(huellaAceptacion(tx)).toBe(HUELLA_CON_COBRO)
  })

  it('incluye la Política con su dirección', () => {
    expect(textoAceptado()).toContain(POLITICA_DATOS_VALIDA.url)
  })

  it('cambia si cambia el aviso o la casilla, no solo las Condiciones', () => {
    const base = huellaAceptacion()
    expect(huellaAceptacion(textoAceptado().replace(TEXTO_CASILLA, 'Acepto.'))).not.toBe(base)
    expect(huellaAceptacion(textoAceptado().replace(AVISO_DATOS_FORMULARIO, 'Otro aviso'))).not.toBe(base)
  })

  it('los Términos del registro, cuando existan, entran a la huella', () => {
    const conTerminos = textoAceptado(VIGENTES_CON_COBRO, { titulo: 'Términos de Uso de VALIDA', version: 'v2.0', texto: 'texto' })
    expect(huellaAceptacion(conTerminos)).not.toBe(HUELLA_CON_COBRO)
  })
})

describe('cuándo rigen las Condiciones con cobro', () => {
  it('sin la llave del cobro: v1.0', () => {
    expect(condicionesVigentes({ ...EPAYCO })).toBe(VIGENTES_SIN_COBRO)
  })

  it('con la llave pero sin ePayco o sin llave pública: v1.0, y no se pide tarjeta (fila 14 de Vera)', () => {
    expect(condicionesVigentes({ VALIDA_COBRO_TRAS_PRUEBA: '1' })).toBe(VIGENTES_SIN_COBRO)
    expect(condicionesVigentes({ ...COBRO, EPAYCO_HABILITADO: '0' })).toBe(VIGENTES_SIN_COBRO)
    expect(condicionesVigentes({ ...COBRO, EPAYCO_PUBLIC_KEY_METRIK: ' ' })).toBe(VIGENTES_SIN_COBRO)
  })

  it('en un preview, con la llave y ePayco: v2.0', () => {
    expect(condicionesVigentes({ ...COBRO, VERCEL_ENV: 'preview' }, false)).toBe(VIGENTES_CON_COBRO)
  })

  it('en producción: v1.0 mientras el interruptor siga en false, aunque haya Términos', () => {
    expect(CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION).toBe(false)
    expect(condicionesVigentes({ ...COBRO, VERCEL_ENV: 'production' }, true)).toBe(VIGENTES_SIN_COBRO)
  })

  it('la regla de ePayco es la misma del adaptador', () => {
    for (const env of [{}, EPAYCO, { ...EPAYCO, EPAYCO_HABILITADO: '0' }, { EPAYCO_HABILITADO: '1' }, { ...EPAYCO, EPAYCO_PUBLIC_KEY_METRIK: '' }]) {
      expect(epaycoPuedeTokenizar(env)).toBe(epaycoHabilitado(env) && llavePublicaEpayco(env) !== null)
    }
  })
})
