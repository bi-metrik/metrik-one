/**
 * Ingreso manual (brief del 2026-09-28): el formulario produce la MISMA lectura que una captura.
 *
 * Los números son los de la llamada con Alejandra: Verdemar, temporada baja, plan dos comidas,
 * 279.000 por adulto por noche, 223.000 por niño, infante 0; traslado in-out en San Andrés a
 * 45.000 por persona por trayecto.
 */
import { describe, expect, it } from 'vitest'

import {
  avisoFechasFueraDelViaje,
  esAvisoFechasFueraDelViaje,
  crudaDeHotelManual,
  datosManuales,
  lecturaManual,
  leerHotelManual,
  leerTrasladoManual,
  montoManual,
  nochesEntre,
  validarHotelManual,
  validarTrasladoManual,
  type HotelManual,
  type TrasladoManual,
} from './ingreso-manual'
import { ranuraPorSlug } from './ranuras-pantallazo'
import { leidosPorSlug } from './correcciones'
import { hotelesDeItems } from './detalle-viaje'
import { resolverTarifa, validarLecturaEnCasilla, composicionDeLectura, type LecturaCasilla } from './tarifa-pasajero'
import { repartirHabitaciones, resolverHabitaciones, tarifaConHabitaciones } from './habitaciones'
import { margenDelProveedor } from './margen-proveedor'
import { textosDeTarjetaHotel } from '@/lib/pdf/cotizacion-trappvel-formato'

const HOTEL = ranuraPorSlug('hotel_detalle')!
const TRASLADO = ranuraPorSlug('traslado_detalle')!
const AHORA = '2026-09-28T15:00:00Z'

const verdemar = (over: Partial<HotelManual> = {}): HotelManual => ({
  hotel: 'Hotel Verdemar',
  ciudad: 'San Andrés',
  entrada: '2026-11-23',
  salida: '2026-11-26',
  habitacion: 'Doble estándar',
  regimen: 'Desayuno y cena',
  incluye: 'Traslado aeropuerto – hotel – aeropuerto',
  adultos: 2,
  ninos: 1,
  infantes: 1,
  netoAdulto: 279_000,
  netoNino: 223_000,
  netoInfante: 0,
  edadDesde: 2,
  edadHasta: 11,
  fuente: 'Portafolio Verdemar 2026',
  ...over,
})

const inOut = (over: Partial<TrasladoManual> = {}): TrasladoManual => ({
  ruta: 'Aeropuerto – hotel',
  fecha: '2026-11-23',
  adultos: 2,
  ninos: 1,
  infantes: 0,
  cobro: 'por_persona',
  precio: 'por_trayecto',
  neto: 45_000,
  netoNino: 45_000,
  netoInfante: null,
  idaYRegreso: true,
  fuente: 'Portafolio Dolphins',
  ...over,
})

