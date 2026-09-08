/**
 * El guardián de duplicados mandaba a un botón que él mismo bloqueaba.
 *
 * En SOENA un mismo cliente tiene VARIOS negocios —un vehículo cada uno— y cada
 * negocio se factura independiente: cada factura queda atada a UN negocio. Al
 * facturar el segundo vehículo, el guardián mostraba en rojo la factura del
 * PRIMERO ("Este cliente ya tiene factura de este servicio… usa «Esta factura ya
 * existe»") y exigía justificación; pero abajo, en el panel de adopción, esa misma
 * factura salía DESHABILITADA con "ya está en V0140". Callejón sin salida: la
 * pantalla mandaba a un botón que ella misma bloqueaba, y la única salida correcta
 * —emitir la factura nueva— quedaba pareciendo la prohibida.
 *
 * Caso real ya resuelto a mano: **V0370** (Ford Escape) contra **V0140** (BYD), los
 * dos del mismo dueño. Dos vehículos, dos negocios, dos facturas.
 *
 * Medido el 2026-09-07 contra el Siigo real y producción, sobre los 51 negocios
 * abiertos pendientes de factura (etapa ≥ 5):
 *   - 32 sin ninguna factura del cliente en Siigo (no ven el aviso), 3 sin identificación.
 *   - **10 veían el aviso y era 100% espurio**: la única factura del cliente es la de
 *     un hermano ya facturado — V0156→V0154, V0210→V0207, V0245→V0246, V0321→V0323,
 *     V0339→V0138, V0349→V0155, V0390→V0228, V0408→V0410, V0409→V0410, V0417→V0246.
 *   - 6 con al menos una factura LIBRE, donde el aviso sí tiene que salir:
 *     V0134, V0253, V0276, V0282, V0340, V0345.
 *
 * Los pares se re-verificaron contra producción el 2026-09-07 (lectura, sin escribir):
 * los 10 hermanos tienen marca de factura y los 10 pendientes no, y los 6 de la
 * lista de libres siguen sin marca. Los números de este archivo son los REALES —
 * V0140 = FV-2-290, V0410 = FV-2-478 — y V0370 ya salió con FV-2-510, que es la
 * corrección a mano que originó el encargo.
 *
 * ⚠️ **El vínculo NO es el contacto de ONE, es la marca de la factura**, y hay un
 * caso que lo demuestra: V0321 y V0323 son el mismo dueño con DOS `contacto_id`
 * distintos en ONE. Siigo agrupa por identificación, así que la factura del hermano
 * aparece igual; si la regla mirara el contacto, ese caso se seguiría bloqueando.
 *
 * ⚠️ El doble reproduce el DEFECTO, no solo la forma de la tabla: `negocios`
 * devuelve las marcas de los hermanos, que es justo el dato que el código de
 * `main` no consultaba. Mutaciones corridas el 2026-09-07 (arnés que sustituye una
 * línea, corre vitest y restaura), las 6 caen:
 *   - ignorar el reclamo (el comportamiento de `main`) → **8 rojas**
 *   - vincular solo por id de Siigo, sin el número → 2
 *   - la factura propia también cuenta como hermana → 1
 *   - bloquear con TODAS las del cliente y no solo las libres → 4
 *   - el hermano viaja sin número de factura → 2
 *   - los hermanos nunca llegan a la pantalla → 3
 *
 * Las cédulas son ficticias: lo que se prueba es el vínculo negocio↔factura, no
 * el dato de la persona.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'

interface NegocioFalso {
  id: string
  codigo: string
  precio_aprobado: number
  linea_id: string | null
  metadata: Record<string, unknown>
}

/** Todos los negocios del workspace, con y sin marca de factura. */
let negocios: NegocioFalso[]
/** Lo que Siigo devuelve al preguntar por las facturas de la identificación. */
let facturasEnSiigo: Array<{ id: string; name: string; date: string; total: number; items: Array<{ code: string }> }>

const negocio = (id: string) => negocios.find(n => n.id === id)!

