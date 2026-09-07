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
import { borradorFactura, SUCURSAL_POR_DEFECTO, type BorradorFactura } from './mapeo'
import { resolverConceptoDeNegocio } from './concepto-negocio'
import { asegurarClienteSiigo, corregirContactoParaFactura, identificacionDelNegocio } from './clientes'
import { descuadreConciliacion, type ModeloDinero } from '@/lib/upme/modelo-dinero'
import { archivarPdfEnBloque } from './archivar-documento'
import { numeroFacturaEnData } from './factura-cargada'
import { idsDeCopiasDelBloque } from '@/lib/negocios/copias-del-bloque'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'
import { guardarMarcaEnMetadata } from '@/lib/negocios/marca-metadata'
// PostgREST corta en 1.000 filas sin avisar, y aquí una fila que falte se lee
// como "esa factura está libre". Ver el módulo.
import { traerTodo } from '@/lib/supabase/paginar'
import { cerrarNegocioSiQuedaResuelto } from '@/app/(app)/negocios/negocio-v2-actions'

/**
 * Emitir SÍ aguanta la pausa del límite de peticiones de Siigo (pide ~19 s).
 * Quien pulsó el botón ya confirmó dos veces: prefiere esperar con el spinner a
 * que le digan que lo intente de nuevo y volver a pasar por las confirmaciones.
 */
const ESPERA_429_EMISION_MS = 30_000

/** Factura que Siigo ya tiene para ese cliente, sea del servicio que sea. */
export interface FacturaEnSiigo {
  id: string
  /** Número visible, p. ej. "FV-2-225". */
  name: string
  date: string
  /** Total que Siigo tiene registrado. `null` si no lo devolvió. */
  total: number | null
  /** Códigos de producto de sus ítems: es lo que dice de qué servicio es. */
  productos: string[]
  /**
   * ¿Es del MISMO producto que se está por emitir? Lo llena quien compara
   * (`clasificarDuplicados`); la consulta sola no lo sabe porque ya no filtra.
   */
  mismo_producto?: boolean
}

interface RespuestaFacturas {
  results?: Array<{
    id?: string
    name?: string
    date?: string
    total?: number
    items?: Array<{ code?: string }>
  }>
}

/**
 * TODAS las facturas que Siigo tiene para esa identificación. **Sin filtrar por
 * producto.**
 *
 * Hasta el 2026-09-07 filtraba por el producto que se iba a emitir, y ese filtro
 * era un punto ciego: medido sobre las 482 facturas del Siigo de SOENA, las 269
 * que emitió ONE van bajo el producto 11 y las 213 que ningún negocio de ONE
 * reclama van casi todas bajo el 22 (146). O sea que una factura hecha a mano bajo
 * el 22 pasaba el guard sin ruido cuando ONE iba a emitir bajo el 11. Es lo que le
 * pasó a V0345: ya tenía factura del 31 de marzo por su valor exacto, y lo único
 * que evitó la segunda fue un error de sucursal.
 *
 * Ahora informa en vez de decidir: devuelve número, fecha, total y productos, y
 * quien llama clasifica. Una factura de otro servicio ya no se esconde — se muestra
 * y se exige que alguien la justifique por escrito.
 *
 * El filtro `customer_identification` está verificado contra la API (devuelve solo
 * las de ese cliente; el parámetro `identification`, en cambio, se ignora en
 * silencio y devuelve TODO, que es la forma más fácil de creer que un guard
 * funciona).
 */
export async function facturasDelClienteEnSiigo(
  workspaceId: string,
  identificacion: string,
  maxEspera429Ms = 0,
): Promise<FacturaEnSiigo[]> {
  if (!identificacion) return []
  const r = await siigoRequest<RespuestaFacturas>(
    workspaceId,
    `/v1/invoices?customer_identification=${encodeURIComponent(identificacion)}&page_size=100`,
    { maxEspera429Ms },
  )
  return (r.results ?? []).map(f => ({
    id: f.id ?? '',
    name: f.name ?? '(sin número)',
    date: f.date ?? '',
    total: typeof f.total === 'number' && Number.isFinite(f.total) ? f.total : null,
    productos: (f.items ?? []).map(i => i.code ?? '').filter(Boolean),
  }))
}

