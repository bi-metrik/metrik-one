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
import { todayBogotaISO } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { canEditBloque, type Area, type Role, type UserContext } from '@/lib/permissions/can-edit'
import { borradorCliente, borradorFactura, borradorRecibo, type RutExtraido } from '@/lib/siigo/mapeo'
import { emitirReciboNegocio } from '@/lib/siigo/recibos'
import { siigoRequest, type SiigoConfig } from '@/lib/siigo/client'
import {
  conceptoFactura,
  type ConceptosConfig,
  type ServicioContratado,
} from '@/lib/siigo/concepto'
import { emitirFacturaNegocio, type FacturaEnSiigo, type MarcaFactura } from '@/lib/siigo/facturas'
import { leerModeloDineroCompleto } from '@/lib/actions/conciliacion-actions'
import { sumarRecaudoConfirmado, type CobroParaRecaudo } from '@/lib/negocios/recaudo-confirmado'
import { descuadreConciliacion, tarifaConfirmadaPorNegocio } from '@/lib/upme/modelo-dinero'
import { casoListoParaFacturar } from '@/lib/facturacion/caso-listo'
import { numeroFacturaEnData } from '@/lib/siigo/factura-cargada'
import { idsDeCopiasDelBloque } from '@/lib/negocios/copias-del-bloque'
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
   * Celular del contacto. Ya se leía para el borrador del cliente de Siigo; se
   * expone para poder buscar por él, que es como el equipo identifica un caso
   * cuando el cliente llama. No se pinta en la fila.
   */
  telefono: string | null
  /**
   * Correo del contacto. Es el que Siigo usa para MANDAR la factura electrónica,
   * así que se expone para poder revisarlo y corregirlo antes de emitir.
   */
  email: string | null
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
  /** Qué le falta al borrador del recibo del recaudo UPME. */
  faltan_recibo: string[]
  /** Ya tiene número de factura registrado en el negocio. */
  ya_facturado: boolean
  /** Número de la factura, cuando la emitió ONE contra Siigo. */
  factura_numero: string | null
  /** Consecutivo del recibo de caja del recaudo UPME, si ya se emitió. */
  recibo_numero: string | null
  /**
   * Base gravable que viajaría a Siigo. Sale del MISMO `borradorFactura` que se
   * enviaría, no de una división hecha en la pantalla: si la pantalla calculara
   * su propio desglose podría mostrar un número distinto del que se emite.
   */
  base_gravable: number | null
  /**
   * Lo que falta recaudar del HONORARIO. Solo se factura en cero (con la
   * tolerancia de materialidad). Nunca se mide contra honorario + tarifa: quien
   * le paga la tarifa directo a la UPME no le debe nada a SOENA.
   */
  falta_saldo: number
  /** Sacado de la cola a mano durante la puesta al día. Reversible. */
  descartado: { at: string; por: string | null; motivo: string | null } | null
}

