/**
 * Recibo de caja: la confirmación de que el cliente le entregó dinero.
 *
 * ── Qué acusa, y por qué no es una factura ──────────────────────────────────
 *
 * Decisión de Mauricio (2026-09-03): **la factura y el recibo son independientes.** La
 * factura se emite por el valor pactado de los honorarios; el recibo confirma la plata
 * que entró. Ninguno depende del otro, y que el negocio ya esté facturado no cambia
 * nada para el recibo.
 *
 * Hasta esa decisión el recibo existía solo para la tarifa UPME (plata de terceros que
 * SOENA recauda y gira, un pasivo, que facturar habría inflado el ingreso: el error de
 * $21M de la revisión del 2026-08-11). El tipo `AdvancePayment` sigue sirviendo para el
 * caso general; lo que dejó de estar cableado es el CONCEPTO, que ahora lo declara la
 * línea.
 *
 * ── Cuelga del COBRO, no del negocio ────────────────────────────────────────
 *
 * La marca vive en `cobros.siigo_recibo` y la idempotencia contra Siigo va por
 * `cobroId`. Antes ambas iban por negocio, y eso hacía que el segundo pago de un mismo
 * negocio devolviera `ya_emitido` y no emitiera nunca. Medido el 2026-09-02: **74 de
 * 306 negocios con cobros ya recibieron más de un pago**, así que ese silencio se
 * habría comido el recibo del 24%.
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
  | { ok: false; motivo: 'anulado' }
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
 *
 * ⚠️ **Se filtra por VALOR, y ese filtro es nuevo (2026-09-03).** Desde que el recibo
 * cuelga del cobro, que un cliente tenga varios recibos es lo NORMAL, no la señal de
 * un duplicado: sin el filtro, todo cliente con dos pagos quedaría trabado pidiendo
 * justificación a partir del segundo. La señal de duplicado real es otro recibo por el
 * MISMO valor. La garantía dura contra la doble emisión del mismo cobro no es esta
 * consulta: es `claveIdempotencia(cobroId, 'rc')`, que hace que un reintento devuelva
 * el recibo que ya existe en vez de crear otro.
 */
export async function recibosDelClienteEnSiigo(
  workspaceId: string,
  identificacion: string,
  cfg: SiigoConfig,
  maxEspera429Ms = 0,
  valor?: number,
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
      .filter(v => valor == null || Math.round(v.valor) === Math.round(valor))
  } catch (e) {
    // Que la comprobación falle no puede impedir emitir: se reporta y sigue. Un
    // recibo que no sale por un 500 de la consulta es peor que uno que se revisa.
    console.error('[siigo] no se pudo consultar recibos del cliente:', (e as Error).message)
    return []
  }
}

/**
 * Emite el recibo de caja de UN COBRO, renderiza su PDF, lo archiva y avisa al cliente.
 *
 * El valor sale del cobro. `valorPagado` lo pisa solo cuando quien emite desde Tesorería
 * lo corrige a mano, que sigue siendo un camino válido: **los casos del cargue masivo no
 * tienen comprobante** (nacieron antes de que existiera ese punto de control), así que la
 * captura manual no es una excepción rara.
 */
