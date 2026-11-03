/**
 * Prueba real en navegador del #1359 (2026-10-29, Trappvel, bloqueo con tres paquetes): lo que se prueba
 * sin pantalla. Las acciones reales (marca que sigue al paquete, noches por versión, PDF) van en la
 * batería (`bateria-cotizaciones-e2e.test.ts`); la pantalla, en `qa-1359-dom.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { listaUnica, type EntradaDeLista } from './lista-unica'
import { sigue, type EntradaDePasos } from './por-pasos-vista'
import { aplicarPlan, eleccionOptimista, planDeTarifasDeBloqueo, type EstadoDeTarifas, type TarifaDelPlan } from './tarifas-por-pasos'

// ── Punto 6 · «Sigue» no deja de avisar la comisión al agregar otro paquete ─────

describe('punto 6 · la comisión de una Pública no la tapa «Escoge qué opción va en cada tarifa»', () => {
  const base: EntradaDeLista = {
    sinPrecio: [], capturas: null, tarifas: [], salida: null,
    pantallazosPorAceptar: 0, texto: 'ok', noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
  }
  const lista = listaUnica({ ...base, publicasSinComision: [{ itemId: 'pq-2', nombre: 'Hotel Ficticio' }] })
  const pasos = (conOpciones: number, tarifasVistas: boolean): EntradaDePasos & { pasoActual: 1 } => ({
    servicios: 1, conOpciones, pantallazosPorAceptar: 0, leyendo: 0, sinCosto: [], bajoMinimo: [], tarifasVistas,
    vanAlCliente: ['Recomendada'], rojos: lista.impide.length, ambar: 0, texto: 'ok', enviada: false,
    primerImpide: lista.impide[0]?.texto ?? null, impide: lista.impide, pasoActual: 1,
  })

  it('con un solo paquete avisa la comisión', () => {
    expect(sigue(pasos(0, false)).texto).toContain('Falta la comisión')
  })

  it('al agregar otro paquete (ya hay opciones y Tarifas no se ha visto), sigue avisando la comisión', () => {
    const s = sigue(pasos(1, false))
    expect(s.texto).toContain('Falta la comisión')
    expect(s.texto).toContain('«Hotel Ficticio»')
  })

  it('sin comisión pendiente, lo de siempre: primero escoger en Tarifas', () => {
    const vacia = listaUnica(base)
    const e = { ...pasos(1, false), rojos: 0, primerImpide: null, impide: vacia.impide }
    expect(sigue(e).texto).toBe('Escoge qué opción va en cada tarifa. ONE ya propuso una.')
  })

  it('lo que falta en el Paso 1 (un costo) sigue yendo primero', () => {
    const e = { ...pasos(1, false), sinCosto: [{ servicio: 'Paquete', motivo: 'Falta el costo' }] }
    expect(sigue(e).texto).toBe('Falta el costo: Paquete.')
  })
})

// ── Defecto 3 · «Va en la propuesta» sigue al paquete ───────────────────────────

const P = ['p-ghl', 'p-sol', 'p-deca']
const ITEMS = P.map((id, i) => ({ id, grupo: 'paquete de bloqueo', orden: i + 1 }))
const tarifa = (id: string, nombre: string | null, orden: number, va: boolean, paquete: string): TarifaDelPlan => ({ id, nombre, orden, vaEnPropuesta: va, seleccion: [paquete] })
const estado = (tarifas: TarifaDelPlan[]): EstadoDeTarifas => ({ items: ITEMS, tarifas })
/** Paquete → «recomendada» | «va» | «no va», como lo lee la asesora. */
const marcas = (ts: TarifaDelPlan[]) => Object.fromEntries(P.map(p => {
  const t = ts.find(x => x.seleccion.includes(p))!
  return [p, t.nombre === 'Recomendada' ? 'recomendada' : t.vaEnPropuesta ? 'va' : 'no va']
}))
const escoger = (antes: TarifaDelPlan[], tarifaId: string, paquete: string) => {
  const despues = antes.map(t => (t.id === tarifaId ? { ...t, seleccion: [paquete] } : t))
  return aplicarPlan(despues, planDeTarifasDeBloqueo(estado(despues), P, estado(antes)), () => 'nueva')
}

