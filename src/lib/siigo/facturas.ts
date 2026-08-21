// ============================================================
// Emisión de la factura del honorario contra Siigo.
//
// A diferencia del tercero, esto NO se dispara solo: una factura electrónica
// aceptada por la DIAN no se deshace. La emite una persona desde la cola, y este
// módulo pone las barreras que esa persona no puede verificar a ojo.
//
// La prefactura NO existe en Siigo: se calcula en ONE (`borradorFactura`) y se
// revisa en pantalla. Siigo solo recibe lo que de verdad se emite, así que su
// contabilidad no acumula borradores que alguien tendría que anular.
//
// Server-only.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import { claveIdempotencia, getSiigoConfig, siigoRequest, SiigoError } from './client'
import { borradorFactura, type BorradorFactura } from './mapeo'
import { resolverConceptoDeNegocio } from './concepto-negocio'
import { asegurarClienteSiigo, corregirContactoParaFactura } from './clientes'
import { descuadreConciliacion, type ModeloDinero } from '@/lib/upme/modelo-dinero'
import { archivarPdfEnBloque } from './archivar-documento'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'
import { cerrarNegocioSiQuedaResuelto } from '@/app/(app)/negocios/negocio-v2-actions'

/**
 * Emitir SÍ aguanta la pausa del límite de peticiones de Siigo (pide ~19 s).
 * Quien pulsó el botón ya confirmó dos veces: prefiere esperar con el spinner a
 * que le digan que lo intente de nuevo y volver a pasar por las confirmaciones.
 */
const ESPERA_429_EMISION_MS = 30_000

/** Factura que ya existe en Siigo para ese cliente y ese producto. */
export interface FacturaEnSiigo {
  id: string
  /** Número visible, p. ej. "FV-2-225". */
  name: string
  date: string
}

interface RespuestaFacturas {
  results?: Array<{
    id?: string
    name?: string
    date?: string
    items?: Array<{ code?: string }>
  }>
}

/**
 * Facturas del PRODUCTO del servicio que Siigo ya tiene para esa identificación.
 *
 * Se filtra por producto a propósito: SOENA factura otras cosas al mismo cliente,
 * y contar cualquier factura daría por facturado a quien no lo está. El filtro
 * `customer_identification` está verificado contra la API (devuelve solo las de
 * ese cliente; el parámetro `identification`, en cambio, se ignora en silencio y
 * devuelve TODO, que es la forma más fácil de creer que un guard funciona).
 */
export async function facturasDelClienteEnSiigo(
  workspaceId: string,
  identificacion: string,
  productoCode: string,
  maxEspera429Ms = 0,
): Promise<FacturaEnSiigo[]> {
  if (!identificacion) return []
  const r = await siigoRequest<RespuestaFacturas>(
    workspaceId,
    `/v1/invoices?customer_identification=${encodeURIComponent(identificacion)}&page_size=100`,
    { maxEspera429Ms },
  )
  return (r.results ?? [])
    .filter(f => f.items?.some(i => i.code === productoCode))
    .map(f => ({ id: f.id ?? '', name: f.name ?? '(sin número)', date: f.date ?? '' }))
}

export interface OpcionesEmision {
  /**
   * Slug del bloque del negocio donde se archiva el PDF emitido. Sin él la
   * factura se emite igual, pero el archivo no queda en el expediente: se avisa
   * en vez de dejarlo pasar callado.
   */
  bloqueFacturaSlug?: string
  /**
   * Emitir electrónicamente (radicar ante la DIAN). En `false` el documento se
   * crea en Siigo sin radicar, para una primera prueba controlada.
   */
  emitir: boolean
  /** Mandar el correo de Siigo al cliente. */
  enviarCorreo?: boolean
  /**
   * Justificación para emitir a pesar de que Siigo ya tiene una factura de este
   * producto para el cliente. Sin ella, el duplicado BLOQUEA.
   */
  justificacionDuplicado?: string
  /**
   * Lo que la financiera corrigió en la pantalla de revisión antes de darle a
   * facturar. Es la aplicación del principio de siempre (ONE sugiere, la
   * financiera edita) al único momento en que todavía se puede: después de emitir,
   * una factura electrónica no se corrige, se anula.
   *
   * `email` y `telefono` se guardan en el contacto de ONE y se empujan al tercero
   * de Siigo; `productoCode` cambia el CONCEPTO que el cliente va a leer.
   */
  datos?: {
    email?: string
    telefono?: string
    /**
     * Producto del catálogo de Siigo. Quien llama tiene que haberlo validado
     * contra el catálogo: aquí ya no se distingue un código bueno de un typo.
     */
    productoCode?: string
  }
}

