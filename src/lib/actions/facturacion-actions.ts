'use server'

/**
 * Cola de facturación del área financiera.
 *
 * Facturar dejó de ser una etapa del flujo: se habilita cuando el negocio supera
 * Documentación y vive en UNA sola superficie, este panel. El botón que aparezca
 * en el negocio es navegación hacia aquí, no una segunda vía de escritura
 * (decisión de Mauricio, 2026-08-06). Spec:
 * `docs/specs/2026-08-06_facturacion-fuera-del-flujo.md`.
 *
 * `getColaFacturacion` SOLO LEE. La única que escribe en Siigo es
 * `emitirFacturaDeNegocio`, y siempre por decisión de una persona.
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { nombreDeQuienActua } from '@/lib/activity/nombre-de-quien-actua'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { leerSecretosWorkspace, secretoConRespaldo } from '@/lib/secretos/workspace'
import { canEditBloque, type Area, type Role, type UserContext } from '@/lib/permissions/can-edit'
import { bloqueoPorNegocioCerrado } from '@/lib/negocios/negocio-abierto'
import { negocioCerrado, MENSAJE_NEGOCIO_CERRADO } from '@/lib/negocios/motivo-cierre'
import { borradorCliente, borradorFactura, type RutExtraido } from '@/lib/siigo/mapeo'
import { emitirReciboDeCobro } from '@/lib/siigo/recibos'
import {
  leerReciboPorConcepto,
  primerRecibo,
  recibosDelCobro,
  type ConfigReciboPorConcepto,
} from '@/lib/siigo/recibo-componentes'
import { leerTitularCorregido, validarTitular, type TitularEditado } from '@/lib/siigo/titular'
import { siigoRequest, type SiigoConfig } from '@/lib/siigo/client'
import {
  conceptoFactura,
  type ConceptosConfig,
  type ServicioContratado,
} from '@/lib/siigo/concepto'
import {
  adoptarFacturaDeSiigo,
  emitirFacturaNegocio,
  facturasAdoptablesDelNegocio,
  type FacturaAdoptable,
  type FacturaEnSiigo,
  type FacturaHermana,
  type MarcaFactura,
} from '@/lib/siigo/facturas'
import { casoListoParaFacturar } from '@/lib/facturacion/caso-listo'
import {
  cargaManualPermitida,
  decidirCargaManual,
  resolverFacturaDelNegocio,
  type OrigenFactura,
} from '@/lib/facturacion/factura-del-negocio'
import {
  gatesDeFacturaPorLinea,
  leerFacturaDeUnNegocio,
  leerOriginalesDeFactura,
  slugFacturaDeLinea,
} from '@/lib/facturacion/leer-factura-del-negocio'
import { archivarPdfEnBloque } from '@/lib/siigo/archivar-documento'
import { extractFieldsFromDocument, type CampoExtraccion, type CampoResultado } from '@/lib/ai/extract-fields'
import { aplicarNormalizaciones } from '@/lib/documentos/normalizaciones'
import { getServerKey } from '@/lib/server-keys'
import { cerrarNegocioSiQuedaResuelto } from '@/app/(app)/negocios/negocio-v2-actions'
// Toda lectura por LOTE de este archivo pasa por aquí. PostgREST corta en 1.000
// filas sin avisar, y en esta cola eso ya escondió el RUT de 48 casos y devolvió
// dos negocios ya facturados a la bandeja como facturables. Ver el módulo.
import { traerTodo } from '@/lib/supabase/paginar'
import { revalidatePath } from 'next/cache'
// La ventana vive en su propio módulo: este archivo es `'use server'` y exportar
// una constante desde aquí anula TODOS los exports en el build.
// La fecha se valida en el SERVIDOR, no solo escondiendo el botón: una pestaña
// abierta desde antes seguiría mostrando la acción, y un barrido masivo sobre
// plata no puede depender de que el cliente esté actualizado.
import { DESCARTE_FACTURACION_HASTA, ventanaDescarteAbierta } from '@/lib/facturacion/ventana-descarte'
import { registrarActividad } from '@/lib/activity/registrar-actividad'

export interface CasoPorFacturar {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  etapa: string | null
  etapa_numero: number | null
  identificacion: string | null
  cliente: string | null
  /**
   * Celular **ya resuelto**, tal como viajaría a Siigo: el del contacto, y si no
   * hay, el del RUT, normalizado a número nacional. Se expone para poder buscar
   * por él, que es como el equipo identifica un caso cuando el cliente llama.
   *
   * Va vacío cuando el borrador NO manda teléfono (un valor que no cabe en los
   * 10 dígitos que Siigo acepta, como los `3001234567.0` que dejó el cargue
   * desde Excel). Eso es lo que pasa de verdad: el tercero se crea sin teléfono.
   * Pintar el valor crudo diría que hay uno cuando no lo va a haber.
   */
  telefono: string | null
  /**
   * Correo **ya resuelto**: el que Siigo va a usar para MANDAR la factura
   * electrónica. Sale del mismo borrador que la emisión (`borradorCliente`), con
   * su misma precedencia — el contacto gana, el RUT es el respaldo.
   *
   * ⚠️ Aquí NO va `contactos.email` crudo. Hasta el 2026-09-02 iba, y la pantalla
   * se contradecía sola: 69 de 110 casos pendientes mostraban la casilla vacía
   * mientras el RUT tenía el correo y la factura se iba a emitir a él, y ninguno
   * aparecía con "email" entre los faltantes. Diana salía a buscar un dato que el
   * sistema ya tenía.
   */
  email: string | null
  /**
   * Nombre del CONTACTO del negocio: con quién se habla, que muchas veces no es el
   * titular (quien pagó, quien vendió). Se muestra al lado del titular para que se
   * vea que la factura NO sale a su nombre.
   */
  contacto_nombre: string | null
  /**
   * A nombre de quién salen la factura, el recibo de la tarifa UPME y los abonos,
   * desglosado para que la revisión lo pueda corregir. Sale del MISMO borrador que
   * la emisión (`borradorCliente` con la corrección aplicada): `cliente` e
   * `identificacion` son esto mismo, ya unido.
   */
  titular: {
    /** Código de tipo de documento de Siigo: 13 cédula, 22 extranjería, 31 NIT. */
    tipo_documento: string
    numero: string | null
    dv: string | null
    /** Persona: `[nombres, apellidos]`. Empresa: `[razón social]`. */
    nombre: string[]
    /** La corrección vigente. `null` = el titular es el del RUT. */
    corregido: {
      por: string | null
      at: string
      /** Lo que dice el RUT, que la corrección no borró. */
      rut: { identificacion: string | null; nombre: string | null }
    } | null
  }
  /**
   * Identificación del tercero que ONE ya tiene amarrado en Siigo (la marca), o null.
   * Si la corrección cambia el documento, la factura va a OTRO tercero y la pantalla
   * lo dice.
   */
  tercero_siigo: string | null
  /**
   * Recibos de caja que ya salieron para este negocio. Una corrección del titular no
   * los cambia (ya salieron), y la pantalla lo avisa antes de facturar.
   */
  recibos_emitidos: string[]
  /**
   * Qué concepto sale en la factura y por qué. Se muestra ANTES de emitir: es
   * lo que el cliente va a leer y lo que queda ante la DIAN.
   */
  concepto: {
    /** `code` del producto de Siigo que viaja en el ítem. */
    code: string
    /** Nombre del producto en el catálogo del cliente. null si Siigo no responde. */
    nombre: string | null
    /** Servicio declarado que lo gobernó; null si el caso no lo declara. */
    servicio: ServicioContratado | null
    /** true si salió del default y no de lo que el cliente contrató. */
    porDefecto: boolean
  }
  /** Honorario aprobado, CON IVA (es como ONE guarda `precio_aprobado`). */
  honorario: number | null
  /** Valor pagado a la UPME según el comprobante cargado. Recaudo de terceros. */
  valor_upme: number | null
  /** Qué le falta al borrador de la factura para poder emitirse. */
  faltan_factura: string[]
  /** Qué le falta al borrador del cliente. */
  faltan_cliente: string[]
  /**
   * `true` cuando el negocio no tiene un RUT del que sacar la identificación.
   *
   * Se declara aparte porque sin RUT `faltan_cliente` se llena de consecuencias
   * (identificación, nombre, dirección, ciudad) y ninguna nombra la causa: la
   * tarjeta pintaba cuatro etiquetas que hacían pensar en cuatro datos sueltos
   * por completar a mano. Medido el 2026-09-08 sobre los 5 casos con pago y sin
   * recibo de caja, en los 5 el documento nunca se cargó — no estaba tampoco en
   * la carpeta de Drive.
   */
  sin_rut: boolean
  /**
   * Tiene factura: la marca de Siigo o un número en el bloque ORIGINAL cuyo emisor
   * no contradice al del workspace. Ninguna copia heredada cuenta. Ver
   * `lib/facturacion/factura-del-negocio`.
   */
  ya_facturado: boolean
  /** Número de la factura, venga de la marca o del bloque original. */
  factura_numero: string | null
  /**
   * `true` si el negocio está facturado pero no hay PDF ni en el bloque original ni
   * en la marca. Son los casos que hay que re-archivar: medido el 2026-09-07, V0076
   * (FV-2-459) y V0177 (FV-2-373). Sin decirlo en pantalla, nadie los distingue
   * de un caso completo — la marca se ve igual.
   */
  factura_sin_pdf: boolean
  /**
   * Enlace al PDF real de la factura: el del bloque ORIGINAL o el `archivo_url` de la
   * marca. Nunca el de una copia heredada. `null` si no está facturado o no hay PDF.
   */
  factura_pdf_url: string | null
  /** Cómo llegó la factura. `null` = cargada en la ficha, sin origen declarado. */
  factura_origen: OrigenFactura | null
  /**
   * El bloque original trae un documento de OTRO emisor (p. ej. la factura del
   * vehículo). No cuenta como factura y la tarjeta lo dice, en vez de mostrarlo.
   */
  factura_documento_ajeno: { emisor: string; numero: string | null } | null
  /**
   * Si la tarjeta ofrece cargar el PDF a mano, y si sería un reemplazo (pide motivo).
   * Lo decide `cargaManualPermitida`, la misma regla que aplica el servidor al guardar.
   */
  carga_manual: { permitida: boolean; reemplaza: boolean; razon: string | null }
  /**
   * El negocio ya no está abierto. Solo entra a la cola si está facturado, para que
   * su factura se pueda ver y buscar; no se le ofrece ninguna acción.
   */
  cerrado: boolean
  /** Consecutivo del recibo de caja del recaudo UPME, si ya se emitió. */
  recibo_numero: string | null
  /**
   * Base gravable que viajaría a Siigo. Sale del MISMO `borradorFactura` que se
   * enviaría, no de una división hecha en la pantalla: si la pantalla calculara
   * su propio desglose podría mostrar un número distinto del que se emite.
   */
  base_gravable: number | null
  /** Sacado de la cola a mano durante la puesta al día. Reversible. */
  descartado: { at: string; por: string | null; motivo: string | null } | null
}

