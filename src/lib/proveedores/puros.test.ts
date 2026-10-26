import { describe, expect, it } from 'vitest'

import { claveDeFoto } from '@/lib/fotos/clave'
import { rutaDeArchivo, rutaValida, referenciaDeArchivo } from './archivos'
import { correosDeTexto, normalizarCelular, normalizarWeb } from './contacto'
import { ciudadDeClave, claveDeProveedor, espacioDeTipo, etiquetasDeTexto, normalizarEtiquetas } from './tipos'
import { parsearUbicacion } from './ubicacion'
import { avisoDeTarifario, estadoTarifario, hoyBogota, semaforo, tarifariosEfectivos, vigenciaDeNombre } from './vigencia'

describe('tipos y llaves', () => {
  it('la llave de un proveedor es la misma de sus fotos (#1202)', () => {
    expect(claveDeProveedor('Hotel Catalonia Puerta del Sol', 'Madrid')).toBe(claveDeFoto('hotel', 'Hotel Catalonia Puerta del Sol', 'Madrid'))
    expect(claveDeProveedor('Tour Toledo', 'Madrid')).toBe(claveDeFoto('actividad', 'Tour Toledo', 'Madrid'))
    expect(ciudadDeClave(claveDeProveedor('X', 'Madrid'))).toBe('madrid')
    expect(claveDeProveedor('', 'Madrid')).toBe('')
  })

  it('el espacio de fotos sale del tipo', () => {
    expect(espacioDeTipo('hotel')).toBe('hotel')
    expect(espacioDeTipo('parque')).toBe('actividad')
    expect(espacioDeTipo('lancha')).toBe('actividad')
    expect(espacioDeTipo('mayorista')).toBe('proveedor')
    expect(espacioDeTipo('operador')).toBe('proveedor')
  })

  it('etiquetas normalizadas, sin repetir', () => {
    expect(normalizarEtiquetas(['Luna de Miel', ' luna  de miel ', 'Niños', '', 3])).toEqual(['luna de miel', 'ninos'])
    expect(etiquetasDeTexto('familias, lujo; Familias')).toEqual(['familias', 'lujo'])
  })
})

describe('contacto', () => {
  it('celular en E.164 cuando se puede, el original siempre', () => {
    expect(normalizarCelular('300 123 4567')).toEqual({ e164: '+573001234567', original: '300 123 4567' })
    expect(normalizarCelular('+57 300 123 4567')).toEqual({ e164: '+573001234567', original: '+57 300 123 4567' })
    expect(normalizarCelular('3001234567.0').e164).toBe('+573001234567')
    expect(normalizarCelular('6123-4567', 'PA').e164).toBe('+50761234567')
    expect(normalizarCelular('0034 600 000 000').e164).toBe('+34600000000')
    expect(normalizarCelular('300 123 4567 / 301 765 4321').e164).toBe('+573001234567')
    expect(normalizarCelular('5551234')).toEqual({ e164: null, original: '5551234' })
    expect(normalizarCelular('pedir por correo').e164).toBeNull()
    expect(normalizarCelular('  ')).toEqual({ e164: null, original: null })
  })

  it('correos: el primero válido y los demás; basura → null', () => {
    expect(correosDeTexto('Reservas: A@x.com / b@y.co.')).toEqual({ correo: 'a@x.com', otros: ['b@y.co'] })
    expect(correosDeTexto('ver whatsapp')).toEqual({ correo: null, otros: [] })
  })

  it('web con esquema', () => {
    expect(normalizarWeb('hotel.example')).toBe('https://hotel.example')
    expect(normalizarWeb('http://a.example/x')).toBe('http://a.example/x')
    expect(normalizarWeb('no tiene')).toBeNull()
  })
})

describe('ubicación', () => {
  it('ciudad y país; PY es Panamá; lo raro va a revisión', () => {
    expect(parsearUbicacion('Cartagena, CO')).toEqual({ ciudad: 'Cartagena', pais: 'CO', dudosa: null })
    expect(parsearUbicacion('Cundinamarca,CO')).toEqual({ ciudad: 'Cundinamarca', pais: 'CO', dudosa: null })
    expect(parsearUbicacion('Panama, PY')).toEqual({ ciudad: 'Panama', pais: 'PA', dudosa: null })
    expect(parsearUbicacion('Punta Cana, RD').pais).toBe('DO')
    expect(parsearUbicacion('Madrid, España').pais).toBe('ES')
    expect(parsearUbicacion('Bogotá')).toEqual({ ciudad: 'Bogotá', pais: null, dudosa: null })
    expect(parsearUbicacion('Lugar, XQ').dudosa).toMatch(/revisar/)
    expect(parsearUbicacion('Lugar, Narnia').dudosa).toMatch(/sin reconocer/)
  })
})