export interface ColaFacturacion {
  casos: CasoPorFacturar[]
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
  totales: { listos: number; incompletos: number; ya_facturados: number; descartados: number; valor_listo: number }
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

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export async function getColaFacturacion(): Promise<{ data: ColaFacturacion | null; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { data: null, error: ctx.error }
  const { workspaceId } = ctx
  const svc = createServiceClient()

  // ── Configuración del workspace ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (svc as any)
    .from('workspaces').select('config_extra').eq('id', workspaceId).single()
  const cfgWs = (ws?.config_extra ?? {}) as Record<string, unknown>
  const siigoCfg = cfgWs.siigo_config as SiigoConfig | undefined
  const siigo_configurado = !!siigoCfg && !!cfgWs.siigo_access_key

  // ── Desde qué etapa se habilita ──
  // Opt-in por línea. Sin el dato NO se asume nada: la cola sale vacía y la
  // pantalla lo dice, en vez de inventar un criterio y llenar la bandeja de
  // casos que nadie mandó facturar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lineas } = await (svc as any)
    .from('lineas_negocio').select('id, config_extra').eq('workspace_id', workspaceId)
  let desde: number | null = null
  // Los conceptos se resuelven POR LÍNEA: cada una vende cosas distintas y su
  // catálogo de Siigo no tiene por qué coincidir.
  const conceptosPorLinea = new Map<string, ConceptosConfig>()
  // Dónde vive el bloque de la factura en cada línea. Se usa para saber si el caso
  // ya tiene una factura CARGADA, que es distinto de emitida desde aquí.
  const facturaSlugPorLinea = new Map<string, string>()
  for (const l of ((lineas ?? []) as Array<{ id: string; config_extra?: Record<string, unknown> | null }>)) {
    const f = (l.config_extra?.facturacion ?? {}) as { desde_etapa_numero?: number }
    if (typeof f.desde_etapa_numero === 'number' && desde === null) desde = f.desde_etapa_numero
    const s = (l.config_extra?.siigo ?? {}) as { conceptos?: ConceptosConfig; bloque_factura_slug?: string }
    if (s.conceptos) conceptosPorLinea.set(l.id, s.conceptos)
    if (s.bloque_factura_slug) facturaSlugPorLinea.set(l.id, s.bloque_factura_slug)
  }
  if (desde == null) {
    return { data: { casos: [], desde_etapa_numero: null, siigo_configurado, descarte_abierto: ventanaDescarteAbierta(), descarte_hasta: DESCARTE_FACTURACION_HASTA, productos: [], totales: { listos: 0, incompletos: 0, ya_facturados: 0, descartados: 0, valor_listo: 0 } } }
  }

  // ── Negocios candidatos ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negocios } = await (svc as any)
    .from('negocios')
    .select('id, codigo, nombre, precio_aprobado, contacto_id, linea_id, metadata, etapas_negocio!inner(nombre, numero)')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')
  type Neg = {
    id: string; codigo: string | null; nombre: string | null
    precio_aprobado: number | null; contacto_id: string | null
    linea_id: string | null
    metadata: Record<string, unknown> | null
    etapas_negocio: { nombre: string | null; numero: number | null } | null
  }
  const candidatos = ((negocios ?? []) as Neg[])
    .filter(n => (n.etapas_negocio?.numero ?? 0) > desde!)
  if (candidatos.length === 0) {
    return { data: { casos: [], desde_etapa_numero: desde, siigo_configurado, descarte_abierto: ventanaDescarteAbierta(), descarte_hasta: DESCARTE_FACTURACION_HASTA, productos: [], totales: { listos: 0, incompletos: 0, ya_facturados: 0, descartados: 0, valor_listo: 0 } } }
  }
  const ids = candidatos.map(n => n.id)

  // ── Bloques que alimentan los borradores ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloques } = await (svc as any)
    .from('negocio_bloques')
    .select('negocio_id, data, bloque_configs!inner(slug)')
    .in('negocio_id', ids)
    .in('bloque_configs.slug', ['rut', 'comprobante_pago_upme', 'factura_emitida', 'servicio_contratado'])
  // ⚠️ Los bloques `datos` guardan plano (`data.servicio`) y los `documento` bajo
  // `data.campos[slug].value`. Leer el servicio como si fuera documento devuelve
  // null para todos y el concepto caería al default sin que nadie lo note.
  type Bl = {
    negocio_id: string
    data: ({ campos?: Record<string, { value?: unknown }> } & Record<string, unknown>) | null
    bloque_configs: { slug: string }
  }

  const rutPorNegocio = new Map<string, RutExtraido>()
  const upmePorNegocio = new Map<string, number>()
  const facturadoPorNegocio = new Set<string>()
  const servicioPorNegocio = new Map<string, unknown>()

  for (const b of ((bloques ?? []) as unknown as Bl[])) {
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
    } else if (slug === 'factura_emitida') {
      if (numeroFacturaEnData(b.data)) facturadoPorNegocio.add(b.negocio_id)
    } else if (slug === 'servicio_contratado') {
      // Plano, no bajo `campos`. Conserva la primera instancia con valor: el
      // bloque vive en Negociación y se hereda de solo lectura aguas abajo.
      const v = b.data?.servicio
      if (v != null && v !== '' && !servicioPorNegocio.has(b.negocio_id)) {
        servicioPorNegocio.set(b.negocio_id, v)
      }
    }
  }

