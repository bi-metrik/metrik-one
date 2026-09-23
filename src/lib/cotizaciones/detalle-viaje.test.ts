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
  columnasConDato,
  destinoDeItinerario,
  detalleDeLectura,
  duracionDelViaje,
  equipajeEnPalabras,
  fechaCorta,
  horaCorta,
  hotelesDeItems,
  leerConfigDocumentoViaje,
  nivelDetalleDesde,
  rangoDeFechas,
  trayectosDelVuelo,
  vuelosDeItems,
} from './detalle-viaje'

/** Lo que `LecturaCasilla.campos` guarda del vuelo real (etiqueta y valor, sin slug). */
const CAMPOS_VUELO = [
  { label: 'Aerolínea', valor: 'Avianca' },
  { label: 'Origen', valor: 'Cúcuta CUC' },
  { label: 'Destino', valor: 'Armenia AXM' },
  { label: 'Salida', valor: '--10-23' },
  { label: 'Regreso', valor: '--10-25' },
  // Las horas salen de la misma captura (medidas el 2026-09-22 contra el modelo vivo).
  // La duración va vacía porque la pantalla solo muestra la de cada TRAMO.
  { label: 'Hora de salida (ida)', valor: '05:50' },
  { label: 'Hora de llegada (ida)', valor: '10:15' },
  { label: 'Hora de salida (regreso)', valor: '18:45' },
  { label: 'Hora de llegada (regreso)', valor: '22:10' },
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
  it('arma el vuelo real de Amadeus con su ruta y su escala', () => {
    const [v] = vuelosDeItems([item('AVIANCA CÚCUTA–ARMENIA', 'vuelo', CAMPOS_VUELO)])
    expect(v.aerolinea).toBe('Avianca')
    expect(v.origen).toBe('Cúcuta CUC')
    expect(v.destino).toBe('Armenia AXM')
    expect(v.fechaSalida).toBe('23 oct')
    expect(v.fechaRegreso).toBe('25 oct')
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

  it('trae las horas de la captura real', () => {
    const [v] = vuelosDeItems([item('AVIANCA', 'vuelo', CAMPOS_VUELO)])
    expect(v.horaSalida).toBe('05:50')
    expect(v.horaLlegada).toBe('10:15')
    expect(v.horaSalidaRegreso).toBe('18:45')
    expect(v.horaLlegadaRegreso).toBe('22:10')
  })
})

describe('horas', () => {
  it('normaliza la hora a 24 horas', () => {
    expect(horaCorta('05:50')).toBe('05:50')
    expect(horaCorta('5:50')).toBe('05:50')
    expect(horaCorta('6:45 PM')).toBe('18:45')
    expect(horaCorta('12:10 a.m.')).toBe('00:10')
    expect(horaCorta('12:10 p.m.')).toBe('12:10')
  })

  it('⚠️ lo que no se reconoce como hora NO se imprime', () => {
    // Este texto lo escribe un modelo mirando una pantalla y acaba en la tabla que ve el
    // cliente. Un hueco lo llena una persona; una hora rara la copia el viajero.
    expect(horaCorta('mañana temprano')).toBeNull()
    expect(horaCorta('05:90')).toBeNull()
    expect(horaCorta('25:10')).toBeNull()
    expect(horaCorta(null)).toBeNull()
    expect(horaCorta('')).toBeNull()
  })

  it('⚠️ la DURACIÓN ya no se lee: el itinerario de referencia no la trae', () => {
    // Se leía bien (18 de 18 en el banco real). Salió porque la tabla de vuelos de la
    // referencia tiene cinco columnas —AERO, RUTA, FECHA, SALIDA, LLEGADA— y ninguna es
    // la duración. Nada más la consumía: no la mostraba ni `resumenDeLinea`.
    const [v] = vuelosDeItems([item('AVIANCA', 'vuelo', CAMPOS_VUELO)])
    expect(v).not.toHaveProperty('duracionIda')
    expect(trayectosDelVuelo(v)[0]).not.toHaveProperty('duracion')
  })
})

describe('trayectosDelVuelo', () => {
  const vuelo = () => vuelosDeItems([item('AVIANCA', 'vuelo', CAMPOS_VUELO)])[0]

  it('arma la ida y el regreso del vuelo real, con la ruta invertida a la vuelta', () => {
    const [ida, regreso] = trayectosDelVuelo(vuelo())
    expect(ida).toEqual({
      sentido: 'Ida',
      ruta: 'Cúcuta CUC – Armenia AXM',
      fecha: '23 oct',
      salida: '05:50',
      llegada: '10:15',
      escala: 'Bogotá BOG',
    })
    expect(regreso.ruta).toBe('Armenia AXM – Cúcuta CUC')
    expect(regreso.fecha).toBe('25 oct')
    expect(regreso.salida).toBe('18:45')
    expect(regreso.llegada).toBe('22:10')
  })

  it('un viaje de solo ida no produce una fila de regreso vacía', () => {
    const v = { ...vuelo(), fechaRegreso: null, horaSalidaRegreso: null, horaLlegadaRegreso: null }
    expect(trayectosDelVuelo(v).map(t => t.sentido)).toEqual(['Ida'])
  })

  it('«Directo» solo se afirma con escalas = 0, nunca con una escala sin leer', () => {
    const v = vuelo()
    expect(trayectosDelVuelo({ ...v, escalaIda: null, escalas: 0 })[0].escala).toBe('Directo')
    // Sin conteo, un `escala_ida` vacío puede ser directo o una pantalla que no mostró el
    // recorrido: son cosas distintas y no se deciden por el silencio.
    expect(trayectosDelVuelo({ ...v, escalaIda: null, escalas: null })[0].escala).toBeNull()
    // `escalas` cuenta solo la IDA: el regreso no hereda su «Directo».
    expect(trayectosDelVuelo({ ...v, escalaRegreso: null, escalas: 0 })[1].escala).toBeNull()
  })
})

describe('columnasConDato', () => {
  const vuelo = () => vuelosDeItems([item('AVIANCA', 'vuelo', CAMPOS_VUELO)])[0]

  it('⚠️ la columna sin un solo dato NO se imprime: nada de tabla con guiones', () => {
    // Las seis que existen. La AEROLÍNEA no es columna: encabeza la tarjeta.
    expect(columnasConDato(trayectosDelVuelo(vuelo()))).toEqual([
      'sentido', 'ruta', 'fecha', 'salida', 'llegada', 'escala',
    ])
  })

  it('con un solo trayecto la columna del sentido sobra', () => {
    const t = trayectosDelVuelo({ ...vuelo(), fechaRegreso: null, horaSalidaRegreso: null, horaLlegadaRegreso: null })
    expect(columnasConDato(t)).not.toContain('sentido')
  })

  it('una línea sin captura no produce ninguna columna', () => {
    const [v] = vuelosDeItems([{ nombre: 'VUELO POR CONFIRMAR', grupo: 'vuelo', tarifa_pax: null }])
    expect(columnasConDato(trayectosDelVuelo(v))).toEqual([])
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

  it('sin estrellas en la lectura y sin corrección, llegan vacías, no inventadas; el localizador no se lee', () => {
    const [h] = hotelesDeItems([item('CROWN PARADISE', 'hotel', CAMPOS_HOTEL)])
    expect(h.estrellas).toBeNull()
    expect(h.localizador).toBeNull()
  })

  it('las estrellas que mostraba la captura llegan al documento como número', () => {
    const [h] = hotelesDeItems([item('CROWN PARADISE', 'hotel', [...CAMPOS_HOTEL, { label: 'Estrellas', valor: '5' }])])
    expect(h.estrellas).toBe(5)
  })
})

describe('cargosEnDestinoDeItems', () => {
  it('saca los impuestos de destino en su moneda local, sin convertirlos', () => {
    const [c] = cargosEnDestinoDeItems([item('CROWN PARADISE', 'hotel', CAMPOS_HOTEL)])
    expect(c.monto).toBe('329,44 MXN')
    expect(c.ciudad).toBe('Cancun (y alrededores)')
    expect(c.observacion).toContain('No está incluido en el precio')
  })

  it('lo guardado con punto de miles sale entero en el documento (ensayo del 2026-09-23)', () => {
    // La lectura guarda el texto que devolvió el modelo. El Riu quedó con «50.080» y el PDF del
    // cliente imprimió «50,08 COP». Como el texto sigue guardado, la corrección alcanza también
    // a las lecturas viejas: basta volver a generar el documento.
    const conImpuesto = (valor: string) => CAMPOS_HOTEL.map(c =>
      c.label === 'Impuestos en destino' ? { ...c, valor }
        : c.label === 'Moneda de los impuestos en destino' ? { ...c, valor: 'COP' } : c)
    expect(cargosEnDestinoDeItems([item('RIU', 'hotel', conImpuesto('50.080'))])[0].monto).toBe('50.080 COP')
    expect(cargosEnDestinoDeItems([item('SUNSCAPE', 'hotel', conImpuesto('64.200'))])[0].monto).toBe('64.200 COP')
    expect(cargosEnDestinoDeItems([item('HYATT', 'hotel', conImpuesto('64200'))])[0].monto).toBe('64.200 COP')
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

/**
 * Brief del 2026-09-22, punto 3: lo que corrige una persona es lo que imprime el documento, y
 * lo que dijo la IA sigue guardado en la casilla.
 */
describe('el documento imprime lo corregido encima de lo leído', () => {
  const corregido = (campos: { label: string; valor: string }[], grupo: string, correcciones: Record<string, string | null>) => {
    const base = item('L', grupo, campos)
    return {
      ...base,
      tarifa_pax: {
        ...base.tarifa_pax,
        correcciones: Object.fromEntries(
          Object.entries(correcciones).map(([k, v]) => [k, { valor: v, por: 'Daniela', porId: 'p1', en: '2026-09-22T20:00:00Z' }]),
        ),
      },
    }
  }

  it('una hora de vuelo corregida sale en la tabla; la lectura queda igual en la casilla', () => {
    const it0 = corregido(CAMPOS_VUELO, 'vuelo', { hora_salida: '07:45' })
    const [v] = vuelosDeItems([it0])
    expect(v.horaSalida).toBe('07:45')
    expect(v.horaLlegada).toBe('10:15')
    expect(it0.tarifa_pax.casillas.grupo_completo.campos.find(c => c.label === 'Hora de salida (ida)')?.valor).toBe('05:50')
  })

  it('el equipaje corregido cambia lo que se le dice al cliente', () => {
    const [v] = vuelosDeItems([corregido(CAMPOS_VUELO, 'vuelo', { equipaje_mano: 'true', equipaje_bodega: 'true' })])
    expect(v.equipaje).toBe('artículo personal + equipaje de mano + equipaje de bodega')
  })

  it('las estrellas escritas a mano se imprimen; corregidas a vacío, no se imprimen', () => {
    const conEstrellas = [...CAMPOS_HOTEL, { label: 'Estrellas', valor: '4' }]
    expect(hotelesDeItems([corregido(CAMPOS_HOTEL, 'hotel', { estrellas: '3' })])[0].estrellas).toBe(3)
    expect(hotelesDeItems([corregido(conEstrellas, 'hotel', { estrellas: '5' })])[0].estrellas).toBe(5)
    expect(hotelesDeItems([corregido(conEstrellas, 'hotel', { estrellas: null })])[0].estrellas).toBeNull()
  })

  it('los impuestos en destino corregidos cambian el cargo; corregidos a vacío, lo quitan', () => {
    expect(cargosEnDestinoDeItems([corregido(CAMPOS_HOTEL, 'hotel', { impuestos_destino_valor: '400' })])[0].monto).toBe('400 MXN')
    expect(cargosEnDestinoDeItems([corregido(CAMPOS_HOTEL, 'hotel', { impuestos_destino_valor: null })])).toEqual([])
  })

  it('una línea que no es ranura, sin lectura, sigue sin detalle aunque traiga correcciones', () => {
    // Las correcciones solas no vuelven hotel a una línea: lo que dice qué es, es la lectura.
    expect(hotelesDeItems([corregido([], 'seguro', { estrellas: '5' })])).toEqual([])
  })
})

/**
 * ⚠️⚠️ COT-2026-0006 (2026-09-22): el vuelo «AVIANCA BOG - ADZ» se cobraba en «Inversión» y
 * no aparecía ni en la tabla de vuelos ni en el día a día.
 *
 * Su lectura estaba completa en la base (aerolínea, fechas, números de vuelo), pero su grupo
 * era `avianca bog - adz`, un nombre libre que no resuelve a ninguna ranura. El documento
 * solo preguntaba por el grupo.
 */
describe('la ranura sale de la lectura cuando el grupo no es una', () => {
  // La lectura de producción de COT-2026-0006, tal cual (sin códigos IATA en la ruta).
  const CAMPOS_AVIANCA_0006 = [
    { label: 'Aerolínea', valor: 'Avianca' },
    { label: 'Origen', valor: 'Bogotá' },
    { label: 'Destino', valor: 'San Andrés Isla' },
    { label: 'Salida', valor: '2026-11-23' },
    { label: 'Regreso', valor: '2026-11-28' },
    { label: 'Nº de vuelo', valor: '9782, 9779' },
    { label: 'Escalas', valor: '0' },
    { label: 'Tarifa', valor: 'BASIC Economy' },
    { label: 'Equipaje de bodega', valor: 'true' },
    { label: 'Equipaje de mano', valor: 'true' },
    { label: 'Pasajeros', valor: '8' },
    { label: 'Moneda', valor: 'COP' },
    { label: 'Precio', valor: '6208296' },
  ]

  it('⚠️⚠️ COT-2026-0006: el vuelo con grupo libre y lectura de vuelo SÍ es un vuelo', () => {
    const [v] = vuelosDeItems([item('AVIANCA BOG - ADZ', 'avianca bog - adz', CAMPOS_AVIANCA_0006)])
    expect(v).toBeDefined()
    expect(v.aerolinea).toBe('Avianca')
    // Lo leído manda: la ruta sale de la lectura, no del nombre, aunque el nombre traiga IATA.
    expect(v.origen).toBe('Bogotá')
    expect(v.destino).toBe('San Andrés Isla')
    expect(v.fechaSalida).toBe('23 nov 2026')
    expect(v.fechaRegreso).toBe('28 nov 2026')
    expect(v.numeroVuelo).toBe('9782, 9779')
  })

  it('con un hotel pasa lo mismo: su lectura lo hace hotel', () => {
    const [h] = hotelesDeItems([item('CROWN', 'crown paradise', CAMPOS_HOTEL)])
    expect(h.hotel).toBe('Crown Paradise Club Cancun All Inclusive')
    expect(vuelosDeItems([item('CROWN', 'crown paradise', CAMPOS_HOTEL)])).toEqual([])
  })

  it('el grupo manda cuando resuelve: una lectura de vuelo en un grupo de hotel no es un vuelo', () => {
    expect(vuelosDeItems([item('X', 'hotel', CAMPOS_VUELO)])).toEqual([])
  })

  it('una lectura con solo etiquetas compartidas (moneda, precio) no dice de qué es', () => {
    const soloPrecio = [{ label: 'Moneda', valor: 'COP' }, { label: 'Precio', valor: '100' }]
    expect(vuelosDeItems([item('X', 'libre', soloPrecio)])).toEqual([])
    expect(hotelesDeItems([item('X', 'libre', soloPrecio)])).toEqual([])
  })
})

describe('un vuelo sin lectura: solo lo que dice su nombre', () => {
  it('con grupo libre, entra si el nombre trae aerolínea y ruta IATA; sin fechas ni horas', () => {
    const [v] = vuelosDeItems([{ nombre: 'AVIANCA BOG - ADZ', grupo: 'avianca bog - adz', tarifa_pax: null }])
    expect(v.aerolinea).toBe('AVIANCA')
    expect(v.origen).toBe('BOG')
    expect(v.destino).toBe('ADZ')
    expect(v.fechaSalida).toBeNull()
    expect(v.horaSalida).toBeNull()
    expect(v.numeroVuelo).toBeNull()
  })

  it('con grupo libre y un nombre que no es de vuelo, no entra', () => {
    expect(vuelosDeItems([{ nombre: 'TRASLADO APT - HTL', grupo: 'traslado privado', tarifa_pax: null }])).toEqual([])
    expect(vuelosDeItems([{ nombre: 'SEGURO DE VIAJE', grupo: 'seguro', tarifa_pax: null }])).toEqual([])
  })

  it('con grupo de vuelo, la ruta del nombre llena lo que la captura no trajo', () => {
    const [v] = vuelosDeItems([{ nombre: 'LATAM MDE - CTG', grupo: 'vuelo', tarifa_pax: null }])
    expect(v.aerolinea).toBe('LATAM')
    expect(v.origen).toBe('MDE')
    expect(v.destino).toBe('CTG')
  })

  it('⚠️ lo del nombre no se mezcla con lo leído: con origen leído, el destino no sale del nombre', () => {
    const [v] = vuelosDeItems([item('AVIANCA BOG - ADZ', 'vuelo', [{ label: 'Origen', valor: 'Bogotá' }])])
    expect(v.origen).toBe('Bogotá')
    expect(v.destino).toBeNull()
  })
})
