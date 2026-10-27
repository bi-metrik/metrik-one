import { describe, expect, it } from 'vitest'

import aliadosHotel from './__fixtures__/bloqueo/aliados-hotel.json'
import aliadosVuelos from './__fixtures__/bloqueo/aliados-vuelos.json'
import otroOperador from './__fixtures__/bloqueo/otro-operador-iconos-distintos.json'
import sinIconos from './__fixtures__/bloqueo/sin-iconos.json'
import iconoSinIdentificar from './__fixtures__/bloqueo/icono-sin-identificar.json'
import { hotelDesdeLectura, incluyeDesdeLectura, vueloDesdeLectura } from './bloqueo-extraccion'
import {
  avisosDelPaquete,
  costoDelPaquete,
  descripcionDelPaquete,
  fechaIso,
  fechasDelPaquete,
  incluidoEnPalabras,
  leerPaqueteBloqueo,
  paqueteVacio,
  vueloParaReutilizar,
  type PaqueteBloqueo,
} from './bloqueo-paquete'

function paqueteAliados(): PaqueteBloqueo {
  const h = hotelDesdeLectura(aliadosHotel)
  const v = vueloDesdeLectura(aliadosVuelos)
  if (!h.ok || !v.ok) throw new Error('fixture ilegible')
  return { ...paqueteVacio('Aliados Travel'), hotel: h.hotel, incluye: h.incluye, vuelo: v.vuelo }
}

describe('lectura del pantallazo del hotel (Aliados)', () => {
  const r = hotelDesdeLectura(aliadosHotel)
  it('lee hotel, zona sin la palabra Zona, noches, temporada, promo y la fecha límite', () => {
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.hotel.hotel).toBe('Hotel Cartagena Dubai')
    expect(r.hotel.zona).toBe('Bocagrande')
    expect(r.hotel.noches).toBe(3)
    expect(r.hotel.temporada).toBe('Baja | Regular')
    expect(r.hotel.tarifaPromo).toBe(true)
    expect(r.hotel.compraAntesDe).toBe('2027-03-31')
    expect(r.hotel.moneda).toBe('COP')
  })
  it('solo las acomodaciones que aparecen, con su precio POR PERSONA (sin cuádruple)', () => {
    if (!r.ok) throw new Error()
    expect(r.hotel.precios).toEqual([
      { acomodacion: 'triple', precioPorPersona: 1649915 },
      { acomodacion: 'doble', precioPorPersona: 1668902 },
      { acomodacion: 'sencilla', precioPorPersona: 2548649 },
    ])
    expect(r.hotel.nino).toEqual({ precio: 1365104, edadMin: 2, edadMax: 11 })
  })
  it('los cinco íconos de Aliados marcan las cinco casillas', () => {
    if (!r.ok) throw new Error()
    expect(r.incluye.casillas).toEqual({ tiquete_aereo: true, alimentacion: true, planes_tours: true, traslados: true, seguro_medico: true })
    expect(r.incluye.sinIdentificar).toEqual([])
  })
  it('un pantallazo de vuelos en la casilla del hotel se rechaza', () => {
    expect(hotelDesdeLectura({ es_oferta_de_hotel: false }).ok).toBe(false)
  })
})

describe('qué incluye: los íconos cambian de un operador a otro', () => {
  it('otro operador con íconos distintos: lo seguro marca, lo dudoso queda sin identificar, el texto suma', () => {
    const r = hotelDesdeLectura(otroOperador)
    if (!r.ok) throw new Error()
    expect(r.incluye.casillas.tiquete_aereo).toBe(true)
    expect(r.incluye.casillas.alimentacion).toBe(true)
    // La camioneta vino sin certeza, pero el texto «traslados in y out» sí lo dice.
    expect(r.incluye.casillas.traslados).toBe(true)
    // Con íconos en la pantalla, lo que no aparece es NO incluido (no vacío).
    expect(r.incluye.casillas.planes_tours).toBe(false)
    expect(r.incluye.casillas.seguro_medico).toBe(false)
    expect(r.incluye.sinIdentificar.map(i => i.descripcion)).toEqual(['palmera con sombrilla', 'camioneta'])
    expect(r.incluye.sinIdentificar.every(i => i.categoria === null)).toBe(true)
    expect(r.incluye.texto).toContain('traslados in y out')
    expect(r.hotel.precios.map(p => p.acomodacion)).toEqual(['doble', 'triple', 'cuadruple'])
  })
  it('un ícono sin identificar NUNCA se marca como incluido', () => {
    const r = incluyeDesdeLectura(iconoSinIdentificar)
    expect(r.casillas.seguro_medico).toBe(false)
    expect(r.sinIdentificar).toEqual([{ descripcion: 'escudo con una estrella', categoria: null }])
  })
  it('sin íconos ni texto, las cinco casillas quedan vacías (no se adivina)', () => {
    const r = hotelDesdeLectura(sinIconos)
    if (!r.ok) throw new Error()
    expect(Object.values(r.incluye.casillas)).toEqual([null, null, null, null, null])
    expect(r.hotel.precios).toEqual([{ acomodacion: 'doble', precioPorPersona: 1500000 }])
  })
  it('sin íconos pero con texto: solo lo que dice el texto, el resto vacío', () => {
    const r = incluyeDesdeLectura({ iconos: [], incluye_por_texto: ['traslados'], texto_incluye: 'traslados in y out' })
    expect(r.casillas).toEqual({ tiquete_aereo: null, alimentacion: null, planes_tours: null, traslados: true, seguro_medico: null })
  })
  it('la clasificación de la asesora entra a lo que incluye', () => {
    const p = paqueteAliados()
    p.incluye = incluyeDesdeLectura(iconoSinIdentificar)
    expect(incluidoEnPalabras(p.incluye)).not.toContain('Seguro médico')
    p.incluye.sinIdentificar[0].categoria = 'seguro_medico'
    expect(incluidoEnPalabras(p.incluye)).toContain('Seguro médico')
  })
})

