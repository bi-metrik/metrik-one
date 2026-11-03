import { describe, expect, it } from 'vitest'

import { distribucionPorComposicion, habitacionesPorAdultos, mismoVuelo, planDelPegado, type ContextoDeArmado, type LecturaParaArmar, type OpcionDeBloqueo, type PlanDeArmado } from './bloqueo-armado'
import { costoDelPaquete, type PaqueteBloqueo } from './bloqueo-paquete'
import { INCLUYE, ISLA_BONITA, KORAY, SOL_CARIBE, TRES_ADULTOS, VUELO_AV, VUELO_OTRO } from './__fixtures__/bloqueo/san-andres-1103'

const CTX: ContextoDeArmado = { operadorInicial: 'ATN', pasajeros: TRES_ADULTOS, edadesNinos: [] }
const hotelL = (h: typeof KORAY): LecturaParaArmar => ({ cual: 'hotel', hotel: h, incluye: INCLUYE })
const vueloL = (v: typeof VUELO_AV): LecturaParaArmar => ({ cual: 'vuelo', vuelo: v })

/** Aplica los planes sobre una cotización en memoria, como lo haría `pegarEnBloqueo`. */
function simular(lecturas: LecturaParaArmar[], ctx = CTX, inicio: OpcionDeBloqueo[] = []) {
  const opciones = [...inicio]
  const planes: PlanDeArmado[] = []
  for (const l of lecturas) {
    const p = planDelPegado(opciones, l, ctx)
    planes.push(p)
    if (p.accion === 'nuevo_paquete') {
      const numero = opciones.length ? Math.max(...opciones.map(o => o.numero)) + 1 : 1
      opciones.push({ itemId: `it-${opciones.length + 1}`, grupo: `paquete ${numero}`, numero, paquete: p.paquete, tarifa: p.tarifa })
    } else if (p.accion === 'nueva_opcion') {
      const numero = opciones.find(o => o.grupo === p.grupo)!.numero
      opciones.push({ itemId: `it-${opciones.length + 1}`, grupo: p.grupo, numero, paquete: p.paquete, tarifa: p.tarifa })
    } else if (p.accion === 'actualizar') {
      for (const c of p.cambios) opciones.find(o => o.itemId === c.itemId)!.paquete = c.paquete
    }
  }
  return { opciones, planes }
}

const total = (p: PaqueteBloqueo | null) => (p ? costoDelPaquete(p).total : null)