  // ── Saldo del honorario, en lote ───────────────────────────────────────────
  // La cola no puede mostrar como "listo" a quien todavía debe: se factura con el
  // honorario cubierto. Se resuelve por lote (177 casos) y con los MISMOS helpers
  // que usan el panel de conciliación y los gates de avance, para que las tres
  // superficies no tengan tres restas distintas.
  const [cobrosRes, conciliadoRes, tarifaRes, certRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).from('cobros').select('negocio_id, monto, tipo_cobro, split_json').in('negocio_id', ids),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).from('negocio_conciliacion').select('negocio_id, conciliado').in('negocio_id', ids),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).from('negocio_bloques').select('negocio_id, data, bloque_configs!inner(slug)')
      .in('negocio_id', ids).eq('bloque_configs.slug', 'confirmar_tarifa_upme'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).from('negocio_bloques').select('negocio_id, data, bloque_configs!inner(slug)')
      .in('negocio_id', ids).eq('bloque_configs.slug', 'servicio_contratado'),
  ])

  const cobrosPorNegocio = new Map<string, CobroParaRecaudo[]>()
  for (const c of ((cobrosRes.data ?? []) as Array<CobroParaRecaudo & { negocio_id: string }>)) {
    if (!cobrosPorNegocio.has(c.negocio_id)) cobrosPorNegocio.set(c.negocio_id, [])
    cobrosPorNegocio.get(c.negocio_id)!.push(c)
  }
  const conciliados = new Set(
    ((conciliadoRes.data ?? []) as Array<{ negocio_id: string; conciliado: boolean }>)
      .filter(x => x.conciliado === true).map(x => x.negocio_id),
  )
  const tarifas = tarifaConfirmadaPorNegocio(
    (tarifaRes.data ?? []) as Array<{ negocio_id: string; data: Record<string, unknown> | null }>,
    (certRes.data ?? []) as Array<{ negocio_id: string; data: Record<string, unknown> | null }>,
  )

  // ── Contactos (email y teléfono ganan sobre el RUT: los mantiene el comercial) ──
  const contactoIds = candidatos.map(n => n.contacto_id).filter((x): x is string => !!x)
  const contactos = new Map<string, { email: string | null; telefono: string | null }>()
  if (contactoIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cs } = await (svc as any)
      .from('contactos').select('id, email, telefono').in('id', contactoIds)
    for (const c of ((cs ?? []) as Array<{ id: string; email: string | null; telefono: string | null }>)) {
      contactos.set(c.id, { email: c.email, telefono: c.telefono })
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
  // La factura que se cargó a mano NO tiene por qué estar en la copia nativa del
  // bloque: se sube desde la etapa donde esté el caso, y cada copia guarda en su
  // propia fila. Sin leerlas todas, un negocio con su factura ya cargada adentro
  // vuelve a la cola como si nunca se hubiera facturado. Ver `idsDeCopiasDelBloque`.
  const copiasFactura: string[] = []
  for (const [lineaId, slugFactura] of facturaSlugPorLinea) {
    copiasFactura.push(...(await idsDeCopiasDelBloque(svc, lineaId, slugFactura)))
  }
  if (copiasFactura.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: filasFactura } = await (svc as any)
      .from('negocio_bloques')
      .select('negocio_id, data')
      .in('negocio_id', ids)
      .in('bloque_config_id', copiasFactura)
    for (const f of ((filasFactura ?? []) as Array<{ negocio_id: string; data: unknown }>)) {
      if (numeroFacturaEnData(f.data)) facturadoPorNegocio.add(f.negocio_id)
    }
  }

  // Fecha del documento fiscal. Va a Siigo, asi que es el dia civil de Bogota y no
  // el de UTC: emitir a las 8 p.m. del 31 fechaba la factura el 1 del mes siguiente.
  const hoy = todayBogotaISO()

  const casos: CasoPorFacturar[] = candidatos.map(n => {
    const rut = rutPorNegocio.get(n.id) ?? {}
    const contacto = contactos.get(n.contacto_id ?? '') ?? { email: null, telefono: null }
    const cli = borradorCliente(rut, contacto)
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
    const rec = borradorRecibo(cfgEval, cli.payload.identification, upme, hoy)

    const recaudado = sumarRecaudoConfirmado(cobrosPorNegocio.get(n.id) ?? [], conciliados.has(n.id))
    const { faltante } = descuadreConciliacion(
      honorario ?? 0,
      { tarifa_upme: tarifas.get(n.id) ?? 0, aprobado_plan: null, aprobado_honorario: honorario },
      recaudado,
    )
    const marcaFactura = (n.metadata?.siigo_factura ?? null) as MarcaFactura | null

    return {
      negocio_id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      etapa: n.etapas_negocio?.nombre ?? null,
      etapa_numero: n.etapas_negocio?.numero ?? null,
      identificacion: cli.payload.identification || null,
      cliente: cli.payload.name.filter(Boolean).join(' ') || null,
      telefono: contacto.telefono,
      email: contacto.email,
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
      faltan_recibo: rec.faltantes,
      // Dos fuentes: el bloque donde se carga el PDF de la factura, y la marca que
      // deja la emisión desde aquí. La segunda hace falta porque emitir NO obliga a
      // cargar el soporte, y sin ella el caso volvería a la cola listo para
      // re-facturarse.
      ya_facturado: facturadoPorNegocio.has(n.id) || !!marcaFactura?.numero,
      factura_numero: marcaFactura?.numero ?? null,
      recibo_numero: ((n.metadata?.siigo_recibo ?? null) as { numero?: string } | null)?.numero ?? null,
      base_gravable: fac.payload.items[0]?.price ?? null,
      falta_saldo: faltante,
      descartado: (n.metadata?.facturacion_descartada as CasoPorFacturar['descartado']) ?? null,
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

  const pendientes = casos.filter(c => !fuera(c))
  return {
    data: {
      casos,
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
    .from('negocios').select('id, metadata').eq('id', negocioId).eq('workspace_id', workspaceId).single()
  if (!neg) return { ok: false, error: 'Negocio no encontrado' }

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
    .from('negocios').select('id, metadata').eq('id', negocioId).eq('workspace_id', workspaceId).single()
  if (!neg) return { ok: false, error: 'Negocio no encontrado' }

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
   * Siigo ya tiene factura de este producto para el cliente. La pantalla debe
   * mostrarlas y pedir justificación; NO se emite hasta que alguien la escriba.
   */
  duplicados?: FacturaEnSiigo[]
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
     * campos que el cliente puede mandar además del id: datos de contacto y el
     * concepto. El valor, la identificación y el saldo se siguen resolviendo aquí.
     */
    datos?: { email?: string; telefono?: string; productoCode?: string }
  },
): Promise<ResultadoEmitir> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { workspaceId } = ctx

  const { supabase, staffId } = await getWorkspace()
  const svc = createServiceClient()

  let nombre: string | null = null
  if (staffId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: st } = await (svc as any).from('staff').select('full_name').eq('id', staffId).maybeSingle()
    nombre = (st?.full_name as string | null) ?? null
  }

  // Modelo de dinero y recaudo, con los mismos helpers que el resto del producto.
  const modelo = await leerModeloDineroCompleto(supabase, negocioId)
  const [{ data: cobros }, { data: conc }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).from('cobros').select('monto, tipo_cobro, split_json')
      .eq('negocio_id', negocioId).eq('workspace_id', workspaceId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).from('negocio_conciliacion').select('conciliado')
      .eq('negocio_id', negocioId).eq('workspace_id', workspaceId).maybeSingle(),
  ])
  const recaudado = sumarRecaudoConfirmado(
    (cobros ?? []) as CobroParaRecaudo[],
    (conc as { conciliado: boolean } | null)?.conciliado === true,
  )

  // Dónde archivar el PDF: se declara por línea, junto al resto de la config de
  // Siigo. Sin el dato la factura sale igual, pero el archivo no queda en el
  // expediente y la pantalla lo dice, en vez de callarlo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negLinea } = await (svc as any)
    .from('negocios').select('linea_id').eq('id', negocioId).eq('workspace_id', workspaceId).single()
  let bloqueFacturaSlug: string | undefined
  if (negLinea?.linea_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: linea } = await (svc as any)
      .from('lineas_negocio').select('config_extra').eq('id', negLinea.linea_id).maybeSingle()
    const cfgSiigo = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as
      { bloque_factura_slug?: string } | undefined
    bloqueFacturaSlug = cfgSiigo?.bloque_factura_slug
  }

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

  const r = await emitirFacturaNegocio(
    workspaceId,
    negocioId,
    nombre,
    {
      bloqueFacturaSlug,
      datos: opciones?.datos,
      // Por defecto se RADICA: el botón dice "facturar electrónicamente" y una
      // pantalla que promete eso no puede dejar un borrador sin avisar. El modo
      // sin radicar existe para la primera prueba controlada con Diana.
      emitir: opciones?.emitir !== false,
      enviarCorreo: opciones?.enviarCorreo === true,
      justificacionDuplicado: opciones?.justificacionDuplicado,
    },
    { modelo, recaudado, staffId },
  )

  if (!r.ok) {
    switch (r.motivo) {
      case 'duplicado_en_siigo':
        return { ok: false, duplicados: r.existentes, error: 'Siigo ya tiene una factura de este servicio para el cliente' }
      case 'saldo_pendiente': {
        const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
        return { ok: false, error: `Falta recaudar ${fmt.format(r.faltante)} del honorario` }
      }
      case 'faltan_datos':
        return { ok: false, error: `Faltan datos: ${r.faltantes.join(', ')}` }
      case 'ya_facturado_en_one':
        return { ok: false, error: `Este negocio ya se facturó (${r.numero})` }
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
      contenido: r.emitida
        ? `Factura ${r.numero} emitida en Siigo`
        : `Factura ${r.numero} creada en Siigo SIN radicar ante la DIAN`,
    }, 'emitirFacturaDeNegocio')
  }

  revalidatePath('/conciliacion')
  return { ok: true, numero: r.numero, borrador: !r.emitida, archivada: r.archivada }
}

