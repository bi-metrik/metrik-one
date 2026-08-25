import { describe, it, expect } from 'vitest'
import {
  canonizarSeccional,
  seccionalDesdeRut,
  requiereCitaDian,
  nombreOficialSeccional,
  resolverSeccionalOficial,
  SECCIONALES_DIAN,
} from './seccionales'

/**
 * El catálogo reconocía una seccional por SUBCADENA: bastaba que el texto contuviera el
 * nombre de una ciudad. Medido en SOENA el 2026-08-25 sobre los 289 bloques RUT con
 * `direccion_seccional`, eso aceptaba "Cámara de Comercio de Medellín para Antioquia"
 * como Medellín — una cámara de comercio, no una seccional.
 *
 * Ahora se exige IGUALDAD del núcleo (el texto sin el prefijo con que la DIAN nombra la
 * seccional). Estas pruebas fijan las dos mitades del trato: lo que debe seguir
 * entrando, y lo que ya no.
 */

/** Las 23 formas DISTINTAS medidas en producción (SOENA, 2026-08-25). */
const REALES_QUE_DEBEN_RESOLVER: Array<[string, string]> = [
  ['Impuestos de Bogotá', 'Bogotá'],
  ['Bogotá', 'Bogotá'],
  ['Bogotá D.C.', 'Bogotá'],
  ['Impuestos de Medellín', 'Medellín'],
  ['Impuestos de Medellin', 'Medellín'],
  ['Impuestos de Cali', 'Cali'],
  ['Impuestos y Aduanas de Bucaramanga', 'Bucaramanga'],
  ['Impuestos y Aduanas de Manizales', 'Manizales'],
  ['Impuestos de Barranquilla', 'Barranquilla'],
  ['Impuestos y Aduanas de Pereira', 'Pereira'],
  ['Impuestos y Aduanas de Villavicencio', 'Villavicencio'],
  ['Impuestos y Aduanas de Tuluá', 'Tuluá'],
  // Acento invertido, tal cual lo extrajo la IA de un RUT real.
  ['Impuestos y Aduanas de Tuluà', 'Tuluá'],
  ['Impuestos y Aduanas de Tunja', 'Tunja'],
  ['Impuestos y Aduanas de Girardot', 'Girardot'],
  ['Impuestos de Cúcuta', 'Cúcuta'],
  ['Impuestos y Aduanas de Palmira', 'Palmira'],
  ['Impuestos y Aduanas de Armenia', 'Armenia'],
  ['Impuestos y Aduanas de Ibagué', 'Ibagué'],
  ['Impuestos y Aduanas de Montería', 'Montería'],
  ['Impuestos de Cartagena', 'Cartagena'],
  // Forma que la comparación por subcadena resolvía de casualidad y un "match exacto"
  // ingenuo habría roto: 7 apariciones reales, medidas antes de tocar nada.
  ['Seccional de Medellín', 'Medellín'],
]

