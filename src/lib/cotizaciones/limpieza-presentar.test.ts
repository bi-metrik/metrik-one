/**
 * Brief del 2026-10-05, «última limpieza de la cotización de Trappvel antes de presentar»:
 * puntos 9, 10 y 11, puros. Los recorridos por el editor están en
 * `src/app/(app)/negocios/limpieza-presentar-e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { capitulosDelViaje, claveDeCiudad } from '@/lib/pdf/cotizacion-trappvel-formato'
import { hotelesDeItems, type HotelPDF } from './detalle-viaje'
import { fichaDeOpcion } from './opcion-viaje'
import { nombreVisibleDeLinea } from './nombre-visible'
import { pasajerosParaCuadre, precioCuadradoPorPasajero } from './cuadre-pasajero'
import { calcularCascada } from './totales'
import { precioPorPasajero, type LecturaCasilla, type TarifaConfirmada } from './tarifa-pasajero'
import { aMayusculas } from '@/lib/negocios/mayusculas'
import { motivoFaltaCosto, tasasPendientesPorLinea } from './falta-costo'
import { motivosDeBorrador, textoDeMarca } from './motivos-borrador'

const hotel = (over: Partial<HotelPDF>): HotelPDF => ({
  linea: 'HOTEL', hotel: 'Hotel', ciudad: 'Providencia', habitacion: null, regimen: null, checkIn: null,
  checkOut: null, noches: null, ocupacion: null, cancelacion: null, estrellas: null, localizador: null,
  adicionales: [], nota: null, ...over,
} as HotelPDF)

function lectura(over: Partial<LecturaCasilla>): LecturaCasilla {
  return {
    total: 1_600_000, moneda: 'COP', aPagarAgencia: null, porTipo: [],
    ocupacion: { adultos: 2, ninos: null, infantes: null, total: 2 }, ocupacionDelItem: false,
    identidad: {}, notasCliente: [], alertas: [], campos: [], nombre: '', descripcion: '',
    leidaEn: '2026-10-05T12:00:00Z', ...over,
  }
}

describe('punto 9 · un solo capítulo por ciudad', () => {
  it('«Providencia» y «Providencia, San Andrés y Providencia, Colombia» son la misma ciudad', () => {
    const caps = capitulosDelViaje([
      hotel({ hotel: 'PRUEBA QA 974', ciudad: 'Providencia' }),
      hotel({ hotel: 'Hotel Sirius QA 976', ciudad: 'Providencia, San Andrés y Providencia, Colombia' }),
    ], null, 'Providencia')
    expect(caps).toHaveLength(1)
    expect(caps[0].ciudad).toBe('Providencia')
    expect(caps[0].alternativas.map(h => h.hotel)).toEqual(['Hotel Sirius QA 976'])
  })

  it('el capítulo se nombra con la ciudad, sin departamento ni país', () => {
    const [cap] = capitulosDelViaje([hotel({ ciudad: 'Providencia, San Andrés y Providencia, Colombia' })], null, null)
    expect(cap.ciudad).toBe('Providencia')
    expect(claveDeCiudad('PROVIDENCIA (PVA)')).toBe(claveDeCiudad('Providencia'))
  })

  it('lo que no cambia: dos ciudades distintas siguen siendo dos capítulos', () => {
    expect(capitulosDelViaje([hotel({ ciudad: 'San Andrés' }), hotel({ ciudad: 'Providencia' })], null, null)).toHaveLength(2)
  })

  it('el hotel costeado para 2 adultos + 1 infante no dice «2 adultos» aunque la captura lo diga', () => {
    const confirmada = { composicion: { adultos: 2, ninos: 0, infantes: 1 }, costos: [], costoTotalCOP: 1_600_000 } as unknown as TarifaConfirmada
    const l = lectura({ campos: [{ label: 'Hotel', valor: 'Hotel Sirius QA 976' }, { label: 'Ocupación', valor: '2 adultos' }] })
    const [h] = hotelesDeItems([{ nombre: 'X', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: l }, confirmada }, adicionales: [] }])
    expect(h.ocupacion).toBe('2 adultos + 1 infante')
    // Sin confirmación, lo que dijo la captura.
    const [sin] = hotelesDeItems([{ nombre: 'X', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: l } }, adicionales: [] }])
    expect(sin.ocupacion).toBe('2 adultos')
  })
})

describe('punto 10 · sin MAYÚSCULAS ni «Tarifa Tarifa»', () => {
  it('el vuelo y la actividad se muestran como se leyeron', () => {
    const vuelo = lectura({ nombre: 'Satena Bogotá (BOG)–Providencia (PVA)' })
    const act = lectura({ nombre: 'Excursión a Cayo Cangrejo' })
    expect(nombreVisibleDeLinea({ nombre: aMayusculas(vuelo.nombre), grupo: 'vuelo', tarifa_pax: { casillas: { grupo_completo: vuelo } } }))
      .toBe('Satena Bogotá (BOG)–Providencia (PVA)')
    expect(nombreVisibleDeLinea({ nombre: 'EXCURSIÓN A CAYO CANGREJO', grupo: 'actividad 2: Actividad en Providencia', tarifa_pax: { casillas: { grupo_completo: act } } }))
      .toBe('Excursión a Cayo Cangrejo')
  })

  it('un nombre que escribió una persona se respeta', () => {
    const act = lectura({ nombre: 'Excursión a Cayo Cangrejo' })
    expect(nombreVisibleDeLinea({ nombre: 'TOUR PRIVADO', grupo: 'actividad', tarifa_pax: { casillas: { grupo_completo: act } } })).toBe('TOUR PRIVADO')
  })

  it('«Tarifa Económica» no se vuelve «Tarifa Tarifa Económica»; «Classic» sí lleva la palabra', () => {
    const conTarifa = (familia: string) => fichaDeOpcion({
      nombre: 'SATENA', grupo: 'vuelo', tarifa_pax: { casillas: { grupo_completo: lectura({ campos: [{ label: 'Aerolínea', valor: 'Satena' }, { label: 'Tarifa', valor: familia }] }) } },
    }, null)[0]
    expect(conTarifa('Tarifa Económica')).toBe('Satena · Tarifa Económica')
    expect(conTarifa('Classic')).toBe('Satena · Tarifa Classic')
  })
})

describe('punto 11 · el precio de la línea es lo que pagan los pasajeros', () => {
  const adultosEInfante = [{ cantidad: 2, peso: 180_000 }, { cantidad: 1, peso: 0 }]

  it('211.764,7 con 2 adultos que pagan: 105.882 × 2 = 211.764', () => {
    expect(precioCuadradoPorPasajero(180_000 / 0.85, adultosEInfante)).toBe(211_764)
  })

  it('varios tipos: la suma de los precios por pasajero redondeados es el precio', () => {
    const filas = [{ cantidad: 6, peso: 5_547_822 }, { cantidad: 1, peso: 649_137 }, { cantidad: 1, peso: 11_337 }]
    const p = precioCuadradoPorPasajero(7_303_878.4, filas)
    const conf = { costos: filas.map((f, i) => ({ tipo: (['adulto', 'nino', 'infante'] as const)[i], cantidad: f.cantidad, unitarioCOP: 0, totalCOP: f.peso })) } as unknown as TarifaConfirmada
    const porPax = precioPorPasajero(conf, p)
    expect(porPax.reduce((a, x) => a + x.precioUnitario * x.cantidad, 0)).toBe(p)
    expect(Math.abs(p - 7_303_878)).toBeLessThanOrEqual(8)
  })

  it('la cascada lo aplica solo con pasajeros; sin ellos, lo de siempre (Termotech no cambia)', () => {
    const base = { id: 't', cantidad: 1, subtotal: 0, numeroDeRubros: 1, costoDeRubros: 180_000, precio_venta: 0, precio_manual: false }
    const params = { margenPct: 15, convencionMargen: 'sobre_venta' as const }
    expect(calcularCascada([base], params).lineas[0].precioLinea).toBe(211_765)
    expect(calcularCascada([{ ...base, pasajeros: adultosEInfante }], params).lineas[0].precioLinea).toBe(211_764)
    // Un precio escrito a mano manda tal cual.
    expect(calcularCascada([{ ...base, precio_manual: true, precio_venta: 211_765, pasajeros: adultosEInfante }], params).lineas[0].precioLinea).toBe(211_765)
  })

  it('las filas salen de la confirmación vigente y sin precios a mano', () => {
    const confirmada = { composicion: { adultos: 2, ninos: 0, infantes: 1 }, costoTotalCOP: 180_000, costos: [
      { tipo: 'adulto', cantidad: 2, unitarioCOP: 90_000, totalCOP: 180_000 },
      { tipo: 'infante', cantidad: 1, unitarioCOP: 0, totalCOP: 0 },
    ] }
    expect(pasajerosParaCuadre({ confirmada }, 180_000)).toEqual(adultosEInfante)
    // El costo cambió después de confirmar: el reparto ya no describe la línea.
    expect(pasajerosParaCuadre({ confirmada }, 200_000)).toBeNull()
    expect(pasajerosParaCuadre({ confirmada, preciosAMano: { adulto: { precio: 100_000, por: null, porId: null, en: 'x' } } }, 180_000)).toBeNull()
    expect(pasajerosParaCuadre(null, 180_000)).toBeNull()
  })
})

describe('punto 12 · moneda sin tasa: el rechazo y la marca dicen la tasa', () => {
  const eur = lectura({
    total: 95, moneda: 'EUR', ocupacion: { adultos: null, ninos: null, infantes: null, total: 3 },
    nombre: 'Clase de buceo para principiantes', identidad: { nombre: 'Clase de buceo para principiantes' },
    paraComposicion: { adultos: 2, ninos: 0, infantes: 1 },
  })
  const linea = { id: 'buceo', nombre: 'CLASE DE BUCEO PARA PRINCIPIANTES', grupo: 'actividad 7: Actividad en Providencia', tarifa_pax: { casillas: { grupo_completo: eur } } }

  it('el motivo del servidor nombra la tasa, igual que «Revisar y enviar»', () => {
    const tasas = tasasPendientesPorLinea([linea], { adultos: 2, ninos: 0, infantes: 1 })
    expect(tasas.get('buceo')).toBe('El precio está en EUR: escribe la tasa de cambio para cargar el costo.')
    expect(motivoFaltaCosto([{ id: 'buceo', nombre: nombreVisibleDeLinea(linea), grupo: linea.grupo }], tasas))
      .toBe('Falta el costo de Actividad en Providencia · Clase de buceo para principiantes: el cliente recibiría un precio sin ese servicio. El precio está en EUR: escribe la tasa de cambio para cargar el costo.')
  })

  it('la marca del PDF dice «falta la tasa de cambio»; si falta otra cosa, «falta un costo»', () => {
    const base = { pantallazos: false, sinRecomendada: false, margen: false, ivaSinCalcular: false, ivaIncluidoSinPlantilla: false }
    expect(textoDeMarca(motivosDeBorrador({ ...base, faltaCosto: true, faltaTasa: true })))
      .toBe('BORRADOR · borrador incompleto: falta la tasa de cambio · no enviar')
    expect(textoDeMarca(motivosDeBorrador({ ...base, faltaCosto: true }))).toBe('BORRADOR · borrador incompleto: falta un costo · no enviar')
    expect(motivosDeBorrador({ ...base, faltaTasa: true })).toEqual([])
  })
})
