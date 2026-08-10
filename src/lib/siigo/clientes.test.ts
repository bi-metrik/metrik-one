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

  it('sin teléfono, la clave `phones` NO viaja', () => {
    const r = borradorCliente({ ...base, departamento: 'Bogotá D.C.', municipio: 'Bogotá' }, { email: 'a@b.co' })
    expect('phones' in r.payload).toBe(false)
  })
})

/**
 * Estas dos cosas rompieron el backfill del 2026-08-10: los 167 terceros se
 * rechazaron y ninguno se creó. El mapeo se había validado comparándolo contra
 * documentos ya emitidos, que es una prueba de LECTURA: nunca había hecho un POST.
 */
describe('lo que Siigo exige al CREAR, que no es lo que devuelve al leer', () => {
  const base: RutExtraido = {
    numero_identificacion: '37747612',
    primer_nombre: 'CAROL', primer_apellido: 'CARRILLO',
    tipo_persona: 'Natural', direccion: 'CLL 10A 9 37',
    pais: 'Colombia', departamento: 'Bogotá D.C.', municipio: 'Bogotá',
  }

  it('id_type viaja como CADENA, no como objeto', () => {
    // Siigo LEE `{code, name}` pero al crear exige "13": con el objeto responde
    // "The field id_type is required" y con un número, "Invalid data type".
    const r = borradorCliente(base, { email: 'a@b.co' })
    expect(r.payload.id_type).toBe('13')
  })

  it('una persona jurídica va con NIT', () => {
    const r = borradorCliente({ ...base, tipo_persona: 'Jurídica', razon_social: 'ACME SAS' }, { email: 'a@b.co' })
    expect(r.payload.id_type).toBe('31')
    expect(r.payload.person_type).toBe('Company')
  })

  it('un teléfono que no cabe en 10 dígitos se OMITE, no tumba el tercero', () => {
    // El teléfono es opcional; perderlo es mejor que no crear el cliente. Y no se
    // recorta a la fuerza: eso sería inventar un número que nadie contesta.
    const r = borradorCliente(base, { email: 'a@b.co', telefono: '601 314 3195520 ext 22' })
    // La clave se OMITE: `phones: []` lo rechaza Siigo con un error genérico.
    expect('phones' in r.payload).toBe(false)
    expect(r.faltantes).toEqual([])
  })

  it('un teléfono nacional normal sí viaja', () => {
    expect(borradorCliente(base, { email: 'a@b.co', telefono: '+57 314 3195520' }).payload.phones)
      .toEqual([{ number: '3143195520' }])
  })
})
