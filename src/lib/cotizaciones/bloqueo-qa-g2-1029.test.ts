import { describe, expect, it } from 'vitest'

import ghl from './__fixtures__/bloqueo/tureserva-ghl-tres-columnas.json'
import iberostar from './__fixtures__/bloqueo/tureserva-iberostar-tres-columnas.json'
import aliadosHotel from './__fixtures__/bloqueo/aliados-hotel.json'
import { ESQUEMA_HOTEL_BLOQUEO, PROMPT_HOTEL_BLOQUEO, hotelDesdeLectura, incluyeDesdeLectura, precioDeCosto, tipoDeColumna } from './bloqueo-extraccion'
import { avisosDelPaquete, costoDelPaquete, faltasDelPaquete, leerPaqueteBloqueo, paqueteVacio, type PaqueteBloqueo } from './bloqueo-paquete'
import { acomodacionDelPaquete, noIncluyeDePaquetes } from './bloqueo-documento'
import { incluyeDelPaquete } from './incluye-por-one'
import { empresaDelOperador, filasDeServicioDeTarifa, type ItemParaServicio } from '@/lib/viaje/servicios-desde-tarifa'
import { validarFechasEditadas } from '@/lib/viaje/fechas-servicio'
import { configHitos, hitosDelViaje, type ServicioHitos, type ViajeHitos } from '@/lib/viaje/hitos'

/**
 * G2 del QA de punta a punta de Trappvel (2026-10-29): bloqueos y paquetes. Respuestas del modelo
 * SIMULADAS a partir de los pantallazos de los viajes 01, 02 y 05: ni llaves ni red. Datos ficticios.
 */

const GRUPO = 'paquete de bloqueo: Paquete de bloqueo en San Andrés'

function deLectura(raw: unknown, operador = 'Tu Reserva'): PaqueteBloqueo {
  const h = hotelDesdeLectura(raw)
  if (!h.ok) throw new Error('fixture ilegible')
  return { ...paqueteVacio(operador), hotel: h.hotel, incluye: h.incluye }
}

describe('1 · M5-1 / M2-1: con varias columnas, el costo es la NETA de la agencia', () => {
  it('el prompt y el esquema piden cada columna con su rótulo', () => {
    expect(PROMPT_HOTEL_BLOQUEO).toMatch(/Neta agencia/)
    const item = ESQUEMA_HOTEL_BLOQUEO.properties.precios_por_persona.items.properties
    expect(item).toHaveProperty('columnas')
    expect(ESQUEMA_HOTEL_BLOQUEO.properties.nino.properties).toHaveProperty('columnas')
  })

  it('viaje 02 (GHL, Tu Reserva): aunque el modelo ponga la «con descuento» en precio, gana la neta', () => {
    const p = deLectura(ghl)
    expect(p.hotel.precios.find(x => x.acomodacion === 'doble')?.precioPorPersona).toBe(2_520_000)
    expect(p.hotel.precios.find(x => x.acomodacion === 'sencilla')?.precioPorPersona).toBe(3_696_000)
    expect(p.hotel.nino?.precio).toBe(1_424_000)
    expect(p.hotel.columnaCosto).toBe('Neta agencia')
    // 2 habitaciones de 1 adulto + 1 niño: 2 × Doble neta + 2 × CHD neta.
    p.distribucion = { habitaciones: {}, adultoConNino: 2, ninos: 2, infantes: 0, edadesNinos: [10, 6] }
    expect(costoDelPaquete(p).total).toBe(7_888_000)
  })

  it('viaje 05 (Iberostar): el rótulo manda sobre el tipo que dijo el modelo; INF sin descuento', () => {
    const p = deLectura(iberostar)
    expect(p.hotel.precios.map(x => x.precioPorPersona)).toEqual([6_312_000, 4_384_000, 4_152_000])
    expect(p.hotel.infante).toEqual({ precio: 690_000 })
    p.distribucion = { habitaciones: { doble: 1 }, ninos: 0, infantes: 1, edadesNinos: [] }
    expect(costoDelPaquete(p).total).toBe(9_458_000)
  })

  it('sin neta, la pública con descuento; nunca la pública de lista (tachada)', () => {
    expect(precioDeCosto({ precio: 3_150_000, columnas: [{ rotulo: 'Antes', tipo: 'publica', precio: 3_150_000 }, { rotulo: 'Ahora', tipo: 'unica', precio: 2_835_000 }] }))
      .toEqual({ precio: 2_835_000, columna: 'Ahora' })
    expect(tipoDeColumna('Tarifa neta agencia', 'publica')).toBe('neta')
    expect(tipoDeColumna(null, 'neta')).toBe('neta')
  })

  it('una sola columna (Aliados): lo de siempre, sin rótulo de columna', () => {
    const h = hotelDesdeLectura(aliadosHotel)
    expect(h.ok && h.hotel.precios.find(x => x.acomodacion === 'doble')?.precioPorPersona).toBe(1_668_902)
    expect(h.ok && h.hotel.columnaCosto).toBeNull()
  })

  it('la columna leída sobrevive a guardar y releer el paquete', () => {
    const p = deLectura(ghl)
    expect(leerPaqueteBloqueo(JSON.parse(JSON.stringify(p)))?.hotel.columnaCosto).toBe('Neta agencia')
  })
})

