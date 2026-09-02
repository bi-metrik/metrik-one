/**
 * Recibo de caja del recaudo de la tarifa UPME.
 *
 * ── Por qué es un recibo y no una factura ───────────────────────────────────
 *
 * La tarifa que el cliente paga para la UPME **no es ingreso de SOENA**: es plata de
 * terceros que SOENA recauda y gira. Contablemente es un pasivo, así que va por recibo
 * de caja tipo `AdvancePayment` y nunca por factura. Facturarla inflaría el ingreso y
 * el P&L — el mismo error que costó $21M en la revisión del 2026-08-11.
 *
 * ── El PDF lo hacemos nosotros ──────────────────────────────────────────────
 *
 * ⚠️ Siigo **NO expone PDF de los recibos de caja**. Reconfirmado contra la API el
 * 2026-08-12 sobre un recibo real (RC-1-43): 404 en `/vouchers/{id}/pdf`, en `/print` y
 * en `/documents/{id}/pdf`. Lo que sí devuelve el GET es todo lo necesario para armarlo:
 * número oficial, fecha, cliente, valor, forma de pago y observación.
 *
 * Por eso el PDF se renderiza en `metrik-pdf-render`, con el consecutivo que asignó
 * Siigo. El cliente recibe una confirmación con número oficial, que es lo que le da
 * respaldo de que su plata quedó registrada.
 *
 * ── Nada de lo que pase después convierte la emisión en un fallo ────────────
 *
 * El recibo ya existe en la contabilidad y consume numeración: si el PDF no se puede
 * renderizar o archivar, eso es un pendiente que se reporta, no un recibo no emitido.
 * Misma regla que la factura.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { siigoRequest, getSiigoConfig, claveIdempotencia, SiigoError, type SiigoConfig } from './client'
import { borradorRecibo, type BorradorRecibo } from './mapeo'
import { asegurarClienteSiigo } from './clientes'
import { archivarPdfEnBloque } from './archivar-documento'
import { renderReciboCaja } from '@/lib/pdf/pdf-render-client'
import { guardarMarcaEnMetadata } from '@/lib/negocios/marca-metadata'

/** Emitir ya viene de dos confirmaciones: aquí sí vale la pena esperar el 429. */
const ESPERA_429_EMISION_MS = 30_000

/** Lo que queda escrito en el negocio cuando el recibo se emite. */
export interface MarcaRecibo {
  numero: string
  siigo_id: string
  valor: number
  archivo_url: string | null
  at: string
  por: string | null
}

