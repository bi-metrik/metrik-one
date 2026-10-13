/**
 * C2 · toda opción en Tarifas: el plan puro (`planDeTarifas`).
 *
 * Criterios de Vera: P1 (la Recomendada nunca queda incompleta ni fuera, con prueba de
 * propiedad), N8 (al escribir se guarda lo que hoy cuenta), P8 (tarifa idéntica no se manda),
 * P9 (solo opciones de traslado o actividad: una sola tarifa), y la propuesta de ONE
 * (decisión A).
 */
import { describe, expect, it } from 'vitest'

import {
  aplicarPlan,
  firmaDeTarifa,
  planDeTarifas,
  propuestaDeOne,
  violacionDeInvariante,
  type EstadoDeTarifas,
  type TarifaDelPlan,
} from './tarifas-por-pasos'
import { itemsDelItinerario, ranurasConAlternativas } from './itinerarios'
import { LINEAS_CASO_FIJO, TARIFAS_CASO_FIJO } from '../../../test/caso-san-andres'

type Item = EstadoDeTarifas['items'][number]

/** Las 11 líneas del caso fijo, con el costo que usa la propuesta. */
function itemsDelCaso(): Item[] {
  return LINEAS_CASO_FIJO.map(l => ({
    id: l.item.id as string,
    grupo: l.item.grupo as string,
    orden: l.item.orden as number,
    es_ajuste: false,
    dia_relativo: (l.item.dia_relativo ?? null) as number | null,
    entra_al_precio: true,
    costo: l.item.subtotal as number,
  }))
}
const costoDe = (items: Item[]) => (id: string) => items.find(i => i.id === id)?.costo ?? null

let secuencia = 0
const nuevoId = () => `tf-nueva-${++secuencia}`

function correr(antes: EstadoDeTarifas | null, despues: EstadoDeTarifas): TarifaDelPlan[] {
  const plan = planDeTarifas({ antes, despues, costoDe: costoDe(despues.items), costoAntesDe: antes ? costoDe(antes.items) : undefined })
  return aplicarPlan(despues.tarifas, plan, nuevoId)
}

const porNombre = (t: TarifaDelPlan[], n: string) => t.find(x => x.nombre === n)!
const elegida = (items: Item[], t: TarifaDelPlan, grupo: string) =>
  ranurasConAlternativas(items).find(r => r.grupo === grupo)!.candidatos.find(id => t.seleccion.includes(id)) ?? null

describe('C2 · la propuesta de ONE (decisión A)', () => {
  it('Económica la más barata, Recomendada la primera pegada, Premium la más cara', () => {
    const cands = ['h-posada', 'h-agua-dulce']
    const costo = (id: string) => (id === 'h-posada' ? 1_229_098 : 4_352_838)
    expect(propuestaDeOne('Económica', cands, costo)).toBe('h-posada')
    expect(propuestaDeOne('Recomendada', cands, costo)).toBe('h-posada')
    expect(propuestaDeOne('Premium', cands, costo)).toBe('h-agua-dulce')
    // Con la cara pegada primero, la Recomendada sigue siendo la primera pegada.
    expect(propuestaDeOne('Recomendada', ['h-agua-dulce', 'h-posada'], costo)).toBe('h-agua-dulce')
  })

  it('una opción sin costo no compite: si ninguna tiene, todas proponen la primera', () => {
    expect(propuestaDeOne('Premium', ['a', 'b'], () => null)).toBe('a')
    expect(propuestaDeOne('Económica', ['a', 'b'], id => (id === 'a' ? 0 : 100))).toBe('b')
  })

  it('el caso fijo armado desde cero: tres tarifas, la Económica igual a la Recomendada no se manda', () => {
    const items = itemsDelCaso()
    const tarifas = correr(null, { items, tarifas: [] })
    expect(tarifas.map(t => [t.nombre, t.vaEnPropuesta])).toEqual([
      ['Económica', false], ['Recomendada', true], ['Premium', true],
    ])
    const rec = porNombre(tarifas, 'Recomendada')
    const prem = porNombre(tarifas, 'Premium')
    // Es exactamente lo que el fixture de C0 fija como las tarifas que propone ONE.
    for (const t of TARIFAS_CASO_FIJO) {
      const nuestra = porNombre(tarifas, t.fila.nombre as string)
      expect(firmaDeTarifa(items, nuestra.seleccion)).toBe(firmaDeTarifa(items, t.seleccion))
    }
    expect(elegida(items, rec, 'actividad: Cayo Cangrejo')).toBe('a-cayo-compartida')
    expect(elegida(items, prem, 'actividad: Cayo Cangrejo')).toBe('a-cayo-privada')
    expect(violacionDeInvariante({ items, tarifas })).toBeNull()
  })
})

