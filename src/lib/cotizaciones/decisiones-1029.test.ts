/**
 * Las decisiones de Mauricio del 2026-10-29 (Trappvel), una por una, sobre las piezas puras. La
 * batería (`bateria-cotizaciones-e2e.test.ts`) las ve juntas de punta a punta; aquí cada regla con
 * sus bordes. Datos ficticios.
 */
import { describe, expect, it } from 'vitest'

import { margenDeLaCotizacion, motivoMargenDeCotizacionInvalido } from './margen-de-cotizacion'
import { comisionEscrita, conComision, leerTipoTarifa, motivoComisionInvalida } from './tarifa-publica'
import { comisionEnPesos } from './reglas-margen'
import { esPublicaSinComision, motivoPublicasSinComision, publicasSinComisionQueSalen } from './comision-publica'
import { frenosDePaqueteYPasajero } from './frenos-de-paquete-y-pasajero'
import { motivosDeBorrador, textoDeMarca } from './motivos-borrador'
import { listaUnica, type EntradaDeLista } from './lista-unica'
import { aplicarPlan, planDeTarifas, violacionDeInvariante, type TarifaDelPlan } from './tarifas-por-pasos'
import { itemsDelItinerario } from './itinerarios'
import { incluyeDelPaquete, incluyeDeOne } from './incluye-por-one'
import { fechasDelHotelDelPaquete, hotelesDePaquetes } from './bloqueo-documento'
import { introDeterminista, regimenSoloDesayuno } from './propuesta/modelo-documento'
import { paqueteVacio, type PaqueteBloqueo } from './bloqueo-paquete'

const EN = '2026-10-29T15:00:00.000Z'
const publica = (extra: Record<string, unknown> = {}) => ({ tipoTarifa: { tipo: 'publica', origen: 'persona', por: 'Asesora', en: EN, ...extra } })

// ── D4 · el 0 de la cotización ───────────────────────────────────────────────

describe('D4 · un 0 en la cotización no anula el margen de la línea', () => {
  it('0 guardado con la línea en 15 → 15 (COT-2026-0009: dos Netas a costo)', () => {
    expect(margenDeLaCotizacion({ margen_porcentaje: 0, margen_default_pct: 15 })).toBe(15)
  })

  it('lo escrito mayor que 0 manda; sin nada, el de la línea', () => {
    expect(margenDeLaCotizacion({ margen_porcentaje: 20, margen_default_pct: 15 })).toBe(20)
    expect(margenDeLaCotizacion({ margen_porcentaje: 0.5, margen_default_pct: 15 })).toBe(0.5)
    expect(margenDeLaCotizacion({ margen_porcentaje: null, margen_default_pct: 15 })).toBe(15)
  })

  it('sin margen en la línea (todo lo que no es Trappvel), el 0 sigue valiendo 0, como siempre', () => {
    expect(margenDeLaCotizacion({ margen_porcentaje: 0, margen_default_pct: 0 })).toBe(0)
    expect(margenDeLaCotizacion({ margen_porcentaje: 0, margen_default_pct: null })).toBe(0)
    expect(margenDeLaCotizacion({ margen_porcentaje: null, margen_default_pct: null })).toBeNull()
    expect(margenDeLaCotizacion(null)).toBeNull()
  })

  it('el margen general no se escribe en 0 si la línea declara el suyo; una opción a costo sí se puede', () => {
    expect(motivoMargenDeCotizacionInvalido(0, 15)).toMatch(/ponle 0 % en esa opción/)
    expect(motivoMargenDeCotizacionInvalido(0, null)).toBeNull()
    expect(motivoMargenDeCotizacionInvalido(12, 15)).toBeNull()
    expect(motivoMargenDeCotizacionInvalido(100, 15)).not.toBeNull()
    expect(motivoMargenDeCotizacionInvalido(Number.NaN, 15)).not.toBeNull()
  })
})

// ── D3 · la comisión de la Pública ───────────────────────────────────────────

