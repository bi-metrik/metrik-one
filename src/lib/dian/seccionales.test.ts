import { describe, it, expect } from 'vitest'
import { requiereCitaDian, seccionalDesdeRut, mapCiudadASeccional, SECCIONALES_DIAN } from './seccionales'

/**
 * Los textos de entrada son los valores REALES que la extracción del RUT
 * (casilla 12) dejó en los negocios de SOENA. El prefijo varía entre
 * "Impuestos de X" e "Impuestos y Aduanas de X", por eso el match no puede
 * ser literal.
 */
describe('requiereCitaDian', () => {
  it('exige cita en las cuatro seccionales acordadas con Deisy (2026-07-24)', () => {
    expect(requiereCitaDian('Impuestos de Bogotá').requiere_cita).toBe(true)
    expect(requiereCitaDian('Impuestos de Medellín').requiere_cita).toBe(true)
    expect(requiereCitaDian('Impuestos de Cali').requiere_cita).toBe(true)
    expect(requiereCitaDian('Impuestos y Aduanas de Bucaramanga').requiere_cita).toBe(true)
  })

  it('NO exige cita en Barranquilla ni en Grandes Contribuyentes', () => {
    // Cambio 2026-07-26: la Guia v3 los traia con cita; la reunion de cierre VE
    // acoto la exigencia a cuatro seccionales y Juan David confirmo que la costa
    // no requiere cita.
    expect(requiereCitaDian('Impuestos de Barranquilla').requiere_cita).toBe(false)
    expect(requiereCitaDian('Dirección Operativa de Grandes Contribuyentes').requiere_cita).toBe(false)
  })

  it('NO exige cita en el resto de seccionales presentes en SOENA', () => {
    for (const texto of [
      'Impuestos y Aduanas de Montería',
      'Impuestos y Aduanas de Tuluá',
      'Impuestos y Aduanas de Tunja',
      'Impuestos de Cúcuta',
      'Impuestos y Aduanas de Girardot',
      'Impuestos y Aduanas de Ibagué',
      'Impuestos y Aduanas de Manizales',
    ]) {
      expect(requiereCitaDian(texto).requiere_cita, texto).toBe(false)
    }
  })

  it('tolera acentos ausentes, mayusculas y el nombre oficial completo', () => {
    expect(requiereCitaDian('IMPUESTOS DE MEDELLIN').requiere_cita).toBe(true)
    expect(requiereCitaDian('medellin').requiere_cita).toBe(true)
    expect(
      requiereCitaDian('Dirección Seccional de Impuestos y Aduanas de Bucaramanga').requiere_cita,
    ).toBe(true)
  })

  it('devuelve null (no false) cuando no puede resolver la seccional', () => {
    // Fail-safe: asumir false haria que un caso que si necesita cita se salte la
    // etapa y llegue a la DIAN sin ella. Ante la duda decide el comercial.
    expect(requiereCitaDian('Seccional inexistente XYZ').requiere_cita).toBeNull()
    expect(requiereCitaDian(null).requiere_cita).toBeNull()
    expect(requiereCitaDian('').requiere_cita).toBeNull()
    expect(requiereCitaDian('   ').requiere_cita).toBeNull()
  })

  it('Bogota exige cita con cualquiera de sus dos buzones', () => {
    const natural = requiereCitaDian('Impuestos de Bogotá', 'natural')
    const juridica = requiereCitaDian('Impuestos de Bogotá', 'juridica')
    expect(natural.requiere_cita).toBe(true)
    expect(juridica.requiere_cita).toBe(true)
    expect(natural.seccional?.slug).toBe('bogota-naturales')
    expect(juridica.seccional?.slug).toBe('bogota-juridicas')
  })
})

describe('seccionalDesdeRut', () => {
  it('resuelve la entrada completa del catalogo, no solo el nombre', () => {
    const s = seccionalDesdeRut('Impuestos y Aduanas de Bucaramanga')
    expect(s?.slug).toBe('bucaramanga')
    expect(s?.codigo).toBe('04')
    expect(s?.email).toBe('dsia_bucaramanga_devoluciones@dian.gov.co')
  })

  it('cada seccional del catalogo se resuelve desde su propio nombre oficial', () => {
    for (const seccional of SECCIONALES_DIAN) {
      const resuelta = seccionalDesdeRut(seccional.nombre_oficial, seccional.tipo_persona)
      expect(resuelta?.slug, seccional.slug).toBe(seccional.slug)
    }
  })
})

describe('el domicilio fiscal manda sobre la ciudad de compra', () => {
  // Caso V0226 (SOENA, 2026-08-18): el vehiculo se compro en Bogota y la clienta
  // tributa en Barranquilla. El correo al cliente derivaba la seccional de la ciudad
  // de la FACTURA y nombraba Bogota, mientras el formulario 010 llevaba Barranquilla,
  // que es la correcta. Las dos superficies leian fuentes distintas.
  it('el RUT y la ciudad de la factura pueden discrepar, y gana el RUT', () => {
    const porRut = seccionalDesdeRut('Impuestos de Barranquilla')
    const porCiudadDeCompra = mapCiudadASeccional('BOGOTA, D.C.', 'natural')

    expect(porRut?.slug).toBe('barranquilla')
    expect(porCiudadDeCompra?.slug).toBe('bogota-naturales')
    expect(porRut?.slug).not.toBe(porCiudadDeCompra?.slug)
    // Y el buzon del correo sale de la misma entrada, asi que tampoco se cruzan.
    expect(porRut?.email).not.toBe(porCiudadDeCompra?.email)
  })

  it('el texto del RUT llega con el prefijo "Impuestos de" y se resuelve igual', () => {
    expect(seccionalDesdeRut('Impuestos de Cali')?.slug).toBe('cali')
    expect(seccionalDesdeRut('Impuestos de Barranquilla')?.slug).toBe('barranquilla')
  })
})

describe('catalogo', () => {
  it('exactamente cinco entradas exigen cita (las 4 ciudades, con Bogota duplicada por buzon)', () => {
    const conCita = SECCIONALES_DIAN.filter(s => s.cita).map(s => s.slug).sort()
    expect(conCita).toEqual([
      'bogota-juridicas',
      'bogota-naturales',
      'bucaramanga',
      'cali',
      'medellin',
    ])
  })
})
