import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POLITICA_DATOS_VALIDA } from '@/lib/valida-api/politica'
import { epaycoHabilitado, llavePublicaEpayco } from '@/lib/suscripciones/pasarela/epayco'
import {
  AVISO_DATOS_FORMULARIO,
  AVISO_DATOS_FORMULARIO_CON_COBRO,
  AVISO_REGISTRO,
  AVISO_REGISTRO_CON_COBRO,
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
 *   - con cobro: Condiciones v2.1 + aviso v1.5 + casilla con cobro (2026-10-19: el aviso nombra el
 *     documento del titular de la tarjeta, a ePayco como responsable y la consulta a centrales de
 *     riesgo, aprobado por Emilio). Las anteriores, que conservan los registros que las aceptaron:
 *     v1.4 82df1921e925fadedd7d6424be95b8c27b44411e3dc84bf3afb125d0849aa033 (2026-10-19, nunca publicada)
 *     y v1.3 471774f367828d7d9dbf2c1eb61d7771963af37403c6fa50274b5066eccd73f0 (2026-10-14).
 */
const HUELLA_SIN_COBRO = '88ddf9d4d3050e5b309041c6693dbf3d0174bd0d2e7020e1fa32f957a5d2ae80'
const HUELLA_CON_COBRO = '4e0c3bddab4169c590e3ca0f3673aef94b451115d7d76db5027761c4b4705ce9'

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

describe('con cobro: Condiciones v2.1 completas, aviso v1.2 y casilla con cobro', () => {
  const t = CONDICIONES_PRUEBA_CON_COBRO.texto

  it('versión 2.1 y aviso 1.2', () => {
    expect(t).toMatch(/^CONDICIONES DE LA PRUEBA GRATIS DE VALIDA · Versión 2\.1/)
    expect(versionAceptada(VIGENTES_CON_COBRO)).toBe('condiciones-2.1+aviso-1.5+terminos-auto-2.1')
    // El texto es el de `proyectos/metrik/valida/docs/legal/condiciones-prueba-valida-v2.1.md` (los tres bloques
    // `text`, unidos con una línea en blanco), comparado letra por letra el 2026-10-14 con el 7.3 final de Emilio.
    expect(sha(t)).toBe('59e74708b7cd41bda2bbbc6052de8d953b49aa101b9fe6549565e4252146e07b')
  })

  it('el numeral 1 ya no dice que no pide tarjeta, y autoriza el cobro de cada mes (Vera)', () => {
    expect(t).not.toContain('no pide tarjeta')
    expect(t).not.toContain('solo se le cobra el primer mes')
    expect(t).toContain(
      'Para abrirla, la Empresa registra un medio de pago. Si no cancela a tiempo, a ese medio de pago se le cobra el plan mensual de Valida: el primer mes cuando la Empresa confirma en su cuenta que activa el plan o, si no lo confirma, al cumplirse los 7 días, y después cada mes, hasta que se retire, como dicen los numerales 7.1 y 7.4.',
    )
  })

  it('el 7 ya no dice «al terminar la prueba»; el 7.1 da los dos momentos y el (b) sigue «después, nunca antes»', () => {
    expect(t).toContain('7. Medio de pago y cobro del primer mes.')
    expect(t).not.toContain('al terminar la prueba')
    expect(t).not.toContain('Al terminar la prueba')
    // La regla de la v2.0 que la v2.1 cambia (decisión de Mauricio, 2026-10-14).
    expect(t).not.toContain('El cobro no se adelanta aunque las 10 consultas se agoten antes.')
    expect(t).toContain('en el primero de estos dos momentos: (a) cuando la Empresa confirma en su cuenta en Valida que activa el plan.')
    expect(t).toContain('Valida le pide esa confirmación cuando intenta una consulta después de agotar las 10 de la prueba')
    expect(t).toContain('la pantalla muestra el valor y los últimos 4 dígitos de la tarjeta, y el cobro se hace en ese momento')
    expect(t).toContain('(b) si la Empresa no ha confirmado ni cancelado, al cumplirse los 7 días de la prueba.')
    expect(t).toContain('este cobro se hace después de ese momento, nunca antes.')
    expect(t).toContain('Sin la confirmación del literal (a), agotar las 10 consultas no adelanta el cobro.')
    // El aviso de 48 h es del (b); cancelar, hasta confirmar; si el primer cobro falla, no se reintenta.
    expect(t).toContain('7.2. Aviso previo. Para el cobro del literal (b) del numeral 7.1')
    expect(t).toContain('antes de que se cumplan los 7 días de la prueba y antes de que se le cobre el primer mes.')
  })

  it('los cambios C1 a C4 del dictamen de Emilio y el 7.5 de la decisión del 2026-10-14, literales', () => {
    // C1: numeral 1.
    expect(t).toContain(
      'Termina cuando se agotan las 10 consultas, cuando pasan los 7 días o cuando la Empresa confirma que activa el plan (numeral 7.1, literal a), lo que ocurra primero. Es gratis: la prueba no se cobra.',
    )
    expect(t).not.toContain('durante la prueba no se cobra nada')
    expect(t).not.toContain('Durante la prueba no se cobra nada')
    // C2: final del párrafo 7.
    expect(t).toContain('METRIK no guarda los datos de la tarjeta: los guarda la pasarela. La prueba no se cobra; el plan se cobra solo en los momentos del numeral 7.1.')
    // C3: final del 7.2.
    expect(t).toContain(
      'Después del cobro del literal (a), METRIK envía al correo registrado la confirmación del cobro, con la fecha, el valor y los últimos 4 dígitos de la tarjeta.',
    )
    // C4: numeral 8.
    expect(t).toContain(
      'registrado en la pasarela. Si la Empresa confirma la activación del plan (numeral 7.1, literal a), METRIK guarda además la fecha y hora de la confirmación, el usuario, la dirección IP y el texto exacto que vio antes de confirmar.',
    )
    // 7.5: el rechazo del (a) conserva la prueba y deja en pie el (b); el del (b) cierra.
    expect(t).toContain(
      '7.5. Si el cobro falla. Si falla el cobro del literal (a) del numeral 7.1, no se activa el plan, METRIK envía un enlace de pago y la Empresa conserva lo que le quede de la prueba, las consultas y el plazo; si no paga ni cancela antes, el cobro del literal (b) sigue en pie al cumplirse los 7 días, con el aviso del numeral 7.2. Si falla el cobro del literal (b), no se activa el plan, no se vuelve a intentar con la tarjeta y METRIK envía un enlace de pago.',
    )
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

  it('el aviso v1.5 nombra el documento del titular, a ePayco como responsable y la consulta a centrales de riesgo, literal de Emilio (2026-10-19)', () => {
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO).toContain(
      'A METRIK le llegan una referencia de la tarjeta (token) y el nombre, el tipo y el número de documento del titular de la tarjeta, que guarda junto con su celular solo para cobrar el plan como dicen las Condiciones y prevenir fraude, hasta que se cancele el plan y se borre la tarjeta. Para registrar la tarjeta y hacer los cobros le entregamos a ePayco el nombre y el documento del titular, su celular y su correo. ePayco los trata como responsable, según su propia política: para prevenir fraude los compara con los de la tarjeta y puede consultarlos ante centrales de riesgo y bureaus de información, lo que usted autoriza. Si la tarjeta es de otra persona, usted declara que esa persona lo autorizó a entregar estos datos y a esa consulta, para este fin. Si indica que lo recomendó AFI',
    )
    // Lo de la v1.4 ya no está: ePayco «los compara… y los trata según su propia política», sin la consulta.
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO).not.toContain('su celular y su correo; ePayco los compara')
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO).not.toContain('a entregar estos datos para este fin.')
    // Lo de la v1.3 ya no está: «solo» el token y el NIT a ePayco.
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO).not.toContain('A METRIK solo le llega')
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO).not.toContain('su correo y el NIT.')
    // Lo de antes y lo de después del tramo, igual que en la v1.3.
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO.startsWith('METRIK IA S.A.S. (NIT 902.079.601-9) es la responsable de sus datos.')).toBe(true)
    expect(AVISO_DATOS_FORMULARIO_CON_COBRO).toContain('no METRIK. A METRIK le llegan')
  })

  it('la casilla con cobro (aviso v1.3) dice los dos momentos del primer mes, con el léxico de la 7.1, y cada mes siguiente', () => {
    expect(TEXTO_CASILLA_CON_COBRO).toContain('el primer mes cuando confirme en mi cuenta que activo el plan')
    expect(TEXTO_CASILLA_CON_COBRO).toContain('lo que Valida me pide cuando intento una consulta después de agotar las 10 de la prueba o antes con el botón "Activar plan"')
    expect(TEXTO_CASILLA_CON_COBRO).toContain('si no lo confirmo ni cancelo, después de que se cumplan los 7 días de la prueba y nunca antes')
    expect(TEXTO_CASILLA_CON_COBRO).toContain('y después cada mes hasta que me retire')
    expect(TEXTO_CASILLA_CON_COBRO).not.toContain('si no cancelo antes de que se cumplan los 7 días (el primer mes')
    expect(TEXTO_CASILLA_CON_COBRO).toContain('los Términos de Uso de Valida')
    // Un solo renglón: `casillaMarcada` la recupera de lo aceptado con «Casilla: …».
    expect(TEXTO_CASILLA_CON_COBRO).not.toContain('\n')
    expect(AVISO_REGISTRO_CON_COBRO.version).toBe('1.5')
  })

  it('el texto junto a la tarjeta lleva la fecha y la hora en que se cumplen los 7 días', () => {
    const x = textoJuntoATarjeta('martes, 20 de octubre de 2026, 3:00 p. m.')
    // C5 del dictamen de Emilio, literal.
    expect(x).toBe(
      'La prueba es gratis. El primer mes, $150.000, se cobra cuando usted confirme en su cuenta que activa el plan: Valida se lo pide si intenta una consulta después de agotar las 10 de la prueba, y también puede hacerlo antes con el botón "Activar plan". Si no lo confirma ni cancela antes del martes, 20 de octubre de 2026, 3:00 p. m., se cobra después de ese momento, nunca antes. Luego se cobra cada mes hasta que se retire. La tarjeta la guarda ePayco, no METRIK.',
    )
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
    expect(tx).toContain('Aviso del formulario de registro · v1.5')
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