describe('D3 · la comisión de la agencia, en % o en pesos, y obligatoria', () => {
  it('en %: sobre el precio público; en pesos: tal cual (nunca más que el precio)', () => {
    expect(comisionEnPesos(publica({ comisionPct: 10 }), 2_000_000)).toBe(200_000)
    expect(comisionEnPesos(publica({ comisionMonto: 180_000 }), 2_000_000)).toBe(180_000)
    expect(comisionEnPesos(publica({ comisionMonto: 9_000_000 }), 2_000_000)).toBe(2_000_000)
    expect(comisionEnPesos(publica(), 2_000_000)).toBeNull()
    expect(comisionEnPesos({ tipoTarifa: { tipo: 'neta', origen: 'persona', por: null, en: EN, comisionPct: 10 } }, 2_000_000)).toBeNull()
  })

  it('la decisión guarda UNA de las dos llaves, y se lee igual que se escribe', () => {
    const base = leerTipoTarifa(publica().tipoTarifa)!
    const enPesos = conComision({ ...base, comisionPct: 10 }, { tipo: 'monto', valor: 150_000.4 })
    expect(enPesos).not.toHaveProperty('comisionPct')
    expect(enPesos.comisionMonto).toBe(150_000)
    expect(comisionEscrita(leerTipoTarifa(enPesos))).toEqual({ tipo: 'monto', valor: 150_000 })
    const enPct = conComision(enPesos, { tipo: 'pct', valor: 12.345 })
    expect(enPct).not.toHaveProperty('comisionMonto')
    expect(comisionEscrita(leerTipoTarifa(enPct))).toEqual({ tipo: 'pct', valor: 12.35 })
    expect(comisionEscrita(conComision(enPct, null))).toBeNull()
  })

  it('una comisión imposible no se guarda', () => {
    expect(motivoComisionInvalida({ tipo: 'pct', valor: 100 })).not.toBeNull()
    expect(motivoComisionInvalida({ tipo: 'monto', valor: -1 })).not.toBeNull()
    expect(motivoComisionInvalida({ tipo: 'monto', valor: Number.NaN })).not.toBeNull()
    expect(motivoComisionInvalida({ tipo: 'pct', valor: 0 })).toBeNull()
  })

  const lineas = [
    { id: 'h-pub', nombre: 'HOTEL ARENA FICTICIO', grupo: 'hotel: Hotel en San Andrés', tarifa_pax: publica() },
    { id: 'h-pub-10', nombre: 'Hotel Coral Ficticio', grupo: 'hotel 2: Hotel en Providencia', tarifa_pax: publica({ comisionPct: 10 }) },
    { id: 'h-neta', nombre: 'Hotel Palma Ficticio', grupo: 'hotel 3: Hotel en Cartagena', tarifa_pax: null },
  ]

  it('solo frena la Pública SIN comisión que va al cliente', () => {
    expect(esPublicaSinComision(lineas[0])).toBe(true)
    expect(esPublicaSinComision(lineas[1])).toBe(false)
    expect(esPublicaSinComision(lineas[2])).toBe(false)
    expect(publicasSinComisionQueSalen(lineas, new Set(['h-pub-10', 'h-neta']))).toEqual([])
    const faltan = publicasSinComisionQueSalen(lineas, new Set(['h-pub', 'h-neta']))
    expect(faltan).toEqual([{ itemId: 'h-pub', nombre: 'Hotel Arena Ficticio' }])
    expect(motivoPublicasSinComision(faltan)).toBe('Falta la comisión de la agencia en «Hotel Arena Ficticio»: es tarifa Pública. Escríbela en % o en pesos para poder enviar.')
  })

  it('«Enviar», el PDF y la lista de Revisar dicen la misma causa, y no «margen bajo el mínimo»', () => {
    const f = frenosDePaqueteYPasajero({ items: lineas as never[], tarifas: [], composicion: null, conPrecioPorPasajero: false })
    expect(f.comision).toMatch(/^Falta la comisión de la agencia/)
    const motivos = motivosDeBorrador({ comisionPublica: true, pantallazos: false, sinRecomendada: false, margen: false, ivaSinCalcular: false, ivaIncluidoSinPlantilla: false })
    expect(motivos).toEqual(['comision_publica'])
    expect(textoDeMarca(motivos)).toBe('BORRADOR · falta la comisión de una tarifa Pública · no enviar')
    const entrada: EntradaDeLista = {
      sinPrecio: [], capturas: null, tarifas: [], pantallazosPorAceptar: 0, texto: 'ok', noVan: [], faltaDia: null,
      margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
      publicasSinComision: [{ itemId: 'h-pub', nombre: 'Hotel Arena Ficticio' }],
      salida: { aplica: true, bajoPiso: true, mensaje: 'x', excepcion: null, faltaCosto: null } as never,
    }
    const l = listaUnica(entrada)
    expect(l.impide.map(r => r.clave)).toContain('comision-publica')
    expect(l.impide.map(r => r.clave)).not.toContain('margen')
    expect(l.impide.find(r => r.clave === 'comision-publica')!.ir).toEqual({ a: 'opcion', itemId: 'h-pub', campo: 'comision' })
  })
})