describe('C2 · al escribir se guarda lo que hoy cuenta (N8)', () => {
  it('una tarifa vieja que no nombra la actividad guarda la PRIMERA por orden, no la propuesta de ONE', () => {
    const items = itemsDelCaso()
    // Las tarifas de una cotización vieja: nombran vuelo y hotel, nunca Cayo Cangrejo.
    const viejas: TarifaDelPlan[] = TARIFAS_CASO_FIJO.map(t => ({
      id: t.fila.id as string, nombre: t.fila.nombre as string, orden: t.fila.orden as number,
      vaEnPropuesta: t.fila.va_en_propuesta as boolean,
      seleccion: t.seleccion.filter(id => !id.startsWith('a-cayo')),
    }))
    const despues = correr(null, { items, tarifas: viejas })
    const prem = porNombre(despues, 'Premium')
    // Hoy la Premium cobra la lancha compartida (la primera por orden). La propuesta de ONE
    // diría la privada: el precio cambiaría solo por abrirla. Se guarda la compartida.
    expect(elegida(items, prem, 'actividad: Cayo Cangrejo')).toBe('a-cayo-compartida')
    for (const t of viejas) {
      const antes = itemsDelItinerario(items, t.seleccion)
      expect(itemsDelItinerario(items, porNombre(despues, t.nombre!).seleccion)).toEqual(antes)
    }
  })

  it('materializar no mueve la marca de nadie más que la Recomendada', () => {
    const items = itemsDelCaso()
    const viejas: TarifaDelPlan[] = TARIFAS_CASO_FIJO.map(t => ({
      id: t.fila.id as string, nombre: t.fila.nombre as string, orden: t.fila.orden as number,
      vaEnPropuesta: false, seleccion: t.seleccion,
    }))
    const despues = correr(null, { items, tarifas: viejas })
    expect(porNombre(despues, 'Recomendada').vaEnPropuesta).toBe(true)
    expect(porNombre(despues, 'Premium').vaEnPropuesta).toBe(false)
  })

  it('una Recomendada incompleta (como COT-0012) se completa y entra a la propuesta', () => {
    const items = itemsDelCaso()
    const tarifas: TarifaDelPlan[] = [
      { id: 'tf-rec', nombre: 'Recomendada', orden: 1, vaEnPropuesta: false, seleccion: ['h-posada'] },
    ]
    const despues = correr(null, { items, tarifas })
    const rec = porNombre(despues, 'Recomendada')
    expect(rec.vaEnPropuesta).toBe(true)
    expect(elegida(items, rec, 'hotel: Hotel en Providencia')).toBe('h-posada')
    expect(elegida(items, rec, 'hotel 2: Hotel en San Andrés')).toBe('h-verde-mar')
    expect(violacionDeInvariante({ items, tarifas: despues })).toBeNull()
  })
})