describe('defecto 3 · la marca sigue al paquete cuando cambia de tarifa', () => {
  // Después de sacar GHL de la Recomendada: Sol es la Recomendada, GHL no va, Decameron va.
  const tras = [tarifa('t1', 'Recomendada', 1, true, 'p-sol'), tarifa('t2', null, 2, false, 'p-ghl'), tarifa('t3', null, 3, true, 'p-deca')]

  it('se reproduce (prueba real): escoger GHL como Recomendada deja a Sol, que iba, en la propuesta', () => {
    expect(marcas(escoger(tras, 't1', 'p-ghl'))).toEqual({ 'p-ghl': 'recomendada', 'p-sol': 'va', 'p-deca': 'va' })
  })

  it('escoger Decameron como Recomendada: GHL sigue fuera y Sol sigue yendo', () => {
    expect(marcas(escoger(tras, 't1', 'p-deca'))).toEqual({ 'p-ghl': 'no va', 'p-sol': 'va', 'p-deca': 'recomendada' })
  })

  it('entre dos opciones: la de mayor orden escoge el paquete de la otra y se lo queda; cada marca va con su paquete', () => {
    const r = escoger(tras, 't3', 'p-ghl')
    expect(r.find(t => t.id === 't3')!.seleccion).toEqual(['p-ghl'])
    expect(marcas(r)).toEqual({ 'p-ghl': 'no va', 'p-sol': 'recomendada', 'p-deca': 'va' })
  })

  it('sin `antes` (ningún paquete cambió de tarifa) las marcas no se tocan', () => {
    expect(planDeTarifasDeBloqueo(estado(tras), P).marcas).toEqual([])
  })

  it('un paquete nuevo que cae en una tarifa que repetía la Recomendada va en la propuesta', () => {
    // t2 perdió su paquete (lo borraron) y quedó repitiendo el de la Recomendada, fuera.
    const repite = [tarifa('t1', 'Recomendada', 1, true, 'p-sol'), tarifa('t2', null, 2, false, 'p-sol'), tarifa('t3', null, 3, true, 'p-deca')]
    const r = aplicarPlan(repite, planDeTarifasDeBloqueo(estado(repite), P), () => 'nueva')
    expect(r.find(t => t.id === 't2')!.seleccion).toEqual(['p-ghl'])
    expect(r.find(t => t.id === 't2')!.vaEnPropuesta).toBe(true)
  })
})

describe('punto 7 · lo que la pantalla pinta en el acto es lo que hará el servidor', () => {
  const inicial = [tarifa('t1', 'Recomendada', 1, true, 'p-ghl'), tarifa('t2', null, 2, true, 'p-sol'), tarifa('t3', null, 3, false, 'p-deca')]

  it('en un bloqueo cambian las dos tarifas: la que escoge y la que pierde el paquete (con su marca)', () => {
    const c = eleccionOptimista({ items: ITEMS, tarifas: inicial, tarifaId: 't1', candidatas: P, itemId: 'p-deca', esPaquete: true })
    expect(c).toEqual({ t1: { seleccion: ['p-deca'], va: true }, t3: { seleccion: ['p-ghl'], va: true } })
    // Igual que el plan del servidor.
    expect(marcas(escoger(inicial, 't1', 'p-deca'))).toEqual({ 'p-ghl': 'va', 'p-sol': 'va', 'p-deca': 'recomendada' })
  })

  it('fuera del bloqueo, solo la tarifa que escoge', () => {
    const c = eleccionOptimista({ items: ITEMS, tarifas: inicial, tarifaId: 't2', candidatas: P, itemId: 'p-ghl', esPaquete: false })
    expect(c).toEqual({ t2: { seleccion: ['p-ghl'], va: true } })
  })
})