describe('vigencia de tarifarios', () => {
  const HOY = '2026-10-18'
  it('estado de cada tarifario hoy', () => {
    expect(estadoTarifario({ desde: '2026-01-01', hasta: '2026-12-31' }, HOY)).toBe('vigente')
    expect(estadoTarifario({ desde: null, hasta: '2026-11-17' }, HOY)).toBe('por_vencer')
    expect(estadoTarifario({ desde: null, hasta: '2026-11-18' }, HOY)).toBe('vigente')
    expect(estadoTarifario({ desde: null, hasta: '2026-10-17' }, HOY)).toBe('vencido')
    expect(estadoTarifario({ desde: null, hasta: '2026-10-18' }, HOY)).toBe('por_vencer')
    expect(estadoTarifario({ desde: null, hasta: null }, HOY)).toBe('sin_fechas')
    expect(estadoTarifario({ desde: '2026-01-01', hasta: null }, HOY)).toBe('vigente')
  })

  it('el semáforo es el mejor de los tarifarios', () => {
    expect(semaforo([], HOY)).toBe('sin_tarifario')
    expect(semaforo([{ desde: null, hasta: '2025-12-31' }, { desde: null, hasta: '2026-11-01' }], HOY)).toBe('por_vencer')
    expect(semaforo([{ desde: null, hasta: '2025-12-31' }, { desde: null, hasta: null }], HOY)).toBe('sin_fechas')
  })

  it('hoy en Bogotá, no en UTC', () => {
    expect(hoyBogota(new Date('2026-10-19T03:00:00Z'))).toBe('2026-10-18')
  })

  it('aviso de la tarjeta según las fechas del viaje', () => {
    const viaje = { inicio: '2026-12-20', fin: '2026-12-27' }
    const p = (tarifarios: { desde: string | null; hasta: string | null }[], via: { id: string; nombre: string; tarifarios: { desde: string | null; hasta: string | null }[] } | null = null) => ({ id: 'h1', nombre: 'Hotel', tarifarios, via })
    expect(avisoDeTarifario(p([]), viaje, HOY)).toMatchObject({ texto: 'Sin tarifario', accion: 'Pide el tarifario 2026 al proveedor y súbelo a su ficha', proveedorId: 'h1' })
    expect(avisoDeTarifario(p([{ desde: '2025-01-01', hasta: '2025-12-31' }]), viaje, HOY)).toMatchObject({ texto: 'Tarifario vencido (hasta dic-2025)', accion: 'Pide el tarifario 2026 al proveedor', tono: 'ambar' })
    expect(avisoDeTarifario(p([{ desde: '2026-01-01', hasta: '2026-12-31' }]), viaje, HOY)).toBeNull()
    expect(avisoDeTarifario(p([{ desde: '2026-01-01', hasta: '2026-12-24' }]), viaje, HOY)?.texto).toMatch(/no cubre/)
    expect(avisoDeTarifario(p([{ desde: null, hasta: null }]), viaje, HOY)?.texto).toBe('Tarifario sin fechas')
    // Sin fechas del viaje: se mira hoy.
    expect(avisoDeTarifario(p([{ desde: null, hasta: '2026-12-31' }]), null, HOY)).toBeNull()
    // Hotel sin tarifario propio comprado por un mayorista: manda el del mayorista.
    const via = { id: 'm1', nombre: 'Mayorista Uno', tarifarios: [{ desde: '2025-04-01', hasta: '2026-03-31' }] }
    expect(avisoDeTarifario(p([], via), viaje, HOY)).toMatchObject({ texto: 'Tarifario vencido (hasta mar-2026) (de Mayorista Uno)', accion: 'Pide el tarifario 2026 al mayorista Mayorista Uno', proveedorId: 'm1' })
    expect(avisoDeTarifario(p([], { ...via, tarifarios: [{ desde: '2026-04-01', hasta: '2027-03-31' }] }), viaje, HOY)).toBeNull()
    // Con tarifario propio, el del mayorista no cuenta.
    expect(avisoDeTarifario(p([{ desde: null, hasta: '2025-01-01' }], { ...via, tarifarios: [{ desde: null, hasta: '2030-01-01' }] }), viaje, HOY)?.proveedorId).toBe('h1')
  })

  it('tarifarios efectivos: los propios o los del mayorista', () => {
    expect(tarifariosEfectivos([], [{ desde: null, hasta: '2027-01-01' }])).toEqual({ tarifarios: [{ desde: null, hasta: '2027-01-01' }], delMayorista: true })
    expect(tarifariosEfectivos([{ desde: null, hasta: null }], [])).toMatchObject({ delMayorista: false })
  })

  it('vigencia sugerida por el nombre del archivo', () => {
    expect(vigenciaDeNombre('Tarifas 2025.pdf')).toEqual({ desde: '2025-01-01', hasta: '2025-12-31' })
    expect(vigenciaDeNombre('Tarifario 2026-2027 hotel.pdf')).toEqual({ desde: '2026-01-01', hasta: '2027-12-31' })
    expect(vigenciaDeNombre('Tarifas 2026-27.pdf')).toEqual({ desde: '2026-01-01', hasta: '2027-12-31' })
    expect(vigenciaDeNombre('portafolio.pdf')).toBeNull()
    expect(vigenciaDeNombre('cod 120250.pdf')).toBeNull()
  })
})

describe('archivos del proveedor', () => {
  const WS = '0a0a0a0a-0000-4000-8000-000000000001'
  const P = '0b0b0b0b-0000-4000-8000-000000000002'
  it('la ruta solo vale para su workspace, su proveedor y su clase', () => {
    const ruta = rutaDeArchivo(WS, P, 'tarifarios', 'a'.repeat(32), 'pdf')
    expect(rutaValida(ruta, WS, P, 'tarifarios')).toBe(ruta)
    expect(rutaValida(referenciaDeArchivo(ruta), WS, P, 'tarifarios')).toBe(ruta)
    expect(rutaValida(ruta, WS, P, 'cuentas')).toBeNull()
    expect(rutaValida(ruta, WS, '0c0c0c0c-0000-4000-8000-000000000003', 'tarifarios')).toBeNull()
    expect(rutaValida(ruta, '0d0d0d0d-0000-4000-8000-000000000004', P, 'tarifarios')).toBeNull()
    expect(rutaValida(`${WS}/proveedores/${P}/tarifarios/../x.pdf`, WS, P, 'tarifarios')).toBeNull()
    expect(rutaValida(`${WS}/hotel/${'a'.repeat(16)}.jpg`, WS, P, 'tarifarios')).toBeNull()
  })
})