function hotel(over: Partial<HotelManual> = {}): LecturaCasilla {
  const r = lecturaManual({ ranura: HOTEL, entrada: { tipo: 'hotel', datos: verdemar(over) }, leidaEn: AHORA, hoy: '2026-09-28' })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

function traslado(over: Partial<TrasladoManual> = {}): LecturaCasilla {
  const r = lecturaManual({ ranura: TRASLADO, entrada: { tipo: 'traslado', datos: inOut(over) }, leidaEn: AHORA, hoy: '2026-09-28' })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

describe('hotel a mano: la misma lectura que una captura', () => {
  it('llena los mismos slugs de la ficha que lee un pantallazo', () => {
    const v = leidosPorSlug(HOTEL, hotel().campos)
    expect(v).toMatchObject({
      hotel: 'Hotel Verdemar',
      ciudad: 'San Andrés',
      tipo_habitacion: 'Doble estándar',
      regimen: 'Desayuno y cena',
      check_in: '2026-11-23',
      check_out: '2026-11-26',
      noches: '3',
    })
  })

  it('ONE multiplica por noches y pasajeros: el costo es el NETO, sin margen', () => {
    const l = hotel()
    expect(l.porTipo).toEqual([
      { tipo: 'adulto', cantidad: 2, subtotal: 279_000 * 3 * 2 },
      { tipo: 'nino', cantidad: 1, subtotal: 223_000 * 3 },
      { tipo: 'infante', cantidad: 1, subtotal: 0 },
    ])
    expect(l.total).toBe(279_000 * 6 + 223_000 * 3)
    expect(l.moneda).toBe('COP')
    // El margen lo pone ONE: sin «lo que paga la agencia», la opción hereda el de la cotización.
    expect(l.aPagarAgencia).toBeNull()
    expect(margenDelProveedor(l)).toBeNull()
  })

  it('la ocupación de la habitación es la que se escribió, por tipo', () => {
    const l = hotel()
    expect(composicionDeLectura(l)).toEqual({ adultos: 2, ninos: 1, infantes: 1 })
    expect(l.ocupacionDelItem).toBe(false)
  })

  it('queda marcada como manual, con la fuente, lo que incluye y la edad del niño', () => {
    const l = hotel()
    expect(l.origen).toBe('manual')
    expect(datosManuales(l)).toEqual({
      fuente: 'Portafolio Verdemar 2026',
      incluye: 'Traslado aeropuerto – hotel – aeropuerto',
      edadNino: { desde: 2, hasta: 11 },
    })
  })

  it('⚠️ ninguna alerta de «la captura no muestra…»: lo manual no es una captura', () => {
    const l = hotel({ habitacion: 'Doble', regimen: '', ciudad: '' })
    expect(l.alertas.filter(a => /captura|pantallazo/i.test(a))).toEqual([])
  })

  it('pasa la misma validación de casilla que una captura, sin alertas', () => {
    const l = hotel()
    const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: l, composicion: composicionDeLectura(l), casillas: {}, ranuraSlug: HOTEL.slug })
    expect(v).toEqual({ ok: true, alertas: [] })
  })

  it('la tarifa por pasajero se resuelve por desglose, como una captura con tabla por tipo', () => {
    const l = hotel({ infantes: 0 })
    const e = resolverTarifa({ adultos: 2, ninos: 1, infantes: 0 }, { grupo_completo: l }, HOTEL.slug)
    expect(e.estado).toBe('resuelta')
    if (e.estado === 'resuelta') expect(e.costoTotal).toBe(279_000 * 6 + 223_000 * 3)
  })

  it('un infante en 0 también se resuelve (el hotel no le cobra)', () => {
    const e = resolverTarifa({ adultos: 2, ninos: 1, infantes: 1 }, { grupo_completo: hotel() }, HOTEL.slug)
    expect(e.estado === 'resuelta' ? e.estado : JSON.stringify(e)).toBe('resuelta')
  })
})

describe('habitaciones (R8): dos habitaciones a mano cubren al grupo', () => {
  it('se reparten y suman como dos pantallazos', () => {
    const grupo = { adultos: 4, ninos: 1, infantes: 0 }
    const h1 = hotel({ adultos: 2, ninos: 0, infantes: 0 })
    const h2 = hotel({ adultos: 2, ninos: 1, infantes: 0 })
    const tarifa = tarifaConHabitaciones({}, [{ id: 'h1', lectura: h1 }, { id: 'h2', lectura: h2 }], grupo)
    expect(repartirHabitaciones(tarifa.habitaciones ?? [], grupo).cubiertos).toEqual(grupo)
    const e = resolverHabitaciones(tarifa, grupo)
    expect(e?.estado).toBe('resuelta')
    if (e?.estado === 'resuelta') expect(e.costoTotal).toBe(h1.total + h2.total)
  })
})

