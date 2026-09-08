/**
 * El gate del recaudo en la emisión: tres ramas, no dos.
 *
 * Desde el 2026-09-08 el honorario recaudado es CONDICIÓN DE ENTRADA a la cola de
 * facturación (decisión de Mauricio). Lo que se prueba aquí es la mitad que de
 * verdad decide, la del servidor:
 *
 *   faltante <= tolerancia .......... emite, como siempre
 *   faltante  > banda ............... BLOQUEA, y ninguna justificación lo abre
 *   en la banda, sin justificación .. bloquea pidiendo el texto
 *   en la banda, con justificación .. emite POR EL HONORARIO COMPLETO
 *
 * Las dos afirmaciones caras del frente están cubiertas con una prueba cada una:
 * que la justificación NO sirve por encima de la banda (si sirviera, "condición de
 * entrada" sería una etiqueta), y que la factura NO baja a lo recaudado (bajarla
 * arrastraría base gravable y plan de cobro, que no está en esta decisión).
 *
 * ⚠️ Corridas contra la versión anterior del módulo (la de la rama principal, con
 * UNA sola rama en el bloque del saldo): **5 cayeron y 5 pasaron**, y las dos
 * mitades importan.
 *
 * Cayeron las cinco que describen lo que no existía — antes se devolvía
 * `saldo_pendiente` para todo faltante sobre la tolerancia:
 *   · dentro de la banda sin justificación (el motivo nuevo)
 *   · dentro de la banda con justificación (emisión + rastro)
 *   · la factura por el honorario completo (antes ni llegaba a emitir)
 *   · el borde inclusivo de la banda
 *   · la justificación en blanco
 *
 * Pasaron las cinco que fijan lo que NO debía cambiar: el caso cuadrado, el
 * residuo bajo la tolerancia, el bloqueo por encima de la banda, un peso más que
 * la banda, y que una justificación innecesaria no se guarde. Son el control: si
 * también hubieran caído, el fixture estaría roto en vez de medir el cambio.
 *
 * El doble es de solo lectura salvo en `negocios.metadata`, que es donde queda la
 * marca; contra Siigo no sale una sola petición de red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0179'
/** V0179, el único caso de SOENA dentro de la banda el 2026-09-08. */
const HONORARIO = 637_500

let fila: { id: string; precio_aprobado: number; linea_id: string | null; metadata: Record<string, unknown> }
/** Cuerpos que la emisión mandó a `/v1/invoices`. Lo que de verdad se factura. */
let facturasEnviadas: Array<{ items?: Array<{ price?: number }> }>

function servicioFalso() {
  return {
    from(tabla: string) {
      if (tabla !== 'negocios') throw new Error(`tabla inesperada en el doble: ${tabla}`)
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        range: () => chain,
        single: async () => ({ data: { ...fila }, error: null }),
        maybeSingle: async () => ({ data: { ...fila }, error: null }),
        update: (patch: Record<string, unknown>) => {
          const aplicar = { ...patch }
          const upd = {
            eq: () => upd,
            then: (resolve: (v: { error: null }) => unknown) => {
              Object.assign(fila, aplicar)
              return resolve({ error: null })
            },
          }
          return upd
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
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
    siigoRequest: async (_ws: string, ruta: string, opciones?: { body?: unknown }) => {
      if (ruta.startsWith('/v1/invoices?')) return { results: [] }
      if (ruta.endsWith('/pdf')) return {}
      facturasEnviadas.push((opciones?.body ?? {}) as { items?: Array<{ price?: number }> })
      return { id: 'siigo-fv-1', name: 'FV-2-500', total: HONORARIO }
    },
  }
})

vi.mock('./clientes', () => ({
  asegurarClienteSiigo: async () => ({
    estado: 'ya_existia' as const, identificacion: '80815711', siigo_id: 'siigo-cli-1',
  }),
  corregirContactoParaFactura: async () => ({ ok: true as const, cambiado: false }),
}))

vi.mock('./concepto-negocio', () => ({
  resolverConceptoDeNegocio: async () => ({ code: '11', servicio: 'completo', porDefecto: false }),
}))

vi.mock('./archivar-documento', () => ({
  archivarPdfEnBloque: async () => ({ ok: true as const, url: null }),
}))

vi.mock('@/lib/negocios/copias-del-bloque', () => ({
  idsDeCopiasDelBloque: async () => [],
}))

vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  cerrarNegocioSiQuedaResuelto: async () => {},
}))

import { emitirFacturaNegocio } from './facturas'
import { bandaMaterialidadFacturacion } from '@/lib/facturacion/caso-listo'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

/** `recaudado` decide el faltante; `justificacionDescuadre` es lo que se prueba. */
const emitir = (recaudado: number, justificacionDescuadre?: string) =>
  emitirFacturaNegocio(
    WS, NEG, 'Diana',
    { emitir: true, justificacionDescuadre },
    { modelo: null, recaudado, ivaPct: 19, staffId: null },
  )