export interface ColaFacturacion {
  casos: CasoPorFacturar[]
  /** Nombre del workspace, para decir de quién tiene que ser la factura que se carga. */
  workspace_nombre: string | null
  /** Etapa (numero visible) a partir de la cual se habilita facturar. */
  desde_etapa_numero: number | null
  /** El workspace no tiene Siigo configurado: la cola se ve, pero no se emite. */
  siigo_configurado: boolean
  /** La herramienta provisional de descarte sigue disponible. */
  descarte_abierto: boolean
  /** Hasta cuándo (para decirlo en pantalla, no para decidir: eso lo hace el servidor). */
  descarte_hasta: string
  /**
   * Catálogo de productos de Siigo, para poder cambiar el CONCEPTO de una factura
   * antes de emitirla. Vacío si Siigo no responde: entonces la pantalla deja el
   * concepto que ONE dedujo y no ofrece cambiarlo, en vez de inventar una lista.
   */
  productos: Array<{ code: string; nombre: string }>
  totales: {
    listos: number
    incompletos: number
    ya_facturados: number
    descartados: number
    valor_listo: number
  }
}

/**
 * Mismo criterio de área que el panel de conciliación: `canEditBloque` sobre el
 * stage de cobro. Facturar es del área financiera, no de quien lleva el caso.
 */
