/**
 * Las reglas del texto para el cliente (Trappvel): qué ve el modelo, qué ve el cliente y
 * cuándo un texto quedó viejo.
 *
 * Las líneas son las de COT-2026-0006 (San Andrés - Providencia), con dos trampas
 * agregadas a propósito: una línea sin ranura cuyo nombre trae el nombre del cliente y
 * un precio, y un hotel con precio en su lectura. Si algo de eso llega al JSON del
 * modelo, estas pruebas lo dicen.
 */
import { describe, expect, it } from 'vitest'

import {
  avisoDelTextoEnPdf,
  contenidoDelRedactor,
  estadoDelTexto,
  hayViajeQueRedactar,
  huellaDeViaje,
  leerDocumentoCliente,
  limpiarTextoLibre,
  normalizarTexto,
  promptDelRedactor,
  textoDelModelo,
  textoDesactualizado,
  textoImprimible,
  textoParaElViaje,
  viajeParaRedactar,
  type DocumentoCliente,
  type EntradaRedactor,
} from './documento-cliente'

const campos = (o: Record<string, string>) => Object.entries(o).map(([label, valor]) => ({ label, valor }))
const lectura = (c: Record<string, string>) => ({
  casillas: { grupo_completo: { total: 1, moneda: 'COP', campos: campos(c) } },
})

const AVIANCA = {
  id: 'i1',
  nombre: 'AVIANCA BOG - ADZ',
  grupo: 'avianca bog - adz',
  tarifa_pax: lectura({
    'Aerolínea': 'Avianca', 'Origen': 'Bogotá', 'Destino': 'San Andrés Isla', 'Salida': '2026-11-23',
    'Regreso': '2026-11-28', 'Nº de vuelo': '9782, 9779', 'Escalas': '0', 'Precio': '6208296',
  }),
}
const SATENA = {
  id: 'i2',
  nombre: 'SATENA ADZ - PROVIDENCIA',
  grupo: 'vuelo',
  tarifa_pax: lectura({
    'Aerolínea': 'SATENA', 'Origen': 'San Andrés Isla ADZ', 'Destino': 'Providencia PVA', 'Salida': '2026-11-23',
    'Regreso': '2026-11-25', 'Nº de vuelo': '8832 · 8833', 'Escalas': '0', 'Precio': '3292196',
  }),
}
const HOTEL = {
  id: 'i3',
  nombre: 'DECAMERON AQUARIUM',
  grupo: 'hotel',
  tarifa_pax: lectura({
    'Hotel': 'Decameron Aquarium', 'Ciudad': 'San Andrés', 'Habitación': 'Estándar', 'Régimen': 'Todo incluido',
    'Check-in': '2026-11-25', 'Check-out': '2026-11-28', 'Noches': '3', 'Precio': '4150000',
  }),
}
const TRASLADO = {
  id: 'i4',
  nombre: 'TRASLADO ADZ',
  grupo: 'traslado',
  tarifa_pax: lectura({ 'Trayecto': 'Aeropuerto - hotel - aeropuerto', 'Vehículo': 'Compartido' }),
}
/** La trampa: una línea suelta con el nombre del cliente y un precio en el nombre. */
const SEGURO = { id: 'i5', nombre: 'SEGURO DE VIAJE LIGIA SÁNCHEZ $ 350.000', grupo: null, tarifa_pax: null }
const AJUSTE = { id: 'i6', nombre: 'AJUSTE REDONDEO 12.345', grupo: null, tarifa_pax: null, es_ajuste: true }

const entrada = (over: Partial<EntradaRedactor> = {}): EntradaRedactor => ({
  items: [AVIANCA, SATENA, HOTEL, TRASLADO, SEGURO, AJUSTE],
  destino: 'San Andrés - Providencia',
  fechas: { inicio: '2026-11-23', fin: '2026-11-28' },
  composicion: { adultos: 6, ninos: 1, infantes: 1 },
  nombresDelCliente: ['Ligia Sanchez', 'Familia Sanchez Rojas'],
  ...over,
})

