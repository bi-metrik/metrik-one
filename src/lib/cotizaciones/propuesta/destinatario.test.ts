/**
 * A quién va dirigida la propuesta (Mauricio, 2026-10-27): el contacto del negocio con nombre
 * propio y, si la empresa es persona jurídica, también la empresa.
 */
import { describe, expect, it } from 'vitest'
import { destinatarioDeLaPropuesta, nombrePropio, textoDelDestinatario } from './destinatario'
import { modeloDePropuesta } from './modelo-documento'
import { ENTRADA_CURAZAO } from '../../../../test/propuesta-curazao'

describe('nombrePropio', () => {
  it('en mayúsculas → nombre propio, tildes intactas', () => {
    expect(nombrePropio('RICARDO PEÑUELA')).toBe('Ricardo Peñuela')
    expect(nombrePropio('  ÁLVARO   NÚÑEZ ')).toBe('Álvaro Núñez')
  })

  it('las partículas de/del/la van en minúscula, salvo al comienzo', () => {
    expect(nombrePropio('MARÍA DE LA CRUZ DEL CASTILLO')).toBe('María de la Cruz del Castillo')
    expect(nombrePropio('de la torre andrés')).toBe('De la Torre Andrés')
    expect(nombrePropio('ANA MARÍA GÓMEZ-RESTREPO')).toBe('Ana María Gómez-Restrepo')
  })

  it('con mayúsculas y minúsculas se respeta tal cual', () => {
    expect(nombrePropio('Ana McAllister')).toBe('Ana McAllister')
    expect(nombrePropio('Juan de La Hoz')).toBe('Juan de La Hoz')
  })

  it('vacío → null', () => {
    expect(nombrePropio('   ')).toBeNull()
    expect(nombrePropio(null)).toBeNull()
  })
})

describe('destinatarioDeLaPropuesta', () => {
  it('persona natural: solo el contacto, aunque la empresa tenga otro nombre', () => {
    expect(destinatarioDeLaPropuesta({ contacto: 'RICARDO PEÑUELA', empresa: 'RICARDO PEÑUELA', tipoPersona: 'natural' })).toEqual({ nombre: 'Ricardo Peñuela', empresa: null })
    expect(destinatarioDeLaPropuesta({ contacto: 'Ana', empresa: 'Otra', tipoPersona: 'natural' })).toEqual({ nombre: 'Ana', empresa: null })
  })

  it('persona jurídica: contacto · empresa, la empresa como está guardada', () => {
    const d = destinatarioDeLaPropuesta({ contacto: 'ANA GÓMEZ', empresa: 'VIAJES XYZ S.A.S.', tipoPersona: 'juridica' })!
    expect(textoDelDestinatario(d)).toBe('Ana Gómez · VIAJES XYZ S.A.S.')
    // Sin tipo de persona no se supone jurídica; una jurídica con el nombre del contacto no se repite.
    expect(destinatarioDeLaPropuesta({ contacto: 'Ana', empresa: 'XYZ', tipoPersona: null })!.empresa).toBeNull()
    expect(destinatarioDeLaPropuesta({ contacto: 'ANA GÓMEZ', empresa: 'Ana Gomez', tipoPersona: 'juridica' })!.empresa).toBeNull()
  })

  it('sin contacto no hay destinatario (el documento vuelve a los pasajeros)', () => {
    expect(destinatarioDeLaPropuesta({ contacto: null, empresa: 'XYZ S.A.S.', tipoPersona: 'juridica' })).toBeNull()
    expect(destinatarioDeLaPropuesta(null)).toBeNull()
  })

  it('llega al modelo de la propuesta', () => {
    expect(modeloDePropuesta(ENTRADA_CURAZAO).portada.destinatario).toEqual({ nombre: 'Andrés de la Torre', empresa: null })
    expect(modeloDePropuesta({ ...ENTRADA_CURAZAO, cliente: null }).portada.destinatario).toBeNull()
  })
})