async function ctxFinanciero(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: string }
> {
  const { workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  if (!canEditBloque(user, { stage: 'cobro' }, [])) {
    return { ok: false, error: 'Solo el área financiera puede facturar' }
  }
  return { ok: true, workspaceId }
}

/**
 * Bandeja en cero, para los dos cortes tempranos (sin línea configurada y sin
 * candidatos). NO se exporta: este archivo es `'use server'` y exportar una
 * constante desde aquí anula TODOS los exports del módulo en el build.
 */
const TOTALES_VACIOS: ColaFacturacion['totales'] = {
  listos: 0, incompletos: 0, ya_facturados: 0, descartados: 0, valor_listo: 0,
}

/** Pesos sin decimales para los mensajes de este archivo. No se exporta (`'use server'`). */
const fmtCOP = (v: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export async function getColaFacturacion(): Promise<{ data: ColaFacturacion | null; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { data: null, error: ctx.error }
  try {
    return await armarColaFacturacion(ctx.workspaceId)
  } catch (e) {
    // Una lectura por lote que no se pudo completar NO se degrada a una bandeja
    // corta. Ese es exactamente el fallo que este frente vino a cerrar: una lista
    // recortada tiene el mismo aspecto que una lista entera, y aquí decide si se
    // emite un documento fiscal. Se prefiere una pantalla que dice que falló.
    return { data: null, error: (e as Error).message }
  }
}

/** Cuerpo de la cola. Separado solo para que el `catch` de arriba lo envuelva entero. */
async function armarColaFacturacion(
  workspaceId: string,
): Promise<{ data: ColaFacturacion | null; error?: string }> {
  const svc = createServiceClient()

  // ── Configuración del workspace ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (svc as any)
    .from('workspaces').select('name, config_extra').eq('id', workspaceId).single()
  const workspace_nombre = (ws?.name as string | null | undefined) ?? null
  const cfgWs = (ws?.config_extra ?? {}) as Record<string, unknown>
  const siigoCfg = cfgWs.siigo_config as SiigoConfig | undefined
  const siigo_configurado =
    !!siigoCfg && !!secretoConRespaldo(await leerSecretosWorkspace(workspaceId), cfgWs, 'siigo_access_key')

  // ── Desde qué etapa se habilita ──
  // Opt-in por línea. Sin el dato NO se asume nada: la cola sale vacía y la
  // pantalla lo dice, en vez de inventar un criterio y llenar la bandeja de
  // casos que nadie mandó facturar.
  const lineas = await traerTodo<{ id: string; config_extra?: Record<string, unknown> | null }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('lineas_negocio').select('id, config_extra')
      .eq('workspace_id', workspaceId).order('id').range(d, h),
    { etiqueta: 'facturacion/lineas_negocio' },
  )
  let desde: number | null = null
  // Los conceptos se resuelven POR LÍNEA: cada una vende cosas distintas y su
  // catálogo de Siigo no tiene por qué coincidir.
  const conceptosPorLinea = new Map<string, ConceptosConfig>()
  // Dónde vive el bloque de la factura en cada línea. Se usa para saber si el caso
  // ya tiene una factura CARGADA, que es distinto de emitida desde aquí.
  const facturaSlugPorLinea = new Map<string, string>()
  for (const l of lineas) {
    const f = (l.config_extra?.facturacion ?? {}) as { desde_etapa_numero?: number }
    if (typeof f.desde_etapa_numero === 'number' && desde === null) desde = f.desde_etapa_numero
    const s = (l.config_extra?.siigo ?? {}) as {
      conceptos?: ConceptosConfig; bloque_factura_slug?: string
    }
    if (s.conceptos) conceptosPorLinea.set(l.id, s.conceptos)
    facturaSlugPorLinea.set(l.id, slugFacturaDeLinea(l.config_extra))
  }
  if (desde == null) {
    return { data: { casos: [], workspace_nombre, desde_etapa_numero: null, siigo_configurado, descarte_abierto: ventanaDescarteAbierta(), descarte_hasta: DESCARTE_FACTURACION_HASTA, productos: [], totales: TOTALES_VACIOS } }
  }

  // ── Negocios candidatos ──
  type Neg = {
    id: string; codigo: string | null; nombre: string | null; estado: string | null
    precio_aprobado: number | null; contacto_id: string | null
    linea_id: string | null
    metadata: Record<string, unknown> | null
    etapas_negocio: { nombre: string | null; numero: number | null } | null
  }
  // 391 abiertos hoy en SOENA: todavía por debajo del techo, pero la cola crece
  // con el negocio del cliente y el día que lo pase no habría error, solo casos
  // que dejan de aparecer.
  const negocios = await traerTodo<Neg>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('negocios')
      .select('id, codigo, nombre, estado, precio_aprobado, contacto_id, linea_id, metadata, etapas_negocio!inner(nombre, numero)')
      .eq('workspace_id', workspaceId)
      .order('id')
      .range(d, h),
    { etiqueta: 'facturacion/negocios' },
  )
  const abiertos = negocios.filter(n => n.estado === 'abierto' && (n.etapas_negocio?.numero ?? 0) > desde!)
  const cerrados = negocios.filter(n => n.estado !== 'abierto')

  // ── La factura de cada caso: bloque ORIGINAL + marca, nunca una copia ──────
  // Hasta el 2026-09-14 se leían TODAS las copias heredadas del bloque y bastaba con
  // que una trajera `numero_factura` para dar el caso por facturado. Las copias se
  // llenaban por herencia con documentos ajenos: 20 copias de SOENA traían el número
  // de la factura del VEHÍCULO (Tesla, VISSAN, «FACTURA EDDI ALIRIO»), y V0006, V0290
  // y V0428 salían como facturados sin factura. La regla vive en
  // `lib/facturacion/factura-del-negocio`, la misma que usan la emisión y la ficha.
  const originalFacturaPorNegocio = await leerOriginalesDeFactura(
    svc, [...abiertos, ...cerrados].map(n => n.id), [...new Set(facturaSlugPorLinea.values())],
  )
  const gateFacturaPorLinea = await gatesDeFacturaPorLinea(svc, lineas.map(l => l.id))
  const facturaDe = (n: Neg) => {
    const gate = gateFacturaPorLinea.get(n.linea_id ?? '')
    return resolverFacturaDelNegocio({
      original: originalFacturaPorNegocio.get(n.id) ?? null,
      marca: (n.metadata?.siigo_factura ?? null) as MarcaFactura | null,
      emisorNitEsperado: gate?.emisor_nit_esperado,
      nitCampo: gate?.nit_campo,
      numeroCampo: gate?.numero_campo,
    })
  }

  // Los cerrados ya facturados entran como REGISTRO a «Ya facturados»: sin esto, una
  // factura de un negocio cerrado no se podía encontrar desde Tesorería (15 en SOENA
  // el 2026-09-14). Un cerrado sin factura no entra: no es trabajo de esta cola.
  const candidatos = [...abiertos, ...cerrados.filter(n => facturaDe(n).factura != null)]
  if (candidatos.length === 0) {
    return { data: { casos: [], workspace_nombre, desde_etapa_numero: desde, siigo_configurado, descarte_abierto: ventanaDescarteAbierta(), descarte_hasta: DESCARTE_FACTURACION_HASTA, productos: [], totales: TOTALES_VACIOS } }
  }
  const ids = candidatos.map(n => n.id)

  // ── Bloques que alimentan los borradores ──
  // ⚠️ Los bloques `datos` guardan plano (`data.servicio`) y los `documento` bajo
  // `data.campos[slug].value`. Leer el servicio como si fuera documento devuelve
  // null para todos y el concepto caería al default sin que nadie lo note.
  type Bl = {
    negocio_id: string
    data: ({ campos?: Record<string, { value?: unknown }> } & Record<string, unknown>) | null
    bloque_configs: { slug: string }
  }
  // Cuatro slugs por 305 casos = 1.115 filas medidas el 2026-09-02: 115 por encima
  // del techo de PostgREST. Es la consulta que originó todo esto.
  const bloques = await traerTodo<Bl>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('negocio_bloques')
      .select('negocio_id, data, bloque_configs!inner(slug)')
      .in('negocio_id', ids)
      .in('bloque_configs.slug', ['rut', 'comprobante_pago_upme', 'servicio_contratado'])
      .order('id')
      .range(d, h),
    { etiqueta: 'facturacion/negocio_bloques(borradores)' },
  )

  const rutPorNegocio = new Map<string, RutExtraido>()
  const upmePorNegocio = new Map<string, number>()
  const servicioPorNegocio = new Map<string, unknown>()

  for (const b of bloques) {
    const campos = b.data?.campos ?? {}
    const slug = b.bloque_configs?.slug
    if (slug === 'rut') {
      const plano: Record<string, string> = {}
      for (const [k, v] of Object.entries(campos)) {
        if (v?.value != null && v.value !== '') plano[k] = String(v.value)
      }
      if (plano.numero_identificacion || plano.nit) rutPorNegocio.set(b.negocio_id, plano as RutExtraido)
    } else if (slug === 'comprobante_pago_upme') {
      const v = num(campos.valor_pagado?.value)
      if (v && v > 0) upmePorNegocio.set(b.negocio_id, v)
    } else if (slug === 'servicio_contratado') {
      // Plano, no bajo `campos`. Conserva la primera instancia con valor: el
      // bloque vive en Negociación y se hereda de solo lectura aguas abajo.
      const v = b.data?.servicio
      if (v != null && v !== '' && !servicioPorNegocio.has(b.negocio_id)) {
        servicioPorNegocio.set(b.negocio_id, v)
      }
    }
  }

  // ── El recibo de cada caso ─────────────────────────────────────────────────
  // Desde el 2026-09-22 el saldo del honorario ya NO decide si un caso se factura (la
  // factura sale a crédito y la cierran los abonos), así que de los cobros solo se lee
  // lo que la tarjeta muestra: su último recibo. Las lecturas de conciliación y de
  // tarifa confirmada, que solo servían para calcular ese saldo, se fueron con él.
  // 357 cobros hoy para 305 casos: crece con el recaudo, no solo con los casos.
  const cobrosRes = await traerTodo<{
    negocio_id: string
    /** Objeto o lista: se lee con `primerRecibo`, nunca de frente. */
    siigo_recibo: unknown
    anulado_at: string | null
  }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any).from('cobros')
      .select('id, negocio_id, siigo_recibo, anulado_at')
      .in('negocio_id', ids).order('id').range(d, h),
    { etiqueta: 'facturacion/cobros' },
  )

  // El recibo de caja cuelga del COBRO desde el 2026-09-03, así que su estado se lee
  // de ahí y no de `negocios.metadata`. Un negocio puede tener varios: se muestra el
  // último emitido.
  const ultimoReciboPorNegocio = new Map<string, string>()
  // Todos, no solo el último: son los documentos que una corrección del titular ya no
  // alcanza, y la revisión los nombra antes de facturar.
  const recibosPorNegocio = new Map<string, string[]>()
  for (const c of cobrosRes) {
    if (c.anulado_at) continue
    const recibo = primerRecibo(c.siigo_recibo)
    if (recibo) ultimoReciboPorNegocio.set(c.negocio_id, recibo.numero)
    for (const r of recibosDelCobro(c.siigo_recibo)) {
      const lista = recibosPorNegocio.get(c.negocio_id) ?? []
      if (!lista.includes(r.numero)) lista.push(r.numero)
      recibosPorNegocio.set(c.negocio_id, lista)
    }
  }

  // ── Contactos (email y teléfono ganan sobre el RUT: los mantiene el comercial) ──
  const contactoIds = candidatos.map(n => n.contacto_id).filter((x): x is string => !!x)
  const contactos = new Map<string, { email: string | null; telefono: string | null }>()
  const nombreContacto = new Map<string, string | null>()
  if (contactoIds.length > 0) {
    const cs = await traerTodo<{ id: string; nombre?: string | null; email: string | null; telefono: string | null }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d, h) => (svc as any)
        .from('contactos').select('id, nombre, email, telefono')
        .in('id', contactoIds).order('id').range(d, h),
      { etiqueta: 'facturacion/contactos' },
    )
    for (const c of cs) {
      contactos.set(c.id, { email: c.email, telefono: c.telefono })
      nombreContacto.set(c.id, c.nombre ?? null)
    }
  }

  // Config de respaldo solo para poder EVALUAR los borradores cuando el workspace
  // aún no tiene Siigo configurado. No se usa para emitir: sin configuración real
  // el panel no deja enviar nada.
  // ── Nombres de los productos, que es lo que el cliente lee en la factura ──
  // La fuente es el catálogo de Siigo, no una etiqueta copiada en la config: si
  // alguien renombra el producto allá, la pantalla tiene que decir lo nuevo. Si
  // Siigo no responde, el mapa queda vacío y la pantalla muestra el código —
  // nunca un nombre inventado.
  const nombreProducto = new Map<string, string>()
  if (siigo_configurado) {
    try {
      const prods = await siigoRequest<{ results?: Array<{ code?: string; name?: string }> }>(
        workspaceId, '/v1/products?page_size=100', { method: 'GET' },
      )
      for (const p of prods.results ?? []) {
        if (p.code && p.name) nombreProducto.set(p.code, p.name)
      }
    } catch {
      // La cola se puede revisar aunque el catálogo no cargue.
    }
  }

  // Misma fuente que los nombres: el catálogo, ordenado para que la lista de la
  // pantalla no cambie de orden entre cargas.
  const productos = [...nombreProducto.entries()]
    .map(([code, nombre]) => ({ code, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  const cfgEval: SiigoConfig = siigoCfg ?? {
    facturaDocumentId: 0, reciboDocumentId: 0, sellerId: 0,
    productoCode: '', ivaId: 0, facturaPaymentId: 0, reciboPaymentId: 0,
  }

  // Fecha del documento fiscal. Va a Siigo, asi que es el dia civil de Bogota y no
  // el de UTC: emitir a las 8 p.m. del 31 fechaba la factura el 1 del mes siguiente.
  const hoy = todayBogotaISO()

  const casos: CasoPorFacturar[] = candidatos.map(n => {
    const rut = rutPorNegocio.get(n.id) ?? {}
    const contacto = contactos.get(n.contacto_id ?? '') ?? { email: null, telefono: null }
    // El titular corregido manda sobre el RUT, igual que en la emisión: la revisión
    // tiene que mostrar a nombre de quién va a salir de verdad.
    const titularCorregido = leerTitularCorregido(n.metadata)
    const cli = borradorCliente(rut, contacto, titularCorregido)
    const honorario = n.precio_aprobado == null ? null : Number(n.precio_aprobado)
    // El concepto sale del MISMO helper que usa la emisión: si la pantalla y el
    // documento lo resolvieran por su cuenta, se verían distintos el día que
    // alguien toque uno de los dos.
    const concepto = conceptoFactura(
      servicioPorNegocio.get(n.id),
      conceptosPorLinea.get(n.linea_id ?? ''),
      cfgEval.productoCode,
    )
    const fac = borradorFactura(cfgEval, cli.payload.identification, honorario, hoy, 19,
      { productoCode: concepto.code })
    const upme = upmePorNegocio.get(n.id) ?? null

    // Dos fuentes para "ya facturado": el bloque ORIGINAL donde se carga el PDF y la
    // marca que deja la emisión desde aquí. La segunda hace falta porque emitir NO
    // obliga a cargar el soporte, y sin ella el caso volvería a la cola listo para
    // re-facturarse. Ninguna copia heredada cuenta.
    const resolucion = facturaDe(n)
    const { factura } = resolucion
    const yaFacturado = factura != null
    const cerrado = n.estado !== 'abierto'
    const permisoCarga = cargaManualPermitida(originalFacturaPorNegocio.get(n.id) ?? null, resolucion)
    const descartado = (n.metadata?.facturacion_descartada as CasoPorFacturar['descartado']) ?? null

    return {
      negocio_id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      etapa: n.etapas_negocio?.nombre ?? null,
      etapa_numero: n.etapas_negocio?.numero ?? null,
      identificacion: cli.payload.identification || null,
      cliente: cli.payload.name.filter(Boolean).join(' ') || null,
      contacto_nombre: nombreContacto.get(n.contacto_id ?? '') ?? null,
      titular: {
        tipo_documento: cli.payload.id_type,
        numero: cli.payload.identification || null,
        dv: cli.payload.check_digit || null,
        nombre: cli.payload.name,
        corregido: titularCorregido
          ? { por: titularCorregido.por, at: titularCorregido.at, rut: titularCorregido.rut }
          : null,
      },
      tercero_siigo:
        ((n.metadata?.siigo_cliente ?? null) as { identificacion?: string } | null)?.identificacion ?? null,
      recibos_emitidos: recibosPorNegocio.get(n.id) ?? [],
      // ⚠️ Del BORRADOR, no del contacto crudo: es lo que de verdad viajaría a
      // Siigo. Ver la nota de `CasoPorFacturar.email`.
      telefono: cli.payload.phones?.[0]?.number ?? null,
      email: cli.payload.contacts[0]?.email || null,
      concepto: {
        code: concepto.code,
        nombre: nombreProducto.get(concepto.code) ?? null,
        servicio: concepto.servicio,
        porDefecto: concepto.porDefecto,
      },
      honorario,
      valor_upme: upme,
      faltan_factura: fac.faltantes,
      faltan_cliente: cli.faltantes,
      // El mapa solo guarda RUT con identificación utilizable, así que su
      // ausencia cubre las dos formas de no tenerlo: sin documento cargado y
      // con documento cargado del que no se pudo extraer la cédula o el NIT.
      sin_rut: !rutPorNegocio.has(n.id),
      ya_facturado: yaFacturado,
      factura_numero: factura?.numero ?? null,
      factura_sin_pdf: factura != null && !factura.pdfUrl,
      factura_pdf_url: factura?.pdfUrl ?? null,
      factura_origen: factura?.origen ?? null,
      factura_documento_ajeno: resolucion.documentoAjeno,
      carga_manual: cerrado
        ? { permitida: false, reemplaza: false, razon: 'El negocio está cerrado.' }
        : permisoCarga.permitido
          ? { permitida: true, reemplaza: permisoCarga.reemplaza, razon: null }
          : { permitida: false, reemplaza: false, razon: permisoCarga.razon },
      cerrado,
      recibo_numero: ultimoReciboPorNegocio.get(n.id) ?? null,
      base_gravable: fac.payload.items[0]?.price ?? null,
      descartado,
    }
  })

  // Pendientes primero, y dentro de esos los que ya están listos para emitir:
  // la cola debe abrir por lo que se puede resolver hoy.
  // El criterio vive en `lib/facturacion/caso-listo`, compartido con la pantalla:
  // escrito dos veces se desincroniza y la bandeja diría "3 listos" mientras la
  // lista pinta cuatro botones.
  const listo = (c: CasoPorFacturar) => casoListoParaFacturar(c)
  const fuera = (c: CasoPorFacturar) => c.ya_facturado || c.descartado != null

  casos.sort((a, b) => {
    if (fuera(a) !== fuera(b)) return fuera(a) ? 1 : -1
    if (listo(a) !== listo(b)) return listo(a) ? -1 : 1
    return (b.honorario ?? 0) - (a.honorario ?? 0)
  })

  // Los pendientes ACCIONABLES: ni facturados ni descartados. De aquí salen `listos` e
  // `incompletos`, y el badge de la pestaña es la suma de los dos.
  const pendientes = casos.filter(c => !fuera(c))
  return {
    data: {
      casos,
      workspace_nombre,
      desde_etapa_numero: desde,
      siigo_configurado,
      descarte_abierto: ventanaDescarteAbierta(),
      descarte_hasta: DESCARTE_FACTURACION_HASTA,
      productos,
      totales: {
        listos: pendientes.filter(listo).length,
        incompletos: pendientes.filter(c => !listo(c)).length,
        ya_facturados: casos.filter(c => c.ya_facturado).length,
        descartados: casos.filter(c => c.descartado != null && !c.ya_facturado).length,
        valor_listo: pendientes.filter(listo).reduce((s, c) => s + (c.honorario ?? 0), 0),
      },
    },
  }
}

// ── Descarte provisional ─────────────────────────────────────────────────────

/**
 * Saca un negocio de la cola de facturación SIN cerrarlo ni tocar su precio.
 *
 * Es la herramienta de puesta al día: los 176 casos que quedaron en la bandeja
 * incluyen muchos ya facturados por fuera de ONE, y revisarlos uno a uno dentro
 * del flujo no es viable. Se marca en `metadata` y NO en una columna porque es
 * deliberadamente temporal: no vale la pena dejar esquema para algo que vence.
 *
 * Reversible a propósito (`restaurarEnFacturacion`): un barrido masivo sobre
 * plata sin vuelta atrás convierte un clic de más en un caso perdido.
 */
export async function descartarDeFacturacion(
  negocioId: string,
  motivo?: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }

  // La ventana se valida aquí, no solo escondiendo el botón: una pestaña abierta
  // desde antes seguiría ofreciendo la acción después del vencimiento.
  if (!ventanaDescarteAbierta()) {
    return { ok: false, error: `El descarte de facturación estuvo disponible hasta el ${DESCARTE_FACTURACION_HASTA}.` }
  }

  const { workspaceId } = ctx
  const { staffId } = await getWorkspace()
  const svc = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neg } = await (svc as any)
    .from('negocios').select('id, estado, metadata').eq('id', negocioId).eq('workspace_id', workspaceId).single()
  if (!neg) return { ok: false, error: 'Negocio no encontrado' }
  // Descartar y restaurar escriben `metadata.facturacion_descartada` en el negocio.
  // Un cerrado ya esta fuera de la cola (pide `estado = 'abierto'`), asi que marcarlo
  // no cambia lo que se ve: solo deja un dato nuevo en un expediente que se declaro
  // terminado. El estado entra a la lectura que ya validaba workspace y existencia.
  if (negocioCerrado((neg as { estado: string | null }).estado)) {
    return { ok: false, error: MENSAJE_NEGOCIO_CERRADO }
  }

  let nombre: string | null = null
  if (staffId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: st } = await (svc as any).from('staff').select('full_name').eq('id', staffId).maybeSingle()
    nombre = (st?.full_name as string | null) ?? null
  }

  const marca = {
    at: new Date().toISOString(),
    por: nombre,
    motivo: motivo?.trim() || null,
  }
  const metadata = { ...((neg.metadata ?? {}) as Record<string, unknown>), facturacion_descartada: marca }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await (svc as any)
    .from('negocios').update({ metadata }).eq('id', negocioId).eq('workspace_id', workspaceId)
  if (upErr) return { ok: false, error: (upErr as { message: string }).message }

  if (staffId) {
    // `tipo` DEBE estar en el CHECK de activity_log o el insert falla en silencio
    // (ya pasó cuatro veces en este repo). 'sistema' está en el catálogo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarActividad((svc as any), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'sistema',
      autor_id: staffId, // FK a staff(id), NO a profiles
      contenido: `Descartado de la cola de facturación${marca.motivo ? `. Motivo: ${marca.motivo}` : ''}`,
    }, 'descartarDeFacturacion')
  }

  revalidatePath('/conciliacion')
  return { ok: true }
}

