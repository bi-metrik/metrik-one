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

const WS = 'ws-soena'
const LINEA = 'linea-ve'

/** Tope de filas del servidor. El doble lo respeta: es el defecto que se prueba. */
const MAX_ROWS = 1000

type Fila = Record<string, unknown>
let fixtures: Record<string, Fila[]> = {}
/** Tablas cuya lectura devuelve error, para probar que la cola no la disimula. */
let tablasQueFallan = new Set<string>()

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

// ─── Doble: mini motor de consultas que RECORTA como PostgREST ──────────────

function valorEn(fila: Fila, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>(
    (acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]),
    fila,
  )
}

function servicioFalso() {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      let orden: string | null = null
      let tope: number | null = null
      let rango: [number, number] | null = null

      const resolver = (): Fila[] => {
        let filas = (fixtures[tabla] ?? []).filter(f => filtros.every(p => p(f)))
        if (orden) {
          const campo = orden
          filas = [...filas].sort((a, b) =>
            String(valorEn(a, campo) ?? '').localeCompare(String(valorEn(b, campo) ?? '')),
          )
        }
        if (rango) {
          const [desde, hasta] = rango
          // Aunque pidan un rango más ancho, el servidor nunca manda más de MAX_ROWS.
          filas = filas.slice(desde, desde + Math.min(hasta - desde + 1, MAX_ROWS))
        } else {
          // Sin `.range()` el servidor recorta en seco y NO avisa: éste es el bug.
          filas = filas.slice(0, MAX_ROWS)
        }
        if (tope !== null) filas = filas.slice(0, tope)
        return filas
      }

      const chain = {
        select: () => chain,
        eq: (campo: string, valor: unknown) => {
          filtros.push(f => valorEn(f, campo) === valor)
          return chain
        },
        in: (campo: string, valores: unknown[]) => {
          const set = new Set(valores)
          filtros.push(f => set.has(valorEn(f, campo)))
          return chain
        },
        order: (campo: string) => {
          orden = campo
          return chain
        },
        limit: (n: number) => {
          tope = n
          return chain
        },
        range: (desde: number, hasta: number) => {
          rango = [desde, hasta]
          return chain
        },
        single: async () => ({ data: resolver()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: resolver()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Fila[] | null; error: { message: string } | null }) => unknown) =>
          resolve(
            tablasQueFallan.has(tabla)
              ? { data: null, error: { message: 'conexión caída' } }
              : { data: resolver(), error: null },
          ),
      }
      return chain
    },
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(4, '0')

const RUT_COMPLETO = {
  numero_identificacion: { value: '9771470' },
  tipo_persona: { value: 'Natural' },
  primer_nombre: { value: 'VICTOR' },
  primer_apellido: { value: 'RESTREPO' },
  razon_social: { value: 'RESTREPO TORO VICTOR HUGO' },
  direccion: { value: 'CR 15 14 31' },
  email: { value: 'victor@example.com' },
  municipio: { value: 'Armenia' },
  departamento: { value: 'Quindío' },
  pais: { value: 'COLOMBIA' },
}

const SIIGO_CFG = {
  facturaDocumentId: 1, reciboDocumentId: 2, sellerId: 3,
  productoCode: '22', ivaId: 4, facturaPaymentId: 5, reciboPaymentId: 6,
}

/**
 * Arma un workspace con `casos` negocios listos para facturar.
 *
 * El ORDEN de las filas de bloques imita lo medido en producción: primero todos
 * los RUT, luego todos los servicios, y **las filas de factura al final**. Así el
 * recorte del servidor se lleva justo las que dicen "esto ya se facturó", que es
 * la forma más cara de fallar.
 */
