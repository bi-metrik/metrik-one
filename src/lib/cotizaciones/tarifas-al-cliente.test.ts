/**
 * N-17 del QA Trappvel del 2026-10-29 (ronda 3, grupo G13), viaje 04 Santa Marta / Tayrona: la
 * Premium (LATAM + Mendihuaca) marcada «Mandarla al cliente» no llegó, y salía más barata que la
 * Recomendada (Avianca + Ecohabs).
 *
 * Datos con la forma del caso (costos de la clave del viaje 04).
 */
import { describe, expect, it } from 'vitest'

import { aplicarPlan, eleccionOptimista, firmaDeTarifa, planDeTarifas, type TarifaDelPlan } from './tarifas-por-pasos'
import { avisosDeOrdenDeTarifas, tarifasSinMandar, textoDeMandar, type TarifaAlCliente } from './tarifas-al-cliente'
import { listaUnica } from './lista-unica'

const H = 'hotel: Hotel en Parque Tayrona'
const V = 'vuelo: Vuelo Bogotá–Santa Marta'
const linea = (id: string, grupo: string, orden: number) => ({ id, grupo, orden, es_ajuste: false, dia_relativo: null, entra_al_precio: true })
const COSTO: Record<string, number> = { av: 2_969_200, la: 2_500_000, eco: 7_884_800, zua: 4_580_000, men: 6_280_000 }
const ITEMS = [linea('av', V, 1), linea('la', V, 2), linea('eco', H, 3), linea('zua', H, 4), linea('men', H, 5)].map(i => ({ ...i, costo: COSTO[i.id] }))
const tarifa = (id: string, nombre: string, orden: number, va: boolean, ...sel: string[]): TarifaDelPlan => ({ id, nombre, orden, vaEnPropuesta: va, seleccion: sel })

/** Como quedó Tarifas: la Premium repetía la Recomendada y no se mandaba. */
const ANTES = [
  tarifa('e', 'Económica', 1, true, 'la', 'zua'),
  tarifa('r', 'Recomendada', 2, true, 'av', 'eco'),
  tarifa('p', 'Premium', 3, false, 'av', 'eco'),
]

describe('N-17 · lo marcado para mandar se manda', () => {
  it('al escoger otra opción en la Premium que repetía la Recomendada, la pantalla ya la pinta «se manda», como el servidor', () => {
    const cambios = eleccionOptimista({ items: ITEMS, tarifas: ANTES, tarifaId: 'p', candidatas: ['eco', 'zua', 'men'], itemId: 'men', esPaquete: false })
    expect(cambios.p).toEqual({ seleccion: ['av', 'men'], va: true })
    // El servidor deja lo mismo: la pantalla no puede decir otra cosa mientras llega.
    const despues = ANTES.map(t => (t.id === 'p' ? { ...t, seleccion: ['av', 'men'] } : t))
    const plan = planDeTarifas({ antes: { items: ITEMS, tarifas: ANTES }, despues: { items: ITEMS, tarifas: despues }, costoDe: id => COSTO[id] ?? null })
    expect(aplicarPlan(despues, plan, () => 'n').find(t => t.id === 'p')?.vaEnPropuesta).toBe(true)
  })

  it('el aviso del toque dice la dirección', () => {
    expect(textoDeMandar('Premium', true)).toBe('La Premium se manda al cliente.')
    expect(textoDeMandar('Premium', false)).toBe('La Premium ya no se manda al cliente.')
  })

  const alCliente = (va: boolean): TarifaAlCliente[] => [
    { nombre: 'Económica', precio: 11_152_464, vaEnPropuesta: true, firma: firmaDeTarifa(ITEMS, ['la', 'zua']) },
    { nombre: 'Recomendada', precio: 15_269_864, vaEnPropuesta: true, firma: firmaDeTarifa(ITEMS, ['av', 'eco']) },
    { nombre: 'Premium', precio: 12_531_396, vaEnPropuesta: va, firma: firmaDeTarifa(ITEMS, ['la', 'men']) },
  ]

  it('«Revisar y enviar» dice qué tarifa no se manda (y calla la que solo repite otra)', () => {
    expect(tarifasSinMandar(alCliente(false))).toEqual(['Premium'])
    expect(tarifasSinMandar(alCliente(true))).toEqual([])
    const repetida = [...alCliente(true).slice(0, 2), { nombre: 'Premium', precio: 15_269_864, vaEnPropuesta: false, firma: firmaDeTarifa(ITEMS, ['av', 'eco']) }]
    expect(tarifasSinMandar(repetida)).toEqual([])
  })

  it('la Premium más barata que la Recomendada se avisa, con las dos cifras', () => {
    expect(avisosDeOrdenDeTarifas(alCliente(true))).toEqual([{
      nombre: 'Premium',
      texto: 'La Premium sale más barata que la Recomendada ($12.531.396 frente a $15.269.864) y el documento la presenta como la versión Superior. Cambia su vuelo u hotel, o no la mandes.',
    }])
    // Si no se manda, no hay nada que avisar del orden.
    expect(avisosDeOrdenDeTarifas(alCliente(false))).toEqual([])
  })

  it('los dos renglones salen en la lista de Revisar, con su «Ir» a Tarifas', () => {
    const l = listaUnica({
      sinPrecio: [], capturas: null, tarifas: [], salida: null, pantallazosPorAceptar: 0, texto: 'ok', noVan: [],
      faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
      tarifasSinMandar: ['Premium'],
      ordenDeTarifas: avisosDeOrdenDeTarifas(alCliente(true)),
    })
    expect(l.revisar.map(r => [r.clave, r.ir])).toEqual([
      ['sin-mandar:Premium', { a: 'tarifas' }],
      ['orden:Premium', { a: 'tarifas' }],
    ])
    expect(l.revisar[0].texto).toBe('La Premium no se manda al cliente: en Tarifas está sin marcar «Mandarla al cliente».')
  })
})