export async function emitirReciboDeCobro(
  workspaceId: string,
  cobroId: string,
  staffNombre: string | null,
  opciones: {
    /** Slug del bloque donde queda archivado el PDF. */
    bloqueReciboSlug?: string
    /** Texto del documento. Lo declara la línea; sin él no se emite. */
    concepto?: string
    /** Obligatoria si Siigo ya tiene un recibo de este cliente por el mismo valor. */
    justificacionDuplicado?: string
    /** Pisa el monto del cobro. Solo desde Tesorería, con el soporte a la vista. */
    valorPagado?: number
    /** Pedir el aviso al cliente después de archivar. */
    avisarAlCliente?: boolean
  } = {},
): Promise<ResultadoRecibo> {
  const svc = createServiceClient()

  // ── 0. El cobro, que es de donde cuelga todo ──
  const { data: cobroRaw, error: errCobro } = await db(svc)
    .from('cobros')
    .select('id, negocio_id, monto, siigo_recibo, anulado_at')
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)
    .single()

  if (errCobro || !cobroRaw) return { ok: false, motivo: 'error', mensaje: 'Cobro no encontrado' }
  const cobro = cobroRaw as {
    negocio_id: string | null
    monto: number | null
    siigo_recibo: MarcaRecibo | null
    anulado_at: string | null
  }

  if (!cobro.negocio_id) return { ok: false, motivo: 'error', mensaje: 'El cobro no está atado a un negocio' }
  const negocioId = cobro.negocio_id

  // ── 1. ¿Este COBRO ya tiene recibo? ──
  // La marca por cobro es lo que reemplazó a `negocios.metadata.siigo_recibo`: con la
  // marca por negocio, el segundo pago de un mismo caso nunca habría emitido.
  if (cobro.siigo_recibo?.numero) return { ok: false, motivo: 'ya_emitido', numero: cobro.siigo_recibo.numero }

  // Un cobro anulado no documenta plata recibida: emitir por él consumiría numeración
  // para acusar algo que se deshizo.
  if (cobro.anulado_at) return { ok: false, motivo: 'anulado' }

  // ── 2. Sin valor no hay recibo ──
  // Un recibo de caja en cero no documenta nada y consume numeración.
  const valorPagado = opciones.valorPagado ?? Number(cobro.monto ?? 0)
  if (!Number.isFinite(valorPagado) || valorPagado <= 0) return { ok: false, motivo: 'sin_valor' }

  // El concepto lo declara la línea. Sin él no se emite: un documento contable que no
  // se puede corregir no sale con un texto por defecto inventado aquí.
  const concepto = opciones.concepto?.trim()
  if (!concepto) return { ok: false, motivo: 'faltan_datos', faltantes: ['concepto del recibo (config de la línea)'] }

  const { data: negRaw, error: errNeg } = await db(svc)
    .from('negocios')
    .select('id, codigo, nombre')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (errNeg || !negRaw) return { ok: false, motivo: 'error', mensaje: 'Negocio no encontrado' }
  const negocio = negRaw as { codigo: string | null; nombre: string }

  // ── 3. El cliente tiene que existir en Siigo ──
  const cliente = await asegurarClienteSiigo(workspaceId, negocioId, 'manual', ESPERA_429_EMISION_MS)
  if (cliente.estado === 'incompleto') return { ok: false, motivo: 'faltan_datos', faltantes: cliente.faltantes }
  if (cliente.estado === 'error') return { ok: false, motivo: 'error', mensaje: cliente.mensaje }
  const identificacion = cliente.identificacion

  try {
    const cfg = await getSiigoConfig(workspaceId)

    // ── 4. ¿Siigo ya recaudó ESTE MISMO VALOR de este cliente? ──
    const existentes = await recibosDelClienteEnSiigo(
      workspaceId, identificacion, cfg, ESPERA_429_EMISION_MS, valorPagado,
    )
    const justificacion = opciones.justificacionDuplicado?.trim()
    if (existentes.length > 0 && !justificacion) {
      return { ok: false, motivo: 'duplicado_en_siigo', existentes }
    }

    // ── 5. Emitir ──
    const hoy = new Date().toISOString().slice(0, 10)
    const { payload, faltantes } = borradorRecibo(cfg, identificacion, valorPagado, hoy, concepto)
    if (faltantes.length > 0) return { ok: false, motivo: 'faltan_datos', faltantes }

    const creado = await siigoRequest<{ id?: string; name?: string; number?: number; date?: string }>(
      workspaceId, '/v1/vouchers',
      {
        method: 'POST',
        body: payload satisfies BorradorRecibo,
        // Determinista desde el COBRO: un reintento no produce un segundo recibo, y dos
        // cobros del mismo negocio no chocan entre sí (con la clave por negocio, el
        // segundo recibo habría recibido de vuelta el primero).
        idempotencyKey: claveIdempotencia(cobroId, 'rc'),
        maxEspera429Ms: ESPERA_429_EMISION_MS,
      },
    )

    const numero = creado.name ?? '(sin número)'

    // ── 6. El PDF, que Siigo no da ──
    // De aquí en adelante NADA convierte la emisión en un fallo: el recibo ya está
    // asentado y consumió numeración.
    let archivoUrl: string | null = null
    let bloqueConfigId: string | null = null
    if (opciones.bloqueReciboSlug) {
      try {
        const pdf = await renderReciboCaja('soena', {
          numero,
          fecha: creado.date ?? hoy,
          cliente_nombre: negocio.nombre,
          cliente_identificacion: identificacion,
          negocio_codigo: negocio.codigo ?? '',
          valor: valorPagado,
          concepto,
        })
        const arch = await archivarPdfEnBloque(
          workspaceId, negocioId, opciones.bloqueReciboSlug, pdf,
          `${numero.replace(/[^\w.-]+/g, '-')}.pdf`,
          // El consecutivo se guarda como campo: se ve en el bloque sin que nadie
          // tenga que abrir el PDF a copiarlo.
          { numero_recibo: numero },
          // Y se acumula en la lista, porque el siguiente pago traerá otro recibo y
          // `drive_url` solo puede apuntar al último.
          { clave: 'recibos', entrada: { numero, valor: valorPagado, cobro_id: cobroId, at: new Date().toISOString() } },
        )
        bloqueConfigId = arch.bloqueConfigId ?? null
        if (arch.ok) archivoUrl = arch.url ?? null
        else console.error('[siigo] recibo emitido pero SIN archivar en el negocio:', arch.error)
      } catch (e) {
        console.error('[siigo] recibo emitido pero SIN PDF:', (e as Error).message)
      }
    }

    // ── 7. La marca, en el COBRO ──
    const marca: MarcaRecibo = {
      numero,
      siigo_id: creado.id ?? '',
      valor: valorPagado,
      archivo_url: archivoUrl,
      at: new Date().toISOString(),
      por: staffNombre,
    }

    const { error: errUp } = await db(svc)
      .from('cobros').update({ siigo_recibo: marca }).eq('id', cobroId).eq('workspace_id', workspaceId)

    // El recibo YA existe en Siigo. Si la marca no se guarda, el cobro se vería como no
    // recaudado y alguien podría re-emitir: por eso el error se dice, no se traga.
    if (errUp) console.error('[siigo] recibo emitido pero NO marcado en el cobro:', errUp.message)

    // ── 8. El aviso al cliente ──
    // Se pide EXPLÍCITAMENTE y no por el trigger: `trg_avisar_documento_cargado` exige
    // `auth.uid()`, y esto corre con el service role. Aflojar esa guarda para ganar el
    // aviso habría reabierto el envío masivo que impidió el accidente de V0412.
    if (opciones.avisarAlCliente && archivoUrl && bloqueConfigId) {
      const { error: errAviso } = await db(svc).rpc('avisar_documento_al_cliente', {
        p_negocio_id: negocioId,
        p_bloque_config_id: bloqueConfigId,
      })
      if (errAviso) console.error('[siigo] recibo archivado pero SIN avisar al cliente:', errAviso.message)
    }

    return {
      ok: true, numero, siigo_id: marca.siigo_id, valor: valorPagado,
      archivada: !opciones.bloqueReciboSlug || archivoUrl != null,
    }
  } catch (e) {
    const mensaje = e instanceof SiigoError ? e.message : (e as Error).message
    return { ok: false, motivo: 'error', mensaje }
  }
}
