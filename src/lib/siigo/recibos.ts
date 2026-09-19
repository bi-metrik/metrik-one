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
import { borradorRecibo, SUCURSAL_POR_DEFECTO, type BorradorRecibo } from './mapeo'
import { asegurarClienteSiigo } from './clientes'
import { archivarPdfEnBloque } from './archivar-documento'
import { renderReciboCaja } from '@/lib/pdf/pdf-render-client'
import {
  componentesEmitidos,
  hayReciboPorElTotal,
  planDeEmision,
  primerRecibo,
  recibosDelCobro,
  repartoDeCobro,
  tieneRecibo,
  type ComponenteAEmitir,
  type ConfigReciboPorConcepto,
  type FilaReparto,
  type MarcaRecibo,
} from './recibo-componentes'

/** Emitir ya viene de dos confirmaciones: aquí sí vale la pena esperar el 429. */
const ESPERA_429_EMISION_MS = 30_000

const hoyISO = () => new Date().toISOString().slice(0, 10)

/**
 * ¿Siigo rechazó esto porque el periodo contable está cerrado?
 *
 * Se reconoce por el TEXTO porque Siigo no da un código estable para esto: el `Code`
 * que acompaña estos rechazos es el genérico de validación, el mismo de un NIT malo o
 * un valor inválido. Por eso el reconocimiento es deliberadamente estrecho: exige que
 * el mensaje hable a la vez de la fecha y del periodo. Un falso positivo aquí no es
 * cosmético, emitiría un recibo con otra fecha por un problema que era otro.
 */
function esPeriodoCerrado(e: unknown): boolean {
  if (!(e instanceof SiigoError)) return false
  const m = e.message.toLowerCase()
  const hablaDeFecha = m.includes('date') || m.includes('fecha')
  const hablaDePeriodo =
    m.includes('period') || m.includes('periodo') || m.includes('período') ||
    m.includes('closed') || m.includes('cerrado')
  return hablaDeFecha && hablaDePeriodo
}

/**
 * Lo que queda escrito en el cobro cuando el recibo se emite.
 *
 * La definición vive en `./recibo-componentes` (módulo puro, que también lo importa el
 * navegador) y se re-exporta aquí porque este archivo era su casa histórica.
 */
export type { MarcaRecibo }

