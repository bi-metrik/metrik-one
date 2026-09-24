import { describe, expect, it } from 'vitest'
import {
  conDvPegado,
  esCedulaDeCiudadania,
  esOtroTipoDeDocumento,
  formaLimpia,
  nitCompletoSinDvDoble,
  sinPrefijoDeTipo,
} from './prefijo-tipo-documento'

describe('sinPrefijoDeTipo', () => {
  it.each([
    ['1380180688', '80180688'], // V0521
    ['1379907467', '79907467'], // V0254
    ['1379485203', '79485203'], // V0110
    ['137556326', '7556326'], // V0395
    ['132747706', '32747706'], // V0177: solo el «1»
  ])('%s trae el código de tipo delante de %s', (v, nit) => {
    expect(sinPrefijoDeTipo(v, nit)).toBe(nit)
  })

  it('una cédula real de 10 dígitos (11…) NO se toma por «1» + otra de 9: no se sabe cuál es la buena', () => {
    expect(sinPrefijoDeTipo('1122456789', '122456789')).toBeNull()
  })

  it('un número igual, más corto o sin testigo no tiene prefijo', () => {
    expect(sinPrefijoDeTipo('80180688', '80180688')).toBeNull()
    expect(sinPrefijoDeTipo('80180688', '1380180688')).toBeNull()
    expect(sinPrefijoDeTipo('1380180688', '')).toBeNull()
    expect(sinPrefijoDeTipo('1312345', '12345')).toBeNull() // testigo de menos de 6 dígitos
  })

  it('un testigo que empieza por 0 no es un documento', () => {
    expect(sinPrefijoDeTipo('1012345678', '012345678')).toBeNull()
  })
})

describe('conDvPegado', () => {
  it('V0521: la factura leyó 801806889 = 80180688 + DV 9', () => {
    expect(conDvPegado('801806889', '80180688')).toBe(true)
  })
  it('un dígito final que NO es el DV no cuenta como DV pegado', () => {
    expect(conDvPegado('801806881', '80180688')).toBe(false)
  })
})

describe('formaLimpia', () => {
  it('prefijo, DV pegado y los dos a la vez, siempre contra otra lectura', () => {
    expect(formaLimpia('1380180688', ['80180688'])).toEqual({ limpio: '80180688', forma: 'prefijo' })
    expect(formaLimpia('801806889', ['80180688'])).toEqual({ limpio: '80180688', forma: 'dv_pegado' })
    expect(formaLimpia('13801806889', ['80180688'])).toEqual({ limpio: '80180688', forma: 'prefijo_y_dv' })
  })
  it('sin otra lectura que lo respalde, el valor queda tal cual', () => {
    expect(formaLimpia('1380180688', [])).toEqual({ limpio: '1380180688', forma: 'limpio' })
    expect(formaLimpia('1380180688', ['1380180688'])).toEqual({ limpio: '1380180688', forma: 'limpio' })
  })
})

describe('tipo de documento', () => {
  it('cédula de ciudadanía por nombre o por código', () => {
    for (const t of ['Cédula de Ciudadanía', 'Cédula de ciudadanía', 'Cédula de Ciudadania', '13', 'CC']) {
      expect(esCedulaDeCiudadania(t), t).toBe(true)
    }
    expect(esCedulaDeCiudadania('Cédula de Extranjería')).toBe(false)
  })
  it('un tipo vacío o ilegible no cuenta como otro tipo', () => {
    for (const t of [null, '', '1']) expect(esOtroTipoDeDocumento(t), String(t)).toBe(false)
    for (const t of ['Cédula de Extranjería', 'NIT', 'Pasaporte']) expect(esOtroTipoDeDocumento(t), t).toBe(true)
  })
})

describe('nitCompletoSinDvDoble', () => {
  it('V0254: 799074677-7 → 79907467-7', () => {
    expect(nitCompletoSinDvDoble('799074677-7', '79907467')).toBe('79907467-7')
  })
  it('bien escrito o con otro error: null', () => {
    expect(nitCompletoSinDvDoble('79907467-7', '79907467')).toBeNull()
    expect(nitCompletoSinDvDoble('799074671-7', '79907467')).toBeNull()
  })
})
