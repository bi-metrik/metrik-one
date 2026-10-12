import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POLITICA_DATOS_VALIDA } from '@/lib/valida-api/politica'
import {
  AVISO_DATOS_FORMULARIO,
  AVISO_REGISTRO,
  CONDICIONES_PRUEBA,
  PRUEBA_DE_LAS_CONDICIONES,
  TEXTO_CASILLA,
  VERSION_ACEPTADA,
  avisoComoSeLee,
  condicionesVigentes,
  textoAceptado,
  versionAceptada,
} from './condiciones'
import { CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION } from './condiciones-cobro'
import { huellaAceptacion } from './registro-servidor'
import { PRUEBA_POR_DEFECTO } from './llave'

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

/**
 * Huella de la constancia v1.0 + aviso v1.0, calculada al aprobar los textos (2026-10-11). Si esta
 * prueba falla, cambió una letra de lo que la persona lee: hay que subir la versión que corresponda
 * (`CONDICIONES_PRUEBA.version` o `AVISO_REGISTRO.version`) y, solo entonces, actualizar el valor.
 */
const HUELLA_APROBADA = 'f30a79e98d2368f37734abf8319b4dc2c2d2cd5708f0a79b1e3cdedcf5a3a270'

describe('los textos aprobados', () => {
  it('versiones 1.0, ya no el borrador', () => {
    expect(CONDICIONES_PRUEBA.version).toBe('1.0')
    expect(AVISO_REGISTRO.version).toBe('1.0')
    expect(VERSION_ACEPTADA).toBe('condiciones-1.0+aviso-1.0')
  })

  it('las Condiciones traen los tres bloques y NO la cláusula de cobro (inactiva hasta ePayco)', () => {
    expect(CONDICIONES_PRUEBA.texto).toMatch(/^CONDICIONES DE LA PRUEBA GRATIS DE VALIDA · Versión 1\.0/)
    expect(CONDICIONES_PRUEBA.texto).toContain('6. Datos de las personas consultadas (acuerdo de encargo).')
    expect(CONDICIONES_PRUEBA.texto).toContain('7. Al terminar la prueba.')
    expect(CONDICIONES_PRUEBA.texto).toContain('8. Aceptación y contacto.')
    expect(CONDICIONES_PRUEBA.texto).not.toMatch(/Medio de pago y cobro|\$150\.000|\{nombre_pasarela\}/)
  })

  it('los números que prometen las Condiciones son los de la prueba por defecto', () => {
    expect(PRUEBA_DE_LAS_CONDICIONES).toEqual(PRUEBA_POR_DEFECTO)
    expect(CONDICIONES_PRUEBA.texto).toContain(
      `La prueba da ${PRUEBA_DE_LAS_CONDICIONES.consultas} consultas de listas restrictivas y vinculantes durante ${PRUEBA_DE_LAS_CONDICIONES.dias} días calendario`,
    )
  })

  it('el aviso termina en «…están en la» y la pantalla lo completa con la Política', () => {
    expect(AVISO_DATOS_FORMULARIO.endsWith('están en la')).toBe(true)
    expect(avisoComoSeLee()).toBe(
      `${AVISO_DATOS_FORMULARIO} Política de Tratamiento de Datos Personales (https://valida.metrik.com.co/recursos/privacidad).`,
    )
  })

  it('la casilla acepta por la empresa y autoriza los datos propios', () => {
    expect(TEXTO_CASILLA).toBe(
      'Acepto, en nombre de la empresa, las Condiciones de la prueba gratis, incluido el encargo de los datos de las personas que consulte, y autorizo el tratamiento de mis datos según este aviso.',
    )
  })
})

describe('la huella cubre Condiciones, aviso y casilla', () => {
  it('es el sha256 de textoAceptado()', () => {
    expect(huellaAceptacion()).toBe(sha(textoAceptado()))
    expect(huellaAceptacion()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('textoAceptado() incluye las tres piezas con sus versiones', () => {
    const t = textoAceptado()
    expect(t).toContain(CONDICIONES_PRUEBA.texto)
    expect(t).toContain(avisoComoSeLee())
    expect(t).toContain(TEXTO_CASILLA)
    expect(t).toContain('v1.0')
    expect(t).toContain(POLITICA_DATOS_VALIDA.url)
  })

  it('cambia si cambia el aviso o la casilla, no solo las Condiciones', () => {
    const base = huellaAceptacion()
    expect(huellaAceptacion(textoAceptado().replace(TEXTO_CASILLA, 'Acepto.'))).not.toBe(base)
    expect(huellaAceptacion(textoAceptado().replace(AVISO_DATOS_FORMULARIO, 'Otro aviso'))).not.toBe(base)
  })

  it('está fijada: un cambio de texto sin subir versión rompe esta prueba', () => {
    expect(huellaAceptacion()).toBe(HUELLA_APROBADA)
  })
})

describe('la cláusula de cobro al terminar la prueba, INACTIVA', () => {
  const llena = {
    VALIDA_COBRO_TRAS_PRUEBA: '1',
    VALIDA_COBRO_PASARELA: 'ePayco',
    VALIDA_COBRO_HORAS_AVISO: '48',
    VALIDA_COBRO_LUGAR_CANCELAR: 'Suscripción > Cancelar prueba',
  }

  it('hoy las Condiciones vigentes son la v1.0 sin cobro, con o sin la llave en producción', () => {
    expect(condicionesVigentes({})).toMatchObject({ version: '1.0', conCobro: false, texto: CONDICIONES_PRUEBA.texto })
    expect(condicionesVigentes({ ...llena, VERCEL_ENV: 'production' })).toMatchObject({ version: '1.0', conCobro: false })
    expect(CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION).toBe(false)
  })

  it('sin uno de sus campos no se activa ni en preview', () => {
    expect(condicionesVigentes({ ...llena, VALIDA_COBRO_HORAS_AVISO: '' }).conCobro).toBe(false)
    expect(condicionesVigentes({ ...llena, VALIDA_COBRO_PASARELA: undefined }).conCobro).toBe(false)
  })

  it('en preview, con la llave y los campos, REEMPLAZA el numeral 7 y sube a 2.0', () => {
    const c = condicionesVigentes({ ...llena, VERCEL_ENV: 'preview', VALIDA_PLAN_LIMITE_MES: '3000' })
    expect(c.conCobro).toBe(true)
    expect(c.version).toBe('2.0')
    expect(versionAceptada(c)).toBe('condiciones-2.0+aviso-1.0')
    expect(c.texto).toMatch(/^CONDICIONES DE LA PRUEBA GRATIS DE VALIDA · Versión 2\.0/)
    expect(c.texto).not.toContain('7. Al terminar la prueba.')
    expect(c.texto).toContain(
      '7. Medio de pago y cobro al terminar la prueba. Para abrir la prueba, la Empresa registra un medio de pago en la pasarela ePayco.',
    )
    expect(c.texto).toContain('$150.000, valor total, sin IVA que sumar')
    expect(c.texto).toContain('con hasta 3.000 consultas al mes')
    expect(c.texto).toContain('al menos 48 horas antes del cobro')
    expect(c.texto).toContain('desde Suscripción > Cancelar prueba')
    expect(c.texto).not.toMatch(/\{[a-z_]+\}/)
    expect(c.texto).toContain('8. Aceptación y contacto.')
    // Su huella es otra: la constancia dice cuál de las dos se aceptó.
    expect(huellaAceptacion(textoAceptado(c))).not.toBe(HUELLA_APROBADA)
  })
})
