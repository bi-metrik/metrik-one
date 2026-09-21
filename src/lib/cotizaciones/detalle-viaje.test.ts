/**
 * El detalle del viaje que se imprime, armado con lecturas REALES del banco de capturas.
 *
 * Los valores de los dos casos salen tal cual de
 * `proyectos/trappvel/clarity/qa/` (corridas del 2026-09-16 y del 2026-09-18 contra el
 * modelo vivo): el vuelo Cúcuta–Armenia de Avianca por Amadeus, tarifa BASIC, y el hotel
 * Crown Paradise de Cancún por Bedsonline con sus impuestos en destino. Inventar un
 * fixture «bonito» habría escondido justo lo que muerde: la fecha sin año (`--10-23`) y
 * los números de vuelo pegados con « · ».
 */
import { describe, expect, it } from 'vitest'

import {
  cargosEnDestinoDeItems,
  destinoDeItinerario,
  detalleDeLectura,
  duracionDelViaje,
  equipajeEnPalabras,
  fechaCorta,
  hotelesDeItems,
  leerConfigDocumentoViaje,
  nivelDetalleDesde,
  rangoDeFechas,
  vuelosDeItems,
} from './detalle-viaje'

/** Lo que `LecturaCasilla.campos` guarda del vuelo real (etiqueta y valor, sin slug). */
const CAMPOS_VUELO = [
  { label: 'Aerolínea', valor: 'Avianca' },
  { label: 'Origen', valor: 'Cúcuta CUC' },
  { label: 'Destino', valor: 'Armenia AXM' },
  { label: 'Salida', valor: '--10-23' },
  { label: 'Regreso', valor: '--10-25' },
  { label: 'Nº de vuelo', valor: '9459 · 4867 · 9842 · 9488' },
  { label: 'Escalas', valor: '1' },
  { label: 'Escala (ida)', valor: 'Bogotá BOG' },
  { label: 'Escala (regreso)', valor: 'Bogotá BOG' },
  { label: 'Tarifa', valor: 'BASIC Standard economy' },
  { label: 'Artículo personal', valor: 'true' },
  { label: 'Equipaje de mano', valor: 'false' },
  { label: 'Equipaje de bodega', valor: 'false' },
  { label: 'Pasajeros', valor: '3' },
  { label: 'Moneda', valor: 'COP' },
  { label: 'Precio', valor: '1294351' },
]

const CAMPOS_HOTEL = [
  { label: 'Hotel', valor: 'Crown Paradise Club Cancun All Inclusive' },
  { label: 'Ciudad', valor: 'Cancun (y alrededores)' },
  { label: 'Habitación', valor: 'Standard Double' },
  { label: 'Régimen', valor: 'Todo incluido' },
  { label: 'Check-in', valor: '2026-12-19' },
  { label: 'Check-out', valor: '2026-12-23' },
  { label: 'Noches', valor: '4' },
  { label: 'Ocupación', valor: '2 Adultos - 1 Niño' },
  { label: 'Cancelación', valor: 'Cancelación gratuita hasta 30/11/2026' },
  { label: 'Impuestos en destino', valor: '329.44' },
  { label: 'Moneda de los impuestos en destino', valor: 'MXN' },
]

const item = (nombre: string, grupo: string | null, campos: { label: string; valor: string }[]) => ({
  nombre,
  grupo,
  tarifa_pax: {
    composicion: { adultos: 2, ninos: 0, infantes: 1 },
    casillas: { grupo_completo: { moneda: 'COP', total: 1, campos } },
  },
})

describe('detalleDeLectura', () => {
  it('devuelve los campos por su slug, no por su etiqueta', () => {
    const d = detalleDeLectura('vuelo', CAMPOS_VUELO)
    expect(d.aerolinea).toBe('Avianca')
    expect(d.numero_vuelo).toBe('9459 · 4867 · 9842 · 9488')
    expect(d.escala_ida).toBe('Bogotá BOG')
  })

  it('un grupo que no es ranura no tiene detalle: la línea «+ Otro» no tiene captura', () => {
    expect(detalleDeLectura(null, CAMPOS_VUELO)).toEqual({})
    expect(detalleDeLectura('seguro', CAMPOS_VUELO)).toEqual({})
  })

  it('resuelve sinónimos del grupo y no distingue tildes', () => {
    expect(detalleDeLectura('Aéreo', CAMPOS_VUELO).aerolinea).toBe('Avianca')
  })

  it('le quita el marcador interno «(del viaje)» al valor que no salió de la imagen', () => {
    const d = detalleDeLectura('hotel', [{ label: 'Check-in', valor: '2026-12-19 (del viaje)' }])
    expect(d.check_in).toBe('2026-12-19')
  })
})