export type ResultadoRecibo =
  | {
      ok: true
      /** El primero emitido. Se conserva para los llamadores de una sola cifra. */
      numero: string
      siigo_id: string
      /** Suma de lo emitido: con un solo componente es el valor de siempre. */
      valor: number
      archivada: boolean
      /** Todos los recibos que esta llamada emitió, en orden de imputación. */
      recibos: Array<{ numero: string; siigo_id: string; valor: number }>
    }
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
  /**
   * Tipo de comprobante contra el que se pregunta. Sin él, el de la configuración.
   *
   * Con recibo por concepto cada componente sale con SU comprobante, así que preguntar
   * siempre por el de la configuración buscaría el duplicado en el cajón equivocado.
   */
  documentId?: number,
): Promise<Array<{ numero: string; fecha: string; valor: number }>> {
  try {
    const r = await siigoRequest<{
      results?: Array<{ name?: string; date?: string; type?: string; payment?: { value?: number }
        customer?: { identification?: string } }>
    }>(
      workspaceId,
      `/v1/vouchers?document_id=${documentId ?? cfg.reciboDocumentId}&page_size=100`,
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
 *
 * ── Uno por el total, o uno por concepto ───────────────────────────────────
 *
 * Si la línea declara `recibo_por_concepto` (opción `porConcepto`), se emite **un recibo
 * por cada componente con valor mayor a cero**: el honorario con su comprobante y la
 * plata de terceros con el suyo. Sin esa declaración, el camino es exactamente el de
 * siempre — un recibo por el total, con `reciboDocumentId`, y la marca como objeto.
 * Ver `./recibo-componentes` para por qué la compatibilidad importa.
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
    /** `lineas_negocio.config_extra.siigo.recibo_por_concepto`. Ausente = como hoy. */
    porConcepto?: ConfigReciboPorConcepto | null
  } = {},
): Promise<ResultadoRecibo> {
  const svc = createServiceClient()
  const porConcepto = opciones.porConcepto ?? null

  // ── 0. El cobro, que es de donde cuelga todo ──
  const { data: cobroRaw, error: errCobro } = await db(svc)
    .from('cobros')
    .select('id, negocio_id, monto, fecha, tipo_cobro, siigo_recibo, anulado_at')
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)
    .single()

  if (errCobro || !cobroRaw) return { ok: false, motivo: 'error', mensaje: 'Cobro no encontrado' }
  const cobro = cobroRaw as {
    negocio_id: string | null
    monto: number | null
    fecha: string | null
    tipo_cobro: string | null
    siigo_recibo: unknown
    anulado_at: string | null
  }

  if (!cobro.negocio_id) return { ok: false, motivo: 'error', mensaje: 'El cobro no está atado a un negocio' }
  const negocioId = cobro.negocio_id

  // ── 1. ¿Este COBRO ya tiene recibo? ──
  // La marca por cobro es lo que reemplazó a `negocios.metadata.siigo_recibo`: con la
  // marca por negocio, el segundo pago de un mismo caso nunca habría emitido.
  //
  // Sin componentes declarados basta con que exista uno, que es el criterio de siempre.
  // Con componentes, una marca por el TOTAL también cubre el cobro entero: no se sabe
  // qué concepto acusa, y re-emitir consume numeración que no se deshace.
  const yaCubierto = porConcepto
    ? hayReciboPorElTotal(cobro.siigo_recibo)
    : tieneRecibo(cobro.siigo_recibo)
  if (yaCubierto) {
    return { ok: false, motivo: 'ya_emitido', numero: primerRecibo(cobro.siigo_recibo)?.numero ?? '' }
  }

  // Un cobro anulado no documenta plata recibida: emitir por él consumiría numeración
  // para acusar algo que se deshizo.
  if (cobro.anulado_at) return { ok: false, motivo: 'anulado' }

  // ── 2. Sin valor no hay recibo ──
  // Un recibo de caja en cero no documenta nada y consume numeración.
  const valorPagado = opciones.valorPagado ?? Number(cobro.monto ?? 0)
  if (!Number.isFinite(valorPagado) || valorPagado <= 0) return { ok: false, motivo: 'sin_valor' }

  // ── 2b. Qué recibos hay que emitir ──
  const plan = await planParaEsteCobro(svc, workspaceId, cobroId, cobro, valorPagado, opciones, porConcepto)
  if (!plan.ok) return plan.error
  const componentes = plan.componentes
  if (componentes.length === 0) {
    // Todos los componentes ya tienen su recibo: es la idempotencia, no un fallo.
    return { ok: false, motivo: 'ya_emitido', numero: primerRecibo(cobro.siigo_recibo)?.numero ?? '' }
  }

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
  // ⚠️ En el PDF va el nombre del TERCERO, no el del negocio.
  //
  // `negocios.nombre` en SOENA trae el vehículo pegado ("JORGE ANDRES SUESCUN CHACON -
  // DEEPAL S05 MAX"), y eso salió impreso en RC-1-67 como si fuera la razón social. El
  // nombre del tercero se arma del RUT y es el mismo que quedó en el asiento contable.
  // Si no se pudo releer el RUT se cae al del negocio, que es peor pero no vacío.
  const nombreParaDocumento = cliente.nombre ?? negocio.nombre

  // ── La fecha es la del COBRO, no la de hoy ──
  // Decisión de Mauricio (2026-09-07). El recibo acusa plata que YA entró: fecharlo
  // hoy diría que entró hoy. Medido el 2026-09-04 sobre los 48 pagos sin recibo y sin
  // facturar, el más viejo era del 17 de febrero: con la fecha de emisión, ese cliente
  // habría recibido un "recibimos tu pago" siete meses tarde y Siigo habría registrado
  // en septiembre plata de febrero.
  const fechaPago = cobro.fecha ?? hoyISO()

  // Siigo resuelve el tercero por identificación MÁS sucursal: un cliente que vive
  // en la sucursal 1 no existe si se le pregunta por la 0, y responde
  // `The customer doesn't exist`, que suena a otra cosa. Sin dato conocido va la
  // principal, igual que siempre. Se resuelve UNA vez porque el reintento por
  // periodo cerrado vuelve a armar el borrador: dos copias se desincronizarían y
  // el reintento perdería la sucursal justo en los casos más viejos.
  const sucursalDelCliente = cliente.branch_office ?? SUCURSAL_POR_DEFECTO

  const emitidos: Array<{ numero: string; siigo_id: string; valor: number }> = []
  /** Bloque donde quedó el PRIMER PDF: es el que enlaza el aviso al cliente. */
  let bloqueDelAviso: string | null = null
  let algunPdfArchivado = false
  let todosLosPdfArchivados = true

  try {
    const cfg = await getSiigoConfig(workspaceId)

    // ── 4. ¿Siigo ya recaudó ESTE MISMO VALOR de este cliente? ──
    // Se pregunta por TODOS los componentes antes de emitir el primero: descubrir el
    // duplicado a mitad del bucle dejaría un recibo emitido y el otro no, por una
    // comprobación que se podía hacer antes.
    const existentes: Array<{ numero: string; fecha: string; valor: number }> = []
    for (const comp of componentes) {
      existentes.push(...await recibosDelClienteEnSiigo(
        workspaceId, identificacion, cfg, ESPERA_429_EMISION_MS, comp.valor, comp.documentId,
      ))
    }
    const justificacion = opciones.justificacionDuplicado?.trim()
    if (existentes.length > 0 && !justificacion) {
      return { ok: false, motivo: 'duplicado_en_siigo', existentes }
    }

    // ── 5. Emitir, un recibo por componente ──
    for (const comp of componentes) {
      let fechaRecibo = fechaPago
      let motivoFechaDistinta: string | null = null

      const armar = (fecha: string) => borradorRecibo(
        cfg, identificacion, comp.valor, fecha, comp.concepto, sucursalDelCliente, comp.documentId,
      )

      const { payload, faltantes } = armar(fechaRecibo)
      // Solo puede frenar ANTES del primer POST: un faltante estructural es el mismo
      // para todos los componentes, así que si el primero pasó, el segundo también.
      if (faltantes.length > 0) return { ok: false, motivo: 'faltan_datos', faltantes }

      // Determinista desde el COBRO **y el componente**: un reintento no produce un
      // segundo recibo, dos cobros del mismo negocio no chocan entre sí, y los dos
      // componentes de un mismo cobro tampoco (con una clave sola, el segundo POST
      // habría recibido de vuelta el recibo del primero).
      const clave = claveIdempotencia(cobroId, comp.sufijoIdempotencia)
      const emitir = (cuerpo: BorradorRecibo) =>
        siigoRequest<{ id?: string; name?: string; number?: number; date?: string }>(
          workspaceId, '/v1/vouchers',
          { method: 'POST', body: cuerpo, idempotencyKey: clave, maxEspera429Ms: ESPERA_429_EMISION_MS },
        )

      let creado: { id?: string; name?: string; number?: number; date?: string }
      try {
        creado = await emitir(payload)
      } catch (e) {
        // ⚠️ El ÚNICO rechazo que se reintenta es el del periodo contable cerrado.
        //
        // Un pago de febrero no se puede asentar en un mes que ya se cerró, y eso no es
        // un defecto de Siigo: es contabilidad. La alternativa era dejar 20 pagos viejos
        // ($8.1M, medido el 2026-09-07) sin recibo para siempre.
        //
        // Se reintenta con la fecha de HOY y el PDF sigue mostrando la del pago, así que
        // el cliente ve su fecha real y el documento queda en un periodo que la admite.
        // Cualquier otro error se propaga: tratarlos todos como periodo cerrado
        // convertiría un dato malo en un recibo con fecha cambiada y sin nadie mirando.
        if (!esPeriodoCerrado(e)) throw e

        motivoFechaDistinta = `Siigo rechazó la fecha del pago (${fechaPago}) por periodo contable cerrado`
        fechaRecibo = hoyISO()
        creado = await emitir(armar(fechaRecibo).payload)
      }

      const numero = creado.name ?? '(sin número)'

      // ── 6. El PDF, que Siigo no da ──
      // De aquí en adelante NADA convierte la emisión en un fallo: el recibo ya está
      // asentado y consumió numeración.
      let archivoUrl: string | null = null
      let driveFileId: string | null = null
      let bloqueConfigId: string | null = null
      if (comp.bloqueSlug) {
        try {
          const pdf = await renderReciboCaja('soena', {
            numero,
            fecha: creado.date ?? fechaRecibo,
            fecha_pago: fechaPago,
            cliente_nombre: nombreParaDocumento,
            cliente_identificacion: identificacion,
            negocio_codigo: negocio.codigo ?? '',
            valor: comp.valor,
            concepto: comp.concepto,
          })
          const arch = await archivarPdfEnBloque(
            workspaceId, negocioId, comp.bloqueSlug, pdf,
            `${numero.replace(/[^\w.-]+/g, '-')}.pdf`,
            // El consecutivo se guarda como campo: se ve en el bloque sin que nadie
            // tenga que abrir el PDF a copiarlo.
            { numero_recibo: numero },
            // Y se acumula en la lista, porque el siguiente pago traerá otro recibo y
            // `drive_url` solo puede apuntar al último. Con recibo por concepto, además,
            // la entrada dice de cuál de los dos es.
            {
              clave: 'recibos',
              entrada: {
                numero,
                valor: comp.valor,
                cobro_id: cobroId,
                at: new Date().toISOString(),
                ...(comp.componente ? { componente: comp.componente } : {}),
              },
            },
            'emitido_en_siigo',
            // ⚠️ El PDF NACE CERRADO en Drive. Un recibo de caja lo lee el equipo con
            // sesión (la ficha del negocio y el control de recibos de /conciliación), no
            // un cliente sin cuenta de Google: abrirlo a cualquiera con el enlace no
            // compraba nada y el permiso no vencía nunca. Se abre por
            // `/api/archivos/cobro`, que baja los bytes con la cuenta de servicio.
            false,
          )
          bloqueConfigId = arch.bloqueConfigId ?? null
          if (arch.ok) {
            archivoUrl = arch.url ?? null
            driveFileId = arch.driveFileId ?? null
          } else console.error('[siigo] recibo emitido pero SIN archivar en el negocio:', arch.error)
        } catch (e) {
          console.error('[siigo] recibo emitido pero SIN PDF:', (e as Error).message)
        }
        if (archivoUrl) {
          algunPdfArchivado = true
          if (!bloqueDelAviso && bloqueConfigId) bloqueDelAviso = bloqueConfigId
        } else {
          todosLosPdfArchivados = false
        }
      }

      // ── 7. La marca, en el COBRO ──
      const marca: MarcaRecibo = {
        numero,
        siigo_id: creado.id ?? '',
        valor: comp.valor,
        archivo_url: archivoUrl,
        drive_file_id: driveFileId,
        at: new Date().toISOString(),
        por: staffNombre,
        fecha: creado.date ?? fechaRecibo,
        fecha_pago: fechaPago,
        fecha_motivo: motivoFechaDistinta,
        ...(comp.componente ? { componente: comp.componente } : {}),
      }

      // Se guarda DESPUÉS DE CADA componente, no al final: el recibo ya consumió
      // numeración, y si el siguiente falla su marca tiene que quedar o el reintento
      // lo emitiría otra vez.
      await guardarMarca(svc, workspaceId, cobroId, marca, porConcepto != null)

      emitidos.push({ numero, siigo_id: marca.siigo_id, valor: comp.valor })
    }

    // ── 8. El aviso al cliente: UNO solo, después de TODOS los componentes ──
    //
    // Decisión de Mauricio (2026-09-19). El cliente hizo UN pago y espera UNA
    // confirmación: dos correos por el mismo pago se leen como un cobro doble. Por eso
    // el aviso vive fuera del bucle — si un componente falla, la excepción sale antes
    // de llegar aquí y el correo no se manda a medias; el cobro queda pendiente en el
    // panel y el aviso espera al reintento.
    //
    // ⚠️ El aviso nombra el documento de UN bloque (`avisar_documento_al_cliente` se
    // identifica por `bloque_config_id`). Que el correo liste los dos números con su
    // valor depende de la plantilla de `notificar-etapa`, que este frente no toca.
    //
    // Se pide EXPLÍCITAMENTE y no por el trigger: `trg_avisar_documento_cargado` exige
    // `auth.uid()`, y esto corre con el service role. Aflojar esa guarda para ganar el
    // aviso habría reabierto el envío masivo que impidió el accidente de V0412.
    if (opciones.avisarAlCliente && algunPdfArchivado && bloqueDelAviso) {
      const { error: errAviso } = await db(svc).rpc('avisar_documento_al_cliente', {
        p_negocio_id: negocioId,
        p_bloque_config_id: bloqueDelAviso,
      })
      if (errAviso) console.error('[siigo] recibo archivado pero SIN avisar al cliente:', errAviso.message)
    }

    const sinBloque = componentes.every(c => !c.bloqueSlug)
    return {
      ok: true,
      numero: emitidos[0].numero,
      siigo_id: emitidos[0].siigo_id,
      valor: emitidos.reduce((s, r) => s + r.valor, 0),
      archivada: sinBloque || todosLosPdfArchivados,
      recibos: emitidos,
    }
  } catch (e) {
    const mensaje = e instanceof SiigoError ? e.message : (e as Error).message
    return { ok: false, motivo: 'error', mensaje }
  }
}

