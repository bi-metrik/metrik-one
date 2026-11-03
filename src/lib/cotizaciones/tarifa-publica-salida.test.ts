/**
 * Tarifa pública en la aprobación por margen mínimo: la regla única de la salida (`medirSalida`,
 * la que usan el PDF, «Enviar», «Aprobar» y el gate de la etapa). Datos ficticios.
 */
import { describe, expect, it } from 'vitest'

import { medirSalida } from './piso-salida'
import type { LineaDeCascada } from './por-pasos-vista'

const PUBLICA = { tipoTarifa: { tipo: 'publica', origen: 'persona', por: 'Asesora', en: '2026-10-22T15:00:00.000Z' } }

function linea(id: string, costo: number, extra: Partial<LineaDeCascada> = {}): LineaDeCascada {
  return {
    id, nombre: id, grupo: null, opcion_de: null, es_ajuste: false, orden: 0, dia_relativo: null, entra_al_precio: true,
    cantidad: 1, subtotal: costo, numeroDeRubros: 0, costoDeRubros: 0, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_venta: 0, precio_manual: false, base_iva: null, pasajeros: null, tarifa_pax: null, adicionales: [],
    ...extra,
  }
}

const lineas: LineaDeCascada[] = [
  linea('vuelo', 2_000_000, { grupo: 'vuelo: Bogotá - Cancún', orden: 1 }),
  linea('hotel-eco', 1_500_000, { grupo: 'hotel: Hotel en Cancún', orden: 2, margen_porcentaje: 0, tarifa_pax: PUBLICA }),
  linea('hotel-rec', 2_000_000, { grupo: 'hotel: Hotel en Cancún', orden: 3 }),
]
const fila = (id: string, nombre: string, orden: number, seleccion: string[]) => ({
  id, cotizacionId: 'cot', nombre, orden, vaEnPropuesta: true, esPrincipal: nombre === 'Recomendada', seleccion, motivoCodigo: null, motivoTexto: null,
})
const ctx = (items: LineaDeCascada[]) => ({
  items,
  params: { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const },
  umbrales: { pisoPct: 10, avisoPct: 12 },
  negocioId: 'neg', oportunidadId: null, pisoEnLaSalida: true, configLinea: null, estado: 'borrador', tarifaAceptadaId: null,
})

// D2/D3 de Mauricio (2026-10-29): el margen general cuenta TODAS las líneas, las Públicas con lo que
// la agencia paga (precio público − comisión); sin comisión no se mide y la salida frena.
const conComision = (pct: number) => ({ tipoTarifa: { ...PUBLICA.tipoTarifa, comisionPct: pct } })

describe('la salida con tarifa pública', () => {
  it('la Económica con su hotel Público sin comisión frena por la comisión, no por el margen', () => {
    const filas = [fila('t-eco', 'Económica', 1, ['hotel-eco']), fila('t-rec', 'Recomendada', 2, ['hotel-rec'])]
    const m = medirSalida(ctx(lineas) as never, filas as never)
    expect(m.bajoPiso.map(s => s.nombre)).toEqual(['Económica'])
    expect(m.bajoPiso[0].margenRealPct).toBeNull()
    expect(m.bajoPiso[0].publicasSinComision).toBe(1)
  })

  it('con la comisión escrita, la Económica se mide con ella: 20 % pasa el 10 %; a costo y Neta, no', () => {
    const filas = [fila('t-eco', 'Económica', 1, ['hotel-eco']), fila('t-rec', 'Recomendada', 2, ['hotel-rec'])]
    const conDiez = lineas.map(l => (l.id === 'hotel-eco' ? { ...l, tarifa_pax: conComision(20) } : l))
    const m = medirSalida(ctx(conDiez) as never, filas as never)
    expect(m.bajoPiso).toEqual([])
    // Cliente 2.352.941 + 1.500.000; agencia 2.000.000 + 1.200.000.
    expect(m.sujetos[0].margenRealPct!).toBeCloseTo(((3_852_941 - 3_200_000) / 3_852_941) * 100, 4)
    const netas = lineas.map(l => ({ ...l, tarifa_pax: null }))
    expect(medirSalida(ctx(netas) as never, filas as never).bajoPiso.map(s => s.nombre)).toEqual(['Económica'])
  })

  it('una tarifa que solo cobra lo Público ya no queda exenta: sin comisión frena, con comisión se mide', () => {
    const solo = [linea('traslado', 502_000, { margen_porcentaje: 0, tarifa_pax: PUBLICA })]
    expect(medirSalida(ctx(solo) as never, null).bajoPiso).toHaveLength(1)
    const con = [linea('traslado', 502_000, { margen_porcentaje: 0, tarifa_pax: conComision(12) })]
    expect(medirSalida(ctx(con) as never, null).bajoPiso).toEqual([])
  })

  it('la huella de una autorización cambia si una línea pasa a Pública, y sin Públicas no lleva la marca', () => {
    const filas = [fila('t-eco', 'Económica', 1, ['hotel-eco'])]
    const sin = medirSalida(ctx(lineas.map(l => ({ ...l, tarifa_pax: null }))) as never, filas as never).firma
    const con = medirSalida(ctx(lineas) as never, filas as never).firma
    expect(con).not.toBe(sin)
    expect(sin).not.toMatch(/publica/)
  })
})
