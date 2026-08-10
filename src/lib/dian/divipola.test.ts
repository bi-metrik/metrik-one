import { describe, it, expect } from 'vitest'
import { resolverCodigosUbicacion, CODIGO_PAIS_COLOMBIA } from './divipola'
import { MUNICIPIOS_AMBIGUOS, MUNICIPIOS_POR_DEPTO } from './divipola-catalogo.generated'

/**
 * Los pares (municipio, departamento) son los valores REALES que la extracción de
 * RUT dejó en los negocios abiertos de SOENA posteriores a Documentación (medido
 * 2026-08-09). Los códigos esperados NO salen de la tabla que este archivo prueba:
 * se leyeron del dataset crudo del DANE (gdxc-w37w), porque una comprobación que
 * hereda el supuesto del código no comprueba nada.
 */
const CASOS_REALES: Array<[municipio: string, departamento: string, dep: string, mun: string]> = [
  ['Bogotá, D.C.', 'Bogotá D.C.', '11', '001'],
  ['Bogotá', 'Bogotá', '11', '001'],
  ['Medellín', 'Antioquia', '05', '001'],
  ['Envigado', 'Antioquia', '05', '266'],
  ['Sabaneta', 'Antioquia', '05', '631'],
  ['Bello', 'Antioquia', '05', '088'],
  ['Rionegro', 'Antioquia', '05', '615'],
  ['Bucaramanga', 'Santander', '68', '001'],
  ['Floridablanca', 'Santander', '68', '276'],
  ['Barranquilla', 'Atlántico', '08', '001'],
  ['Chía', 'Cundinamarca', '25', '175'],
  ['Mosquera', 'Cundinamarca', '25', '473'],
  ['Cota', 'Cundinamarca', '25', '214'],
  ['Sutatausa', 'Cundinamarca', '25', '781'],
  ['Sopó', 'Cundinamarca', '25', '758'],
  ['Cajicá', 'Cundinamarca', '25', '126'],
  ['Fusagasugá', 'Cundinamarca', '25', '290'],
  ['Puerto Salgar', 'Cundinamarca', '25', '572'],
  ['Soacha', 'Cundinamarca', '25', '754'],
  ['Villa de Leyva', 'Boyacá', '15', '407'],
  ['Tuluá', 'Valle del Cauca', '76', '834'],
  ['Yumbo', 'Valle del Cauca', '76', '892'],
  ['Chinchiná', 'Caldas', '17', '174'],
  ['Dosquebradas', 'Risaralda', '66', '170'],
  ['Ibagué', 'Tolima', '73', '001'],
  ['Montelíbano', 'Córdoba', '23', '466'],
]

describe('resolverCodigosUbicacion — municipios reales de los RUT de SOENA', () => {
  it.each(CASOS_REALES)('%s (%s) -> %s%s', (municipio, departamento, dep, mun) => {
    const r = resolverCodigosUbicacion('Colombia', departamento, municipio)
    expect(r.codigo_departamento).toBe(dep)
    expect(r.codigo_municipio).toBe(mun)
    expect(r.codigo_pais).toBe(CODIGO_PAIS_COLOMBIA)
  })
})

