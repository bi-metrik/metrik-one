import { describe, expect, it } from 'vitest'
import {
  ciudadDeclarada,
  esCampoDeCiudad,
  NombresDeCiudad,
  nombreParaMostrar,
  normalizarCiudad,
} from './ciudad-residencia'

const clave = (v: string) => normalizarCiudad(v)?.clave ?? null

describe('esCampoDeCiudad', () => {
  it('reconoce los nombres reales de SOENA y sus variantes', () => {
    expect(esCampoDeCiudad('¿en_qué_ciudad_reside?')).toBe(true)
    expect(esCampoDeCiudad('¿en_que_ciudad_reside?')).toBe(true)
    expect(esCampoDeCiudad('city')).toBe(true)
    expect(esCampoDeCiudad('City')).toBe(true)
    expect(esCampoDeCiudad('Ciudad de residencia')).toBe(true)
    expect(esCampoDeCiudad('municipio')).toBe(true)
  })

  it('no confunde campos que solo contienen las letras', () => {
    expect(esCampoDeCiudad('electricity_bill')).toBe(false)
    expect(esCampoDeCiudad('ciudadania')).toBe(false)
    expect(esCampoDeCiudad('full_name')).toBe(false)
    expect(esCampoDeCiudad(undefined)).toBe(false)
  })
})

describe('ciudadDeclarada', () => {
  it('saca el valor del campo de ciudad, en cualquier posición', () => {
    expect(
      ciudadDeclarada([
        { name: 'full_name', values: ['Ana'] },
        { name: '¿en_qué_ciudad_reside?', values: ['Medellín'] },
      ]),
    ).toBe('Medellín')
  })

  it('sin campo de ciudad, o en blanco, devuelve null', () => {
    expect(ciudadDeclarada([{ name: 'full_name', values: ['Ana'] }])).toBeNull()
    expect(ciudadDeclarada([{ name: 'city', values: ['   '] }])).toBeNull()
    expect(ciudadDeclarada([{ name: 'city' }])).toBeNull()
    expect(ciudadDeclarada(null)).toBeNull()
  })
})

describe('normalizarCiudad', () => {
  it('«Medellín», «medellin » y «MEDELLIN» dan lo mismo', () => {
    expect(clave('Medellín')).toBe('medellin')
    expect(clave('medellin ')).toBe('medellin')
    expect(clave('MEDELLIN')).toBe('medellin')
    expect(clave('  medellín   ')).toBe('medellin')
  })

  it('suelta el departamento pegado al final', () => {
    expect(clave('rionegro antioquia')).toBe('rionegro')
    expect(clave('Cali, Valle')).toBe('cali')
    expect(clave('Cali valle del cauca')).toBe('cali')
    expect(clave('Medellín - Antioquia')).toBe('medellin')
    expect(clave('Neiva (Huila)')).toBe('neiva')
    expect(clave('Bogotá D.C.')).toBe('bogota')
    expect(clave('bogota dc')).toBe('bogota')
    expect(clave('Medellín Antioquia Colombia')).toBe('medellin')
    expect(clave('Villavicencio Meta')).toBe('villavicencio')
  })

  it('NO recorta municipios cuyo nombre termina en un departamento', () => {
    expect(clave('Puerto Boyacá')).toBe('puerto boyaca')
    expect(clave('ciudad bolivar')).toBe('ciudad bolivar')
    expect(clave('San José del Guaviare')).toBe('san jose del guaviare')
    expect(clave('Santander de Quilichao')).toBe('santander de quilichao')
  })

  it('un departamento solo se queda como está (no hay nada que recortar)', () => {
    expect(clave('Antioquia')).toBe('antioquia')
    expect(clave('Valle')).toBe('valle')
  })

  it('el nombre oficial del DANE cae en el nombre común', () => {
    expect(clave('Santiago de Cali')).toBe('cali')
    expect(clave('San José de Cúcuta')).toBe('cucuta')
    expect(clave('Cúcuta')).toBe('cucuta')
  })

  it('no agrupa el área metropolitana', () => {
    expect(clave('Envigado')).toBe('envigado')
    expect(clave('Floridablanca')).toBe('floridablanca')
  })

  it('sin letras no hay ciudad', () => {
    expect(normalizarCiudad('')).toBeNull()
    expect(normalizarCiudad(' . ')).toBeNull()
    expect(normalizarCiudad('123')).toBeNull()
    expect(normalizarCiudad(null)).toBeNull()
  })
})

describe('NombresDeCiudad', () => {
  it('muestra la variante con tildes aunque la otra sea casi igual de frecuente', () => {
    const n = new NombresDeCiudad()
    for (let i = 0; i < 78; i++) n.registrar('medellin')
    for (let i = 0; i < 84; i++) n.registrar('medellín')
    n.registrar('MEDELLIN')
    expect(n.nombre('medellin')).toBe('Medellín')
  })

  it('con el departamento pegado se muestra la ciudad sola', () => {
    const n = new NombresDeCiudad()
    const k = n.registrar('rionegro antioquia')
    expect(k).toBe('rionegro')
    expect(n.nombre(k!)).toBe('Rionegro')
  })

  it('los conectores van en minúscula', () => {
    expect(nombreParaMostrar('san josé del guaviare')).toBe('San José del Guaviare')
  })
})