// ── D5 · una tarifa por paquete ──────────────────────────────────────────────

describe('D5 · cada paquete del bloqueo es su propia opción de la propuesta', () => {
  const GRUPO = 'paquete de bloqueo: Paquete de bloqueo en San Andrés'
  const paquetes = ['p1', 'p2', 'p3'].map((id, i) => ({ id, grupo: GRUPO, orden: i + 1, opcion_de: null, es_ajuste: false }))
  const aplicar = (tarifas: TarifaDelPlan[], items = paquetes) => {
    let n = 0
    return aplicarPlan(tarifas, planDeTarifas({ antes: null, despues: { items, tarifas }, costoDe: () => 1 }), () => `t-nueva-${++n}`)
  }

  it('sin tarifas: una por paquete, la del primero es la Recomendada y todas van', () => {
    const t = aplicar([])
    expect(t.map(x => [x.nombre, x.seleccion, x.vaEnPropuesta])).toEqual([
      ['Recomendada', ['p1'], true],
      [null, ['p2'], true],
      [null, ['p3'], true],
    ])
    expect(violacionDeInvariante({ items: paquetes, tarifas: t })).toBeNull()
  })

  it('lo que la asesora sacó de la propuesta queda fuera, y vuelve cuando lo pone (reversible)', () => {
    const t = aplicar([])
    const sinElDos = t.map(x => (x.seleccion.includes('p2') ? { ...x, vaEnPropuesta: false } : x))
    expect(aplicar(sinElDos).find(x => x.seleccion.includes('p2'))!.vaEnPropuesta).toBe(false)
    const deNuevo = sinElDos.map(x => (x.seleccion.includes('p2') ? { ...x, vaEnPropuesta: true } : x))
    expect(aplicar(deNuevo).filter(x => x.vaEnPropuesta).map(x => x.seleccion[0])).toEqual(['p1', 'p2', 'p3'])
  })

  it('un paquete nuevo trae su tarifa; uno borrado deja la suya fuera de la propuesta', () => {
    const t = aplicar([])
    const con4 = [...paquetes, { id: 'p4', grupo: GRUPO, orden: 4, opcion_de: null, es_ajuste: false }]
    expect(aplicar(t, con4).map(x => x.seleccion[0])).toEqual(['p1', 'p2', 'p3', 'p4'])
    const sinTres = paquetes.filter(p => p.id !== 'p3')
    const despues = aplicar(t, sinTres)
    const huerfana = despues.find(x => x.id === t[2].id)!
    expect(huerfana.vaEnPropuesta).toBe(false)
    expect(itemsDelItinerario(sinTres, huerfana.seleccion)).toEqual(['p1'])
  })

  it('la Recomendada siempre va (decisión E)', () => {
    const t = aplicar([]).map(x => (x.nombre === 'Recomendada' ? { ...x, vaEnPropuesta: false } : x))
    expect(aplicar(t).find(x => x.nombre === 'Recomendada')!.vaEnPropuesta).toBe(true)
  })

  it('sin paquetes con opciones, el plan de siempre (no hay tarifas de bloqueo)', () => {
    expect(aplicar([], [paquetes[0]])).toEqual([])
  })
})

// ── D6 · el PDF de Trappvel ──────────────────────────────────────────────────

function paqueteSinVuelo(regimen = '(FULL) Desayuno, Almuer.'): PaqueteBloqueo {
  const p = paqueteVacio('Operador Ficticio')
  p.hotel = { ...p.hotel, hotel: 'Hotel Arena Ficticio', zona: 'San Andrés', noches: 5, planAlimentacion: regimen, precios: [{ acomodacion: 'doble', precioPorPersona: 1_000_000 }] }
  p.incluye = { casillas: { tiquete_aereo: false, alimentacion: true, planes_tours: false, traslados: true, seguro_medico: true }, sinIdentificar: [], texto: null }
  p.distribucion = { habitaciones: { doble: 1 }, ninos: 0, infantes: 0, edadesNinos: [] }
  return p
}
const lineaDe = (p: PaqueteBloqueo) => ({ nombre: 'HOTEL ARENA FICTICIO', grupo: 'paquete de bloqueo: Paquete de bloqueo en San Andrés', tarifa_pax: { bloqueo: p } })