export type ResultadoRecibo =
  | { ok: true; numero: string; siigo_id: string; valor: number; archivada: boolean }
  | { ok: false; motivo: 'ya_emitido'; numero: string }
  | { ok: false; motivo: 'sin_valor' }
  | { ok: false; motivo: 'faltan_datos'; faltantes: string[] }
  | { ok: false; motivo: 'duplicado_en_siigo'; existentes: Array<{ numero: string; fecha: string; valor: number }> }
  | { ok: false; motivo: 'error'; mensaje: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

/**
 * ¿Siigo ya tiene un recibo de este cliente por la tarifa?
 *
 * Es la barrera que ONE no puede resolver mirándose a sí mismo: SOENA emitió recibos a
 * mano antes de que esto existiera. Sin la comprobación, un caso ya recaudado saldría
 * con un segundo recibo y numeración consumida dos veces.
 *
 * ⚠️ El histórico de recibos de UPME es RUIDOSO y por eso esto NO bloquea solo:
 * medido el 2026-08-09, de 45 recibos solo 5 eran de UPME y 4 de esos eran el mismo
 * caso duplicado el mismo día con dos comprobantes distintos. Era alguien tanteando, no
 * una práctica. Se muestra y la persona decide.
 */
export async function recibosDelClienteEnSiigo(
  workspaceId: string,
  identificacion: string,
  cfg: SiigoConfig,
  maxEspera429Ms = 0,
): Promise<Array<{ numero: string; fecha: string; valor: number }>> {
  try {
    const r = await siigoRequest<{
      results?: Array<{ name?: string; date?: string; type?: string; payment?: { value?: number }
        customer?: { identification?: string } }>
    }>(
      workspaceId,
      `/v1/vouchers?document_id=${cfg.reciboDocumentId}&page_size=100`,
      { maxEspera429Ms },
    )
    return (r.results ?? [])
      .filter(v => v.customer?.identification === identificacion && v.type === 'AdvancePayment')
      .map(v => ({
        numero: v.name ?? '(sin número)',
        fecha: v.date ?? '',
        valor: Number(v.payment?.value ?? 0),
      }))
  } catch (e) {
    // Que la comprobación falle no puede impedir emitir: se reporta y sigue. Un
    // recibo que no sale por un 500 de la consulta es peor que uno que se revisa.
    console.error('[siigo] no se pudo consultar recibos del cliente:', (e as Error).message)
    return []
  }
}

/**
 * Emite el recibo de caja, renderiza su PDF y lo archiva en el negocio.
 *
 * `valorPagado` llega explícito y no se lee aquí: quien llama ya resolvió si viene del
 * comprobante extraído o lo capturó una persona. **Los casos del cargue masivo no
 * tienen el comprobante** (nacieron antes de que existiera el punto de control), así que
 * la captura manual no es una excepción rara: es el camino frecuente.
 */
export async function emitirReciboNegocio(
  workspaceId: string,
  negocioId: string,
  valorPagado: number,
  staffNombre: string | null,
  opciones: {
    /** Slug del bloque donde queda archivado el PDF. */
    bloqueReciboSlug?: string
    /** Obligatoria si Siigo ya tiene recibos de este cliente. */
    justificacionDuplicado?: string
  } = {},
): Promise<ResultadoRecibo> {
  const svc = createServiceClient()

  const { data: negRaw, error: errNeg } = await db(svc)
    .from('negocios')
    .select('id, codigo, nombre, metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (errNeg || !negRaw) return { ok: false, motivo: 'error', mensaje: 'Negocio no encontrado' }
  const negocio = negRaw as { codigo: string | null; nombre: string; metadata: Record<string, unknown> | null }

  // ── 1. ¿ONE ya sabe que está recaudado? ──
  const yaEmitido = (negocio.metadata?.siigo_recibo ?? null) as MarcaRecibo | null
  if (yaEmitido?.numero) return { ok: false, motivo: 'ya_emitido', numero: yaEmitido.numero }

  // ── 2. Sin valor no hay recibo ──
  // Un recibo de caja en cero no documenta nada y consume numeración.
  if (!Number.isFinite(valorPagado) || valorPagado <= 0) return { ok: false, motivo: 'sin_valor' }

  // ── 3. El cliente tiene que existir en Siigo ──
  const cliente = await asegurarClienteSiigo(workspaceId, negocioId, 'manual', ESPERA_429_EMISION_MS)
  if (cliente.estado === 'incompleto') return { ok: false, motivo: 'faltan_datos', faltantes: cliente.faltantes }
  if (cliente.estado === 'error') return { ok: false, motivo: 'error', mensaje: cliente.mensaje }
  const identificacion = cliente.identificacion

  try {
    const cfg = await getSiigoConfig(workspaceId)

    // ── 4. ¿Siigo ya recaudó esto? ──
    const existentes = await recibosDelClienteEnSiigo(workspaceId, identificacion, cfg, ESPERA_429_EMISION_MS)
    const justificacion = opciones.justificacionDuplicado?.trim()
    if (existentes.length > 0 && !justificacion) {
      return { ok: false, motivo: 'duplicado_en_siigo', existentes }
    }

    // ── 5. Emitir ──
    const hoy = new Date().toISOString().slice(0, 10)
    const { payload, faltantes } = borradorRecibo(cfg, identificacion, valorPagado, hoy)
    if (faltantes.length > 0) return { ok: false, motivo: 'faltan_datos', faltantes }

    const creado = await siigoRequest<{ id?: string; name?: string; number?: number; date?: string }>(
      workspaceId, '/v1/vouchers',
      {
        method: 'POST',
        body: payload satisfies BorradorRecibo,
        // Determinista desde el negocio: un reintento no produce un segundo recibo.
        // Máximo 30 caracteres (un UUID sin guiones son 32 y no cabe).
        idempotencyKey: claveIdempotencia(negocioId, 'rc'),
        maxEspera429Ms: ESPERA_429_EMISION_MS,
      },
    )

    const numero = creado.name ?? '(sin número)'

    // ── 6. El PDF, que Siigo no da ──
    // De aquí en adelante NADA convierte la emisión en un fallo: el recibo ya está
    // asentado y consumió numeración.
    let archivoUrl: string | null = null
    if (opciones.bloqueReciboSlug) {
      try {
        const pdf = await renderReciboCaja('soena', {
          numero,
          fecha: creado.date ?? hoy,
          cliente_nombre: negocio.nombre,
          cliente_identificacion: identificacion,
          negocio_codigo: negocio.codigo ?? '',
          valor: valorPagado,
          concepto: 'Valor recaudado para pago ante la UPME',
        })
        const arch = await archivarPdfEnBloque(
          workspaceId, negocioId, opciones.bloqueReciboSlug, pdf,
          `${numero.replace(/[^\w.-]+/g, '-')}.pdf`,
          // El consecutivo se guarda como campo: se ve en el bloque sin que nadie
          // tenga que abrir el PDF a copiarlo.
          { numero_recibo: numero },
        )
        if (arch.ok) archivoUrl = arch.url ?? null
        else console.error('[siigo] recibo emitido pero SIN archivar en el negocio:', arch.error)
      } catch (e) {
        console.error('[siigo] recibo emitido pero SIN PDF:', (e as Error).message)
      }
    }

    const marca: MarcaRecibo = {
      numero,
      siigo_id: creado.id ?? '',
      valor: valorPagado,
      archivo_url: archivoUrl,
      at: new Date().toISOString(),
      por: staffNombre,
    }

    // ⚠️ Sobre el estado de AHORA, no sobre `negocio.metadata`, que se leyó al
    // empezar: en el medio corrió `asegurarClienteSiigo`, que REESCRIBE
    // `siigo_cliente` cuando la marca vieja no coincide con el RUT. Es el mismo
    // pisado que dañó 12 marcas al facturar. Ver `guardarMarcaEnMetadata`.
    const guardada = await guardarMarcaEnMetadata(
      svc, workspaceId, negocioId, 'siigo_recibo', marca, negocio.metadata,
    )

    // El recibo YA existe en Siigo. Si la marca no se guarda, el caso se veria como no
    // recaudado y alguien podria re-emitir: por eso el error se dice, no se traga.
    if (!guardada.ok) console.error('[siigo] recibo emitido pero NO marcado en el negocio:', guardada.mensaje)

    return {
      ok: true, numero, siigo_id: marca.siigo_id, valor: valorPagado,
      archivada: !opciones.bloqueReciboSlug || archivoUrl != null,
    }
  } catch (e) {
    const mensaje = e instanceof SiigoError ? e.message : (e as Error).message
    return { ok: false, motivo: 'error', mensaje }
  }
}
