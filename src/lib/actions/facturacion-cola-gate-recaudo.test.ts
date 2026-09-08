/**
 * El recaudo del honorario decide DÓNDE va el caso en la cola, y eso se resuelve
 * en el SERVIDOR.
 *
 * Historia corta, porque la decisión se movió dos veces el mismo día:
 *
 *   1. Hasta el 2026-09-08, un caso sin el honorario recaudado se listaba entre
 *      los demás con la etiqueta "falta: recaudo del honorario". El operador veía
 *      56 casos, unos con botón y otros no, y no tenía forma de saber cuáles podía
 *      resolver ese día.
 *   2. Ese día se sacaron de la cola (#578). Con eso se llevaron por delante la
 *      ADOPCIÓN: un retenido ya no podía reconocer una factura que Siigo ya tiene.
 *   3. Enmienda del mismo día: vuelven a la pantalla, pero a una SECCIÓN PROPIA y
 *      marcados con `retenido_por_recaudo`. Se ven, se distinguen a golpe de
 *      vista, dicen con números por qué lo están, y no se pueden facturar.
 *
 * Lo que este archivo fija es el reparto, que es lo único que decide el servidor:
 *
 *   · el retenido VIAJA en `casos`, con `retenido_por_recaudo: true`
 *   · y NO entra en `listos` ni en `incompletos` — el badge de la pestaña es la
 *     suma de esos dos, y mostrarlos no puede inflar la bandeja. Es la línea que
 *     separa "hacerlos visibles" de "devolver el problema original".
 *
 * ⚠️ La marca es del SERVIDOR, no de la pantalla, aunque los dos ingredientes
 * viajen en el objeto. `estado_recaudo === 'retenido'` NO alcanza: un caso ya
 * facturado o descartado puede estar retenido y pertenece a su propia vista — es
 * un REGISTRO, no un candidato. Ese matiz escrito dos veces es como el contador y
 * la lista se desincronizan.
 *
 * Cifras sembradas, copiadas de producción el 2026-09-08:
 *   · honorario $637.500 → banda $6.375
 *   · el único caso en la banda: faltan $3.000 (0,47%)
 *   · los 27 retenidos reales van del 11,8% al 100% del honorario
 *
 * ⚠️ Mutaciones corridas el 2026-09-08 (`_qa/mutar.py`, borrado antes de
 * commitear) sobre el reparto que decide este archivo:
 *
 *   el retenido vuelve a salir de `casos` ......... 4 pruebas
 *   la marca ignora facturados y descartados ...... 2
 *   el retenido cuenta como incompleto ............ 1
 *   los retenidos no van al final ................. 1
 *
 * ⚠️⚠️ La última empezó HUÉRFANA y no era una prueba de más: era un fixture que
 * pasaba por la razón equivocada. Con todos los retenidos sembrados al final,
 * ordenar solo por "listo" da exactamente el mismo resultado que ordenar por
 * retenido, así que borrar el criterio no tumbaba nada. El fixture se rearmó para
 * que los dos órdenes discrepen (ver la prueba). Es el gotcha de siempre: una
 * prueba verde puede estarlo por la razón contraria.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RUT_COMPLETO, WS, reiniciarDoble, sembrar, servicioFalso } from '../../../test/cola-facturacion-doble'

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

describe('cola de facturación — el retenido se ve, marcado y aparte', () => {
  it('el caso RETENIDO llega a la pantalla, marcado, y se cuenta aparte', async () => {
    // Tres casos: uno cuadrado, uno en la banda, uno que debe la mitad.
    sembrar({
      casos: 3,
      recaudo: i => (i === 0 ? HONORARIO : i === 1 ? HONORARIO - 3_000 : HONORARIO / 2),
    })
    const { data } = await getColaFacturacion()

    // Los tres viajan: el retenido ya no desaparece.
    expect(data!.casos.map(c => c.codigo).sort()).toEqual(['V0000', 'V0001', 'V0002'])

    const retenido = data!.casos.find(c => c.codigo === 'V0002')!
    expect(retenido.estado_recaudo).toBe('retenido')
    expect(retenido.retenido_por_recaudo).toBe(true)
    expect(retenido.falta_saldo).toBe(HONORARIO / 2)
    // Y los otros dos NO están marcados: la sección aparte es solo para él.
    expect(data!.casos.filter(c => c.retenido_por_recaudo)).toHaveLength(1)

    expect(data!.totales.retenidos_por_recaudo).toEqual({
      n: 1,
      valor: HONORARIO,
      falta: HONORARIO / 2,
    })
  })

  it('⚠️ el retenido NO infla la bandeja: ni `listos` ni `incompletos` lo cuentan', async () => {
    // El badge de la pestaña es `listos + incompletos`. Si el retenido entrara
    // ahí, hacerlo visible habría devuelto el problema que el gate vino a
    // resolver: una bandeja llena de cosas que nadie puede resolver hoy.
    sembrar({ casos: 10, recaudo: i => (i < 4 ? HONORARIO : 0) })
    const { data } = await getColaFacturacion()

    expect(data!.totales.listos).toBe(4)
    expect(data!.totales.incompletos).toBe(0)
    expect(data!.totales.valor_listo).toBe(4 * HONORARIO)
    expect(data!.totales.retenidos_por_recaudo.n).toBe(6)
    // Todos siguen llegando a la pantalla: se reparten, no se esconden.
    expect(data!.casos).toHaveLength(10)
    expect(data!.casos.filter(c => c.retenido_por_recaudo)).toHaveLength(6)
  })

  it('el conteo de la bandeja y la lista NO se pueden desincronizar', async () => {
    // La invariante que justifica que la marca la ponga el servidor: la pantalla
    // agrupa por el booleano, así que si el contador saliera de otra cuenta, la
    // sección diría un número y su título otro.
    sembrar({
      casos: 8,
      recaudo: i => (i % 3 === 0 ? HONORARIO : i % 3 === 1 ? HONORARIO - 3_000 : 0),
      metadata: i => (i === 5 ? { siigo_factura: { numero: 'FV-2-500' } } : {}),
    })
    const { data } = await getColaFacturacion()

    expect(data!.casos.filter(c => c.retenido_por_recaudo).length)
      .toBe(data!.totales.retenidos_por_recaudo.n)
  })

  it('el DESCUADRE MENOR sí se lista entre los accionables, marcado y con su banda', async () => {
    sembrar({ casos: 1, recaudo: () => HONORARIO - 3_000 })
    const { data } = await getColaFacturacion()

    const caso = data!.casos[0]
    expect(caso.estado_recaudo).toBe('descuadre_menor')
    // No es retenido: se factura con justificación escrita, así que sigue siendo
    // trabajo de hoy y va en la lista de arriba.
    expect(caso.retenido_por_recaudo).toBe(false)
    expect(caso.falta_saldo).toBe(3_000)
    expect(caso.banda_materialidad).toBe(BANDA)
    // No cuenta como listo: es listable CON confirmación escrita.
    expect(data!.totales.listos).toBe(0)
    expect(data!.totales.incompletos).toBe(1)
  })

  it('⚠️ un caso YA FACTURADO con saldo pendiente NO va a la sección: es un registro', async () => {
    // Si la pantalla agrupara por `estado_recaudo` a secas, este caso saldría de
    // "Ya facturados" y aparecería entre los retenidos, donde no hay nada que
    // hacer con él. El contador de facturados diría uno menos.
    sembrar({
      casos: 2,
      recaudo: () => 0,
      metadata: i => (i === 0 ? { siigo_factura: { numero: 'FV-2-459' } } : {}),
    })
    const { data } = await getColaFacturacion()

    const facturado = data!.casos.find(c => c.codigo === 'V0000')!
    expect(facturado.ya_facturado).toBe(true)
    expect(facturado.estado_recaudo).toBe('retenido')
    expect(facturado.retenido_por_recaudo).toBe(false)
    expect(data!.totales.ya_facturados).toBe(1)
    // Solo el otro entra al contador.
    expect(data!.totales.retenidos_por_recaudo.n).toBe(1)
  })

  it('⚠️ un caso DESCARTADO con saldo pendiente tampoco va a la sección', async () => {
    sembrar({
      casos: 1,
      recaudo: () => 0,
      metadata: () => ({ facturacion_descartada: { at: '2026-09-01T00:00:00.000Z', por: 'Diana', motivo: 'ya facturado por fuera' } }),
    })
    const { data } = await getColaFacturacion()

    expect(data!.casos).toHaveLength(1)
    expect(data!.casos[0].retenido_por_recaudo).toBe(false)
    expect(data!.totales.descartados).toBe(1)
    expect(data!.totales.retenidos_por_recaudo.n).toBe(0)
  })

  it('los retenidos van al final de los pendientes, no mezclados', async () => {
    // Quien lee la cola de corrido tiene que encontrar primero lo que puede
    // resolver hoy. La pantalla además los separa en su propia sección.
    //
    // ⚠️ El fixture está armado para que el orden por RETENIDO y el orden por
    // LISTO no coincidan, o la prueba pasaría sola: con todos los retenidos
    // sembrados al final, ordenar solo por "listo" da el mismo resultado y la
    // mutación que borra el criterio no tumba nada (medido el 2026-09-08). Aquí
    // el caso 0 es retenido y el 1 es un cubierto SIN RUT — o sea, no listo y no
    // retenido: los dos criterios los ordenan al revés.
    sembrar({
      casos: 4,
      recaudo: i => (i === 0 || i === 3 ? 0 : HONORARIO),
      rut: i => (i === 1 ? {} : RUT_COMPLETO),
    })
    const { data } = await getColaFacturacion()

    expect(data!.casos.map(c => c.codigo)).toEqual(['V0002', 'V0001', 'V0000', 'V0003'])
    expect(data!.casos.map(c => c.retenido_por_recaudo)).toEqual([false, false, true, true])
  })

  it('sin retenidos, el contador va en cero y nada cambia', async () => {
    sembrar({ casos: 3 })
    const { data } = await getColaFacturacion()

    expect(data!.casos).toHaveLength(3)
    expect(data!.casos.every(c => !c.retenido_por_recaudo)).toBe(true)
    expect(data!.totales.listos).toBe(3)
    expect(data!.totales.retenidos_por_recaudo).toEqual({ n: 0, valor: 0, falta: 0 })
  })
})
