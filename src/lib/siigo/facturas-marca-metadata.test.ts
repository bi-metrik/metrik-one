/**
 * Al escribir la marca de la factura no se puede borrar lo que otro escribió en
 * el medio.
 *
 * `emitirFacturaNegocio` lee el negocio al empezar y guarda `negocio.metadata`
 * en una variable. Más abajo llama a `asegurarClienteSiigo`, que cuando la marca
 * guardada NO coincide con el RUT rehace el camino y **reescribe
 * `negocios.metadata.siigo_cliente`** con la identificación buena. Al final la
 * emisión guardaba `siigo_factura` fusionando sobre aquella copia VIEJA, así que
 * devolvía `siigo_cliente` a su valor anterior: un read-modify-write que pierde
 * la escritura intermedia, sin error y con la fila quedando "bien guardada".
 *
 * SECUELA MEDIDA EN PRODUCCIÓN (2026-09-02): **12 negocios ya facturados** de
 * SOENA quedaron con `siigo_cliente.identificacion` igual a la cédula del RUT
 * MENOS su último dígito — la heurística `nit_sin_dv` que `asegurarClienteSiigo`
 * ya corregía, resembrada por el propio acto de facturar. V0189 quedó marcado
 * con 8081571 mientras su RUT dice 80815711.
 *
 * EL DOBLE REPRODUCE EL DEFECTO, no solo la tabla: `asegurarClienteSiigo` está
 * sustituido por uno que **escribe de verdad** en la fila del negocio antes de
 * devolver. Sin esa escritura intermedia las dos pruebas pasarían contra el
 * código viejo y no probarían nada.
 *
 * LAS DOS SE VIERON FALLAR contra `origin/main` (2026-09-02):
 *   - la corrección del tercero sobrevive  → siigo_cliente volvía a "8081571"
 *   - la marca de otro documento sobrevive → siigo_recibo desaparecía
 *
 * Y una tercera, sobre el helper: la marca de la factura se guarda IGUAL cuando
 * la relectura falla. Es la asimetría deliberada de `guardarMarcaEnMetadata`
 * (perder la caché del tercero se arregla solo; perder la marca de un documento
 * fiscal ya emitido, no).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0189'

/** Única fila de `negocios`. El doble escribe y lee de aquí. */
let fila: { id: string; precio_aprobado: number; linea_id: string | null; metadata: Record<string, unknown> }
/** Simula que la relectura previa a guardar la marca falla. */
let fallaRelectura = false
/**
 * Cuando está en `true`, la lectura se cae JUSTO DESPUÉS de asegurar el tercero:
 * así falla la relectura previa a guardar la marca y no la lectura inicial del
 * negocio, que abortaría la emisión antes de llegar a lo que se prueba.
 */
let fallarRelecturaTrasAsegurar = false
/** Lo que `asegurarClienteSiigo` escribe antes de devolver. */
let identificacionCorregida = '80815711'

