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
 * ── El honorario puede ser un ABONO a la factura (2026-09-22) ──────────────
 *
 * Desde que la factura sale sin esperar el recaudo, la porción honorario de un pago ya no
 * puede quedar como anticipo suelto: la factura a crédito crea una cuenta por cobrar, y el
 * pago la tiene que cerrar. Si la línea declara `recibo_por_concepto.honorario.tipo =
 * 'abono'`, esa porción sale como `DebtPayment` contra la factura del negocio, topada en el
 * saldo que Siigo le reporta a la factura. Sin factura todavía, no se emite nada por el
 * honorario: se abona el día que se facture (`abonos-factura.ts`). La regla y sus casos
 * viven en `./abono`.
 *
 * Desde el brief del 2026-09-22 («Tesorería solo emite recibos de la tarifa UPME») el
 * abono es AUTOMÁTICO e invisible: sale solo por `abonos-factura.ts`, no genera PDF ni
 * aviso al cliente, y Tesorería ya no puede pedirlo (su botón emite `['pasante']`).
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
import {
  borradorAbono,
  borradorRecibo,
  SUCURSAL_POR_DEFECTO,
  type BorradorAbono,
  type BorradorRecibo,
} from './mapeo'
import { asegurarClienteSiigo } from './clientes'
import { archivarPdfEnBloque } from './archivar-documento'
import { renderReciboCaja } from '@/lib/pdf/pdf-render-client'
import { leerFacturaDeUnNegocio } from '@/lib/facturacion/leer-factura-del-negocio'
import {
  componentesEmitidos,
  conEntradaDeComponente,
  hayReciboPorElTotal,
  planDeEmision,
  primerRecibo,
  recibosDelCobro,
  repartoDeCobro,
  tieneRecibo,
  type ComponenteAEmitir,
  type ComponenteRecibo,
  type ConfigReciboPorConcepto,
  type FilaReparto,
  type MarcaAbonoAMano,
  type MarcaRecibo,
} from './recibo-componentes'
import {
  decidirAbono,
  detalleDuplicado,
  detalleSinRevisar,
  redondearCentavos,
  retencionDelCobro,
  revisarAbonosExistentes,
  type AbonoExistente,
  type FacturaSiigoLeida,
  type MotivoAbonoAMano,
  type Vencimiento,
  type VoucherSiigoLeido,
} from './abono'

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
 * ¿Siigo rechazó el documento por sus DATOS (4xx), y no por credenciales, por el límite
 * de peticiones o por estar caído?
 *
 * Solo lo usa el abono con un pago anterior a la factura: ahí se reintenta con la fecha
 * de la factura. No se reconoce por el texto —no se ha visto nunca el mensaje con el que
 * Siigo rechazaría esa fecha, porque ninguno de los 8 abonos hechos a mano en SOENA la
 * tiene (medido el 2026-09-22)— sino por lo único que cambia entre los dos intentos: la
 * fecha. Si el segundo pasa, la fecha era la causa; si falla, se reporta ese error y no
 * se inventa otra cosa. Un intento fallido no crea documento, así que reintentar con la
 * misma clave de idempotencia no duplica nada (doc de Siigo: la clave devuelve el
 * comprobante SI ya se creó).
 */
function esRechazoDeDatos(e: unknown): boolean {
  return e instanceof SiigoError && e.status >= 400 && e.status < 500
    && e.status !== 401 && e.status !== 429
}

/** Pesos sin decimales, para los textos que quedan en la marca. */
const fmtCOP = (v: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

/**
 * Lo que queda escrito en el cobro cuando el recibo se emite.
 *
 * La definición vive en `./recibo-componentes` (módulo puro, que también lo importa el
 * navegador) y se re-exporta aquí porque este archivo era su casa histórica.
 */
export type { MarcaRecibo }

/** Un componente que ONE le dejó a Tesorería, con la frase que lo explica. */
export interface AbonoAMano {
  componente: ComponenteRecibo
  motivo: MotivoAbonoAMano
  detalle: string
}

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
      recibos: Array<{
        numero: string
        siigo_id: string
        valor: number
        componente?: ComponenteRecibo
        /** Solo en el abono a la factura. */
        tipo?: 'abono'
      }>
      /**
       * El honorario de este pago NO salió porque el negocio todavía no tiene factura: se
       * abona el día que se facture. Lo demás (la tarifa) sí salió.
       */
      honorario_espera_factura?: boolean
      /** Lo que ONE le dejó a Tesorería en esta misma llamada. */
      a_mano?: AbonoAMano[]
    }
  | { ok: false; motivo: 'ya_emitido'; numero: string }
  | { ok: false; motivo: 'sin_valor' }
  | { ok: false; motivo: 'anulado' }
  | { ok: false; motivo: 'faltan_datos'; faltantes: string[] }
  | { ok: false; motivo: 'duplicado_en_siigo'; existentes: Array<{ numero: string; fecha: string; valor: number }> }
  /**
   * No había nada que emitir: el pago solo trae honorario, el honorario se abona a la
   * factura y el negocio todavía no tiene. No es un fallo (regla 8 del brief del
   * 2026-09-22): no se emite nada y al cliente no se le avisa.
   */
  | { ok: false; motivo: 'espera_factura' }
  /** No había nada que ONE pudiera emitir: el abono quedó para Tesorería, con su razón. */
  | { ok: false; motivo: 'abono_a_mano'; a_mano: AbonoAMano[] }
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
 *
 * Solo para el ANTICIPO. El abono a la factura tiene su propio control, que exige la misma
 * factura y no se salta cuando la consulta falla: `revisarAbonosDeLaFactura`.
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
    const todos = await vouchersDelComprobante(workspaceId, documentId ?? cfg.reciboDocumentId, maxEspera429Ms)
    return todos
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