describe('2 · H2-2: habitaciones de 1 adulto + 1 niño y personas que no cuadran', () => {
  const VIAJE = { adultos: 2, ninos: 2, infantes: 0 }
  function decameron(): PaqueteBloqueo {
    const p = paqueteVacio('Aliados Travel')
    p.hotel.hotel = 'Decameron Isleño'
    p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 2_812_900 }, { acomodacion: 'cuadruple', precioPorPersona: 2_590_100 }]
    p.hotel.nino = { precio: 1_720_400, edadMin: 2, edadMax: 11 }
    return p
  }

  it('2 × (1 adulto + 1 niño): cada adulto paga Doble y cada niño CHD → $9.066.600, 4 personas, sin faltas', () => {
    const p = decameron()
    p.distribucion = { habitaciones: {}, adultoConNino: 2, ninos: 2, infantes: 0, edadesNinos: [10, 6] }
    const c = costoDelPaquete(p)
    expect(c.total).toBe(9_066_600)
    expect(c.personas).toBe(4)
    expect(c.adultos).toBe(2)
    expect(faltasDelPaquete(p, VIAJE)).toEqual([])
    expect(avisosDelPaquete(p, { hoy: '2026-10-29', pasajeros: VIAJE }).filter(a => a.clave === 'personas')).toEqual([])
    expect(acomodacionDelPaquete(p)).toBe('2 habitaciones de 1 adulto + 1 niño')
  })

  it('«Doble = 2» con 2 niños son 6 personas para un viaje de 4: frena «Enviar» y dice cómo arreglarlo', () => {
    const p = decameron()
    p.distribucion = { habitaciones: { doble: 2 }, ninos: 2, infantes: 0, edadesNinos: [10, 6] }
    const faltas = faltasDelPaquete(p, VIAJE)
    expect(faltas.map(f => f.clave)).toEqual(['personas'])
    expect(faltas[0].texto).toMatch(/6 personas y viajan 4/)
    expect(faltas[0].texto).toMatch(/1 adulto \+ 1 niño/)
    const avisos = avisosDelPaquete(p, { hoy: '2026-10-29', pasajeros: VIAJE })
    expect(avisos.find(a => a.clave === 'personas')?.nivel).toBe('rojo')
  })

  it('habitaciones de adulto con niño sin sus niños: aviso', () => {
    const p = decameron()
    p.distribucion = { habitaciones: {}, adultoConNino: 2, ninos: 0, infantes: 0, edadesNinos: [] }
    expect(avisosDelPaquete(p, { hoy: '2026-10-29', pasajeros: null }).some(a => a.clave === 'personas' && /cada una lleva su niño/.test(a.texto))).toBe(true)
  })

  it('sin la doble no hay precio para el adulto con niño', () => {
    const p = decameron()
    p.hotel.precios = p.hotel.precios.filter(x => x.acomodacion !== 'doble')
    p.distribucion = { habitaciones: {}, adultoConNino: 1, ninos: 1, infantes: 0, edadesNinos: [6] }
    expect(costoDelPaquete(p).total).toBeNull()
  })

  it('el reparto sobrevive a guardar y releer', () => {
    const p = decameron()
    p.distribucion = { habitaciones: {}, adultoConNino: 2, ninos: 2, infantes: 0, edadesNinos: [10, 6] }
    expect(leerPaqueteBloqueo(JSON.parse(JSON.stringify(p)))?.distribucion.adultoConNino).toBe(2)
  })
})