describe('C2 · tarifa idéntica (P8) y solo traslados o actividades (P9)', () => {
  it('la Económica que deja de ser igual a la Recomendada vuelve a mandarse', () => {
    const items = itemsDelCaso()
    const base = correr(null, { items, tarifas: [] })
    const eco = porNombre(base, 'Económica')
    expect(eco.vaEnPropuesta).toBe(false)
    // La asesora le cambia el hotel de San Andrés a la Económica.
    const tocada = base.map(t => t.id === eco.id
      ? { ...t, seleccion: [...t.seleccion.filter(id => id !== 'h-verde-mar'), 'h-lord-pierre'] }
      : t)
    const despues = correr({ items, tarifas: base }, { items, tarifas: tocada })
    expect(porNombre(despues, 'Económica').vaEnPropuesta).toBe(true)
  })

  it('si la asesora la apagó a mano y no era idéntica, se respeta', () => {
    const items = itemsDelCaso()
    const base = correr(null, { items, tarifas: [] }).map(t => (t.nombre === 'Premium' ? { ...t, vaEnPropuesta: false } : t))
    const despues = correr(null, { items, tarifas: base })
    expect(porNombre(despues, 'Premium').vaEnPropuesta).toBe(false)
  })

  it('una Premium igual a una Económica que va no se manda', () => {
    const items = itemsDelCaso()
    const base = correr(null, { items, tarifas: [] })
    const prem = porNombre(base, 'Premium')
    // Económica escoge lo mismo que la Premium: la Económica va (distinta de la Recomendada)
    // y la Premium queda igual a ella.
    const tocada = base.map(t => (t.nombre === 'Económica' ? { ...t, seleccion: [...prem.seleccion] } : t))
    const despues = correr({ items, tarifas: base }, { items, tarifas: tocada })
    expect(porNombre(despues, 'Económica').vaEnPropuesta).toBe(true)
    expect(porNombre(despues, 'Premium').vaEnPropuesta).toBe(false)
  })

  it('V7: con las únicas opciones en Cayo Cangrejo, solo la Recomendada', () => {
    const items = itemsDelCaso().filter(i => i.id !== 'h-agua-dulce' && i.id !== 'h-lord-pierre')
    const tarifas = correr(null, { items, tarifas: [] })
    expect(tarifas.map(t => t.nombre)).toEqual(['Recomendada'])
    expect(tarifas[0].vaEnPropuesta).toBe(true)
    expect(elegida(items, tarifas[0], 'actividad: Cayo Cangrejo')).toBe('a-cayo-compartida')
  })

  it('sin ningún servicio con opciones no se crea ninguna tarifa', () => {
    const items = itemsDelCaso().filter(i => !['h-agua-dulce', 'h-lord-pierre', 'a-cayo-privada'].includes(i.id))
    expect(correr(null, { items, tarifas: [] })).toEqual([])
  })
})

describe('C2 · la propuesta es viva mientras nadie la cambie', () => {
  it('una opción nueva más cara pasa a la Premium que seguía con la propuesta', () => {
    const items = itemsDelCaso()
    const base = correr(null, { items, tarifas: [] })
    const conNueva: Item[] = [...items, { id: 'h-deep-blue', grupo: 'hotel: Hotel en Providencia', orden: 12, es_ajuste: false, dia_relativo: null, entra_al_precio: true, costo: 7_800_000 }]
    const despues = correr({ items, tarifas: base }, { items: conNueva, tarifas: base })
    expect(elegida(conNueva, porNombre(despues, 'Premium'), 'hotel: Hotel en Providencia')).toBe('h-deep-blue')
    // La Recomendada sigue con la primera pegada.
    expect(elegida(conNueva, porNombre(despues, 'Recomendada'), 'hotel: Hotel en Providencia')).toBe('h-posada')
  })

  it('si la asesora ya había escogido otra en la Premium, la opción nueva no se la cambia', () => {
    const items = itemsDelCaso()
    const base = correr(null, { items, tarifas: [] }).map(t => t.nombre === 'Premium'
      ? { ...t, seleccion: [...t.seleccion.filter(id => id !== 'h-agua-dulce'), 'h-posada'] }
      : t)
    const conNueva: Item[] = [...items, { id: 'h-deep-blue', grupo: 'hotel: Hotel en Providencia', orden: 12, es_ajuste: false, dia_relativo: null, entra_al_precio: true, costo: 7_800_000 }]
    const despues = correr({ items, tarifas: base }, { items: conNueva, tarifas: base })
    expect(elegida(conNueva, porNombre(despues, 'Premium'), 'hotel: Hotel en Providencia')).toBe('h-posada')
  })

  it('borrar la opción escogida en la Premium la lleva a la propuesta de ONE', () => {
    const items = itemsDelCaso()
    const base = correr(null, { items, tarifas: [] })
    const sinLordPierre = items.filter(i => i.id !== 'h-lord-pierre')
    // El borrado arrastra la selección (on delete cascade).
    const tras = base.map(t => ({ ...t, seleccion: t.seleccion.filter(id => id !== 'h-lord-pierre') }))
    const despues = correr({ items, tarifas: base }, { items: sinLordPierre, tarifas: tras })
    expect(violacionDeInvariante({ items: sinLordPierre, tarifas: despues })).toBeNull()
  })
})