function servicioFalso() {
  return {
    from(tabla: string) {
      if (tabla !== 'negocios') throw new Error(`tabla inesperada en el doble: ${tabla}`)
      let sel = ''
      let rango: [number, number] = [0, 999]
      const filtros: Record<string, unknown> = {}
      const chain = {
        select: (cols: string) => { sel = cols; return chain },
        eq: (col: string, val: unknown) => { filtros[col] = val; return chain },
        in: () => chain,
        order: () => chain,
        range: (d: number, h: number) => { rango = [d, h]; return chain },
        single: async () => {
          const n = negocio(String(filtros.id))
          return n ? { data: n, error: null } : { data: null, error: { message: 'sin fila' } }
        },
        maybeSingle: async () => {
          const n = negocios.find(x => x.id === filtros.id)
          return { data: n ?? null, error: null }
        },
        update: (patch: Record<string, unknown>) => {
          const f: Record<string, unknown> = {}
          const upd = {
            eq: (col: string, val: unknown) => { f[col] = val; return upd },
            then: (resolve: (v: { error: null }) => unknown) => {
              const n = negocios.find(x => x.id === f.id)
              if (n) Object.assign(n, patch)
              return resolve({ error: null })
            },
          }
          return upd
        },
        // El listado paginado. Solo `marcasDeFacturaDelWorkspace` pide la marca:
        // cualquier otra consulta de lista sigue devolviendo vacío.
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => {
          const filas = sel.includes('siigo_factura')
            ? negocios.map(n => ({
                id: n.id,
                codigo: n.codigo,
                siigo_factura: n.metadata.siigo_factura ?? null,
              }))
            : []
          return resolve({ data: filas.slice(rango[0], rango[1] + 1), error: null })
        },
      }
      return chain
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./client', async () => {
  const real = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...real,
    getSiigoConfig: async () => ({
      facturaDocumentId: 1, reciboDocumentId: 2, sellerId: 3,
      productoCode: '11', ivaId: 4, facturaPaymentId: 5, reciboPaymentId: 6,
    }),
    siigoRequest: async (_ws: string, ruta: string) => {
      if (ruta.startsWith('/v1/invoices?')) return { results: facturasEnSiigo }
      if (ruta.endsWith('/pdf')) return {}
      return { id: 'siigo-fv-nueva', name: 'FV-2-999', total: 637500 }
    },
  }
})

vi.mock('./clientes', () => ({
  // La misma identificación para todos los negocios del bloque: es exactamente el
  // caso que se prueba, un dueño con varios vehículos.
  asegurarClienteSiigo: async () => ({
    estado: 'ya_existia' as const,
    identificacion: '11122233',
    siigo_id: 'siigo-cli-1',
    branch_office: 0,
  }),
  corregirContactoParaFactura: async () => ({ ok: true as const, cambiado: false }),
  identificacionDelNegocio: async () => ({ identificacion: '11122233', marca: null }),
}))

vi.mock('./concepto-negocio', () => ({
  resolverConceptoDeNegocio: async () => ({ code: '11', servicio: 'completo', porDefecto: false }),
}))

vi.mock('./archivar-documento', () => ({
  archivarPdfEnBloque: async () => ({ ok: true as const, url: null }),
}))

vi.mock('@/lib/negocios/copias-del-bloque', () => ({ idsDeCopiasDelBloque: async () => [] }))

vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  cerrarNegocioSiQuedaResuelto: async () => {},
}))

import {
  emitirFacturaNegocio,
  clasificarDuplicados,
  type FacturaEnSiigo,
  type ReclamoDeFactura,
} from './facturas'

const emitir = (negocioId: string, justificacionDuplicado?: string) =>
  emitirFacturaNegocio(
    WS, negocioId,
    'Diana',
    { emitir: true, justificacionDuplicado },
    // Honorario cubierto: lo único que puede frenar es lo que se prueba.
    { modelo: null, recaudado: 637500, ivaPct: 19, staffId: null },
  )

/** Marca tal como la deja `emitirFacturaNegocio`. */
const marcaDe = (numero: string, siigoId: string) => ({
  numero, siigo_id: siigoId, total: 637500, emitida: true,
  at: '2026-08-20T10:00:00.000Z', por: 'Diana', producto_code: '11',
})