describe('fechas', () => {
  it('imprime el año solo cuando la captura lo mostró', () => {
    expect(fechaCorta('2026-12-19')).toBe('19 dic 2026')
    // La lectura devuelve `--MM-DD` justamente para no inventar el año.
    expect(fechaCorta('--10-23')).toBe('23 oct')
    expect(fechaCorta(null)).toBeNull()
    expect(fechaCorta('mañana')).toBeNull()
  })

  it('el rango aguanta que falte una de las dos fechas', () => {
    expect(rangoDeFechas('2026-12-19', '2026-12-23')).toBe('19 dic 2026 – 23 dic 2026')
    expect(rangoDeFechas('2026-12-19', null)).toBe('19 dic 2026')
    expect(rangoDeFechas(null, null)).toBeNull()
  })

  it('la duración sale de fechas completas, y nunca de una a medias', () => {
    expect(duracionDelViaje('2026-12-19', '2026-12-23')).toBe('5 días / 4 noches')
    expect(duracionDelViaje('2026-12-19', '2026-12-19')).toBe('1 día')
    // Sin año no se puede saber si el regreso es del año siguiente: hueco, no invento.
    expect(duracionDelViaje('--10-23', '--10-25')).toBeNull()
    // Un regreso anterior a la salida es un dato malo: no se imprime una duración negativa.
    expect(duracionDelViaje('2026-12-23', '2026-12-19')).toBeNull()
  })
})

describe('equipaje', () => {
  it('lo dice en palabras a partir de los iconos resaltados', () => {
    expect(equipajeEnPalabras({ equipaje_personal: 'true', equipaje_mano: 'false', equipaje_bodega: 'false' }))
      .toBe('artículo personal')
    expect(equipajeEnPalabras({ equipaje_personal: 'true', equipaje_mano: 'true', equipaje_bodega: 'true' }))
      .toBe('artículo personal + equipaje de mano + equipaje de bodega')
  })

  it('los tres en false SÍ se afirman: es lo que la captura mostró', () => {
    expect(equipajeEnPalabras({ equipaje_personal: 'false', equipaje_mano: 'false', equipaje_bodega: 'false' }))
      .toBe('Sin equipaje incluido')
  })

  it('sin lectura de equipaje NO se afirma nada', () => {
    expect(equipajeEnPalabras({})).toBeNull()
  })
})

describe('vuelosDeItems', () => {
  it('arma el vuelo real de Amadeus con su ruta, su número y su escala', () => {
    const [v] = vuelosDeItems([item('AVIANCA CÚCUTA–ARMENIA', 'vuelo', CAMPOS_VUELO)])
    expect(v.aerolinea).toBe('Avianca')
    expect(v.origen).toBe('Cúcuta CUC')
    expect(v.destino).toBe('Armenia AXM')
    expect(v.fechaSalida).toBe('23 oct')
    expect(v.fechaRegreso).toBe('25 oct')
    expect(v.numeroVuelo).toBe('9459 · 4867 · 9842 · 9488')
    expect(v.escalaIda).toBe('Bogotá BOG')
    expect(v.escalaRegreso).toBe('Bogotá BOG')
    expect(v.escalas).toBe(1)
    expect(v.tarifa).toBe('BASIC Standard economy')
    expect(v.equipaje).toBe('artículo personal')
  })

  it('una línea sin captura conserva su nombre y no inventa el resto', () => {
    const [v] = vuelosDeItems([{ nombre: 'VUELO POR CONFIRMAR', grupo: 'vuelo', tarifa_pax: null }])
    expect(v.linea).toBe('VUELO POR CONFIRMAR')
    expect(v.aerolinea).toBeNull()
    expect(v.escalaIda).toBeNull()
  })

  it('solo entran las líneas de vuelo', () => {
    const items = [
      item('HOTEL', 'hotel', CAMPOS_HOTEL),
      item('AVIANCA', 'vuelo', CAMPOS_VUELO),
      { nombre: 'EQUIPAJE COMPRADO APARTE', grupo: null, tarifa_pax: null },
    ]
    expect(vuelosDeItems(items).map(v => v.linea)).toEqual(['AVIANCA'])
  })
})