/** Devuelve el negocio a la cola. Sin límite de fecha: deshacer siempre se puede. */
export async function restaurarEnFacturacion(negocioId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { workspaceId } = ctx
  const { staffId } = await getWorkspace()
  const svc = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neg } = await (svc as any)
    .from('negocios').select('id, estado, metadata').eq('id', negocioId).eq('workspace_id', workspaceId).single()
  if (!neg) return { ok: false, error: 'Negocio no encontrado' }
  if (negocioCerrado((neg as { estado: string | null }).estado)) {
    return { ok: false, error: MENSAJE_NEGOCIO_CERRADO }
  }

  const metadata = { ...((neg.metadata ?? {}) as Record<string, unknown>) }
  delete metadata.facturacion_descartada

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upErr } = await (svc as any)
    .from('negocios').update({ metadata }).eq('id', negocioId).eq('workspace_id', workspaceId)
  if (upErr) return { ok: false, error: (upErr as { message: string }).message }

  if (staffId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarActividad((svc as any), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'sistema',
      autor_id: staffId,
      contenido: 'Devuelto a la cola de facturación',
    }, 'restaurarEnFacturacion')
  }

  revalidatePath('/conciliacion')
  return { ok: true }
}

// ── Emisión ──────────────────────────────────────────────────────────────────