beforeEach(() => {
  negocios = [
    // Jaime: dos vehículos. El BYD ya se facturó; el Ford Escape es el que entra.
    { id: 'neg-v0140', codigo: 'V0140', precio_aprobado: 637500, linea_id: null,
      metadata: { siigo_factura: marcaDe('FV-2-290', 'siigo-fv-290') } },
    { id: 'neg-v0370', codigo: 'V0370', precio_aprobado: 637500, linea_id: null, metadata: {} },
    // Tres hermanos del mismo dueño: V0410 ya facturado, V0408 y V0409 en cola.
    { id: 'neg-v0410', codigo: 'V0410', precio_aprobado: 637500, linea_id: null,
      metadata: { siigo_factura: marcaDe('FV-2-478', 'siigo-fv-478') } },
    { id: 'neg-v0408', codigo: 'V0408', precio_aprobado: 637500, linea_id: null, metadata: {} },
    { id: 'neg-v0409', codigo: 'V0409', precio_aprobado: 637500, linea_id: null, metadata: {} },
  ]
  facturasEnSiigo = [
    { id: 'siigo-fv-290', name: 'FV-2-290', date: '2026-05-14', total: 637500, items: [{ code: '11' }] },
  ]
})

describe('la factura de otro negocio NO es duplicado de este', () => {
  it('V0370 emite aunque V0140, del mismo dueño, ya tenga FV-2-290', async () => {
    const r = await emitir('neg-v0370')

    expect(r).toMatchObject({ ok: true, numero: 'FV-2-999' })
    // Y la factura del hermano sigue siendo del hermano: nadie la tocó.
    expect(negocio('neg-v0140').metadata.siigo_factura).toMatchObject({ numero: 'FV-2-290' })
    expect(negocio('neg-v0370').metadata.siigo_factura).toMatchObject({ numero: 'FV-2-999' })
  })

  it('no pide justificación: la marca sale SIN `justificacion_duplicado`', async () => {
    // Que emita no basta. Lo que la pantalla hacía era exigir un texto escrito
    // para una emisión que nunca fue dudosa, y ese texto quedaba en el expediente
    // afirmando que alguien pasó por encima de un duplicado que no existía.
    await emitir('neg-v0370')
    expect(negocio('neg-v0370').metadata.siigo_factura).not.toHaveProperty('justificacion_duplicado')
  })

  it('V0408 y V0409 emiten con la factura de V0410 en Siigo', async () => {
    facturasEnSiigo = [
      { id: 'siigo-fv-478', name: 'FV-2-478', date: '2026-06-02', total: 637500, items: [{ code: '11' }] },
    ]

    expect(await emitir('neg-v0408')).toMatchObject({ ok: true })
    // El segundo hermano ve DOS facturas reclamadas (la de V0410 y la que acaba de
    // salir para V0408) y tampoco se detiene.
    facturasEnSiigo.push({
      id: 'siigo-fv-nueva', name: 'FV-2-999', date: '2026-09-07', total: 637500, items: [{ code: '11' }],
    })
    expect(await emitir('neg-v0409')).toMatchObject({ ok: true })
  })

  it('una marca vieja SIN siigo_id igual reclama su factura, por número', async () => {
    // Las 252 marcas anteriores al 2026-09-07 pueden traer el id vacío. Si el
    // vínculo solo mirara el id, esas facturas volverían a contarse como libres y
    // el aviso espurio reaparecería justo en los casos más viejos.
    negocio('neg-v0140').metadata.siigo_factura = { ...marcaDe('FV-2-290', ''), siigo_id: '' }
    facturasEnSiigo = [
      { id: 'otro-id-en-siigo', name: 'FV-2-290', date: '2026-05-14', total: 637500, items: [{ code: '11' }] },
    ]

    expect(await emitir('neg-v0370')).toMatchObject({ ok: true })
  })
})

