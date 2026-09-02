/**
 * La cola de facturación tiene que ver TODOS sus casos, no los primeros mil.
 *
 * PostgREST corta cualquier respuesta en 1.000 filas devolviendo 200 y sin error.
 * En esta cola cada caso necesita CUATRO filas de `negocio_bloques`, así que el
 * techo se alcanza alrededor de los 250 casos: medido en producción el 2026-09-02,
 * la consulta pedía 1.115 filas y se perdían 115.
 *
 * Lo que se pierde no se nota, y ahí está el daño:
 *   · si cae la fila del RUT, el caso aparece "sin identificación, nombre, ciudad,
 *     dirección ni email" teniéndolo todo guardado — 48 casos así, $28,9M;
 *   · si cae la fila del servicio, el concepto de la factura baja al default y el
 *     cliente lee en su factura un servicio que no contrató;
 *   · **si cae la fila de la factura, un caso YA FACTURADO vuelve a la bandeja
 *     listo para emitir.** Una factura electrónica aceptada por la DIAN no se
 *     deshace. Medido el mismo día: V0089 y V0428 estaban en esa situación, y
 *     V0428 aparecía como listo.
 *
 * EL DOBLE ES CONSCIENTE DEL TECHO. No alcanza con un doble que devuelva todo:
 * este recorta en 1.000 filas igual que el servidor real y honra `.range()`. Sin
 * esa parte, la prueba pasaría con el código viejo y no probaría nada.
 *
 * LAS OCHO SE VIERON FALLAR contra el código de `main` (sin paginar), 2026-09-02:
 *   - el caso del final llega completo        → identificacion: null
 *   - el concepto sale del servicio           → servicio: null (cae al default)
 *   - un ya facturado no vuelve como listo    → ya_facturado: false
 *   - las copias del bloque también se leen   → ya_facturado: false
 *   - los candidatos se leen completos        → 1.000 casos de 1.050
 *   - los totales cuentan la cola entera      → 299 listos donde hay 298
 *   - una lectura que falla devuelve error    → devolvía la cola como si nada (×2)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// El doble y el sembrador viven en `test/`: los comparte con
// `facturacion-cola-contacto.test.ts`, que mide otra cosa sobre la misma cola.
import { WS, estado, reiniciarDoble, sembrar, servicioFalso } from '../../../test/cola-facturacion-doble'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS,
    staffId: 'staff-diana',
    role: 'owner',
    areas: ['financiera'],
    supabase: null,
  }),
}))

// Sin red: el catálogo de Siigo solo pone NOMBRES bonitos al concepto y no
// interviene en ninguna de las cuentas que esta prueba mide.
vi.mock('@/lib/siigo/client', () => ({
  siigoRequest: async () => ({ results: [] }),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { getColaFacturacion } from './facturacion-actions'

beforeEach(reiniciarDoble)

// ─── Pruebas ───────────────────────────────────────────────────────────────

describe('cola de facturación — lotes por encima del techo de PostgREST', () => {
  it('el caso del final de la cola llega COMPLETO, no vacío', async () => {
    // 300 casos × 4 slugs = 1.200 filas. Con el RUT al final del plan, las 200
    // últimas que caen fuera del techo son justo las que dan identidad al caso:
    // es el síntoma medido en V0408 el 2026-09-02.
    sembrar({ casos: 300, ordenBloques: 'rut-al-final' })
    const { data, error } = await getColaFacturacion()
    expect(error).toBeUndefined()

    const ultimo = data!.casos.find(c => c.codigo === 'V0299')!
    expect(ultimo.identificacion).toBe('9771470')
    expect(ultimo.cliente).toBe('VICTOR RESTREPO')
    expect(ultimo.faltan_cliente).toEqual([])
    expect(ultimo.faltan_factura).toEqual([])
    expect(ultimo.falta_saldo).toBe(0)
  })

  it('el concepto sale del servicio contratado, no del default', async () => {
    // Aquí el que cae al vacío es el bloque del servicio.
    sembrar({ casos: 300, ordenBloques: 'servicio-al-final' })
    const { data } = await getColaFacturacion()
    const ultimo = data!.casos.find(c => c.codigo === 'V0299')!
    expect(ultimo.concepto.servicio).toBe('completo')
    expect(ultimo.concepto.code).toBe('11')
    // Lo que importa no es el código —el default también es "11"— sino que el
    // caso NO quede marcado como facturado "por lo que se supone que se vendió".
    expect(ultimo.concepto.porDefecto).toBe(false)
    expect(data!.casos.filter(c => c.concepto.porDefecto)).toHaveLength(0)
  })

  it('un caso YA FACTURADO no vuelve a la bandeja como facturable', async () => {
    // El 298 está facturado y su fila vive en la cola de las que el techo corta.
    sembrar({ casos: 300, facturados: [298] })
    const { data } = await getColaFacturacion()

    const facturado = data!.casos.find(c => c.codigo === 'V0298')!
    expect(facturado.ya_facturado).toBe(true)
    expect(data!.totales.ya_facturados).toBe(1)
    // Y sobre todo: no puede estar contado entre los que se pueden emitir.
    expect(data!.totales.listos).toBe(299)
  })

  it('las copias heredadas del bloque de factura también se recorren enteras', async () => {
    // Aquí la segunda fuente de "ya facturado" (las 5 copias del bloque a lo
    // largo de la línea) son 1.500 filas por sí solas: 500 por encima del techo.
    sembrar({
      casos: 300, facturados: [299], copiasFactura: 5,
      bloqueFacturaSlug: true, facturaEnCopia: 4,
    })
    const { data } = await getColaFacturacion()
    const facturado = data!.casos.find(c => c.codigo === 'V0299')!
    expect(facturado.ya_facturado).toBe(true)
  })

  it('los negocios candidatos se leen completos aunque pasen de mil', async () => {
    sembrar({ casos: 1050 })
    const { data } = await getColaFacturacion()
    expect(data!.casos).toHaveLength(1050)
    expect(data!.casos.some(c => c.codigo === 'V1049')).toBe(true)
    expect(data!.totales.listos).toBe(1050)
  })

  it('los totales de la bandeja cuentan sobre la cola entera', async () => {
    sembrar({ casos: 300, facturados: [10, 298] })
    const { data } = await getColaFacturacion()
    expect(data!.totales.listos).toBe(298)
    expect(data!.totales.incompletos).toBe(0)
    expect(data!.totales.ya_facturados).toBe(2)
    expect(data!.totales.valor_listo).toBe(298 * 637500)
  })
})

describe('cola de facturación — un truncamiento no puede pasar por resultado', () => {
  it('si una lectura por lote falla, la cola devuelve error y NO una lista corta', async () => {
    sembrar({ casos: 300 })
    estado.tablasQueFallan.add('contactos')

    const { data, error } = await getColaFacturacion()
    expect(data).toBeNull()
    // El mensaje nombra la consulta: sin eso, quien lo vea no sabe qué reintentar.
    expect(error).toMatch(/facturacion\/contactos/)
  })

  it('el error de una consulta NO se disimula devolviendo los casos que sí llegaron', async () => {
    sembrar({ casos: 300 })
    estado.tablasQueFallan.add('negocio_bloques')

    const { data, error } = await getColaFacturacion()
    expect(data).toBeNull()
    expect(error).toBeTruthy()
  })
})