/** Lo que Siigo acepta como máximo por página en `GET /v1/vouchers`. */
const TAM_PAGINA_VOUCHERS = 100
/**
 * Techo de páginas por comprobante: 20.000 recibos. SOENA tenía ~100 RC-1 el 2026-09-22.
 * Llegar aquí no es "ya se vio todo": es una lista que no se pudo terminar de leer.
 */
const MAX_PAGINAS_VOUCHERS = 200

/**
 * TODOS los recibos de un comprobante, página por página hasta el final. **Lanza** si no
 * puede asegurar que los trajo todos.
 *
 * ⚠️ Hasta el 2026-09-22 se leía solo la primera página (`page_size=100`), y la consulta
 * ni siquiera filtraba por cliente: con más de 100 recibos en el comprobante, un duplicado
 * real quedaba fuera de la vista sin que nada lo dijera. Leer hasta el final no depende de
 * ningún filtro de Siigo que no se haya verificado (el de facturas ignora en silencio
 * `identification` y devuelve TODO), y el filtro por cliente se sigue haciendo aquí.
 *
 * Qué cuenta como «no se pudo leer completo», y por eso lanza:
 *   - Siigo dice `total_results` y entregó menos (páginas que se acaban antes de tiempo);
 *   - una página que no trae ningún recibo nuevo (Siigo ignoró `page` y repite la misma);
 *   - más de `MAX_PAGINAS_VOUCHERS` páginas.
 * Quien llama decide qué hacer con eso: el abono no sale; el anticipo sigue como antes.
 */
export async function vouchersDelComprobante(
  workspaceId: string,
  documentId: number,
  maxEspera429Ms = 0,
): Promise<VoucherSiigoLeido[]> {
  const vistos = new Map<string, VoucherSiigoLeido>()
  let total: number | null = null
  for (let pagina = 1; pagina <= MAX_PAGINAS_VOUCHERS; pagina++) {
    const r = await siigoRequest<{
      results?: VoucherSiigoLeido[]
      pagination?: { total_results?: number | string }
    }>(
      workspaceId,
      `/v1/vouchers?document_id=${documentId}&page=${pagina}&page_size=${TAM_PAGINA_VOUCHERS}`,
      { maxEspera429Ms },
    )
    const t = Number(r.pagination?.total_results)
    if (r.pagination?.total_results != null && Number.isFinite(t)) total = t

    const lote = r.results ?? []
    if (lote.length === 0) {
      if (total != null && vistos.size < total) {
        throw new Error(`Siigo dice ${total} recibos en el comprobante ${documentId} y entregó ${vistos.size}`)
      }
      return [...vistos.values()]
    }
    let nuevos = 0
    lote.forEach((v, i) => {
      const clave = v.id || v.name || `p${pagina}#${i}`
      if (!vistos.has(clave)) nuevos++
      vistos.set(clave, v)
    })
    if (nuevos === 0) {
      throw new Error(`Siigo repitió la página ${pagina} del comprobante ${documentId}: no se sabe si hay más`)
    }
    if (total != null && vistos.size >= total) return [...vistos.values()]
  }
  throw new Error(`el comprobante ${documentId} tiene más de ${MAX_PAGINAS_VOUCHERS} páginas de recibos`)
}

/** Cuántos detalles de recibo se piden, como máximo, cuando la lista no trae sus ítems. */
const MAX_DETALLES_VOUCHER = 50

type RevisionAbonos =
  | { tipo: 'limpio' }
  | { tipo: 'duplicado'; existentes: AbonoExistente[] }
  | { tipo: 'sin_revisar'; causa: string }

