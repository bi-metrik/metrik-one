/**
 * El titular corregido: qué se acepta, cómo se lee de vuelta y cómo manda sobre el RUT
 * en el borrador del tercero.
 *
 * Decisión de Mauricio (2026-09-22): la financiera corrige nombre y documento del
 * titular antes de facturar, sin volver a subir el RUT. Lo que estas pruebas fijan es
 * que la corrección cambie SOLO eso, y que un documento mal escrito no llegue a Siigo
 * como si fuera otro tercero.
 */
import { describe, it, expect } from 'vitest'
import {
  leerTitularCorregido,
  mismoTitular,
  textoActividadTitular,
  validarTitular,
  type TitularParaBorrador,
} from './titular'
import { borradorCliente, type RutExtraido } from './mapeo'
import { calcularDvNit } from '@/lib/dian/nit'

/** El RUT de V0502 tal como lo deja la extracción (titular según el RUT). */
const RUT_V0502: RutExtraido = {
  numero_identificacion: '79782266',
  tipo_persona: 'Natural',
  primer_nombre: 'JOHN',
  otros_nombres: 'JAIRO',
  primer_apellido: 'CIFUENTES',
  segundo_apellido: 'SABOGAL',
  direccion: 'CALLE 100 # 10-10',
  pais: 'Colombia',
  departamento: 'Bogotá D.C.',
  municipio: 'Bogotá',
  email: 'john@example.com',
}