// ── Recibo de caja del recaudo de la tarifa UPME ─────────────────────────────

export type ResultadoRecibo =
  | { ok: true; numero: string; valor: number; archivada: boolean }
  | { ok: false; error: string; duplicados?: Array<{ numero: string; fecha: string; valor: number }> }

/**
 * Emite el recibo de caja del recaudo de la tarifa UPME.
 *
 * ⚠️ **El valor lo decide quien emite, no el sistema.** Puede venir del comprobante
 * extraído, pero los casos que entraron por el cargue masivo NO tienen ese comprobante
 * — nacieron antes de que existiera el punto de control — y son la mayoría: medido el
 * 2026-08-12, de 171 casos con el bloque solo **18** traen el valor. Por eso la captura
 * a mano es el camino frecuente y no una excepción.
 *
 * Cuando `valorPagado` no llega, se usa el del comprobante; si tampoco está, se rechaza
 * en vez de emitir un recibo en cero (que consumiría numeración sin documentar nada).
 */
export async function emitirReciboDeNegocio(
  negocioId: string,
  opciones?: { valorPagado?: number; justificacionDuplicado?: string },
): Promise<ResultadoRecibo> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { workspaceId } = ctx

  const { staffId } = await getWorkspace()
  const svc = createServiceClient()

  let nombre: string | null = null
  if (staffId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: st } = await (svc as any).from('staff').select('full_name').eq('id', staffId).maybeSingle()
    nombre = (st?.full_name as string | null) ?? null
  }

  // ── El valor: el capturado gana sobre el extraído ──
  // Quien emite está mirando el comprobante; si corrige el número, es porque el
  // extraído está mal. La extracción es una ayuda, no la autoridad.
  let valor = opciones?.valorPagado
  if (valor == null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: bloques } = await (svc as any)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug)')
      .eq('negocio_id', negocioId)
    const upme = ((bloques ?? []) as Array<{ data: Record<string, unknown> | null; bloque_configs: { slug: string | null } }>)
      .find(b => b.bloque_configs?.slug === 'comprobante_pago_upme')
    const campos = (upme?.data?.campos ?? {}) as Record<string, { value?: unknown }>
    const crudo = campos.valor_pagado?.value
    const n = typeof crudo === 'number' ? crudo : Number(String(crudo ?? '').replace(/[^\d]/g, ''))
    if (Number.isFinite(n) && n > 0) valor = n
  }

  if (valor == null || !(valor > 0)) {
    return {
      ok: false,
      error: 'Falta el valor pagado a la UPME. Cárgalo en el comprobante o escríbelo al emitir.',
    }
  }

  // ── Dónde archivar el PDF: declarado por línea, junto al resto de la config ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negLinea } = await (svc as any)
    .from('negocios').select('linea_id').eq('id', negocioId).eq('workspace_id', workspaceId).single()
  let bloqueReciboSlug: string | undefined
  if (negLinea?.linea_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: linea } = await (svc as any)
      .from('lineas_negocio').select('config_extra').eq('id', negLinea.linea_id).maybeSingle()
    const cfgSiigo = ((linea?.config_extra ?? {}) as Record<string, unknown>).siigo as
      { bloque_recibo_slug?: string } | undefined
    bloqueReciboSlug = cfgSiigo?.bloque_recibo_slug
  }

  const r = await emitirReciboNegocio(workspaceId, negocioId, valor, nombre, {
    bloqueReciboSlug,
    justificacionDuplicado: opciones?.justificacionDuplicado,
  })

  if (!r.ok) {
    if (r.motivo === 'duplicado_en_siigo') {
      return {
        ok: false,
        error: `Siigo ya tiene ${r.existentes.length === 1 ? 'un recibo' : `${r.existentes.length} recibos`} de este cliente por la tarifa.`,
        duplicados: r.existentes,
      }
    }
    const mensajes: Record<string, string> = {
      ya_emitido: r.motivo === 'ya_emitido' ? `Este caso ya tiene el recibo ${r.numero}.` : '',
      sin_valor: 'El valor tiene que ser mayor que cero.',
      faltan_datos: r.motivo === 'faltan_datos' ? `Faltan datos: ${r.faltantes.join(', ')}.` : '',
      error: r.motivo === 'error' ? r.mensaje : '',
    }
    return { ok: false, error: mensajes[r.motivo] || 'No se pudo emitir el recibo.' }
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return { ok: true, numero: r.numero, valor: r.valor, archivada: r.archivada }
}