describe('3 · H10 / H1-1: al confirmar, el servicio del paquete trae operador, fechas y su vuelo', () => {
  function paqueteSanAndres(): PaqueteBloqueo {
    const p = paqueteVacio('Aliados Travel')
    p.hotel.hotel = 'Hotel Sol Caribe Campo'
    p.hotel.noches = 4
    p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 2_296_800 }]
    p.distribucion = { habitaciones: { doble: 1 }, ninos: 0, infantes: 0, edadesNinos: [] }
    p.vuelo = {
      tramos: [
        // En desorden a propósito: la fila los ordena.
        { aerolinea: 'JetSMART', numeroVuelo: '5261', origen: 'ADZ', destino: 'BOG', fecha: '2027-03-15', horaSalida: '13:10', horaLlegada: '15:20', fechaLlegada: null, escalas: 0 },
        { aerolinea: 'JetSMART', numeroVuelo: '5260', origen: 'BOG', destino: 'ADZ', fecha: '2027-03-11', horaSalida: '07:00', horaLlegada: '09:10', fechaLlegada: null, escalas: 0 },
      ],
    }
    return p
  }
  const item = (p: PaqueteBloqueo): ItemParaServicio => ({
    id: 'pq', nombre: 'HOTEL SOL CARIBE CAMPO', grupo: GRUPO, opcion_de: null, es_ajuste: false, orden: 1,
    dia_relativo: null, entra_al_precio: null, cantidad: 1, subtotal: 4_593_600, numeroDeRubros: 0,
    costoDeRubros: 0, descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: 5_404_235,
    precio_manual: false, adicionales: [], pasajeros: null, tarifa_pax: { bloqueo: p }, tramos: null,
  })
  const PARAMS = { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const }

  it('proveedor = el operador; fechas = las del vuelo; tramos = el vuelo, para Reservas', () => {
    const [f] = filasDeServicioDeTarifa({ items: [item(paqueteSanAndres())], seleccion: null, params: PARAMS, tipoRanuraPorItem: { pq: 'paquete' } })
    expect(f.proveedor_nombre).toBe('Aliados Travel')
    expect(f.buscarEmpresa).toBe(true)
    expect(f.nombre).toBe('PAQUETE · HOTEL SOL CARIBE CAMPO')
    expect(f.fecha_servicio).toBe('2027-03-11')
    expect(f.fecha_fin).toBe('2027-03-15')
    expect(f.hora_inicio).toBe('07:00')
    expect(f.tramos?.map(t => t.numero_vuelo)).toEqual(['5260', '5261'])
    expect(f.costo_cotizado).toBe(4_593_600)
  })

  it('sin vuelo: la salida del viaje + las noches', () => {
    const p = paqueteSanAndres()
    p.vuelo = null
    const [f] = filasDeServicioDeTarifa({ items: [item(p)], seleccion: null, params: PARAMS, tipoRanuraPorItem: { pq: 'paquete' }, salidaViaje: '2027-03-11' })
    expect([f.fecha_servicio, f.fecha_fin, f.tramos]).toEqual(['2027-03-11', '2027-03-15', null])
  })

  it('la empresa del Directorio con ese nombre (sin tildes ni S.A.S.), solo si hay una', () => {
    const empresas = [{ id: 'e1', nombre: 'ALIADOS TRAVEL S.A.S.' }, { id: 'e2', nombre: 'Tu Reserva' }]
    expect(empresaDelOperador('Aliados Travel', empresas)).toBe('e1')
    expect(empresaDelOperador('Aliados Travel', [...empresas, { id: 'e3', nombre: 'Aliados travel' }])).toBeNull()
    expect(empresaDelOperador('Otro operador', empresas)).toBeNull()
    expect(empresaDelOperador(null, empresas)).toBeNull()
  })

  it('la fila «otro» con tramos se corrige por tramos y pone el check-in en la agenda', () => {
    const v = validarFechasEditadas('otro', { tramos: [{ fecha: '2027-03-11', hora_salida: '07:00' }, { fecha: '2027-03-15', hora_salida: '13:10' }] })
    expect(v.ok && v.fechas.tramos?.length).toBe(2)
    const [f] = filasDeServicioDeTarifa({ items: [item(paqueteSanAndres())], seleccion: null, params: PARAMS, tipoRanuraPorItem: { pq: 'paquete' } })
    const servicio = {
      id: 's1', tipo: 'otro', nombre: f.nombre, estado: 'por_reservar', fecha_servicio: f.fecha_servicio, fecha_fin: f.fecha_fin,
      hora_inicio: f.hora_inicio, hora_fin: f.hora_fin, tramos: f.tramos, responsable_staff_id: null, confirmacion_ref: null, voucher_ref: null,
    } as unknown as ServicioHitos
    const viaje: ViajeHitos = {
      id: 'neg-1', nombre: 'P 26 1 — Viaje de prueba', cliente: 'Viajera Ficticia', clienteTelefono: null,
      estado: 'abierto', etapaNumero: 5, esPrueba: false, salida: '2027-03-11', regreso: '2027-03-15',
      internacional: false, destino: 'San Andrés', confirmadoEl: '2027-02-01', documentosCompletos: false,
      comercialStaffId: 'staff-a', operacionesStaffId: null, aprobadoresStaffIds: [],
      catalogo: configHitos({ hitos: { activo: true } }), servicios: [servicio], marcas: [],
    }
    const checkins = hitosDelViaje(viaje, '2027-03-01').filter(h => h.hitoId === 'checkin_vuelo')
    expect(checkins.length).toBe(2)
  })
})