export type ResultadoEmision =
  | {
      ok: true; numero: string; siigo_id: string; total: number; emitida: boolean
      /** `false` si la factura salió pero su PDF no se pudo dejar en el negocio. */
      archivada: boolean
    }
  | { ok: false; motivo: 'faltan_datos'; faltantes: string[] }
  | { ok: false; motivo: 'saldo_pendiente'; faltante: number }
  | { ok: false; motivo: 'ya_facturado_en_one'; numero: string }
  | { ok: false; motivo: 'duplicado_en_siigo'; existentes: FacturaEnSiigo[] }
  | { ok: false; motivo: 'error'; mensaje: string }

/**
 * PDF de un documento ya emitido, tal como lo entrega Siigo.
 *
 * Solo existe para FACTURAS. Los recibos de caja no exponen PDF por API
 * (comprobado el 2026-08-10: 404 en `/pdf` y en `/print`).
 */
export async function pdfDeFactura(
  workspaceId: string,
  siigoId: string,
): Promise<{ pdf: Buffer; cufe: string | null } | null> {
  try {
    const r = await siigoRequest<{ base64?: string; cufe?: string }>(
      workspaceId, `/v1/invoices/${siigoId}/pdf`, { maxEspera429Ms: ESPERA_429_EMISION_MS },
    )
    if (!r.base64) return null
    return { pdf: Buffer.from(r.base64, 'base64'), cufe: r.cufe ?? null }
  } catch (e) {
    console.error('[siigo] no se pudo traer el PDF de la factura:', (e as Error).message)
    return null
  }
}

/** Marca que queda en `negocios.metadata.siigo_factura`. */
export interface MarcaFactura {
  numero: string
  siigo_id: string
  total: number
  /** Identificador fiscal de la factura electrónica, cuando Siigo lo devuelve. */
  cufe?: string | null
  /** Dónde quedó archivado el PDF dentro del negocio. */
  archivo_url?: string | null
  /** `false` si se creó sin radicar ante la DIAN. */
  emitida: boolean
  at: string
  por: string | null
  /** Presente solo si se emitió pasando por encima de un duplicado. */
  justificacion_duplicado?: string
  /**
   * Producto de Siigo con el que salió el concepto. Se guarda siempre, no solo
   * cuando lo cambiaron a mano: sin él, saber qué decía una factura vieja obliga
   * a preguntarle a Siigo.
   */
  producto_code?: string
}

interface DatosNegocio {
  id: string
  precio_aprobado: number | null
  metadata: Record<string, unknown> | null
}

/**
 * Emite la factura del honorario de un negocio.
 *
 * El orden de las barreras importa: lo que se puede resolver sin llamar a Siigo
 * se resuelve antes, y la consulta de duplicados va de última porque es la única
 * que cuesta una llamada de red.
 */