describe('lo que ve el modelo', () => {
  const viaje = viajeParaRedactar(entrada())
  const json = contenidoDelRedactor(viaje)

  it('⚠️⚠️ ni el nombre del cliente ni un precio llegan al modelo', () => {
    const plano = json.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    expect(plano).not.toContain('ligia')
    expect(plano).not.toContain('sanchez')
    for (const cifra of ['6208296', '3292196', '4150000', '350.000', '350000', '12.345']) {
      expect(json).not.toContain(cifra)
    }
    // Ninguna clave del JSON habla de plata.
    expect(json).not.toMatch(/"(precio|valor|monto|costo|total)[^"]*"\s*:/i)
  })

  it('⚠️ el nombre interno de un vuelo o un hotel no se copia: se describe el servicio', () => {
    expect(json).not.toContain('AVIANCA BOG - ADZ')
    expect(json).not.toContain('DECAMERON AQUARIUM')
    expect(viaje.vuelos.map(v => v.aerolinea)).toEqual(['Avianca', 'SATENA'])
    expect(viaje.hoteles[0]).toMatchObject({ nombre: 'Decameron Aquarium', noches: 3, regimen: 'Todo incluido' })
  })

  it('la línea suelta aporta su nombre, limpio; el ítem de cuadre no aporta nada', () => {
    expect(viaje.otrosServicios).toEqual(['SEGURO DE VIAJE'])
  })

  it('trae destino, fechas, viajeros y traslados', () => {
    expect(viaje.destino).toBe('San Andrés - Providencia')
    expect(viaje.fechaSalida).toBe('2026-11-23')
    expect(viaje.viajeros).toEqual({ adultos: 6, ninos: 1, infantes: 1 })
    expect(viaje.traslados).toEqual(['Aeropuerto - hotel - aeropuerto · Compartido'])
  })

  it('⚠️ una actividad cuya lectura no dice QUÉ es lleva el nombre de la línea, limpio', () => {
    const tour = {
      id: 'i7',
      nombre: 'TOUR JOHNNY CAY LIGIA SANCHEZ',
      grupo: 'actividad',
      tarifa_pax: lectura({ 'Duración': 'Día completo', 'Ciudad': 'San Andrés' }),
    }
    const v = viajeParaRedactar(entrada({ items: [tour] }))
    expect(v.actividades).toEqual(['TOUR JOHNNY CAY · Día completo · San Andrés'])
    const conNombre = { ...tour, tarifa_pax: lectura({ 'Actividad': 'Tour Johnny Cay y Acuario', 'Duración': 'Día completo' }) }
    expect(viajeParaRedactar(entrada({ items: [conNombre] })).actividades).toEqual(['Tour Johnny Cay y Acuario · Día completo'])
  })

  it('el prompt exige no inventar y prohíbe precios y nombres', () => {
    const p = promptDelRedactor()
    expect(p).toContain('No inventes nada que no esté en el JSON')
    expect(p).toContain('Nada de precios')
    expect(p).toContain('No uses nombres de personas')
  })

  it('sin destino ni servicios no hay nada que redactar', () => {
    expect(hayViajeQueRedactar(viaje)).toBe(true)
    expect(hayViajeQueRedactar(viajeParaRedactar(entrada({ items: [SEGURO], destino: null })))).toBe(false)
  })
})

describe('limpiarTextoLibre', () => {
  it('quita el nombre del cliente sin importar tildes ni mayúsculas', () => {
    expect(limpiarTextoLibre('SEGURO LIGIA SÁNCHEZ', ['Ligia Sanchez'])).toBe('SEGURO')
  })

  it('quita cifras de dinero en sus formas comunes', () => {
    expect(limpiarTextoLibre('Tarjeta turismo COP 350000', [])).toBe('Tarjeta turismo')
    expect(limpiarTextoLibre('Seguro USD 90', [])).toBe('Seguro')
    expect(limpiarTextoLibre('Impuesto 7.303.878', [])).toBe('Impuesto')
    expect(limpiarTextoLibre('Cargo 6208296', [])).toBe('Cargo')
  })

  it('conserva un número de vuelo: cuatro dígitos no son plata', () => {
    expect(limpiarTextoLibre('Vuelo 8832', [])).toBe('Vuelo 8832')
  })

  it('si no queda ninguna letra, devuelve null', () => {
    expect(limpiarTextoLibre('$ 1.200.000', [])).toBeNull()
    expect(limpiarTextoLibre('Ligia Sanchez', ['Ligia Sanchez'])).toBeNull()
  })
})

const BASE: Omit<DocumentoCliente, 'revisado_en' | 'revisado_por' | 'revisado_por_nombre'> = {
  titular: 'San Andrés y Providencia: dos islas, un mismo mar',
  intro: 'Seis días entre el mar de siete colores y la calma de Providencia.',
  incluye: ['Tiquetes Bogotá - San Andrés - Bogotá con Avianca'],
  antes_de_viajar: ['Tramite la tarjeta de turismo de San Andrés.'],
  origen: 'ia',
  modelo: 'gemini-2.5-flash',
  redactado_en: '2026-09-22T20:00:00.000Z',
  fuente_hash: 'abc',
}
const BORRADOR: DocumentoCliente = { ...BASE, revisado_en: null, revisado_por: null, revisado_por_nombre: null }
const REVISADO: DocumentoCliente = {
  ...BASE, revisado_en: '2026-09-22T21:00:00.000Z', revisado_por: 'staff-1', revisado_por_nombre: 'Edgar Alarcón',
}