describe('lectura del pantallazo del vuelo', () => {
  it('dos tramos con aerolínea, número sin «vuelo», horas en 24 h, fechas ISO y directo', () => {
    const r = vueloDesdeLectura(aliadosVuelos)
    if (!r.ok) throw new Error()
    expect(r.vuelo.tramos).toEqual([
      { aerolinea: 'JetSMART', numeroVuelo: '5150', origen: 'BOG', destino: 'CTG', fecha: '2027-02-05', horaSalida: '04:45', horaLlegada: '06:22', fechaLlegada: '2027-02-05', escalas: 0 },
      { aerolinea: 'JetSMART', numeroVuelo: '5167', origen: 'CTG', destino: 'BOG', fecha: '2027-02-08', horaSalida: '21:39', horaLlegada: '23:15', fechaLlegada: '2027-02-08', escalas: 0 },
    ])
  })
  it('sin tramos legibles se rechaza', () => {
    expect(vueloDesdeLectura({ es_vuelo: true, tramos: [] }).ok).toBe(false)
    expect(vueloDesdeLectura({ es_vuelo: false, tramos: [] }).ok).toBe(false)
  })
})

describe('costo del paquete', () => {
  it('el ejemplo del brief: 2 dobles + 1 sencilla + 3 triples = 14 personas, y 2 niños', () => {
    const p = paqueteAliados()
    p.distribucion = { habitaciones: { doble: 2, sencilla: 1, triple: 3 }, ninos: 2 }
    const c = costoDelPaquete(p)
    expect(c.adultos).toBe(4 + 1 + 9)
    expect(c.personas).toBe(16)
    expect(c.total).toBe(4 * 1668902 + 1 * 2548649 + 9 * 1649915 + 2 * 1365104)
    expect(c.falta).toEqual([])
  })
  it('el vuelo no suma costo', () => {
    const con = paqueteAliados()
    con.distribucion = { habitaciones: { doble: 1 }, ninos: 0 }
    const sin = { ...con, vuelo: null }
    expect(costoDelPaquete(con).total).toBe(costoDelPaquete(sin).total)
  })
  it('una acomodación sin precio en el paquete deja el costo sin total y lo dice', () => {
    const p = paqueteAliados()
    p.distribucion = { habitaciones: { cuadruple: 1 }, ninos: 0 }
    const c = costoDelPaquete(p)
    expect(c.total).toBeNull()
    expect(c.falta[0]).toMatch(/cuádruple/)
  })
  it('niños sin precio CHD', () => {
    const p = paqueteAliados()
    p.hotel.nino = null
    p.distribucion = { habitaciones: { doble: 1 }, ninos: 1 }
    expect(costoDelPaquete(p).falta).toEqual(['Falta el precio por niño (CHD).'])
  })
  it('sin distribución no hay costo', () => {
    expect(costoDelPaquete(paqueteAliados()).total).toBeNull()
  })
})