export interface ResultadoEmitir {
  ok: boolean
  /** Número de la factura en Siigo cuando la emisión salió bien. */
  numero?: string
  /** Se creó sin radicar ante la DIAN. */
  borrador?: boolean
  /**
   * `false` si la factura salió pero su PDF no quedó cargado en el negocio. No es
   * un fallo de la emisión: es un pendiente que hay que decir, porque el
   * expediente queda incompleto y en silencio nadie lo notaría.
   */
  archivada?: boolean
  error?: string
  /**
   * Facturas del cliente que **ningún negocio reclama**. La pantalla debe
   * mostrarlas y pedir justificación; NO se emite hasta que alguien la escriba.
   */
  duplicados?: FacturaEnSiigo[]
  /**
   * Facturas del mismo cliente que ya son de OTRO negocio (el otro vehículo del
   * mismo dueño). Van como contexto neutro al lado de las de arriba: no bloquean
   * ni piden justificación, y por sí solas nunca detienen una emisión.
   */
  hermanos?: FacturaHermana[]
  /**
   * Lo que pasó con los pagos que el negocio YA tenía al facturar: se abonan a esta
   * factura en el mismo acto. La pantalla lo dice, porque cada abono es un recibo de
   * caja que consumió numeración en Siigo.
   */
  abonos?: { emitidos: string[]; a_mano: number; fallidos: number }
}

/**
 * Dónde archivar el PDF de la factura: se declara por línea, junto al resto de la
 * config de Siigo. Sin el dato la factura sale igual, pero el archivo no queda en
 * el expediente y la pantalla lo dice, en vez de callarlo.
 *
 * Lo consultan la emisión y la adopción: escrito dos veces, un día un camino
 * archivaría y el otro no, y la diferencia solo se vería abriendo el negocio.
 */
async function slugDelBloqueDeFactura(
  workspaceId: string,
  negocioId: string,
): Promise<string | undefined> {
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negLinea } = await (svc as any)
    .from('negocios').select('linea_id').eq('id', negocioId).eq('workspace_id', workspaceId).single()
  if (!negLinea?.linea_id) return undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linea } = await (svc as any)
    .from('lineas_negocio').select('config_extra').eq('id', negLinea.linea_id).maybeSingle()
  const cfgSiigo = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as
    { bloque_factura_slug?: string } | undefined
  return cfgSiigo?.bloque_factura_slug
}

/**
 * Emite la factura del honorario de un negocio contra Siigo.
 *
 * Todo lo que decide se re-resuelve AQUÍ, en el servidor: el cliente manda el id
 * del negocio y, si aplica, la justificación. Nunca el valor ni la identificación.
 * Una pantalla vieja no puede facturar por un monto que ya cambió.
 */
export async function emitirFacturaDeNegocio(
  negocioId: string,
  opciones?: {
    emitir?: boolean
    enviarCorreo?: boolean
    justificacionDuplicado?: string
    /**
     * Lo que la financiera corrigió en la pantalla de revisión. Son los ÚNICOS
     * campos que el cliente puede mandar además del id: datos de contacto, el
     * concepto y el titular. El valor y el saldo se siguen resolviendo aquí.
     *
     * El titular llega como texto y se VALIDA aquí (`validarTitular`): una acción de
     * servidor es una puerta pública, y un DV que no cuadra o un número con letras
     * sería facturarle a otra persona.
     */
    datos?: { email?: string; telefono?: string; productoCode?: string; titular?: TitularEditado }
  },
): Promise<ResultadoEmitir> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { workspaceId } = ctx

  const { staffId } = await getWorkspace()
  const svc = createServiceClient()

  // Un negocio cerrado no se factura. Esto NO le quita trabajo a nadie: la cola ya
  // pide `estado = 'abierto'`, asi que ningun cerrado es alcanzable desde la
  // pantalla. Lo que agrega es que la accion diga lo mismo que la lectura — una
  // server action exportada es una puerta publica aunque ninguna pantalla la ofrezca.
  const cerrado = await bloqueoPorNegocioCerrado(svc, workspaceId, negocioId)
  if (cerrado) return { ok: false, error: cerrado }

  let nombre: string | null = null
  if (staffId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: st } = await (svc as any).from('staff').select('full_name').eq('id', staffId).maybeSingle()
    nombre = (st?.full_name as string | null) ?? null
  }

  // Desde el 2026-09-22 el recaudo NO es condición para facturar: aquí ya no se lee el
  // modelo de dinero ni los cobros. La factura sale a crédito y la cierran los abonos.

  const bloqueFacturaSlug = await slugDelBloqueDeFactura(workspaceId, negocioId)

  // El concepto que llega de la pantalla se valida contra el CATÁLOGO antes de
  // emitir. Un código que Siigo no conoce tumbaría la factura a mitad de camino;
  // uno que sí conoce pero nadie escogió saldría impreso y ya no se corrige. La
  // pantalla solo ofrece códigos del catálogo, pero una acción de servidor es una
  // puerta pública y no puede fiarse de eso.
  const productoCode = opciones?.datos?.productoCode?.trim()
  if (productoCode) {
    try {
      const prods = await siigoRequest<{ results?: Array<{ code?: string }> }>(
        workspaceId, '/v1/products?page_size=100', { method: 'GET' },
      )
      const catalogo = (prods.results ?? []).map(pr => pr.code).filter(Boolean)
      if (!catalogo.includes(productoCode)) {
        return { ok: false, error: `El concepto "${productoCode}" no está en el catálogo de Siigo` }
      }
    } catch (e) {
      // Sin catálogo no se emite con concepto cambiado: es preferible que Diana lo
      // reintente a facturar bajo un concepto que nadie pudo confirmar.
      return { ok: false, error: `No se pudo verificar el concepto contra Siigo: ${(e as Error).message}` }
    }
  }

  let titular: ReturnType<typeof validarTitular> | null = null
  if (opciones?.datos?.titular) {
    titular = validarTitular(opciones.datos.titular)
    if (!titular.ok) return { ok: false, error: titular.mensaje }
  }

  const r = await emitirFacturaNegocio(
    workspaceId,
    negocioId,
    nombre,
    {
      bloqueFacturaSlug,
      datos: {
        email: opciones?.datos?.email,
        telefono: opciones?.datos?.telefono,
        productoCode: opciones?.datos?.productoCode,
        ...(titular?.ok ? { titular: titular.titular } : {}),
      },
      // Por defecto se RADICA: el botón dice "facturar electrónicamente" y una
      // pantalla que promete eso no puede dejar un borrador sin avisar. El modo
      // sin radicar existe para la primera prueba controlada con Diana.
      emitir: opciones?.emitir !== false,
      enviarCorreo: opciones?.enviarCorreo === true,
      justificacionDuplicado: opciones?.justificacionDuplicado,
    },
    { staffId },
  )

  if (!r.ok) {
    switch (r.motivo) {
      case 'duplicado_en_siigo':
        return {
          ok: false,
          duplicados: r.existentes,
          hermanos: r.hermanos,
          error: 'Siigo ya tiene una factura de este cliente que ningún negocio reclama',
        }
      case 'faltan_datos':
        return { ok: false, error: `Faltan datos: ${r.faltantes.join(', ')}` }
      case 'ya_facturado_en_one':
        // Con una corrección del titular pendiente se dice que NO se aplicó: esa
        // factura ya salió, y lo que venga después va al mismo tercero que ella.
        return {
          ok: false,
          error: titular?.ok
            ? `Este negocio ya se facturó (${r.numero}): la corrección del titular no se aplicó, esa factura ya salió.`
            : `Este negocio ya se facturó (${r.numero})`,
        }
      default:
        return { ok: false, error: r.mensaje }
    }
  }

  if (staffId) {
    // `tipo` DEBE estar en el CHECK de activity_log o el insert falla en silencio.
    // `autor_id` es FK a staff(id), NO a profiles.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarActividad((svc as any), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'sistema',
      autor_id: staffId,
      // Los abonos van en la MISMA entrada que la emisión: salieron en el mismo acto.
      // `activity_log.contenido` tiene CHECK de 280 caracteres: se recorta.
      contenido: ((r.emitida
        ? `Factura ${r.numero} emitida en Siigo`
        : `Factura ${r.numero} creada en Siigo SIN radicar ante la DIAN`)
        + textoDeAbonos(r.abonos)).slice(0, 280),
    }, 'emitirFacturaDeNegocio')
  }

  revalidatePath('/conciliacion')
  return {
    ok: true, numero: r.numero, borrador: !r.emitida, archivada: r.archivada,
    abonos: {
      emitidos: r.abonos.emitidos.map(a => a.numero),
      a_mano: r.abonos.a_mano.length,
      fallidos: r.abonos.fallidos.length,
    },
  }
}