/**
 * ¿Siigo ya tiene el abono que ONE está por emitir contra ESTA factura?
 *
 * Es el control del abono, y a diferencia del del anticipo NO se salta cuando falla: el
 * abono es automático y sin nadie mirando, así que lo que no se pudo revisar completo
 * frena el abono y queda «a mano» (brief del 2026-09-22). Nunca se emite a ciegas.
 *
 * La regla vive en `revisarAbonosExistentes` (puro). Aquí solo se trae lo que necesita:
 * la lista entera del comprobante y, para los recibos del cliente cuyo vencimiento no
 * venga en la lista, su detalle uno por uno.
 */
async function revisarAbonosDeLaFactura(
  workspaceId: string,
  documentId: number,
  identificacion: string,
  vencimiento: Vencimiento,
  valor: number,
  conocidos: ReadonlySet<string>,
): Promise<RevisionAbonos> {
  let lista: VoucherSiigoLeido[]
  try {
    lista = await vouchersDelComprobante(workspaceId, documentId, ESPERA_429_EMISION_MS)
  } catch (e) {
    return { tipo: 'sin_revisar', causa: `la consulta a Siigo falló: ${(e as Error).message}` }
  }

  const base = { identificacion, vencimiento, valor, conocidos }
  const primera = revisarAbonosExistentes({ ...base, vouchers: lista })
  if (primera.duplicados.length > 0) return { tipo: 'duplicado', existentes: primera.duplicados }
  if (primera.sinLeer.length === 0) return { tipo: 'limpio' }

  // La lista no dijo a qué factura pagaron algunos recibos del cliente: se lee su detalle.
  if (primera.sinLeer.length > MAX_DETALLES_VOUCHER) {
    return { tipo: 'sin_revisar', causa: `${primera.sinLeer.length} recibos del cliente sin vencimiento legible` }
  }
  const detalles: VoucherSiigoLeido[] = []
  for (const v of primera.sinLeer) {
    if (!v.id) return { tipo: 'sin_revisar', causa: `el recibo ${v.name ?? '(sin número)'} no trae id para leerlo` }
    try {
      detalles.push(await siigoRequest<VoucherSiigoLeido>(
        workspaceId, `/v1/vouchers/${encodeURIComponent(v.id)}`, { maxEspera429Ms: ESPERA_429_EMISION_MS },
      ))
    } catch (e) {
      return { tipo: 'sin_revisar', causa: `no se pudo leer el recibo ${v.name ?? v.id}: ${(e as Error).message}` }
    }
  }
  const segunda = revisarAbonosExistentes({ ...base, vouchers: detalles })
  if (segunda.duplicados.length > 0) return { tipo: 'duplicado', existentes: segunda.duplicados }
  if (segunda.sinLeer.length > 0) {
    return {
      tipo: 'sin_revisar',
      causa: `no se pudo leer a qué factura pagó ${segunda.sinLeer.map(v => v.name ?? v.id).join(', ')}`,
    }
  }
  return { tipo: 'limpio' }
}