function servicioFalso() {
  return {
    from(tabla: string) {
      if (tabla !== 'negocios') throw new Error(`tabla inesperada en el doble: ${tabla}`)
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        single: async () =>
          fallaRelectura
            ? { data: null, error: { message: 'conexión caída' } }
            : { data: { ...fila }, error: null },
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

// Siigo: solo lo que la emisión necesita. Cero red.
vi.mock('./client', async () => {
  const real = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...real,
    getSiigoConfig: async () => ({
      facturaDocumentId: 1, reciboDocumentId: 2, sellerId: 3,
      productoCode: '11', ivaId: 4, facturaPaymentId: 5, reciboPaymentId: 6,
    }),
    siigoRequest: async (_ws: string, ruta: string) => {
      if (ruta.startsWith('/v1/invoices?')) return { results: [] }
      if (ruta.endsWith('/pdf')) return {}
      return { id: 'siigo-fv-1', name: 'FV-2-244', total: 637500 }
    },
  }
})

/**
 * El corazón del doble: `asegurarClienteSiigo` NO es un stub mudo, ESCRIBE la
 * corrección en la fila igual que la función real. Es la escritura intermedia
 * que la emisión pisaba.
 */
vi.mock('./clientes', () => ({
  asegurarClienteSiigo: async () => {
    fila.metadata = {
      ...fila.metadata,
      siigo_cliente: {
        identificacion: identificacionCorregida,
        siigo_id: 'siigo-cli-1',
        at: '2026-09-02T00:00:00.000Z',
        origen: 'manual',
      },
    }
    if (fallarRelecturaTrasAsegurar) fallaRelectura = true
    return { estado: 'ya_existia' as const, identificacion: identificacionCorregida, siigo_id: 'siigo-cli-1' }
  },
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

// Arrastra media aplicación y no interviene en lo que se mide.
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  cerrarNegocioSiQuedaResuelto: async () => {},
}))

import { emitirFacturaNegocio } from './facturas'
import { guardarMarcaEnMetadata, fusionarMarca } from '@/lib/negocios/marca-metadata'

const emitir = () =>
  emitirFacturaNegocio(
    WS, NEG, 'Diana',
    { emitir: true },
    // Honorario cubierto: lo único que puede frenar la emisión es lo que se prueba.
    { modelo: null, recaudado: 637500, ivaPct: 19, staffId: null },
  )

beforeEach(() => {
  fallaRelectura = false
  fallarRelecturaTrasAsegurar = false
  identificacionCorregida = '80815711'
  fila = {
    id: NEG,
    precio_aprobado: 637500,
    linea_id: null,
    // La marca vieja es la dañada por `nit_sin_dv`: le falta el último dígito.
    metadata: {
      siigo_cliente: { identificacion: '8081571', siigo_id: 'siigo-cli-1', at: '2026-08-01T00:00:00.000Z', origen: 'automatico' },
    },
  }
})

describe('emitirFacturaNegocio — la marca de la factura no pisa lo escrito en el medio', () => {
  it('la corrección de la identificación del tercero SOBREVIVE a la emisión', async () => {
    const r = await emitir()
    expect(r).toMatchObject({ ok: true, numero: 'FV-2-244' })

    // Lo que se emitió salió con la cédula buena — eso ya funcionaba.
    expect((fila.metadata.siigo_factura as { numero: string }).numero).toBe('FV-2-244')
    // Y lo que se rompía: la marca del tercero se quedaba con la cédula truncada.
    expect((fila.metadata.siigo_cliente as { identificacion: string }).identificacion).toBe('80815711')
  })

  it('una marca escrita en el medio por OTRO camino tampoco desaparece', async () => {
    // No es solo `siigo_cliente`: cualquier clave que alguien escriba entre la
    // lectura inicial y el guardado se perdía. Se prueba con la del recibo, que
    // es la otra que la financiera consulta.
    identificacionCorregida = '80815711'
    const antes = fila.metadata
    fila.metadata = { ...antes, siigo_recibo: { numero: 'RC-1-43', valor: 701812 } }

    await emitir()
    expect((fila.metadata.siigo_recibo as { numero: string }).numero).toBe('RC-1-43')
    expect((fila.metadata.siigo_cliente as { identificacion: string }).identificacion).toBe('80815711')
  })

  it('si la relectura falla, la marca de la factura se guarda IGUAL', async () => {
    // Asimetría deliberada: perder la caché del tercero se arregla sola en el
    // siguiente `asegurarClienteSiigo`; perder la marca de una factura ya emitida
    // manda el caso de vuelta a la cola, donde alguien podría re-emitirla.
    fallarRelecturaTrasAsegurar = true
    const r = await emitir()
    expect(r).toMatchObject({ ok: true })
    expect((fila.metadata.siigo_factura as { numero: string }).numero).toBe('FV-2-244')
  })
})

describe('guardarMarcaEnMetadata — fusión', () => {
  it('conserva las demás claves y reemplaza solo la suya', () => {
    expect(fusionarMarca({ a: 1, b: 2 }, 'b', 3)).toEqual({ a: 1, b: 3 })
    expect(fusionarMarca(null, 'a', 1)).toEqual({ a: 1 })
  })

  it('fusiona sobre lo que hay en la base AHORA, no sobre lo que le pasen', async () => {
    fila.metadata = { siigo_cliente: { identificacion: '80815711' } }
    const r = await guardarMarcaEnMetadata(
      servicioFalso(), WS, NEG, 'siigo_factura', { numero: 'FV-2-244' },
      // Copia vieja: si el helper la usara, `siigo_cliente` volvería a '8081571'.
      { siigo_cliente: { identificacion: '8081571' } },
    )
    expect(r).toEqual({ ok: true })
    expect((fila.metadata.siigo_cliente as { identificacion: string }).identificacion).toBe('80815711')
  })
})
