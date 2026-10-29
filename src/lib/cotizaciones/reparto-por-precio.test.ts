/**
 * Segunda vuelta de la COT-2026-0008 (Trappvel), punto 1 · el hotel que sobra se reparte solo y el
 * orden sigue al precio (opción 2, decidida por Mauricio el 2026-10-29).
 *
 * Datos inventados con la forma del caso: tres hoteles, el caro se pegó primero (Recomendada), la
 * Económica es el barato y la Premium repetía el caro (idéntica, no se mandaba). El del medio
 * quedaba en ninguna tarifa.
 *
 * | # | Caso                                                         | Resultado                                         |
 * |---|--------------------------------------------------------------|---------------------------------------------------|
 * | 1 | Rec = la más cara, Premium la repite, sobra uno más barato   | Premium → «Intermedia» con el que sobra, se manda |
 * | 2 | Rec = la del medio (Econ barata, Premium cara)               | nada cambia                                       |
 * | 3 | Rec = la más barata, Econ la repite, sobra el del medio      | nada cambia; queda el aviso de #1333              |
 * | 4 | Rec = la más cara, Premium escogida a mano más barata        | se llama «Intermedia» (no hay Superior más barata) |
 * | 5 | Rec = la más cara, Premium la repite, no sobra ninguno       | nada cambia (Premium idéntica, no se manda)       |
 * | 6 | Rec = la más cara, sobran dos                                | Intermedia con el primero que se pegó; el otro, aviso |
 * | 7 | Intermedia y la Rec deja de ser la más cara                  | vuelve a «Premium» con la más cara                |
 * | 8 | Sin costo en algún hotel                                     | nada cambia                                       |
 * | 9 | Además un vuelo con opciones                                 | nada cambia; queda el aviso                       |
 * |10 | Lo que sobra es más barato que la Económica                  | nada cambia; queda el aviso                       |
 */
import { describe, expect, it } from 'vitest'

import { aplicarPlan, planDeTarifas, type TarifaDelPlan } from './tarifas-por-pasos'
import { opcionesFueraDeLaPropuesta } from './lista-unica'
import { tarifasCalculadas } from './por-pasos-vista'
import { tarifasQueFaltan } from './tarifas'
import { lineasDelCaso, paramsDelCaso, TARIFAS_DEL_CASO } from '../../../test/caso-reglas-margen'

const H = 'hotel: Hotel en Willemstad'
const V = 'vuelo: Vuelo Bogotá–Willemstad'
const linea = (id: string, grupo: string, orden: number) => ({ id, grupo, orden, es_ajuste: false, dia_relativo: null, entra_al_precio: true })
const COSTO: Record<string, number> = { 'v-vuelo': 3_500_000, 'v-otro': 3_900_000, 'h-caro': 5_832_000, 'h-medio': 5_382_000, 'h-medio2': 5_100_000, 'h-barato': 3_738_000 }
const tarifa = (id: string, nombre: string, orden: number, va: boolean, ...sel: string[]): TarifaDelPlan => ({ id, nombre, orden, vaEnPropuesta: va, seleccion: sel })

function correr(items: ReturnType<typeof linea>[], tarifas: TarifaDelPlan[], costo: Record<string, number | null> = COSTO) {
  const conCosto = items.map(i => ({ ...i, costo: costo[i.id] ?? null }))
  const estado = { items: conCosto, tarifas }
  const plan = planDeTarifas({ antes: null, despues: estado, costoDe: id => costo[id] ?? null })
  const final = aplicarPlan(tarifas, plan, () => 'nueva')
  const de = (id: string) => final.find(t => t.id === id)!
  return { plan, final, de }
}

const TRES = [linea('v-vuelo', V, 1), linea('h-caro', H, 2), linea('h-medio', H, 3), linea('h-barato', H, 4)]

