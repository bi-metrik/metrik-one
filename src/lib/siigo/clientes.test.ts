import { describe, it, expect } from 'vitest'
import { debeCrearClienteSiigo } from './clientes'
import { borradorCliente, type RutExtraido } from './mapeo'

describe('debeCrearClienteSiigo', () => {
  it('sin configuración NO dispara nada', () => {
    // Ninguna línea ajena puede empezar a crear terceros en un Siigo solo
    // porque esta función exista.
    expect(debeCrearClienteSiigo(undefined, 12)).toBe(false)
    expect(debeCrearClienteSiigo({}, 12)).toBe(false)
    expect(debeCrearClienteSiigo(null, 12)).toBe(false)
  })

  it('dispara solo al SUPERAR la etapa configurada, no al entrar en ella', () => {
    // SOENA: el RUT se captura en Documentación (numero 5), así que el dato
    // existe recién al salir de ahí.
    const cfg = { crear_cliente_desde_etapa_numero: 5 }
    expect(debeCrearClienteSiigo(cfg, 5)).toBe(false)
    expect(debeCrearClienteSiigo(cfg, 6)).toBe(true)
    expect(debeCrearClienteSiigo(cfg, 12)).toBe(true)
  })

  it('una etapa anterior no dispara', () => {
    expect(debeCrearClienteSiigo({ crear_cliente_desde_etapa_numero: 5 }, 3)).toBe(false)
  })

  it('sin número de etapa no dispara', () => {
    expect(debeCrearClienteSiigo({ crear_cliente_desde_etapa_numero: 5 }, null)).toBe(false)
  })
})

/**
 * El RUT de abajo reproduce la forma real de los campos que la extracción deja
 * en el bloque `rut`. Lo que se prueba aquí es el puente DIVIPOLA → Siigo: el
 * `city_code` de 5 dígitos es lo que más faltaba en la cola de facturación.
 */
describe('borradorCliente — la ciudad ya resuelve para los municipios reales', () => {
  const base: RutExtraido = {
    numero_identificacion: '1020304050',
    primer_nombre: 'CAROL',
    primer_apellido: 'CARRILLO',
    tipo_persona: 'Natural',
    direccion: 'CALLE 100 # 10-10',
    pais: 'Colombia',
  }

  it('Bogotá: city_code de 5 dígitos, sin faltantes', () => {
    const r = borradorCliente(
      { ...base, departamento: 'Bogotá D.C.', municipio: 'Bogotá, D.C.' },
      { email: 'carol@example.com', telefono: '+57 3001234567' },
    )
    expect(r.payload.address.city).toEqual({ country_code: 'Co', state_code: '11', city_code: '11001' })
    expect(r.faltantes).toEqual([])
  })

  it('Cali resuelve aunque el DANE la llame Santiago de Cali', () => {
    const r = borradorCliente({ ...base, departamento: 'Valle del Cauca', municipio: 'Cali' }, { email: 'a@b.co' })
    expect(r.payload.address.city.city_code).toBe('76001')
  })

  it('Cota, que antes no estaba en la tabla', () => {
    const r = borradorCliente({ ...base, departamento: 'Cundinamarca', municipio: 'Cota' }, { email: 'a@b.co' })
    expect(r.payload.address.city.city_code).toBe('25214')
  })

  it('un municipio que no existe se DECLARA faltante, no se inventa', () => {
    const r = borradorCliente({ ...base, departamento: 'Cundinamarca', municipio: 'Ciudad Gótica' }, { email: 'a@b.co' })
    expect(r.faltantes).toContain('ciudad (no se pudo resolver el código DANE)')
    expect(r.payload.address.city.city_code).toBe('')
  })

  it('el teléfono viaja sin el indicativo de país', () => {
    const r = borradorCliente(
      { ...base, departamento: 'Bogotá D.C.', municipio: 'Bogotá' },
      { email: 'a@b.co', telefono: '+57 3001234567' },
    )
    expect(r.payload.phones).toEqual([{ number: '3001234567' }])
  })
})