describe('lo que ve el cliente', () => {
  it('⚠️⚠️ un borrador de ONE no se imprime: solo el texto que una persona guardó', () => {
    expect(textoImprimible(BORRADOR)).toBeNull()
    expect(textoParaElViaje(BORRADOR)).toEqual({})
    expect(textoImprimible(REVISADO)?.titular).toBe(BASE.titular)
    expect(textoParaElViaje(REVISADO)).toEqual({
      titular: BASE.titular,
      intro: BASE.intro,
      incluye: BASE.incluye,
      antesDeViajar: BASE.antes_de_viajar,
    })
  })

  it('sin texto, el viaje no gana ni una clave', () => {
    expect(textoParaElViaje(null)).toEqual({})
  })

  it('el estado y el aviso del PDF: solo el borrador avisa', () => {
    expect(estadoDelTexto(null)).toBe('sin_texto')
    expect(estadoDelTexto(BORRADOR)).toBe('borrador')
    expect(estadoDelTexto(REVISADO)).toBe('revisado')
    expect(avisoDelTextoEnPdf(BORRADOR)).toContain('borrador de ONE sin revisar')
    expect(avisoDelTextoEnPdf(REVISADO)).toBeNull()
    expect(avisoDelTextoEnPdf(null)).toBeNull()
  })

  it('un jsonb roto se lee como ausente, nunca a medias', () => {
    expect(leerDocumentoCliente(null)).toBeNull()
    expect(leerDocumentoCliente([])).toBeNull()
    expect(leerDocumentoCliente({ titular: '   ', incluye: [] })).toBeNull()
    expect(leerDocumentoCliente({ titular: 'Hola', origen: 'otro' })?.origen).toBe('persona')
    expect(leerDocumentoCliente({ titular: 'Hola' })?.revisado_en).toBeNull()
  })

  it('normaliza: sin espacios de más, sin renglones vacíos ni repetidos, con tope', () => {
    const t = normalizarTexto({
      titular: '  San   Andrés  ',
      incluye: ['A', ' a ', '', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    })
    expect(t.titular).toBe('San Andrés')
    expect(t.incluye).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
  })

  it('un renglón de lista pierde el punto final: sale seguido de « · » en «Antes de viajar»', () => {
    const t = normalizarTexto({ antes_de_viajar: ['Lleve pasaporte vigente.', 'Llegue con tiempo; ', 'Etc...'] })
    expect(t.antes_de_viajar).toEqual(['Lleve pasaporte vigente', 'Llegue con tiempo', 'Etc'])
  })
})

describe('la huella del viaje', () => {
  it('es estable para la misma entrada', () => {
    expect(huellaDeViaje(viajeParaRedactar(entrada()))).toBe(huellaDeViaje(viajeParaRedactar(entrada())))
  })

  it('cambia si cambia una línea que el texto describe', () => {
    const otra = { ...HOTEL, tarifa_pax: lectura({ 'Hotel': 'Decameron Aquarium', 'Ciudad': 'San Andrés', 'Noches': '4' }) }
    const a = huellaDeViaje(viajeParaRedactar(entrada()))
    const b = huellaDeViaje(viajeParaRedactar(entrada({ items: [AVIANCA, SATENA, otra, TRASLADO, SEGURO] })))
    expect(a).not.toBe(b)
  })

  it('NO cambia si solo cambia el precio: el texto no habla de plata', () => {
    const caro = { ...HOTEL, tarifa_pax: lectura({ ...Object.fromEntries(HOTEL.tarifa_pax.casillas.grupo_completo.campos.map(c => [c.label, c.valor])), 'Precio': '9999999' }) }
    expect(huellaDeViaje(viajeParaRedactar(entrada({ items: [AVIANCA, SATENA, caro, TRASLADO, SEGURO, AJUSTE] }))))
      .toBe(huellaDeViaje(viajeParaRedactar(entrada())))
  })

  it('un texto escrito con otras líneas queda desactualizado; sin huella no se afirma nada', () => {
    expect(textoDesactualizado({ ...REVISADO, fuente_hash: 'x' }, 'y')).toBe(true)
    expect(textoDesactualizado({ ...REVISADO, fuente_hash: 'x' }, 'x')).toBe(false)
    expect(textoDesactualizado({ ...REVISADO, fuente_hash: null }, 'y')).toBe(false)
    expect(textoDesactualizado(null, 'y')).toBe(false)
  })
})

describe('lo que devuelve el modelo', () => {
  it('descarta el renglón que trae plata y conserva el resto', () => {
    const t = textoDelModelo({
      titular: 'San Andrés desde $ 1.200.000',
      intro: 'Seis días de mar.',
      incluye: ['Tiquetes con Avianca', 'Hotel por COP 4150000', 'Traslados'],
      antes_de_viajar: ['Lleve bloqueador'],
    })
    expect(t.titular).toBeNull()
    expect(t.intro).toBe('Seis días de mar.')
    expect(t.incluye).toEqual(['Tiquetes con Avianca', 'Traslados'])
    expect(t.antes_de_viajar).toEqual(['Lleve bloqueador'])
  })

  it('una respuesta sin forma es texto vacío, no un error a medias', () => {
    expect(textoDelModelo('hola')).toEqual({ titular: null, intro: null, incluye: [], antes_de_viajar: [] })
  })
})