describe('reparto del hotel que sobra, por precio', () => {
  it('1 · COT-0008: Económica = barato, Intermedia = el del medio, Recomendada = el caro', () => {
    const { final, de } = correr(TRES, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'),
      tarifa('t-eco', 'Económica', 1, true, 'h-barato'),
      tarifa('t-prem', 'Premium', 3, false, 'h-caro'),
    ])
    expect(de('t-prem')).toMatchObject({ nombre: 'Intermedia', vaEnPropuesta: true, seleccion: ['h-medio'] })
    expect(de('t-rec')).toMatchObject({ nombre: 'Recomendada', seleccion: ['h-caro'] })
    expect(de('t-eco')).toMatchObject({ nombre: 'Económica', seleccion: ['h-barato'] })
    expect(final.some(t => t.nombre === 'Premium')).toBe(false)
    expect(opcionesFueraDeLaPropuesta(TRES, final)).toEqual([])
  })

  it('2 · la Recomendada en el medio: el reparto normal, sin renombrar', () => {
    const { plan } = correr(TRES, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-medio'),
      tarifa('t-eco', 'Económica', 1, true, 'h-barato'),
      tarifa('t-prem', 'Premium', 3, true, 'h-caro'),
    ])
    expect(plan.nombres ?? []).toEqual([])
    expect(plan.seleccion).toEqual([])
  })

  it('3 · la Recomendada es la más barata: no se renombra nada y el aviso sigue', () => {
    const tarifas = [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-barato'),
      tarifa('t-eco', 'Económica', 1, false, 'h-barato'),
      tarifa('t-prem', 'Premium', 3, true, 'h-caro'),
    ]
    const { plan, final } = correr(TRES, tarifas)
    expect(plan.nombres ?? []).toEqual([])
    expect(opcionesFueraDeLaPropuesta(TRES, final).map(o => o.itemId)).toEqual(['h-medio'])
  })

  it('4 · una Premium más barata que la Recomendada no puede llamarse Superior: es la Intermedia', () => {
    const { de } = correr(TRES, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'),
      tarifa('t-eco', 'Económica', 1, true, 'h-barato'),
      tarifa('t-prem', 'Premium', 3, true, 'h-medio'),
    ])
    expect(de('t-prem')).toMatchObject({ nombre: 'Intermedia', vaEnPropuesta: true, seleccion: ['h-medio'] })
  })

  it('5 · sin hotel sobrante, la Premium idéntica se queda como está y no se manda', () => {
    const DOS = [linea('v-vuelo', V, 1), linea('h-caro', H, 2), linea('h-barato', H, 3)]
    const { plan, de } = correr(DOS, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'),
      tarifa('t-eco', 'Económica', 1, true, 'h-barato'),
      tarifa('t-prem', 'Premium', 3, false, 'h-caro'),
    ])
    expect(plan.nombres ?? []).toEqual([])
    expect(de('t-prem')).toMatchObject({ nombre: 'Premium', vaEnPropuesta: false })
  })

  it('6 · sobran dos: la Intermedia lleva el primero que se pegó y el otro queda en el aviso', () => {
    const CUATRO = [...TRES, linea('h-medio2', H, 5)]
    const { final, de } = correr(CUATRO, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'),
      tarifa('t-eco', 'Económica', 1, true, 'h-barato'),
      tarifa('t-prem', 'Premium', 3, false, 'h-caro'),
    ])
    expect(de('t-prem')).toMatchObject({ nombre: 'Intermedia', seleccion: ['h-medio'] })
    expect(opcionesFueraDeLaPropuesta(CUATRO, final).map(o => o.itemId)).toEqual(['h-medio2'])
  })

  it('7 · la Recomendada deja de ser la más cara: la Intermedia vuelve a ser Premium, con la más cara', () => {
    const { de } = correr(TRES, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-medio'),
      tarifa('t-eco', 'Económica', 1, true, 'h-barato'),
      tarifa('t-prem', 'Intermedia', 3, true, 'h-medio'),
    ])
    expect(de('t-prem')).toMatchObject({ nombre: 'Premium', vaEnPropuesta: true, seleccion: ['h-caro'] })
  })

  it('8 · sin el costo de un hotel no se decide nada', () => {
    const { plan } = correr(TRES, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'),
      tarifa('t-eco', 'Económica', 1, true, 'h-barato'),
      tarifa('t-prem', 'Premium', 3, false, 'h-caro'),
    ], { ...COSTO, 'h-medio': null })
    expect(plan.nombres ?? []).toEqual([])
  })

  it('9 · con un vuelo con opciones además del hotel, no se reparte solo', () => {
    const CON_VUELOS = [...TRES, linea('v-otro', V, 6)]
    const { plan } = correr(CON_VUELOS, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-caro', 'v-vuelo'),
      tarifa('t-eco', 'Económica', 1, true, 'h-barato', 'v-vuelo'),
      tarifa('t-prem', 'Premium', 3, false, 'h-caro', 'v-otro'),
    ])
    expect(plan.nombres ?? []).toEqual([])
  })

  it('10 · lo que sobra es más barato que la Económica: no se reparte solo', () => {
    const { plan } = correr(TRES, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'),
      tarifa('t-eco', 'Económica', 1, true, 'h-medio'),
      tarifa('t-prem', 'Premium', 3, false, 'h-caro'),
    ])
    expect(plan.nombres ?? []).toEqual([])
  })

  it('la Intermedia ya repartida no se vuelve a tocar (el plan queda vacío)', () => {
    const { plan } = correr(TRES, [
      tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'),
      tarifa('t-eco', 'Económica', 1, true, 'h-barato'),
      tarifa('t-prem', 'Intermedia', 3, true, 'h-medio'),
    ])
    expect(plan).toEqual({ crear: [], seleccion: [], marcas: [] })
  })
})

describe('la pantalla y el resto de ONE con la Intermedia', () => {
  it('Tarifas la muestra entre la Económica y la Recomendada', () => {
    const tarifas = TARIFAS_DEL_CASO.map(t => (t.nombre === 'Premium' ? { ...t, nombre: 'Intermedia' } : t))
    expect(tarifasCalculadas(lineasDelCaso(3), paramsDelCaso(), tarifas).map(t => t.nombre)).toEqual(['Económica', 'Intermedia', 'Recomendada'])
    expect(tarifasCalculadas(lineasDelCaso(3), paramsDelCaso(), TARIFAS_DEL_CASO).map(t => t.nombre)).toEqual(['Económica', 'Recomendada', 'Premium'])
  })

  it('con la Intermedia no falta la Premium (no se vuelve a crear)', () => {
    expect(tarifasQueFaltan(['Económica', 'Recomendada', 'Intermedia'])).toEqual([])
  })
})