/**
 * Lo que el timeline dice de los abonos que salieron con la factura. Vacío si no hubo.
 * No se exporta: este archivo es `'use server'`.
 */
function textoDeAbonos(a: { emitidos: Array<{ numero: string; valor: number }>; a_mano: unknown[]; fallidos: unknown[] }): string {
  const partes: string[] = []
  if (a.emitidos.length > 0) {
    const total = a.emitidos.reduce((s, x) => s + x.valor, 0)
    partes.push(`abonos de pagos anteriores: ${a.emitidos.map(x => x.numero).join(', ')} (${fmtCOP(total)})`)
  }
  if (a.a_mano.length > 0) partes.push(`${a.a_mano.length} abono(s) quedan para Tesorería`)
  if (a.fallidos.length > 0) partes.push(`${a.fallidos.length} abono(s) sin emitir: ver control de recibos`)
  return partes.length > 0 ? ` · ${partes.join(' · ')}` : ''
}

// ── Adoptar una factura que YA existe en Siigo ───────────────────────────────
//
// Requisito de Mauricio (2026-09-07): que el bloque de factura quede completo con
// la factura ORIGINAL, para que el comercial la jale de ahí y se la mande al
// cliente. La emisión no sirve para eso — esa factura ya existe.
//
// ⚠️ No empareja sola, y esa es la decisión, no una limitación. El backfill de
// agosto emparejaba por identificación y se quedaba con la primera; Mauricio
// rechazó 7 de esos emparejamientos el 2026-08-10 (respaldo
// `backup_marcas_factura_20260810`). Aquí se ve la lista completa del cliente,
// una persona escoge, y confirma de a un caso.

export interface FacturasParaAdoptar {
  /** Identificación con la que se consultó Siigo, para poder verificarla a ojo. */
  identificacion: string
  facturas: FacturaAdoptable[]
}

/**
 * Lista TODAS las facturas que Siigo tiene para el cliente del negocio.
 *
 * Solo lee. Se llama al abrir el panel, no al cargar la cola: son 306 casos y
 * sería una llamada a Siigo por fila.
 */
export async function listarFacturasSiigoDelNegocio(
  negocioId: string,
): Promise<{ data: FacturasParaAdoptar | null; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { data: null, error: ctx.error }

  const r = await facturasAdoptablesDelNegocio(ctx.workspaceId, negocioId)
  if (!r.ok) {
    return {
      data: null,
      error: r.motivo === 'sin_identificacion'
        ? 'El negocio no tiene identificación del cliente: sin ella no se puede preguntar en Siigo'
        : `No se pudo consultar Siigo: ${r.mensaje}`,
    }
  }
  return { data: { identificacion: r.identificacion, facturas: r.facturas } }
}

export interface ResultadoAdoptar {
  ok: boolean
  numero?: string
  /** El negocio ya la tenía marcada: esto solo repuso el PDF en el bloque. */
  rearchivada?: boolean
  error?: string
}

/**
 * Marca en el negocio una factura que ya existe en Siigo y trae su PDF.
 *
 * Lo que viaja del cliente es el id de la factura y nada más; a quién pertenece,
 * si está libre y dónde se archiva se re-resuelve aquí. Una acción de servidor es
 * una puerta pública: que la pantalla solo ofrezca facturas del cliente no
 * garantiza que el id que llega sea una de ellas.
 */
export async function adoptarFacturaSiigoDeNegocio(
  negocioId: string,
  siigoFacturaId: string,
): Promise<ResultadoAdoptar> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { workspaceId } = ctx

  const id = (siigoFacturaId ?? '').trim()
  if (!id) return { ok: false, error: 'Falta la factura a adoptar' }

  const { staffId } = await getWorkspace()
  const svc = createServiceClient()

  // Mismo corte que emitir, y por la misma razon: la adopcion se ofrece desde la
  // cola, que ya excluye a los cerrados. Adoptar escribe la marca en el negocio y
  // archiva el PDF en su bloque — es alimentarlo, no solo mirarlo.
  const cerrado = await bloqueoPorNegocioCerrado(svc, workspaceId, negocioId)
  if (cerrado) return { ok: false, error: cerrado }

  let nombre: string | null = null
  if (staffId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: st } = await (svc as any).from('staff').select('full_name').eq('id', staffId).maybeSingle()
    nombre = (st?.full_name as string | null) ?? null
  }

  const bloqueFacturaSlug = await slugDelBloqueDeFactura(workspaceId, negocioId)

  const r = await adoptarFacturaDeSiigo(workspaceId, negocioId, id, nombre, {
    bloqueFacturaSlug,
    staffId,
  })

  if (!r.ok) {
    switch (r.motivo) {
      case 'no_es_del_cliente':
        return { ok: false, error: 'Esa factura no aparece entre las del cliente de este negocio' }
      case 'reclamada_por_otro':
        return { ok: false, error: `Esa factura ya está marcada en ${r.codigo ?? 'otro negocio'}` }
      case 'ya_facturado_en_one':
        return { ok: false, error: `Este negocio ya tiene la factura ${r.numero}` }
      case 'sin_identificacion':
        return { ok: false, error: 'El negocio no tiene identificación del cliente' }
      case 'sin_pdf':
        return { ok: false, error: 'Siigo no entregó el PDF de esa factura. No se guardó nada: se puede reintentar' }
      default:
        return { ok: false, error: r.mensaje }
    }
  }

  if (staffId) {
    // `tipo` DEBE estar en el CHECK de activity_log o el insert falla en silencio.
    // `autor_id` es FK a staff(id), NO a profiles.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarActividad((svc as any), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'sistema',
      autor_id: staffId,
      contenido: r.rearchivada
        ? `PDF de la factura ${r.numero} traído de nuevo desde Siigo`
        : `Factura ${r.numero} adoptada desde Siigo (no la emitió ONE)`,
    }, 'adoptarFacturaSiigoDeNegocio')
  }

  revalidatePath('/conciliacion')
  return { ok: true, numero: r.numero, rearchivada: r.rearchivada }
}

// ── Cargar a mano el PDF de la factura ───────────────────────────────────────
//
// Decisión de Mauricio (2026-09-14): se carga el soporte cuando la factura se hizo por
// fuera de ONE, o cuando ONE ya la reconoce como facturada pero no tiene el PDF. Si la
// factura existe en Siigo se trae de Siigo (la adopción, arriba); esto es el camino
// cuando no está allá o Siigo no devuelve el archivo.
//
// Lo que lo vuelve seguro:
//   - escribe SIEMPRE en el bloque ORIGINAL (`archivarPdfEnBloque` resuelve por slug),
//     nunca en una copia heredada;
//   - el PDF se lee con IA y, si el emisor no es el NIT del workspace, NO se guarda:
//     es la barrera contra volver a subir la factura del vehículo como si fuera la
//     nuestra. La regla es la del gate `factura:emitida`;
//   - reemplazar solo vale sobre una carga manual previa y con motivo escrito;
//   - todo lo decide `decidirCargaManual`, puro y probado; aquí solo se orquesta.
//
// ⚠️ El aviso al cliente NO sale. `archivarPdfEnBloque` escribe con el service role, y
// `trg_avisar_documento_cargado` exige `auth.uid()`; tampoco se llama
// `avisar_documento_al_cliente`. «Factura emitida» de SOENA SÍ declara
// `avisar_al_cliente` (correo y WhatsApp): con la sesión del usuario, cargar un PDF en
// un original con la fila vacía le escribiría al cliente. Escribirle o no es decisión
// aparte.