function sembrar(opciones: {
  casos: number
  facturados?: number[]
  copiasFactura?: number
  bloqueFacturaSlug?: boolean
  /**
   * Qué grupo de filas queda al final y por lo tanto se pierde con el recorte.
   * En producción el orden lo decide el plan de la consulta y **cambia entre
   * corridas**: en dos mediciones separadas por minutos el conteo de casos sin
   * servicio pasó de 24 a 23. Por eso se prueban las dos variantes.
   */
  ordenBloques?: 'factura-al-final' | 'rut-al-final' | 'servicio-al-final'
  /**
   * En cuál de las copias heredadas quedó cargada la factura. Por defecto la
   * nativa; poner una copia tardía reproduce el caso real (medido 2026-08-27:
   * 240 de 272 negocios no tienen fila en la configuración nativa).
   */
  facturaEnCopia?: number
}) {
  const { casos, facturados = [], copiasFactura = 1, facturaEnCopia = 0 } = opciones
  const orden = opciones.ordenBloques ?? 'factura-al-final'
  const yaFacturado = new Set(facturados)

  fixtures = {
    workspaces: [{ id: WS, config_extra: { siigo_config: SIIGO_CFG, siigo_access_key: 'k' } }],
    lineas_negocio: [{
      id: LINEA, workspace_id: WS,
      config_extra: {
        facturacion: { desde_etapa_numero: 5 },
        siigo: {
          conceptos: { completo: '11', solo_upme: '22', solo_iva: '11', default: '11' },
          ...(opciones.bloqueFacturaSlug ? { bloque_factura_slug: 'factura_emitida' } : {}),
        },
      },
    }],
    negocios: [],
    negocio_bloques: [],
    cobros: [],
    negocio_conciliacion: [],
    contactos: [],
    bloque_configs: [],
  }

  for (let i = 0; i < casos; i++) {
    const id = `neg-${pad(i)}`
    fixtures.negocios.push({
      id, codigo: `V${pad(i)}`, nombre: `Caso ${i}`, workspace_id: WS, estado: 'abierto',
      precio_aprobado: 637500, contacto_id: `con-${pad(i)}`, linea_id: LINEA, metadata: {},
      etapas_negocio: { nombre: 'Cargue', numero: 6 },
    })
    fixtures.contactos.push({ id: `con-${pad(i)}`, email: null, telefono: '3142557450' })
    // Honorario recaudado completo: así `falta_saldo` es 0 y lo único que puede
    // dejar un caso fuera de "listo" es que le falte un dato del borrador.
    fixtures.cobros.push({ id: `cob-${pad(i)}`, negocio_id: id, monto: 637500, tipo_cobro: 'pago', split_json: null })
  }

  // Configuraciones del bloque de factura (la nativa y sus copias heredadas).
  for (let c = 0; c < copiasFactura; c++) {
    fixtures.bloque_configs.push({
      id: `cfg-fact-${c}`,
      slug: c === 0 ? 'factura_emitida' : null,
      nombre: 'Factura emitida',
      etapas_negocio: { linea_id: LINEA },
    })
  }

  // El orden de inserción ES el orden que devuelve el servidor cuando nadie pide
  // uno: lo último que se siembra es lo primero que el techo se lleva.
  const push = (rango: number, i: number, slug: string, cfg: string, data: Fila) =>
    fixtures.negocio_bloques.push({
      id: `blq-${rango}-${pad(i)}`, negocio_id: `neg-${pad(i)}`,
      bloque_config_id: cfg, data, bloque_configs: { slug },
    })

  const grupos: Record<string, (rango: number) => void> = {
    rut: r => { for (let i = 0; i < casos; i++) push(r, i, 'rut', 'cfg-rut', { campos: RUT_COMPLETO }) },
    servicio: r => { for (let i = 0; i < casos; i++) push(r, i, 'servicio_contratado', 'cfg-srv', { servicio: 'completo' }) },
    upme: r => { for (let i = 0; i < casos; i++) push(r, i, 'comprobante_pago_upme', 'cfg-upm', { campos: { valor_pagado: { value: 701812 } } }) },
    factura: r => {
      for (let c = 0; c < copiasFactura; c++) {
        for (let i = 0; i < casos; i++) {
          const tieneNumero = yaFacturado.has(i) && c === facturaEnCopia
          push(r + c, i, 'factura_emitida', `cfg-fact-${c}`,
            tieneNumero ? { campos: { numero_factura: { value: `FV-${i}` } } } : { campos: {} })
        }
      }
    },
  }

  const secuencias: Record<string, string[]> = {
    'factura-al-final': ['rut', 'servicio', 'upme', 'factura'],
    'rut-al-final': ['servicio', 'upme', 'factura', 'rut'],
    'servicio-al-final': ['rut', 'upme', 'factura', 'servicio'],
  }
  const secuencia = secuencias[orden]
  let rango = 0
  for (const g of secuencia) {
    grupos[g](rango)
    rango += g === 'factura' ? copiasFactura : 1
  }
}

beforeEach(() => { fixtures = {}; tablasQueFallan = new Set() })

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
    tablasQueFallan.add('contactos')

    const { data, error } = await getColaFacturacion()
    expect(data).toBeNull()
    // El mensaje nombra la consulta: sin eso, quien lo vea no sabe qué reintentar.
    expect(error).toMatch(/facturacion\/contactos/)
  })

  it('el error de una consulta NO se disimula devolviendo los casos que sí llegaron', async () => {
    sembrar({ casos: 300 })
    tablasQueFallan.add('negocio_bloques')

    const { data, error } = await getColaFacturacion()
    expect(data).toBeNull()
    expect(error).toBeTruthy()
  })
})