/**
 * Marca cuáles de esas facturas son del mismo producto que se va a emitir.
 *
 * Puro y aparte porque es la decisión que antes estaba escondida dentro de un
 * `.filter()`: las del mismo producto son el duplicado evidente; las de otro
 * producto son la advertencia que el filtro viejo tiraba a la basura. Ninguna de
 * las dos deja emitir sin justificación escrita, pero la pantalla las cuenta
 * distinto y quien decide tiene que ver la diferencia.
 */
export function clasificarDuplicados(
  facturas: FacturaEnSiigo[],
  productoCode: string,
): FacturaEnSiigo[] {
  return facturas.map(f => ({ ...f, mismo_producto: f.productos.includes(productoCode) }))
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
  /**
   * Cómo llegó esta factura al negocio.
   *
   * Ausente = la emitió ONE (todas las marcas anteriores al 2026-09-07).
   * `adoptada_de_siigo` = ya existía en Siigo y una persona la reconoció como la
   * de este negocio. La distinción no es cosmética: sin ella la trazabilidad
   * afirmaría que ONE emitió un documento fiscal que no emitió.
   */
  origen?: 'emitido_en_siigo' | 'adoptada_de_siigo'
  /** Fecha de la factura EN SIIGO. En una adoptada puede ser de meses atrás. */
  fecha?: string
  /** Quién y cuándo volvió a traer el PDF de una factura ya marcada. */
  rearchivado_at?: string
  rearchivado_por?: string | null
}

/**
 * Busca en TODAS las copias del bloque, no solo en la nativa: el PDF se carga desde
 * la etapa donde esté el caso hoy, y cada copia guarda en su propia fila. Ver
 * `idsDeCopiasDelBloque`.
 *
 * Sin slug o sin línea no hay dónde mirar y responde null: la emisión queda como
 * estaba, con la marca como única señal.
 */