/** Campos que se leen si la config del bloque no declara los suyos. */
const CAMPOS_FACTURA_POR_DEFECTO: CampoExtraccion[] = [
  {
    slug: 'emisor_nit', tipo: 'texto', label: 'NIT del emisor', required: true, normalizar: 'nit_sin_dv',
    descripcion_ai: 'NIT de la empresa que EMITE la factura (el vendedor), en el encabezado superior. Solo dígitos, sin dígito de verificación ni puntos.',
  },
  {
    slug: 'numero_factura', tipo: 'texto', label: 'Número de factura', required: true,
    descripcion_ai: 'Número o consecutivo de la factura de venta. Devolver el prefijo y el número tal como aparecen.',
  },
]

const TAMANO_MAX_PDF = 10 * 1024 * 1024

export interface ResultadoCargaManual {
  ok: boolean
  error?: string
  /** Modo `leer`: lo que la IA sacó del PDF, para prellenar y confirmar. */
  leido?: { numero: string | null; emisor: string | null }
  /** Este PDF sustituiría un documento ya cargado: la pantalla pide motivo. */
  reemplaza?: boolean
  /** Modo `guardar`: el número con el que quedó. */
  numero?: string
}

/**
 * Lee (modo `leer`) o guarda (modo `guardar`) el PDF de la factura de un negocio.
 *
 * El PDF viaja en las dos llamadas y se lee con IA en las dos: la barrera del emisor
 * se aplica al guardar contra lo que dice el archivo, no contra lo que devolvió la
 * primera lectura. Una acción de servidor es una puerta pública.
 */
export async function cargarFacturaManual(formData: FormData): Promise<ResultadoCargaManual> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { workspaceId } = ctx

  const negocioId = String(formData.get('negocio_id') ?? '').trim()
  const modo = formData.get('modo') === 'guardar' ? 'guardar' : 'leer'
  const archivo = formData.get('archivo')
  if (!negocioId) return { ok: false, error: 'Falta el negocio' }
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Falta el PDF de la factura' }
  const esPdf = archivo.type === 'application/pdf' || archivo.name.toLowerCase().endsWith('.pdf')
  if (!esPdf) return { ok: false, error: 'La factura tiene que ser un PDF' }
  if (archivo.size > TAMANO_MAX_PDF) return { ok: false, error: 'El PDF pesa más de 10 MB' }

  const svc = createServiceClient()
  const cerrado = await bloqueoPorNegocioCerrado(svc, workspaceId, negocioId)
  if (cerrado) return { ok: false, error: cerrado }

  const factura = await leerFacturaDeUnNegocio(svc, workspaceId, negocioId)
  if (!factura) return { ok: false, error: 'Negocio no encontrado' }

  // Antes de gastar una lectura con IA: ¿se puede cargar aquí?
  const permiso = cargaManualPermitida(factura.original, factura.resolucion)
  if (!permiso.permitido) return { ok: false, error: permiso.razon }

  // ── Leer el PDF con los campos que declara el bloque ──
  const campos = await camposDeExtraccionFactura(svc, factura.lineaId, factura.slug)
  const buffer = Buffer.from(await archivo.arrayBuffer())
  const leido = await leerCamposFactura(buffer, campos)
  const nitCampo = factura.gate?.nit_campo ?? 'emisor_nit'
  const numeroCampo = factura.gate?.numero_campo ?? 'numero_factura'
  const emisorLeido = valorLeido(leido, nitCampo)
  const numeroLeido = valorLeido(leido, numeroCampo)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (svc as any)
    .from('workspaces').select('name').eq('id', workspaceId).maybeSingle()
  const nombreWorkspace = (ws?.name as string | undefined) || 'la empresa'

  const decision = decidirCargaManual({
    original: factura.original,
    resolucion: factura.resolucion,
    marca: factura.marca,
    emisorLeido,
    emisorNitEsperado: factura.gate?.emisor_nit_esperado,
    numero: modo === 'guardar' ? String(formData.get('numero') ?? '') : numeroLeido,
    motivo: modo === 'guardar' ? String(formData.get('motivo') ?? '') : null,
    nombreWorkspace,
  })

  if (modo === 'leer') {
    // Al leer solo se corta un PDF que no es del workspace. Número y motivo los
    // completa la persona antes de guardar.
    if (!decision.ok && (decision.rechazo === 'emisor_ajeno' || decision.rechazo === 'sin_emisor')) {
      return { ok: false, error: decision.mensaje, leido: { numero: numeroLeido, emisor: emisorLeido } }
    }
    return { ok: true, leido: { numero: numeroLeido, emisor: emisorLeido }, reemplaza: permiso.reemplaza }
  }

  if (!decision.ok) {
    return { ok: false, error: decision.mensaje, leido: { numero: numeroLeido, emisor: emisorLeido }, reemplaza: permiso.reemplaza }
  }

  // ── Guardar en el ORIGINAL ──
  const { staffId } = await getWorkspace()
  let nombre: string | null = null
  if (staffId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: st } = await (svc as any).from('staff').select('full_name').eq('id', staffId).maybeSingle()
    nombre = (st?.full_name as string | null) ?? null
  }
  const anterior = factura.original
  const motivo = String(formData.get('motivo') ?? '').trim() || null
  const valores: Record<string, string> = {}
  for (const c of campos) valores[c.slug] = valorLeido(leido, c.slug) ?? ''
  valores[numeroCampo] = decision.numero
  if (emisorLeido) valores[nitCampo] = emisorLeido

  const nombreArchivo = `${decision.numero.replace(/[^\w.-]+/g, '-')}.pdf`
  const arch = await archivarPdfEnBloque(
    workspaceId, negocioId, factura.slug, buffer, nombreArchivo, valores,
    {
      clave: '_cargas_manuales',
      entrada: {
        at: new Date().toISOString(),
        por: nombre,
        numero: decision.numero,
        reemplaza: decision.reemplaza,
        motivo,
        anterior: decision.reemplaza
          ? {
              file_name: (anterior?.file_name as string | undefined) ?? null,
              drive_url: (anterior?.drive_url as string | undefined) ?? null,
              origen: (anterior?.origen as string | undefined) ?? null,
            }
          : null,
      },
    },
    'cargada_manual',
  )
  if (!arch.ok) return { ok: false, error: `No se pudo guardar el PDF: ${arch.error}` }

  if (staffId) {
    const numeroAnterior = (anterior?.campos as Record<string, { value?: unknown }> | undefined)?.[numeroCampo]?.value
    const detalle = decision.reemplaza
      ? ` · reemplaza ${numeroAnterior ? String(numeroAnterior) : (anterior?.file_name as string | undefined) ?? 'el documento anterior'}. Motivo: ${motivo ?? ''}`
      : ''
    // `activity_log.contenido` tiene un CHECK de 280 caracteres: un motivo largo
    // tumbaría el INSERT entero.
    const contenido = `Factura ${decision.numero} cargada a mano desde Tesorería (origen: cargada_manual)${detalle}`.slice(0, 280)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await registrarActividad((svc as any), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'sistema',
      autor_id: staffId, // FK a staff(id), NO a profiles
      contenido,
    }, 'cargarFacturaManual')
  }

  // Si el caso esperaba su factura para cerrarse, esto es lo que le faltaba.
  try {
    await cerrarNegocioSiQuedaResuelto(svc, workspaceId, negocioId, staffId ?? null)
  } catch (e) {
    console.error('[facturacion] no se pudo evaluar el cierre automatico:', (e as Error).message)
  }

  revalidatePath('/conciliacion')
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true, numero: decision.numero, reemplaza: decision.reemplaza }
}

/** `campos_extraccion` del bloque de factura ORIGINAL de la línea. */
async function camposDeExtraccionFactura(
  svc: unknown,
  lineaId: string | null,
  slug: string,
): Promise<CampoExtraccion[]> {
  if (!lineaId) return CAMPOS_FACTURA_POR_DEFECTO
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (svc as any)
    .from('bloque_configs')
    .select('config_extra, etapas_negocio!inner(linea_id)')
    .eq('slug', slug)
    .eq('etapas_negocio.linea_id', lineaId)
    .limit(1)
  const declarados = ((data ?? [])[0]?.config_extra?.campos_extraccion ?? []) as CampoExtraccion[]
  return declarados.length > 0 ? declarados : CAMPOS_FACTURA_POR_DEFECTO
}