describe('el documento del cliente', () => {
  const item = (l: LecturaCasilla) => ({ nombre: 'HOTEL VERDEMAR', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: l } } })

  it('con rango de edad dice la tarifa niño, en los tres niveles; lo que incluye, fuera de «general»', () => {
    const [h] = hotelesDeItems([item(hotel())])
    const normal = textosDeTarjetaHotel(h, false)
    expect(normal.condiciones).toContain('Tarifa niño de 2 a 11 años cumplidos a la fecha del viaje')
    expect(normal.condiciones).toContain('Incluye: Traslado aeropuerto – hotel – aeropuerto')
    expect(normal.resumen).toContain('Desayuno y cena')
    const general = textosDeTarjetaHotel(h, true)
    expect(general.condiciones).toContain('Tarifa niño de 2 a 11 años cumplidos a la fecha del viaje')
    expect(general.condiciones).not.toContain('Incluye:')
  })

  it('sin rango de edad no dice nada de la tarifa niño', () => {
    const [h] = hotelesDeItems([item(hotel({ edadDesde: null, edadHasta: null }))])
    expect(JSON.stringify(textosDeTarjetaHotel(h, false))).not.toContain('Tarifa niño')
  })

  it('⚠️ la fuente es interna: no sale en la tarjeta ni en la descripción que imprime el documento', () => {
    const l = hotel()
    const [h] = hotelesDeItems([item(l)])
    expect(JSON.stringify(textosDeTarjetaHotel(h, false))).not.toContain('Portafolio')
    expect(l.descripcion).not.toContain('Portafolio')
    const t = traslado()
    expect(t.descripcion).not.toContain('Dolphins')
    expect(t.campos.map(c => c.valor).join(' ')).not.toContain('Dolphins')
  })
})

describe('traslado a mano', () => {
  it('por persona por trayecto, ida y regreso: neto × pasajeros × 2', () => {
    const l = traslado()
    expect(l.total).toBe(45_000 * 3 * 2)
    expect(l.porTipo).toEqual([
      { tipo: 'adulto', cantidad: 2, subtotal: 45_000 * 2 * 2 },
      { tipo: 'nino', cantidad: 1, subtotal: 45_000 * 2 },
    ])
    expect(leidosPorSlug(TRASLADO, l.campos)).toMatchObject({ trayecto: 'Aeropuerto – hotel (ida y regreso)', fecha_hora: '2026-11-23', pax: '3' })
    expect(l.aPagarAgencia).toBeNull()
    expect(l.origen).toBe('manual')
  })

  it('por vehículo, solo ida: un solo total, sin reparto por tipo', () => {
    const l = traslado({ cobro: 'por_vehiculo', neto: 120_000, idaYRegreso: false })
    expect(l.total).toBe(120_000)
    expect(l.porTipo).toEqual([])
    expect(leidosPorSlug(TRASLADO, l.campos).trayecto).toBe('Aeropuerto – hotel (solo ida)')
    expect(composicionDeLectura(l)).toEqual({ adultos: 2, ninos: 1, infantes: 0 })
  })

  // Prueba del 2026-09-28 (COT-2026-0017): 2 adultos + 1 infante, 45.000 ida y regreso daba
  // 270.000 y el PDF le ponía precio al infante. El infante va sin silla: vacío es 0.
  it('por persona, el infante sin costo escrito no paga: 2 adultos + 1 infante = 180.000', () => {
    const l = traslado({ adultos: 2, ninos: 0, infantes: 1, netoNino: null, netoInfante: null })
    expect(l.total).toBe(45_000 * 2 * 2)
    expect(l.porTipo).toEqual([
      { tipo: 'adulto', cantidad: 2, subtotal: 180_000 },
      { tipo: 'infante', cantidad: 1, subtotal: 0 },
    ])
    const e = resolverTarifa({ adultos: 2, ninos: 0, infantes: 1 }, { grupo_completo: l }, TRASLADO.slug)
    expect(e.estado === 'resuelta' ? e.costoTotal : JSON.stringify(e)).toBe(180_000)
  })

  it('por persona, cada tipo con su costo, como el hotel', () => {
    const l = traslado({ adultos: 2, ninos: 1, infantes: 1, netoNino: 30_000, netoInfante: 10_000, idaYRegreso: false })
    expect(l.total).toBe(45_000 * 2 + 30_000 + 10_000)
    expect(validarTrasladoManual(inOut({ netoNino: null }))).toHaveProperty('netoNino')
    expect(validarTrasladoManual(inOut({ netoInfante: null, infantes: 1 }))).toEqual({})
    // Por vehículo el niño y el infante no se piden: es un solo total.
    expect(validarTrasladoManual(inOut({ cobro: 'por_vehiculo', netoNino: null }))).toEqual({})
    expect(leerTrasladoManual({ netoNino: '30.000', netoInfante: '' })).toMatchObject({ netoNino: 30_000, netoInfante: null })
  })

  it('sin alertas de captura', () => {
    expect(traslado().alertas.filter(a => /captura|pantallazo/i.test(a))).toEqual([])
  })

  // Brief del 2026-09-30: los portafolios de San Andrés dan la tarifa in-out (45.000 por
  // persona YA es ida y regreso). Con «Ida y regreso» por defecto, 45.000 cobraba 90.000.
  describe('cómo viene el precio', () => {
    const dosAdultos = { adultos: 2, ninos: 0, infantes: 0, netoNino: null, netoInfante: null }

    it('in-out × 2 adultos = 90.000: el neto no se multiplica', () => {
      const l = traslado({ ...dosAdultos, precio: 'in_out' })
      expect(l.total).toBe(90_000)
      expect(l.porTipo).toEqual([{ tipo: 'adulto', cantidad: 2, subtotal: 90_000 }])
      expect(leidosPorSlug(TRASLADO, l.campos).trayecto).toBe('Aeropuerto – hotel (ida y regreso)')
    })

    it('por trayecto, ida y regreso × 2 adultos = 180.000', () => {
      const l = traslado({ ...dosAdultos, precio: 'por_trayecto', idaYRegreso: true })
      expect(l.total).toBe(180_000)
    })

    it('in-out manda sobre «Solo ida»: sigue siendo ida y regreso y no se multiplica', () => {
      const l = traslado({ ...dosAdultos, precio: 'in_out', idaYRegreso: false })
      expect(l.total).toBe(90_000)
      expect(leidosPorSlug(TRASLADO, l.campos).trayecto).toBe('Aeropuerto – hotel (ida y regreso)')
    })

    it('por vehículo, igual: in-out es el total; por trayecto ida y regreso, el doble', () => {
      expect(traslado({ cobro: 'por_vehiculo', neto: 120_000, precio: 'in_out' }).total).toBe(120_000)
      expect(traslado({ cobro: 'por_vehiculo', neto: 120_000, precio: 'por_trayecto', idaYRegreso: true }).total).toBe(240_000)
    })

    it('sin elegir no se firma: equivocarse cobra el doble o la mitad', () => {
      expect(validarTrasladoManual(inOut({ precio: null }))).toEqual({ precio: 'Elige cómo viene el precio.' })
      expect(leerTrasladoManual({ precio: 'in_out' }).precio).toBe('in_out')
      expect(leerTrasladoManual({ precio: 'por_trayecto' }).precio).toBe('por_trayecto')
      expect(leerTrasladoManual({ precio: 'otro' }).precio).toBeNull()
      expect(leerTrasladoManual({}).precio).toBeNull()
    })
  })
})