/**
 * Guarda la marca de un recibo en el cobro.
 *
 * **Con componentes se ACUMULA en lista; sin ellos se escribe el objeto de siempre.**
 * La asimetría es deliberada: `mis_cobros_de_servicio` (el módulo Valida API, en otro
 * workspace) lee la marca con `siigo_recibo ->> 'numero'`, que sobre una lista devuelve
 * NULL **sin dar error**. Una línea que no declara `recibo_por_concepto` no cambia de
 * forma, ni siquiera de almacenamiento.
 *
 * En el camino de lista se RELEE justo antes de escribir, que es lo mismo que hace
 * `guardarMarcaEnMetadata`: entre el inicio de la emisión y este punto pudo entrar otra
 * marca (un recibo cargado a mano, el otro componente de un reintento en paralelo), y
 * construir la lista sobre la lectura vieja la borraría.
 */
async function guardarMarca(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  cobroId: string,
  marca: MarcaRecibo,
  comoLista: boolean,
): Promise<void> {
  let valor: unknown = marca

  if (comoLista) {
    const { data, error: errLeer } = await db(svc)
      .from('cobros').select('siigo_recibo').eq('id', cobroId).eq('workspace_id', workspaceId).single()
    if (errLeer) {
      console.error(
        '[siigo] no se pudo releer el cobro antes de guardar la marca; ' +
        `se escribe sobre lo que se leyó al empezar: ${errLeer.message}`,
      )
    }
    const previas = recibosDelCobro((data as { siigo_recibo?: unknown } | null)?.siigo_recibo)
      // Un reintento del MISMO componente reemplaza su marca en vez de duplicarla.
      .filter(m => !(marca.componente && m.componente === marca.componente))
    valor = [...previas, marca]
  }

  const { error: errUp } = await db(svc)
    .from('cobros').update({ siigo_recibo: valor }).eq('id', cobroId).eq('workspace_id', workspaceId)

  // El recibo YA existe en Siigo. Si la marca no se guarda, el cobro se vería como no
  // recaudado y alguien podría re-emitir: por eso el error se dice, no se traga.
  if (errUp) console.error('[siigo] recibo emitido pero NO marcado en el cobro:', errUp.message)
}