describe('nombre común contra nombre oficial del DANE', () => {
  // El DANE nombra estos tres distinto de como los escribe cualquier RUT. Sin la
  // regla del nombre corto, ampliar el catálogo habría DEJADO DE resolver Cali,
  // que es el segundo municipio más frecuente de la cartera.
  it('resuelve Cali, que el DANE llama Santiago de Cali', () => {
    expect(resolverCodigosUbicacion('Colombia', 'Valle del Cauca', 'Cali').codigo_municipio).toBe('001')
  })

  it('resuelve Cartagena, que el DANE llama Cartagena de Indias', () => {
    const r = resolverCodigosUbicacion('Colombia', 'Bolívar', 'Cartagena')
    expect([r.codigo_departamento, r.codigo_municipio]).toEqual(['13', '001'])
  })

  it('resuelve Cúcuta, que el DANE llama San José de Cúcuta', () => {
    const r = resolverCodigosUbicacion('Colombia', 'Norte de Santander', 'Cúcuta')
    expect([r.codigo_departamento, r.codigo_municipio]).toEqual(['54', '001'])
  })

  it('NO acepta una coincidencia parcial de palabra', () => {
    // "Cali" no puede resolver a "Calima": el match es por palabra completa.
    // Se comprueba con un nombre que no existe en el departamento.
    expect(resolverCodigosUbicacion('Colombia', 'Valle del Cauca', 'Cal').codigo_municipio).toBeNull()
  })
})

describe('homónimos entre departamentos', () => {
  it('Barbosa se resuelve por su departamento, no a la suerte', () => {
    expect(resolverCodigosUbicacion('Colombia', 'Santander', 'Barbosa').codigo_municipio).toBe('077')
    expect(resolverCodigosUbicacion('Colombia', 'Antioquia', 'Barbosa').codigo_municipio).toBe('079')
  })

  it('La Unión se resuelve por su departamento', () => {
    expect(resolverCodigosUbicacion('Colombia', 'Valle del Cauca', 'La Unión').codigo_municipio).toBe('400')
    expect(resolverCodigosUbicacion('Colombia', 'Nariño', 'La Unión').codigo_municipio).toBe('399')
  })

  it('un homónimo SIN departamento queda sin resolver, no elige uno', () => {
    const r = resolverCodigosUbicacion('Colombia', '', 'Barbosa')
    expect(r.codigo_municipio).toBeNull()
    expect(r.codigo_departamento).toBeNull()
  })

  it('un municipio de nombre único sí se resuelve sin departamento', () => {
    const r = resolverCodigosUbicacion('Colombia', '', 'Sutatausa')
    expect([r.codigo_departamento, r.codigo_municipio]).toEqual(['25', '781'])
  })
})

describe('fallback y no invención', () => {
  it('un municipio inexistente NO inventa código y deja pasar el extraído', () => {
    const r = resolverCodigosUbicacion('Colombia', 'Cundinamarca', 'Ciudad Gótica', {
      codigo_municipio: '999',
    })
    expect(r.codigo_departamento).toBe('25')
    expect(r.codigo_municipio).toBe('999')
  })

  it('sin nombres ni extraídos devuelve null, nunca una cadena vacía', () => {
    const r = resolverCodigosUbicacion(null, null, null)
    expect(r).toEqual({ codigo_pais: null, codigo_departamento: null, codigo_municipio: null })
  })

  it('un país distinto de Colombia no toma el código colombiano', () => {
    expect(resolverCodigosUbicacion('Panamá', null, null).codigo_pais).toBeNull()
  })
})

describe('integridad del catálogo generado', () => {
  it('trae los 33 departamentos y más de 1.100 municipios', () => {
    const municipios = Object.values(MUNICIPIOS_POR_DEPTO).reduce((n, m) => n + Object.keys(m).length, 0)
    expect(Object.keys(MUNICIPIOS_POR_DEPTO)).toHaveLength(33)
    expect(municipios).toBeGreaterThan(1100)
  })

  it('todo código de municipio tiene 3 dígitos', () => {
    for (const tabla of Object.values(MUNICIPIOS_POR_DEPTO)) {
      for (const mun of Object.values(tabla)) expect(mun).toMatch(/^\d{3}$/)
    }
  })

  it('los ambiguos son nombres que de verdad se repiten', () => {
    for (const nombre of MUNICIPIOS_AMBIGUOS.slice(0, 20)) {
      const enCuantos = Object.values(MUNICIPIOS_POR_DEPTO).filter(t => nombre in t).length
      expect(enCuantos).toBeGreaterThan(1)
    }
  })
})