describe('lo que sí retiene: las facturas que nadie reclama', () => {
  it('una factura LIBRE del mismo producto bloquea y pide justificación', async () => {
    facturasEnSiigo = [
      { id: 'siigo-fv-libre', name: 'FV-2-500', date: '2026-03-31', total: 637500, items: [{ code: '11' }] },
    ]
    const r = await emitir('neg-v0370')

    expect(r).toMatchObject({ ok: false, motivo: 'duplicado_en_siigo' })
    if (r.ok || r.motivo !== 'duplicado_en_siigo') throw new Error('debía bloquear')
    expect(r.existentes).toHaveLength(1)
    expect(r.existentes[0]).toMatchObject({ name: 'FV-2-500', mismo_producto: true })
    expect(negocio('neg-v0370').metadata.siigo_factura).toBeUndefined()
  })

  it('una factura LIBRE de otro producto avisa, sin darla por del mismo servicio', async () => {
    facturasEnSiigo = [
      { id: 'siigo-fv-libre', name: 'FV-2-500', date: '2026-03-31', total: 637500, items: [{ code: '22' }] },
    ]
    const r = await emitir('neg-v0370')

    expect(r).toMatchObject({ ok: false, motivo: 'duplicado_en_siigo' })
    if (r.ok || r.motivo !== 'duplicado_en_siigo') throw new Error('debía bloquear')
    expect(r.existentes[0]).toMatchObject({ name: 'FV-2-500', mismo_producto: false })
  })

  it('con una libre y una del hermano, cada una va por su lado', async () => {
    facturasEnSiigo = [
      { id: 'siigo-fv-290', name: 'FV-2-290', date: '2026-05-14', total: 637500, items: [{ code: '11' }] },
      { id: 'siigo-fv-libre', name: 'FV-2-500', date: '2026-03-31', total: 637500, items: [{ code: '11' }] },
    ]
    const r = await emitir('neg-v0370')

    if (r.ok || r.motivo !== 'duplicado_en_siigo') throw new Error('debía bloquear')
    // La del hermano NO se pinta en rojo…
    expect(r.existentes.map(f => f.name)).toEqual(['FV-2-500'])
    // …pero sí se dice de quién es, que es lo que explica por qué abajo sale
    // deshabilitada en «Esta factura ya existe».
    expect(r.hermanos).toEqual([{ negocio_id: 'neg-v0140', codigo: 'V0140', numero: 'FV-2-290' }])
  })

  it('con justificación escrita emite igual, y queda guardada', async () => {
    facturasEnSiigo = [
      { id: 'siigo-fv-libre', name: 'FV-2-500', date: '2026-03-31', total: 637500, items: [{ code: '11' }] },
    ]
    const r = await emitir('neg-v0370', 'Confirmado con Diana: la FV-2-500 es de otro caso')

    expect(r).toMatchObject({ ok: true, numero: 'FV-2-999' })
    expect(negocio('neg-v0370').metadata.siigo_factura).toMatchObject({
      justificacion_duplicado: 'Confirmado con Diana: la FV-2-500 es de otro caso',
    })
  })
})

describe('clasificarDuplicados', () => {
  const facturas: FacturaEnSiigo[] = [
    { id: 'siigo-fv-290', name: 'FV-2-290', date: '2026-05-14', total: 637500, productos: ['11'] },
    { id: 'siigo-fv-libre', name: 'FV-2-500', date: '2026-03-31', total: 637500, productos: ['22'] },
    { id: 'siigo-fv-propia', name: 'FV-2-700', date: '2026-07-01', total: 637500, productos: ['11'] },
  ]
  const reclamos = new Map<string, ReclamoDeFactura>([
    ['id:siigo-fv-290', { negocio_id: 'neg-v0140', codigo: 'V0140' }],
    ['id:siigo-fv-propia', { negocio_id: 'neg-v0370', codigo: 'V0370' }],
  ])

  it('la factura del propio negocio no es hermana de sí misma', () => {
    const { duplicados, hermanos } = clasificarDuplicados(facturas, '11', reclamos, 'neg-v0370')
    expect(duplicados.map(f => f.name)).toEqual(['FV-2-500'])
    expect(hermanos.map(h => h.codigo)).toEqual(['V0140'])
  })

  it('sin `negocioId` la propia también cuenta como reclamada por alguien', () => {
    // Nunca deja de ser de OTRO desde el punto de vista del guardián: lo que no
    // puede pasar es que una factura con dueño vuelva a la lista roja.
    const { duplicados } = clasificarDuplicados(facturas, '11', reclamos)
    expect(duplicados.map(f => f.name)).toEqual(['FV-2-500'])
  })

  it('un negocio sin código se nombra igual, con el id como respaldo', () => {
    const sinCodigo = new Map<string, ReclamoDeFactura>([
      ['num:FV-2-290', { negocio_id: 'neg-x', codigo: null }],
    ])
    const { hermanos } = clasificarDuplicados([facturas[0]], '11', sinCodigo)
    expect(hermanos).toEqual([{ negocio_id: 'neg-x', codigo: null, numero: 'FV-2-290' }])
  })
})