/**
 * Qué recibos hay que emitir para este cobro.
 *
 * Sin `recibo_por_concepto` es uno solo por el total, con el comprobante y el concepto
 * de siempre, y **no se consulta el reparto**: una línea que no declara componentes no
 * puede quedarse sin emitir porque `v_cobro_valor` no tenga fila para ese cobro.
 */
async function planParaEsteCobro(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  cobroId: string,
  cobro: { monto: number | null; tipo_cobro: string | null; siigo_recibo: unknown },
  valorPagado: number,
  opciones: { concepto?: string; bloqueReciboSlug?: string; valorPagado?: number },
  porConcepto: ConfigReciboPorConcepto | null,
): Promise<{ ok: true; componentes: ComponenteAEmitir[] } | { ok: false; error: ResultadoRecibo }> {
  if (!porConcepto) {
    // El concepto lo declara la línea. Sin él no se emite: un documento contable que no
    // se puede corregir no sale con un texto por defecto inventado aquí.
    const concepto = opciones.concepto?.trim()
    if (!concepto) {
      return {
        ok: false,
        error: { ok: false, motivo: 'faltan_datos', faltantes: ['concepto del recibo (config de la línea)'] },
      }
    }
    return {
      ok: true,
      componentes: [{
        // Sin `componente`: la marca no dice a qué concepto corresponde porque acusa el
        // total, que es exactamente lo que significa su ausencia.
        componente: undefined,
        valor: valorPagado,
        // Sin `documentId`: `borradorRecibo` cae al `reciboDocumentId` del workspace.
        documentId: undefined,
        concepto,
        bloqueSlug: opciones.bloqueReciboSlug,
        // El sufijo de siempre. Cambiarlo haría que un reintento emitiera de nuevo.
        sufijoIdempotencia: 'rc',
      }],
    }
  }

  // ⚠️ El valor corregido a mano NO se reparte a ojo.
  //
  // El reparto sale de `v_cobro_valor`, que parte el MONTO DEL COBRO. Si quien emite
  // escribe otra cifra, no hay forma de saber cuánto de esa diferencia es honorario y
  // cuánto es de terceros — y repartirla en proporción sería inventar la respuesta,
  // justo el error que este frente cierra. Se corrige el monto del pago y se reintenta.
  const montoDelCobro = Number(cobro.monto ?? 0)
  if (opciones.valorPagado != null && Math.abs(opciones.valorPagado - montoDelCobro) > 0.01) {
    return {
      ok: false,
      error: {
        ok: false,
        motivo: 'faltan_datos',
        faltantes: ['el valor corregido no se puede repartir por concepto: corrige el monto del pago'],
      },
    }
  }

  const { data: filaRaw } = await db(svc)
    .from('v_cobro_valor')
    .select('a_tramo1, a_tramo2, a_tarifa, excedente')
    .eq('cobro_id', cobroId)
    .maybeSingle()

  const reparto = repartoDeCobro(filaRaw as FilaReparto | null, {
    monto: valorPagado,
    tipo_cobro: cobro.tipo_cobro,
  })
  if (!reparto) {
    return {
      ok: false,
      error: {
        ok: false,
        motivo: 'faltan_datos',
        faltantes: ['el reparto del cobro (v_cobro_valor no tiene fila para este pago)'],
      },
    }
  }

  const plan = planDeEmision(reparto, porConcepto, opciones.bloqueReciboSlug)
  if (!plan.ok) return { ok: false, error: { ok: false, motivo: 'faltan_datos', faltantes: plan.faltantes } }

  // Lo que ya tiene recibo no se vuelve a emitir: es lo que hace que un reintento tras
  // un fallo parcial complete el cobro en vez de duplicar el componente que sí salió.
  const emitidos = componentesEmitidos(cobro.siigo_recibo)
  return { ok: true, componentes: plan.componentes.filter(c => !emitidos.has(c.componente!)) }
}