describe('4 · V5: «Incluido» del paquete con lo que trae, y lo que no incluye', () => {
  it('se lee «No incluye» de la pantalla y llega a «A tener en cuenta»', () => {
    const i = incluyeDesdeLectura(ghl)
    expect(i.noIncluye).toBe('tarjeta de turismo, propinas')
    const p = deLectura(ghl)
    const linea = { id: 'pq', nombre: 'GHL', grupo: GRUPO, tarifa_pax: { bloqueo: p } }
    expect(noIncluyeDePaquetes([linea] as never)).toEqual(['No incluido en el paquete: tarjeta de turismo, propinas'])
    expect(leerPaqueteBloqueo(JSON.parse(JSON.stringify(p)))?.incluye.noIncluye).toBe('tarjeta de turismo, propinas')
  })

  it('«Incluido» trae hotel, tiquetes y cada categoría marcada, no solo el hotel', () => {
    const p = deLectura(ghl)
    p.vuelo = { tramos: [{ aerolinea: 'Avianca', numeroVuelo: '8410', origen: 'BOG', destino: 'ADZ', fecha: '2027-06-18', horaSalida: '05:50', horaLlegada: '08:00', fechaLlegada: null, escalas: 0 }] }
    const r = incluyeDelPaquete(p, { corto: false, detallado: false })
    expect(r).toEqual(expect.arrayContaining(['Alimentación', 'Traslados', 'Seguro médico']))
    expect(r.some(x => /^Tiquetes aéreos BOG – ADZ con Avianca/.test(x))).toBe(true)
    expect(r.some(x => /GHL Relax Hotel Sunrise Beach/.test(x))).toBe(true)
  })
})