/**
 * Emite el recibo de caja de UN COBRO, renderiza su PDF, lo archiva y avisa al cliente.
 * El abono a la factura es la excepción: se emite, pero sin PDF ni aviso (paso 6).
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
    /**
     * Emitir SOLO estos componentes. Desde el brief del 2026-09-22 cada documento tiene
     * un solo camino: el abono del honorario sale solo por `abonos-factura.ts`
     * (`['honorario']`, automático) y el recibo de la tarifa UPME por Tesorería o por el
     * recibo automático (`['pasante']`). Lo que no se pide ni se planea.
     */
    soloComponentes?: readonly ComponenteRecibo[]
  } = {},
): Promise<ResultadoRecibo> {
  const svc = createServiceClient()
  const porConcepto = opciones.porConcepto ?? null

  // ── 0. El cobro, que es de donde cuelga todo ──
  const { data: cobroRaw, error: errCobro } = await db(svc)
    .from('cobros')
    .select('id, negocio_id, monto, fecha, tipo_cobro, siigo_recibo, anulado_at, retencion')
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
    retencion?: number | string | null
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
  let componentes = plan.componentes
  if (opciones.soloComponentes) {
    const solo = new Set<ComponenteRecibo>(opciones.soloComponentes)
    componentes = componentes.filter(c => c.componente != null && solo.has(c.componente))
  }
  if (componentes.length === 0) {
    // Todos los componentes ya tienen su recibo: es la idempotencia, no un fallo.
    return { ok: false, motivo: 'ya_emitido', numero: primerRecibo(cobro.siigo_recibo)?.numero ?? '' }
  }

  const { data: negRaw, error: errNeg } = await db(svc)
    .from('negocios')
    .select('id, codigo, nombre, metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (errNeg || !negRaw) return { ok: false, motivo: 'error', mensaje: 'Negocio no encontrado' }
  const negocio = negRaw as { codigo: string | null; nombre: string; metadata?: Record<string, unknown> | null }

  // ── 2c. El abono del honorario: ¿hay a qué factura cruzarlo? ──
  //
  // Lo que se puede decidir sin llamar a Siigo se decide aquí: sin factura no se emite
  // nada por el honorario (se abona al facturar), y con retención el abono lo hace
  // Tesorería. El saldo de la factura, que es el tope, se pregunta más abajo.
  const previo = await prepararAbonoSinRed(svc, workspaceId, negocioId, negocio.metadata ?? null, cobro, componentes)
  componentes = previo.componentes
  const aMano = previo.aMano
  const facturaDelNegocio = previo.factura
  if (componentes.length === 0) {
    // Nada que emitir. Los «a mano» se guardan igual: son la explicación del pendiente.
    for (const m of aMano) await guardarEntradaAMano(svc, workspaceId, cobroId, m, staffNombre)
    if (aMano.length > 0) return { ok: false, motivo: 'abono_a_mano', a_mano: aMano.map(soloTexto) }
    return { ok: false, motivo: 'espera_factura' }
  }

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

  const emitidos: Array<{
    numero: string; siigo_id: string; valor: number; componente?: ComponenteRecibo; tipo?: 'abono'
  }> = []
  /** Bloque donde quedó el PRIMER PDF: es el que enlaza el aviso al cliente. */
  let bloqueDelAviso: string | null = null
  let algunPdfArchivado = false
  let todosLosPdfArchivados = true

  try {
    const cfg = await getSiigoConfig(workspaceId)

    // ── 3b. El abono necesita la factura DE SIIGO: su saldo es el tope ──
    //
    // Se pregunta antes de todo lo demás porque decide el VALOR del abono, y con ese
    // valor se buscan los duplicados. Una lectura por abono, no por componente: el
    // anticipo no la necesita.
    const preparados: Preparado[] = []
    for (const comp of componentes) {
      if (comp.tipo !== 'abono' || !facturaDelNegocio) { preparados.push(comp); continue }
      const leida = await siigoRequest<FacturaSiigoLeida>(
        workspaceId, `/v1/invoices/${encodeURIComponent(facturaDelNegocio.siigo_id)}`,
        { maxEspera429Ms: ESPERA_429_EMISION_MS },
      )
      const d = decidirAbono({
        honorario: comp.valor,
        factura: leida,
        numeroFactura: facturaDelNegocio.numero,
        identificacionCliente: identificacion,
      })
      if (d.tipo === 'error') return { ok: false, motivo: 'error', mensaje: d.mensaje }
      if (d.tipo === 'a_mano') {
        aMano.push({ componente: comp.componente!, motivo: d.motivo, detalle: d.detalle, valor: d.sinAbonar })
        continue
      }
      preparados.push({
        ...comp,
        valor: d.valor,
        abono: {
          factura: facturaDelNegocio,
          vencimiento: d.vencimiento,
          fechaFactura: d.fechaFactura,
          sinAbonar: d.sinAbonar,
          branchOffice: d.cliente.branchOffice,
        },
      })
    }

    // Los «a mano» se guardan ANTES de emitir: no consumen numeración, y si un recibo de
    // abajo falla, la explicación de este tiene que haber quedado.
    for (const m of aMano) await guardarEntradaAMano(svc, workspaceId, cobroId, m, staffNombre)
    if (preparados.length === 0) {
      return { ok: false, motivo: 'abono_a_mano', a_mano: aMano.map(soloTexto) }
    }

    // ── 4. ¿Siigo ya tiene lo que se va a emitir? ──
    // Se pregunta por TODOS los componentes antes de emitir el primero: descubrir el
    // duplicado a mitad del bucle dejaría un recibo emitido y el otro no, por una
    // comprobación que se podía hacer antes.
    const justificacion = opciones.justificacionDuplicado?.trim()
    const existentes: Array<{ numero: string; fecha: string; valor: number }> = []
    const listos: Preparado[] = []
    /** Los «a mano» que salen de ESTE paso: se guardan antes de emitir, como los de arriba. */
    const aManoDelControl: EntradaAMano[] = []
    let conocidos: Set<string> | null = null
    for (const comp of preparados) {
      // El anticipo: ¿este cliente ya tiene un recibo por este valor? Informa y pide
      // justificación; si la consulta falla, sigue (ver `recibosDelClienteEnSiigo`).
      if (!comp.abono) {
        existentes.push(...await recibosDelClienteEnSiigo(
          workspaceId, identificacion, cfg, ESPERA_429_EMISION_MS, comp.valor, comp.documentId,
        ))
        listos.push(comp)
        continue
      }
      // El abono: ¿esta FACTURA ya recibió este pago? Ver `revisarAbonosDeLaFactura`.
      //
      // ⚠️ Los recibos que ONE ya le conoce a ESTE negocio no son duplicado: son los abonos
      // de sus otros pagos. El plan 50/50 de SOENA produce dos abonos del MISMO valor
      // contra la misma factura, y sin esto el segundo nunca saldría.
      conocidos ??= await numerosDeRecibosDelNegocio(svc, workspaceId, negocioId)
      const revision = await revisarAbonosDeLaFactura(
        workspaceId, comp.documentId ?? cfg.reciboDocumentId, identificacion,
        comp.abono.vencimiento, comp.valor, conocidos,
      )
      // La justificación es de una persona que VIO los duplicados y decidió. Lo que no se
      // pudo revisar no lo vio nadie: eso no lo destraba ninguna justificación.
      if (revision.tipo === 'limpio' || (revision.tipo === 'duplicado' && justificacion)) {
        listos.push(comp)
        continue
      }
      // El abono es automático: no hay a quién pedirle la justificación. Queda «a mano» con
      // el abono que se encontró, o con lo que no se pudo revisar, y no se reintenta solo.
      const numeroFactura = comp.abono.factura.numero
      aManoDelControl.push({
        componente: comp.componente!,
        valor: redondearCentavos(comp.valor + comp.abono.sinAbonar),
        ...(revision.tipo === 'duplicado'
          ? { motivo: 'duplicado_en_siigo' as const, detalle: detalleDuplicado(numeroFactura, revision.existentes) }
          : { motivo: 'abonos_sin_revisar' as const, detalle: detalleSinRevisar(numeroFactura, revision.causa) }),
      })
    }
    for (const m of aManoDelControl) {
      await guardarEntradaAMano(svc, workspaceId, cobroId, m, staffNombre)
      aMano.push(m)
    }
    if (listos.length === 0) {
      return { ok: false, motivo: 'abono_a_mano', a_mano: aMano.map(soloTexto) }
    }
    if (existentes.length > 0 && !justificacion) {
      return { ok: false, motivo: 'duplicado_en_siigo', existentes }
    }

    // ── 5. Emitir, un recibo por componente ──
    for (const comp of listos) {
      let fechaRecibo = fechaPago
      let motivoFechaDistinta: string | null = null
      const abono = comp.abono ?? null

      // El abono lo dice en su propia observación: quien lo lea en Siigo tiene que saber
      // que ese pago ya quedó cruzado con su factura, y "Honorarios de asesoría" a secas
      // no lo dice.
      const concepto = abono ? `${comp.concepto} · abono a la factura ${abono.factura.numero}` : comp.concepto

      const armar = (fecha: string): { payload: BorradorRecibo | BorradorAbono; faltantes: string[] } => abono
        ? borradorAbono(
          cfg, identificacion, comp.valor, fecha, concepto, abono.vencimiento,
          // La sucursal del tercero es la de LA FACTURA: el abono cruza ese vencimiento.
          abono.branchOffice ?? sucursalDelCliente, comp.documentId,
        )
        : borradorRecibo(
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
      const emitir = (cuerpo: BorradorRecibo | BorradorAbono) =>
        siigoRequest<{ id?: string; name?: string; number?: number; date?: string }>(
          workspaceId, '/v1/vouchers',
          { method: 'POST', body: cuerpo, idempotencyKey: clave, maxEspera429Ms: ESPERA_429_EMISION_MS },
        )

      let creado: { id?: string; name?: string; number?: number; date?: string } | null = null
      try {
        creado = await emitir(payload)
      } catch (e) {
        // ⚠️ Los rechazos que se reintentan son DOS, y solo esos dos.
        //
        // 1. El periodo contable cerrado. Un pago de febrero no se puede asentar en un
        //    mes que ya se cerró, y eso no es un defecto de Siigo: es contabilidad. La
        //    alternativa era dejar 20 pagos viejos ($8.1M, medido el 2026-09-07) sin
        //    recibo para siempre. Se reintenta con la fecha de HOY y el PDF sigue
        //    mostrando la del pago, así que el cliente ve su fecha real.
        //
        // 2. El abono de un pago ANTERIOR a su factura. Regla 6 del brief del
        //    2026-09-22: se intenta con la fecha del pago, y si Siigo la rechaza se usa
        //    la de la factura. Pasa en cuanto se factura después de cobrar, que con la
        //    factura libre es el caso normal.
        //
        // Cualquier otro error se propaga: tratarlos todos como un problema de fecha
        // convertiría un dato malo en un recibo con fecha cambiada y sin nadie mirando.
        const fechaFactura = abono?.fechaFactura ?? null
        if (esPeriodoCerrado(e)) {
          motivoFechaDistinta = `Siigo rechazó la fecha del pago (${fechaPago}) por periodo contable cerrado`
          fechaRecibo = hoyISO()
        } else if (abono && fechaFactura && fechaPago < fechaFactura && esRechazoDeDatos(e)) {
          motivoFechaDistinta = `El pago (${fechaPago}) es anterior a la factura ${abono.factura.numero} `
            + `(${fechaFactura}) y Siigo no aceptó el abono con la fecha del pago: se fechó con la de la factura`
          fechaRecibo = fechaFactura
        } else {
          throw e
        }
        try {
          creado = await emitir(armar(fechaRecibo).payload)
        } catch (e2) {
          // La fecha de la factura también puede caer en un periodo cerrado.
          if (!(esPeriodoCerrado(e2) && fechaRecibo !== hoyISO())) throw e2
          motivoFechaDistinta = `${motivoFechaDistinta}; esa fecha cae en un periodo contable cerrado`
          fechaRecibo = hoyISO()
          creado = await emitir(armar(fechaRecibo).payload)
        }
      }
      if (!creado) throw new Error('Siigo no devolvió el recibo')

      const numero = creado.name ?? '(sin número)'

      // ── 6. El PDF, que Siigo no da ──
      // De aquí en adelante NADA convierte la emisión en un fallo: el recibo ya está
      // asentado y consumió numeración.
      //
      // ⚠️ El ABONO no lleva PDF (regla 5 del brief del 2026-09-22, «Tesorería solo emite
      // recibos de la tarifa UPME»). Es un asiento interno que cierra la cuenta por cobrar:
      // no se archiva en el bloque del recibo, no entra en `data.recibos` y por eso el
      // correo «recibimos tu pago» —que se arma de esa lista— nombra solo el RC-3. Un
      // cliente que recibiera el PDF de un abono estaría leyendo un documento que ONE
      // produce solo, sin que nadie lo haya mirado.
      let archivoUrl: string | null = null
      let driveFileId: string | null = null
      let bloqueConfigId: string | null = null
      if (comp.bloqueSlug && !abono) {
        try {
          const pdf = await renderReciboCaja('soena', {
            numero,
            fecha: creado.date ?? fechaRecibo,
            fecha_pago: fechaPago,
            cliente_nombre: nombreParaDocumento,
            cliente_identificacion: identificacion,
            negocio_codigo: negocio.codigo ?? '',
            valor: comp.valor,
            concepto,
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
                // El concepto viaja con la entrada y no se deduce después: es lo que la
                // línea tenía configurado CUANDO se emitió, y es lo que el correo le
                // nombra al cliente ("Honorarios de asesoría" / "Recaudo para pago de
                // tarifa UPME"). Si se leyera de la config al mandar el correo, cambiar
                // la config reescribiría lo que dice un documento ya emitido.
                concepto,
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
            // ...pero el CLIENTE sí recibe un aviso que nombra su recibo, y no tiene
            // sesión. Por eso se conserva la copia en Storage (bucket privado) y su
            // referencia `one://` queda en la entrada: la edge function la firma por
            // siete días. Sin esto el correo promete una descarga y entrega un 401 —
            // medido el 2026-09-21 sobre 14 avisos ya enviados a 8 clientes reales.
            true,
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
        ...(abono
          ? {
              tipo: 'abono' as const,
              factura: abono.factura,
              // Solo cuando algo NO cupo: es la huella del tope, y un cero sería ruido.
              ...(abono.sinAbonar > 0 ? { sin_abonar: abono.sinAbonar } : {}),
            }
          : {}),
      }

      // Se guarda DESPUÉS DE CADA componente, no al final: el recibo ya consumió
      // numeración, y si el siguiente falla su marca tiene que quedar o el reintento
      // lo emitiría otra vez.
      await guardarMarca(svc, workspaceId, cobroId, marca, porConcepto != null)

      emitidos.push({
        numero, siigo_id: marca.siigo_id, valor: comp.valor,
        ...(comp.componente ? { componente: comp.componente } : {}),
        ...(abono ? { tipo: 'abono' as const } : {}),
      })
    }

    // ── 8. El aviso al cliente: UNO solo, después de TODOS los componentes ──
    //
    // Decisión de Mauricio (2026-09-19). El cliente hizo UN pago y espera UNA
    // confirmación: dos correos por el mismo pago se leen como un cobro doble. Por eso
    // el aviso vive fuera del bucle — si un componente falla, la excepción sale antes
    // de llegar aquí y el correo no se manda a medias; el cobro queda pendiente en el
    // panel y el aviso espera al reintento.
    //
    // ⚠️ El aviso se pide por BLOQUE (`avisar_documento_al_cliente` se identifica por
    // `bloque_config_id`), no por recibo. Que el correo nombre los DOS documentos con su
    // número, su concepto y su valor lo resuelve `notificar-etapa` leyendo
    // `data.recibos` del bloque y quedándose con los del ÚLTIMO cobro — y solo si el
    // copy de la etapa escribe `{recibos}`. Ver `_shared/recibos-del-aviso.ts`.
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

    // El abono no se archiva (ver el paso 6): no cuenta como PDF que faltó.
    const sinBloque = listos.every(c => !c.bloqueSlug || c.abono)
    return {
      ok: true,
      numero: emitidos[0].numero,
      siigo_id: emitidos[0].siigo_id,
      valor: emitidos.reduce((s, r) => s + r.valor, 0),
      archivada: sinBloque || todosLosPdfArchivados,
      recibos: emitidos,
      ...(previo.esperaFactura ? { honorario_espera_factura: true } : {}),
      ...(aMano.length > 0 ? { a_mano: aMano.map(soloTexto) } : {}),
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
    // Un reintento del MISMO componente reemplaza su marca en vez de duplicarla, y un
    // recibo que por fin sale reemplaza el «a mano» que su componente tuviera. Lo de los
    // OTROS componentes se conserva, sea recibo o «a mano»: ver `conEntradaDeComponente`.
    valor = conEntradaDeComponente(
      (data as { siigo_recibo?: unknown } | null)?.siigo_recibo,
      marca as unknown as Record<string, unknown> & { componente?: ComponenteRecibo },
    )
  }

  const { error: errUp } = await db(svc)
    .from('cobros').update({ siigo_recibo: valor }).eq('id', cobroId).eq('workspace_id', workspaceId)

  // El recibo YA existe en Siigo. Si la marca no se guarda, el cobro se vería como no
  // recaudado y alguien podría re-emitir: por eso el error se dice, no se traga.
  if (errUp) console.error('[siigo] recibo emitido pero NO marcado en el cobro:', errUp.message)
}

// ─────────────────────────────────────────────────────────────────────────────
// El abono del honorario a la factura
// ─────────────────────────────────────────────────────────────────────────────

/** La factura del negocio, con lo mínimo para abonarle: su número y su id en Siigo. */
interface FacturaVinculada {
  numero: string
  siigo_id: string
}

/** Un componente que ya sabe con qué valor sale y, si es abono, contra qué vencimiento. */
type Preparado = ComponenteAEmitir & {
  abono?: {
    factura: FacturaVinculada
    vencimiento: Vencimiento
    fechaFactura: string | null
    sinAbonar: number
    branchOffice: number | null
  }
}

/** Un componente que ONE le deja a Tesorería, con lo que falta para escribirlo. */
interface EntradaAMano {
  componente: ComponenteRecibo
  motivo: MotivoAbonoAMano
  detalle: string
  /** Honorario de este pago que quedó sin abonar. */
  valor: number
}

const soloTexto = (m: EntradaAMano): AbonoAMano =>
  ({ componente: m.componente, motivo: m.motivo, detalle: m.detalle })

/**
 * Lo que se decide del abono SIN llamar a Siigo.
 *
 *  - Sin factura en el negocio, el honorario no sale: se abona el día que se facture
 *    (regla 8 del brief: no se emite nada y no se avisa).
 *  - Con una factura que el negocio TIENE pero sin vínculo a Siigo (cargada a mano, o una
 *    marca vieja sin id), no hay contra qué cruzar: queda para Tesorería con esa razón.
 *    Adoptarla desde la cola de facturación le pone el vínculo.
 *  - Con retención, tampoco: el abono necesita impuestos y descuentos (regla 7).
 *
 * Los componentes que NO son abono pasan intactos.
 */
async function prepararAbonoSinRed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  negocioId: string,
  metadata: Record<string, unknown> | null,
  cobro: { retencion?: number | string | null },
  componentes: ComponenteAEmitir[],
): Promise<{
  componentes: ComponenteAEmitir[]
  aMano: EntradaAMano[]
  factura: FacturaVinculada | null
  esperaFactura: boolean
}> {
  if (!componentes.some(c => c.tipo === 'abono')) {
    return { componentes, aMano: [], factura: null, esperaFactura: false }
  }

  const marca = (metadata?.siigo_factura ?? null) as { numero?: string; siigo_id?: string } | null
  const factura: FacturaVinculada | null = marca?.numero && marca?.siigo_id
    ? { numero: marca.numero, siigo_id: marca.siigo_id }
    : null

  // Solo se pregunta por la factura CARGADA cuando no hay vínculo: es una lectura más, y
  // en el caso normal (factura emitida o adoptada desde ONE) la marca ya lo dice todo.
  let numeroSinVinculo: string | null = marca?.numero ?? null
  if (!factura && !numeroSinVinculo) {
    try {
      const f = await leerFacturaDeUnNegocio(svc, workspaceId, negocioId)
      numeroSinVinculo = f?.resolucion.factura?.numero ?? null
    } catch (e) {
      // Sin poder leer el bloque se trata como "sin factura": no se emite nada y el
      // honorario espera. Es el lado seguro: un abono que no sale se reintenta, uno
      // cruzado contra la factura equivocada no se deshace.
      console.error('[siigo] no se pudo leer la factura cargada del negocio:', (e as Error).message)
    }
  }

  const retencion = retencionDelCobro(cobro.retencion)
  const quedan: ComponenteAEmitir[] = []
  const aMano: EntradaAMano[] = []
  let esperaFactura = false

  for (const comp of componentes) {
    if (comp.tipo !== 'abono') { quedan.push(comp); continue }
    if (!factura) {
      if (numeroSinVinculo) {
        aMano.push({
          componente: comp.componente!, motivo: 'factura_sin_vinculo', valor: comp.valor,
          detalle: `El negocio tiene la factura ${numeroSinVinculo}, pero sin su vínculo con Siigo: `
            + 'adóptala desde la cola de facturación o cruza el abono a mano.',
        })
      } else {
        esperaFactura = true
      }
      continue
    }
    if (retencion > 0) {
      aMano.push({
        componente: comp.componente!, motivo: 'retencion', valor: comp.valor,
        detalle: `El pago trae retención de ${fmtCOP(retencion)}: el abono a la factura ${factura.numero} `
          + 'necesita impuestos y descuentos, y lo cruza Tesorería en Siigo.',
      })
      continue
    }
    quedan.push(comp)
  }

  return { componentes: quedan, aMano, factura, esperaFactura }
}

/**
 * Escribe en el cobro que un componente quedó para Tesorería.
 *
 * Va en la misma lista que las marcas de recibo y sin número, así que nadie la cuenta
 * como recibo (ver `MarcaAbonoAMano`). Se relee antes de escribir, igual que la marca.
 */
async function guardarEntradaAMano(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  cobroId: string,
  m: EntradaAMano,
  staffNombre: string | null,
): Promise<void> {
  const entrada: MarcaAbonoAMano = {
    componente: m.componente,
    abono_a_mano: { motivo: m.motivo, detalle: m.detalle },
    valor: m.valor,
    at: new Date().toISOString(),
    por: staffNombre,
  }
  const { data, error: errLeer } = await db(svc)
    .from('cobros').select('siigo_recibo').eq('id', cobroId).eq('workspace_id', workspaceId).single()
  if (errLeer) {
    console.error('[siigo] no se pudo releer el cobro antes de dejar el abono a mano:', errLeer.message)
    return
  }
  const valor = conEntradaDeComponente(
    (data as { siigo_recibo?: unknown } | null)?.siigo_recibo,
    entrada as unknown as Record<string, unknown> & { componente?: ComponenteRecibo },
  )
  const { error: errUp } = await db(svc)
    .from('cobros').update({ siigo_recibo: valor }).eq('id', cobroId).eq('workspace_id', workspaceId)
  if (errUp) console.error('[siigo] no se pudo dejar el abono a mano en el cobro:', errUp.message)
}

/**
 * Los números de recibo que ONE ya le conoce a un negocio, en todos sus cobros.
 *
 * Si la lectura falla devuelve vacío: el guardián de duplicados queda más estricto (pide
 * justificación de más), nunca más laxo.
 */
async function numerosDeRecibosDelNegocio(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  workspaceId: string,
  negocioId: string,
): Promise<Set<string>> {
  try {
    const { data, error } = await db(svc)
      .from('cobros').select('siigo_recibo').eq('workspace_id', workspaceId).eq('negocio_id', negocioId)
    if (error || !Array.isArray(data)) return new Set()
    return new Set(
      (data as Array<{ siigo_recibo?: unknown }>).flatMap(c => recibosDelCobro(c.siigo_recibo).map(m => m.numero)),
    )
  } catch {
    return new Set()
  }
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
  opciones: {
    concepto?: string
    bloqueReciboSlug?: string
    valorPagado?: number
    soloComponentes?: readonly ComponenteRecibo[]
  },
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

  const repartoCompleto = repartoDeCobro(filaRaw as FilaReparto | null, {
    monto: valorPagado,
    tipo_cobro: cobro.tipo_cobro,
  })
  // Lo que no se pidió no entra al plan, ni siquiera para exigirle su configuración: el
  // recibo de la tarifa (Tesorería) no puede quedar frenado porque el honorario de la
  // línea no esté bien declarado, ni el abono (automático) por la tarifa. Se deja en cero
  // y `planDeEmision` lo salta como a cualquier bolsa vacía.
  const solo = opciones.soloComponentes ? new Set<ComponenteRecibo>(opciones.soloComponentes) : null
  const reparto = repartoCompleto && solo
    ? {
        honorario: solo.has('honorario') ? repartoCompleto.honorario : 0,
        pasante: solo.has('pasante') ? repartoCompleto.pasante : 0,
      }
    : repartoCompleto
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
