/**
 * El recaudo del honorario decide QUIÉN entra a la cola, y eso se resuelve en el
 * SERVIDOR.
 *
 * Hasta el 2026-09-08 un caso con el honorario sin recaudar se listaba con la
 * etiqueta "falta: recaudo del honorario". El operador veía 56 casos, unos con
 * botón y otros no, y no tenía forma de saber cuáles podía resolver ese día.
 * Ahora el recaudo es condición de entrada: quien debe plata de verdad sale de la
 * lista y se cuenta aparte.
 *
 * ⚠️ El filtro va aquí y no en la pantalla A PROPÓSITO. La bandeja cuenta y la
 * lista pinta: si cada una filtrara por su lado, la bandeja diría "3 listos"
 * mientras la lista muestra cuatro botones — es el desfase que el comentario de
 * `caso-listo.ts` documenta desde que ese módulo existe.
 *
 * ⚠️ Y solo entre los PENDIENTES: un caso ya facturado o descartado es un
 * REGISTRO, no un candidato. Sacarlo lo borraría de las vistas "Ya facturados" y
 * "Descartados" y dejaría `totales.ya_facturados` mintiendo. Hoy no cambia nada
 * (medido en producción el 2026-09-08: 0 de 266 facturados y 0 de 0 descartados
 * están retenidos), pero basta con que a un caso facturado le anulen un cobro.
 *
 * Cifras sembradas, copiadas de producción el 2026-09-08:
 *   · honorario $637.500 → banda $6.375
 *   · V0179, el único en la banda: faltan $3.000 (0,47%)
 *   · el retenido más cercano debe el 11,8% de su honorario
 *
 * ⚠️ Contra la versión anterior de `facturacion-actions.ts` caen las 6, pero varias
 * caen por una razón trivial (el campo `retenidos_por_recaudo` no existía). Para
 * saber qué prueba sostiene qué DECISIÓN se mutó el filtro con el campo ya puesto:
 *
 *   el filtro también saca facturados y descartados ... 2 pruebas
 *   se cuentan pero NO se sacan de la lista ........... 3
 *
 * O sea: la guarda de "solo entre los pendientes" y el hecho de sacarlos de verdad
 * tienen cada uno pruebas propias, no heredadas de que el tipo cambiara.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, reiniciarDoble, sembrar, servicioFalso } from '../../../test/cola-facturacion-doble'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS, staffId: 'staff-diana', role: 'owner', areas: ['financiera'], supabase: null,
  }),
}))

vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { getColaFacturacion } from './facturacion-actions'

const HONORARIO = 637_500
const BANDA = 6_375

beforeEach(reiniciarDoble)

describe('cola de facturación — el recaudo es condición de entrada', () => {
  it('el caso RETENIDO no llega a la pantalla, y se cuenta aparte', async () => {
    // Tres casos: uno cuadrado, uno en la banda, uno que debe la mitad.
    sembrar({
      casos: 3,
      recaudo: i => (i === 0 ? HONORARIO : i === 1 ? HONORARIO - 3_000 : HONORARIO / 2),
    })
    const { data } = await getColaFacturacion()

    expect(data!.casos.map(c => c.codigo).sort()).toEqual(['V0000', 'V0001'])
    expect(data!.totales.retenidos_por_recaudo).toEqual({
      n: 1,
      valor: HONORARIO,
      falta: HONORARIO / 2,
    })
  })

  it('el DESCUADRE MENOR sí se lista, marcado y con su banda', async () => {
    sembrar({ casos: 1, recaudo: () => HONORARIO - 3_000 })
    const { data } = await getColaFacturacion()

    const caso = data!.casos[0]
    expect(caso.estado_recaudo).toBe('descuadre_menor')
    expect(caso.falta_saldo).toBe(3_000)
    expect(caso.banda_materialidad).toBe(BANDA)
    // No cuenta como listo: es listable CON confirmación escrita.
    expect(data!.totales.listos).toBe(0)
    expect(data!.totales.incompletos).toBe(1)
  })

  it('los totales de la bandeja NO cuentan a los retenidos entre los incompletos', async () => {
    // Antes, un caso sin recaudar engordaba "les falta un dato" como si el trabajo
    // fuera de digitación. Debe plata: eso no se arregla en esta pantalla.
    sembrar({ casos: 10, recaudo: i => (i < 4 ? HONORARIO : 0) })
    const { data } = await getColaFacturacion()

    expect(data!.totales.listos).toBe(4)
    expect(data!.totales.incompletos).toBe(0)
    expect(data!.totales.retenidos_por_recaudo.n).toBe(6)
    expect(data!.totales.valor_listo).toBe(4 * HONORARIO)
    expect(data!.casos).toHaveLength(4)
  })

  it('⚠️ un caso YA FACTURADO con saldo pendiente NO se filtra: sigue siendo un registro', async () => {
    // Si el filtro no distinguiera candidato de registro, este caso desaparecería
    // de "Ya facturados" y el contador de facturados diría uno menos.
    sembrar({
      casos: 2,
      recaudo: () => 0,
      metadata: i => (i === 0 ? { siigo_factura: { numero: 'FV-2-459' } } : {}),
    })
    const { data } = await getColaFacturacion()

    expect(data!.casos.map(c => c.codigo)).toEqual(['V0000'])
    expect(data!.casos[0].estado_recaudo).toBe('retenido')
    expect(data!.totales.ya_facturados).toBe(1)
    // El otro sí sale de la cola, y solo ese entra al contador.
    expect(data!.totales.retenidos_por_recaudo.n).toBe(1)
  })

  it('⚠️ un caso DESCARTADO con saldo pendiente tampoco se filtra', async () => {
    sembrar({
      casos: 1,
      recaudo: () => 0,
      metadata: () => ({ facturacion_descartada: { at: '2026-09-01T00:00:00.000Z', por: 'Diana', motivo: 'ya facturado por fuera' } }),
    })
    const { data } = await getColaFacturacion()

    expect(data!.casos).toHaveLength(1)
    expect(data!.totales.descartados).toBe(1)
    expect(data!.totales.retenidos_por_recaudo.n).toBe(0)
  })

  it('sin retenidos, el contador va en cero y nada cambia', async () => {
    sembrar({ casos: 3 })
    const { data } = await getColaFacturacion()

    expect(data!.casos).toHaveLength(3)
    expect(data!.totales.listos).toBe(3)
    expect(data!.totales.retenidos_por_recaudo).toEqual({ n: 0, valor: 0, falta: 0 })
  })
})