describe('validarTitular — el documento se exige, el nombre se respeta', () => {
  it('una cédula con nombres y apellidos pasa, sin los puntos de miles', () => {
    const r = validarTitular({
      tipo_documento: '13', numero: '52.100.200', nombres: ' Paula  Andrea ', apellidos: 'Oliveros',
    })
    expect(r).toEqual({
      ok: true,
      titular: { tipo_documento: '13', numero: '52100200', dv: calcularDvNit('52100200'), nombre: ['Paula Andrea', 'Oliveros'] },
    })
  })

  it('un número con letras NO se limpia en silencio: es un error de dedo y se dice', () => {
    // Borrar la letra facturaría a un número que nadie escribió.
    const r = validarTitular({ tipo_documento: '13', numero: '5210O200', nombres: 'A', apellidos: 'B' })
    expect(r.ok).toBe(false)
  })

  it('a una persona le faltan los apellidos: no pasa', () => {
    // Siigo parte el nombre en dos; sin una mitad, el tercero sale cojo.
    const r = validarTitular({ tipo_documento: '13', numero: '52100200', nombres: 'PAULA ANDREA OLIVEROS' })
    expect(r).toEqual({ ok: false, mensaje: 'Faltan los apellidos del titular' })
  })

  it('NIT: el DV que no cuadra se rechaza nombrando el que le toca', () => {
    const dvBueno = calcularDvNit('900123456')!
    const dvMalo = String((Number(dvBueno) + 1) % 10)
    const r = validarTitular({ tipo_documento: '31', numero: '900123456', dv: dvMalo, razon_social: 'ACME SAS' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje).toContain(`el que le toca es ${dvBueno}`)
  })

  it('NIT con el DV pegado por guion se parte ahí; sin DV, se calcula', () => {
    const dv = calcularDvNit('900123456')!
    expect(validarTitular({ tipo_documento: '31', numero: `900123456-${dv}`, razon_social: 'ACME SAS' }))
      .toEqual({ ok: true, titular: { tipo_documento: '31', numero: '900123456', dv, nombre: ['ACME SAS'] } })
    expect(validarTitular({ tipo_documento: '31', numero: '900123456', razon_social: 'ACME SAS' }))
      .toMatchObject({ ok: true, titular: { dv } })
  })

  it('un tipo de documento fuera de la lista no pasa (el pasaporte es alfanumérico)', () => {
    expect(validarTitular({ tipo_documento: '41', numero: '123456', nombres: 'A', apellidos: 'B' }).ok).toBe(false)
  })
})

describe('leerTitularCorregido — lo que no tiene la forma completa no es una corrección', () => {
  const buena = {
    tipo_documento: '13', numero: '52100200', dv: '4', nombre: ['PAULA ANDREA', 'OLIVEROS'],
    por: 'Diana Parra', por_staff_id: 'staff-1', at: '2026-09-22T15:00:00.000Z',
    rut: { identificacion: '79782266', nombre: 'JOHN JAIRO CIFUENTES SABOGAL' },
  }

  it('lee la corrección guardada', () => {
    expect(leerTitularCorregido({ titular_corregido: buena })).toMatchObject({
      numero: '52100200', nombre: ['PAULA ANDREA', 'OLIVEROS'], por: 'Diana Parra',
    })
  })

  it('una corrección a medias se ignora: vuelve a mandar el RUT, no medio titular', () => {
    expect(leerTitularCorregido({ titular_corregido: { ...buena, nombre: ['PAULA ANDREA'] } })).toBeNull()
    expect(leerTitularCorregido({ titular_corregido: { ...buena, numero: '52.100.200' } })).toBeNull()
    expect(leerTitularCorregido({ titular_corregido: { ...buena, tipo_documento: '41' } })).toBeNull()
    expect(leerTitularCorregido({ titular_corregido: null })).toBeNull()
    expect(leerTitularCorregido(null)).toBeNull()
  })
})

describe('borradorCliente con titular corregido', () => {
  const corregido: TitularParaBorrador = {
    tipo_documento: '13', numero: '52100200', dv: calcularDvNit('52100200')!, nombre: ['PAULA ANDREA', 'OLIVEROS'],
  }

  it('el documento y el nombre salen de la corrección; lo demás, de donde salía', () => {
    const r = borradorCliente(RUT_V0502, { email: 'contacto@example.com', telefono: '+57 318 2850319' }, corregido)
    expect(r.payload.identification).toBe('52100200')
    expect(r.payload.id_type).toBe('13')
    expect(r.payload.person_type).toBe('Person')
    expect(r.payload.name).toEqual(['PAULA ANDREA', 'OLIVEROS'])
    // La corrección cubre SOLO nombre y documento.
    expect(r.payload.address.address).toBe('CALLE 100 # 10-10')
    expect(r.payload.address.city.city_code).toBe('11001')
    expect(r.payload.contacts[0]).toMatchObject({ email: 'contacto@example.com' })
    expect(r.faltantes).toEqual([])
  })

  it('un NIT corregido arma una empresa con su DV', () => {
    const dv = calcularDvNit('900123456')!
    const r = borradorCliente(RUT_V0502, { email: 'a@b.co' }, {
      tipo_documento: '31', numero: '900123456', dv, nombre: ['ACME SAS'],
    })
    expect(r.payload).toMatchObject({ person_type: 'Company', id_type: '31', identification: '900123456', check_digit: dv, name: ['ACME SAS'] })
  })

  it('sin corrección, todo sigue saliendo del RUT', () => {
    const r = borradorCliente(RUT_V0502, { email: 'a@b.co' }, null)
    expect(r.payload.identification).toBe('79782266')
    expect(r.payload.name).toEqual(['JOHN JAIRO', 'CIFUENTES SABOGAL'])
  })
})

describe('mismoTitular y la línea del timeline', () => {
  it('compara sin tildes ni mayúsculas ni espacios de más', () => {
    expect(mismoTitular(
      { tipo_documento: '13', numero: '1', nombre: ['José  María', 'Pérez'] },
      { tipo_documento: '13', numero: '1', nombre: ['JOSE MARIA', 'PEREZ'] },
    )).toBe(true)
    expect(mismoTitular(
      { tipo_documento: '13', numero: '1', nombre: ['A', 'B'] },
      { tipo_documento: '13', numero: '2', nombre: ['A', 'B'] },
    )).toBe(false)
  })

  it('el texto del timeline nunca pasa de 280 caracteres (CHECK de activity_log)', () => {
    const largo = 'X'.repeat(100)
    const t = textoActividadTitular(
      { tipo_documento: '13', numero: '52100200', dv: '4', nombre: [largo, largo] },
      { identificacion: '79782266', nombre: largo },
    )
    expect(t.length).toBeLessThanOrEqual(280)
  })
})