describe('D6 · el documento dice lo que el paquete incluye, sin afirmar de más, en todos sus días', () => {
  it('«Incluye» lleva el hotel con su régimen tal cual y cada casilla marcada; lo no marcado no', () => {
    const r = incluyeDelPaquete(paqueteSinVuelo(), { corto: false, detallado: false })
    expect(r).toEqual(['5 noches en Hotel Arena Ficticio (San Andrés), con (FULL) Desayuno, Almuer.', 'Alimentación', 'Traslados', 'Seguro médico'])
    expect(incluyeDeOne([lineaDe(paqueteSinVuelo())], 'normal')).toEqual(r)
  })

  it('con vuelo, los tiquetes van con su ruta y la casilla del tiquete no se repite', () => {
    const p = paqueteSinVuelo()
    p.vuelo = { tramos: [
      { aerolinea: 'Aviones Ficticios', numeroVuelo: 'AF 1', origen: 'BOG', destino: 'ADZ', fecha: '2026-12-10', horaSalida: null, horaLlegada: null, fechaLlegada: null, escalas: 0 },
      { aerolinea: 'Aviones Ficticios', numeroVuelo: 'AF 2', origen: 'ADZ', destino: 'BOG', fecha: '2026-12-15', horaSalida: null, horaLlegada: null, fechaLlegada: null, escalas: 0 },
    ] }
    p.incluye.casillas.tiquete_aereo = true
    const r = incluyeDelPaquete(p, { corto: false, detallado: false })
    expect(r).toContain('Tiquetes aéreos BOG – ADZ – BOG con Aviones Ficticios')
    expect(r).not.toContain('Tiquete aéreo')
  })

  it('«incluyen el desayuno» solo con un régimen de desayuno', () => {
    expect(regimenSoloDesayuno('Alojamiento y desayuno')).toBe(true)
    expect(regimenSoloDesayuno('(FULL) Desayuno, Almuer.')).toBe(false)
    expect(regimenSoloDesayuno('Desayuno y cena')).toBe(false)
    expect(regimenSoloDesayuno('Todo incluido')).toBe(false)
    expect(regimenSoloDesayuno('Solo alojamiento')).toBe(false)
    const conRegimen = (regimen: string) => introDeterminista({
      paradas: [{ ciudad: 'San Andrés', noches: 5, desde: null, hasta: null, siguiente: null }], trenes: 0, dias: [],
      hoteles: [{ ciudad: 'San Andrés', desde: null, hasta: null, noches: 5, opciones: [{ tarifas: [], hotel: 'X', estrellas: null, habitacion: null, regimen, incluye: null, cancelacion: null, cargoEnDestino: null, foto: null }] }],
    })
    expect(conRegimen('(FULL) Desayuno, Almuer.')).not.toMatch(/desayuno/i)
    expect(conRegimen('Alojamiento y desayuno')).toMatch(/Todos los hoteles incluyen el desayuno/)
  })

  it('sin vuelo ni salida manual, el hotel toma las fechas del viaje; con salida manual, las suyas', () => {
    const p = paqueteSinVuelo()
    expect(fechasDelHotelDelPaquete(p, { inicio: '2026-12-10', fin: '2026-12-15' })).toEqual({ entrada: '2026-12-10', salida: '2026-12-15' })
    expect(fechasDelHotelDelPaquete(p, null)).toEqual({ entrada: null, salida: null })
    const sinNoches = paqueteSinVuelo()
    sinNoches.hotel.noches = null
    expect(fechasDelHotelDelPaquete(sinNoches, { inicio: '2026-12-10', fin: '2026-12-14' })).toEqual({ entrada: '2026-12-10', salida: '2026-12-14' })
    const manual = paqueteSinVuelo()
    manual.salidaManual = '2026-12-11'
    expect(fechasDelHotelDelPaquete(manual, { inicio: '2026-12-10', fin: '2026-12-15' })).toEqual({ entrada: '2026-12-11', salida: '2026-12-16' })
    const [h] = hotelesDePaquetes([lineaDe(p)], { inicio: '2026-12-10', fin: '2026-12-15' })
    expect([h.checkIn, h.checkOut, h.incluye]).toEqual(['10 dic 2026', '15 dic 2026', 'Alimentación, Traslados, Seguro médico'])
  })
})