export async function emitirFacturaNegocio(
  workspaceId: string,
  negocioId: string,
  staffNombre: string | null,
  opciones: OpcionesEmision,
  contexto: { modelo: ModeloDinero | null; recaudado: number; ivaPct?: number; staffId?: string | null },
): Promise<ResultadoEmision> {
  const svc = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negRaw, error: errNeg } = await (svc as any)
    .from('negocios')
    .select('id, precio_aprobado, linea_id, metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (errNeg || !negRaw) return { ok: false, motivo: 'error', mensaje: 'Negocio no encontrado' }
  const negocio = negRaw as DatosNegocio & { linea_id: string | null }

  // ── 1. ¿ONE ya sabe que está facturado? ───────────────────────────────────
  const yaFacturado = (negocio.metadata?.siigo_factura ?? null) as MarcaFactura | null
  if (yaFacturado?.numero) {
    return { ok: false, motivo: 'ya_facturado_en_one', numero: yaFacturado.numero }
  }

  // ── 2. Saldo ──────────────────────────────────────────────────────────────
  // Solo se factura con el honorario cubierto. El faltante se mide contra el
  // HONORARIO, nunca contra honorario + tarifa: quien le paga la tarifa directo
  // a la UPME no le debe nada a SOENA, y medirlo simétrico lo dejaría sin
  // facturar para siempre (ya se midió: 62 casos retenidos, #206).
  const honorario = negocio.precio_aprobado == null ? 0 : Number(negocio.precio_aprobado)
  const { faltante } = descuadreConciliacion(honorario, contexto.modelo, contexto.recaudado)
  if (faltante > TOLERANCIA_SALDO_COP) {
    return { ok: false, motivo: 'saldo_pendiente', faltante }
  }

  // ── 2.bis. Las correcciones de la pantalla ────────────────────────────────
  // Van ANTES de asegurar el tercero, y no después: si el tercero se crea primero,
  // nace con el correo viejo y la factura se le manda ahí mismo. Si esto falla se
  // corta aquí, con la factura todavía sin emitir, que es el único momento en que
  // el error todavía se puede arreglar.
  const correccion = await corregirContactoParaFactura(
    workspaceId, negocioId, opciones.datos ?? {}, ESPERA_429_EMISION_MS,
  )
  if (!correccion.ok) return { ok: false, motivo: 'error', mensaje: correccion.mensaje }

  // ── 3. El cliente tiene que existir (y con él, sus datos completos) ───────
  const cliente = await asegurarClienteSiigo(workspaceId, negocioId, 'manual', ESPERA_429_EMISION_MS)
  if (cliente.estado === 'incompleto') return { ok: false, motivo: 'faltan_datos', faltantes: cliente.faltantes }
  if (cliente.estado === 'error') return { ok: false, motivo: 'error', mensaje: cliente.mensaje }
  const identificacion = cliente.identificacion

  try {
    const cfg = await getSiigoConfig(workspaceId)

    // ── 3.bis. El CONCEPTO que va a leer el cliente ──────────────────────────
    // Se resuelve con el mismo helper que usa la cola. Se hace aquí, contra el
    // estado de AHORA, y no se recibe del cliente: entre que la pantalla pintó
    // la fila y alguien confirma, el servicio contratado pudo corregirse, y la
    // factura tiene que decir lo que el negocio dice hoy.
    const concepto = await resolverConceptoDeNegocio(svc, negocioId, negocio.linea_id, cfg.productoCode)
    // Si la financiera escogió otro producto en la pantalla, ese gana: lo que ONE
    // deduce del servicio contratado es una sugerencia, y hay casos que se facturan
    // bajo otro concepto. Quien llama ya lo validó contra el catálogo de Siigo.
    const productoCode = opciones.datos?.productoCode?.trim() || concepto.code

    // ── 4. ¿Siigo ya tiene una factura de este producto para el cliente? ────
    // Es la barrera que ONE no puede resolver mirándose a sí mismo. Medido el
    // 2026-08-09: 7 casos de la cola ya estaban facturados en Siigo sin que ONE
    // lo supiera, 3 de ellos con precio aprobado, o sea que la cola los mostraba
    // listos para emitir.
    // Se pregunta por el MISMO producto que se va a emitir: con conceptos por
    // servicio, buscar duplicados del producto base dejaría pasar una segunda
    // factura del concepto real.
    const existentes = await facturasDelClienteEnSiigo(workspaceId, identificacion, productoCode, ESPERA_429_EMISION_MS)
    const justificacion = opciones.justificacionDuplicado?.trim()
    if (existentes.length > 0 && !justificacion) {
      return { ok: false, motivo: 'duplicado_en_siigo', existentes }
    }

    // ── 5. Emitir ────────────────────────────────────────────────────────────
    const hoy = new Date().toISOString().slice(0, 10)
    const { payload, faltantes } = borradorFactura(
      cfg, identificacion, honorario, hoy, contexto.ivaPct ?? 19,
      {
        emitir: opciones.emitir,
        enviarCorreo: opciones.enviarCorreo === true,
        productoCode,
      },
    )
    if (faltantes.length > 0) return { ok: false, motivo: 'faltan_datos', faltantes }

    const creada = await siigoRequest<{ id?: string; name?: string; total?: number }>(
      workspaceId, '/v1/invoices',
      {
        method: 'POST',
        body: payload satisfies BorradorFactura,
        // Determinista a partir del negocio: un reintento del MISMO documento no
        // produce una segunda factura. Máximo 30 caracteres (un UUID sin guiones
        // son 32 y no cabe).
        idempotencyKey: claveIdempotencia(negocioId, 'fv'),
        maxEspera429Ms: ESPERA_429_EMISION_MS,
      },
    )

    // ── 6. Archivar el PDF dentro del negocio ────────────────────────────────
    // La factura YA existe y es irreversible: de aquí en adelante nada puede
    // convertir la emisión en un fallo. Lo que salga mal se reporta como
    // pendiente de archivar, no como factura no emitida.
    let cufe: string | null = null
    let archivoUrl: string | null = null
    if (creada.id) {
      const doc = await pdfDeFactura(workspaceId, creada.id)
      cufe = doc?.cufe ?? null
      if (doc && opciones.bloqueFacturaSlug) {
        const nombre = `${(creada.name ?? 'factura').replace(/[^\w.-]+/g, '-')}.pdf`
        const arch = await archivarPdfEnBloque(
          workspaceId, negocioId, opciones.bloqueFacturaSlug, doc.pdf, nombre,
          // El consecutivo lo devolvió Siigo: se guarda para que se vea en el
          // bloque sin que nadie lo copie del PDF.
          { numero_factura: creada.name ?? '' },
        )
        if (arch.ok) archivoUrl = arch.url ?? null
        else console.error('[siigo] factura emitida pero SIN archivar en el negocio:', arch.error)
      }
    }

    const marca: MarcaFactura = {
      numero: creada.name ?? '(sin número)',
      siigo_id: creada.id ?? '',
      total: honorario,
      cufe,
      archivo_url: archivoUrl,
      emitida: opciones.emitir,
      at: new Date().toISOString(),
      por: staffNombre,
      producto_code: productoCode,
      ...(justificacion ? { justificacion_duplicado: justificacion } : {}),
    }

    const metadata = { ...((negocio.metadata ?? {}) as Record<string, unknown>), siigo_factura: marca }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: errUp } = await (svc as any)
      .from('negocios').update({ metadata }).eq('id', negocioId).eq('workspace_id', workspaceId)
    // La factura YA existe en Siigo. Si la marca no se guarda, el caso sigue en la
    // cola y alguien podría re-emitir: por eso el error se dice, no se traga. El
    // guard de duplicados de Siigo lo atajaría, pero eso es la red, no el piso.
    if (errUp) {
      console.error('[siigo] factura emitida pero NO marcada en el negocio:', errUp.message)
    }

    // Si el caso ya estaba ESPERANDO en su etapa de cierre, la factura que acaba de
    // emitirse es justo lo que le faltaba. Nada de lo que pase aqui puede convertir una
    // emision exitosa en un fallo: la factura ya existe en Siigo y es irreversible.
    if (!errUp) {
      try {
        await cerrarNegocioSiQuedaResuelto(svc, workspaceId, negocioId, contexto.staffId ?? null)
      } catch (e) {
        console.error('[siigo] no se pudo evaluar el cierre automatico:', (e as Error).message)
      }
    }

    return {
      ok: true, numero: marca.numero, siigo_id: marca.siigo_id,
      total: honorario, emitida: opciones.emitir,
      archivada: !opciones.bloqueFacturaSlug || archivoUrl != null,
    }
  } catch (e) {
    const mensaje = e instanceof SiigoError ? e.message : (e as Error).message
    return { ok: false, motivo: 'error', mensaje }
  }
}