describe('hotelesDeItems', () => {
  it('arma la ficha del hotel real de Bedsonline', () => {
    const [h] = hotelesDeItems([item('CROWN PARADISE', 'hotel', CAMPOS_HOTEL)])
    expect(h.hotel).toBe('Crown Paradise Club Cancun All Inclusive')
    expect(h.ciudad).toBe('Cancun (y alrededores)')
    expect(h.habitacion).toBe('Standard Double')
    expect(h.regimen).toBe('Todo incluido')
    expect(h.checkIn).toBe('19 dic 2026')
    expect(h.checkOut).toBe('23 dic 2026')
    expect(h.noches).toBe(4)
    expect(h.ocupacion).toBe('2 Adultos - 1 Niño')
  })

  it('las noches se derivan de las fechas cuando la captura no las dijo', () => {
    const sinNoches = CAMPOS_HOTEL.filter(c => c.label !== 'Noches')
    expect(hotelesDeItems([item('H', 'hotel', sinNoches)])[0].noches).toBe(4)
  })

  it('estrellas y localizador NO se leen hoy: llegan vacíos, no inventados', () => {
    const [h] = hotelesDeItems([item('CROWN PARADISE', 'hotel', CAMPOS_HOTEL)])
    expect(h.estrellas).toBeNull()
    expect(h.localizador).toBeNull()
  })
})

describe('cargosEnDestinoDeItems', () => {
  it('saca los impuestos de destino en su moneda local, sin convertirlos', () => {
    const [c] = cargosEnDestinoDeItems([item('CROWN PARADISE', 'hotel', CAMPOS_HOTEL)])
    expect(c.monto).toBe('329,44 MXN')
    expect(c.ciudad).toBe('Cancun (y alrededores)')
    expect(c.observacion).toContain('No está incluido en el precio')
  })

  it('sin impuestos en destino no hay fila', () => {
    const sinImpuestos = CAMPOS_HOTEL.filter(c => !c.label.startsWith('Impuestos') && !c.label.startsWith('Moneda de'))
    expect(cargosEnDestinoDeItems([item('H', 'hotel', sinImpuestos)])).toEqual([])
  })
})

describe('destinoDeItinerario', () => {
  it('se arma con las ciudades del propio itinerario, sin repetir', () => {
    const vuelos = vuelosDeItems([item('AVIANCA', 'vuelo', CAMPOS_VUELO)])
    const hoteles = hotelesDeItems([item('CROWN', 'hotel', CAMPOS_HOTEL)])
    expect(destinoDeItinerario(vuelos, hoteles)).toBe('Cancun (y alrededores) · Armenia AXM')
  })

  it('sin ciudades devuelve null: la ficha no se pinta en vez de decir «—»', () => {
    expect(destinoDeItinerario([], [])).toBeNull()
  })
})

describe('nivelDetalleDesde', () => {
  it('acepta los tres niveles declarados', () => {
    expect(nivelDetalleDesde('muy_detallada')).toBe('muy_detallada')
    expect(nivelDetalleDesde('general')).toBe('general')
  })

  it('cualquier otra cosa cae en «normal», incluido el vocabulario viejo de formato', () => {
    expect(nivelDetalleDesde(null)).toBe('normal')
    expect(nivelDetalleDesde('por_total')).toBe('normal')
    expect(nivelDetalleDesde(7)).toBe('normal')
  })
})

describe('leerConfigDocumentoViaje', () => {
  it('lee el pie y la firma declarados por el workspace', () => {
    const c = leerConfigDocumentoViaje({
      documento_viaje: {
        pie: 'www.trappvel.com · contacto@trappvel.com',
        firma: { nombre: 'Edgar Javier Alarcón S.', cargo: 'Director Comercial' },
      },
    })
    expect(c.pie).toBe('www.trappvel.com · contacto@trappvel.com')
    expect(c.firma).toEqual({ nombre: 'Edgar Javier Alarcón S.', cargo: 'Director Comercial', contacto: null })
  })

  it('una firma sin nombre no es una firma', () => {
    expect(leerConfigDocumentoViaje({ documento_viaje: { firma: { cargo: 'Director' } } }).firma).toBeNull()
  })

  it('sin configuración devuelve los dos vacíos, y un jsonb roto también', () => {
    expect(leerConfigDocumentoViaje(null)).toEqual({ pie: null, firma: null })
    expect(leerConfigDocumentoViaje({ documento_viaje: 'sí' })).toEqual({ pie: null, firma: null })
  })
})