describe('SAN ANDRÉS: el vuelo y tres hoteles arman UN paquete con tres opciones', () => {
  it('vuelo + Koray + Isla Bonita + Sol Caribe → 1 paquete, 1 vuelo, 3 opciones en Triple con sus totales', () => {
    const { opciones, planes } = simular([vueloL(VUELO_AV), hotelL(KORAY), hotelL(ISLA_BONITA), hotelL(SOL_CARIBE)])
    expect(planes.map(p => p.accion)).toEqual(['nuevo_paquete', 'actualizar', 'nueva_opcion', 'nueva_opcion'])
    expect(new Set(opciones.map(o => o.grupo)).size).toBe(1)
    expect(opciones.map(o => o.paquete!.hotel.hotel)).toEqual(['Koray Hotel', 'Hotel Isla Bonita', 'Hotel Sol Caribe San Andres'])
    expect(opciones.map(o => o.paquete!.hotel.zona)).toEqual(['Zona LA ROCOSA - KORAY', 'Zona SAN LUIS', 'Zona URBANA-CENTRO'])
    // Las tres con el MISMO vuelo del paquete.
    for (const o of opciones) expect(mismoVuelo(o.paquete!.vuelo, VUELO_AV)).toBe(true)
    // 3 adultos → 1 Triple; costo = precio por persona × 3.
    for (const o of opciones) expect(o.paquete!.distribucion.habitaciones).toEqual({ triple: 1 })
    expect(opciones.map(o => total(o.paquete))).toEqual([7_323_615, 6_884_589, 9_332_151])
    expect(opciones.every(o => o.paquete!.operador === 'ATN')).toBe(true)
  })

  it('los hoteles antes del vuelo: el primero abre el paquete y el vuelo se pone a todas sus opciones', () => {
    const { opciones, planes } = simular([hotelL(KORAY), hotelL(ISLA_BONITA), vueloL(VUELO_AV), hotelL(SOL_CARIBE)])
    expect(planes.map(p => p.accion)).toEqual(['nuevo_paquete', 'nueva_opcion', 'actualizar', 'nueva_opcion'])
    expect(planes[2].accion === 'actualizar' && planes[2].cambios.length).toBe(2)
    for (const o of opciones) expect(mismoVuelo(o.paquete!.vuelo, VUELO_AV)).toBe(true)
    expect(opciones.map(o => total(o.paquete))).toEqual([7_323_615, 6_884_589, 9_332_151])
  })

  it('un segundo vuelo DISTINTO abre el paquete 2 y los hoteles siguientes van a ese', () => {
    const { opciones, planes } = simular([
      vueloL(VUELO_AV), hotelL(KORAY), hotelL(ISLA_BONITA),
      vueloL(VUELO_OTRO), hotelL(SOL_CARIBE), hotelL(KORAY),
    ])
    expect(planes.map(p => p.accion)).toEqual(['nuevo_paquete', 'actualizar', 'nueva_opcion', 'nuevo_paquete', 'actualizar', 'nueva_opcion'])
    const p1 = opciones.filter(o => o.numero === 1)
    const p2 = opciones.filter(o => o.numero === 2)
    expect(p1.map(o => o.paquete!.hotel.hotel)).toEqual(['Koray Hotel', 'Hotel Isla Bonita'])
    expect(p2.map(o => o.paquete!.hotel.hotel)).toEqual(['Hotel Sol Caribe San Andres', 'Koray Hotel'])
    for (const o of p1) expect(mismoVuelo(o.paquete!.vuelo, VUELO_AV)).toBe(true)
    for (const o of p2) expect(mismoVuelo(o.paquete!.vuelo, VUELO_OTRO)).toBe(true)
  })

  it('el mismo vuelo o el mismo hotel otra vez no duplica nada', () => {
    const { planes, opciones } = simular([vueloL(VUELO_AV), hotelL(KORAY), vueloL(VUELO_AV), hotelL(KORAY)])
    expect(planes.map(p => p.accion)).toEqual(['nuevo_paquete', 'actualizar', 'repetido', 'repetido'])
    expect(opciones).toHaveLength(1)
  })

  it('la opción nueva hereda «Pública» y su comisión del paquete; sin decidir, queda el default', () => {
    const publica = { tipo: 'publica' as const, comision: { tipo: 'pct' as const, valor: 15 } }
    const { planes } = simular([vueloL(VUELO_AV), hotelL(KORAY)])
    expect(planes[0].accion === 'nuevo_paquete' && planes[0].tarifa).toBeNull()
    const { opciones } = simular([vueloL(VUELO_AV), hotelL(KORAY)])
    opciones[0].tarifa = publica
    const { planes: siguientes } = simular([hotelL(ISLA_BONITA), vueloL(VUELO_OTRO)], CTX, opciones)
    expect(siguientes[0]).toMatchObject({ accion: 'nueva_opcion', tarifa: publica })
    expect(siguientes[1]).toMatchObject({ accion: 'nuevo_paquete', tarifa: publica })
  })
})

describe('acomodación automática según los viajeros de la Solicitud', () => {
  const todas = ['sencilla', 'doble', 'triple', 'cuadruple'] as const
  it('las menos habitaciones, las grandes primero', () => {
    expect(habitacionesPorAdultos(1, todas)).toEqual({ sencilla: 1 })
    expect(habitacionesPorAdultos(2, todas)).toEqual({ doble: 1 })
    expect(habitacionesPorAdultos(3, todas)).toEqual({ triple: 1 })
    expect(habitacionesPorAdultos(4, todas)).toEqual({ cuadruple: 1 })
    expect(habitacionesPorAdultos(5, todas)).toEqual({ cuadruple: 1, sencilla: 1 })
    expect(habitacionesPorAdultos(6, todas)).toEqual({ cuadruple: 1, doble: 1 })
  })
  it('solo con las acomodaciones que tienen precio', () => {
    expect(habitacionesPorAdultos(3, ['doble', 'sencilla'])).toEqual({ doble: 1, sencilla: 1 })
    expect(habitacionesPorAdultos(4, ['doble'])).toEqual({ doble: 2 })
    expect(habitacionesPorAdultos(3, ['doble'])).toEqual({})
    expect(habitacionesPorAdultos(3, [])).toEqual({})
  })
  it('con niños: CHD y la edad de la Solicitud; sin Solicitud, nada repartido', () => {
    const d = distribucionPorComposicion(KORAY, { pasajeros: { adultos: 2, ninos: 1, infantes: 0 }, edadesNinos: [8] })
    expect(d).toEqual({ habitaciones: { doble: 1 }, ninos: 1, infantes: 0, edadesNinos: [8] })
    expect(costoDelPaquete({ hotel: KORAY, distribucion: d }).total).toBe(2 * 2_489_985 + 2_246_083)
    expect(distribucionPorComposicion(KORAY, { pasajeros: null, edadesNinos: [] }).habitaciones).toEqual({})
  })
})