async function numeroFacturaCargado(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  negocioId: string,
  lineaId: string | null,
  slugBloque: string | undefined,
): Promise<string | null> {
  if (!slugBloque || !lineaId) return null
  const copias = await idsDeCopiasDelBloque(svc, lineaId, slugBloque)
  if (copias.length === 0) return null
  const { data } = await svc
    .from('negocio_bloques')
    .select('data')
    .eq('negocio_id', negocioId)
    .in('bloque_config_id', copias)
  for (const fila of ((data ?? []) as Array<{ data?: unknown }>)) {
    const numero = numeroFacturaEnData(fila.data ?? null)
    if (numero) return numero
  }
  return null
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
  // Dos señales, porque hay dos maneras de llegar a estar facturado. La marca solo
  // existe cuando la factura salió DESDE aquí; la otra vía es el bloque, donde
  // alguien cargó el PDF que bajó de Siigo.
  const yaFacturado = (negocio.metadata?.siigo_factura ?? null) as MarcaFactura | null
  if (yaFacturado?.numero) {
    return { ok: false, motivo: 'ya_facturado_en_one', numero: yaFacturado.numero }
  }
  const cargada = await numeroFacturaCargado(svc, negocioId, negocio.linea_id, opciones.bloqueFacturaSlug)
  if (cargada) return { ok: false, motivo: 'ya_facturado_en_one', numero: cargada }

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
    // Se preguntan TODAS las del cliente, no solo las del producto que se va a
    // emitir: el filtro por producto era justo lo que dejó pasar el caso de V0345
    // (facturado a mano bajo el 22, a punto de re-facturarse bajo el 11). Ver
    // `facturasDelClienteEnSiigo`.
    const existentes = clasificarDuplicados(
      await facturasDelClienteEnSiigo(workspaceId, identificacion, ESPERA_429_EMISION_MS),
      productoCode,
    )
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
        // Siigo resuelve el tercero por identificación MÁS sucursal. Sin dato
        // conocido va la principal, que es el comportamiento de siempre.
        branchOffice: cliente.branch_office ?? SUCURSAL_POR_DEFECTO,
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

    // ⚠️ La marca se fusiona sobre el estado de AHORA, no sobre `negocio.metadata`,
    // que se leyó al empezar esta función. En el medio corrieron
    // `corregirContactoParaFactura` y `asegurarClienteSiigo`, y esta última
    // REESCRIBE `siigo_cliente` cuando la marca vieja no coincide con el RUT.
    // Escribir sobre la copia vieja devolvía esa corrección a su valor anterior:
    // 12 negocios facturados de SOENA quedaron con la cédula truncada por eso
    // (medido el 2026-09-02). Ver `guardarMarcaEnMetadata`.
    const guardada = await guardarMarcaEnMetadata(
      svc, workspaceId, negocioId, 'siigo_factura', marca, negocio.metadata,
    )
    // La factura YA existe en Siigo. Si la marca no se guarda, el caso sigue en la
    // cola y alguien podría re-emitir: por eso el error se dice, no se traga. El
    // guard de duplicados de Siigo lo atajaría, pero eso es la red, no el piso.
    if (!guardada.ok) {
      console.error('[siigo] factura emitida pero NO marcada en el negocio:', guardada.mensaje)
    }

    // Si el caso ya estaba ESPERANDO en su etapa de cierre, la factura que acaba de
    // emitirse es justo lo que le faltaba. Nada de lo que pase aqui puede convertir una
    // emision exitosa en un fallo: la factura ya existe en Siigo y es irreversible.
    if (guardada.ok) {
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

// ── Adoptar una factura que YA existe en Siigo ───────────────────────────────
//
// SOENA facturó a mano durante meses antes de que ONE emitiera. Esas facturas
// existen, son válidas y el cliente ya las recibió: lo que falta es que estén
// DENTRO del expediente, para que el comercial las mande sin ir a buscarlas a
// Siigo. Medido el 2026-09-07 sobre las 482 facturas del Siigo de SOENA, 213 no
// las reclama ningún negocio de ONE.
//
// La adopción NO empareja sola. Ya se intentó en agosto (`backfill-siigo-cola`
// emparejaba por identificación y se quedaba con `suyas[0]`) y Mauricio rechazó
// 7 de esos emparejamientos el 2026-08-10. Aquí un humano ve TODAS las facturas
// del cliente, escoge una y confirma. Ni preselección, ni lote, ni automático.

/** Factura del cliente vista desde la pantalla de adopción. */
export interface FacturaAdoptable extends FacturaEnSiigo {
  /**
   * Negocio de ONE que ya la tiene marcada, si alguno. Marcarla en dos negocios
   * contaría el mismo ingreso dos veces, así que se muestra y no se deja escoger.
   */
  reclamada_por: { negocio_id: string; codigo: string | null } | null
  /** Es la que este mismo negocio ya tiene marcada: adoptarla es RE-ARCHIVAR. */
  ya_es_de_este_negocio: boolean
}

export type ResultadoListadoAdopcion =
  | { ok: true; identificacion: string; facturas: FacturaAdoptable[] }
  | { ok: false; motivo: 'sin_identificacion' }
  | { ok: false; motivo: 'error'; mensaje: string }

/**
 * Quién reclama cada factura del workspace, indexado por id y por número.
 *
 * Se leen TODOS los negocios y se filtra en memoria en vez de consultar por la
 * ruta jsonb: un filtro de PostgREST mal formado devolvería cero filas sin
 * error, y aquí ese cero significa "esta factura está libre" — justo la
 * afirmación que no puede salir de un fallo mudo.
 */
async function marcasDeFacturaDelWorkspace(
  workspaceId: string,
): Promise<Map<string, { negocio_id: string; codigo: string | null }>> {
  const svc = createServiceClient()
  const filas = await traerTodo<{
    id: string
    codigo: string | null
    siigo_factura: MarcaFactura | null
  }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('negocios')
      .select('id, codigo, siigo_factura:metadata->siigo_factura')
      .eq('workspace_id', workspaceId)
      .order('id')
      .range(d, h),
    { etiqueta: 'siigo/marcas-de-factura' },
  )

  const porClave = new Map<string, { negocio_id: string; codigo: string | null }>()
  for (const f of filas) {
    const marca = f.siigo_factura
    if (!marca) continue
    const dueno = { negocio_id: f.id, codigo: f.codigo }
    // Se indexa por las DOS llaves: el id de Siigo es el vínculo fuerte, pero
    // una marca vieja puede traerlo vacío y ahí el número es lo único que hay.
    if (marca.siigo_id) porClave.set(`id:${marca.siigo_id}`, dueno)
    if (marca.numero) porClave.set(`num:${marca.numero}`, dueno)
  }
  return porClave
}

/** ¿Quién reclama esta factura, si alguien? */
function reclamanteDe(
  f: FacturaEnSiigo,
  porClave: Map<string, { negocio_id: string; codigo: string | null }>,
): { negocio_id: string; codigo: string | null } | null {
  return porClave.get(`id:${f.id}`) ?? porClave.get(`num:${f.name}`) ?? null
}

/**
 * Todas las facturas que Siigo tiene para el cliente de este negocio, marcando
 * cuáles ya están reclamadas.
 *
 * SOLO LEE: no crea el tercero, contra Siigo solo hace GET, y no escribe en ONE.
 * Es la pantalla previa a una decisión, no la decisión.
 */
export async function facturasAdoptablesDelNegocio(
  workspaceId: string,
  negocioId: string,
): Promise<ResultadoListadoAdopcion> {
  try {
    const { identificacion } = await identificacionDelNegocio(workspaceId, negocioId)
    if (!identificacion) return { ok: false, motivo: 'sin_identificacion' }

    const [enSiigo, porClave] = await Promise.all([
      facturasDelClienteEnSiigo(workspaceId, identificacion, ESPERA_429_EMISION_MS),
      marcasDeFacturaDelWorkspace(workspaceId),
    ])

    const facturas: FacturaAdoptable[] = enSiigo
      .map(f => {
        const reclamada = reclamanteDe(f, porClave)
        return {
          ...f,
          reclamada_por: reclamada,
          ya_es_de_este_negocio: reclamada?.negocio_id === negocioId,
        }
      })
      // Más reciente primero: es el orden en que alguien las busca.
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

    return { ok: true, identificacion, facturas }
  } catch (e) {
    const mensaje = e instanceof SiigoError ? e.message : (e as Error).message
    return { ok: false, motivo: 'error', mensaje }
  }
}

export type ResultadoAdopcion =
  | {
      ok: true
      numero: string
      /** `true` si el negocio ya la tenía marcada y esto solo repuso el PDF. */
      rearchivada: boolean
    }
  /** El id escogido no aparece entre las facturas del cliente de este negocio. */
  | { ok: false; motivo: 'no_es_del_cliente' }
  /** Otro negocio ya la tiene marcada. Adoptarla contaría el ingreso dos veces. */
  | { ok: false; motivo: 'reclamada_por_otro'; codigo: string | null }
  /** Este negocio ya tiene OTRA factura marcada. Eso se corrige, no se pisa. */
  | { ok: false; motivo: 'ya_facturado_en_one'; numero: string }
  | { ok: false; motivo: 'sin_identificacion' }
  /** Siigo no entregó el PDF. No se escribió nada: se puede reintentar. */
  | { ok: false; motivo: 'sin_pdf' }
  | { ok: false; motivo: 'error'; mensaje: string }

/**
 * Adopta en el negocio una factura que ya existe en Siigo.
 *
 * El orden importa: todo lo que puede fallar se comprueba antes de escribir, y
 * el PDF se baja ANTES de marcar. Marcar el negocio como facturado sin haber
 * podido traer el archivo reproduce exactamente el problema que esto viene a
 * resolver (V0076 y V0177: factura emitida por ONE, PDF ausente del bloque).
 *
 * `emitida` NO se asume: se deriva del CUFE. Solo una factura radicada ante la
 * DIAN tiene uno, así que es evidencia y no un supuesto.
 */
export async function adoptarFacturaDeSiigo(
  workspaceId: string,
  negocioId: string,
  siigoFacturaId: string,
  staffNombre: string | null,
  opciones: { bloqueFacturaSlug?: string; staffId?: string | null } = {},
): Promise<ResultadoAdopcion> {
  const svc = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negRaw, error: errNeg } = await (svc as any)
    .from('negocios')
    .select('id, metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (errNeg || !negRaw) return { ok: false, motivo: 'error', mensaje: 'Negocio no encontrado' }
  const negocio = negRaw as { id: string; metadata: Record<string, unknown> | null }
  const marcaExistente = (negocio.metadata?.siigo_factura ?? null) as MarcaFactura | null

  try {
    const listado = await facturasAdoptablesDelNegocio(workspaceId, negocioId)
    if (!listado.ok) {
      return listado.motivo === 'sin_identificacion'
        ? { ok: false, motivo: 'sin_identificacion' }
        : { ok: false, motivo: 'error', mensaje: listado.mensaje }
    }

    // ⚠️ La factura se busca dentro de las del CLIENTE de este negocio, no por
    // id contra Siigo: quien llama manda un id, y esta es la única barrera que
    // impide adoptar la factura de otra persona por un id mal copiado.
    const escogida = listado.facturas.find(f => f.id === siigoFacturaId)
    if (!escogida) return { ok: false, motivo: 'no_es_del_cliente' }

    if (escogida.reclamada_por && !escogida.ya_es_de_este_negocio) {
      return { ok: false, motivo: 'reclamada_por_otro', codigo: escogida.reclamada_por.codigo }
    }

    // El negocio ya tiene OTRA factura: eso no se pisa desde aquí. Cambiarle la
    // factura a un negocio es una corrección con su propia decisión detrás.
    const rearchivar = !!marcaExistente?.numero && escogida.ya_es_de_este_negocio
    if (marcaExistente?.numero && !rearchivar) {
      return { ok: false, motivo: 'ya_facturado_en_one', numero: marcaExistente.numero }
    }

    const doc = await pdfDeFactura(workspaceId, siigoFacturaId)
    if (!doc) return { ok: false, motivo: 'sin_pdf' }

    // ── Archivar ─────────────────────────────────────────────────────────────
    // Re-archivar una factura que ONE sí emitió conserva su origen: el archivo
    // llegó tarde, pero la emisión fue nuestra.
    const origenArchivo = rearchivar && marcaExistente?.origen !== 'adoptada_de_siigo'
      ? 'emitido_en_siigo'
      : 'adoptada_de_siigo'

    let archivoUrl: string | null = null
    if (opciones.bloqueFacturaSlug) {
      const nombre = `${escogida.name.replace(/[^\w.-]+/g, '-')}.pdf`
      const arch = await archivarPdfEnBloque(
        workspaceId, negocioId, opciones.bloqueFacturaSlug, doc.pdf, nombre,
        { numero_factura: escogida.name },
        undefined,
        origenArchivo,
      )
      if (arch.ok) archivoUrl = arch.url ?? null
      // A diferencia de la emisión, aquí archivar SÍ puede cortar: la factura ya
      // existía en Siigo y nada se ha escrito todavía, así que fallar es
      // reintentable. Marcar el negocio sin el PDF sería repetir V0076.
      else return { ok: false, motivo: 'error', mensaje: `No se pudo archivar el PDF: ${arch.error}` }
    }

    const ahora = new Date().toISOString()
    const marca: MarcaFactura = rearchivar && marcaExistente
      ? {
          // Se conserva TODO lo de la marca original: lo único que faltaba era
          // el archivo. Reescribirla entera perdería quién emitió y cuándo.
          ...marcaExistente,
          cufe: doc.cufe ?? marcaExistente.cufe ?? null,
          archivo_url: archivoUrl ?? marcaExistente.archivo_url ?? null,
          rearchivado_at: ahora,
          rearchivado_por: staffNombre,
        }
      : {
          numero: escogida.name,
          siigo_id: escogida.id,
          // El total es el de SIIGO, no el honorario aprobado: es el valor del
          // documento que existe. Cuando difieren, eso es justo lo que hay que ver.
          total: escogida.total ?? 0,
          cufe: doc.cufe ?? null,
          archivo_url: archivoUrl,
          // Un CUFE solo existe si la factura se radicó ante la DIAN.
          emitida: doc.cufe != null,
          at: ahora,
          por: staffNombre,
          producto_code: escogida.productos[0],
          origen: 'adoptada_de_siigo',
          fecha: escogida.date || undefined,
        }

    const guardada = await guardarMarcaEnMetadata(
      svc, workspaceId, negocioId, 'siigo_factura', marca, negocio.metadata,
    )
    if (!guardada.ok) {
      return { ok: false, motivo: 'error', mensaje: `No se pudo marcar el negocio: ${guardada.mensaje}` }
    }

    // Igual que en la emisión: si el caso ya estaba esperando su factura para
    // cerrarse, esto es lo que le faltaba. Nada de aquí tumba la adopción.
    try {
      await cerrarNegocioSiQuedaResuelto(svc, workspaceId, negocioId, opciones.staffId ?? null)
    } catch (e) {
      console.error('[siigo] no se pudo evaluar el cierre automatico:', (e as Error).message)
    }

    return { ok: true, numero: marca.numero, rearchivada: rearchivar }
  } catch (e) {
    const mensaje = e instanceof SiigoError ? e.message : (e as Error).message
    return { ok: false, motivo: 'error', mensaje }
  }
}
