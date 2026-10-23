import { describe, expect, it } from 'vitest'
import {
  MENSAJE_TIPO_NO_RECONOCIDO,
  compactarTipo,
  leerTipoDocumento,
  mensajeTipoDocumento,
  tipoAceptadoPorValida,
} from './tipo-documento'

const tipo = (valor: string, numero = '10000001', persona: 'natural' | 'juridica' = 'natural') => {
  const l = leerTipoDocumento(valor, numero, persona)
  return l.estado === 'aceptado' || l.estado === 'pendiente' ? l.tipo : l.estado
}

describe('tipo de documento de la carga masiva', () => {
  it('compacta sin tildes, puntos, espacios ni guiones', () => {
    expect(compactarTipo(' Cédula de  Ciudadanía ')).toBe('CEDULADECIUDADANIA')
    expect(compactarTipo('c.c.')).toBe('CC')
    expect(compactarTipo('C-E')).toBe('CE')
  })

  it('CC: CC, CEDULA, CÉDULA, Cédula de ciudadanía, C.C', () => {
    for (const v of ['CC', 'cc', 'CEDULA', 'CÉDULA', 'cedula', 'Cédula de ciudadanía', 'CEDULA DE CIUDADANIA', 'C.C', 'C.C.', 'c c']) {
      expect(tipo(v), v).toBe('CC')
    }
  })

  it('CE: CE, Cédula de extranjería, C.E', () => {
    for (const v of ['CE', 'ce', 'CEDULA DE EXTRANJERIA', 'Cédula de Extranjería', 'C.E', 'C.E.']) expect(tipo(v), v).toBe('CE')
  })

  it('PAS: PP, PA, PAS, PASAPORTE, PASSPORT', () => {
    for (const v of ['PP', 'pp', 'PA', 'P.A.', 'PAS', 'Pasaporte', 'PASAPORTE', 'passport']) expect(tipo(v, 'AB123456'), v).toBe('PAS')
  })

  it('NIT: NIT, nit, N.I.T.', () => {
    for (const v of ['NIT', 'nit', 'N.I.T.']) expect(tipo(v, '900000001', 'juridica'), v).toBe('NIT')
  })

  it('TI, PPT y RC se reconocen pero Valida todavía no los acepta: no se convierten en otro tipo', () => {
    expect(leerTipoDocumento('TI', '10000001', 'natural')).toEqual({ estado: 'pendiente', tipo: 'TI' })
    expect(leerTipoDocumento('Tarjeta de identidad', '10000001', 'natural')).toEqual({ estado: 'pendiente', tipo: 'TI' })
    expect(leerTipoDocumento('PPT', '10000001', 'natural')).toEqual({ estado: 'pendiente', tipo: 'PPT' })
    expect(leerTipoDocumento('Permiso por protección temporal', '10000001', 'natural')).toEqual({ estado: 'pendiente', tipo: 'PPT' })
    expect(leerTipoDocumento('Registro civil', '10000001', 'natural')).toEqual({ estado: 'pendiente', tipo: 'RC' })
    expect(mensajeTipoDocumento({ estado: 'pendiente', tipo: 'TI' })).toContain('tarjeta de identidad (TI)')
    expect(mensajeTipoDocumento({ estado: 'pendiente', tipo: 'TI' })).toContain('no se consultó ni se cobró')
  })

  it('lo irreconocible («X», un número en la columna, PEP) dice qué valores usar', () => {
    for (const v of ['X', '900000001', '10000001', 'PEP', 'OTRO']) {
      const l = leerTipoDocumento(v, '10000001', 'natural')
      expect(l, v).toEqual({ estado: 'no_reconocido', valor: v })
      expect(mensajeTipoDocumento(l)).toBe(MENSAJE_TIPO_NO_RECONOCIDO)
    }
    expect(MENSAJE_TIPO_NO_RECONOCIDO).toContain('usa CC, CE, NIT o PAS')
  })

  it('vacío con número: jurídica → NIT; natural → CC, o PAS si el número trae letras', () => {
    expect(leerTipoDocumento('', '900000001', 'juridica')).toEqual({ estado: 'aceptado', tipo: 'NIT', inferido: true })
    expect(leerTipoDocumento('  ', '10000001', 'natural')).toEqual({ estado: 'aceptado', tipo: 'CC', inferido: true })
    expect(leerTipoDocumento(undefined, 'AB123456', 'natural')).toEqual({ estado: 'aceptado', tipo: 'PAS', inferido: true })
  })

  it('vacío sin número: la fila consulta solo por nombre, como siempre', () => {
    expect(leerTipoDocumento('', '', 'natural')).toEqual({ estado: 'sin_documento' })
    expect(leerTipoDocumento(null, null, 'juridica')).toEqual({ estado: 'sin_documento' })
  })

  it('solo CC, CE, NIT y PAS se mandan a Valida hoy', () => {
    expect(['CC', 'CE', 'NIT', 'PAS'].every((t) => tipoAceptadoPorValida(t))).toBe(true)
    expect(['TI', 'PPT', 'RC', 'CEDULA', 'PP', '', null, undefined].some((t) => tipoAceptadoPorValida(t))).toBe(false)
  })
})