describe('hotel a mano fuera de las fechas del viaje (aviso, no bloqueo)', () => {
  const VIAJE = { inicio: '2026-11-23', fin: '2026-11-28' }

  // COT-2026-0018, Lord Pierre: la entrada se escribió el 25 de octubre y el viaje es en noviembre.
  it('entrada en octubre con el viaje en noviembre: entra, con aviso', () => {
    const r = lecturaManual({
      ranura: HOTEL, entrada: { tipo: 'hotel', datos: verdemar({ entrada: '2026-10-25', salida: '2026-11-28' }) },
      leidaEn: AHORA, hoy: '2026-09-28', viaje: VIAJE,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.lectura.alertas).toContain('El hotel va del 25 oct 2026 al 28 nov 2026 y el viaje es del 23 nov 2026 al 28 nov 2026. Revisa las fechas.')
  })

  it('dentro del viaje, o sin fechas del viaje, no avisa', () => {
    expect(avisoFechasFueraDelViaje('2026-11-25', '2026-11-28', VIAJE)).toBeNull()
    expect(avisoFechasFueraDelViaje('2026-11-23', '2026-11-28', VIAJE)).toBeNull()
    expect(avisoFechasFueraDelViaje('2026-10-25', '2026-11-28', { inicio: null, fin: null })).toBeNull()
    expect(avisoFechasFueraDelViaje('2026-10-25', '2026-11-28', null)).toBeNull()
  })

  it('una sola punta del viaje también compara', () => {
    expect(avisoFechasFueraDelViaje('2026-11-25', '2026-11-30', { inicio: null, fin: '2026-11-28' }))
      .toBe('El hotel va del 25 nov 2026 al 30 nov 2026 y el viaje es hasta el 28 nov 2026. Revisa las fechas.')
    expect(avisoFechasFueraDelViaje('2026-11-20', '2026-11-25', { inicio: '2026-11-23', fin: null }))
      .toBe('El hotel va del 20 nov 2026 al 25 nov 2026 y el viaje es desde el 23 nov 2026. Revisa las fechas.')
  })

  it('sin `viaje` no hay aviso (el camino de siempre)', () => {
    expect(hotel({ entrada: '2026-10-25' }).alertas.filter(a => /Revisa las fechas/.test(a))).toEqual([])
  })
})

describe('lo que se valida antes de firmar', () => {
  it('hotel: lo mínimo, la salida después de la entrada y el neto del adulto', () => {
    const e = validarHotelManual(verdemar({ hotel: '', habitacion: '', salida: '2026-11-23', netoAdulto: null, fuente: '' }))
    expect(Object.keys(e).sort()).toEqual(['fuente', 'habitacion', 'hotel', 'netoAdulto', 'salida'])
  })

  it('hotel: un niño sin tarifa se pide; un infante sin tarifa es 0', () => {
    expect(validarHotelManual(verdemar({ netoNino: null }))).toHaveProperty('netoNino')
    expect(validarHotelManual(verdemar({ netoInfante: null }))).toEqual({})
    expect(crudaDeHotelManual(verdemar({ netoInfante: null })).porTipoPax?.find(f => f.tipo === 'infante')?.subtotal_tipo).toBe(0)
  })

  it('hotel: el rango de edad va entero y en orden, o no va', () => {
    expect(validarHotelManual(verdemar({ edadHasta: null }))).toHaveProperty('edadHasta')
    expect(validarHotelManual(verdemar({ edadDesde: 12, edadHasta: 2 })).edadHasta).toBe('No puede ser menor que «Desde».')
    expect(validarHotelManual(verdemar({ edadDesde: null, edadHasta: null }))).toEqual({})
  })

  it('traslado: ruta, neto, pasajeros y fuente', () => {
    const e = validarTrasladoManual(inOut({ ruta: '', neto: 0, adultos: 0, ninos: 0, infantes: 0, fuente: '' }))
    expect(Object.keys(e).sort()).toEqual(['adultos', 'fuente', 'neto', 'ruta'])
    expect(e.fuente).toBe('Escribe de dónde sale la tarifa.')
  })

  it('lo que llega del navegador se lee sin confiar en su forma', () => {
    const h = leerHotelManual({ hotel: '  Hotel  Verdemar ', adultos: '2', netoAdulto: '279.000', edadDesde: '', entrada: 5 })
    expect(h).toMatchObject({ hotel: 'Hotel Verdemar', adultos: 2, ninos: 0, netoAdulto: 279_000, edadDesde: null, entrada: '' })
    expect(leerTrasladoManual({ cobro: 'otro', idaYRegreso: 'si' })).toMatchObject({ cobro: 'por_persona', idaYRegreso: false })
    expect(montoManual('$ 45.000')).toBe(45_000)
    expect(montoManual('45,000.5')).toBeNull()
    expect(nochesEntre('2026-11-23', '2026-11-26')).toBe(3)
  })
})

describe('el aviso de fechas fuera del viaje se reconoce entre las alertas', () => {
  it('el texto que arma `avisoFechasFueraDelViaje`, y ningún otro', () => {
    const viaje = { inicio: '2026-11-09', fin: '2026-11-13' }
    const aviso = avisoFechasFueraDelViaje('2026-10-09', '2026-11-13', viaje)!
    expect(esAvisoFechasFueraDelViaje(aviso)).toBe(true)
    expect(esAvisoFechasFueraDelViaje(avisoFechasFueraDelViaje('2026-11-09', '2026-11-20', { inicio: null, fin: '2026-11-13' })!)).toBe(true)
    expect(esAvisoFechasFueraDelViaje('Revisa la moneda: la captura no la muestra.')).toBe(false)
  })
})