/** Una lectura con IA, con un reintento ante fallo transitorio. Nunca lanza. */
async function leerCamposFactura(
  buffer: Buffer,
  campos: CampoExtraccion[],
): Promise<Record<string, CampoResultado> | null> {
  const apiKey = getServerKey('gemini')
  if (!apiKey) return null
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const r = await extractFieldsFromDocument(buffer, 'application/pdf', campos, apiKey)
      if (r.data) {
        aplicarNormalizaciones(campos, r.data)
        return r.data
      }
      if (r.error?.startsWith('Contenido bloqueado')) return null
    } catch (e) {
      console.error('[facturacion] lectura del PDF falló:', (e as Error).message)
    }
  }
  return null
}

function valorLeido(leido: Record<string, CampoResultado> | null, slug: string): string | null {
  const v = leido?.[slug]?.value
  const t = v == null ? '' : String(v).trim()
  return t || null
}

// ── Recibo de caja del recaudo de la tarifa UPME ─────────────────────────────

export type ResultadoRecibo =
  | {
      ok: true
      numero: string
      valor: number
      archivada: boolean
      /** Los recibos que la emisión produjo. Desde el 2026-09-22 es uno: el de la tarifa. */
      recibos: Array<{ numero: string; valor: number }>
    }
  | { ok: false; error: string; duplicados?: Array<{ numero: string; fecha: string; valor: number }> }

/**
 * Por qué Tesorería no emite nada por un pago sin tarifa UPME.
 *
 * ⚠️ No se exporta: este archivo es `'use server'`, y exportar una constante anula TODOS
 * sus exports en el build (gotcha del 2026-08-06).
 */
const MENSAJE_SIN_TARIFA_UPME =
  'Este pago no trae tarifa UPME: no lleva recibo de caja. Su honorario se abona solo a la factura del negocio.'

/**
 * Emite el recibo de caja del recaudo de la tarifa UPME (RC-3). Es lo ÚNICO que emite.
 *
 * Brief del 2026-09-22 (Mauricio): «no nos debería permitir generar recibos de caja
 * diferentes a la tarifa UPME». Por eso esta acción —el botón de Tesorería › control de
 * recibos— pide a la emisión SOLO el componente `pasante`, y rechaza antes de tocar Siigo:
 *
 *   - una línea que no declara `recibo_por_concepto.pasante`: sin él la emisión caería al
 *     recibo por el TOTAL con el comprobante del workspace, que en SOENA es el RC-1 (4594)
 *     del honorario. Sería un RC-1 a mano por la puerta de atrás;
 *   - un pago sin porción UPME (`a_tarifa = 0` en `v_cobro_valor`): no tiene nada que
 *     emitir, y su honorario se abona solo a la factura (`abonos-factura.ts`);
 *   - un pago cuyo reparto no se conoce: no se sabe cuánto es tarifa, y adivinarlo es
 *     emitir un documento contable con un valor inventado.
 *
 * No acepta un valor escrito a mano: el recibo acusa la porción UPME que sale del reparto
 * del pago. Si el soporte dice otra cosa, lo que está mal es el monto del pago y se
 * corrige ahí (la emisión por concepto ya rechazaba cualquier otra cifra).
 *
 * ⚠️ No hay otra vía de servidor que emita un RC-1 de honorario a pedido de una persona:
 * el abono sale solo, sin botón (`abonarAlRegistrarPago`, al facturar y en el lote del
 * rezago, que es un script y no una server action).
 */
export async function emitirReciboDeNegocio(
  negocioId: string,
  opciones?: { justificacionDuplicado?: string; cobroId?: string },
): Promise<ResultadoRecibo> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { workspaceId } = ctx

  const { staffId, userId } = await getWorkspace()
  const svc = createServiceClient()

  // Quién emite, para la marca del recibo. Cuando el workspace no tiene staff propio de
  // esta persona —el caso del platform_admin trabajando dentro del workspace de un
  // cliente— el nombre sale de su perfil: `por` es texto en un jsonb, no una FK, así que
  // decir quién oprimió el botón no arrastra autoría de otro inquilino. Sin este respaldo
  // quedaron 7 marcas de 18 sin autor en SOENA (medido el 2026-09-22).
  const nombre = await nombreDeQuienActua(svc, { staffId, userId })

  // ── De qué COBRO es este recibo ──
  // Desde el 2026-09-03 el recibo cuelga del cobro. Tesorería sigue entrando por el
  // negocio, así que cuando no llega `cobroId` se resuelve el cobro pendiente más
  // reciente: es el que acaba de entrar y el que la persona está mirando. Si el negocio
  // no tiene ningún cobro sin recibo, no hay plata nueva que acusar.
  //
  // ⚠️ Este camino solo ve los cobros **sin ninguna marca**. El panel de recibos siempre
  // pasa `cobroId`.
  let cobroId = opciones?.cobroId
  if (!cobroId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pendientes } = await (svc as any)
      .from('cobros')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .is('siigo_recibo', null)
      .is('anulado_at', null)
      .order('fecha', { ascending: false })
      .limit(1)
    cobroId = ((pendientes ?? [])[0] as { id: string } | undefined)?.id
  }

  if (!cobroId) {
    return {
      ok: false,
      error: 'Este caso no tiene ningún pago registrado sin recibo. Registra el pago primero.',
    }
  }

  // ── Config de la línea: dónde archivar y con qué concepto ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negLinea } = await (svc as any)
    .from('negocios').select('linea_id').eq('id', negocioId).eq('workspace_id', workspaceId).single()
  let bloqueReciboSlug: string | undefined
  let porConcepto: ConfigReciboPorConcepto | null = null
  if (negLinea?.linea_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: linea } = await (svc as any)
      .from('lineas_negocio').select('config_extra').eq('id', negLinea.linea_id).maybeSingle()
    const cfgSiigo = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as
      { bloque_recibo_slug?: string } | undefined
    bloqueReciboSlug = cfgSiigo?.bloque_recibo_slug
    porConcepto = leerReciboPorConcepto(cfgSiigo)
  }

  if (!porConcepto?.pasante) {
    return {
      ok: false,
      error: 'La línea de este negocio no declara el recibo de la tarifa UPME '
        + '(recibo_por_concepto.pasante). Desde Tesorería solo se emite ese recibo.',
    }
  }

  // ── ¿Este pago trae tarifa UPME? ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fila } = await (svc as any)
    .from('v_cobro_valor').select('a_tarifa').eq('cobro_id', cobroId).maybeSingle()
  if (!fila) {
    return {
      ok: false,
      error: 'No se sabe cuánto de este pago es tarifa UPME: el pago no tiene reparto. Revisa su monto y su negocio.',
    }
  }
  if (!(Number((fila as { a_tarifa?: unknown }).a_tarifa ?? 0) > 0)) {
    return { ok: false, error: MENSAJE_SIN_TARIFA_UPME }
  }

  const r = await emitirReciboDeCobro(workspaceId, cobroId, nombre, {
    bloqueReciboSlug,
    porConcepto,
    // ⚠️ Regla 1 del brief: el botón de Tesorería emite SOLO el RC-3. El honorario no
    // sale por aquí ni como anticipo ni como abono.
    soloComponentes: ['pasante'],
    justificacionDuplicado: opciones?.justificacionDuplicado,
    // Emitido por una persona que decidió hacerlo: el cliente recibe el «recibimos tu
    // pago» con este RC-3.
    avisarAlCliente: true,
  })

  if (!r.ok) {
    if (r.motivo === 'duplicado_en_siigo') {
      return {
        ok: false,
        error: `Siigo ya tiene ${r.existentes.length === 1 ? 'un recibo' : `${r.existentes.length} recibos`} de este cliente por ese mismo valor.`,
        duplicados: r.existentes,
      }
    }
    const mensajes: Record<string, string> = {
      ya_emitido: r.motivo === 'ya_emitido'
        ? (r.numero ? `Este pago ya tiene el recibo ${r.numero}.` : 'La tarifa UPME de este pago ya tiene su recibo.')
        : '',
      sin_valor: 'El valor tiene que ser mayor que cero.',
      anulado: 'Ese pago está anulado: no se le puede emitir recibo.',
      faltan_datos: r.motivo === 'faltan_datos' ? `Faltan datos: ${r.faltantes.join(', ')}.` : '',
      error: r.motivo === 'error' ? r.mensaje : '',
    }
    return { ok: false, error: mensajes[r.motivo] || 'No se pudo emitir el recibo.' }
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return {
    ok: true,
    numero: r.numero,
    valor: r.valor,
    archivada: r.archivada,
    recibos: r.recibos.map(x => ({ numero: x.numero, valor: x.valor })),
  }
}