const marca = () => fila.metadata.siigo_factura as {
  total: number
  justificacion_descuadre?: { texto: string; faltante: number; por: string | null }
} | undefined

beforeEach(() => {
  facturasEnviadas = []
  fila = { id: NEG, precio_aprobado: HONORARIO, linea_id: null, metadata: {} }
})

describe('emitirFacturaNegocio — el gate del recaudo', () => {
  it('con el honorario cubierto emite sin pedir nada', async () => {
    const r = await emitir(HONORARIO)
    expect(r).toMatchObject({ ok: true, numero: 'FV-2-500' })
  })

  it('un residuo bajo la tolerancia sigue pasando de largo', async () => {
    const r = await emitir(HONORARIO - TOLERANCIA_SALDO_COP)
    expect(r.ok).toBe(true)
  })

  it('DENTRO de la banda y sin justificación: bloquea y dice cuánto falta', async () => {
    // V0179 tal como está en producción: faltan $3.000 sobre $637.500 (0,47%).
    const r = await emitir(HONORARIO - 3_000)
    expect(r).toEqual({
      ok: false,
      motivo: 'descuadre_de_recaudo',
      faltante: 3_000,
      banda: bandaMaterialidadFacturacion(HONORARIO),
    })
    // Y no se creó nada en Siigo: bloquear es bloquear.
    expect(facturasEnviadas).toHaveLength(0)
  })

  it('DENTRO de la banda y con justificación: emite y deja el rastro', async () => {
    const r = await emitir(HONORARIO - 3_000, '  Diana autoriza: el cliente pagó el resto en efectivo  ')
    expect(r).toMatchObject({
      ok: true,
      descuadre_justificado: {
        faltante: 3_000,
        justificacion: 'Diana autoriza: el cliente pagó el resto en efectivo',
      },
    })
    // Sin rastro escrito la decisión de la financiera no existe cuando se audite.
    expect(marca()?.justificacion_descuadre).toMatchObject({
      texto: 'Diana autoriza: el cliente pagó el resto en efectivo',
      faltante: 3_000,
      por: 'Diana',
    })
  })

  it('⚠️ la factura sale por el honorario COMPLETO, no por lo recaudado', async () => {
    // Se comparan los DOS cuerpos que se le mandaron a Siigo: el del caso cuadrado
    // y el del caso con descuadre autorizado. Si el valor bajara a lo recaudado,
    // arrastraría la base gravable y el plan de cobro.
    await emitir(HONORARIO)
    // La primera emisión deja la marca, y la marca bloquea la segunda ("ya
    // facturado en ONE"). Se limpia para poder comparar los dos cuerpos.
    fila.metadata = {}
    await emitir(HONORARIO - 3_000, 'autorizado')
    expect(facturasEnviadas).toHaveLength(2)
    expect(facturasEnviadas[1]).toEqual(facturasEnviadas[0])
    expect(marca()?.total).toBe(HONORARIO)
  })

  it('⚠️⚠️ POR ENCIMA de la banda ninguna justificación abre', async () => {
    // Es lo que convierte el recaudo en condición de entrada y no en una etiqueta:
    // V0406 debe el 11,8% de su honorario y no hay texto que lo destrabe.
    const r = await emitir(HONORARIO - 50_000, 'el cliente prometió pagar mañana')
    expect(r).toMatchObject({ ok: false, motivo: 'saldo_pendiente', faltante: 50_000 })
    expect(facturasEnviadas).toHaveLength(0)
    expect(marca()).toBeUndefined()
  })

  it('el borde de la banda es INCLUSIVO: exactamente el 1% todavía se puede autorizar', async () => {
    const banda = bandaMaterialidadFacturacion(HONORARIO)
    expect(await emitir(HONORARIO - banda, 'autorizado')).toMatchObject({ ok: true })
  })

  it('un peso más que la banda ya no', async () => {
    const banda = bandaMaterialidadFacturacion(HONORARIO)
    expect(await emitir(HONORARIO - banda - 1, 'autorizado'))
      .toMatchObject({ ok: false, motivo: 'saldo_pendiente' })
  })

  it('una justificación que no hacía falta NO se anuncia ni se guarda', async () => {
    // Mandar el texto no es lo mismo que haberlo necesitado. Si se guardara igual,
    // la auditoría vería autorizaciones sobre facturas que estaban cuadradas.
    const r = await emitir(HONORARIO, 'texto que sobra')
    expect(r.ok).toBe(true)
    expect(r).not.toHaveProperty('descuadre_justificado')
    expect(marca()?.justificacion_descuadre).toBeUndefined()
  })

  it('una justificación en blanco no cuenta como escrita', async () => {
    const r = await emitir(HONORARIO - 3_000, '    ')
    expect(r).toMatchObject({ ok: false, motivo: 'descuadre_de_recaudo' })
  })
})