// ── P1 · prueba de propiedad ──────────────────────────────────────────────────

/** Un generador con semilla: la secuencia que falla se puede repetir. */
function azar(semilla: number) {
  let s = semilla >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('P1 · ninguna secuencia de acciones deja una tarifa incompleta ni a la Recomendada fuera', () => {
  for (const semilla of [1, 7, 42, 1234, 99999]) {
    it(`semilla ${semilla}: 60 acciones al azar sobre el caso fijo`, () => {
      const r = azar(semilla)
      const elige = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
      let items = itemsDelCaso()
      let tarifas = correr(null, { items, tarifas: [] })
      let n = 100
      const acciones = ['agregar', 'borrar', 'mover', 'separar', 'juntar', 'elegir', 'mandar', 'estado'] as const
      for (let paso = 0; paso < 60; paso++) {
        const antes: EstadoDeTarifas = { items, tarifas }
        const accion = elige(acciones)
        let nuevos = items.map(i => ({ ...i }))
        let nuevasTarifas = tarifas.map(t => ({ ...t, seleccion: [...t.seleccion] }))
        const grupos = [...new Set(items.map(i => i.grupo as string))]
        if (accion === 'agregar') {
          const g = elige(grupos)
          nuevos.push({ id: `x-${++n}`, grupo: g, orden: n, es_ajuste: false, dia_relativo: null, entra_al_precio: true, costo: Math.round(r() * 5_000_000) + 1 })
        } else if (accion === 'borrar' && nuevos.length > 3) {
          const id = elige(nuevos).id
          nuevos = nuevos.filter(i => i.id !== id)
          nuevasTarifas = nuevasTarifas.map(t => ({ ...t, seleccion: t.seleccion.filter(x => x !== id) }))
        } else if (accion === 'mover' || accion === 'juntar') {
          const origen = elige(nuevos)
          const tipo = String(origen.grupo).split(/[\s:]/)[0]
          const destinos = grupos.filter(g => g.startsWith(tipo) && g !== origen.grupo)
          if (destinos.length > 0) {
            const destino = elige(destinos)
            const mueve = accion === 'juntar' ? nuevos.filter(i => i.grupo === origen.grupo) : [origen]
            for (const m of mueve) m.grupo = destino
          }
        } else if (accion === 'separar') {
          const i = elige(nuevos)
          i.grupo = `${String(i.grupo).split(/[\s:]/)[0]} ${++n}: aparte`
        } else if (accion === 'elegir' && nuevasTarifas.length > 0) {
          const ranuras = ranurasConAlternativas(nuevos)
          if (ranuras.length > 0) {
            const ra = elige(ranuras)
            const t = elige(nuevasTarifas)
            t.seleccion = [...t.seleccion.filter(id => !ra.candidatos.includes(id)), elige(ra.candidatos)]
          }
        } else if (accion === 'mandar' && nuevasTarifas.length > 0) {
          const t = elige(nuevasTarifas)
          t.vaEnPropuesta = r() < 0.5
        } else if (accion === 'estado') {
          // Opcional o No va: sale de las candidatas (fuera del precio).
          const i = elige(nuevos)
          i.entra_al_precio = i.entra_al_precio === false ? true : false
          i.dia_relativo = null
        }
        // «Mandar» no cambia opciones: el plan corre sin `antes`, como en la acción real.
        tarifas = correr(accion === 'mandar' ? null : antes, { items: nuevos, tarifas: nuevasTarifas })
        items = nuevos
        const v = violacionDeInvariante({ items, tarifas })
        expect(v, `paso ${paso} (${accion})`).toBeNull()
      }
    })
  }
})