describe('el motor sigue leyendo la seccional del RUT', () => {
  it.each(REALES_QUE_DEBEN_RESOLVER)('resuelve %s → %s', (texto, esperado) => {
    expect(canonizarSeccional(texto)).toBe(esperado)
  })

  it('acepta el nombre oficial completo de las 35 seccionales', () => {
    for (const s of SECCIONALES_DIAN) {
      expect(seccionalDesdeRut(s.nombre_oficial, s.tipo_persona)?.slug, s.nombre_oficial).toBe(s.slug)
    }
  })

  it('acepta el label del catálogo y la ciudad suelta', () => {
    for (const s of SECCIONALES_DIAN) {
      expect(seccionalDesdeRut(s.label, s.tipo_persona)?.slug, s.label).toBe(s.slug)
      if (s.ciudad) expect(seccionalDesdeRut(s.ciudad, s.tipo_persona)?.slug, s.ciudad).toBe(s.slug)
    }
  })

  it('acepta el slug del catálogo, que hay superficies que guardan tal cual', () => {
    // `preparar_correo_al_cliente` escribe `data.seccional = 'bogota-naturales'`.
    expect(canonizarSeccional('bogota-naturales')).toBe('Bogotá')
    // El buzón lo decide el solicitante, no el texto: sin tipo_persona cae a naturales,
    // igual que con cualquier otra forma de escribir Bogotá.
    expect(seccionalDesdeRut('bogota-juridicas')?.slug).toBe('bogota-naturales')
    expect(seccionalDesdeRut('bogota-naturales', 'juridica')?.slug).toBe('bogota-juridicas')
    for (const s of SECCIONALES_DIAN) {
      expect(seccionalDesdeRut(s.slug, s.tipo_persona)?.slug, s.slug).toBe(s.slug)
    }
  })

  it('no depende de mayúsculas ni de tildes', () => {
    expect(canonizarSeccional('IMPUESTOS DE MEDELLIN')).toBe('Medellín')
    expect(canonizarSeccional('impuestos y aduanas de bucaramanga')).toBe('Bucaramanga')
  })

  it('conserva el corte con/sin cita, que es lo que mueve el proceso', () => {
    expect(requiereCitaDian('Impuestos de Bogotá').requiere_cita).toBe(true)
    expect(requiereCitaDian('Impuestos de Medellín').requiere_cita).toBe(true)
    expect(requiereCitaDian('Impuestos de Cali').requiere_cita).toBe(true)
    expect(requiereCitaDian('Impuestos y Aduanas de Bucaramanga').requiere_cita).toBe(true)
    expect(requiereCitaDian('Impuestos de Barranquilla').requiere_cita).toBe(false)
    expect(requiereCitaDian('Impuestos y Aduanas de Manizales').requiere_cita).toBe(false)
  })

  it('sigue eligiendo el buzón de Bogotá por tipo de persona', () => {
    expect(seccionalDesdeRut('Impuestos de Bogotá', 'natural')?.slug).toBe('bogota-naturales')
    expect(seccionalDesdeRut('Impuestos de Bogotá', 'juridica')?.slug).toBe('bogota-juridicas')
    expect(seccionalDesdeRut('Bogotá D.C.', 'jurídica')?.slug).toBe('bogota-juridicas')
  })
})

describe('un texto que solo MENCIONA una ciudad ya no es una seccional', () => {
  // El caso que abrió el frente: existe en SOENA (V0253) y entraba como Medellín.
  it('rechaza "Cámara de Comercio de Medellín para Antioquia"', () => {
    expect(canonizarSeccional('Cámara de Comercio de Medellín para Antioquia')).toBeNull()
    expect(seccionalDesdeRut('Cámara de Comercio de Medellín para Antioquia')).toBeNull()
    expect(resolverSeccionalOficial('Cámara de Comercio de Medellín para Antioquia', null)).toBeNull()
  })

  it.each([
    'Notaría 15 de Bogotá',
    'Cámara de Comercio de Cali',
    'Alcaldía de Medellín',
    'Bogotá y Medellín',
    'Sucursal Bucaramanga Norte',
  ])('rechaza %s', texto => {
    expect(canonizarSeccional(texto)).toBeNull()
  })

  it('sigue rechazando lo que ya rechazaba', () => {
    // "Otras seccionales" es una clave de preset del 010, no una seccional.
    expect(canonizarSeccional('Otras seccionales')).toBeNull()
    // Error de extracción sobre un RUT real (V0382).
    expect(canonizarSeccional('Impuestos de Bougia')).toBeNull()
    expect(canonizarSeccional('Seccional inexistente XYZ')).toBeNull()
    expect(canonizarSeccional(null)).toBeNull()
    expect(canonizarSeccional('   ')).toBeNull()
  })

  it('un prefijo DIAN sin ciudad no resuelve nada', () => {
    expect(canonizarSeccional('Impuestos de')).toBeNull()
    expect(canonizarSeccional('Dirección Seccional de')).toBeNull()
  })

  it('nombreOficialSeccional devuelve el texto crudo, no una seccional inventada', () => {
    // Su contrato es no romper el render: sin match, el operador corrige en la casilla.
    expect(nombreOficialSeccional('Cámara de Comercio de Medellín para Antioquia'))
      .toBe('Cámara de Comercio de Medellín para Antioquia')
    expect(nombreOficialSeccional('Impuestos de Cali'))
      .toBe('Dirección Seccional de Impuestos de Cali')
  })
})