describe('fechas y avisos', () => {
  const ctx = { hoy: '2026-10-27', pasajeros: { adultos: 4, ninos: 0, infantes: 0 } }
  it('con vuelo, las fechas del viaje son las del vuelo y cuadran con 3 noches', () => {
    const p = paqueteAliados()
    p.distribucion = { habitaciones: { doble: 2 }, ninos: 0 }
    expect(fechasDelPaquete(p)).toEqual({ salida: '2027-02-05', regreso: '2027-02-08', origen: 'vuelo' })
    expect(avisosDelPaquete(p, ctx)).toEqual([])
  })
  it('vuelo que no cuadra con las noches del hotel → aviso', () => {
    const p = paqueteAliados()
    p.distribucion = { habitaciones: { doble: 2 }, ninos: 0 }
    p.hotel.noches = 4
    expect(avisosDelPaquete(p, ctx).map(a => a.clave)).toEqual(['fechas_noches'])
  })
  it('sin vuelo: regreso = salida + noches', () => {
    const p = { ...paqueteAliados(), vuelo: null, salidaManual: '2027-02-05' }
    expect(fechasDelPaquete(p)).toEqual({ salida: '2027-02-05', regreso: '2027-02-08', origen: 'manual' })
  })
  it('«Compra antes del» vencido → aviso', () => {
    const p = paqueteAliados()
    p.distribucion = { habitaciones: { doble: 2 }, ninos: 0 }
    expect(avisosDelPaquete(p, { ...ctx, hoy: '2027-04-01' }).map(a => a.clave)).toEqual(['compra_vencida'])
  })
  it('hay vuelo pero el hotel no muestra el tiquete → aviso', () => {
    const p = paqueteAliados()
    p.distribucion = { habitaciones: { doble: 2 }, ninos: 0 }
    p.incluye.casillas.tiquete_aereo = false
    expect(avisosDelPaquete(p, ctx).map(a => a.clave)).toEqual(['sin_tiquete'])
  })
  it('personas que no son los pasajeros de la solicitud → aviso; infantes sin precio → aviso', () => {
    const p = paqueteAliados()
    p.distribucion = { habitaciones: { doble: 2, sencilla: 1, triple: 3 }, ninos: 0 }
    const a = avisosDelPaquete(p, { hoy: '2026-10-27', pasajeros: { adultos: 12, ninos: 2, infantes: 1 } })
    expect(a.map(x => x.clave)).toEqual(['personas', 'infantes'])
    expect(a[0].texto).toContain('14 adultos')
  })
  it('falta de costo es rojo', () => {
    const a = avisosDelPaquete(paqueteAliados(), ctx)
    expect(a[0]).toMatchObject({ clave: 'falta_costo', nivel: 'rojo' })
  })
})

describe('guardado: tarifa_pax.bloqueo', () => {
  it('ida y vuelta por JSON se lee igual', () => {
    const p = paqueteAliados()
    p.distribucion = { habitaciones: { doble: 2 }, ninos: 1 }
    p.imagenes = { hotel: 'sbext://a/b.png', vuelo: null }
    expect(leerPaqueteBloqueo(JSON.parse(JSON.stringify(p)))).toEqual(p)
  })
  it('sin versión no es un paquete; basura se descarta', () => {
    expect(leerPaqueteBloqueo({})).toBeNull()
    expect(leerPaqueteBloqueo(null)).toBeNull()
    const raro = leerPaqueteBloqueo({ version: 1, distribucion: { habitaciones: { doble: -2, triple: '3', suite: 4 }, ninos: 'x' }, imagenes: { hotel: 'https://x' } })
    expect(raro?.distribucion).toEqual({ habitaciones: { triple: 3 }, ninos: 0 })
    expect(raro?.imagenes.hotel).toBeNull()
  })
  it('el segundo paquete ofrece el vuelo del primero', () => {
    const p = paqueteAliados()
    expect(vueloParaReutilizar([null, { ...p, vuelo: null }, p])).toBe(p.vuelo)
    expect(vueloParaReutilizar([])).toBeNull()
  })
  it('la descripción dice hotel, noches, lo que incluye y los vuelos, sin precios', () => {
    const d = descripcionDelPaquete(paqueteAliados())
    expect(d).toContain('Hotel Cartagena Dubai · Bocagrande')
    expect(d).toContain('Incluye: Tiquete aéreo, Alimentación, Planes / tours, Traslados, Seguro médico')
    expect(d).toContain('BOG → CTG · JetSMART 5150 · 5 feb 2027 04:45 · directo')
    expect(d).not.toMatch(/1\.?649/)
  })
})

describe('fechaIso', () => {
  it.each([
    ['2027-02-05', '2027-02-05'],
    ['05-Feb-2027', '2027-02-05'],
    ['31-Mar-2027', '2027-03-31'],
    ['5 de febrero de 2027', '2027-02-05'],
    ['05/02/2027', '2027-02-05'],
    ['--02-05', null],
    ['31-Feb-2027', null],
  ])('%s → %s', (entrada, salida) => {
    expect(fechaIso(entrada)).toBe(salida)
  })
})
