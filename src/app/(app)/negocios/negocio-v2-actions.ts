'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { RAZONES_PERDIDA_NEGOCIO, MOTIVOS_CANCELACION, MOTIVOS_PAUSA, MAX_PAUSAS, MAX_DIAS_PAUSA, SAFETY_NET_HORAS, leerMarcasDeMetadata, origenDesdeFuenteInteraccion, type MarcaCondicion } from '@/lib/negocios/constants'
import { esOrigenNegocioValido, ORIGEN_ALIANZA } from '@/lib/catalogos/constants'
import { ensureNegocioDriveFolder } from '@/lib/negocios/ensure-drive-folder'
import { faltaHonorarioConfirmado, type ConfigCobro } from '@/lib/negocios/honorario-confirmado'
import { horasHabilesEntre, slaHorasDeEtapa } from '@/lib/negocios/horas-habiles'
import type { GuiaEtapa } from '@/lib/negocios/guia-etapa'
import { todayBogotaISO, bogotaYear } from '@/lib/dates/bogota'
import { bloqueTipoCode } from '@/components/workflow/types'
import { mapCiudadASeccional, requiereCitaDian, nombreOficialSeccional, labelCanonicoSeccional } from '@/lib/dian/seccionales'
import { fijarSeccionalNegocio } from '@/lib/negocios/seccional-negocio'
import { aplicarComputedAutoFill } from '@/lib/upme/auto-fill'
import { calcularPendienteHandoff, valorARecaudar, esCeroDeliberado, descuadreConciliacion, TOLERANCIA_SALDO_COP, type PendienteHandoff, type ModeloDinero } from '@/lib/upme/modelo-dinero'
import { saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'
import { camposRequeridosFaltantes, type CampoConfig } from '@/lib/negocios/campo-completo'
import { aplicaSaltoPorSaldo, debeSaltarPorSaldo, MAX_SALTOS_ENCADENADOS } from '@/lib/negocios/salto-etapa'
import { confirmacionAvance, type ConfirmacionAvance } from '@/lib/negocios/confirmacion-avance'
import {
  sumarRecaudoConfirmado,
  recaudoPendienteDeConfirmar,
  type CobroParaRecaudo,
} from '@/lib/negocios/recaudo-confirmado'
import {
  exigeDatoDeDecision,
  camposDeDecision,
  decisionesSinResponder,
  mensajeDatoFaltante,
  type RoutingEtapa,
  type CampoDecision,
} from '@/lib/negocios/dato-de-decision'
import { visiblePuedeNacerCompleto, gateVisibleQuedaResuelto, documentoHeredadoNaceCompleto } from '@/lib/negocios/bloque-visible-completo'
import { resolverDerivado, type LockWhen } from '@/lib/negocios/campo-derivado'
import { puedeOmitirGate, marcaOmitido, CLAVE_OMITIDO } from '@/lib/negocios/gate-omitible'
import { soloLecturaPorDatoLleno } from '@/lib/negocios/editable-si-vacio'
import { recolectarReferenciasFuente, aplanarDataBloque } from '@/lib/negocios/referencias-fuente'
import { refrescarVigenciaCrossCheck, type CrossCheckGuardado, type SpecVigencia } from '@/lib/documentos/refrescar-vigencia'
import { calcularDvNit, nitSinDv } from '@/lib/dian/nit'
import { calcularTarifaUpmePorAnio } from '@/lib/upme/tarifa'
import { registrarCorrecciones, contextoCorreccion, esCausaValida, type CampoCorregido, type CausaCorreccion } from '@/lib/correcciones/registrar'
import { retornosPosibles, retornosDisparados, ejecutarRetorno } from '@/lib/correcciones/retorno'
import {
  detectarReversa,
  guardarPropuesta,
  ejecutarReversa,
  descartarPropuesta,
  type PropuestaPendiente,
} from '@/lib/correcciones/reversa'
import type { EpaycoCostoCobro } from '@/lib/epayco'
import { STAGE_TO_AREA, getAreasEfectivas, puedeAutorizarCierreNoFacturable, puedeDevolverCasoPorRuta, type Area, type Role, type Stage } from '@/lib/permissions/can-edit'
import { guardEditarBloque, guardAvanzarStage, guardVerNegocio } from '@/lib/permissions/guard-negocio'
import { puedeCorregirDocumentos } from '@/lib/roles'
import { crearClienteSiigoAlAvanzar } from '@/lib/siigo/clientes'
import { crearCobrosSoenaCore, leerModeloDineroNegocio, leerModeloDineroCompleto } from '@/lib/actions/conciliacion-actions'
import { asignarResponsable } from '@/lib/negocios/responsable-rol'
import { leerAviso } from '@/lib/correcciones/retroceso'

// ── Tipos inline para el nuevo schema de negocios ─────────────────────────────
// Las tablas nuevas (negocios, lineas_negocio, etapas_negocio, bloque_configs,
// bloque_definitions, negocio_bloques, bloque_items) aún no están en database.ts.
// Usar tipos inline. El cliente Supabase se castea via `db()` para evitar el error
// "Type instantiation is excessively deep" al acceder a tablas desconocidas.

export type LineaNegocio = {
  id: string
  workspace_id: string | null
  nombre: string
  tipo: 'plantilla' | 'clarity'
  numero: number
}

export type EtapaNegocio = {
  id: string
  linea_id: string
  stage: 'venta' | 'ejecucion' | 'cobro'
  nombre: string
  orden: number
  numero: number
  // config_extra.etapa_cierre = true → esta etapa es el ÚNICO punto de cierre
  // del negocio (reemplaza la ventana "últimas 3 por orden"). Opt-in por línea.
  es_cierre?: boolean
  // config_extra.buzon_leads = true → buzón de entrada (Recepción). Al descartar
  // desde aquí se piden razones de triage de lead, no de pérdida de venta.
  es_buzon?: boolean
  // config_extra.guia → la ayuda de la etapa, en la etapa. Se muestra sobre los
  // bloques para responder, sin salir de la pantalla, las tres preguntas que se
  // hace quien abre un caso: dónde está, qué le toca y qué falta para avanzar.
  // Opt-in: una línea sin `guia` se ve exactamente igual que hoy.
  guia?: GuiaEtapa | null
}

/**
 * Ayuda contextual de una etapa. El tipo vive en `@/lib/negocios/guia-etapa` porque
 * también lo consume la vista del flujo, que no pasa por estas server actions.
 * Se re-exporta para no romper a quien ya lo importaba desde aquí.
 */
export type { GuiaEtapa } from '@/lib/negocios/guia-etapa'

export type BloqueDefinition = {
  id: string
  tipo: string
  nombre: string
  is_visualization: boolean
  can_be_gate: boolean
}

export type BloqueConfig = {
  id: string
  etapa_id: string
  workspace_id: string
  bloque_definition_id: string
  estado: 'editable' | 'visible'
  orden: number
  es_gate: boolean
  nombre: string | null
  bloque_definitions: BloqueDefinition | null
  /** ID corto unico dentro de la linea (ej: DC1, DA2, CB1). Calculado en runtime */
  block_id?: string
}

export type NegocioBloque = {
  id: string
  negocio_id: string
  bloque_config_id: string
  estado: 'pendiente' | 'completo'
  data: Record<string, unknown> | null
  completado_at?: string | null
  completado_por?: string | null
}

export type NegocioDetalle = {
  id: string
  workspace_id: string
  linea_id: string | null
  empresa_id: string | null
  contacto_id: string | null
  nombre: string
  codigo: string | null
  precio_estimado: number | null
  precio_aprobado: number | null
  carpeta_url: string | null
  stage_actual: 'venta' | 'ejecucion' | 'cobro' | null
  etapa_actual_id: string | null
  estado: string | null
  tipo_cierre: string | null
  motivo_cierre: string | null
  lecciones_aprendidas: string | null
  balance_final: number | null
  created_at: string | null
  updated_at: string | null
  closed_at: string | null
  // Cierre modelo roles-areas-stages
  cierre_motivo: 'exitoso' | 'perdido' | 'cancelado' | null
  razon_cierre: string | null
  descripcion_cierre: string | null
  responsable_id: string | null
  // Pausa
  pausado: boolean
  pausado_hasta: string | null
  motivo_pausa: string | null
  motivo_pausa_detalle: string | null
  veces_pausado: number
  ultimo_pausado_at: string | null
  // Joins — usando columnas reales de las tablas existentes (empresas.nombre, contactos.nombre)
  lineas_negocio: { nombre: string; numero: number } | null
  etapas_negocio: { nombre: string; stage: string; numero: number } | null
  empresas: { id: string; nombre: string } | null
  contactos: { id: string; nombre: string } | null
  /** Multi-responsable (fuente de verdad: negocio_responsables N:M). */
  responsables: Array<{ id: string; full_name: string }>
  /**
   * Recaudo pendiente para pasar a operaciones. Presente (no null) solo cuando la
   * etapa actual tiene el gate `saldo:handoff` (ej. Documentación). El bloque de
   * Cobro lo muestra para que el comercial vea qué falta antes de intentar avanzar.
   */
  pendiente_handoff?: PendienteHandoff | null
  /**
   * Modelo de dinero del negocio (plan de pago + honorario + tarifa UPME), leído de
   * la propuesta aprobada. null si aún no hay propuesta aprobada. El bloque de Cobro
   * lo muestra para que financiera vea el plan elegido sin buscarlo en la propuesta.
   */
  modelo_dinero?: ModeloDinero | null
  /**
   * Valor a recaudar del cliente = precio_aprobado (honorario) + tarifa UPME
   * confirmada (pasante). Es la base del saldo del bloque de Cobros. Derivado, no
   * almacenado. Cuando no hay tarifa confirmada, = precio_aprobado (honorario).
   */
  valor_a_recaudar?: number | null
  /**
   * Costos ePayco descontados por cobro, keyed por ref_payco (= external_ref del
   * cobro). Reconstruido de los gastos epayco-*. El bloque de Cobro muestra, bajo cada
   * cobro por pasarela, la comisión + impuestos descontados y el neto recibido.
   */
  epayco_costos?: Record<string, EpaycoCostoCobro>
  /**
   * Borrador de factura para Siigo: datos del cliente ya capturados en el
   * expediente (RUT + contacto) + valor bruto (= honorario; la tarifa UPME es
   * pasante y va fuera de la factura de venta). El bloque de Facturación lo
   * muestra autopoblado para copiar a Siigo, con opción de override manual.
   * Mismo esquema que consumirá la API de Siigo a futuro. null si no aplica.
   */
  factura_draft?: FacturaDraft | null
}

/** Autopoblado del bloque de facturación (fuente para copiar a Siigo / API). */
export type FacturaDraft = {
  tipo_identificacion: string | null
  numero_identificacion: string | null
  dv: string | null
  nombre: string | null
  direccion: string | null
  ciudad: string | null
  email: string | null
  telefono: string | null
  valor_bruto: number | null
}

export type NegocioResumen = {
  id: string
  nombre: string
  codigo: string | null
  precio_estimado: number | null
  precio_aprobado: number | null
  carpeta_url: string | null
  stage_actual: 'venta' | 'ejecucion' | 'cobro' | null
  estado: string | null
  created_at: string | null
  // Joins
  linea_nombre: string | null
  linea_numero: number | null
  etapa_nombre: string | null
  etapa_numero: number | null
  etapa_stage: string | null
  empresa_nombre: string | null
  contacto_nombre: string | null
  /** Celular del contacto. Solo para la búsqueda: la tarjeta no lo muestra. */
  contacto_telefono: string | null
  // Ejecucion
  costos_ejecutados: number
  // Pausa
  pausado: boolean
  pausado_hasta: string | null
  motivo_pausa: string | null
  // Cierre (modelo roles-areas-stages Fase 3+)
  cierre_motivo: 'exitoso' | 'perdido' | 'cancelado' | null
  closed_at: string | null
  razon_cierre: string | null
  // Tarjeta config-driven (config_extra.negocio_card) — null en ws sin config
  vehiculo_label: string | null
  seccional_label: string | null
  ciudad_label: string | null
  // Cédula/identificación del solicitante (bloque RUT, config-driven) — tarjeta + búsqueda
  cedula: string | null
  // Radicado de certificación (bloque DA22, config-driven) — tarjeta + búsqueda
  radicado: string | null
  // Número de factura emitida (bloque "Factura emitida", config-driven) — búsqueda
  numero_factura: string | null
  // Responsables asignados (negocio_responsables N:M) — para tarjeta + filtro de lista
  responsables: Array<{ id: string; full_name: string }>
  // Origen: true si el negocio llegó por la integración Meta Lead Ads (metadata.fuente_cargue)
  es_meta_lead: boolean
  // Reproceso abierto (metadata.reproceso.activo). Un tercero rechazó el trabajo y
  // hay que rehacer un tramo, con un cliente esperando algo que creía resuelto: se
  // muestra en la tarjeta para que sea visible sin abrir el negocio.
  reproceso: { tipo: string; ciclo: number; etapa_retorno: string | null } | null
  // ── Origen del negocio (columna, catálogo ORIGENES_NEGOCIO) ───────────────
  /** De dónde vino. null solo en negocios anteriores a la captura de origen. */
  origen: string | null
  /** Nombre del aliado cuando origen = 'alianza'. null en el resto. */
  aliado_nombre: string | null
  /** Marcas de condición económica (negocios.metadata.marcas). Vacío si no tiene. */
  marcas: MarcaCondicion[]
  // ── SLA de etapa (mismo criterio que /flujo y /equipo) ────────────────────
  /** Último avance de etapa. Base del cálculo de atraso. */
  etapa_cambiada_at: string | null
  /** SLA en horas hábiles configurado en la etapa (etapas_negocio.config_extra.sla_horas). null = etapa sin SLA. */
  etapa_sla_horas: number | null
  /** Horas hábiles Colombia transcurridas en la etapa. null si no hay etapa_cambiada_at o no hay SLA. */
  horas_habiles_en_etapa: number | null
  /** Horas hábiles por encima del SLA. >0 = atrasado. null si la etapa no tiene SLA. */
  sla_exceso_horas: number | null
}

// Helper: cast Supabase client a untyped para tablas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

/**
 * ¿Este negocio comparte una referencia de pago (external_ref NO-split) con OTRO
 * negocio abierto del workspace? Devuelve la primera referencia duplicada (string) o
 * null. Base del control de fraude: un negocio con duplicado sin resolver queda
 * congelado y no puede avanzar de etapa. Excluye splits deliberados (split_id) —
 * reparto sancionado, no duplicado accidental.
 */
async function negocioCongeladoPorDuplicado(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
): Promise<string | null> {
  // Referencias NO-split de este negocio.
  //
  // `anulado_at is null`: este control cuenta por PRESENCIA de la referencia, no por
  // monto, así que el cero de un cobro anulado no lo saca solo. Sin este filtro, anular
  // un pago mal cargado dejaría los dos negocios congelados para siempre — justo el
  // atasco que la anulación existe para deshacer. Ver `lib/cobros/anulacion.ts`.
  const { data: misCobros } = await db(supabase)
    .from('cobros')
    .select('external_ref, split_json')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .is('anulado_at', null)
    .not('external_ref', 'is', null)

  const misRefs = ((misCobros ?? []) as Array<{ external_ref: string | null; split_json: { split_id?: string } | null }>)
    .filter((c) => c.external_ref && !c.split_json?.split_id)
    .map((c) => c.external_ref as string)
  if (misRefs.length === 0) return null

  // ¿Alguna aparece en OTRO negocio abierto (NO-split)?
  const { data: otrosCobros } = await db(supabase)
    .from('cobros')
    .select('external_ref, negocio_id, split_json, negocios:negocio_id ( estado )')
    .eq('workspace_id', workspaceId)
    .in('external_ref', misRefs)
    .is('anulado_at', null)
    .neq('negocio_id', negocioId)

  for (const c of ((otrosCobros ?? []) as Array<{
    external_ref: string | null
    negocio_id: string
    split_json: { split_id?: string } | null
    negocios: { estado: string | null } | null
  }>)) {
    if (c.external_ref && !c.split_json?.split_id && c.negocios?.estado === 'abierto') {
      return c.external_ref
    }
  }
  return null
}

/** Compute initial data defaults from bloque_config config_extra.fields */
function computeFieldDefaults(configExtra: Record<string, unknown> | null): Record<string, unknown> {
  const fields = ((configExtra?.fields ?? []) as Array<{ slug: string; tipo?: string; default?: unknown }>)
  const defaults: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.default !== undefined) {
      defaults[f.slug] = f.default
    }
  }
  return defaults
}

/** Limpieza ligera de un valor declarado por el lead (formularios de Meta): quita
 *  guiones bajos de relleno y capitaliza los tokens tipo enum (natural, nuevo,
 *  híbrido). Deja intacto el texto libre con espacios/guiones (marca-línea-modelo,
 *  precio). Opt-in vía data_desde_metadata.clean. */
function limpiarValorDeclarado(v: string): string {
  const t = v.trim().replace(/^_+/, '').replace(/_+$/, '').trim()
  if (!t) return t
  if (/^\p{L}+$/u.test(t)) return t.charAt(0).toUpperCase() + t.slice(1)
  return t
}

/** Construye el `data` de un bloque `datos` a partir de negocios.metadata según
 *  config_extra.data_desde_metadata = { source, map:{fieldSlug: metaFieldName}, clean? }.
 *  `source` apunta a un arreglo [{name, values[]}] dentro de metadata (ej. el
 *  field_data de un lead de Meta). Genérico: cualquier workspace puede exponer
 *  datos de metadata en un bloque de solo lectura sin duplicarlos en DB. */
function dataDesdeMetadata(
  cfg: { source: string; map: Record<string, string>; clean?: boolean; numeric?: string[] },
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const arr = metadata[cfg.source]
  const byName = new Map<string, string>()
  if (Array.isArray(arr)) {
    for (const it of arr as Array<{ name?: string; values?: unknown[] }>) {
      if (it?.name && Array.isArray(it.values) && it.values.length) {
        byName.set(it.name, String(it.values[0]))
      }
    }
  }
  const numeric = new Set(cfg.numeric ?? [])
  const out: Record<string, unknown> = {}
  for (const [fieldSlug, metaName] of Object.entries(cfg.map)) {
    const raw = byName.get(metaName)
    if (raw == null) continue
    if (numeric.has(fieldSlug)) {
      // Valor declarado sucio ("76.000.000", "$ 132.734.513", "163000000") → número
      // para que el field tipo 'numero' lo renderice como currency. Se asume formato
      // colombiano sin decimales (los precios de vehículo no traen centavos).
      const n = Number(String(raw).replace(/[^\d]/g, ''))
      if (Number.isFinite(n) && n > 0) out[fieldSlug] = n
      continue
    }
    out[fieldSlug] = cfg.clean ? limpiarValorDeclarado(raw) : raw
  }
  return out
}

// ── Listar negocios del workspace ─────────────────────────────────────────────

export async function getNegociosV2(
  estado: 'abierto' | 'completado' | 'todos' = 'abierto',
  incluirPausados = false,
): Promise<NegocioResumen[]> {
  const { supabase, workspaceId, userId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // ── Modelo roles-areas-stages Fase 2: filtrado por operator ──
  // Operator solo ve negocios donde es responsable (negocio_responsables N:M).
  // Otros roles (owner/admin/supervisor/read_only) ven todos. Contador no llega aqui.
  let negocioIdsPermitidos: string[] | null = null
  if (role === 'operator' && staffId) {
    const { data: nrRows } = await db(supabase)
      .from('negocio_responsables')
      .select('negocio_id')
      .eq('staff_id', staffId)
    const ids = (nrRows ?? []).map((r: { negocio_id: string }) => r.negocio_id)
    if (ids.length === 0) return []
    negocioIdsPermitidos = ids
  }
  // userId unused outside future filters
  void userId

  let query = db(supabase)
    .from('negocios')
    .select(`
      id,
      nombre,
      codigo,
      precio_estimado,
      precio_aprobado,
      carpeta_url,
      stage_actual,
      estado,
      created_at,
      pausado,
      pausado_hasta,
      motivo_pausa,
      cierre_motivo,
      closed_at,
      razon_cierre,
      metadata,
      etapa_cambiada_at,
      origen,
      aliado_id,
      lineas_negocio(nombre, numero),
      etapas_negocio(nombre, stage, numero, config_extra),
      empresas(nombre),
      contactos(nombre, telefono)
    `)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (estado !== 'todos') {
    query = query.eq('estado', estado)
  }
  if (!incluirPausados) {
    query = query.eq('pausado', false)
  }
  if (negocioIdsPermitidos) {
    query = query.in('id', negocioIdsPermitidos)
  }

  const { data } = await query

  if (!data) return []

  // Batch: gastos por negocio
  const negocioIds = (data as Record<string, unknown>[]).map(r => r.id as string)
  const [gastosRes, horasRes, staffRes, wsRes, respRes, festivosRes] = await Promise.all([
    db(supabase).from('gastos').select('negocio_id, monto').eq('workspace_id', workspaceId).in('negocio_id', negocioIds),
    db(supabase).from('horas').select('negocio_id, horas, staff_id').eq('workspace_id', workspaceId).in('negocio_id', negocioIds),
    supabase.from('staff').select('id, salary').eq('workspace_id', workspaceId),
    db(supabase).from('workspaces').select('config_extra').eq('id', workspaceId).single(),
    db(supabase)
      .from('negocio_responsables')
      .select('negocio_id, assigned_at, staff:staff!negocio_responsables_staff_id_fkey(id, full_name)')
      .in('negocio_id', negocioIds)
      .order('assigned_at', { ascending: true }),
    // Calendario de festivos: misma tabla que usa la función SQL horas_habiles_entre.
    db(supabase).from('festivos_colombia').select('fecha'),
  ])

  // SLA: se evalúa contra un único "ahora" por request (misma foto para toda la lista).
  const ahoraMs = Date.now()
  const festivos = new Set(
    ((festivosRes.data ?? []) as Array<{ fecha: string }>).map((f) => f.fecha),
  )

  // Responsables por negocio (orden estable por assigned_at = más antiguo primero).
  const responsablesPorNeg: Record<string, Array<{ id: string; full_name: string }>> = {}
  for (const r of ((respRes.data ?? []) as Array<{ negocio_id: string; staff: { id: string; full_name: string | null } | null }>)) {
    if (!r.staff) continue
    ;(responsablesPorNeg[r.negocio_id] ??= []).push({ id: r.staff.id, full_name: r.staff.full_name ?? '—' })
  }

  // Nombre del aliado de los negocios de origen 'alianza'. Query aparte (no
  // embedding de PostgREST) para no depender del refresco del schema cache tras
  // la migración: la tarjeta debe mostrar el aliado desde el primer render.
  const aliadoIds = Array.from(
    new Set(
      (data as Record<string, unknown>[])
        .map((r) => r.aliado_id as string | null)
        .filter((v): v is string => !!v),
    ),
  )
  const aliadoNombres: Record<string, string> = {}
  if (aliadoIds.length > 0) {
    const { data: aliadosRows } = await db(supabase)
      .from('aliados')
      .select('id, nombre')
      .eq('workspace_id', workspaceId)
      .in('id', aliadoIds)
    for (const a of ((aliadosRows ?? []) as Array<{ id: string; nombre: string }>)) {
      aliadoNombres[a.id] = a.nombre
    }
  }

  // Staff salary map for hour cost calculation
  const staffSalaryMap: Record<string, number> = {}
  for (const s of ((staffRes.data ?? []) as Array<{ id: string; salary: number | null }>)) {
    staffSalaryMap[s.id] = s.salary ?? 0
  }

  // Sum gastos per negocio
  const gastosPorNeg: Record<string, number> = {}
  for (const g of ((gastosRes.data ?? []) as Array<{ negocio_id: string; monto: number }>)) {
    gastosPorNeg[g.negocio_id] = (gastosPorNeg[g.negocio_id] ?? 0) + (g.monto ?? 0)
  }

  // Sum horas cost per negocio
  const horasCostoPorNeg: Record<string, number> = {}
  for (const h of ((horasRes.data ?? []) as Array<{ negocio_id: string; horas: number; staff_id: string | null }>)) {
    const salary = h.staff_id ? (staffSalaryMap[h.staff_id] ?? 0) : 0
    const tarifa = salary > 0 ? salary / 160 : 0
    horasCostoPorNeg[h.negocio_id] = (horasCostoPorNeg[h.negocio_id] ?? 0) + ((h.horas ?? 0) * tarifa)
  }

  // ── Tarjeta config-driven: vehículo + seccional desde un bloque (ej. Factura) ──
  // config_extra.negocio_card = { vehiculo_bloque, vehiculo_campos[], ciudad_campo }
  // Solo workspaces con ese config (ej. SOENA) lo llenan; el resto queda null.
  const cardCfg = ((wsRes.data as { config_extra?: Record<string, unknown> } | null)
    ?.config_extra?.negocio_card) as
    { vehiculo_bloque?: string; vehiculo_campos?: string[]; ciudad_campo?: string
      cedula_bloque?: string; cedula_campo?: string
      radicado_bloque?: string; radicado_campo?: string
      factura_bloque?: string; factura_campo?: string } | undefined
  const vehiculoPorNeg: Record<string, { label: string | null; seccional: string | null; ciudad: string | null }> = {}
  // Cédula del solicitante (bloque RUT, config-driven). Para tarjeta + búsqueda.
  const cedulaPorNeg: Record<string, string | null> = {}
  // Radicado de certificación (bloque DA22, config-driven). Para tarjeta + búsqueda.
  const radicadoPorNeg: Record<string, string | null> = {}
  // Número de factura emitida (bloque documento "Factura emitida", config-driven). Para búsqueda.
  const facturaPorNeg: Record<string, string | null> = {}
  const cardBloqueNombres = [cardCfg?.vehiculo_bloque, cardCfg?.cedula_bloque, cardCfg?.radicado_bloque, cardCfg?.factura_bloque].filter(Boolean) as string[]
  if (cardBloqueNombres.length > 0 && negocioIds.length > 0) {
    const getVal = (bdata: Record<string, unknown>, slug: string): string | null => {
      const campos = (bdata.campos as Record<string, { value?: unknown }> | undefined) ?? null
      const v = campos?.[slug]?.value ?? bdata[slug]
      const s = v == null ? '' : String(v).trim()
      return s || null
    }
    const { data: cardBloques } = await db(supabase)
      .from('negocio_bloques')
      .select('negocio_id, data, bloque_configs!inner(nombre)')
      .in('negocio_id', negocioIds)
      .in('bloque_configs.nombre', cardBloqueNombres)
    for (const row of ((cardBloques ?? []) as Record<string, unknown>[])) {
      const negId = row.negocio_id as string
      const bnombre = (row.bloque_configs as { nombre: string } | null)?.nombre ?? ''
      const bdata = (row.data as Record<string, unknown>) ?? {}
      // Vehículo + ciudad (del bloque Factura)
      if (cardCfg?.vehiculo_bloque && bnombre === cardCfg.vehiculo_bloque) {
        const parts = (cardCfg.vehiculo_campos ?? [])
          .map(slug => getVal(bdata, slug))
          .filter(Boolean) as string[]
        const label = parts.length ? parts.join(' ') : null
        const ciudad = cardCfg.ciudad_campo ? getVal(bdata, cardCfg.ciudad_campo) : null
        // SOENA = 100% personas naturales; para Bogotá esto resuelve a la seccional de naturales.
        const seccional = ciudad ? (mapCiudadASeccional(ciudad, 'natural')?.label ?? null) : null
        // El bloque origen (Validación) es el único con data extraída; si llega una
        // instancia heredada vacía, no se pisa un label/seccional ya resuelto.
        const prev = vehiculoPorNeg[negId]
        vehiculoPorNeg[negId] = {
          label: label ?? prev?.label ?? null,
          seccional: seccional ?? prev?.seccional ?? null,
          ciudad: ciudad ?? prev?.ciudad ?? null,
        }
      }
      // Cédula (del bloque RUT). Conserva la primera instancia con valor.
      if (cardCfg?.cedula_bloque && bnombre === cardCfg.cedula_bloque) {
        const ced = cardCfg.cedula_campo ? getVal(bdata, cardCfg.cedula_campo) : null
        cedulaPorNeg[negId] = cedulaPorNeg[negId] ?? ced
      }
      // Radicado de certificación (bloque DA22). El origen vive en Cargue y hay
      // copias readonly heredadas en otras etapas → conserva la primera con valor.
      if (cardCfg?.radicado_bloque && bnombre === cardCfg.radicado_bloque) {
        const rad = cardCfg.radicado_campo ? getVal(bdata, cardCfg.radicado_campo) : null
        radicadoPorNeg[negId] = radicadoPorNeg[negId] ?? rad
      }
      // Número de factura emitida (bloque documento "Factura emitida"). Conserva la primera con valor.
      if (cardCfg?.factura_bloque && bnombre === cardCfg.factura_bloque) {
        const nf = cardCfg.factura_campo ? getVal(bdata, cardCfg.factura_campo) : null
        facturaPorNeg[negId] = facturaPorNeg[negId] ?? nf
      }
    }
  }

  return (data as Record<string, unknown>[]).map(row => {
    const id = row.id as string
    const etapaRow = row.etapas_negocio as
      | { nombre: string; stage: string; numero: number; config_extra: unknown }
      | null
    // SLA de etapa. Sin sla_horas configurado no se calcula nada: la tarjeta
    // guarda silencio (no pinta "a tiempo" ni "sin SLA").
    const etapaCambiadaAt = (row.etapa_cambiada_at as string | null) ?? null
    const slaHoras = slaHorasDeEtapa(etapaRow?.config_extra)
    const horasEnEtapa =
      slaHoras !== null && etapaCambiadaAt
        ? horasHabilesEntre(etapaCambiadaAt, ahoraMs, festivos)
        : null
    return {
      id,
      nombre: row.nombre as string,
      codigo: row.codigo as string | null,
      precio_estimado: row.precio_estimado as number | null,
      precio_aprobado: row.precio_aprobado as number | null,
      carpeta_url: row.carpeta_url as string | null,
      stage_actual: row.stage_actual as 'venta' | 'ejecucion' | 'cobro' | null,
      estado: row.estado as string | null,
      created_at: row.created_at as string | null,
      linea_nombre: (row.lineas_negocio as { nombre: string; numero: number } | null)?.nombre ?? null,
      linea_numero: (row.lineas_negocio as { nombre: string; numero: number } | null)?.numero ?? null,
      etapa_nombre: (row.etapas_negocio as { nombre: string; stage: string; numero: number } | null)?.nombre ?? null,
      etapa_numero: (row.etapas_negocio as { nombre: string; stage: string; numero: number } | null)?.numero ?? null,
      etapa_stage: (row.etapas_negocio as { nombre: string; stage: string; numero: number } | null)?.stage ?? null,
      empresa_nombre: (row.empresas as { nombre: string } | null)?.nombre ?? null,
      contacto_nombre: (row.contactos as { nombre: string } | null)?.nombre ?? null,
      contacto_telefono:
        (row.contactos as { telefono: string | null } | null)?.telefono ?? null,
      costos_ejecutados: Math.round((gastosPorNeg[id] ?? 0) + (horasCostoPorNeg[id] ?? 0)),
      pausado: (row.pausado as boolean) ?? false,
      pausado_hasta: (row.pausado_hasta as string) ?? null,
      motivo_pausa: (row.motivo_pausa as string) ?? null,
      cierre_motivo: (row.cierre_motivo as 'exitoso' | 'perdido' | 'cancelado' | null) ?? null,
      closed_at: (row.closed_at as string) ?? null,
      razon_cierre: (row.razon_cierre as string) ?? null,
      vehiculo_label: vehiculoPorNeg[id]?.label ?? null,
      // Seccional DIAN = SOLO la seleccionada en el 010 (negocios.metadata.seccional),
      // que usa el vocabulario controlado de config_extra.seccionales ("Bogotá",
      // "Cali", "Otras seccionales"...). NO se deriva de la ciudad de la factura para
      // evitar dualidad de etiquetas ("Bogotá" vs "Bogotá — Personas naturales").
      // Un negocio sin seccional seleccionada queda null (no aparece en el filtro).
      seccional_label: ((row.metadata as Record<string, unknown> | null)?.seccional as string | undefined) ?? null,
      ciudad_label: vehiculoPorNeg[id]?.ciudad ?? null,
      cedula: cedulaPorNeg[id] ?? null,
      radicado: radicadoPorNeg[id] ?? null,
      numero_factura: facturaPorNeg[id] ?? null,
      responsables: responsablesPorNeg[id] ?? [],
      es_meta_lead: ((row.metadata as Record<string, unknown> | null)?.fuente_cargue === 'meta_lead'),
      reproceso: (() => {
        const r = (row.metadata as Record<string, unknown> | null)?.reproceso as
          | { activo?: boolean; tipo?: string; ciclo?: number; etapa_retorno?: string | null }
          | null
          | undefined
        if (!r?.activo) return null
        return { tipo: String(r.tipo ?? ''), ciclo: Number(r.ciclo ?? 1), etapa_retorno: r.etapa_retorno ?? null }
      })(),
      origen: (row.origen as string | null) ?? null,
      aliado_nombre: row.aliado_id ? (aliadoNombres[row.aliado_id as string] ?? null) : null,
      marcas: leerMarcasDeMetadata(row.metadata),
      etapa_cambiada_at: etapaCambiadaAt,
      etapa_sla_horas: slaHoras,
      horas_habiles_en_etapa: horasEnEtapa,
      sla_exceso_horas:
        slaHoras !== null && horasEnEtapa !== null ? horasEnEtapa - slaHoras : null,
    }
  })
}

// ── Stages activos del workspace ─────────────────────────────────────────────

export async function getWorkspaceStagesActivos(): Promise<string[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return ['venta', 'ejecucion', 'cobro']

  const { data } = await db(supabase)
    .from('workspaces')
    .select('stages_activos')
    .eq('id', workspaceId)
    .single()

  const stages = (data as { stages_activos: string[] } | null)?.stages_activos
  return stages && Array.isArray(stages) && stages.length > 0
    ? stages
    : ['venta', 'ejecucion', 'cobro']
}

/**
 * Etapas de la línea activa del workspace, para el segmentador Fase → Etapa de
 * /negocios. Devuelve numero (ID estable por línea, para contar), nombre, stage
 * y orden (para ordenar). Vacío si el workspace no tiene línea activa.
 */
export async function getEtapasSegmentador(): Promise<
  { numero: number; nombre: string; stage: string; orden: number }[]
> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data: ws } = await db(supabase)
    .from('workspaces')
    .select('linea_activa_id')
    .eq('id', workspaceId)
    .single()
  const lineaId = (ws as { linea_activa_id: string | null } | null)?.linea_activa_id
  if (!lineaId) return []

  const { data } = await db(supabase)
    .from('etapas_negocio')
    .select('numero, nombre, stage, orden')
    .eq('linea_id', lineaId)
    .order('orden', { ascending: true })

  return ((data as { numero: number | null; nombre: string; stage: string | null; orden: number }[] | null) ?? [])
    .filter((e) => e.numero != null && e.stage != null)
    .map((e) => ({ numero: e.numero as number, nombre: e.nombre, stage: e.stage as string, orden: e.orden }))
}

// ── Detalle de un negocio ─────────────────────────────────────────────────────

export async function getNegocioDetalle(id: string): Promise<{
  negocio: NegocioDetalle
  bloques: Array<BloqueConfig & { instancia: NegocioBloque | null }>
  etapasLinea: EtapaNegocio[]
  blockIdByConfigId: Record<string, string>
} | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select(`
      id,
      workspace_id,
      linea_id,
      empresa_id,
      contacto_id,
      nombre,
      codigo,
      precio_estimado,
      precio_aprobado,
      carpeta_url,
      stage_actual,
      etapa_actual_id,
      estado,
      tipo_cierre,
      motivo_cierre,
      lecciones_aprendidas,
      balance_final,
      created_at,
      updated_at,
      closed_at,
      cierre_motivo,
      razon_cierre,
      descripcion_cierre,
      metadata,
      responsable_id,
      pausado,
      pausado_hasta,
      motivo_pausa,
      motivo_pausa_detalle,
      veces_pausado,
      ultimo_pausado_at,
      lineas_negocio(nombre, numero),
      etapas_negocio(nombre, stage, numero),
      empresas(id, nombre),
      contactos(id, nombre)
    `)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return null

  // Responsables (multi) desde negocio_responsables (N:M) — fuente de verdad.
  const { data: respRows } = await db(supabase)
    .from('negocio_responsables')
    .select('staff_id, assigned_at, staff!negocio_responsables_staff_id_fkey(id, full_name)')
    .eq('negocio_id', id)
    .order('assigned_at', { ascending: true })
  const responsables = ((respRows ?? []) as Array<{ staff: { id: string; full_name: string } | null }>)
    .map((r) => r.staff)
    .filter((s): s is { id: string; full_name: string } => s !== null)

  const negocioRaw = negocio as Record<string, unknown>
  const negocioMetadata = (negocioRaw.metadata ?? {}) as Record<string, unknown>
  const negocioTyped = {
    ...negocioRaw,
    responsables,
  } as unknown as NegocioDetalle

  // Cargar etapas de la línea para la barra de progreso
  let etapasLinea: EtapaNegocio[] = []
  if (negocioTyped.linea_id) {
    const { data: etapas } = await db(supabase)
      .from('etapas_negocio')
      .select('id, linea_id, stage, nombre, orden, numero, config_extra')
      .eq('linea_id', negocioTyped.linea_id)
      .order('orden', { ascending: true })

    etapasLinea = ((etapas ?? []) as Record<string, unknown>[]).map(e => ({
      id: e.id as string,
      linea_id: e.linea_id as string,
      stage: e.stage as 'venta' | 'ejecucion' | 'cobro',
      nombre: e.nombre as string,
      orden: e.orden as number,
      numero: e.numero as number,
      guia: ((e.config_extra as { guia?: GuiaEtapa } | null)?.guia ?? null),
      es_cierre: (e.config_extra as { etapa_cierre?: boolean } | null)?.etapa_cierre === true,
      es_buzon: (e.config_extra as { buzon_leads?: boolean } | null)?.buzon_leads === true,
    }))
  }


  // Modelo de dinero del negocio (plan de pago + honorario + tarifa UPME), leído de
  // la propuesta aprobada. Se expone SIEMPRE para que el bloque de Cobro muestre el
  // plan elegido (seguimiento financiero, sin cazarlo en la propuesta). null si aún
  // no hay propuesta aprobada.
  //
  // NO se usa leerModeloDineroNegocio aquí: ese helper devuelve null cuando no hay
  // tarifa UPME (su propósito es el reparto de cobros pasante/honorario). Para mostrar
  // el plan queremos el plan aunque el negocio sea legacy sin tarifa. Leemos directo,
  // priorizando el bloque de propuesta que tenga un plan aprobado.
  // Modelo de dinero (honorario/plan de la propuesta + tarifa CONFIRMADA en
  // Validación + referencia de display). Helper compartido con el gate de handoff y
  // el reparto → sin divergencia gate⟺render. La tarifa (pasante) ya NO se lee de la
  // propuesta (rediseño valor_a_recaudar).
  const modeloDinero: ModeloDinero | null = await leerModeloDineroCompleto(supabase, id)
  negocioTyped.modelo_dinero = modeloDinero

  // Valor a recaudar del cliente = precio_aprobado (honorario) + tarifa confirmada
  // (pasante). Base del saldo del bloque de Cobros. Derivado, no almacenado. Cubre el
  // caso honorario 0 (cero deliberado / regalado) CON tarifa: el cliente igual paga la
  // tarifa UPME (pasante), así que el valor a recaudar es la tarifa, no null.
  const precioHonorario = negocioTyped.precio_aprobado ?? negocioTyped.precio_estimado ?? 0
  const valorRecaudarNegocio = valorARecaudar(precioHonorario, modeloDinero)
  negocioTyped.valor_a_recaudar = valorRecaudarNegocio > 0 ? valorRecaudarNegocio : null

  // Costos ePayco por cobro (lo que descuenta la pasarela: comisión + impuestos),
  // reconstruidos de los gastos `epayco-comision-{ref}` / `epayco-impuestos-{ref}`.
  // Keyed por ref_payco (= external_ref del cobro). El bloque de Cobro lo muestra bajo
  // cada cobro por pasarela para que financiera vea el neto recibido sin buscarlo.
  const epaycoCostos: Record<string, EpaycoCostoCobro> = {}
  const { data: epaycoGastos } = await db(supabase)
    .from('gastos')
    .select('external_ref, monto, split_json')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', id)
    .like('external_ref', 'epayco-%')
  for (const g of ((epaycoGastos ?? []) as Array<{ external_ref: string | null; monto: number | null; split_json: Record<string, unknown> | null }>)) {
    const m = (g.external_ref ?? '').match(/^epayco-(comision|impuestos)-(.+)$/)
    if (!m) continue
    const [, kind, refPayco] = m
    const entry = epaycoCostos[refPayco] ?? { comision: 0, iva: 0, retefuente: 0, reteica: 0, impuestos: 0, totalDescontado: 0 }
    const monto = Number(g.monto ?? 0)
    if (kind === 'comision') {
      entry.comision += monto
    } else {
      entry.impuestos += monto
      const sj = (g.split_json ?? {}) as Record<string, unknown>
      entry.iva += Number(sj.iva_comision ?? 0)
      entry.retefuente += Number(sj.retefuente ?? 0)
      entry.reteica += Number(sj.reteica ?? 0)
    }
    entry.totalDescontado = Math.round((entry.comision + entry.impuestos) * 100) / 100
    epaycoCostos[refPayco] = entry
  }
  negocioTyped.epayco_costos = epaycoCostos

  // Pendiente de recaudo para el handoff a operaciones. Solo se computa si la etapa
  // actual (aún en stage 'venta') tiene el gate `saldo:handoff` en su config_extra.
  // El bloque de Cobro lo muestra para que el comercial vea qué falta antes de
  // intentar avanzar. Fuera de ese caso queda null y la UI no lo renderiza.
  if (negocioTyped.etapa_actual_id && negocioTyped.stage_actual === 'venta') {
    const { data: etapaCfgRaw } = await db(supabase)
      .from('etapas_negocio')
      .select('config_extra')
      .eq('id', negocioTyped.etapa_actual_id)
      .single()
    const gatesEtapa = (((etapaCfgRaw as { config_extra?: { gates?: string[] } } | null)
      ?.config_extra?.gates) ?? []) as string[]
    if (gatesEtapa.includes('saldo:handoff')) {
      const precioHandoff = negocioTyped.precio_aprobado ?? negocioTyped.precio_estimado ?? 0
      if (precioHandoff > 0) {
        const { data: cobrosHandoff } = await db(supabase)
          .from('cobros')
          .select('monto, tipo_cobro')
          .eq('workspace_id', workspaceId)
          .eq('negocio_id', id)
        const recaudadoHandoff = ((cobrosHandoff ?? []) as Array<{ monto: number; tipo_cobro: string | null }>)
          .filter((c) => c.tipo_cobro !== 'devolucion_pendiente')
          .reduce((sum, c) => sum + (c.monto ?? 0), 0)
        negocioTyped.pendiente_handoff = calcularPendienteHandoff(precioHandoff, modeloDinero, recaudadoHandoff)
      }
    }
  }

  // Cargar bloque_configs de la etapa actual + negocio_bloques correspondientes
  let bloques: Array<BloqueConfig & { instancia: NegocioBloque | null }> = []
  const blockIdByConfigId = new Map<string, string>()
  if (negocioTyped.etapa_actual_id) {
    const { data: bloqueConfigsRaw } = await db(supabase)
      .from('bloque_configs')
      .select(`
        id,
        etapa_id,
        workspace_id,
        bloque_definition_id,
        estado,
        orden,
        es_gate,
        nombre,
        config_extra,
        bloque_definitions(id, tipo, nombre, is_visualization, can_be_gate)
      `)
      .eq('etapa_id', negocioTyped.etapa_actual_id)
      .eq('workspace_id', workspaceId)
      .order('orden', { ascending: true })

    // Excluir bloques desactivados (config_extra.desactivado === true): quedan fuera
    // del flujo operativo sin borrarse (reversible desde la config del workflow).
    // Además, visibilidad condicional por metadata del negocio (genérico, opt-in):
    // config_extra.mostrar_si_metadata = { key, equals } → el bloque solo aparece
    // cuando negocio.metadata[key] === equals (ej. datos de un lead de Meta que solo
    // se muestran en negocios con fuente_cargue = 'meta_lead').
    const bloqueConfigs = ((bloqueConfigsRaw ?? []) as Array<Record<string, unknown>>).filter(bc => {
      const ce = bc.config_extra as Record<string, unknown> | null
      if (ce?.desactivado === true) return false
      const cond = ce?.mostrar_si_metadata as { key: string; equals: unknown } | undefined
      if (cond && negocioMetadata[cond.key] !== cond.equals) return false
      return true
    })

    // Cargar instancias runtime
    const configIds = ((bloqueConfigs ?? []) as Record<string, unknown>[]).map(b => b.id as string)
    const instanciasMap: Record<string, NegocioBloque> = {}

    if (configIds.length > 0) {
      const { data: instancias } = await db(supabase)
        .from('negocio_bloques')
        .select('id, negocio_id, bloque_config_id, estado, data, completado_at, completado_por')
        .eq('negocio_id', id)
        .in('bloque_config_id', configIds)

      for (const inst of ((instancias ?? []) as Record<string, unknown>[])) {
        instanciasMap[inst.bloque_config_id as string] = inst as unknown as NegocioBloque
      }

      // Instancias efímeras de solo lectura derivadas de negocio.metadata
      // (config-driven, genérico). Si un bloque declara config_extra.data_desde_metadata
      // y no tiene instancia real, se sintetiza una con el `data` mapeado desde
      // metadata. El estado 'visible' del bloque_config fuerza render read-only
      // (BloqueDatos no persiste), así que la instancia sin id no escribe nada.
      for (const bc of (bloqueConfigs as Array<Record<string, unknown>>)) {
        const dm = (bc.config_extra as {
          data_desde_metadata?: { source: string; map: Record<string, string>; clean?: boolean; numeric?: string[] }
        } | null)?.data_desde_metadata
        if (!dm || instanciasMap[bc.id as string]) continue
        instanciasMap[bc.id as string] = {
          id: '',
          negocio_id: id,
          bloque_config_id: bc.id as string,
          estado: 'visible',
          data: dataDesdeMetadata(dm, negocioMetadata),
          completado_at: null,
          completado_por: null,
        } as unknown as NegocioBloque
      }

      // Auto-crear instancias faltantes (negocio creado antes de bloque_configs)
      const faltantes = configIds.filter(cid => !instanciasMap[cid])
      if (faltantes.length > 0) {
        // Bloques de solo lectura (config estado 'visible') no requieren acción
        // del usuario → nacen completos, SALVO que sean GATE con campos `required`
        // sin valor (ver `visiblePuedeNacerCompleto`): ahí quedan pendientes para
        // que el gate retenga en vez de dejar pasar la pregunta sin responder.
        const configById = new Map(
          ((bloqueConfigs ?? []) as Array<{
            id: string; estado?: string; es_gate?: boolean
            config_extra?: Record<string, unknown> | null
            bloque_definitions?: { tipo?: string } | null
          }>).map(bc => [bc.id, bc])
        )

        // ¿El origen de cada documento heredado ya tiene archivo en ESTE negocio?
        // Una copia de solo lectura muestra el archivo del origen, así que darla por
        // completa cuando el origen está vacío hace que la pantalla afirme que el
        // documento está. Ver `documentoHeredadoNaceCompleto`.
        const slugsOrigen = [...new Set(
          faltantes
            .map(cid => configById.get(cid))
            .filter(cfg => cfg?.bloque_definitions?.tipo === 'documento')
            .map(cfg => (cfg?.config_extra as { source_bloque_slug?: string } | null)?.source_bloque_slug)
            .filter((x): x is string => !!x),
        )]
        const origenConArchivo = new Set<string>()
        if (slugsOrigen.length > 0) {
          const { data: origenes } = await db(supabase)
            .from('negocio_bloques')
            .select('data, bloque_configs!inner(slug)')
            .eq('negocio_id', id)
            .in('bloque_configs.slug', slugsOrigen)
          for (const o of ((origenes ?? []) as unknown as Array<{
            data: Record<string, unknown> | null; bloque_configs: { slug: string }
          }>)) {
            if (String(o.data?.drive_url ?? '')) origenConArchivo.add(o.bloque_configs.slug)
          }
        }

        const nuevas = faltantes.map(cid => {
          const cfg = configById.get(cid)
          const origenSlug = (cfg?.config_extra as { source_bloque_slug?: string } | null)?.source_bloque_slug
          // `data: {}` — la instancia nace vacía, así que un bloque con campos
          // `required` nunca los tiene: por eso este es el sitio donde el gate de
          // la cita DIAN dejaba de retener.
          const naceCompleto = cfg?.estado === 'visible'
            && visiblePuedeNacerCompleto(cfg?.config_extra ?? null, {}, cfg?.es_gate === true)
            && documentoHeredadoNaceCompleto(
              cfg?.bloque_definitions?.tipo === 'documento',
              !!origenSlug,
              !!origenSlug && origenConArchivo.has(origenSlug),
            )
          return {
            negocio_id: id,
            bloque_config_id: cid,
            estado: naceCompleto ? 'completo' : 'pendiente',
            data: {},
            ...(naceCompleto ? { completado_at: new Date().toISOString() } : {}),
          }
        })
        const { data: creadas } = await db(supabase)
          .from('negocio_bloques')
          .insert(nuevas)
          .select('id, negocio_id, bloque_config_id, estado, data')
        for (const inst of ((creadas ?? []) as Record<string, unknown>[])) {
          instanciasMap[inst.bloque_config_id as string] = inst as unknown as NegocioBloque
        }

      }

      // Auto-init de propuesta económica: si un bloque propuesta_economica ORIGEN
      // (con auto_propuesta.servicio_id) no tiene `precio_base_con_iva` en su data,
      // inicializarlo con el precio base del servicio. Cubre tanto instancias recién
      // creadas como EXISTENTES sin inicializar — p.ej. negocios que alcanzaron la
      // etapa antes de este fix, o si el init falló una vez. Antes esto solo ocurría
      // en crearNegocio (cuando Contacto era la 1ª etapa); tras mover Contacto
      // después de Validación debe poder dispararse al alcanzar la etapa.
      for (const bc of ((bloqueConfigs ?? []) as Array<{ id: string; config_extra?: Record<string, unknown> | null; bloque_definitions?: { tipo?: string } | null }>)) {
        if (bc.bloque_definitions?.tipo !== 'propuesta_economica') continue
        if ((bc.config_extra as { source_etapa_orden?: unknown } | null)?.source_etapa_orden !== undefined) continue
        const autoProp = (bc.config_extra?.auto_propuesta ?? null) as { servicio_id?: string } | null
        if (!autoProp?.servicio_id) continue
        const inst = instanciasMap[bc.id]
        if (!inst || (inst.data as Record<string, unknown> | null)?.precio_base_con_iva !== undefined) continue
        try {
          const { crearV1Automatica } = await import('@/lib/actions/propuesta-economica-actions')
          await crearV1Automatica(inst.id, autoProp.servicio_id)
          const { data: refreshed } = await db(supabase).from('negocio_bloques').select('data').eq('id', inst.id).single()
          if (refreshed) instanciasMap[bc.id] = { ...inst, data: (refreshed as { data: unknown }).data } as NegocioBloque
        } catch (e) {
          console.error('[getNegocioDetalle] auto-init propuesta económica falló:', e)
        }
      }

      // Auto-init "Confirmar tarifa UPME" (SOENA): un bloque `datos` con
      // config_extra.tarifa_confirmacion computa la tarifa Art. 13 desde el valor
      // sin IVA de la Factura y PERSISTE en el data del bloque la referencia
      // calculada + el valor a recaudar por defecto. Es la fuente única de la
      // tarifa (pasante) que consumen aguas abajo el saldo de Cobros, el gate de
      // handoff y el reparto pasante/honorario. Idempotente: solo inyecta cuando la
      // referencia aún no está — NO pisa un valor confirmado/ajustado a mano. Si la
      // Factura aún no tiene valor, no hace nada y reintenta en la próxima carga.
      for (const bc of ((bloqueConfigs ?? []) as Array<{ id: string; config_extra?: Record<string, unknown> | null; bloque_definitions?: { tipo?: string } | null }>)) {
        const tcfg = (bc.config_extra?.tarifa_confirmacion ?? null) as
          | { enabled?: boolean; factura_slug?: string; valor_field?: string; ref_field?: string; ref_fmt_field?: string; confirmada_field?: string; anio?: number }
          | null
        if (bc.bloque_definitions?.tipo !== 'datos' || tcfg?.enabled !== true) continue
        if ((bc.config_extra as { source_etapa_orden?: unknown } | null)?.source_etapa_orden !== undefined) continue
        const inst = instanciasMap[bc.id]
        if (!inst) continue
        const refField = tcfg.ref_field ?? 'tarifa_upme_ref'
        const refFmtField = tcfg.ref_fmt_field ?? 'tarifa_upme_ref_fmt'
        const confField = tcfg.confirmada_field ?? 'tarifa_upme_confirmada'
        const data = ((inst.data ?? {}) as Record<string, unknown>)
        if (data[refField] != null) continue // ya inicializado — no re-computar ni pisar ajuste
        const facturaSlug = tcfg.factura_slug ?? 'factura_venta_vehiculo'
        const valorField = tcfg.valor_field ?? 'valor_unitario_sin_iva'
        const { data: facturaBloques } = await db(supabase)
          .from('negocio_bloques')
          .select('data, bloque_configs!inner(slug)')
          .eq('negocio_id', id)
          .eq('bloque_configs.slug', facturaSlug)
        let valorSinIva = 0
        for (const fb of ((facturaBloques ?? []) as Array<{ data: Record<string, unknown> | null }>)) {
          const campos = (fb.data?.campos ?? {}) as Record<string, { value?: unknown }>
          const v = Number(String(campos[valorField]?.value ?? '').replace(/[^\d.-]/g, ''))
          if (Number.isFinite(v) && v > 0) { valorSinIva = v; break }
        }
        if (!(valorSinIva > 0)) continue // Factura sin valor aún → reintenta en próxima carga
        const tarifa = calcularTarifaUpmePorAnio(valorSinIva, tcfg.anio)
        const tarifaFmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(tarifa)
        const nuevoData = {
          ...data,
          [refField]: tarifa,
          [refFmtField]: tarifaFmt,
          [confField]: data[confField] ?? tarifa,
        }
        try {
          await db(supabase).from('negocio_bloques').update({ data: nuevoData }).eq('id', inst.id)
          instanciasMap[bc.id] = { ...inst, data: nuevoData } as NegocioBloque
        } catch (e) {
          console.error('[getNegocioDetalle] auto-init tarifa UPME falló:', e)
        }
      }

      // Auto-init "Cita DIAN" (SOENA): un bloque `datos` con
      // config_extra.cita_dian_confirmacion lee la Dirección Seccional del RUT
      // (casilla 12) y persiste si el caso requiere cita previa en la DIAN. Solo
      // Bogotá, Medellín, Cali y Bucaramanga la exigen; el resto va directo a
      // certificado bancario.
      //
      // La fuente es el flag `cita` del catálogo de seccionales, el mismo que
      // gobierna la Guía de Devolución del cliente, para que el flujo interno y el
      // documento que recibe el cliente no puedan contradecirse.
      //
      // Idempotente: solo inyecta cuando el campo aún no está, así que NO pisa una
      // confirmación manual del comercial. Si el RUT todavía no se ha cargado, o su
      // seccional no se puede resolver, no escribe nada y el comercial decide.
      //
      // ⚠️ La fuente de la seccional ya cambió tres veces (factura → RUT → factura →
      // RUT). Vigente desde 2026-07-24: RUT casilla 12, confirmado por Deisy tras
      // capacitación DIAN y ratificado por Juan David para todos los casos.
      // `estado` y `es_gate` se declaran en el tipo porque el cierre del gate depende de
      // ellos: son parte del contrato de este loop, no un detalle que se castea al vuelo.
      for (const bc of ((bloqueConfigs ?? []) as Array<{ id: string; estado?: string | null; es_gate?: boolean | null; config_extra?: Record<string, unknown> | null; bloque_definitions?: { tipo?: string } | null }>)) {
        const ccfg = (bc.config_extra?.cita_dian_confirmacion ?? null) as
          | {
              enabled?: boolean
              rut_slug?: string
              seccional_field?: string
              seccional_ref_field?: string
              requiere_field?: string
              tipo_persona_slug?: string
              solo_si?: { bloque_slug: string; field: string; value: string }
            }
          | null
        if (bc.bloque_definitions?.tipo !== 'datos' || ccfg?.enabled !== true) continue
        if ((bc.config_extra as { source_etapa_orden?: unknown } | null)?.source_etapa_orden !== undefined) continue
        const inst = instanciasMap[bc.id]
        if (!inst) continue
        // Guard `solo_si`: la pregunta "¿requiere cita?" solo tiene sentido en la
        // rama de devolución de IVA. Dejar el campo vacío fuera de esa rama es
        // deliberado: así ninguna condición del routing de Entrega matchea y el
        // negocio cae al default (Facturación) sin necesidad de condiciones
        // compuestas en el motor.
        if (ccfg.solo_si) {
          const { data: guardBloques } = await db(supabase)
            .from('negocio_bloques')
            .select('data, bloque_configs!inner(slug)')
            .eq('negocio_id', id)
            .eq('bloque_configs.slug', ccfg.solo_si.bloque_slug)
          let cumple = false
          for (const gb of ((guardBloques ?? []) as Array<{ data: Record<string, unknown> | null }>)) {
            if (String((gb.data ?? {})[ccfg.solo_si.field] ?? '') === ccfg.solo_si.value) { cumple = true; break }
          }
          if (!cumple) {
            // El guard dejó de cumplirse (alguien corrigió la respuesta de arriba) y el
            // bloque tiene un valor sembrado antes. NO basta con dejar de mostrarlo: el
            // routing lee TODOS los bloques `datos` de la etapa sin mirar su `condition`,
            // así que ese valor huérfano seguiría desviando el negocio a una rama que ya
            // no le corresponde. Se limpia para restaurar la premisa del comentario de
            // arriba: fuera de la rama, el campo va vacío.
            const requiereFieldLimpiar = ccfg.requiere_field ?? 'requiere_cita_dian'
            const dataActual = ((inst.data ?? {}) as Record<string, unknown>)
            if (dataActual[requiereFieldLimpiar] != null) {
              const { [requiereFieldLimpiar]: valorRetirado, ...dataSinCampo } = dataActual
              // Deja rastro de lo retirado. Un borrado en silencio vuelve inauditable un
              // barrido que puede alcanzar a muchos negocios de una vez (el cargue
              // histórico de julio dejó 116 casos en este estado), y sin el valor previo
              // no hay forma de revertir si la limpieza resulta equivocada.
              const dataConRastro = {
                ...dataSinCampo,
                _campo_retirado: {
                  campo: requiereFieldLimpiar,
                  valor: valorRetirado,
                  fecha: new Date().toISOString(),
                  motivo: 'El bloque dejó de aplicar (guard solo_si). El valor huérfano seguiría decidiendo el routing, que lee los bloques de la etapa sin mirar su condition.',
                },
              }
              await db(supabase).from('negocio_bloques').update({ data: dataConRastro }).eq('id', inst.id)
              instanciasMap[bc.id] = { ...inst, data: dataConRastro } as NegocioBloque
            }
            continue
          }
        }
        const requiereField = ccfg.requiere_field ?? 'requiere_cita_dian'
        const seccionalRefField = ccfg.seccional_ref_field ?? 'seccional_ref'
        const data = ((inst.data ?? {}) as Record<string, unknown>)
        if (data[requiereField] != null) {
          // El DATO ya está y no se re-computa: pisarlo borraría una confirmación manual.
          // Pero el ESTADO sí se vuelve a mirar, y esa distinción es el defecto que se
          // cierra aquí. La instancia nace `pendiente` cuando es un gate `visible` con su
          // campo required vacío, y ese veredicto se calcula una sola vez, al crearla. Si el
          // campo se llenó después por una vía que no cerró el bloque en la misma pasada
          // (una versión anterior de este auto-init, un backfill de datos), este `continue`
          // salía antes de revisar el estado y el bloque quedaba pendiente PARA SIEMPRE: es
          // de solo lectura, la UI no ofrece forma de cerrarlo, y el gate retiene un negocio
          // cuya respuesta ya está escrita en él. Medido en SOENA el 2026-08-04: 5 casos
          // vivos, más V0107 y V0122 destrabados a mano el día anterior.
          if (inst.estado !== 'completo' && gateVisibleQuedaResuelto(bc, data)) {
            try {
              await db(supabase)
                .from('negocio_bloques')
                .update({ estado: 'completo', completado_at: new Date().toISOString() })
                .eq('id', inst.id)
              instanciasMap[bc.id] = { ...inst, estado: 'completo' } as NegocioBloque
            } catch (e) {
              console.error('[getNegocioDetalle] cierre tardío de gate cita DIAN falló:', e)
            }
          }
          continue
        }
        const rutSlug = ccfg.rut_slug ?? 'rut'
        const seccionalField = ccfg.seccional_field ?? 'direccion_seccional'
        const { data: rutBloques } = await db(supabase)
          .from('negocio_bloques')
          .select('data, bloque_configs!inner(slug)')
          .eq('negocio_id', id)
          .eq('bloque_configs.slug', rutSlug)
        let seccionalRut = ''
        for (const rb of ((rutBloques ?? []) as Array<{ data: Record<string, unknown> | null }>)) {
          const campos = (rb.data?.campos ?? {}) as Record<string, { value?: unknown }>
          const v = String(campos[seccionalField]?.value ?? '').trim()
          if (v) { seccionalRut = v; break }
        }
        if (!seccionalRut) continue // RUT sin cargar o sin el campo → reintenta en próxima carga
        let resolucion = requiereCitaDian(seccionalRut)
        // Bogotá es la única seccional con dos buzones (naturales / jurídicas), así
        // que solo ahí hace falta el tipo de persona. La fuente canónica es el
        // bloque "tipo de solicitante" (valores ya normalizados), no el campo
        // homónimo del RUT, que viene con formatos libres ("Natural",
        // "Persona jurídica").
        if (resolucion.seccional?.slug.startsWith('bogota')) {
          const tipoSlug = ccfg.tipo_persona_slug ?? 'tipo_de_solicitante'
          const { data: tipoBloques } = await db(supabase)
            .from('negocio_bloques')
            .select('data, bloque_configs!inner(slug)')
            .eq('negocio_id', id)
            .eq('bloque_configs.slug', tipoSlug)
          let tipoPersona = ''
          for (const tb of ((tipoBloques ?? []) as Array<{ data: Record<string, unknown> | null }>)) {
            const v = String(tb.data?.tipo_persona ?? '').trim()
            if (v) { tipoPersona = v; break }
          }
          if (tipoPersona) resolucion = requiereCitaDian(seccionalRut, tipoPersona)
        }
        const { seccional, requiere_cita } = resolucion
        if (requiere_cita === null) continue // seccional no reconocida → decide el comercial
        const nuevoData = {
          // Se persiste como string 'true'/'false', no boolean: el campo se rinde
          // como select y el routing compara con String(valor). Un boolean no
          // casaría con las opciones del select en la UI.
          ...data,
          [requiereField]: requiere_cita ? 'true' : 'false',
          [seccionalRefField]: seccional?.nombre_oficial ?? nombreOficialSeccional(seccionalRut),
        }
        try {
          // Al sembrar la respuesta hay que RE-EVALUAR la completitud del bloque, no
          // solo escribir el dato: si no, el gate de solo lectura queda pendiente con
          // su respuesta puesta y sin forma de cerrarlo en pantalla. La regla es la
          // misma que aplica el camino de arriba (`gateVisibleQuedaResuelto`), para que
          // sembrar-y-cerrar y cerrar-lo-ya-sembrado no puedan divergir.
          const cierraAhora = gateVisibleQuedaResuelto(bc, nuevoData)
          const patch: Record<string, unknown> = { data: nuevoData }
          if (cierraAhora && inst.estado !== 'completo') {
            patch.estado = 'completo'
            patch.completado_at = new Date().toISOString()
          }
          await db(supabase).from('negocio_bloques').update(patch).eq('id', inst.id)
          instanciasMap[bc.id] = {
            ...inst,
            data: nuevoData,
            ...(cierraAhora ? { estado: 'completo' } : {}),
          } as NegocioBloque
          // Sembrar la seccional del negocio si aún no la tiene. Es la fuente única
          // que leen los formularios DIAN (casilla 12 del 010) vía
          // aplicarSeccionalPreset. No pisa un override manual ya existente.
          //
          // Se siembra el nombre CANÓNICO, no `seccional.label`: el label de Bogotá
          // trae el buzón ("Bogotá — Personas naturales") y esa variante no la
          // reconocía ninguna otra capa. El buzón se sigue derivando de tipo_persona
          // donde hace falta.
          if (seccional) {
            const esc = await fijarSeccionalNegocio(supabase, {
              negocioId: id,
              entrada: labelCanonicoSeccional(seccional),
            })
            if (esc.guardado) negocioMetadata.seccional = esc.guardado
          }
        } catch (e) {
          console.error('[getNegocioDetalle] auto-init cita DIAN falló:', e)
        }
      }

      // ── Herencia de data para bloques 'visible' con data vacía ───────────────
      // Cuando un bloque visible no tiene data propia (es nuevo en esta etapa),
      // heredar la data de la instancia más reciente del mismo bloque_definition_id
      // en etapas anteriores del mismo negocio. Esto preserva datos como equipo
      // entre etapas sin mutar las instancias de origen.
      const bloqueConfigsMap = new Map(
        ((bloqueConfigs ?? []) as Record<string, unknown>[]).map(bc => [
          bc.id as string,
          bc as Record<string, unknown>,
        ])
      )
      const visiblesVacios = Object.entries(instanciasMap).filter(([configId, inst]) => {
        const bc = bloqueConfigsMap.get(configId)
        const isVisible = bc?.estado === 'visible'
        const dataVacia = !inst.data || Object.keys(inst.data).length === 0
        return isVisible && dataVacia
      })

      if (visiblesVacios.length > 0) {
        // Recolectar bloque_definition_ids únicos que necesitan herencia
        const defIdsNecesarios = [...new Set(
          visiblesVacios.map(([configId]) => {
            const bc = bloqueConfigsMap.get(configId)
            return bc?.bloque_definition_id as string
          }).filter(Boolean)
        )]

        if (defIdsNecesarios.length > 0) {
          // Buscar todos los negocio_bloques del negocio que tengan data no vacía
          // y cuyo bloque_config tenga uno de esos bloque_definition_id
          const { data: historialRaw } = await db(supabase)
            .from('negocio_bloques')
            .select(`
              id,
              bloque_config_id,
              estado,
              data,
              bloque_configs!inner(bloque_definition_id)
            `)
            .eq('negocio_id', id)
            .not('data', 'is', null)

          // Construir mapa: bloque_definition_id → { data, estado } más reciente con contenido
          const heredadaPorDef: Record<string, { data: Record<string, unknown>; estado: string }> = {}
          for (const raw of ((historialRaw ?? []) as Record<string, unknown>[])) {
            const defId = (raw.bloque_configs as Record<string, unknown> | null)
              ?.bloque_definition_id as string | undefined
            if (!defId || !defIdsNecesarios.includes(defId)) continue
            const dataRaw = raw.data as Record<string, unknown> | null
            if (!dataRaw || Object.keys(dataRaw).length === 0) continue
            // Solo heredar si el configId origen no es de la etapa actual
            // (evitar ciclos: no heredar de sí mismo)
            const configIdOrigen = raw.bloque_config_id as string
            if (configIds.includes(configIdOrigen)) {
              // Este config pertenece a la etapa actual — no heredar de él
              continue
            }
            // Guardar (el query no tiene orden; cualquier instancia previa con data sirve)
            if (!heredadaPorDef[defId]) {
              heredadaPorDef[defId] = {
                data: dataRaw,
                estado: raw.estado as string,
              }
            }
          }

          // Aplicar herencia en memoria (no persistir — solo para el render)
          for (const [configId] of visiblesVacios) {
            const bc = bloqueConfigsMap.get(configId)
            const defId = bc?.bloque_definition_id as string | undefined
            if (!defId) continue
            const heredada = heredadaPorDef[defId]
            if (!heredada) continue
            instanciasMap[configId] = {
              ...instanciasMap[configId],
              data: heredada.data,
              // Propagar estado completo solo en memoria — el gate sigue leyendo de DB
              ...(heredada.estado === 'completo' ? { estado: 'completo' as const } : {}),
            }
          }
        }
      }
      // ── Fin herencia ──────────────────────────────────────────────────────────
    }

    // Calcular block_id por linea con herencia: los bloques readonly
    // que tienen source_etapa_orden mantienen el ID del bloque origen
    // (matching por nombre + tipo en la etapa source).
    if (negocioTyped.linea_id) {
      const { data: allLineaBlocks } = await db(supabase)
        .from('bloque_configs')
        .select(`
          id,
          etapa_id,
          orden,
          nombre,
          config_extra,
          bloque_definitions(tipo, nombre)
        `)
        .eq('workspace_id', workspaceId)

      type AllRow = {
        id: string
        etapa_id: string
        orden: number
        nombre: string | null
        config_extra: Record<string, unknown> | null
        bloque_definitions: { tipo: string; nombre: string } | null
      }
      const allRows = (allLineaBlocks ?? []) as unknown as AllRow[]
      const etapaIdsLinea = new Set(etapasLinea.map(e => e.id))
      const filtered = allRows.filter(r => etapaIdsLinea.has(r.etapa_id))
      const etapaOrdenById = new Map(etapasLinea.map(e => [e.id, e.orden]))
      const etapaIdByOrden = new Map(etapasLinea.map(e => [e.orden, e.id]))
      filtered.sort((a, b) => {
        const ea = etapaOrdenById.get(a.etapa_id) ?? 0
        const eb = etapaOrdenById.get(b.etapa_id) ?? 0
        if (ea !== eb) return ea - eb
        return a.orden - b.orden
      })

      // Primera pasada: asignar ID a bloques originales (sin source_etapa_orden).
      // Segunda pasada: heredar ID en bloques readonly que apuntan a un origen.
      const counters = new Map<string, number>()
      const nombreOf = (r: AllRow): string =>
        (r.nombre && r.nombre.trim().length > 0 ? r.nombre : r.bloque_definitions?.nombre ?? '').trim().toLowerCase()
      const tipoOf = (r: AllRow): string => r.bloque_definitions?.tipo ?? 'desconocido'

      // Indice por (etapa_id, nombre_lower, tipo) → row, para matching de herencia
      const indexByEtapaNombreTipo = new Map<string, AllRow>()
      const keyFor = (etapaId: string, nombre: string, tipo: string): string =>
        `${etapaId}::${nombre}::${tipo}`
      for (const row of filtered) {
        indexByEtapaNombreTipo.set(keyFor(row.etapa_id, nombreOf(row), tipoOf(row)), row)
      }

      // Pasada 1: originales (sin source_etapa_orden)
      for (const row of filtered) {
        const srcOrden = (row.config_extra as { source_etapa_orden?: number } | null)?.source_etapa_orden
        if (typeof srcOrden === 'number') continue
        const code = bloqueTipoCode(tipoOf(row))
        const n = (counters.get(code) ?? 0) + 1
        counters.set(code, n)
        blockIdByConfigId.set(row.id, `${code}${n}`)
      }

      // Pasada 2: heredados — buscar origen por (etapa source, nombre, tipo)
      for (const row of filtered) {
        const srcOrden = (row.config_extra as { source_etapa_orden?: number } | null)?.source_etapa_orden
        if (typeof srcOrden !== 'number') continue
        const srcEtapaId = etapaIdByOrden.get(srcOrden)
        let originId: string | undefined
        if (srcEtapaId) {
          const match = indexByEtapaNombreTipo.get(keyFor(srcEtapaId, nombreOf(row), tipoOf(row)))
          if (match) originId = blockIdByConfigId.get(match.id)
        }
        if (originId) {
          blockIdByConfigId.set(row.id, originId)
        } else {
          // Fallback: no se encontro origen — asignar nuevo ID para no romper
          const code = bloqueTipoCode(tipoOf(row))
          const n = (counters.get(code) ?? 0) + 1
          counters.set(code, n)
          blockIdByConfigId.set(row.id, `${code}${n}`)
        }
      }
    }

    bloques = ((bloqueConfigs ?? []) as Record<string, unknown>[]).map(bc => ({
      id: bc.id as string,
      etapa_id: bc.etapa_id as string,
      workspace_id: bc.workspace_id as string,
      bloque_definition_id: bc.bloque_definition_id as string,
      estado: bc.estado as 'editable' | 'visible',
      orden: bc.orden as number,
      es_gate: bc.es_gate as boolean,
      nombre: (bc.nombre as string | null) ?? null,
      bloque_definitions: bc.bloque_definitions as BloqueDefinition | null,
      instancia: instanciasMap[bc.id as string] ?? null,
      block_id: blockIdByConfigId.get(bc.id as string),
    }))
  }

  // Borrador de factura Siigo: solo si la etapa actual expone un bloque de
  // facturación (evita queries de más en el resto del flujo). Cliente desde el
  // RUT (campos extraídos de los bloques `documento`) + contacto; valor bruto =
  // honorario (la tarifa UPME es pasante, va FUERA de la factura de venta).
  if (bloques.some(b => b.bloque_definitions?.tipo === 'facturacion')) {
    const { data: docBloques } = await db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(bloque_definitions!inner(tipo))')
      .eq('negocio_id', id)
      .eq('bloque_configs.bloque_definitions.tipo', 'documento')
    const campos: Record<string, string> = {}
    for (const b of ((docBloques ?? []) as Array<{ data: Record<string, unknown> | null }>)) {
      const c = (b.data?.campos ?? {}) as Record<string, { value?: unknown } | undefined>
      for (const [slug, v] of Object.entries(c)) {
        const val = v?.value
        if (val != null && val !== '' && campos[slug] == null) campos[slug] = String(val)
      }
    }
    const numId = campos.numero_identificacion ?? nitSinDv(campos.nit ?? '') ?? null
    let email: string | null = null
    let telefono: string | null = null
    if (negocioTyped.contacto_id) {
      const { data: c } = await db(supabase)
        .from('contactos')
        .select('email, telefono')
        .eq('id', negocioTyped.contacto_id)
        .single()
      email = (c as { email?: string | null } | null)?.email ?? null
      telefono = (c as { telefono?: string | null } | null)?.telefono ?? null
    }
    negocioTyped.factura_draft = {
      tipo_identificacion: campos.tipo_identificacion ?? (numId ? 'NIT' : null),
      numero_identificacion: numId,
      dv: numId ? calcularDvNit(numId) : null,
      nombre: campos.nombre ?? campos.razon_social ?? null,
      direccion: campos.direccion ?? null,
      ciudad: campos.ciudad ?? campos.municipio ?? null,
      email,
      telefono,
      valor_bruto: modeloDinero?.aprobado_honorario ?? null,
    }
  }

  return {
    negocio: negocioTyped,
    bloques,
    etapasLinea,
    blockIdByConfigId: Object.fromEntries(blockIdByConfigId),
  }
}

// ── Datos para formulario de creación ────────────────────────────────────────

export async function getDatosNuevoNegocio(): Promise<{
  empresas: { id: string; nombre: string }[]
  contactos: { id: string; nombre: string }[]
  lineas: LineaNegocio[]
}> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { empresas: [], contactos: [], lineas: [] }

  const [empresasRes, contactosRes, lineasRes] = await Promise.all([
    supabase
      .from('empresas')
      .select('id, nombre')
      .eq('workspace_id', workspaceId)
      .order('nombre', { ascending: true }),
    supabase
      .from('contactos')
      .select('id, nombre')
      .eq('workspace_id', workspaceId)
      .order('nombre', { ascending: true }),
    db(supabase)
      .from('lineas_negocio')
      .select('id, workspace_id, nombre, tipo, numero')
      .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
      .order('numero', { ascending: true }),
  ])

  return {
    empresas: (empresasRes.data ?? []) as { id: string; nombre: string }[],
    contactos: (contactosRes.data ?? []) as { id: string; nombre: string }[],
    lineas: ((lineasRes.data ?? []) as Record<string, unknown>[]).map(l => ({
      id: l.id as string,
      workspace_id: l.workspace_id as string | null,
      nombre: l.nombre as string,
      tipo: l.tipo as 'plantilla' | 'clarity',
      numero: l.numero as number,
    })),
  }
}

// ── Crear negocio ─────────────────────────────────────────────────────────────

/**
 * Negocio que ya existe a nombre del mismo contacto.
 *
 * Se devuelve al intentar crear otro para que el comercial vea CUÁL es antes de
 * decidir. No es un error: un cliente puede comprar dos vehículos. Lo que no
 * puede es crearlo tres veces por equivocación sin que nada se lo advierta.
 */
export interface NegocioDelMismoContacto {
  id: string
  codigo: string | null
  nombre: string
  /** 'abierto' | 'completado' | 'perdido' | … */
  estado: string
  etapa_nombre: string | null
  created_at: string
}

/**
 * Negocios que ya existen para un contacto, del más reciente al más viejo.
 *
 * Vive aparte porque los dos caminos de creación (formulario y conversión de un
 * lead de Meta) tienen que preguntar lo mismo, y el de Meta tiene que hacerlo
 * ANTES de crear la empresa jurídica: si preguntara después, cancelar dejaría
 * una empresa huérfana.
 */
async function negociosDelContacto(
  supabase: unknown,
  workspaceId: string,
  contactoId: string,
): Promise<NegocioDelMismoContacto[]> {
  const { data } = await db(supabase)
    .from('negocios')
    .select('id, codigo, nombre, estado, created_at, etapas_negocio(nombre)')
    .eq('workspace_id', workspaceId)
    .eq('contacto_id', contactoId)
    .order('created_at', { ascending: false })
    .limit(10)

  return ((data ?? []) as Array<{
    id: string
    codigo: string | null
    nombre: string | null
    estado: string | null
    created_at: string
    etapas_negocio: { nombre: string | null } | null
  }>).map(n => ({
    id: n.id,
    codigo: n.codigo,
    nombre: n.nombre ?? 'Sin nombre',
    estado: n.estado ?? 'abierto',
    etapa_nombre: n.etapas_negocio?.nombre ?? null,
    created_at: n.created_at,
  }))
}

export async function crearNegocio(input: {
  nombre: string
  linea_id?: string
  empresa_id?: string
  contacto_id?: string
  precio_estimado?: number
  // Creacion inline si no existe aun en DB
  contacto_nombre?: string
  contacto_telefono?: string
  empresa_nombre?: string
  empresa_sector?: string
  es_persona_natural?: boolean
  /** De dónde vino el negocio. Obligatorio (catálogo ORIGENES_NEGOCIO). */
  origen?: string
  /** Aliado que lo originó. Obligatorio si origen = 'alianza'; ignorado si no. */
  aliado_id?: string
  /**
   * El comercial ya vio los negocios que existen para este contacto y aun así
   * quiere crear otro. Sin esto, la creación se detiene y devuelve `duplicados`.
   */
  confirmar_duplicado?: boolean
}): Promise<{
  negocio_id: string | null
  error: string | null
  /** Presente solo cuando la creación se detuvo esperando confirmación. */
  duplicados?: NegocioDelMismoContacto[]
}> {
  const { supabase, workspaceId, userId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { negocio_id: null, error: 'No autenticado' }

  // ── Origen: validación server-side (la del formulario es solo UX) ──
  // Se exige AL CREAR y no después: un origen que se pide "más tarde" no se
  // registra nunca. El catálogo vive en src/lib/catalogos/constants.ts.
  const origen = input.origen?.trim() ?? ''
  if (!origen) return { negocio_id: null, error: 'Falta el origen del negocio' }
  if (!esOrigenNegocioValido(origen)) {
    return { negocio_id: null, error: `Origen no válido: ${origen}` }
  }
  // Solo 'alianza' guarda aliado; en cualquier otro origen se descarta (evita
  // que un cambio de origen en el formulario deje un aliado colgado).
  let aliadoId: string | null = null
  if (origen === ORIGEN_ALIANZA) {
    const candidato = input.aliado_id?.trim()
    if (!candidato) {
      return { negocio_id: null, error: 'Un negocio de alianza necesita el aliado' }
    }
    // El id debe ser un aliado real de ESTE workspace (barrera cross-tenant).
    const { data: aliadoRow } = await db(supabase)
      .from('aliados')
      .select('id')
      .eq('id', candidato)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!aliadoRow) return { negocio_id: null, error: 'Aliado no encontrado' }
    aliadoId = candidato
  }

  // Get workspace config: stages_activos + linea_activa_id + config_extra
  const { data: wsConfig } = await db(supabase)
    .from('workspaces')
    .select('stages_activos, linea_activa_id, config_extra')
    .eq('id', workspaceId)
    .single()

  // Use linea_activa_id if no linea provided
  const lineaId = input.linea_id ?? (wsConfig as { stages_activos: string[]; linea_activa_id: string | null } | null)?.linea_activa_id
  if (!lineaId) return { negocio_id: null, error: 'No hay línea de negocio configurada' }

  // Crear contacto inline si no existe
  let contactoId = input.contacto_id
  if (!contactoId && input.contacto_nombre?.trim()) {
    const { data: newContact } = await supabase
      .from('contactos')
      .insert({
        workspace_id: workspaceId,
        nombre: input.contacto_nombre.trim(),
        telefono: input.contacto_telefono?.trim() || null,
      })
      .select('id')
      .single()
    contactoId = (newContact as { id: string } | null)?.id
  }

  // ── Ya existe un negocio a nombre de este contacto ──
  //
  // Frena y devuelve cuáles son, para que el comercial lo vea ANTES de crear
  // otro. No bloquea: un cliente puede comprar un segundo vehículo, y ese caso
  // es real (hay negocios en producción nombrados "… NEGOCIO 2"). Lo que se
  // corrige es el otro: el mismo lead creado tres veces por equivocación.
  //
  // Solo aplica cuando el contacto YA existía: uno recién creado aquí arriba no
  // puede tener negocios previos, así que ni se consulta.
  if (input.contacto_id && contactoId && !input.confirmar_duplicado) {
    const previos = await negociosDelContacto(supabase, workspaceId, contactoId)
    if (previos.length > 0) {
      return { negocio_id: null, error: null, duplicados: previos }
    }
  }

  // Persona natural: auto-crear empresa vinculada al contacto
  let empresaId = input.empresa_id
  if (input.es_persona_natural && contactoId) {
    // Buscar empresa ya vinculada a este contacto
    const { data: existingEmpresa } = await supabase
      .from('empresas')
      .select('id')
      .eq('contacto_id', contactoId)
      .maybeSingle()

    if (existingEmpresa) {
      empresaId = existingEmpresa.id
    } else {
      // Obtener nombre del contacto para la empresa
      let contactName = input.contacto_nombre?.trim() || 'Persona Natural'
      if (!input.contacto_nombre && contactoId) {
        const { data: c } = await supabase.from('contactos').select('nombre').eq('id', contactoId).single()
        if (c) contactName = c.nombre
      }
      const { data: newEmpresa } = await supabase
        .from('empresas')
        .insert({
          workspace_id: workspaceId,
          nombre: contactName,
          tipo_persona: 'natural',
          contacto_id: contactoId,
          tipo_documento: 'CC',
          codigo: '', // trigger auto-genera
        })
        .select('id')
        .single()
      if (newEmpresa) empresaId = newEmpresa.id
    }
  }

  // Crear empresa inline si no es persona natural y no existe
  if (!input.es_persona_natural && !empresaId && input.empresa_nombre?.trim()) {
    const { data: newEmpresa } = await db(supabase)
      .from('empresas')
      .insert({
        workspace_id: workspaceId,
        nombre: input.empresa_nombre.trim(),
        sector: input.empresa_sector?.trim() || null,
        tipo_persona: 'juridica',
      })
      .select('id')
      .single()
    empresaId = (newEmpresa as { id: string } | null)?.id
  }

  // Etapa de entrada del negocio MANUAL. Config-driven: si el workspace define
  // config_extra.entrada_manual_orden, el negocio nace en esa etapa (ej. SOENA:
  // Validación orden 1, saltándose el buzón de Recepción que es solo para leads
  // de Meta). Sin el config, cae a la 1ª etapa por orden (retrocompat).
  const stagesActivos = (wsConfig as { stages_activos: string[] } | null)?.stages_activos ?? ['venta', 'ejecucion', 'cobro']
  const entradaManualOrden = (wsConfig as { config_extra?: Record<string, unknown> } | null)
    ?.config_extra?.entrada_manual_orden as number | undefined
  const etapaEntradaQuery = db(supabase)
    .from('etapas_negocio')
    .select('id, stage')
    .eq('linea_id', lineaId)
    .in('stage', stagesActivos)
  const { data: primeraEtapaRaw } = typeof entradaManualOrden === 'number'
    ? await etapaEntradaQuery.eq('orden', entradaManualOrden).limit(1).single()
    : await etapaEntradaQuery.order('orden', { ascending: true }).limit(1).single()

  const primeraEtapa = primeraEtapaRaw as { id: string; stage: string } | null

  // Auto-nombre = contacto (config-driven POR LÍNEA). La regla vive en
  // config_extra.negocio_codigo_format[{linea_id, nombre_auto}] — la misma que
  // define el folio (ej. SOENA/VE → V0001 + nombre = cliente).
  let nombreNegocio = input.nombre
  const codigoFormat = (wsConfig as { config_extra?: Record<string, unknown> } | null)
    ?.config_extra?.negocio_codigo_format as Array<{ linea_id?: string; nombre_auto?: string }> | undefined
  const reglaLinea = Array.isArray(codigoFormat)
    ? codigoFormat.find(r => r.linea_id === lineaId)
    : undefined
  if (reglaLinea?.nombre_auto === 'contacto' && contactoId) {
    if (input.contacto_nombre?.trim()) {
      nombreNegocio = input.contacto_nombre.trim()
    } else {
      const { data: c } = await supabase.from('contactos').select('nombre').eq('id', contactoId).single()
      if (c?.nombre) nombreNegocio = c.nombre
    }
  }

  const { data: negocio, error: insertError } = await db(supabase)
    .from('negocios')
    .insert({
      workspace_id: workspaceId,
      nombre: nombreNegocio,
      linea_id: lineaId,
      empresa_id: empresaId ?? null,
      contacto_id: contactoId ?? null,
      precio_estimado: input.precio_estimado ?? null,
      etapa_actual_id: primeraEtapa?.id ?? null,
      stage_actual: primeraEtapa?.stage ?? null,
      estado: 'abierto',
      origen,
      aliado_id: aliadoId,
    })
    .select('id')
    .single()

  if (insertError || !negocio) {
    return { negocio_id: null, error: (insertError as { message: string })?.message ?? 'Error al crear negocio' }
  }

  const negocioData = negocio as { id: string }

  // Crear a sabiendas de que el contacto ya tenía negocio es una decisión, y por
  // eso queda escrita: es lo único que después distingue un segundo vehículo
  // legítimo de un duplicado que nadie quiso crear.
  if (input.confirmar_duplicado && input.contacto_id && staffId) {
    await db(supabase).from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioData.id,
      tipo: 'cambio_sistema',
      autor_id: staffId,
      contenido: 'Negocio creado con otro(s) ya existente(s) para el mismo contacto, confirmado por quien lo creó',
    })
  }

  // ── Auto-asignar al creador como responsable si es operator ──
  // Un operator solo ve los negocios donde es responsable (negocio_responsables N:M,
  // ver getNegociosV2). Sin esto, un operator comercial/operaciones que crea un
  // negocio lo perdería de vista al instante. Owner/admin/supervisor ven todos →
  // no necesitan auto-asignación. assigned_by = userId (FK a profiles).
  if (role === 'operator' && staffId) {
    try {
      // Vía `asignarResponsable` para que la fila nazca CON rol: sin él, el negocio que
      // el operator acaba de crear le avisa a su supervisor y no a él.
      await asignarResponsable(supabase, {
        negocioId: negocioData.id,
        staffId,
        assignedBy: userId ?? null,
      })
      await sincronizarResponsablePrincipal(supabase, negocioData.id, workspaceId)
    } catch (respErr) {
      // No bloquear la creación del negocio si la auto-asignación falla.
      console.error(
        `[crearNegocio] No se pudo auto-asignar responsable (negocio=${negocioData.id}, staff=${staffId}):`,
        respErr instanceof Error ? respErr.message : respErr,
      )
    }
  }

  // ── Auto-crear carpeta en Google Drive ──
  // La lógica vive en el helper idempotente compartido `ensureNegocioDriveFolder`
  // (una sola vía para formulario / webhook Meta / carga manual / backfill / cron).
  // Resuelve drive_folder_id (linea → fallback workspace), crea carpeta +
  // subcarpetas canónicas y setea carpeta_url. No bloquea la creación del negocio
  // si Drive falla (el error queda registrado en activity_log).
  await ensureNegocioDriveFolder(supabase, workspaceId, negocioData.id)

  // Derivar tipo_persona del solicitante desde la empresa del negocio (natural vs
  // jurídica). Se determina en la creación → ningún bloque manual lo pregunta; los
  // bloques cuyo `condition` mira `tipo_persona` lo leen del dato auto-poblado.
  let tipoPersonaDerivado = 'natural'
  if (empresaId) {
    const { data: empTipo } = await db(supabase)
      .from('empresas')
      .select('tipo_persona')
      .eq('id', empresaId)
      .single()
    if ((empTipo as { tipo_persona: string | null } | null)?.tipo_persona === 'juridica') {
      tipoPersonaDerivado = 'juridica'
    }
  }

  // Crear negocio_bloques para cada bloque_config de la primera etapa
  if (primeraEtapa?.id) {
    const { data: bloqueConfigs } = await db(supabase)
      .from('bloque_configs')
      .select('id, estado, es_gate, config_extra, bloque_definitions(tipo)')
      .eq('etapa_id', primeraEtapa.id)
      .eq('workspace_id', workspaceId)

    if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
      const instancias = (bloqueConfigs as Record<string, unknown>[]).map(bc => {
        const defaults = computeFieldDefaults(bc.config_extra as Record<string, unknown> | null)
        // Auto-poblar tipo_persona (derivado de la empresa) en el bloque que lo declara
        // → sustituye el paso manual: el operador no elige natural/jurídica.
        const fields = ((bc.config_extra as { fields?: Array<{ slug: string }> } | null)?.fields ?? [])
        if (fields.some(f => f.slug === 'tipo_persona')) {
          defaults.tipo_persona = tipoPersonaDerivado
        }
        // Bloques de solo lectura (config estado 'visible') no requieren acción
        // del usuario → nacen completos, SALVO que sean GATE con campos `required`
        // que los defaults no alcancen a llenar (ver `visiblePuedeNacerCompleto`).
        const naceCompleto = bc.estado === 'visible'
          && visiblePuedeNacerCompleto(
            bc.config_extra as Record<string, unknown> | null,
            defaults,
            bc.es_gate === true,
          )
        return {
          negocio_id: negocioData.id,
          bloque_config_id: bc.id as string,
          estado: naceCompleto ? 'completo' : 'pendiente',
          data: Object.keys(defaults).length > 0 ? defaults : {},
          ...(naceCompleto ? { completado_at: new Date().toISOString() } : {}),
        }
      })

      await db(supabase).from('negocio_bloques').insert(instancias)

      // ── Auto-cotización: si algún bloque cotización tiene config auto_cotizacion ──
      // Prioridad de lookup: servicio_id (estable a renames) > servicio_nombre (legacy)
      for (const bc of bloqueConfigs as Array<{
        id: string
        config_extra: Record<string, unknown> | null
        bloque_definitions: { tipo: string } | null
      }>) {
        const tipoBd = bc.bloque_definitions?.tipo
        const autoCot = (bc.config_extra?.auto_cotizacion ?? null) as {
          servicio_id?: string
          servicio_nombre?: string
          usar_precio_estimado?: boolean
        } | null

        if (tipoBd === 'cotizacion' && autoCot && (autoCot.servicio_id || autoCot.servicio_nombre)) {
          await crearCotizacionAutomatica(
            supabase,
            workspaceId,
            negocioData.id,
            { servicio_id: autoCot.servicio_id, servicio_nombre: autoCot.servicio_nombre },
            autoCot.usar_precio_estimado ? (input.precio_estimado ?? 0) : 0
          )
        }

        // ── Auto-init propuesta_economica con precio base del servicio ──
        const autoProp = (bc.config_extra?.auto_propuesta ?? null) as {
          servicio_id?: string
        } | null
        if (tipoBd === 'propuesta_economica' && autoProp?.servicio_id) {
          try {
            const { data: instanciaRow } = await db(supabase)
              .from('negocio_bloques')
              .select('id')
              .eq('negocio_id', negocioData.id)
              .eq('bloque_config_id', bc.id)
              .single()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const inst = instanciaRow as any
            if (inst?.id) {
              const { crearV1Automatica } = await import('@/lib/actions/propuesta-economica-actions')
              await crearV1Automatica(inst.id, autoProp.servicio_id)
            }
          } catch (e) {
            console.error(
              `[crearNegocio] Error auto-init propuesta_economica (bloque_config=${bc.id}):`,
              e instanceof Error ? e.message : String(e),
            )
          }
        }
      }
    }
  }

  revalidatePath('/negocios')
  return { negocio_id: negocioData.id, error: null }
}

// ── Conversión: interacción (lead) → negocio ────────────────────────────────
// Un lead de Meta ya NO crea negocio automáticamente (ver meta-leads-webhook):
// crea un contacto + una interacción. El humano confirma tipo de persona y, si
// es jurídica, la empresa; esta acción crea el negocio real y marca la
// interacción 'convertida'. Reusa crearNegocio (etapa de entrada config-driven =
// Validación, bloques, drive folder, auto-init) y luego enlaza los IDs.

/**
 * Lee un campo del field_data crudo de un lead de Meta (arreglo [{name, values}]).
 * getField acepta varios nombres candidatos y devuelve el primer valor no vacío.
 */
function leerFieldData(
  fieldData: Array<{ name?: string; values?: string[] }>,
  names: string[],
): string | null {
  for (const n of names) {
    const f = fieldData.find((fd) => fd.name?.toLowerCase() === n.toLowerCase())
    // Tolerar campos sin `values` (a veces Meta manda el campo vacío).
    if (f?.values?.length && f.values[0]?.trim()) return f.values[0]
  }
  return null
}

/**
 * Arma el nombre del negocio desde el payload del lead usando la MISMA config que
 * antes usaba el webhook (config_extra.meta_leads.nombre_negocio): base = nombre
 * del contacto, + append_fields (ej. marca-modelo), uppercase opcional.
 * Sin config → nombre base tal cual.
 */
function construirNombreNegocioDesdePayload(
  base: string,
  cfgNombre: { uppercase?: boolean; append_fields?: string[] } | undefined,
  fieldData: Array<{ name?: string; values?: string[] }>,
): string {
  let nombre = base
  const extra = (cfgNombre?.append_fields ?? [])
    .map((name) => leerFieldData(fieldData, [name]))
    .filter((v): v is string => !!v && v.trim().length > 0)
    .map((v) => v.trim())
  if (extra.length) nombre = `${base} - ${extra.join(' ')}`
  return cfgNombre?.uppercase ? nombre.toUpperCase() : nombre
}

export async function crearNegocioDesdeInteraccion(input: {
  interaccion_id: string
  tipo_persona: 'natural' | 'juridica'
  empresa_nombre?: string
  empresa_nit?: string
  /** Ver `crearNegocio`: el comercial ya vio los negocios previos del contacto. */
  confirmar_duplicado?: boolean
}): Promise<{
  negocio_id: string | null
  error: string | null
  duplicados?: NegocioDelMismoContacto[]
}> {
  // userId = profile.id (para assigned_by, FK a profiles). staffId = staff.id
  // (para negocio_responsables.staff_id y como fallback de responsable del negocio).
  const { supabase, workspaceId, userId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { negocio_id: null, error: 'No autenticado' }

  // 1. Cargar la interacción (RLS ya la acota al workspace del usuario).
  const { data: interRaw, error: interErr } = await db(supabase)
    .from('contacto_interacciones')
    .select('id, contacto_id, estado, negocio_id, payload, fuente')
    .eq('id', input.interaccion_id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const inter = interRaw as {
    id: string
    contacto_id: string
    estado: string
    negocio_id: string | null
    payload: Record<string, unknown> | null
    fuente: string | null
  } | null
  if (interErr || !inter) return { negocio_id: null, error: 'Interacción no encontrada' }
  if (inter.estado === 'convertida' && inter.negocio_id) {
    // Idempotente: ya se convirtió antes → devolver el negocio existente.
    return { negocio_id: inter.negocio_id, error: null }
  }

  const fieldData = (inter.payload?.field_data ?? []) as Array<{ name?: string; values?: string[] }>
  const leadgenId = (inter.payload?.leadgen_id ?? null) as string | null

  // Atribucion de campana Meta: snapshot que viaja de la interaccion al negocio
  // al convertir, para medir eficacia de campana desde el negocio ganado. Tolerante
  // a nulls (los leads viejos solo traen platform + ad_id); copia lo que exista en
  // el payload, nunca inventa valores.
  const payloadMeta = (inter.payload ?? {}) as Record<string, unknown>
  const metaStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  const createdTimeRaw = payloadMeta.created_time
  const atribucion = {
    fuente: 'meta' as const,
    campaign_id: metaStr(payloadMeta.campaign_id),
    campaign_name: metaStr(payloadMeta.campaign_name),
    adset_id: metaStr(payloadMeta.adset_id),
    adset_name: metaStr(payloadMeta.adset_name),
    ad_id: metaStr(payloadMeta.ad_id),
    ad_name: metaStr(payloadMeta.ad_name),
    platform: metaStr(payloadMeta.platform),
    form_id: metaStr(payloadMeta.form_id),
    leadgen_id: leadgenId,
    interaccion_id: inter.id,
    ocurrida_at:
      typeof createdTimeRaw === 'number'
        ? String(createdTimeRaw)
        : metaStr(createdTimeRaw),
  }

  // 2. Nombre + responsable del contacto (el responsable del contacto tiene
  //    prioridad sobre el staff del usuario que convierte).
  const { data: contactoRow } = await db(supabase)
    .from('contactos')
    .select('nombre, responsable_id')
    .eq('id', inter.contacto_id)
    .eq('workspace_id', workspaceId)
    .single()
  const contactoInfo = contactoRow as { nombre: string | null; responsable_id: string | null } | null
  const contactoNombre = contactoInfo?.nombre?.trim() || 'Lead'

  // 3. Nombre del negocio config-driven (misma config que usaba el webhook).
  const { data: wsCfg } = await db(supabase)
    .from('workspaces')
    .select('config_extra')
    .eq('id', workspaceId)
    .single()
  const cfgNombre = ((wsCfg as { config_extra?: { meta_leads?: {
    nombre_negocio?: { uppercase?: boolean; append_fields?: string[] }
  } } } | null)?.config_extra?.meta_leads?.nombre_negocio)
  const nombreNegocio = construirNombreNegocioDesdePayload(contactoNombre, cfgNombre, fieldData)

  // 3.b. ¿Este contacto ya tiene negocio? Se pregunta ANTES de crear la empresa
  //      jurídica del paso 4: si se preguntara después, cancelar dejaría una
  //      empresa huérfana en el directorio.
  if (!input.confirmar_duplicado) {
    const previos = await negociosDelContacto(supabase, workspaceId, inter.contacto_id)
    if (previos.length > 0) {
      return { negocio_id: null, error: null, duplicados: previos }
    }
  }

  // 4. Empresa jurídica: crearla y vincularla por empresa_id. Natural: crearNegocio
  //    aplica el patrón vigente (PN = su propia empresa auto, desde el contacto).
  let empresaId: string | undefined
  if (input.tipo_persona === 'juridica') {
    const empresaNombre = input.empresa_nombre?.trim()
    if (!empresaNombre) return { negocio_id: null, error: 'Falta el nombre de la empresa (persona jurídica)' }
    const nitLimpio = input.empresa_nit?.trim() ? nitSinDv(input.empresa_nit.trim()) : null
    const { data: newEmpresa, error: empErr } = await db(supabase)
      .from('empresas')
      .insert({
        workspace_id: workspaceId,
        nombre: empresaNombre,
        tipo_persona: 'juridica',
        ...(nitLimpio ? { numero_documento: nitLimpio, tipo_documento: 'NIT' } : {}),
      })
      .select('id')
      .single()
    if (empErr || !newEmpresa) {
      return { negocio_id: null, error: (empErr as { message?: string } | null)?.message ?? 'No se pudo crear la empresa' }
    }
    empresaId = (newEmpresa as { id: string }).id
  }

  // 5. Crear el negocio reusando crearNegocio (etapa de entrada = Validación por
  //    config entrada_manual_orden, bloques, carpeta de Drive, auto-init).
  //    El origen NO se le pregunta a nadie: sale del canal de la interacción
  //    (contacto_interacciones.fuente). Si el negocio nace de un lead de Meta,
  //    el origen ES Meta. Preguntarlo abriría la puerta a marcarlo mal justo en
  //    el camino donde el dato ya es certero.
  const res = await crearNegocio({
    nombre: nombreNegocio,
    contacto_id: inter.contacto_id,
    empresa_id: empresaId,
    es_persona_natural: input.tipo_persona === 'natural',
    origen: origenDesdeFuenteInteraccion(inter.fuente),
    // Se propaga el valor REAL, no un `true` fijo: con `true` siempre, el registro
    // de "creado a sabiendas" se escribiría también en los casos donde no había
    // ningún negocio previo, y dejaría de significar nada.
    confirmar_duplicado: input.confirmar_duplicado,
  })
  if (res.error || !res.negocio_id) {
    return { negocio_id: null, error: res.error ?? 'No se pudo crear el negocio' }
  }

  // 6. Enlazar el negocio con la interacción de origen (metadata) + fijar el
  //    responsable + marcar la interacción convertida.
  //
  //    Metadata: MERGE, no overwrite. crearNegocio (y sus triggers/auto-init)
  //    pueden haber escrito metadata; leemos el actual y combinamos para no
  //    perderlo. interaccion_id / leadgen_id / fuente_cargue mandan (identifican
  //    el origen del negocio).
  const { data: negActual } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', res.negocio_id)
    .eq('workspace_id', workspaceId)
    .single()
  const metadataActual = ((negActual as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>

  // Responsable del negocio: el del contacto tiene prioridad; si el contacto no
  // tiene, el staff del usuario que convierte. El negocio convertido NUNCA queda
  // sin responsable (mientras haya alguno de los dos).
  const responsableId = contactoInfo?.responsable_id ?? staffId ?? null

  await db(supabase)
    .from('negocios')
    .update({
      metadata: { ...metadataActual, interaccion_id: inter.id, leadgen_id: leadgenId, fuente_cargue: 'meta_lead', atribucion },
      ...(responsableId ? { responsable_id: responsableId } : {}),
    })
    .eq('id', res.negocio_id)
    .eq('workspace_id', workspaceId)

  // Upsert idempotente en negocio_responsables (N:M, fuente de verdad de la lista
  // de responsables). Sin esto, las dos vistas (escalar responsable_id vs. lista
  // N:M) divergen. ON CONFLICT DO NOTHING vía upsert con ignoreDuplicates.
  if (responsableId) {
    try {
      // Con rol derivado del área (ver `asignarResponsable`): una fila sin rol deja al
      // responsable invisible para el routing de avisos.
      await asignarResponsable(supabase, {
        negocioId: res.negocio_id,
        staffId: responsableId,
        assignedBy: userId ?? null,
      })
      await sincronizarResponsablePrincipal(supabase, res.negocio_id, workspaceId)
    } catch (respErr) {
      // No bloquear la conversión si la asignación de responsable falla.
      console.error(
        `[crearNegocioDesdeInteraccion] No se pudo asignar responsable (negocio=${res.negocio_id}, staff=${responsableId}):`,
        respErr instanceof Error ? respErr.message : respErr,
      )
    }
  }

  await db(supabase)
    .from('contacto_interacciones')
    .update({ estado: 'convertida', negocio_id: res.negocio_id })
    .eq('id', inter.id)
    .eq('workspace_id', workspaceId)

  revalidatePath(`/directorio/contacto/${inter.contacto_id}`)
  revalidatePath('/negocios')
  return { negocio_id: res.negocio_id, error: null }
}

// ── Acciones de bandeja: marcar/descartar una interacción ───────────────────

export async function marcarInteraccionContactada(
  interaccionId: string,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const { data: interRaw } = await db(supabase)
    .from('contacto_interacciones')
    .select('contacto_id')
    .eq('id', interaccionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const { error: dbErr } = await db(supabase)
    .from('contacto_interacciones')
    .update({ estado: 'contactada' })
    .eq('id', interaccionId)
    .eq('workspace_id', workspaceId)
  if (dbErr) return { success: false, error: (dbErr as { message: string }).message }
  const contactoId = (interRaw as { contacto_id: string } | null)?.contacto_id
  if (contactoId) revalidatePath(`/directorio/contacto/${contactoId}`)
  return { success: true }
}

export async function descartarInteraccion(
  interaccionId: string,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const { data: interRaw } = await db(supabase)
    .from('contacto_interacciones')
    .select('contacto_id')
    .eq('id', interaccionId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const { error: dbErr } = await db(supabase)
    .from('contacto_interacciones')
    .update({ estado: 'descartada' })
    .eq('id', interaccionId)
    .eq('workspace_id', workspaceId)
  if (dbErr) return { success: false, error: (dbErr as { message: string }).message }
  const contactoId = (interRaw as { contacto_id: string } | null)?.contacto_id
  if (contactoId) revalidatePath(`/directorio/contacto/${contactoId}`)
  return { success: true }
}

// ── Auto-crear cotización al crear negocio ──────────────────────────────────
// Se llama internamente desde crearNegocio() si el bloque cotización tiene
// config_extra.auto_cotizacion configurado (ej: SOENA VE).


type SupabaseClient = Awaited<ReturnType<typeof import('@/lib/actions/get-workspace').getWorkspace>>['supabase']

async function crearCotizacionAutomatica(
  supabase: SupabaseClient,
  workspaceId: string,
  negocioId: string,
  lookup: { servicio_id?: string; servicio_nombre?: string },
  precioEstimado: number
) {
  // 1. Obtener consecutivo
  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${bogotaYear()}-${Date.now()}`

  // 2. Crear cotización detallada en borrador
  const { data: cotData, error: cotErr } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      consecutivo,
      codigo: '',
      modo: 'detallada',
      valor_total: precioEstimado,
      estado: 'borrador',
    })
    .select('id')
    .single()

  if (cotErr || !cotData) return

  const cotizacionId = cotData.id

  // 3. Buscar servicio por ID (preferido) o por nombre (legacy)
  let servicioQuery = supabase
    .from('servicios')
    .select('id, nombre, precio_estandar, rubros_template')
    .eq('workspace_id', workspaceId)
    .eq('activo', true)
    .limit(1)
  if (lookup.servicio_id) {
    servicioQuery = servicioQuery.eq('id', lookup.servicio_id)
  } else if (lookup.servicio_nombre) {
    servicioQuery = servicioQuery.ilike('nombre', lookup.servicio_nombre)
  } else {
    return
  }
  const { data: servicio } = await servicioQuery.single()

  if (!servicio) return

  // 4. Crear item desde el servicio
  const rubrosTemplate = servicio.rubros_template as Array<{
    tipo: string; descripcion?: string; cantidad: number; unidad: string; valor_unitario: number
  }> | null

  const subtotal = rubrosTemplate && rubrosTemplate.length > 0
    ? rubrosTemplate.reduce((sum: number, r: { cantidad: number; valor_unitario: number }) => sum + (r.cantidad * r.valor_unitario), 0)
    : (servicio.precio_estandar ?? 0)

  const { data: newItem } = await supabase
    .from('items')
    .insert({
      cotizacion_id: cotizacionId,
      nombre: servicio.nombre,
      subtotal,
      orden: 1,
      servicio_origen_id: servicio.id,
    })
    .select('id')
    .single()

  // 5. Deep copy rubros del template
  if (rubrosTemplate && rubrosTemplate.length > 0 && newItem) {
    const rubrosToInsert = rubrosTemplate.map((r: { tipo: string; descripcion?: string; cantidad: number; unidad: string; valor_unitario: number }) => ({
      item_id: newItem.id,
      tipo: r.tipo,
      descripcion: r.descripcion || null,
      cantidad: r.cantidad,
      unidad: r.unidad,
      valor_unitario: r.valor_unitario,
    }))
    await supabase.from('rubros').insert(rubrosToInsert)
  }

  // 6. Si precio_estimado > 0, ya se puso como valor_total arriba.
  //    Si es 0, usar precio_estandar del servicio.
  if (precioEstimado === 0 && (servicio.precio_estandar ?? 0) > 0) {
    await supabase
      .from('cotizaciones')
      .update({ valor_total: servicio.precio_estandar ?? 0 })
      .eq('id', cotizacionId)
  }
}

// ── Cambiar etapa del negocio ─────────────────────────────────────────────────

export async function cambiarEtapaNegocio(
  negocioId: string,
  nuevaEtapaId: string
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const { data: etapaRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('id, stage')
    .eq('id', nuevaEtapaId)
    .single()

  const etapa = etapaRaw as { id: string; stage: string } | null
  if (!etapa) return { error: 'Etapa no encontrada' }

  const { error: updateError } = await db(supabase)
    .from('negocios')
    .update({
      etapa_actual_id: nuevaEtapaId,
      stage_actual: etapa.stage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updateError) return { error: (updateError as { message: string }).message }

  // Crear negocio_bloques para la nueva etapa si no existen
  // Solo heredar estado/data para bloques VISIBLE (editable siempre empieza pendiente)
  const { data: bloqueConfigs } = await db(supabase)
    .from('bloque_configs')
    .select('id, bloque_definition_id, estado, es_gate, nombre, config_extra, bloque_definitions(tipo)')
    .eq('etapa_id', nuevaEtapaId)
    .eq('workspace_id', workspaceId)

  if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
    const typedConfigs = bloqueConfigs as Array<{
      id: string
      bloque_definition_id: string
      estado: string
      es_gate: boolean | null
      nombre: string | null
      config_extra: Record<string, unknown> | null
      bloque_definitions: { tipo: string } | null
    }>
    const configIds = typedConfigs.map(b => b.id)

    const instanciasExistentes = await db(supabase)
      .from('negocio_bloques')
      .select('bloque_config_id')
      .eq('negocio_id', negocioId)
      .in('bloque_config_id', configIds)

    const existingIds = new Set(
      ((instanciasExistentes.data ?? []) as Record<string, unknown>[]).map(
        i => i.bloque_config_id as string
      )
    )

    // Obtener bloques completados de este negocio (de cualquier etapa) con su definition_id + bloque_items
    const { data: completadosRaw } = await db(supabase)
      .from('negocio_bloques')
      .select('id, estado, data, completado_at, bloque_configs(bloque_definition_id, nombre, config_extra, bloque_definitions(tipo))')
      .eq('negocio_id', negocioId)
      .eq('estado', 'completo')

    const completadosPorDef = new Map<string, { id: string; data: Record<string, unknown>; completado_at: string | null }>()
    for (const c of ((completadosRaw ?? []) as Record<string, unknown>[])) {
      const defId = (c.bloque_configs as Record<string, unknown> | null)?.bloque_definition_id as string | null
      if (defId) {
        completadosPorDef.set(defId, {
          id: c.id as string,
          data: (c.data ?? {}) as Record<string, unknown>,
          completado_at: c.completado_at as string | null,
        })
      }
    }

    // Mapa adicional para tipos que comparten bloque_definition_id:
    // - documento: keyed por {definition_id}:{config_extra.label}
    // - datos: keyed por {definition_id}:{bloque_configs.nombre}
    const completadosPorLabel = new Map<string, { id: string; data: Record<string, unknown>; completado_at: string | null }>()
    for (const c of ((completadosRaw ?? []) as Record<string, unknown>[])) {
      const config = c.bloque_configs as Record<string, unknown> | null
      const defId = config?.bloque_definition_id as string | null
      const tipo = (config?.bloque_definitions as Record<string, unknown> | null)?.tipo as string | null
      const entry = {
        id: c.id as string,
        data: (c.data ?? {}) as Record<string, unknown>,
        completado_at: c.completado_at as string | null,
      }
      if (tipo === 'documento' && defId) {
        const label = (config?.config_extra as Record<string, unknown> | null)?.label as string | null
        if (label) completadosPorLabel.set(`${defId}:${label}`, entry)
      }
      if (tipo === 'datos' && defId) {
        const nombre = config?.nombre as string | null
        if (nombre) completadosPorLabel.set(`${defId}:${nombre}`, entry)
      }
    }

    const nuevas = typedConfigs
      .filter(bc => !existingIds.has(bc.id))
      .map(bc => {
        const isVisible = bc.estado === 'visible'
        const tipo = bc.bloque_definitions?.tipo
        const isDocumento = tipo === 'documento'
        const isDatos = tipo === 'datos'

        let prevCompleto
        if (isVisible) {
          if (isDatos) {
            // Los bloques `datos` COMPARTEN un mismo `bloque_definition_id` genérico, así
            // que ese id NO identifica la casilla: solo dice "esto es un bloque de datos".
            // La identidad real es el nombre. Antes, si el nombre no encontraba pareja se
            // caía a `completadosPorDef`, que devuelve CUALQUIER bloque `datos` ya
            // completado del negocio — sin ninguna relación semántica.
            //
            // Eso copiaba respuestas ajenas: medido el 2026-07-31 en SOENA, 321 instancias
            // con data que no corresponde a sus propios campos ("Vehículo a reemplazar"
            // con `requiere_devolucion_iva` adentro, "Radicado de inclusión" con el
            // radicado de certificación). El motor de routing hace `Object.assign` de
            // TODAS las data de los bloques `datos` de la etapa antes de evaluar sus
            // condiciones, así que una clave prestada puede decidir una rama.
            //
            // Medido antes de cambiarlo: ningún valor prestado contradice al de su dueño
            // (se copian dentro del mismo negocio), y las 10 herencias legítimas de la
            // línea coinciden por nombre. El caso dañino es el otro: cuando el dueño NO
            // tiene valor y el prestado ocupa su lugar — así nació completo y con basura
            // el bloque de la cita DIAN.
            //
            // Sin pareja por nombre: nace pendiente y vacío. No se adivina.
            prevCompleto = bc.nombre
              ? completadosPorLabel.get(`${bc.bloque_definition_id}:${bc.nombre}`)
              : undefined
          } else {
            // Tipos con definition_id propio (propuesta, cobros, historial…): el id SÍ
            // identifica al bloque, así que heredar por definition_id es correcto.
            prevCompleto = completadosPorDef.get(bc.bloque_definition_id)
          }
        } else if (isDocumento) {
          // Documento blocks: match by label across etapas (all share same definition_id)
          const label = (bc.config_extra as Record<string, unknown> | null)?.label as string | null
          if (label) {
            prevCompleto = completadosPorLabel.get(`${bc.bloque_definition_id}:${label}`)
          }
        } else if (tipo === 'cotizacion') {
          // Cotización: inherit completion state across etapas (unique definition_id)
          prevCompleto = completadosPorDef.get(bc.bloque_definition_id)
        }

        // If no inherited data, initialize with field defaults from config
        const data = prevCompleto?.data
          ?? (isDatos ? computeFieldDefaults(bc.config_extra as Record<string, unknown> | null) : {})

        // Heredar el estado `completo` exige además que los campos `required` del bloque
        // DESTINO tengan valor: el origen puede declarar otros campos, y un gate no debe
        // darse por cumplido con una respuesta que su propia casilla no tiene.
        const heredaCompleto = !!prevCompleto
          && (!isVisible || visiblePuedeNacerCompleto(
                bc.config_extra as Record<string, unknown> | null,
                data,
                bc.es_gate === true,
              ))

        return {
          negocio_id: negocioId,
          bloque_config_id: bc.id,
          estado: heredaCompleto ? 'completo' : 'pendiente',
          data,
          completado_at: heredaCompleto ? (prevCompleto?.completado_at ?? null) : null,
        }
      })

    if (nuevas.length > 0) {
      const { data: insertadas } = await db(supabase)
        .from('negocio_bloques')
        .insert(nuevas)
        .select('id, bloque_config_id')

      // Copiar bloque_items para bloques visibles que heredaron de un bloque previo
      if (insertadas) {
        for (const inst of (insertadas as Array<{ id: string; bloque_config_id: string }>)) {
          const bc = typedConfigs.find(c => c.id === inst.bloque_config_id)
          if (!bc || bc.estado !== 'visible') continue
          const prev = completadosPorDef.get(bc.bloque_definition_id)
          if (!prev) continue

          // Copiar items del bloque fuente al nuevo bloque visible
          const { data: sourceItems } = await db(supabase)
            .from('bloque_items')
            .select('orden, label, tipo, contenido, completado, completado_por, completado_at, link_url, imagen_data')
            .eq('negocio_bloque_id', prev.id)

          if (sourceItems && (sourceItems as unknown[]).length > 0) {
            const copiedItems = (sourceItems as Record<string, unknown>[]).map(item => ({
              ...item,
              negocio_bloque_id: inst.id,
            }))
            await db(supabase).from('bloque_items').insert(copiedItems)
          }
        }
      }
    }
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// `sincronizarSegmentoContacto` + `SEGMENTO_RANK` vivían aquí y se eliminaron el
// 2026-07-31: el campo `contactos.segmento` pasó a ser el "Status" de gestión
// comercial (ver STATUS_CONTACTO en catalogos/constants.ts), que lo marca una
// persona. Mantener la escritura automática habría pisado su trabajo en cada
// avance de etapa.

// ── Gate de anticipo cubierto por saldo (independiente de la vía de pago) ─────
//
// El bloque de anticipo (config_extra.es_pagos_epayco, es_gate) se cerraba SOLO si
// el pago entraba por su propio flujo ePayco (persiste `pagos` en la instancia). Un
// pago que llega por REPARTO (cobro tipo_cobro='pago' con split_id), por el FAB, o
// manual, deja el negocio pagado pero el gate del anticipo nunca se cierra → no
// avanza. Opción A (aprobada): el gate se satisface cuando el negocio YA tiene
// cubierto su anticipo esperado, sin importar la vía.

// Porcentaje del precio que constituye el anticipo en Plan 1 (50/50).
// TODO: validar con Carmen si la base del anticipo es honorario-only vs precio
// completo. Por ahora la base es el precio_aprobado completo.
const ANTICIPO_PCT_PLAN1 = 0.5

/**
 * ¿El negocio ya tiene cubierto su anticipo esperado por el saldo real (cualquier
 * vía: reparto, FAB, manual, ePayco)?
 *
 * - `cobrado` = SUM(cobros.monto) del negocio (todos los cobros — mismo criterio de
 *   cobrado que usa la conciliación).
 * - `anticipoEsperado` se deriva de la propuesta aprobada (`aprobado_plan`, leído
 *   DIRECTO de la propuesta — NO vía `leerModeloDineroNegocio`, que devuelve null sin
 *   tarifa pasante) + `precio_aprobado`:
 *     · Plan 1 (50/50) → round(precio_aprobado * ANTICIPO_PCT_PLAN1)
 *     · Plan 2 (único) → precio_aprobado (100%)
 *     · Sin plan / sin precio → precio_aprobado (conservador: exige pago completo)
 *
 * Devuelve true solo si `anticipoEsperado > 0` Y `cobrado >= anticipoEsperado - 1`
 * (tolerancia de 1 peso). Con cobrado=0 y precio>0 devuelve false (sigue bloqueando).
 */
async function anticipoCubiertoPorSaldo(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
): Promise<boolean> {
  const [negRes, cobrosRes, propRes, conciliadoRes] = await Promise.all([
    db(supabase)
      .from('negocios')
      .select('precio_aprobado, precio_estimado')
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    db(supabase)
      .from('cobros')
      .select('monto, split_json')
      .eq('negocio_id', negocioId)
      .eq('workspace_id', workspaceId),
    db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(bloque_definitions!inner(tipo))')
      .eq('negocio_id', negocioId)
      .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica'),
    db(supabase)
      .from('negocio_conciliacion')
      .select('conciliado')
      .eq('negocio_id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ])

  const neg = negRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
  const precio = neg?.precio_aprobado ?? neg?.precio_estimado ?? 0

  const propuestas = ((propRes.data ?? []) as Array<{ data: Record<string, unknown> | null }>)

  if (!(precio > 0)) {
    // Distinguir "cero deliberado" (no hay honorario que cobrar: propuesta económica
    // APROBADA cuyo valor final es 0) de "aún sin cotizar" (precio null/0 porque nunca
    // se aprobó una propuesta). Solo el primero da el gate por satisfecho; el segundo
    // sigue bloqueando — no abrir la puerta a saltar el anticipo de algo no cotizado.
    if (esCeroDeliberado(propuestas, neg?.precio_aprobado ?? null)) return true
    return false
  }

  // Recaudo CONFIRMADO: una porción de reparto que el comercial propuso y la financiera
  // todavía no validó NO cierra este gate. Es exactamente lo que pasó con V0287 el
  // 2026-08-05: media referencia ajena cerró su anticipo y el negocio avanzó con plata
  // que no era suya. Ver `lib/negocios/recaudo-confirmado.ts`.
  const conciliado = (conciliadoRes.data as { conciliado: boolean } | null)?.conciliado === true
  const cobrado = sumarRecaudoConfirmado(
    (cobrosRes.data ?? []) as CobroParaRecaudo[],
    conciliado,
  )

  // Plan aprobado, leído DIRECTO de la propuesta (el bloque con plan aprobado gana).
  let plan: 1 | 2 | null = null
  for (const pb of propuestas) {
    const planRaw = pb.data?.aprobado_plan
    if (planRaw === 1 || planRaw === 2) { plan = planRaw as 1 | 2; break }
  }

  const anticipoEsperado = plan === 1
    ? Math.round(precio * ANTICIPO_PCT_PLAN1)
    : precio // Plan 2 (único) o sin plan → pago completo (conservador)

  if (!(anticipoEsperado > 0)) return false
  return cobrado >= anticipoEsperado - 1
}

/**
 * Auto-completa los bloques gate de la etapa actual con `config_extra.es_pagos_epayco`
 * cuyo anticipo esperado YA está cubierto por el saldo del negocio (cualquier vía).
 * Genérico/opt-in por `es_pagos_epayco` (otros workspaces sin esa config no se tocan).
 * Idempotente: no toca bloques ya `completo`. NO auto-completa si el saldo no cubre.
 */
async function autocompletarGatesAnticipoPorSaldo(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
  etapaActualId: string,
  staffId: string | null,
): Promise<void> {
  const { data: bloquesRaw } = await db(supabase)
    .from('negocio_bloques')
    .select('id, estado, data, bloque_configs!inner(config_extra, es_gate, etapa_id)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.etapa_id', etapaActualId)

  const bloques = ((bloquesRaw ?? []) as Array<{
    id: string
    estado: string | null
    data: Record<string, unknown> | null
    bloque_configs: { config_extra: Record<string, unknown> | null; es_gate: boolean | null } | null
  }>).filter((b) => {
    const cfg = b.bloque_configs
    return cfg?.es_gate === true
      && cfg?.config_extra?.es_pagos_epayco === true
      && b.estado === 'pendiente'
  })

  if (bloques.length === 0) return

  // Solo consultar el saldo si hay algún bloque candidato.
  const cubierto = await anticipoCubiertoPorSaldo(supabase, workspaceId, negocioId)
  if (!cubierto) return

  const nowIso = new Date().toISOString()
  for (const b of bloques) {
    const nuevaData = {
      ...(b.data ?? {}),
      _completado_via: 'saldo',
      _nota: 'Anticipo cubierto por el saldo del negocio (reparto/otro pago); gate cerrado automáticamente.',
    }
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'completo', completado_at: nowIso, data: nuevaData })
      .eq('id', b.id)

    if (staffId) {
      try {
        await db(supabase).from('activity_log').insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: negocioId,
          tipo: 'comentario',
          autor_id: staffId,
          contenido: 'Anticipo cubierto por el saldo del negocio (reparto/otro pago); gate cerrado automáticamente.',
        })
      } catch { /* no bloquear por el log */ }
    }
  }
}

/**
 * Rehace lo que dependía del recaudo de un negocio cuando ese recaudo CAMBIÓ hacia
 * abajo — hoy, al anular un cobro (`lib/actions/pagos-externos.ts`).
 *
 * Dejar de sumar la plata no basta. Con esa plata ya se tomaron decisiones que quedaron
 * escritas: el negocio pudo marcarse conciliado, su bloque de cobros pudo pasar a
 * completo, y el gate de anticipo pudo cerrarse SOLO porque el saldo lo cubría
 * (`autocompletarGatesAnticipoPorSaldo`). Un cobro anulado que deja un gate cerrado
 * detrás es peor que no poder anularlo: el caso avanza con plata que ya no existe.
 *
 * Las tres cosas se deshacen aquí:
 *   1. El negocio deja de estar conciliado (cambió su cobrado).
 *   2. Sus bloques de cobros se reevalúan (`reevaluarBloquesCobros` los devuelve a
 *      pendiente si el saldo dejó de estar cubierto).
 *   3. Los gates cerrados con la marca `_completado_via: 'saldo'` se REABREN si el
 *      saldo ya no alcanza. Solo esos: un gate que alguien cerró a mano no se toca,
 *      porque no fue esta plata la que lo cerró.
 *
 * NO revierte un avance de etapa ya ocurrido. Reabrir el gate es lo que impide el
 * siguiente avance; devolver un caso de etapa es una decisión con consecuencias
 * propias (documentos, avisos, responsables) y la toma una persona, no una anulación.
 */
export async function recalcularNegocioPorCambioDeRecaudo(
  negocioId: string,
  motivo: string,
): Promise<{ gates_reabiertos: number }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { gates_reabiertos: 0 }

  // 1. El check de conciliación se cae: el cobrado ya no es el que se validó.
  await db(supabase)
    .from('negocio_conciliacion')
    .update({ conciliado: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)

  // 2. Bloques de cobros: completo ⇄ pendiente según el saldo real.
  await reevaluarBloquesCobros(negocioId)

  // 3. Gates de anticipo cerrados por saldo.
  const cubierto = await anticipoCubiertoPorSaldo(supabase, workspaceId, negocioId)
  if (cubierto) return { gates_reabiertos: 0 }

  const { data: bloquesRaw } = await db(supabase)
    .from('negocio_bloques')
    .select('id, estado, data, bloque_configs!inner(config_extra, es_gate)')
    .eq('negocio_id', negocioId)

  const aReabrir = ((bloquesRaw ?? []) as Array<{
    id: string
    estado: string | null
    data: Record<string, unknown> | null
    bloque_configs: { config_extra: Record<string, unknown> | null; es_gate: boolean | null } | null
  }>).filter(
    (b) =>
      b.estado === 'completo' &&
      b.bloque_configs?.es_gate === true &&
      b.bloque_configs?.config_extra?.es_pagos_epayco === true &&
      b.data?._completado_via === 'saldo',
  )

  const nowIso = new Date().toISOString()
  for (const b of aReabrir) {
    const data = { ...(b.data ?? {}) }
    delete data._completado_via
    data._nota = `Gate reabierto: el saldo que lo cerró dejó de existir (${motivo}).`
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'pendiente', completado_at: null, data, updated_at: nowIso })
      .eq('id', b.id)

    if (staffId) {
      try {
        await db(supabase).from('activity_log').insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: negocioId,
          tipo: 'comentario',
          autor_id: staffId,
          contenido: `Gate de anticipo REABIERTO: se había cerrado solo porque el saldo lo cubría, y ese saldo cambió (${motivo}).`,
        })
      } catch { /* no bloquear por el log */ }
    }
  }

  revalidatePath(`/negocios/${negocioId}`)
  return { gates_reabiertos: aReabrir.length }
}

// ── El motor exige el dato antes de decidir ───────────────────────────────────
//
// Resuelve los campos que gobiernan la bifurcación de una etapa: dónde se responde cada uno
// y si la pregunta le corresponde a ESTE caso. La regla de qué cuenta como respuesta y qué
// se le dice al equipo vive en `lib/negocios/dato-de-decision.ts`, porque la aplican los DOS
// sitios que resuelven routing (el avance de etapa y el salto encadenado por saldo).
//
// `aplica` sale de la `condition` del bloque dueño, evaluada con `condicion_cumplida` — la
// MISMA función SQL que usan los gates y que replica el render. Un bloque que no aplica no
// se muestra y no se puede responder: exigirle el dato dejaría el caso sin salida.
async function camposDecisionDelNegocio(
  supabase: unknown,
  negocioId: string,
  lineaId: string,
  sourceEtapaId: string,
  routing: RoutingEtapa,
): Promise<CampoDecision[]> {
  const campos = camposDeDecision(routing)
  if (campos.length === 0) return []

  const [bloquesRes, etapaRes] = await Promise.all([
    db(supabase)
      .from('bloque_configs')
      .select('nombre, config_extra, bloque_definitions!inner(tipo)')
      .eq('etapa_id', sourceEtapaId),
    db(supabase).from('etapas_negocio').select('nombre').eq('id', sourceEtapaId).single(),
  ])
  const etapaNombre = (etapaRes.data as { nombre: string } | null)?.nombre ?? null

  type BloqueCfg = {
    nombre: string | null
    config_extra: Record<string, unknown> | null
    bloque_definitions: { tipo: string } | null
  }
  const bloques = ((bloquesRes.data ?? []) as BloqueCfg[]).filter(
    b => b.bloque_definitions?.tipo === 'datos' && b.config_extra?.desactivado !== true,
  )

  const resultado: CampoDecision[] = []
  for (const campo of campos) {
    let dueno: BloqueCfg | null = null
    let field: Record<string, unknown> | null = null
    for (const b of bloques) {
      const fields = (b.config_extra?.fields ?? []) as Array<Record<string, unknown>>
      const encontrado = fields.find(f => f.slug === campo)
      if (encontrado) { dueno = b; field = encontrado; break }
    }

    if (!dueno) {
      // Nadie declara el campo. El guardián lo reporta como `decision_sin_dueno`; aquí se
      // frena porque es la forma más pura del defecto: el motor decidiría con un dato que
      // NO existe en ninguna parte.
      resultado.push({ campo, bloque: null, etapa: etapaNombre })
      continue
    }

    let aplica = true
    const condition = dueno.config_extra?.condition as Record<string, unknown> | null | undefined
    if (condition) {
      const { data: cumple } = await db(supabase).rpc('condicion_cumplida', {
        p_negocio_id: negocioId,
        p_linea_id: lineaId,
        p_etapa_actual_id: sourceEtapaId,
        p_cond: condition,
      })
      aplica = cumple === true
    }

    let bloqueNombre = dueno.nombre ?? null
    let label = (field?.label as string | null) ?? null
    let etapaLabel = etapaNombre

    // Campo DERIVADO (`lock_when.mapping`, objetivo O3): no es una pregunta sino la
    // consecuencia de otra. Mandar al equipo a este bloque sería mandarlo a un control que
    // no puede tocar; la respuesta que falta es la de su fuente. El guardián hace la misma
    // indirección, así que motor y guardián cuentan la misma historia.
    const lockWhen = field?.lock_when as LockWhen | undefined
    if (lockWhen?.mapping && lockWhen.source_bloque_slug) {
      const { data: fuenteRaw } = await db(supabase)
        .from('bloque_configs')
        .select('nombre, config_extra, etapas_negocio!inner(nombre, linea_id)')
        .eq('slug', lockWhen.source_bloque_slug)
        .eq('etapas_negocio.linea_id', lineaId)
        .limit(1)
        .maybeSingle()
      const fuente = fuenteRaw as {
        nombre: string | null
        config_extra: Record<string, unknown> | null
        etapas_negocio: { nombre: string } | null
      } | null
      if (fuente) {
        bloqueNombre = fuente.nombre ?? bloqueNombre
        etapaLabel = fuente.etapas_negocio?.nombre ?? etapaLabel
        const fFuente = ((fuente.config_extra?.fields ?? []) as Array<Record<string, unknown>>)
          .find(f => f.slug === lockWhen.field)
        label = (fFuente?.label as string | null) ?? lockWhen.field ?? label
      }
    }

    resultado.push({ campo, label, bloque: bloqueNombre, etapa: etapaLabel, aplica })
  }

  return resultado
}

// ── Cambiar etapa con gate check ──────────────────────────────────────────────

export async function cambiarEtapaNegocioConGate(
  negocioId: string,
  nuevaEtapaId: string,
  motivoOverride?: string,
  /**
   * El usuario ya vio y aceptó la confirmación de la etapa destino. Solo lo manda la
   * pantalla en el segundo intento; en el primero el servidor resuelve el destino y
   * devuelve `requiere_confirmacion` sin mover nada.
   */
  confirmado?: boolean,
): Promise<{
  error: string | null
  bloquesPendientes?: Array<{ nombre: string; es_gate: boolean }>
  /** Nombre de la etapa destino REAL (tras resolver el routing), para el feedback. */
  etapaDestinoNombre?: string
  /** Presente solo con `error === 'requiere_confirmacion'`. */
  confirmacion?: ConfirmacionAvance
}> {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // El override de gate (omitir gates con motivo) es exclusivo de owner/admin.
  if (motivoOverride && role !== 'owner' && role !== 'admin') {
    return { error: 'Solo el dueño o administrador puede omitir gates' }
  }

  // Obtener etapa actual del negocio
  const { data: negocioRaw } = await db(supabase)
    .from('negocios')
    .select('etapa_actual_id, stage_actual')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const negocio = negocioRaw as { etapa_actual_id: string | null; stage_actual: string | null } | null
  if (!negocio) return { error: 'Negocio no encontrado' }

  // Guard server-side: solo quien puede editar la fase actual del negocio puede
  // avanzarla (rol+área+responsable). Permite el handoff (comercial cierra venta);
  // bloquea a operators ajenos / supervisores de otra área.
  //
  // La etapa puede invitar a otra área a avanzarla (`areas_que_avanzan`) cuando el
  // trabajo que desbloquea el paso es de esa área. Se lee ANTES del guard porque
  // `etapaActualConfigExtra` se resuelve más abajo, junto con la validación de orden.
  const { data: cfgEtapaActual } = await db(supabase)
    .from('etapas_negocio')
    .select('config_extra')
    .eq('id', negocio.etapa_actual_id ?? '')
    .maybeSingle()
  const areasQueAvanzan = (((cfgEtapaActual as { config_extra?: { areas_que_avanzan?: unknown } | null } | null)
    ?.config_extra?.areas_que_avanzan ?? []) as Area[])

  const gAvance = await guardAvanzarStage(negocioId, (negocio.stage_actual ?? 'venta') as Stage, areasQueAvanzan)
  if (!gAvance.ok) return { error: gAvance.error ?? 'Sin permiso' }

  // resolvedEtapaId puede cambiar si routing auto-corrige el destino
  let resolvedEtapaId = nuevaEtapaId

  // Validar que la nueva etapa es la siguiente en orden (o un salto permitido por routing)
  let etapaActualNombre: string | null = null
  let etapaActualConfigExtra: Record<string, unknown> = {}
  // La línea sobrevive al bloque de validación de orden: los gates de más abajo la
  // necesitan para resolver una etapa fuente por `orden` (que es único por línea).
  let etapaActualLineaId: string | null = null
  if (negocio.etapa_actual_id) {
    const [etapaActualRes, nuevaEtapaRes] = await Promise.all([
      db(supabase)
        .from('etapas_negocio')
        .select('orden, linea_id, config_extra, nombre')
        .eq('id', negocio.etapa_actual_id)
        .single(),
      db(supabase)
        .from('etapas_negocio')
        .select('orden, linea_id')
        .eq('id', nuevaEtapaId)
        .single(),
    ])

    const etapaActualData = etapaActualRes.data as { orden: number; linea_id: string; config_extra: Record<string, unknown>; nombre: string } | null
    const nuevaEtapaData = nuevaEtapaRes.data as { orden: number; linea_id: string } | null

    if (!etapaActualData || !nuevaEtapaData) return { error: 'Etapa no encontrada' }
    etapaActualNombre = etapaActualData.nombre ?? null
    etapaActualConfigExtra = etapaActualData.config_extra ?? {}
    etapaActualLineaId = etapaActualData.linea_id
    if (etapaActualData.linea_id !== nuevaEtapaData.linea_id) return { error: 'Etapas de líneas distintas' }

    // Evaluar routing condicional (si existe) ANTES de validar orden
    const routing = (etapaActualData.config_extra?.routing ?? null) as {
      default_etapa_orden: number
      conditional?: Array<{ condition: { field: string; value: string }; etapa_orden: number }>
      // Opcional: leer los campos desde una etapa distinta a la actual.
      // Util cuando el flag decisorio se configura en una etapa anterior
      // (ej: flag de devolucion IVA en etapa 2, evaluado al salir de la 6).
      source_etapa_orden?: number
    } | null

    if (routing) {
      // Resolver qué etapa usar como fuente de datos para las condiciones
      let sourceEtapaId: string = negocio.etapa_actual_id
      if (typeof routing.source_etapa_orden === 'number') {
        const { data: sourceEtapa } = await db(supabase)
          .from('etapas_negocio')
          .select('id')
          .eq('linea_id', etapaActualData.linea_id)
          .eq('orden', routing.source_etapa_orden)
          .single()
        if (sourceEtapa) sourceEtapaId = (sourceEtapa as { id: string }).id
      }

      // Leer datos del negocio para evaluar condiciones
      const { data: bloquesDatos } = await db(supabase)
        .from('negocio_bloques')
        .select(`
          data,
          bloque_configs!inner(
            etapa_id,
            bloque_definitions!inner(tipo)
          )
        `)
        .eq('negocio_id', negocioId)
        .eq('bloque_configs.etapa_id', sourceEtapaId)

      const camposNegocio: Record<string, unknown> = {}
      for (const b of ((bloquesDatos ?? []) as Record<string, unknown>[])) {
        const tipo = ((b.bloque_configs as Record<string, unknown>)?.bloque_definitions as Record<string, unknown> | null)?.tipo
        if (tipo === 'datos' && b.data && typeof b.data === 'object') {
          Object.assign(camposNegocio, b.data)
        }
      }

      // ── El motor exige el dato ANTES de decidir ─────────────────────────────
      //
      // Sin esto, un campo decisorio vacío no hace match con ninguna condición y el avance
      // cae al `default_etapa_orden`: el motor elige una ruta con un dato que no tiene, sin
      // error y sin aviso. En SOENA eso mandó 17 casos de Entrega a Facturación, la etapa de
      // cierre. Opt-in por etapa (`exigir_dato_de_decision`); sin el flag, nada cambia.
      //
      // Respeta el override de owner/admin como cualquier otro gate: si alguien decide
      // avanzar sabiendo que el dato falta, queda el motivo en el log. Un freno que no se
      // pueda levantar dejaría casos varados sin salida.
      if (!motivoOverride && exigeDatoDeDecision(etapaActualData.config_extra)) {
        const campos = await camposDecisionDelNegocio(
          supabase, negocioId, etapaActualData.linea_id, sourceEtapaId, routing as RoutingEtapa,
        )
        const faltantes = decisionesSinResponder(campos, camposNegocio)
        if (faltantes.length > 0) {
          const msgs = (etapaActualConfigExtra.gate_messages ?? {}) as Record<string, string>
          return {
            error: 'gate_bloqueado',
            bloquesPendientes: faltantes.map(f => ({
              nombre: mensajeDatoFaltante(f, msgs['dato_de_decision']),
              es_gate: true,
            })),
          }
        }
      }

      // Evaluar condicionales — primer match gana
      let etapaOrdenDestino = routing.default_etapa_orden
      for (const rule of (routing.conditional ?? [])) {
        const { field, value } = rule.condition
        if (String(camposNegocio[field] ?? '') === String(value)) {
          etapaOrdenDestino = rule.etapa_orden
          break
        }
      }

      // Auto-corregir destino si routing resuelve a una etapa diferente
      if (nuevaEtapaData.orden !== etapaOrdenDestino) {
        const { data: etapaCorrecta } = await db(supabase)
          .from('etapas_negocio')
          .select('id, orden, linea_id')
          .eq('linea_id', etapaActualData.linea_id)
          .eq('orden', etapaOrdenDestino)
          .single()

        if (etapaCorrecta) {
          resolvedEtapaId = (etapaCorrecta as { id: string }).id
        } else {
          return { error: 'Etapa destino de routing no encontrada' }
        }
      }
    } else {
      // Sin routing: solo avance secuencial
      const ordenSiguiente = etapaActualData.orden + 1
      if (nuevaEtapaData.orden !== ordenSiguiente) {
        return { error: 'Solo puedes avanzar a la siguiente etapa en orden' }
      }
    }
  }

  // Marcar un gate vencido como "no aplica" es una escritura irreversible, y la
  // confirmación de la etapa destino se resuelve mucho más abajo (necesita el routing
  // ya resuelto). Si se escribiera aquí, cancelar el diálogo dejaría bloques marcados
  // en un caso que NO se movió. Por eso la VALIDACIÓN se queda donde está y la
  // ESCRITURA se difiere hasta que el avance sea seguro.
  let aplicarOmisiones: (() => Promise<string | null>) | null = null

  // Verificar gates si no hay motivo de override
  if (!motivoOverride && negocio.etapa_actual_id) {
    // ANTES de evaluar los gates: cerrar automáticamente los bloques gate de anticipo
    // (config_extra.es_pagos_epayco) cuyo anticipo esperado ya está cubierto por el
    // saldo del negocio, sin importar la vía (reparto, FAB, manual, ePayco). Sin esto,
    // un negocio pagado por reparto queda atascado porque el gate solo se cierra por el
    // flujo ePayco propio. Genérico/opt-in por es_pagos_epayco; idempotente.
    await autocompletarGatesAnticipoPorSaldo(
      supabase, workspaceId, negocioId, negocio.etapa_actual_id, staffId,
    )

    const { data: puedeAvanzar } = await db(supabase)
      .rpc('puede_avanzar_etapa', {
        p_negocio_id: negocioId,
        p_etapa_id: negocio.etapa_actual_id,
      })

    if (!puedeAvanzar) {
      // Listar SOLO los bloques gate que realmente bloquean (pendientes +
      // condición cumplida) — misma lógica que puede_avanzar_etapa, vía
      // gates_pendientes_etapa. Antes se listaban TODOS los es_gate de la etapa,
      // incluidos los ya completos, lo que confundía al usuario.
      const { data: pendientesRaw } = await db(supabase)
        .rpc('gates_pendientes_etapa', {
          p_negocio_id: negocioId,
          p_etapa_id: negocio.etapa_actual_id,
        })

      // Un gate cuyo paso VENCIÓ puede quedar en "no aplica" en vez de retener.
      // Solo lo declara el bloque (`omitible_por.areas`) y solo lo hace quien
      // trabaja el hecho que lo vence. Ver `gate-omitible.ts` para el porqué.
      const pendientesIds = ((pendientesRaw ?? []) as Array<{ bloque_config_id: string; nombre: string | null }>)
      const { data: cfgsPendientes, error: errCfgs } = await db(supabase)
        .from('bloque_configs')
        .select('id, config_extra')
        .in('id', pendientesIds.map(p => p.bloque_config_id))
      // Si no se puede leer la config, se trata como NO omitible: el lado seguro
      // de un control es retener, nunca dejar pasar por falta de información.
      if (errCfgs) console.error('[cambiarEtapa] no se pudo leer la config de los gates pendientes:', errCfgs)
      const cfgPorId = new Map(((cfgsPendientes ?? []) as Array<{ id: string; config_extra: Record<string, unknown> | null }>)
        .map(c => [c.id, c.config_extra]))

      const omitibles = errCfgs ? [] : pendientesIds.filter(p =>
        puedeOmitirGate(cfgPorId.get(p.bloque_config_id), {
          role: (role ?? 'read_only') as Role,
          areas: (areas ?? []) as Area[],
        }))
      const retienen = pendientesIds.filter(p => !omitibles.some(o => o.bloque_config_id === p.bloque_config_id))

      if (retienen.length > 0) {
        return {
          error: 'gate_bloqueado',
          bloquesPendientes: retienen.map(b => ({ nombre: b.nombre ?? 'Bloque', es_gate: true })),
        }
      }

      // Todos los que faltaban vencieron: se marcan como "no aplica" —con motivo,
      // autor y fecha— y el negocio sigue. NO se marcan como completos a secas:
      // eso afirmaría que el trabajo se hizo.
      //
      // La escritura queda diferida (ver `aplicarOmisiones` arriba): solo corre cuando
      // el avance está confirmado y a punto de ejecutarse.
      aplicarOmisiones = async () => {
        const ahora = new Date().toISOString()
        for (const p of omitibles) {
          const cfg = cfgPorId.get(p.bloque_config_id)
          const marca = marcaOmitido(cfg, { id: staffId ?? null, nombre: null }, ahora)
          const { data: inst } = await db(supabase)
            .from('negocio_bloques')
            .select('id, data')
            .eq('negocio_id', negocioId)
            .eq('bloque_config_id', p.bloque_config_id)
            .maybeSingle()
          if (!inst) continue
          const dataPrevia = ((inst as { data: Record<string, unknown> | null }).data ?? {})
          const { error: errOmitir } = await db(supabase)
            .from('negocio_bloques')
            .update({
              estado: 'completo',
              completado_at: ahora,
              data: { ...dataPrevia, [CLAVE_OMITIDO]: marca },
            })
            .eq('id', (inst as { id: string }).id)
          if (errOmitir) return `No se pudo marcar "${p.nombre ?? 'el bloque'}" como no aplica: ${errOmitir.message}`

          // El rastro va al timeline. `autor_id` es staff.id (campo minado ya
          // documentado: no confundir con profile.id).
          try {
            await db(supabase).from('activity_log').insert({
              workspace_id: workspaceId,
              entidad_tipo: 'negocio',
              entidad_id: negocioId,
              tipo: 'cambio',
              autor_id: staffId,
              campo_modificado: 'bloque_datos',
              contenido: `Bloque "${p.nombre ?? 'sin nombre'}" quedó en "${marca.label}" al avanzar de etapa`,
            })
          } catch (e) { console.error('[cambiarEtapa] no se pudo registrar la omisión en el timeline:', e) }
        }
        return null
      }
    }

    // Gate custom: comentario_requerido — debe haber al menos un comentario en actividad
    const etapaGates = (etapaActualConfigExtra.gates ?? []) as string[]
    if (etapaGates.includes('comentario_requerido')) {
      const { count } = await supabase
        .from('activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('entidad_tipo', 'negocio')
        .eq('entidad_id', negocioId)
        .eq('tipo', 'comentario')
      if ((count ?? 0) === 0) {
        return { error: 'gate_bloqueado', bloquesPendientes: [{ nombre: 'Comentario en actividad', es_gate: true }] }
      }
    }

    // Gate custom: saldo_cero — el HONORARIO pendiente debe estar cubierto.
    //
    // Mide contra `precio_aprobado` (honorario) A PROPÓSITO, no contra el valor a
    // recaudar. El recaudo de la tarifa UPME (pasante) tiene su propio control aguas
    // arriba: el gate `saldo:handoff`, que exige el valor a recaudar completo menos el
    // saldo diferido por la modalidad. Sumar aquí la tarifa duplicaría ese control y
    // retendría casos donde el cliente pagó su honorario y la tarifa no entró por
    // SOENA. Medido el 2026-08-03: hacerlo habría frenado 32 negocios abiertos, la
    // mayoría ya en Entrega.
    //
    // Un sobrepago (saldo negativo) NO bloquea aquí: solo se compara el faltante.
    if (etapaGates.includes('saldo_cero')) {
      const [negPrecioRes, cobrosRes, conciliadoRes] = await Promise.all([
        db(supabase)
          .from('negocios')
          .select('precio_aprobado, precio_estimado')
          .eq('id', negocioId)
          .single(),
        db(supabase)
          .from('cobros')
          .select('monto, split_json')
          .eq('negocio_id', negocioId)
          .eq('workspace_id', workspaceId)
          ,
        db(supabase)
          .from('negocio_conciliacion')
          .select('conciliado')
          .eq('negocio_id', negocioId)
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const negPrecio = negPrecioRes.data as any
      const precio = negPrecio?.precio_aprobado ?? negPrecio?.precio_estimado ?? 0
      // Solo el recaudo CONFIRMADO cubre el saldo (ver `lib/negocios/recaudo-confirmado.ts`).
      const cobrosSaldo = (cobrosRes.data ?? []) as CobroParaRecaudo[]
      const conciliadoSaldo = (conciliadoRes.data as { conciliado: boolean } | null)?.conciliado === true
      const totalCobrado = sumarRecaudoConfirmado(cobrosSaldo, conciliadoSaldo)
      const saldo = precio - totalCobrado

      if (saldo > TOLERANCIA_SALDO_COP) {
        const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
        // Nombrar la plata que está registrada pero sin confirmar. Decir solo "faltan $X"
        // manda a la financiera a buscar un pago que YA está en el sistema esperando su
        // visto bueno.
        const sinConfirmar = recaudoPendienteDeConfirmar(cobrosSaldo, conciliadoSaldo)
        const detalle = sinConfirmar > 0
          ? ` (hay ${fmt.format(sinConfirmar)} de un reparto sin confirmar por el área financiera)`
          : ''
        return {
          error: 'gate_bloqueado',
          bloquesPendientes: [{ nombre: `Saldo pendiente: ${fmt.format(saldo)}${detalle}`, es_gate: true }],
        }
      }
    }

    // Gate custom: saldo:handoff — control de recaudo para soltar el negocio a
    // operaciones (handoff comercial → operaciones, ej. salida de Documentación).
    // El recaudo del cliente debe cubrir el 100% de la tarifa UPME + el honorario
    // que corresponda según el plan (Plan 1 → 50%; Plan 2 → 100%), es decir el
    // precio menos el saldo legítimamente diferido. Reusa el modelo de dinero de la
    // propuesta aprobada. Opt-in por etapa (config_extra.gates). Mensaje configurable
    // en config_extra.gate_messages['saldo:handoff'].
    if (etapaGates.includes('saldo:handoff')) {
      const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
      const { data: negHandoffRaw } = await db(supabase)
        .from('negocios')
        .select('precio_aprobado, precio_estimado')
        .eq('id', negocioId)
        .single()
      const negHandoff = negHandoffRaw as { precio_aprobado: number | null; precio_estimado: number | null } | null
      const precioHandoff = negHandoff?.precio_aprobado ?? negHandoff?.precio_estimado ?? 0

      // Fail-safe: sin precio aprobado no se puede calcular el umbral → no dejar
      // pasar sin control; exigir aprobar la propuesta económica primero. EXCEPCIÓN:
      // cero DELIBERADO (propuesta aprobada cuyo honorario final es 0) → no hay nada
      // que recaudar, el gate se da por satisfecho. Un negocio aún sin cotizar
      // (propuesta no aprobada) sigue bloqueando como hoy.
      if (!(precioHandoff > 0)) {
        const { data: propsHandoff } = await db(supabase)
          .from('negocio_bloques')
          .select('data, bloque_configs!inner(bloque_definitions!inner(tipo))')
          .eq('negocio_id', negocioId)
          .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica')
        const propuestasHandoff = ((propsHandoff ?? []) as Array<{ data: Record<string, unknown> | null }>)
        if (esCeroDeliberado(propuestasHandoff, negHandoff?.precio_aprobado ?? null)) {
          // Nada que recaudar: el handoff no exige recaudo.
        } else {
          return {
            error: 'gate_bloqueado',
            bloquesPendientes: [{ nombre: 'Aprueba la propuesta económica antes de pasar a operaciones', es_gate: true }],
          }
        }
      } else {

      // Recaudo real del cliente: suma de cobros, excluyendo remanentes por devolver
      // (devolucion_pendiente, montos negativos) que no son recaudo entrante. Y desde el
      // 2026-08-06, tampoco cuentan las porciones de un reparto que la financiera aún no
      // confirmó: soltar el negocio a operaciones es justo la decisión que no conviene
      // tomar con plata en veremos.
      const [{ data: cobrosHandoff }, conciliadoHandoffRes] = await Promise.all([
        db(supabase)
          .from('cobros')
          .select('monto, tipo_cobro, split_json')
          .eq('negocio_id', negocioId)
          .eq('workspace_id', workspaceId),
        db(supabase)
          .from('negocio_conciliacion')
          .select('conciliado')
          .eq('negocio_id', negocioId)
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
      ])
      const cobrosHandoffLista = (cobrosHandoff ?? []) as CobroParaRecaudo[]
      const conciliadoHandoff = (conciliadoHandoffRes.data as { conciliado: boolean } | null)?.conciliado === true
      const opcionesHandoff = { excluirTipos: ['devolucion_pendiente'] }
      const recaudadoHandoff = sumarRecaudoConfirmado(cobrosHandoffLista, conciliadoHandoff, opcionesHandoff)

      const modeloHandoff = await leerModeloDineroCompleto(supabase, negocioId)
      const pend = calcularPendienteHandoff(precioHandoff, modeloHandoff, recaudadoHandoff)

      if (!pend.cubierto) {
        const partes: string[] = []
        if (pend.pendienteUpme > 0) partes.push(`UPME ${fmt.format(pend.pendienteUpme)}`)
        if (pend.pendienteHonorario > 0) partes.push(`honorario ${fmt.format(pend.pendienteHonorario)}`)
        const sinConfirmarHandoff = recaudoPendienteDeConfirmar(cobrosHandoffLista, conciliadoHandoff, opcionesHandoff)
        if (sinConfirmarHandoff > 0) partes.push(`${fmt.format(sinConfirmarHandoff)} sin confirmar por el área financiera`)
        const desglose = partes.length ? ` (${partes.join(' + ')})` : ''
        const gateMessages = (etapaActualConfigExtra.gate_messages ?? {}) as Record<string, string>
        const nombre = gateMessages['saldo:handoff']
          ?? `Recaudo insuficiente para pasar a operaciones: falta ${fmt.format(pend.pendienteTotal)}${desglose}`
        return { error: 'gate_bloqueado', bloquesPendientes: [{ nombre, es_gate: true }] }
      }
      } // fin else (precioHandoff > 0)
    }

    // Gate custom genérico: campo:<slug>=<valor> — un campo de un bloque `datos`
    // de la etapa actual debe tener un valor específico para poder avanzar.
    // Reusable por config de etapa (etapas_negocio.config_extra.gates), con mensaje
    // opcional en config_extra.gate_messages[gate]. Ej: "campo:decision_incluir=si".
    const camposGates = etapaGates.filter((g) => g.startsWith('campo:'))
    if (camposGates.length > 0) {
      const { data: bloquesDatosActual } = await db(supabase)
        .from('negocio_bloques')
        .select(`
          data,
          bloque_configs!inner(
            etapa_id,
            bloque_definitions!inner(tipo)
          )
        `)
        .eq('negocio_id', negocioId)
        .eq('bloque_configs.etapa_id', negocio.etapa_actual_id)

      const camposActual: Record<string, unknown> = {}
      for (const b of ((bloquesDatosActual ?? []) as Record<string, unknown>[])) {
        const tipo = ((b.bloque_configs as Record<string, unknown>)?.bloque_definitions as Record<string, unknown> | null)?.tipo
        if (tipo === 'datos' && b.data && typeof b.data === 'object') {
          Object.assign(camposActual, b.data)
        }
      }

      const gateMessages = (etapaActualConfigExtra.gate_messages ?? {}) as Record<string, string>
      for (const gate of camposGates) {
        const rest = gate.slice('campo:'.length)
        const eqIdx = rest.indexOf('=')
        if (eqIdx === -1) continue
        const slug = rest.slice(0, eqIdx)
        const expected = rest.slice(eqIdx + 1)
        const actual = camposActual[slug]
        const actualStr = typeof actual === 'boolean' ? String(actual) : String(actual ?? '')
        if (actualStr !== expected) {
          const nombre = gateMessages[gate] ?? `Campo "${slug}" debe ser "${expected}"`
          return { error: 'gate_bloqueado', bloquesPendientes: [{ nombre, es_gate: true }] }
        }
      }
    }

    // Gate custom: campos_alguno — AL MENOS UNO de varios campos debe tener el valor
    // esperado. El gate `campo:<slug>=<valor>` de arriba solo expresa igualdad sobre UN
    // campo, así que no puede pedir "una de estas dos respuestas". Config por etapa:
    //   gates: ['campos_alguno']
    //   campos_alguno_gate: { campos: [...], valor: 'true', source_etapa_orden?: N }
    //   gate_messages: { campos_alguno: '...' }
    // `source_etapa_orden` permite exigirlo desde una etapa POSTERIOR a la que captura
    // las respuestas (mismo mecanismo que el routing). Hace falta porque un campo se
    // puede corregir desde el historial después de que su propia etapa ya pasó: sin
    // esto, el gate solo protege el primer avance. Un campo ausente cuenta como no
    // cumplido, así que la exigencia sobrevive a que el bloque ni siquiera exista.
    if (etapaGates.includes('campos_alguno')) {
      const cfg = (etapaActualConfigExtra.campos_alguno_gate ?? null) as {
        campos?: string[]
        valor?: string
        source_etapa_orden?: number
      } | null
      const camposExigidos = cfg?.campos ?? []
      if (camposExigidos.length > 0) {
        let sourceEtapaIdGate: string = negocio.etapa_actual_id
        if (typeof cfg?.source_etapa_orden === 'number' && etapaActualLineaId) {
          const { data: etapaFuente } = await db(supabase)
            .from('etapas_negocio')
            .select('id')
            .eq('linea_id', etapaActualLineaId)
            .eq('orden', cfg.source_etapa_orden)
            .single()
          if (etapaFuente) sourceEtapaIdGate = (etapaFuente as { id: string }).id
        }

        const { data: bloquesGate } = await db(supabase)
          .from('negocio_bloques')
          .select(`
            data,
            bloque_configs!inner(
              etapa_id,
              bloque_definitions!inner(tipo)
            )
          `)
          .eq('negocio_id', negocioId)
          .eq('bloque_configs.etapa_id', sourceEtapaIdGate)

        const camposGate: Record<string, unknown> = {}
        for (const b of ((bloquesGate ?? []) as Record<string, unknown>[])) {
          const tipo = ((b.bloque_configs as Record<string, unknown>)?.bloque_definitions as Record<string, unknown> | null)?.tipo
          if (tipo === 'datos' && b.data && typeof b.data === 'object') {
            Object.assign(camposGate, b.data)
          }
        }

        const esperado = cfg?.valor ?? 'true'
        const algunoCumple = camposExigidos.some((slug) => {
          const actual = camposGate[slug]
          const actualStr = typeof actual === 'boolean' ? String(actual) : String(actual ?? '')
          return actualStr === esperado
        })

        if (!algunoCumple) {
          const gateMessagesAlguno = (etapaActualConfigExtra.gate_messages ?? {}) as Record<string, string>
          const nombre = gateMessagesAlguno['campos_alguno']
            ?? `Al menos uno de estos campos debe ser "${esperado}": ${camposExigidos.join(', ')}`
          return { error: 'gate_bloqueado', bloquesPendientes: [{ nombre, es_gate: true }] }
        }
      }
    }

    // Gate custom: sobrepago_conciliado — si el total cobrado supera el precio del
    // negocio, exige que el sobrepago esté conciliado (campo `accion_extra` con valor).
    // Si no hay sobrepago, no exige nada (no estorba a negocios con pago normal).
    if (etapaGates.includes('sobrepago_conciliado')) {
      const [negPrecioConcRes, cobrosConcRes, modeloConc, conciliadoSobreRes] = await Promise.all([
        db(supabase).from('negocios').select('precio_aprobado, precio_estimado').eq('id', negocioId).single(),
        // db(): los tipos generados de `cobros` NO declaran `split_json` (la columna
        // existe en la base desde el reparto de pagos; `src/types/database.ts` solo la
        // tiene en `gastos`). Ver nota en `lib/negocios/recaudo-confirmado.ts`.
        db(supabase).from('cobros').select('monto, split_json').eq('negocio_id', negocioId),
        leerModeloDineroCompleto(supabase, negocioId),
        db(supabase)
          .from('negocio_conciliacion')
          .select('conciliado')
          .eq('negocio_id', negocioId)
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
      ])
      const negPrecioConc = negPrecioConcRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
      // Mismo criterio que `saldo_cero`: el sobrepago se mide contra el valor a
      // recaudar (honorario + tarifa pasante). Sin esto, la tarifa que el cliente
      // paga para la UPME se leía como plata de más y exigía conciliar algo que no
      // existe: era el caso NORMAL del flujo, no la excepción.
      const honorarioConc = negPrecioConc?.precio_aprobado ?? negPrecioConc?.precio_estimado ?? 0
      const precioConc = valorARecaudar(honorarioConc, modeloConc)
      // Un reparto sin confirmar tampoco AFIRMA un sobrepago: exigir conciliar plata de
      // más a partir de una porción que la financiera todavía no validó es pedir que se
      // resuelva dos veces lo mismo. Cuando ella dé el check, esa plata entra al cálculo
      // y, si sobra de verdad, el gate lo pide entonces.
      const totalCobradoConc = sumarRecaudoConfirmado(
        (cobrosConcRes.data ?? []) as CobroParaRecaudo[],
        (conciliadoSobreRes.data as { conciliado: boolean } | null)?.conciliado === true,
      )
      const extra = totalCobradoConc - precioConc

      // El exceso se juzga contra el MISMO piso de materialidad que el resto del sistema
      // (decisión de Mauricio, 2026-08-06). Con `extra > 0` a secas, un cliente que redondeó
      // al pagar quedaba obligado a "conciliar" $120 que nadie va a devolver ni cobrar.
      if (precioConc > 0 && !saldoCuadrado(extra)) {
        const { data: bloquesConc } = await db(supabase)
          .from('negocio_bloques')
          .select(`
            data,
            bloque_configs!inner(
              etapa_id,
              bloque_definitions!inner(tipo)
            )
          `)
          .eq('negocio_id', negocioId)
          .eq('bloque_configs.etapa_id', negocio.etapa_actual_id)

        const camposConc: Record<string, unknown> = {}
        for (const b of ((bloquesConc ?? []) as Record<string, unknown>[])) {
          const tipo = ((b.bloque_configs as Record<string, unknown>)?.bloque_definitions as Record<string, unknown> | null)?.tipo
          if (tipo === 'datos' && b.data && typeof b.data === 'object') {
            Object.assign(camposConc, b.data)
          }
        }
        const accion = camposConc['accion_extra']
        if (accion == null || String(accion) === '') {
          const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
          return {
            error: 'gate_bloqueado',
            bloquesPendientes: [{ nombre: `Concilia el sobrepago de ${fmt.format(extra)}`, es_gate: true }],
          }
        }
      }
    }

    // Gate custom: conciliacion_diana — el negocio NO avanza hasta que su plata esté
    // cuadrada Y el área financiera (Diana) dé el check en el panel de conciliación
    // (fila conciliada en negocio_conciliacion). Opt-in por etapa (config_extra.gates)
    // → workspaces sin el gate no cambian. Mensaje configurable en
    // config_extra.gate_messages['conciliacion_diana'].
    //
    // El cuadre lo decide `descuadreConciliacion`, que mide cada lado con su propio
    // criterio: el FALTANTE contra el honorario (como `saldo_cero`) y el EXCESO contra
    // el valor a recaudar (como `sobrepago_conciliado`). Antes usaba `precio_aprobado`
    // crudo en ambos lados: a un cliente que pagaba honorario + tarifa en un solo
    // recaudo le exigía conciliar un sobrepago del tamaño exacto de la tarifa (caso
    // V0076). Es la misma expresión que el PR #197 corrigió en los otros tres sitios;
    // este cuarto no entró en aquel barrido.
    if (etapaGates.includes('conciliacion_diana')) {
      const [negConcRes, cobrosConcRes, checkRes, modeloConcDiana] = await Promise.all([
        db(supabase).from('negocios').select('precio_aprobado, precio_estimado').eq('id', negocioId).single(),
        db(supabase).from('cobros').select('monto, split_json').eq('negocio_id', negocioId).eq('workspace_id', workspaceId),
        db(supabase)
          .from('negocio_conciliacion')
          .select('conciliado')
          .eq('negocio_id', negocioId)
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
        leerModeloDineroCompleto(supabase, negocioId),
      ])
      const negConc = negConcRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
      const honorarioConcDiana = negConc?.precio_aprobado ?? negConc?.precio_estimado ?? 0
      const conciliado = (checkRes.data as { conciliado: boolean } | null)?.conciliado === true
      // El descuadre se mide con el recaudo CONFIRMADO, la misma base que los demás gates.
      // Sin el check de la financiera, una porción propuesta por el comercial no puede
      // aparecer cuadrando la plata del caso.
      const totalCobradoConc = sumarRecaudoConfirmado(
        (cobrosConcRes.data ?? []) as CobroParaRecaudo[],
        conciliado,
      )
      const descuadre = descuadreConciliacion(honorarioConcDiana, modeloConcDiana, totalCobradoConc)

      const gateMessages = (etapaActualConfigExtra.gate_messages ?? {}) as Record<string, string>
      if (descuadre.hayDescuadre || !conciliado) {
        const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
        // El mensaje nombra el lado real del descuadre: pedirle "conciliar un sobrepago"
        // a quien le falta plata mandaba a la financiera a buscar lo que no existe.
        const defaultMsg = !descuadre.hayDescuadre
          ? 'Falta el check de conciliación del área financiera'
          : descuadre.faltante > 0
            ? `Conciliación pendiente: faltan ${fmt.format(descuadre.faltante)} del honorario`
            : `Conciliación pendiente: sobran ${fmt.format(descuadre.exceso)} sobre el valor a recaudar`
        const nombre = gateMessages['conciliacion_diana'] ?? defaultMsg
        return { error: 'gate_bloqueado', bloquesPendientes: [{ nombre, es_gate: true }] }
      }
    }
  }

  // ── Control de fraude: congelar negocio con referencia duplicada sin resolver ──
  //
  // Distinto y ADICIONAL al gate conciliacion_diana (que es opt-in por etapa): este
  // guard es transversal al flujo. Mientras un negocio comparta una referencia de pago
  // (external_ref NO-split) con OTRO negocio abierto del workspace, queda CONGELADO →
  // no puede avanzar de etapa hasta que la pestaña Duplicados resuelva el conflicto
  // ("Aceptar duplicado"). Server-side (no solo UI). Opt-in por módulo: solo workspaces
  // con modules.conciliacion lo aplican; el resto no cambia. El override de owner/admin
  // (motivoOverride) lo respeta igual que los demás gates.
  if (!motivoOverride) {
    const { data: wsRow } = await db(supabase)
      .from('workspaces')
      .select('modules')
      .eq('id', workspaceId)
      .single()
    const conciliacionActivo = (wsRow?.modules as Record<string, boolean> | null)?.conciliacion === true
    if (conciliacionActivo) {
      const congelado = await negocioCongeladoPorDuplicado(supabase, workspaceId, negocioId)
      if (congelado) {
        return {
          error: 'gate_bloqueado',
          bloquesPendientes: [{
            nombre: `Referencia ${congelado} duplicada en otro negocio — resuélvela en Conciliación › Duplicados antes de avanzar`,
            es_gate: true,
          }],
        }
      }
    }
  }

  // ── El aviso de recaudo cambiado REAPARECE al intentar avanzar ──
  //
  // Quien cambia la plata (la financiera) casi nunca es quien mueve el caso (el
  // comercial). Un aviso que solo se muestra una vez lo cierra quien pasaba por ahí, y
  // el caso sigue adelante con plata que ya no tiene — que es justo el estado que el
  // retroceso financiero viene a evitar. Por eso vuelve a frenar aquí, hasta que alguien
  // lo resuelva de forma explícita y con motivo escrito.
  //
  // ⚠️ Este gate NO cede al override de owner/admin, a diferencia de los demás.
  // Decisión de Mauricio (2026-08-11): "es un gate, no avanza hasta que no se resuelva,
  // no importa quién". Un override aquí deja al caso avanzando con plata que ya no
  // tiene, que es exactamente el estado que esto viene a evitar — y quien más
  // probablemente use el override es quien menos contexto tiene de por qué se frenó.
  //
  // No es un callejón sin salida: la salida es RESOLVER el aviso, con motivo escrito
  // (`resolverAviso`), que deja el rastro de por qué se dio por atendido.
  {
    const aviso = await leerAviso(supabase, workspaceId, negocioId)
    if (aviso) {
      return {
        error: 'gate_bloqueado',
        bloquesPendientes: [{
          nombre:
            `El recaudo de este negocio cambió (referencia ${aviso.referencia}) y todavía nadie lo resolvió. ` +
            `Motivo: ${aviso.motivo}` +
            (aviso.destinoSugerido ? ` · Se sugirió devolverlo a ${aviso.destinoSugerido}.` : ''),
          es_gate: true,
        }],
      }
    }
  }

  // Salto automático de etapas ya saldadas: si al llegar no queda nada por cobrar ahí, el
  // negocio pasa de largo. QUÉ etapas participan lo decide `aplicaSaltoPorSaldo` (el flag
  // `saltar_si_saldo_cero` de la etapa, o su `stage` si no lo declara) y CUÁNDO el saldo lo
  // justifica lo decide `debeSaltarPorSaldo`. Ambas viven en `lib/negocios/salto-etapa.ts`
  // con sus tests; el porqué de separarlas del `stage` está documentado ahí.
  //
  // El salto ENCADENA: con el honorario ya pagado, un negocio puede atravesar Precobro y
  // Cobro de un solo avance y aterrizar en Entrega. Antes se resolvía un único salto, así
  // que quedaba detenido en la segunda etapa saldada sin razón visible para el equipo.
  {
    const [negPrecioRes, cobrosSkipRes, modeloSkip, conciliadoSkipRes] = await Promise.all([
      db(supabase).from('negocios').select('precio_aprobado, precio_estimado').eq('id', negocioId).single(),
      // db(): ver nota de tipos stale en `lib/negocios/recaudo-confirmado.ts`.
      db(supabase).from('cobros').select('monto, split_json').eq('negocio_id', negocioId),
      leerModeloDineroCompleto(supabase, negocioId),
      db(supabase)
        .from('negocio_conciliacion')
        .select('conciliado')
        .eq('negocio_id', negocioId)
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
    ])
    const negPrecio = negPrecioRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
    // Igual que los gates de saldo: se compara contra el valor a recaudar (honorario
    // + tarifa pasante). Con `precio_aprobado` a secas, un negocio con la tarifa
    // pagada daba saldo NEGATIVO y `debeSaltarPorSaldo` —que con `conciliar_sobrepago`
    // exige CERO exacto— no saltaba: el caso entraba a las etapas de cobro que ya no
    // le aplicaban.
    const honorarioSkip = negPrecio?.precio_aprobado ?? negPrecio?.precio_estimado ?? 0
    const precio = valorARecaudar(honorarioSkip, modeloSkip)
    // El salto encadena: con el saldo en cero un negocio puede atravesar VARIAS etapas de
    // un solo avance. Es la decisión más cara de tomar con plata sin confirmar, así que
    // aquí también cuenta solo el recaudo confirmado.
    const totalCobrado = sumarRecaudoConfirmado(
      (cobrosSkipRes.data ?? []) as CobroParaRecaudo[],
      (conciliadoSkipRes.data as { conciliado: boolean } | null)?.conciliado === true,
    )
    const saldo = precio - totalCobrado

    // Ni el precio ni los cobros cambian durante el encadenamiento: se leen una sola vez.
    const visitadas = new Set<string>([resolvedEtapaId])

    for (let i = 0; i < MAX_SALTOS_ENCADENADOS; i++) {
      const { data: destStageRaw } = await db(supabase)
        .from('etapas_negocio')
        .select('stage, orden, linea_id, config_extra')
        .eq('id', resolvedEtapaId)
        .single()
      const destStage = destStageRaw as { stage: string | null; orden: number; linea_id: string; config_extra: Record<string, unknown> | null } | null
      if (!destStage) break

      if (!aplicaSaltoPorSaldo(destStage)) break
      const conciliarSobrepago = destStage.config_extra?.conciliar_sobrepago === true
      if (!debeSaltarPorSaldo(precio, saldo, conciliarSobrepago)) break

      // Al saltar una etapa saldada NO ir a ciegas a orden+1: seguir su ROUTING. Así la
      // rama de devolución de IVA solo se entra si el caso la lleva; si no, la etapa es
      // terminal y el negocio se queda ahí. Bug previo: saltaba a orden+1 ignorando el
      // flag, así que un negocio sin devolución (ej. leasing/jurídica) entraba a ella.
      const cobroRouting = (destStage.config_extra?.routing ?? null) as {
        default_etapa_orden: number
        conditional?: Array<{ condition: { field: string; value: string }; etapa_orden: number }>
        source_etapa_orden?: number
      } | null
      let destinoOrden = destStage.orden + 1 // fallback legacy si la etapa no tiene routing
      if (cobroRouting) {
        let srcEtapaId = resolvedEtapaId
        if (typeof cobroRouting.source_etapa_orden === 'number') {
          const { data: se } = await db(supabase)
            .from('etapas_negocio')
            .select('id')
            .eq('linea_id', destStage.linea_id)
            .eq('orden', cobroRouting.source_etapa_orden)
            .single()
          if (se) srcEtapaId = (se as { id: string }).id
        }
        const { data: bDatos } = await db(supabase)
          .from('negocio_bloques')
          .select('data, bloque_configs!inner(etapa_id, bloque_definitions!inner(tipo))')
          .eq('negocio_id', negocioId)
          .eq('bloque_configs.etapa_id', srcEtapaId)
        const campos: Record<string, unknown> = {}
        for (const b of ((bDatos ?? []) as Record<string, unknown>[])) {
          const tipo = ((b.bloque_configs as Record<string, unknown>)?.bloque_definitions as Record<string, unknown> | null)?.tipo
          if (tipo === 'datos' && b.data && typeof b.data === 'object') Object.assign(campos, b.data)
        }
        // El salto también RESUELVE ROUTING, así que también puede decidir a ciegas. Si la
        // etapa exige el dato y falta, el negocio se queda AQUÍ en vez de pasar de largo:
        // aterriza donde está la pregunta, que es justo lo que se quiere. No se devuelve
        // error porque el avance ya ocurrió; lo que se frena es el salto, no el avance.
        if (exigeDatoDeDecision(destStage.config_extra)) {
          const camposDec = await camposDecisionDelNegocio(
            supabase, negocioId, destStage.linea_id, srcEtapaId, cobroRouting as RoutingEtapa,
          )
          if (decisionesSinResponder(camposDec, campos).length > 0) break
        }

        destinoOrden = cobroRouting.default_etapa_orden
        for (const rule of (cobroRouting.conditional ?? [])) {
          if (String(campos[rule.condition.field] ?? '') === String(rule.condition.value)) {
            destinoOrden = rule.etapa_orden
            break
          }
        }
      }

      // Solo saltar si el routing manda a una etapa POSTERIOR. Si el destino es la etapa
      // misma (se apunta a sí misma = cierra), es terminal → no saltar.
      if (!(destinoOrden > destStage.orden)) break

      const { data: nextEtapaRaw } = await db(supabase)
        .from('etapas_negocio')
        .select('id')
        .eq('linea_id', destStage.linea_id)
        .eq('orden', destinoOrden)
        .single()
      if (!nextEtapaRaw) break

      const nextId = (nextEtapaRaw as { id: string }).id
      // Un routing mal configurado podría ciclar; el negocio se queda donde está.
      if (visitadas.has(nextId)) break
      visitadas.add(nextId)
      resolvedEtapaId = nextId
    }
  }

  // Obtener nombre de la nueva etapa para el log. `numero` y `linea_id` los usa
  // el disparador de Siigo de más abajo (el `numero` es el orden VISIBLE, que es
  // con el que se declara la configuración; `orden` es interno y no coincide).
  const { data: nuevaEtapaInfoRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('nombre, numero, linea_id, config_extra')
    .eq('id', resolvedEtapaId)
    .single()
  const nuevaEtapaInfo = nuevaEtapaInfoRaw as
    { nombre: string; numero: number | null; linea_id: string | null
      config_extra: Record<string, unknown> | null } | null
  const nuevaEtapaNombre = nuevaEtapaInfo?.nombre ?? resolvedEtapaId

  // ── Confirmación antes de entregarle el caso a otra área ────────────────────
  //
  // Se pregunta con el destino YA RESUELTO (routing + saltos encadenados), nunca antes:
  // el cliente no sabe a dónde va a aterrizar el caso, y preguntar sobre un destino
  // supuesto avisaría del área equivocada. Por eso el flujo es: el servidor resuelve,
  // devuelve `requiere_confirmacion` SIN MOVER nada, y la pantalla vuelve a llamar con
  // `confirmado`. Ver `lib/negocios/confirmacion-avance.ts` para el porqué del texto.
  const pideConfirmar = confirmacionAvance(nuevaEtapaInfo?.config_extra, null)
  if (pideConfirmar && !confirmado) {
    // El faltante sale de `descuadreConciliacion`, la MISMA fuente que usan los gates de
    // saldo. Una resta propia aquí sería una segunda vara para la misma plata.
    const [negValRes, cobrosConfRes, modeloConf, conciliadoConfRes] = await Promise.all([
      db(supabase).from('negocios').select('precio_aprobado, precio_estimado').eq('id', negocioId).single(),
      db(supabase).from('cobros').select('monto, split_json').eq('negocio_id', negocioId),
      leerModeloDineroCompleto(supabase, negocioId),
      db(supabase).from('negocio_conciliacion').select('conciliado')
        .eq('negocio_id', negocioId).eq('workspace_id', workspaceId).maybeSingle(),
    ])
    const negVal = negValRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
    const honorarioConf = negVal?.precio_aprobado ?? negVal?.precio_estimado ?? 0
    const recaudadoConf = sumarRecaudoConfirmado(
      (cobrosConfRes.data ?? []) as CobroParaRecaudo[],
      (conciliadoConfRes.data as { conciliado: boolean } | null)?.conciliado === true,
    )
    const { faltante } = descuadreConciliacion(honorarioConf, modeloConf, recaudadoConf)

    return {
      error: 'requiere_confirmacion',
      confirmacion: confirmacionAvance(nuevaEtapaInfo?.config_extra, faltante) ?? undefined,
      etapaDestinoNombre: nuevaEtapaNombre,
    }
  }

  // Ya no hay vuelta atrás por decisión del usuario: recién aquí se escriben los gates
  // vencidos que quedaron como "no aplica".
  if (aplicarOmisiones) {
    const errOmision = await aplicarOmisiones()
    if (errOmision) return { error: errOmision }
  }

  // Cambiar etapa
  const resultCambio = await cambiarEtapaNegocio(negocioId, resolvedEtapaId)
  if (resultCambio.error) return resultCambio

  // Quién aceptó entregar el caso queda escrito. Sin esto no hay forma de saber si el
  // aviso se está leyendo o si el equipo aprendió a cerrarlo: exactamente lo que este
  // control viene a evitar. `autor_id` es staff.id (campo minado ya documentado).
  if (pideConfirmar && confirmado && staffId) {
    try {
      await db(supabase).from('activity_log').insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio_etapa',
        autor_id: staffId,
        contenido: `Confirmó el paso a ${nuevaEtapaNombre} sabiendo que el caso sale del proceso comercial.`.slice(0, 280),
      })
    } catch (e) {
      // El caso ya se movió: no convertir el rastro en un fallo del avance.
      console.error('[cambiarEtapa] no se pudo registrar la confirmación:', e)
    }
  }

  // El status del contacto ya NO se toca al avanzar de etapa. Era un derivado del
  // ciclo de vida del negocio y ahora es gestión comercial del contacto (intentos
  // de contacto, standby, descartado), que ningún avance de negocio puede deducir.
  // Escribirlo aquí le pisaría el dato a quien trabaja el lead. Ver STATUS_CONTACTO.

  // Registrar en activity_log
  if (staffId) {
    await supabase
      .from('activity_log')
      .insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio_etapa',
        autor_id: staffId,
        campo_modificado: 'etapa',
        valor_anterior: etapaActualNombre,
        valor_nuevo: nuevaEtapaNombre,
        contenido: motivoOverride ? `Override: ${motivoOverride}` : null,
      })
  }

  // El tercero de Siigo se crea al superar la etapa donde se captura el RUT.
  // Va DESPUÉS del avance y del log, y no puede romper ninguno de los dos: el
  // negocio ya se movió. Un tercero no es un documento contable (crearlo dos
  // veces no asienta nada), por eso este es el único de los tres documentos que
  // se dispara solo. Sin `config_extra.siigo` en la línea, no hace nada.
  await crearClienteSiigoAlAvanzar(
    workspaceId,
    negocioId,
    nuevaEtapaInfo?.linea_id ?? null,
    nuevaEtapaInfo?.numero ?? null,
    staffId ?? null,
  )

  return { ...resultCambio, etapaDestinoNombre: nuevaEtapaNombre }
}

// ── Marcar bloque completo ─────────────────────────────────────────────────────

export async function marcarBloqueCompleto(
  negocioBloqueId: string,
  data: Record<string, unknown>,
  // Ver `actualizarBloqueData`. Un bloque de una etapa superada casi siempre está
  // COMPLETO, así que la corrección entra por acá y no por el guardado de borrador:
  // sin este tratamiento, el camino más común de corrección era justo el que no
  // dejaba ni marca de autoría ni traza (hueco detectado el 2026-08-02).
  opts?: { correccion?: { causa?: string; sesion_id?: string } }
): Promise<{ error: string | null; trigger_afi_generation?: boolean; trigger_afi_contrato?: boolean; negocio_id?: string }> {
  const { supabase, workspaceId, userId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Guard server-side de permisos (rol+área+responsable). La UI es solo UX.
  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { error: guard.error ?? 'Sin permiso' }

  // Bloque compartido entre etapas: el DATO vive en la fila del origen, pero la
  // COMPLETITUD es de cada etapa (cada una tiene su propio gate). Por eso se separan:
  // el merge se hace sobre el data del origen y el estado se marca en la instancia local.
  // Cuando el bloque no es compartido, destinoId === negocioBloqueId y todo ocurre en
  // una sola fila, exactamente como antes.
  const destinoId = await resolverDestinoCompartido(supabase, negocioBloqueId)

  // Leer datos actuales + negocio_id del servidor y hacer merge (evita sobreescribir campos AI)
  const { data: currentBloque } = await db(supabase)
    .from('negocio_bloques')
    .select('data, negocio_id')
    .eq('id', destinoId)
    .single()

  const negocioId = (currentBloque as Record<string, unknown> | null)?.negocio_id as string | null
  const currentData = (currentBloque?.data as Record<string, unknown>) ?? {}
  let mergedData = { ...currentData, ...data }

  // ── Corrección post-avance ────────────────────────────────────────────────
  // Mismo criterio que `actualizarBloqueData`: sobre una etapa ya superada esto no
  // es trabajo de la etapa sino una corrección, y exige opt-in del bloque, causa y
  // marca de autoría con el valor previo.
  const corr = await contextoCorreccion(supabase, negocioBloqueId)
  let cambiosCorreccion: CampoCorregido[] = []
  let nombreCorrector: string | null = null
  if (corr?.esPostAvance) {
    if (!corr.permiteCorregir) {
      return { error: 'Este bloque no admite correcciones después de avanzar de etapa' }
    }
    const causa = opts?.correccion?.causa
    const sesionId = opts?.correccion?.sesion_id
    if (!esCausaValida(causa) || !sesionId) {
      return { error: 'Indica por qué se corrige antes de guardar' }
    }
    const estampado = await estamparEdiciones(supabase, userId, currentData, mergedData)
    mergedData = estampado.data
    cambiosCorreccion = estampado.cambios
    nombreCorrector = estampado.nombre
  }

  // ── Barrera de completitud (bloques `datos` que son GATE) ─────────────────
  //
  // Hasta acá esta función solo validaba PERMISOS. La completitud la decidía el
  // cliente (`BloqueDatos.isComplete`) y el servidor escribía `estado='completo'`
  // con lo que le llegara. Cualquier llamador que no fuera ese camino podía marcar
  // completo un bloque incompleto — `handleConfirm` (bloques `require_confirm`)
  // llama directo, sin evaluar completitud.
  //
  // Acotado a `es_gate`: es donde un bloque mal completado tiene consecuencia
  // (deja avanzar de etapa). Un bloque no-gate mal marcado no rompe nada, y
  // exigirlo aquí cambiaría el comportamiento de workspaces que hoy funcionan.
  {
    const { data: cfgRaw } = await db(supabase)
      .from('negocio_bloques')
      .select('bloque_configs!inner(es_gate, config_extra, bloque_definitions!inner(tipo))')
      .eq('id', negocioBloqueId)
      .single()
    const cfg = (cfgRaw as { bloque_configs?: { es_gate?: boolean; config_extra?: Record<string, unknown> | null; bloque_definitions?: { tipo?: string } | null } } | null)?.bloque_configs
    const esDatosGate = cfg?.es_gate === true && cfg?.bloque_definitions?.tipo === 'datos'
    if (esDatosGate) {
      const fields = (cfg?.config_extra?.fields ?? []) as CampoConfig[]
      const faltantes = camposRequeridosFaltantes(fields, mergedData)
      if (faltantes.length > 0) {
        const nombres = faltantes.map((f) => f.label ?? f.slug).join(', ')
        return { error: `Faltan campos obligatorios: ${nombres}` }
      }
    }
  }

  if (destinoId !== negocioBloqueId) {
    const { error: dataError } = await db(supabase)
      .from('negocio_bloques')
      .update({ data: mergedData, updated_at: new Date().toISOString() })
      .eq('id', destinoId)
    if (dataError) return { error: (dataError as { message: string }).message }
  }

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({
      estado: 'completo',
      // Si el bloque es compartido, el dato ya quedó en el origen; escribirlo también
      // aquí recrearía la copia divergente que este mecanismo viene a eliminar.
      ...(destinoId === negocioBloqueId ? { data: mergedData } : {}),
      completado_at: new Date().toISOString(),
      // FK → profiles(id) y el display resuelve por profiles. Debe ser el
      // profile.id (userId), NO staff.id. Antes usaba staffId → violaba la FK.
      completado_por: userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioBloqueId)

  if (updateError) return { error: (updateError as { message: string }).message }

  // Igual que en `actualizarBloqueData`: la respuesta y sus campos derivados se escriben
  // juntos. Hace falta en AMBOS caminos — el cliente manda por aquí cuando el bloque queda
  // completo, que es justamente el caso de una pregunta obligatoria que decide una ruta.
  const derivadosCambiados = await propagarCamposDerivados(supabase, negocioBloqueId, mergedData)

  // Traza de la corrección contra el bloque donde vive el dato (ver `actualizarBloqueData`).
  if (cambiosCorreccion.length > 0) {
    await registrarCorrecciones({
      supabase,
      workspaceId,
      userId,
      staffId,
      userNombre: nombreCorrector,
      negocioBloqueId: destinoId,
      campos: cambiosCorreccion,
      causa: opts!.correccion!.causa as CausaCorreccion,
      sesionId: opts!.correccion!.sesion_id as string,
    })
    // Si lo corregido decide la ruta, el caso vuelve al punto donde se decide.
    await aplicarRetornoPorDecision(
      supabase, workspaceId, negocioBloqueId, userId, staffId,
      cambiosCorreccion, opts!.correccion!.causa as CausaCorreccion,
    )
    // Y si el caso ya se fue por la via equivocada, se PROPONE devolverlo al tramo que se
    // salto. Este es el camino FRECUENTE de correccion: un bloque de una etapa superada
    // casi siempre esta completo, asi que el guardado entra por aqui y no por el borrador.
    if (negocioId) {
      await detectarReversaDeRuta(
        supabase, workspaceId, negocioId, userId, staffId,
        [...cambiosCorreccion.map(c => c.slug), ...derivadosCambiados],
        opts!.correccion!.causa as CausaCorreccion,
      )
    }
  }

  // Siempre revalidar la página del negocio después de marcar completo
  if (negocioId) {
    revalidatePath(`/negocios/${negocioId}`)
  }

  // ── Trigger auto-cobros si el bloque tiene esa configuración ─────────
  const { data: bloqueRaw } = await db(supabase)
    .from('negocio_bloques')
    .select(`
      negocio_id,
      bloque_config_id,
      bloque_configs(
        nombre,
        config_extra,
        bloque_definitions(tipo, nombre)
      )
    `)
    .eq('id', negocioBloqueId)
    .single()

  if (bloqueRaw) {
    const bloque = bloqueRaw as {
      negocio_id: string
      bloque_config_id: string
      bloque_configs: {
        nombre: string | null
        config_extra: Record<string, unknown>
        bloque_definitions: { tipo: string; nombre: string } | null
      } | null
    }

    const tipo = bloque.bloque_configs?.bloque_definitions?.tipo
    const configExtra = bloque.bloque_configs?.config_extra ?? {}
    const triggers = (configExtra.triggers ?? []) as Array<{ event: string; action: string; params?: Record<string, unknown> }>

    const autoCobros = triggers.find(t => t.action === 'auto_cobros')
    if (tipo === 'datos' && autoCobros) {
      const valorAnticipo = mergedData.valor_anticipo as number | undefined
      const referenciaEpayco = mergedData.referencia_anticipo as string | undefined
      if (valorAnticipo) {
        await autoCrearCobros(bloque.negocio_id, valorAnticipo, referenciaEpayco)
      }
    }

    const autoCobrosMulti = triggers.find(t => t.action === 'auto_cobros_multi')
    if (tipo === 'datos' && autoCobrosMulti) {
      const pagos = (mergedData.pagos ?? []) as Array<{ referencia_epayco: string; valor_pago: number }>
      if (pagos.length > 0) {
        await autoCrearCobrosMulti(bloque.negocio_id, pagos)
      }
    }

    // ── Hook AFI: si es uno de los bloques accionables del workspace afi, señalar al cliente
    // que dispare el endpoint correspondiente (route handlers tienen maxDuration=60s).
    // Server actions no permiten export maxDuration, por eso no corremos el motor aqui.
    let trigger_afi_generation = false
    let trigger_afi_contrato = false
    if (tipo === 'datos' && bloque.bloque_configs?.nombre) {
      const nombre = bloque.bloque_configs.nombre
      if (nombre === 'Generar paquete' || nombre === 'Generar contrato') {
        const { data: ws } = await db(supabase)
          .from('workspaces').select('slug').eq('id', workspaceId as string).single()
        if ((ws as { slug: string } | null)?.slug === 'afi') {
          if (nombre === 'Generar paquete') trigger_afi_generation = true
          else if (nombre === 'Generar contrato') trigger_afi_contrato = true
        }
      }
    }
    if (trigger_afi_generation) {
      return { error: null, trigger_afi_generation: true, negocio_id: bloque.negocio_id }
    }
    if (trigger_afi_contrato) {
      return { error: null, trigger_afi_contrato: true, negocio_id: bloque.negocio_id }
    }

    // Registrar en activity_log con detalle de campos que cambiaron
    if (staffId && workspaceId) {
      const bloqueNombre = bloque.bloque_configs?.nombre ?? bloque.bloque_configs?.bloque_definitions?.nombre ?? 'Bloque'
      // Diff: detectar qué campos cambiaron respecto a los datos anteriores
      const changedFields: string[] = []
      for (const key of Object.keys(data)) {
        if (JSON.stringify(currentData[key]) !== JSON.stringify(data[key])) {
          changedFields.push(key)
        }
      }
      const detalle = changedFields.length > 0
        ? `Bloque "${bloqueNombre}" completado (${changedFields.join(', ')})`
        : `Bloque "${bloqueNombre}" completado`
      await supabase
        .from('activity_log')
        .insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: bloque.negocio_id,
          tipo: 'cambio',
          autor_id: staffId,
          campo_modificado: 'bloque_datos',
          contenido: detalle,
        })
    }
  }

  return { error: null }
}

// ── Actualizar data del bloque sin marcar completo ────────────────────────────

/**
 * Bloque compartido entre etapas: devuelve la fila donde debe escribirse el dato.
 *
 * Un bloque `datos` marcado con `config_extra.compartido_con_origen` es la MISMA casilla
 * vista desde otra etapa, no una copia. Caso canónico (SOENA): la fecha de la cita DIAN
 * la registra operaciones en Cita si consiguió agendamiento, o el comercial en
 * Notificación si la cita salió por PQR y el cliente le reportó la fecha después.
 *
 * Sin esto habría dos filas y dos fechas que nadie concilia, y quien lee el dato (el
 * cross-check de vigencia del certificado bancario) solo miraría una de las dos.
 *
 * Devuelve el id recibido cuando el bloque no es compartido, o cuando el origen no se
 * encuentra: ante la duda se escribe donde el usuario está, nunca se pierde el dato.
 */
async function resolverDestinoCompartido(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioBloqueId: string,
): Promise<string> {
  const { data: actual } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id, bloque_configs!inner(config_extra)')
    .eq('id', negocioBloqueId)
    .single()
  if (!actual) return negocioBloqueId

  const cfg = ((actual as Record<string, unknown>).bloque_configs as Record<string, unknown> | null)
  const ce = (cfg?.config_extra ?? {}) as Record<string, unknown>
  if (ce.compartido_con_origen !== true) return negocioBloqueId

  const srcSlug = ce.source_bloque_slug as string | undefined
  if (!srcSlug) return negocioBloqueId

  const { data: origen } = await db(supabase)
    .from('negocio_bloques')
    .select('id, bloque_configs!inner(slug)')
    .eq('negocio_id', (actual as { negocio_id: string }).negocio_id)
    .eq('bloque_configs.slug', srcSlug)
    .maybeSingle()

  return (origen as { id?: string } | null)?.id ?? negocioBloqueId
}

/**
 * Propaga los campos DERIVADOS de un bloque que acaba de guardarse.
 *
 * Un campo con `lock_when.mapping` no es una pregunta: es la consecuencia de la respuesta
 * de otro campo (ver el tipo en `BloqueDatos.tsx`). Sirve para reemplazar varios
 * interruptores sueltos por una sola pregunta SIN tocar los routings, que siguen leyendo
 * los campos de siempre.
 *
 * ⚠️ Por qué la derivación se persiste AQUÍ y no basta el effect del cliente.
 * El enforcement de `lock_when` corre al RENDERIZAR, así que el valor derivado se escribe
 * cuando alguien ABRE el negocio. Para un campo que decide una ruta eso llega tarde: el
 * routing puede evaluarse antes de que el valor exista, y el motor leería un campo vacío y
 * caería al default — el mismo defecto que este trabajo viene a cerrar. Escribiéndolo al
 * guardar, la respuesta y sus consecuencias quedan en la misma operación. El effect del
 * cliente se conserva solo como respaldo para instancias viejas.
 *
 * Una respuesta que no está en el mapa deja el campo derivado VACÍO a propósito: el vacío
 * no es una respuesta, y exigirla es trabajo del gate de la pregunta, no de este campo.
 *
 * Deja rastro en `_derivado` (qué campo, desde qué respuesta y cuándo), por la misma razón
 * que lo dejó la limpieza de campos retirados: cuando el sistema escribe datos solo, el
 * rastro es parte del arreglo.
 */
async function propagarCamposDerivados(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioBloqueId: string,
  data: Record<string, unknown>,
): Promise<string[]> {
  // Devuelve los slugs DERIVADOS que efectivamente cambiaron de valor. Los necesita la
  // reversa de ruta: el campo que gobierna una bifurcación suele ser un derivado, no la
  // pregunta que el equipo toca (el patrón de "una sola pregunta, varios interruptores").
  // Sin esto, una corrección que mueve el decisor por derivación pasaría desapercibida.
  const derivadosCambiados: string[] = []

  // El bloque fuente se identifica por su slug estable. Un heredado (slug null) nunca lo es.
  const { data: fuente } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id, bloque_configs!inner(slug, etapa_id)')
    .eq('id', negocioBloqueId)
    .single()
  if (!fuente) return derivadosCambiados

  const cfgFuente = (fuente as Record<string, unknown>).bloque_configs as Record<string, unknown> | null
  const slugFuente = cfgFuente?.slug as string | undefined
  const negocioId = (fuente as { negocio_id: string }).negocio_id
  if (!slugFuente) return derivadosCambiados

  // Línea del negocio → sus bloques configurados. Es una lectura de CONFIGURACIÓN (sin
  // `data`), acotada a la línea, y en un workspace sin campos derivados corta aquí mismo.
  const { data: etapaFuente } = await db(supabase)
    .from('etapas_negocio')
    .select('linea_id')
    .eq('id', cfgFuente?.etapa_id as string)
    .single()
  const lineaId = (etapaFuente as { linea_id?: string } | null)?.linea_id
  if (!lineaId) return derivadosCambiados

  const { data: configs } = await db(supabase)
    .from('bloque_configs')
    .select('id, config_extra, etapas_negocio!inner(linea_id)')
    .eq('etapas_negocio.linea_id', lineaId)

  type Derivado = {
    configId: string
    slug: string
    lockWhen: LockWhen
    campoFuente: string
    respuesta: unknown
  }
  const candidatos: Derivado[] = []
  for (const c of (configs ?? []) as Record<string, unknown>[]) {
    const fields = ((c.config_extra as Record<string, unknown> | null)?.fields ?? []) as Record<string, unknown>[]
    for (const f of fields) {
      const lw = f.lock_when as Record<string, unknown> | undefined
      if (!lw?.mapping || lw.source_bloque_slug !== slugFuente) continue
      const campoFuente = lw.field as string
      // El campo fuente puede no venir en este guardado (se guardó otro campo del mismo
      // bloque): sin respuesta no hay nada que derivar, y NO es motivo para vaciar.
      if (!(campoFuente in data)) continue
      candidatos.push({
        configId: c.id as string,
        slug: f.slug as string,
        lockWhen: lw as unknown as LockWhen,
        campoFuente,
        respuesta: data[campoFuente],
      })
    }
  }
  if (candidatos.length === 0) return derivadosCambiados

  // Una regla puntual que convive con el mapeo (leasing → sin devolución de IVA) puede
  // leer OTRO bloque. Hay que traer su valor: sin él, el servidor escribiría el derivado
  // ignorando una regla dura de negocio y el cliente lo corregiría recién al abrir el
  // negocio, que es exactamente el retraso que este trabajo viene a eliminar.
  const slugsRegla = [...new Set(candidatos.map(d => d.lockWhen.regla?.source_bloque_slug).filter(Boolean))] as string[]
  const valorPorSlug = new Map<string, Record<string, unknown>>()
  if (slugsRegla.length > 0) {
    const { data: bloquesRegla } = await db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug)')
      .eq('negocio_id', negocioId)
      .in('bloque_configs.slug', slugsRegla)
    for (const b of (bloquesRegla ?? []) as Record<string, unknown>[]) {
      const s = (b.bloque_configs as Record<string, unknown> | null)?.slug as string | undefined
      if (s) valorPorSlug.set(s, (b.data as Record<string, unknown>) ?? {})
    }
  }

  const derivados = candidatos.map(d => {
    const r = d.lockWhen.regla
    const valorRegla = r ? valorPorSlug.get(r.source_bloque_slug)?.[r.field] : undefined
    return {
      ...d,
      // Misma regla que aplica el render, de una sola fuente (`campo-derivado.ts`).
      valor: resolverDerivado(d.lockWhen, d.respuesta, valorRegla).valor,
    }
  })

  const { data: instancias } = await db(supabase)
    .from('negocio_bloques')
    .select('id, data, bloque_config_id')
    .eq('negocio_id', negocioId)
    .in('bloque_config_id', [...new Set(derivados.map(d => d.configId))])

  const ahora = new Date().toISOString()
  for (const inst of (instancias ?? []) as Record<string, unknown>[]) {
    const propios = derivados.filter(d => d.configId === inst.bloque_config_id)
    if (propios.length === 0) continue

    // Escribir donde vive el dato de verdad (un derivado puede estar en un bloque compartido).
    const destinoId = await resolverDestinoCompartido(supabase, inst.id as string)
    const base =
      destinoId === inst.id
        ? ((inst.data as Record<string, unknown>) ?? {})
        : (((await db(supabase).from('negocio_bloques').select('data').eq('id', destinoId).single())
            .data as Record<string, unknown> | null)?.data as Record<string, unknown>) ?? {}

    const siguiente = { ...base }
    const rastro = { ...((base._derivado as Record<string, unknown>) ?? {}) }
    let cambio = false
    for (const d of propios) {
      if (base[d.slug] === d.valor) continue
      cambio = true
      derivadosCambiados.push(d.slug)
      if (d.valor === undefined) delete siguiente[d.slug]
      else siguiente[d.slug] = d.valor
      rastro[d.slug] = {
        de_bloque: slugFuente,
        de_campo: d.campoFuente,
        respuesta: d.respuesta ?? null,
        en: ahora,
      }
    }
    if (!cambio) continue
    siguiente._derivado = rastro

    await db(supabase)
      .from('negocio_bloques')
      .update({ data: siguiente, updated_at: ahora })
      .eq('id', destinoId)
  }

  return [...new Set(derivadosCambiados)]
}

/**
 * Estampa `_ediciones[slug] = { por_id, por_nombre, en }` en los campos que
 * cambiaron. La marca la construye el SERVIDOR comparando contra lo persistido:
 * lo que mande el cliente en `_ediciones` se descarta, o cualquiera podría
 * firmar una corrección con el nombre de otro.
 */
async function estamparEdiciones(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string | undefined,
  previa: Record<string, unknown>,
  entrante: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; cambios: CampoCorregido[]; nombre: string | null }> {
  const { _ediciones: _descartado, ...limpio } = entrante as Record<string, unknown> & { _ediciones?: unknown }
  const ediciones = { ...((previa._ediciones ?? {}) as Record<string, unknown>) }

  const cambiados = Object.keys(limpio).filter(
    k => !k.startsWith('_') && JSON.stringify(limpio[k]) !== JSON.stringify(previa[k]),
  )
  if (cambiados.length === 0) return { data: { ...limpio, _ediciones: ediciones }, cambios: [], nombre: null }

  let nombre = 'Usuario'
  if (userId) {
    const { data: prof } = await db(supabase).from('profiles').select('full_name').eq('id', userId).single()
    nombre = (prof?.full_name as string | null) ?? 'Usuario'
  }
  const en = new Date().toISOString()
  // La marca conserva el valor PREVIO además de quién y cuándo. Sin el valor previo,
  // la huella dice que alguien tocó el campo pero no permite reconstruir qué decía,
  // que es justo lo que se necesita para revisar una decisión aguas abajo.
  // `antes` se fija la primera vez y no se pisa: si el mismo campo se toca varias
  // veces, el original sigue siendo el que había antes de empezar a corregir.
  for (const slug of cambiados) {
    const marcaPrevia = (ediciones[slug] ?? null) as { antes?: unknown } | null
    ediciones[slug] = {
      por_id: userId ?? '',
      por_nombre: nombre,
      en,
      antes: marcaPrevia && 'antes' in marcaPrevia ? marcaPrevia.antes : (previa[slug] ?? null),
      despues: limpio[slug] ?? null,
    }
  }

  const cambios: CampoCorregido[] = cambiados.map(slug => ({
    slug,
    antes: (ediciones[slug] as { antes?: unknown }).antes,
    despues: limpio[slug] ?? null,
  }))

  return { data: { ...limpio, _ediciones: ediciones }, cambios, nombre }
}

/**
 * Si la corrección tocó un dato que DECIDE la ruta y el caso ya pasó por el punto donde
 * ese dato se evalúa, devuelve el caso a ese punto para que el motor vuelva a decidir.
 *
 * Se llama DESPUÉS de persistir el dato y de propagar sus campos derivados: el motor tiene
 * que encontrar el valor nuevo cuando el caso vuelva a salir de la etapa. Y después de
 * registrar la corrección, porque la traza del dato es independiente de que el caso se
 * mueva o no.
 *
 * Opt-in por configuración de la etapa (`punto_de_decision`). Sin esa declaración
 * `retornosPosibles` corta en la primera consulta y no hay cambio de comportamiento.
 */
async function aplicarRetornoPorDecision(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  negocioBloqueId: string,
  userId: string | undefined,
  staffId: string | null | undefined,
  cambios: CampoCorregido[],
  causa: CausaCorreccion,
): Promise<void> {
  if (cambios.length === 0) return
  const posibles = await retornosPosibles(supabase, negocioBloqueId)
  if (posibles.length === 0) return

  const { data: nb } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id')
    .eq('id', negocioBloqueId)
    .maybeSingle()
  const negocioId = (nb as { negocio_id?: string } | null)?.negocio_id
  if (!negocioId) return

  const disparados = await retornosDisparados(supabase, negocioId, posibles, cambios)
  if (disparados.length === 0) return

  const r = await ejecutarRetorno({
    supabase,
    workspaceId,
    negocioId,
    userId,
    staffId,
    retorno: disparados[0],
    causa,
  })
  if (r) {
    revalidatePath(`/negocios/${negocioId}`)
    revalidatePath('/negocios')
  }
}

/**
 * Si la corrección cambió un dato que YA decidió una ruta recorrida, deja PROPUESTO
 * devolver el caso a la primera etapa que se saltó.
 *
 * Corre DESPUÉS de `aplicarRetornoPorDecision`, y ese orden no es casual: si el retorno al
 * punto de decisión ya movió el caso, ahora está EN la etapa donde se decide y no hay
 * ninguna ruta recorrida que revisar — la detección lo ve y no propone nada. Al revés, los
 * dos mecanismos se pisarían.
 *
 * ⚠️ Solo PROPONE. Devolver un caso reabre gates de saldo y puede dejar cobros y cuentas de
 * cobro en desacuerdo con la etapa: eso lo decide una persona, en `aplicarReversaDeRuta`.
 *
 * `derivados` son los campos que la propagación acaba de mover por `lock_when.mapping`. Van
 * junto a los corregidos porque el campo que gobierna la bifurcación casi nunca es el que
 * el equipo toca: es su consecuencia (una pregunta, varios interruptores).
 *
 * Opt-in por LÍNEA (`config_extra.reversa_ruta.activa`). Sin eso `detectarReversa` corta en
 * la segunda consulta y ninguna línea cambia de comportamiento.
 */
async function detectarReversaDeRuta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  negocioId: string,
  userId: string | undefined,
  staffId: string | null | undefined,
  slugs: string[],
  causa: CausaCorreccion,
): Promise<void> {
  if (slugs.length === 0) return
  try {
    const propuesta = await detectarReversa(supabase, workspaceId, negocioId, slugs)
    if (!propuesta) return
    await guardarPropuesta({ supabase, workspaceId, negocioId, propuesta, staffId, userId, causa })
    revalidatePath(`/negocios/${negocioId}`)
  } catch (err) {
    // La corrección del dato ya está guardada: un fallo detectando la divergencia no puede
    // tumbarla. Lo que no puede es quedar mudo.
    console.error('[reversa] no se pudo revisar la ruta del caso:', err)
  }
}

/**
 * Devuelve el caso a la primera etapa omitida. **Es la decisión de una persona**, y por eso
 * es una acción aparte: nada de esto ocurre solo.
 *
 * Revalida la propuesta contra el estado de AHORA en vez de confiar en la guardada: entre
 * que se detectó y que alguien la aprueba, el caso pudo moverse o el dato pudo cambiar
 * otra vez. Si ya no aplica, se limpia y se dice — mover un caso por una propuesta vencida
 * sería exactamente el error que este mecanismo viene a evitar.
 */
export async function aplicarReversaDeRuta(
  negocioId: string,
  motivo: string,
): Promise<{ error: string | null; destino?: string; omitidas?: string[] }> {
  const { supabase, workspaceId, userId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const guardVer = await guardVerNegocio(negocioId)
  if (!guardVer.ok) return { error: guardVer.error ?? 'Sin acceso a este negocio' }

  // Mover un caso hacia atrás tiene consecuencias de plata: mismo criterio de autorización
  // que la pantalla usa para dibujar el botón (`puedeDevolverCasoPorRuta`, fuente única).
  if (!puedeDevolverCasoPorRuta({ id: staffId ?? '', role: (role ?? 'read_only') as Role, areas: (areas ?? []) as Area[] })) {
    return { error: 'Tu rol no permite devolver un caso a una etapa anterior' }
  }

  const razon = motivo.trim()
  // Sin motivo no hay traza que sirva: dentro de un mes nadie sabrá por qué se movió.
  if (razon.length < 5) return { error: 'Escribe por qué se devuelve el caso' }

  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const pendiente = (((negRaw as { metadata?: Record<string, unknown> | null } | null)?.metadata
    ?.reversa_ruta_pendiente ?? null) as PropuestaPendiente | null)
  if (!pendiente) return { error: 'No hay una propuesta pendiente para este negocio' }

  const vigente = await detectarReversa(supabase, workspaceId, negocioId, null, pendiente.decision.id)
  if (!vigente) {
    await descartarPropuesta({
      supabase, workspaceId, negocioId, staffId,
      motivo: 'La propuesta dejó de aplicar: el caso o el dato cambiaron desde que se detectó.',
    })
    revalidatePath(`/negocios/${negocioId}`)
    return { error: 'La propuesta ya no aplica: el caso o el dato cambiaron. Se retiró el aviso.' }
  }

  const { resultado, error: errEjec } = await ejecutarReversa({
    supabase,
    workspaceId,
    negocioId,
    propuesta: vigente,
    userId,
    staffId,
    motivo: razon,
    // El mismo movedor del avance normal: crea las casillas de la etapa destino con su
    // herencia y dispara el `avisar_al_entrar` por el trigger del UPDATE. Se inyecta en vez
    // de importarse dentro de la lib para no cerrar un ciclo contra este archivo.
    moverEtapa: cambiarEtapaNegocio,
  })
  if (errEjec || !resultado) return { error: errEjec ?? 'No se pudo devolver el caso' }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null, destino: resultado.destinoNombre, omitidas: resultado.omitidas }
}

/** Descarta la propuesta sin mover el caso. Exige motivo: el descarte también es un dato. */
export async function descartarReversaDeRuta(
  negocioId: string,
  motivo: string,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const guardVer = await guardVerNegocio(negocioId)
  if (!guardVer.ok) return { error: guardVer.error ?? 'Sin acceso a este negocio' }
  if (!puedeDevolverCasoPorRuta({ id: staffId ?? '', role: (role ?? 'read_only') as Role, areas: (areas ?? []) as Area[] })) {
    return { error: 'Tu rol no permite decidir sobre esta propuesta' }
  }

  const razon = motivo.trim()
  if (razon.length < 5) return { error: 'Escribe por qué se descarta' }

  const r = await descartarPropuesta({ supabase, workspaceId, negocioId, motivo: razon, staffId })
  if (r.error) return r
  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

/**
 * El aviso que la pantalla muestra ANTES de dejar corregir: "este dato define la ruta del
 * caso; cambiarlo lo devuelve a <etapa> para volver a decidir".
 *
 * Se consulta al abrir la corrección y no al guardar porque el guardado de un bloque de
 * datos es un autosave: para cuando hubiera algo que preguntar, el dato ya viajó. Es el
 * mismo motivo por el que la causa se elige antes de editar.
 *
 * Devuelve `null` cuando no hay nada que avisar: sin declaración en la etapa, sin permiso,
 * o porque el caso todavía no pasó por el punto de decisión.
 */
export async function consultarRetornoDeCorreccion(
  negocioBloqueId: string,
): Promise<{ aviso: string | null; etapa: string | null }> {
  const vacio = { aviso: null, etapa: null }
  const { supabase, error } = await getWorkspace()
  if (error) return vacio
  // Mismo guard que la escritura: quien no puede corregir tampoco necesita el aviso.
  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return vacio
  const posibles = await retornosPosibles(supabase, negocioBloqueId)
  if (posibles.length === 0) return vacio
  return { aviso: posibles[0].aviso, etapa: posibles[0].etapaNombre }
}

export async function actualizarBloqueData(
  negocioBloqueId: string,
  data: Record<string, unknown>,
  negocioId?: string,
  // Guardado de BORRADOR: con { revalidate: false } persiste sin revalidar la ruta
  // (no re-renderiza el server component → no roba el foco mientras se escribe).
  // Default true para compatibilidad.
  //
  // `correccion` solo aplica cuando el bloque es de una etapa YA SUPERADA: la causa
  // se elige en un clic al abrir la corrección y el `sesion_id` agrupa los campos
  // tocados en ese mismo acto. En el trabajo normal de la etapa no viaja.
  opts?: { revalidate?: boolean; correccion?: { causa?: string; sesion_id?: string } }
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, userId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Guard server-side de permisos (rol+área+responsable). El autosave de borrador
  // también escribe negocio_bloques.data → debe validar igual que marcarBloqueCompleto.
  // getBloqueMode (cliente) es solo UX; esta es la barrera real.
  //
  // El guard se evalúa sobre el bloque que el usuario TIENE ABIERTO, aunque la escritura
  // se redirija a otra fila: el permiso lo da la etapa donde se está trabajando. Si se
  // validara contra el origen, el comercial no podría registrar en Notificación una fecha
  // cuyo bloque origen vive en Cita, que es de operaciones.
  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { error: guard.error ?? 'Sin permiso' }

  // ── Corrección post-avance ────────────────────────────────────────────────
  // Escribir en un bloque de una etapa YA SUPERADA no es trabajo de la etapa, es
  // una corrección: exige el opt-in `corregir_campos_gerencial` del bloque y deja
  // marca de quién y cuándo. El área ya la validó el guard de arriba.
  const corr = await contextoCorreccion(supabase, negocioBloqueId)
  let dataFinal = data
  let cambiosCorreccion: CampoCorregido[] = []
  let nombreCorrector: string | null = null
  if (corr?.esPostAvance) {
    if (!corr.permiteCorregir) {
      return { error: 'Este bloque no admite correcciones después de avanzar de etapa' }
    }
    // La causa es obligatoria: sin ella el registro no distingue un error real de un
    // cambio legítimo del cliente, y el agregado por área queda inservible. Se valida
    // en el servidor porque el cliente es solo UX.
    const causa = opts?.correccion?.causa
    const sesionId = opts?.correccion?.sesion_id
    if (!esCausaValida(causa) || !sesionId) {
      return { error: 'Indica por qué se corrige antes de guardar' }
    }
    const estampado = await estamparEdiciones(supabase, userId, corr.dataPrevia, data)
    dataFinal = estampado.data
    cambiosCorreccion = estampado.cambios
    nombreCorrector = estampado.nombre
  }

  // Bloque compartido entre etapas: la escritura va a la fila del origen, no a la copia
  // local. Es lo que hace que el dato sea UNO solo y no dos que pueden divergir.
  const destinoId = await resolverDestinoCompartido(supabase, negocioBloqueId)

  // Heredado `editable_solo_si_vacio`: si el dato YA vino lleno de la etapa anterior, el
  // bloque se muestra de solo lectura y aquí no se escribe. El render lo refleja, pero el
  // render es UX: esta es la barrera. Corregir un dato ya puesto se hace en su etapa
  // origen, que es donde vive la responsabilidad de ese campo.
  {
    const { data: abierto, error: errAbierto } = await db(supabase)
      .from('negocio_bloques')
      .select('bloque_configs!inner(config_extra)')
      .eq('id', negocioBloqueId)
      .single()
    if (errAbierto) return { error: `No se pudo leer el bloque: ${errAbierto.message}` }
    const ce = ((abierto as Record<string, unknown> | null)?.bloque_configs as
      { config_extra?: Record<string, unknown> | null } | null)?.config_extra ?? null

    if ((ce as { editable_solo_si_vacio?: boolean } | null)?.editable_solo_si_vacio === true) {
      // Se evalúa contra el DESTINO (el origen en un bloque compartido), que es donde
      // vive el dato de verdad; la copia local está vacía por diseño.
      const { data: filaDestino, error: errDestino } = await db(supabase)
        .from('negocio_bloques')
        .select('data')
        .eq('id', destinoId)
        .single()
      if (errDestino) return { error: `No se pudo leer el bloque origen: ${errDestino.message}` }
      const dataDestino = (filaDestino as { data: Record<string, unknown> | null } | null)?.data ?? null
      if (soloLecturaPorDatoLleno(ce, dataDestino)) {
        return { error: 'Este dato ya viene registrado de la etapa anterior. Para cambiarlo, corrígelo en la etapa donde se capturó.' }
      }
    }
  }

  const { data: row, error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({
      data: dataFinal,
      updated_at: new Date().toISOString(),
    })
    .eq('id', destinoId)
    .select('negocio_id')
    .single()

  if (updateError) return { error: (updateError as { message: string }).message }

  // Los campos derivados de este bloque (`lock_when.mapping`) se escriben en la MISMA
  // operación que la respuesta que los origina. Ver `propagarCamposDerivados`.
  // Se omite en el autosave de borrador (revalidate:false, escritura libre cada pocos
  // segundos): las respuestas que derivan algo siempre revalidan.
  //
  // Excepción: una CORRECCIÓN siempre propaga, aunque llegue por el camino del borrador.
  // Si no, un decisor derivado quedaría con el valor viejo mientras el caso ya se movió
  // por el nuevo — el motor volvería a decidir con el dato equivocado.
  let derivadosCambiados: string[] = []
  if (opts?.revalidate !== false || cambiosCorreccion.length > 0) {
    derivadosCambiados = await propagarCamposDerivados(supabase, negocioBloqueId, dataFinal)
  }

  // Traza de la corrección: valor previo, valor nuevo, causa y área DUEÑA del bloque.
  // Se registra contra `destinoId` (donde vive el dato), no contra la copia abierta:
  // en un bloque compartido el dato pertenece a la etapa de origen, y esa es el área
  // a la que corresponde el error. Nunca bloquea el guardado del dato.
  if (cambiosCorreccion.length > 0) {
    await registrarCorrecciones({
      supabase,
      workspaceId,
      userId,
      staffId,
      userNombre: nombreCorrector,
      negocioBloqueId: destinoId,
      campos: cambiosCorreccion,
      causa: opts!.correccion!.causa as CausaCorreccion,
      sesionId: opts!.correccion!.sesion_id as string,
    })
    await aplicarRetornoPorDecision(
      supabase, workspaceId, negocioBloqueId, userId, staffId,
      cambiosCorreccion, opts!.correccion!.causa as CausaCorreccion,
    )
    // Y si el caso ya se fue por la via que ese dato decidio, se PROPONE devolverlo al
    // tramo que se salto. Va despues del retorno a proposito (ver `detectarReversaDeRuta`).
    const idNegocio = negocioId ?? ((row as Record<string, unknown>)?.negocio_id as string | undefined)
    if (idNegocio) {
      await detectarReversaDeRuta(
        supabase, workspaceId, idNegocio, userId, staffId,
        [...cambiosCorreccion.map(c => c.slug), ...derivadosCambiados],
        opts!.correccion!.causa as CausaCorreccion,
      )
    }
  }

  const nid = negocioId ?? (row as Record<string, unknown>)?.negocio_id as string | undefined
  if (nid && opts?.revalidate !== false) revalidatePath(`/negocios/${nid}`)

  // No registrar en activity_log aquí — auto-save cada 800ms genera ruido.
  // Los cambios se registran al completar bloque (marcarBloqueCompleto), salvo la
  // corrección post-avance, que sí deja su propio evento (arriba).

  return { error: null }
}

// ── Inicializar bloque_items desde templates ─────────────────────────────────
// Llamar en primer render de BloqueChecklist cuando initialItems está vacío

export async function inicializarBloqueItems(
  negocioBloqueId: string,
  templates: Array<{ label: string; tipo: string }>
): Promise<{
  items: Array<{ id: string; label: string; tipo: string; completado: boolean; completado_por: string | null; completado_at: string | null; link_url: string | null }>
  error: string | null
}> {
  const { supabase, error } = await getWorkspace()
  if (error) return { items: [], error: 'No autenticado' }

  // Verificar si ya existen items
  const { data: existentes } = await db(supabase)
    .from('bloque_items')
    .select('id')
    .eq('negocio_bloque_id', negocioBloqueId)
    .limit(1)

  if (existentes && (existentes as unknown[]).length > 0) {
    // Ya existen — devolver todos
    const { data: allItems } = await db(supabase)
      .from('bloque_items')
      .select('id, label, tipo, completado, completado_por, completado_at, link_url')
      .eq('negocio_bloque_id', negocioBloqueId)
      .order('orden', { ascending: true })

    return {
      items: ((allItems ?? []) as Record<string, unknown>[]).map(i => ({
        id: i.id as string,
        label: i.label as string,
        tipo: i.tipo as string,
        completado: i.completado as boolean,
        completado_por: i.completado_por as string | null,
        completado_at: i.completado_at as string | null,
        link_url: i.link_url as string | null,
      })),
      error: null,
    }
  }

  // Crear items desde templates
  const rows = templates.map((t, i) => ({
    negocio_bloque_id: negocioBloqueId,
    label: t.label,
    tipo: t.tipo === 'checkbox' ? 'checkbox' : 'texto',
    orden: i,
    completado: false,
    contenido: {},
  }))

  const { data: created, error: insertError } = await db(supabase)
    .from('bloque_items')
    .insert(rows)
    .select('id, label, tipo, completado, completado_por, completado_at, link_url')

  if (insertError) return { items: [], error: (insertError as { message: string }).message }

  return {
    items: ((created ?? []) as Record<string, unknown>[]).map(i => ({
      id: i.id as string,
      label: i.label as string,
      tipo: i.tipo as string,
      completado: i.completado as boolean,
      completado_por: i.completado_por as string | null,
      completado_at: i.completado_at as string | null,
      link_url: i.link_url as string | null,
    })),
    error: null,
  }
}

// ── Marcar ítem de checklist / cronograma ─────────────────────────────────────

export async function marcarBloqueItem(
  bloqueItemId: string,
  completado: boolean,
  linkUrl?: string
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, userId, staffId, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  // Guard: resolver el bloque del item y validar permiso (rol+área+responsable)
  const { data: itemRow } = await db(supabase)
    .from('bloque_items')
    .select('negocio_bloque_id')
    .eq('id', bloqueItemId)
    .single()
  if (!itemRow) return { error: 'Item no encontrado' }
  const guard = await guardEditarBloque((itemRow as { negocio_bloque_id: string }).negocio_bloque_id)
  if (!guard.ok) return { error: guard.error ?? 'Sin permiso' }

  const payload: Record<string, unknown> = {
    completado,
    completado_at: completado ? new Date().toISOString() : null,
    // FK → profiles(id): profile.id (userId), no staff.id. NULL si se desmarca.
    completado_por: completado ? (userId ?? null) : null,
  }
  if (linkUrl !== undefined) payload.link_url = linkUrl

  const { error: updateError } = await db(supabase)
    .from('bloque_items')
    .update(payload)
    .eq('id', bloqueItemId)

  if (updateError) return { error: (updateError as { message: string }).message }

  // Registrar en activity_log
  if (staffId && workspaceId) {
    const { data: itemInfo } = await db(supabase)
      .from('bloque_items')
      .select('label, negocio_bloque_id')
      .eq('id', bloqueItemId)
      .single()

    if (itemInfo) {
      const item = itemInfo as { label: string; negocio_bloque_id: string }
      const { data: bloqueInfo } = await db(supabase)
        .from('negocio_bloques')
        .select('negocio_id')
        .eq('id', item.negocio_bloque_id)
        .single()

      const negocioId = (bloqueInfo as { negocio_id: string } | null)?.negocio_id
      if (negocioId) {
        await supabase
          .from('activity_log')
          .insert({
            workspace_id: workspaceId,
            entidad_tipo: 'negocio',
            entidad_id: negocioId,
            tipo: 'cambio',
            autor_id: staffId,
            campo_modificado: 'checklist_item',
            contenido: completado ? `"${item.label}" marcado como completado` : `"${item.label}" desmarcado`,
          })
      }
    }
  }

  return { error: null }
}

// ── Auto-crear cobro anticipo (solo 1, idempotente) ─────────────────────────

export async function autoCrearCobros(
  negocioId: string,
  valorAnticipo: number,
  referenciaEpayco?: string
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // ── Modelo de dinero SOENA (OPT-IN): partir el pago en 2 cobros (pasante + honorario) ──
  // Si el negocio tiene propuesta aprobada con tarifa UPME, el UN pago que entra
  // (valorAnticipo) se reparte: la tarifa (pasante) primero, el resto honorario.
  // Sin barreras: si no calza con el anticipo esperado, se parte lo que entró y la
  // conciliación maneja la diferencia. Negocios sin tarifa siguen con 1 solo cobro.
  const modelo = await leerModeloDineroNegocio(supabase, negocioId)
  if (modelo) {
    const res = await crearCobrosSoenaCore(
      supabase, workspaceId, negocioId,
      (referenciaEpayco ?? '').trim() || `anticipo-${negocioId.slice(0, 8)}`,
      valorAnticipo, modelo,
    )
    if (!res.success) return { error: res.error }
    await reevaluarBloquesCobros(negocioId)
    revalidatePath(`/negocios/${negocioId}`)
    return { error: null }
  }

  // Idempotencia: verificar si ya existe un cobro anticipo para este negocio.
  // Un anticipo ANULADO no cuenta: si contara, este camino lo UPDATEARÍA y resucitaría
  // una fila que alguien anuló a propósito, con su motivo y su autor intactos pero con
  // plata de vuelta. Ver `lib/cobros/anulacion.ts`.
  const { data: existente } = await db(supabase)
    .from('cobros')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .eq('tipo_cobro', 'anticipo')
    .is('anulado_at', null)
    .limit(1)

  if (existente && (existente as unknown[]).length > 0) {
    // Ya existe anticipo — actualizar monto y referencia
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('cobros').update({
      monto: valorAnticipo,
      external_ref: referenciaEpayco ?? null,
    }).eq('id', (existente as Record<string, unknown>[])[0].id)
    await reevaluarBloquesCobros(negocioId)
    revalidatePath(`/negocios/${negocioId}`)
    return { error: null }
  }

  const cobro = {
    workspace_id: workspaceId,
    negocio_id: negocioId,
    notas: 'Anticipo',
    monto: valorAnticipo,
    tipo_cobro: 'anticipo',
    fecha: todayBogotaISO(),
    external_ref: referenciaEpayco ?? null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as any).from('cobros').insert(cobro)
  if (insertError) return { error: (insertError as { message: string }).message }

  await reevaluarBloquesCobros(negocioId)
  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// ── Auto-crear cobros multi-pago (etapa 7, idempotente por external_ref) ─────

export async function autoCrearCobrosMulti(
  negocioId: string,
  pagos: Array<{ referencia_epayco: string; valor_pago: number }>
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  if (!pagos.length) return { error: null }

  // Idempotencia por MULTIPLICIDAD de (external_ref, monto), no por external_ref
  // como conjunto. Bug 26 (SOENA): dos abonos reales que comparten la misma
  // referencia ePayco (o referencia vacía/repetida) colapsaban en un Set →
  // tras insertar el primero, el segundo se descartaba como "ya existe" y el
  // saldo no bajaba. Contando cuántos cobros ya existen por cada par (ref, monto)
  // e insertando solo el delta faltante, distinguimos "re-guardar el mismo pago"
  // (idempotente, delta 0) de "dos pagos reales distintos" (ambos se registran).
  const claveDe = (ref: string, monto: number) =>
    `${ref ?? ''} ${Math.round(Number(monto) * 100)}`

  const { data: existentes } = await db(supabase)
    .from('cobros')
    .select('external_ref, monto')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .eq('tipo_cobro', 'pago')

  // Cuántos cobros ya existen por cada par (ref, monto)
  const restante = new Map<string, number>()
  for (const e of (existentes ?? []) as Array<{ external_ref: string | null; monto: number }>) {
    const k = claveDe(e.external_ref ?? '', e.monto)
    restante.set(k, (restante.get(k) ?? 0) + 1)
  }

  // Recorrer las filas pedidas; insertar solo las que exceden lo ya registrado
  // por su par (ref, monto). El Map se decrementa por cada par "consumido" para
  // que un pago repetido legítimamente (2 filas iguales) registre 2 cobros.
  const nuevos = pagos
    .filter(p => {
      const k = claveDe(p.referencia_epayco, p.valor_pago)
      const ya = restante.get(k) ?? 0
      if (ya > 0) {
        restante.set(k, ya - 1) // este par ya está cubierto por un cobro existente
        return false
      }
      return true
    })
    .map(p => ({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      notas: 'Pago',
      monto: p.valor_pago,
      tipo_cobro: 'pago',
      fecha: todayBogotaISO(),
      external_ref: p.referencia_epayco,
    }))

  if (nuevos.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (supabase as any).from('cobros').insert(nuevos)
    if (insertError) return { error: (insertError as { message: string }).message }
  }

  await reevaluarBloquesCobros(negocioId)
  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// ── Agregar un bloque_item (cronograma) ───────────────────────────────────────

export async function agregarBloqueItem(
  negocioBloqueId: string,
  label: string,
  tipo: string,
  orden: number,
  extra?: { fecha_inicio?: string | null; fecha_fin?: string | null; responsable_id?: string | null }
): Promise<{ id: string | null; error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { id: null, error: 'No autenticado' }

  const row: Record<string, unknown> = { negocio_bloque_id: negocioBloqueId, label, tipo, orden, completado: false, contenido: {} }
  if (extra?.fecha_inicio) row.fecha_inicio = extra.fecha_inicio
  if (extra?.fecha_fin) row.fecha_fin = extra.fecha_fin
  if (extra?.responsable_id) row.responsable_id = extra.responsable_id

  const { data, error: insertError } = await db(supabase)
    .from('bloque_items')
    .insert(row)
    .select('id')
    .single()

  if (insertError) return { id: null, error: (insertError as { message: string }).message }
  return { id: (data as { id: string }).id, error: null }
}

// ── Actualizar datos de un bloque_item ────────────────────────────────────────

export async function actualizarBloqueItem(
  bloqueItemId: string,
  fields: { label?: string; fecha_inicio?: string | null; fecha_fin?: string | null; link_url?: string | null; responsable_id?: string | null }
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const { error: updateError } = await db(supabase)
    .from('bloque_items')
    .update(fields)
    .eq('id', bloqueItemId)

  if (updateError) return { error: (updateError as { message: string }).message }
  return { error: null }
}

// ── Eliminar un bloque_item ──────────────────────────────────────────────────

export async function eliminarBloqueItem(
  bloqueItemId: string
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const { error: delError } = await db(supabase)
    .from('bloque_items')
    .delete()
    .eq('id', bloqueItemId)

  if (delError) return { error: (delError as { message: string }).message }
  return { error: null }
}

// ── Re-evaluar completitud de bloques cobros del negocio ────────────────────
// Un bloque de cobros se considera completo cuando el saldo del negocio es 0
// (precio_aprobado/estimado - sum(cobros APROBADO|CAUSADO) <= 0).

export async function reevaluarBloquesCobros(
  negocioId: string
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  // Precio del negocio y cobros aprobados/causados en paralelo
  const [negocioRes, cobrosRes] = await Promise.all([
    db(supabase)
      .from('negocios')
      .select('precio_aprobado, precio_estimado')
      .eq('id', negocioId)
      .single(),
    supabase
      .from('cobros')
      .select('monto')
      .eq('negocio_id', negocioId)
      ,
  ])

  const neg = negocioRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
  const precio = neg?.precio_aprobado ?? neg?.precio_estimado ?? 0
  const totalCobrado = ((cobrosRes.data ?? []) as Array<{ monto: number }>)
    .reduce((sum, c) => sum + (c.monto ?? 0), 0)
  const saldo = precio - totalCobrado
  const shouldBeComplete = precio > 0 && saldo <= 0

  // Buscar todas las instancias de bloques cobros del negocio
  const { data: bloquesRaw } = await db(supabase)
    .from('negocio_bloques')
    .select(`
      id,
      estado,
      bloque_configs!inner(
        bloque_definitions!inner(tipo)
      )
    `)
    .eq('negocio_id', negocioId)

  type BloqueRow = {
    id: string
    estado: string
    bloque_configs: { bloque_definitions: { tipo: string } | null } | null
  }
  const bloquesCobros = ((bloquesRaw ?? []) as BloqueRow[])
    .filter(b => b.bloque_configs?.bloque_definitions?.tipo === 'cobros')

  if (bloquesCobros.length === 0) return { error: null }

  const now = new Date().toISOString()
  const toComplete = bloquesCobros.filter(b => shouldBeComplete && b.estado !== 'completo').map(b => b.id)
  const toPending = bloquesCobros.filter(b => !shouldBeComplete && b.estado === 'completo').map(b => b.id)

  if (toComplete.length > 0) {
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'completo', completado_at: now, updated_at: now })
      .in('id', toComplete)
  }
  if (toPending.length > 0) {
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'pendiente', completado_at: null, updated_at: now })
      .in('id', toPending)
  }

  return { error: null }
}

// ── Re-evaluar completitud de bloque cronograma ─────────────────────────────

export async function reevaluarBloqueCronograma(
  negocioBloqueId: string,
  requireAllDates: boolean
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  // Leer items actuales
  const { data: itemsData } = await db(supabase)
    .from('bloque_items')
    .select('id, fecha_inicio, fecha_fin')
    .eq('negocio_bloque_id', negocioBloqueId)

  const items = (itemsData ?? []) as { id: string; fecha_inicio: string | null; fecha_fin: string | null }[]

  let shouldBeComplete = false
  if (items.length > 0) {
    if (requireAllDates) {
      shouldBeComplete = items.every(i => i.fecha_inicio && i.fecha_fin)
    } else {
      shouldBeComplete = true // al menos 1 item existe
    }
  }

  // Leer estado actual del bloque
  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select('estado')
    .eq('id', negocioBloqueId)
    .single()

  const estadoActual = (bloque as { estado: string } | null)?.estado

  if (shouldBeComplete && estadoActual !== 'completo') {
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'completo', completado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', negocioBloqueId)
  } else if (!shouldBeComplete && estadoActual === 'completo') {
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'pendiente', completado_at: null, updated_at: new Date().toISOString() })
      .eq('id', negocioBloqueId)
  }

  return { error: null }
}

// ── Confirmar pago de cobro ───────────────────────────────────────────────────

export async function confirmarPagoCobro(
  cobroId: string,
  referencia?: string,
  valorParcial?: number
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Obtener datos del cobro antes de actualizar (para el log)
  const { data: cobroAntes } = await db(supabase)
    .from('cobros')
    .select('notas, monto, negocio_id')
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)
    .single()

  const payload: Record<string, unknown> = {
    revisado: true,
    revisado_at: new Date().toISOString(),
    notas: referencia ? `Ref: ${referencia}` : undefined,
  }
  if (valorParcial) payload.monto = valorParcial

  const { error: updateError } = await supabase
    .from('cobros')
    .update(payload)
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)

  if (updateError) return { error: (updateError as { message: string }).message }

  // Registrar en activity_log
  if (staffId && cobroAntes) {
    const cobro = cobroAntes as { notas: string | null; monto: number; negocio_id: string | null }
    const negocioId = cobro.negocio_id
    if (negocioId) {
      const montoFinal = valorParcial ?? cobro.monto
      await supabase
        .from('activity_log')
        .insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: negocioId,
          tipo: 'cambio',
          autor_id: staffId,
          campo_modificado: 'cobro_confirmado',
          contenido: `Pago confirmado: ${cobro.notas ?? 'Cobro'} por $${montoFinal.toLocaleString('es-CO')}`,
        })

      await reevaluarBloquesCobros(negocioId)
    }
  }

  revalidatePath('/negocios')
  return { error: null }
}

// ── Actualizar precio aprobado del negocio ───────────────────────────────────

export async function actualizarPrecioAprobado(
  negocioId: string,
  precio: number
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Obtener precio anterior para el log
  const { data: negocioAntes } = await db(supabase)
    .from('negocios')
    .select('precio_aprobado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const precioAnterior = (negocioAntes as { precio_aprobado: number | null } | null)?.precio_aprobado

  const { error: updateError } = await db(supabase)
    .from('negocios')
    .update({ precio_aprobado: precio, updated_at: new Date().toISOString() })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updateError) return { error: (updateError as { message: string }).message }

  // Registrar en activity_log
  if (staffId) {
    await supabase
      .from('activity_log')
      .insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio',
        autor_id: staffId,
        campo_modificado: 'precio_aprobado',
        valor_anterior: precioAnterior != null ? String(precioAnterior) : null,
        valor_nuevo: String(precio),
        contenido: `Precio aprobado actualizado a $${precio.toLocaleString('es-CO')}`,
      })
  }

  await reevaluarBloquesCobros(negocioId)
  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// ── Comentarios del negocio ───────────────────────────────────────────────────
//
// `agregarComentarioNegocio` se eliminó el 2026-07-27: era código muerto (cero
// callers) y además insertaba en activity_log SIN `mencion_id`, por lo que el
// trigger `trg_notif_mencion` nunca disparaba desde ese camino. Dejarlo vivo era
// una trampa: el día que alguien lo usara, las menciones dejarían de notificar.
//
// Vía única para comentar: `addComment` (src/app/(app)/activity-actions.ts).
// Acepta `mencionId` y el trigger de DB crea la notificación.

// ── Actualizar aprobación de bloque ──────────────────────────────────────────

export async function actualizarAprobacion(
  negocioBloqueId: string,
  data: {
    aprobador_id?: string
    estado?: 'pendiente' | 'aprobado' | 'rechazado'
    comentario?: string
    aprobado_at?: string
  }
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const isComplete = data.estado === 'aprobado'

  const payload: Record<string, unknown> = {
    data,
    updated_at: new Date().toISOString(),
  }
  if (isComplete) {
    payload.estado = 'completo'
    payload.completado_at = new Date().toISOString()
  }

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update(payload)
    .eq('id', negocioBloqueId)

  if (updateError) return { error: (updateError as { message: string }).message }

  const { data: bloqueInfo } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id')
    .eq('id', negocioBloqueId)
    .single()

  const negocioId = (bloqueInfo as { negocio_id: string } | null)?.negocio_id

  if (staffId && workspaceId && negocioId) {
    const estadoLabel = data.estado ?? 'pendiente'
    const contenido = data.comentario
      ? `Aprobación: ${estadoLabel}. ${data.comentario}`
      : `Aprobación: ${estadoLabel}`
    await supabase
      .from('activity_log')
      .insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio',
        autor_id: staffId,
        campo_modificado: 'aprobacion',
        valor_nuevo: estadoLabel,
        contenido,
      })
  }

  if (negocioId) revalidatePath(`/negocios/${negocioId}`)

  return { error: null }
}

// ── Cargar datos completos para detalle con bloques ───────────────────────────

export type CotizacionResumen = {
  id: string
  consecutivo: string | null
  modo: string | null
  estado: string | null
  valor_total: number | null
  descripcion: string | null
  created_at: string | null
}

export async function getNegocioDetalleCompleto(id: string): Promise<{
  negocio: NegocioDetalle
  bloques: Array<BloqueConfig & {
    instancia: NegocioBloque | null
    config_extra: Record<string, unknown>
    items: Array<{
      id: string
      label: string
      tipo: string
      completado: boolean
      completado_por: string | null
      completado_at: string | null
      link_url: string | null
      imagen_data: string | null
      orden: number
    }>
  }>
  etapasLinea: EtapaNegocio[]
  datosOtrasEtapas: Record<number, Record<string, unknown>>
  datosPorSlug: Record<string, Record<string, unknown>>
  bloquesEtapasPrevias: Array<{
    etapa_orden: number
    etapa_nombre: string
    block_id: string | null
    id: string
    etapa_id: string
    workspace_id: string
    bloque_definition_id: string
    estado: string
    orden: number
    es_gate: boolean
    nombre: string | null
    bloque_definitions: {
      id: string
      tipo: string
      nombre: string
      is_visualization: boolean
      can_be_gate: boolean
    } | null
    instancia: {
      id: string
      negocio_id: string
      bloque_config_id: string
      estado: string
      data: Record<string, unknown> | null
    } | null
    config_extra: Record<string, unknown>
    items: Array<{
      id: string
      label: string
      tipo: string
      completado: boolean
      completado_por: string | null
      completado_at: string | null
      link_url: string | null
      imagen_data: string | null
      orden: number
    }>
  }>
  profiles: Array<{ id: string; full_name: string | null; email: string | null }>
  currentUserId: string | null
  userRole: string
  cobros: Array<{
    id: string
    concepto: string | null
    monto: number
    revisado: boolean
    tipo_cobro: string | null
    fecha: string | null
    fecha_esperada: string | null
    numero_cuota: number | null
    vencido: boolean
    notas: string | null
    external_ref: string | null
    /** true si es una porción de un reparto propuesto por el comercial (split_json.origen==='comercial'). */
    es_reparto_comercial: boolean
  }>
  cotizacion: null
  cotizacionesNegocio: CotizacionResumen[]
  resumenFinanciero: {
    totalCobrado: number
    porCobrar: number
    costosEjecutados: number
    precioAprobado?: number
  }
  ejecucionData: {
    totalGastos: number
    totalHoras: number
    costoHoras: number
    gastosPorCategoria: Array<{ categoria: string; total: number }>
    presupuestoPorRubro?: Array<{ tipo: string; nombre: string; total: number }>
    precioAprobado?: number
  }
  historialData: {
    gastos: Array<{ id: string; descripcion: string | null; monto: number; categoria: string; fecha: string }>
    horas: Array<{ id: string; descripcion: string | null; horas: number; fecha: string; staff_nombre: string | null }>
    cobros: Array<{ id: string; notas: string | null; monto: number; fecha: string | null; revisado: boolean; tipo_cobro: string | null }>
  }
  actividad: Array<{
    id: string
    tipo: string
    autor_id: string | null
    contenido: string | null
    created_at: string
    autor_nombre: string | null
  }>
  staffList: Array<{ id: string; full_name: string }>
  pausaEnabled: boolean
  /** ¿El usuario actual (por staff.id) es uno de los responsables del negocio? */
  currentUserEsResponsable: boolean
} | null> {
  const { supabase, workspaceId, role, areas, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  // Cargar negocio base
  const base = await getNegocioDetalle(id)
  if (!base) return null

  // Seccional seleccionada en el 010 (negocios.metadata.seccional): la Guía de
  // Devolución la hereda para mostrar los mismos valores que el 010.
  const { data: negMetaRow } = await db(supabase)
    .from('negocios').select('metadata').eq('id', id).maybeSingle()
  const seccional010DelNegocio = (negMetaRow?.metadata as Record<string, unknown> | null)?.seccional as string | undefined

  // ¿El usuario actual es responsable? Comparación por staff.id (no profile.id):
  // negocio_responsables guarda staff.id, igual que staffId de getWorkspace.
  const currentUserEsResponsable = !!staffId && base.negocio.responsables.some((r) => r.id === staffId)

  // ¿Al negocio le falta el honorario confirmado para poder cobrar?
  //
  // Quien FRENA el cobro es el trigger sobre `cobros` (once sitios insertan ahí;
  // el criterio no se replica en cada uno). Esto es lo otro que hace falta: si el
  // caso ya avanzó sin propuesta aprobada, el bloque nativo de la propuesta vive
  // en una etapa anterior y desde el historial sale forzado a solo lectura — o
  // sea que el guard lo dejaría sin ningún lugar desde donde poner el valor que
  // se le exige. Medido el 2026-08-13: 5 casos abiertos de SOENA ya están en Cita
  // (etapa 13) sin precio, y la ventana de la propuesta termina en la etapa de
  // orden 5. Es el mismo error de `revertir_hasta_etapa_orden` que este archivo
  // ya documenta: la acción quedó inalcanzable justo en el escenario que la pidió.
  let faltaHonorario = false
  if (base.negocio.linea_id) {
    const [lineaCobroRes, wsCobroRes] = await Promise.all([
      db(supabase).from('lineas_negocio').select('config_extra').eq('id', base.negocio.linea_id).maybeSingle(),
      db(supabase).from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle(),
    ])
    // Un honorario en cero puede ser una DECISION (propuesta aprobada regalando
    // el servicio) y no un dato que falta. El criterio no se reimplementa acá:
    // lo resuelve `esCeroDeliberado`, que es donde ya vive y que consumen el
    // gate de handoff y el reparto. Solo se consulta cuando el precio es cero,
    // que es el único caso en que puede cambiar la respuesta: así el detalle no
    // paga una consulta más en los negocios que sí tienen honorario.
    let ceroDeliberado = false
    if ((base.negocio.precio_aprobado ?? 0) <= 0) {
      const { data: propRows } = await db(supabase)
        .from('negocio_bloques')
        .select('data, bloque_configs!inner(bloque_definitions!inner(tipo))')
        .eq('negocio_id', id)
        .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica')
      ceroDeliberado = esCeroDeliberado(
        (propRows ?? []) as Array<{ data: Record<string, unknown> | null }>,
        base.negocio.precio_aprobado,
      )
    }
    faltaHonorario = faltaHonorarioConfirmado({
      precioAprobado: base.negocio.precio_aprobado,
      estado: base.negocio.estado,
      configLinea: (lineaCobroRes.data as { config_extra?: { cobro?: ConfigCobro } } | null)?.config_extra?.cobro ?? null,
      configWorkspace: (wsCobroRes.data as { config_extra?: { cobro?: ConfigCobro } } | null)?.config_extra?.cobro ?? null,
      ceroDeliberado,
    })
  }

  // Visibilidad: operator solo accede al detalle de negocios donde es responsable
  // (espejo del filtro de la lista; cierra el acceso por URL a negocios ajenos).
  if (role === 'operator') {
    const { data: resp } = await db(supabase)
      .from('negocio_responsables')
      .select('staff_id')
      .eq('negocio_id', id)
    const ids = ((resp ?? []) as { staff_id: string }[]).map((r) => r.staff_id)
    if (!staffId || !ids.includes(staffId)) return null
  }

  // Feature flag pausa_enabled
  const { data: wsRow } = await db(supabase)
    .from('workspaces')
    .select('modules, config_extra')
    .eq('id', workspaceId)
    .single()
  const wsModules = (wsRow as { modules: Record<string, unknown> | null } | null)?.modules ?? {}
  const pausaEnabled = wsModules.pausa_enabled === true

  // ¿Este usuario puede corregir el valor aprobado? Capacidad declarada por
  // persona (`config_extra.correccion_precio.staff_ids`), no heredada del rol.
  // Fail-closed: sin lista, solo el owner. Espejo exacto del guard de
  // `corregirValorAprobado`, que es la barrera real.
  const staffIdsPrecio = (((wsRow as { config_extra?: { correccion_precio?: { staff_ids?: unknown } } } | null)
    ?.config_extra?.correccion_precio?.staff_ids ?? []) as string[])
  const puedeCorregirPrecioWs = role === 'owner' || (!!staffId && staffIdsPrecio.includes(staffId))

  // Cargar config_extra de los bloque_configs
  const bloqueConfigIds = base.bloques.map(b => b.id)
  const bloqueConfigsExtra: Record<string, Record<string, unknown>> = {}
  if (bloqueConfigIds.length > 0) {
    const { data: extras } = await db(supabase)
      .from('bloque_configs')
      .select('id, config_extra')
      .in('id', bloqueConfigIds)
    if (extras) {
      for (const e of extras as Record<string, unknown>[]) {
        bloqueConfigsExtra[e.id as string] = (e.config_extra ?? {}) as Record<string, unknown>
      }
    }
  }

  // Cargar bloque_items de todos los negocio_bloques
  const negocioBloqueIds = base.bloques.map(b => b.instancia?.id).filter(Boolean) as string[]
  const itemsByBloqueId: Record<string, unknown[]> = {}
  if (negocioBloqueIds.length > 0) {
    const { data: itemsData } = await db(supabase)
      .from('bloque_items')
      .select('id, negocio_bloque_id, label, tipo, completado, completado_por, completado_at, link_url, imagen_data, orden, fecha_inicio, fecha_fin, responsable_id')
      .in('negocio_bloque_id', negocioBloqueIds)
      .order('orden', { ascending: true })
    if (itemsData) {
      for (const item of itemsData as Record<string, unknown>[]) {
        const bid = item.negocio_bloque_id as string
        if (!itemsByBloqueId[bid]) itemsByBloqueId[bid] = []
        itemsByBloqueId[bid].push(item)
      }
    }
  }

  // Cargar profiles + staff del workspace + currentUserId
  const [profilesRes, userRes, staffRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('workspace_id', workspaceId)
      .order('full_name', { ascending: true }),
    supabase.auth.getUser(),
    supabase
      .from('staff')
      .select('id, full_name, salary')
      .eq('workspace_id', workspaceId),
  ])
  const profilesData = profilesRes.data
  const currentUserId = userRes.data.user?.id ?? null

  // staffMap: staff.id → nombre (activity_log.autor_id referencia staff.id)
  const staffMap: Record<string, string> = {}
  for (const s of ((staffRes.data ?? []) as { id: string; full_name: string }[])) {
    staffMap[s.id] = s.full_name ?? s.id.slice(-6)
  }

  // Cargar cobros del negocio (db() para evitar type errors en columnas nuevas)
  const { data: cobrosData } = await db(supabase)
    .from('cobros')
    .select('id, notas, monto, revisado, tipo_cobro, fecha, fecha_esperada, numero_cuota, vencido, external_ref, split_json')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', id)
    .order('created_at', { ascending: true })

  // Cargar gastos del negocio para costosEjecutados + historial
  //
  // Honra centro_costos (decisión Santiago + centro-costos sprint 2026-05-30):
  //   - Gastos con centro_costos='directa_negocio' AND negocio_id=id → SI
  //   - Gastos legacy (centro_costos IS NULL) con negocio_id=id → SI (compat)
  //   - Gastos centro_costos='mixta' con split parcial a este negocio → SI con prorrateo
  //   - Gastos con centro_costos='distribuible_one' o 'distribuible_clarity' → NO
  //
  // Implementación: 2 queries y merge en memoria. Más simple que un OR complejo
  // en PostgREST sobre jsonb.

  const [gastosDirectosRes, gastosMixtaRes] = await Promise.all([
    db(supabase)
      .from('gastos')
      .select('id, descripcion, monto, categoria, fecha, centro_costos, split_json')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', id)
      // Filtrar: directa_negocio o legacy (centro_costos null)
      .or('centro_costos.eq.directa_negocio,centro_costos.is.null')
      .order('fecha', { ascending: false }),
    db(supabase)
      .from('gastos')
      .select('id, descripcion, monto, categoria, fecha, centro_costos, split_json')
      .eq('workspace_id', workspaceId)
      .eq('centro_costos', 'mixta')
      .not('split_json', 'is', null),
  ])

  // Filtrar mixta que tengan split a este negocio específico
  const splitKey = `negocio:${id}`
  type GastoRow = {
    id: string
    descripcion: string | null
    monto: number
    categoria: string
    fecha: string
    centro_costos: string | null
    split_json: Record<string, number> | null
  }

  const gastosMixtaParcial = ((gastosMixtaRes.data ?? []) as GastoRow[])
    .filter((g) => {
      if (!g.split_json) return false
      const pct = Number(g.split_json[splitKey] ?? 0)
      return pct > 0
    })
    .map((g) => {
      const pct = Number(g.split_json?.[splitKey] ?? 0)
      return {
        ...g,
        // Prorratear monto al porcentaje del split que toca a este negocio
        monto: Math.round((g.monto ?? 0) * pct),
        // Marcar la descripción con el badge de % para que la UI lo distinga
        descripcion: g.descripcion
          ? `${g.descripcion} (${Math.round(pct * 100)}% del gasto)`
          : `Gasto mixto (${Math.round(pct * 100)}% del gasto)`,
      }
    })

  // Merge: gastos directos + mixta prorrateados, orden descendente por fecha
  const gastosData = [
    ...((gastosDirectosRes.data ?? []) as GastoRow[]),
    ...gastosMixtaParcial,
  ].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))

  // Cargar horas del negocio

  const { data: horasData } = await db(supabase)
    .from('horas')
    .select('id, horas, descripcion, fecha, staff_id')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', id)
    .order('fecha', { ascending: false })

  // Cotización ahora vive en negocio_bloques.data del bloque cotizacion (sin tabla separada)
  const cotizacion = null

  // Cargar cotizaciones del sistema de cotizaciones (tabla cotizaciones con negocio_id)
  const cotizacionesRes = await supabase
    .from('cotizaciones')
    .select('id, consecutivo, modo, estado, valor_total, descripcion, created_at')
    .eq('negocio_id' as never, id)
    .order('created_at', { ascending: false })
  const cotizacionesNegocio: CotizacionResumen[] = ((cotizacionesRes.data ?? []) as Record<string, unknown>[]).map(c => ({
    id: c.id as string,
    consecutivo: c.consecutivo as string | null,
    modo: c.modo as string | null,
    estado: c.estado as string | null,
    valor_total: c.valor_total as number | null,
    descripcion: c.descripcion as string | null,
    created_at: c.created_at as string | null,
  }))

  // Buscar cotización aceptada y sus rubros para presupuesto
  const cotizacionAceptada = cotizacionesNegocio.find(c => c.estado === 'aceptada')
  let presupuestoPorRubro: { tipo: string; nombre: string; total: number }[] = []
  let precioAprobado: number | undefined = undefined

  if (cotizacionAceptada) {
    precioAprobado = cotizacionAceptada.valor_total ?? undefined
    // Cargar items con rubros de la cotizacion aceptada
    const { data: itemsConRubros } = await supabase
      .from('items')
      .select('nombre, subtotal, rubros(tipo, valor_total)')
      .eq('cotizacion_id', cotizacionAceptada.id)
      .order('orden')

    if (itemsConRubros && itemsConRubros.length > 0) {
      // Agrupar rubros por tipo y sumar valores
      const rubroMap: Record<string, { nombre: string; total: number }> = {}
      for (const item of itemsConRubros) {
        const rubros = (item.rubros ?? []) as Array<{ tipo: string; valor_total: number | null }>
        if (rubros.length > 0) {
          for (const r of rubros) {
            const tipo = r.tipo ?? 'otro'
            if (!rubroMap[tipo]) rubroMap[tipo] = { nombre: tipo, total: 0 }
            rubroMap[tipo].total += r.valor_total ?? 0
          }
        } else {
          // Item sin rubros detallados: usar subtotal como "otro"
          const tipo = 'otro'
          if (!rubroMap[tipo]) rubroMap[tipo] = { nombre: tipo, total: 0 }
          rubroMap[tipo].total += item.subtotal ?? 0
        }
      }
      presupuestoPorRubro = Object.entries(rubroMap)
        .map(([tipo, data]) => ({ tipo, nombre: data.nombre, total: data.total }))
        .filter(r => r.total > 0)
        .sort((a, b) => b.total - a.total)
    } else if (cotizacionAceptada.valor_total && cotizacionAceptada.valor_total > 0) {
      // Cotización rápida sin items: un solo rubro genérico
      presupuestoPorRubro = [{ tipo: 'total', nombre: 'Total cotizado', total: cotizacionAceptada.valor_total }]
    }
  }

  // Cargar actividad del negocio
  const { data: actividadData } = await supabase
    .from('activity_log')
    .select('id, tipo, autor_id, contenido, created_at')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', 'negocio')
    .eq('entidad_id', id)
    .order('created_at', { ascending: false })
    .limit(50)

  const actividad = ((actividadData ?? []) as Record<string, unknown>[]).map(a => ({
    id: a.id as string,
    tipo: a.tipo as string,
    autor_id: a.autor_id as string | null,
    contenido: a.contenido as string | null,
    created_at: a.created_at as string,
    // autor_id referencia staff.id (no profiles.id)
    autor_nombre: a.autor_id ? (staffMap[a.autor_id as string] ?? null) : null,
  }))

  // Calcular resumen financiero
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cobrosList = ((cobrosData ?? []) as any[]) as Array<{
    monto: number
    revisado: boolean
  }>
  // 2026-04-28: cobros registrados = dinero entrado. revisado es flag para
  // contador (bandeja /revision), no afecta cálculos operativos.
  const totalCobrado = cobrosList.reduce((sum, c) => sum + (c.monto ?? 0), 0)

  // ── Cross-etapa data for conditions + auto_fill ────────────────────────────
  // Se recolectan LAS DOS formas de declarar el bloque fuente (orden de etapa y
  // slug estable). Recolectar solo la primera dejaba sin resolver a quien
  // declaraba únicamente el slug: ver `referencias-fuente.ts`.
  const { etapaOrdens: sourceEtapaOrdens, bloqueSlugs: sourceBloqueSlugs } =
    recolectarReferenciasFuente(Object.keys(bloqueConfigsExtra).map(bcId => bloqueConfigsExtra[bcId]))

  // Si hay un bloque tipo guia_devolucion en la etapa actual, su preview depende
  // de RUT, Factura y Fecha cita DIAN. Se resuelven por IDENTIDAD DE BLOQUE
  // (nombre), no por orden de etapa — robusto a reordenamientos. Mapa nombre→data
  // (campos AI aplanados), ignorando heredados readonly (sin campos propios).
  const tieneGuia = base.bloques.some(b =>
    (b as { bloque_definitions?: { tipo?: string } | null }).bloque_definitions?.tipo === 'guia_devolucion'
  )
  const datosGuiaPorNombre: Record<string, Record<string, unknown>> = {}
  // Índice por slug ESTABLE del bloque (vía preferida; robusto a renames, a
  // diferencia de datosGuiaPorNombre que se rompió cuando "Factura de venta" pasó
  // a "Factura Venta Vehículo"). Ver docs/specs/2026-05-26_block-references-by-slug.md
  const datosGuiaPorSlug: Record<string, Record<string, unknown>> = {}
  if (tieneGuia) {
    const { data: bloquesGuia } = await db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(nombre, slug, config_extra)')
      .eq('negocio_id', id)
    for (const b of ((bloquesGuia ?? []) as Record<string, unknown>[])) {
      const cfg = b.bloque_configs as { nombre?: string; slug?: string | null; config_extra?: Record<string, unknown> | null }
      if ((cfg?.config_extra as { source_etapa_orden?: unknown } | null)?.source_etapa_orden !== undefined) continue
      const nombre = (cfg?.nombre ?? '').toLowerCase().trim()
      if (!nombre) continue
      const data = (b.data ?? {}) as Record<string, unknown>
      const flat: Record<string, unknown> = { ...data }
      const campos = data.campos as Record<string, { value?: unknown }> | undefined
      if (campos) {
        for (const [slug, c] of Object.entries(campos)) {
          if (c?.value !== null && c?.value !== undefined) flat[slug] = c.value
        }
      }
      datosGuiaPorNombre[nombre] = flat
      if (cfg?.slug) datosGuiaPorSlug[cfg.slug] = flat
    }
  }

  // Tambien recolectar source_etapa_orden de bloques de etapas previas: cuando
  // el negocio avanza de etapa, el historial necesita resolver auto_fill de
  // bloques de etapas previas (ej. DA6/DA7 en E6 con auto_fill desde E2/E5).
  // Sin esto, datosOtrasEtapas queda vacio para los rangos que el historial
  // necesita y los bloques readonly quedan filtrados del historial.
  if (base.negocio.linea_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: allConfigs } = await (db(supabase) as any)
      .from('bloque_configs')
      .select('config_extra, etapas_negocio!inner(linea_id, orden)')
      .eq('etapas_negocio.linea_id', base.negocio.linea_id)
    for (const c of ((allConfigs ?? []) as Record<string, unknown>[])) {
      const ce = c.config_extra as { fields?: Array<{ auto_fill?: { source_etapa_orden?: number } }> } | null
      const fields = ce?.fields ?? []
      for (const f of fields) {
        if (f.auto_fill?.source_etapa_orden !== undefined) {
          sourceEtapaOrdens.add(f.auto_fill.source_etapa_orden)
        }
      }
    }
  }

  const datosOtrasEtapas: Record<number, Record<string, unknown>> = {}
  // Variante indexada por (etapa_orden → nombre de bloque normalizado) para
  // auto_fill con `source_bloque`: permite distinguir dos bloques del mismo tipo
  // en una misma etapa (ej. "RUT" y "RUT solicitante 2" de 2 solicitantes), que el
  // bag aplanado `datosOtrasEtapas` mezclaría por nombre de campo.
  const datosPorEtapaBloque: Record<number, Record<string, Record<string, unknown>>> = {}
  // Índice por slug ESTABLE (vía preferida de auto_fill.source_bloque_slug). El
  // slug es único por línea, así que no necesita partición por etapa.
  const datosPorSlug: Record<string, Record<string, unknown>> = {}
  if (sourceEtapaOrdens.size > 0 && base.negocio.linea_id) {
    const { data: etapasSource } = await db(supabase)
      .from('etapas_negocio')
      .select('id, orden')
      .eq('linea_id', base.negocio.linea_id)
      .in('orden', [...sourceEtapaOrdens])
    if (etapasSource) {
      const etapaIdToOrden = new Map<string, number>()
      const etapaIds = (etapasSource as Array<{ id: string; orden: number }>).map(e => {
        etapaIdToOrden.set(e.id, e.orden)
        return e.id
      })
      const { data: bloquesOtras } = await db(supabase)
        .from('negocio_bloques')
        .select('data, bloque_configs!inner(etapa_id, nombre, slug, bloque_definitions!inner(tipo, nombre))')
        .eq('negocio_id', id)
        .in('bloque_configs.etapa_id', etapaIds)
      for (const b of ((bloquesOtras ?? []) as Record<string, unknown>[])) {
        const config = b.bloque_configs as Record<string, unknown>
        const etapaId = config.etapa_id as string
        const orden = etapaIdToOrden.get(etapaId)
        if (orden === undefined) continue
        if (!datosOtrasEtapas[orden]) datosOtrasEtapas[orden] = {}
        const data = b.data as Record<string, unknown> | null
        // Bag por bloque (clave: nombre normalizado) para resolver source_bloque.
        const defNombre = (config.bloque_definitions as { nombre?: string } | undefined)?.nombre ?? ''
        const bloqueNombre = ((config.nombre as string | null) ?? defNombre).trim().toLowerCase()
        const bloqueSlug = (config.slug as string | null) ?? null
        const perBloque: Record<string, unknown> = {}
        if (data) {
          Object.assign(datosOtrasEtapas[orden], data)
          Object.assign(perBloque, data)
          // Flatten AI-extracted campos into top-level for condition/auto_fill lookup
          const campos = data.campos as Record<string, { value: string | null }> | undefined
          if (campos) {
            for (const [slug, campo] of Object.entries(campos)) {
              if (campo?.value !== null && campo?.value !== undefined) {
                datosOtrasEtapas[orden][slug] = campo.value
                perBloque[slug] = campo.value
              }
            }
          }
        }
        if (bloqueNombre) {
          if (!datosPorEtapaBloque[orden]) datosPorEtapaBloque[orden] = {}
          datosPorEtapaBloque[orden][bloqueNombre] = perBloque
        }
        if (bloqueSlug) datosPorSlug[bloqueSlug] = perBloque
      }
    }
  }

  // Slugs referenciados que la pasada anterior no alcanzo: su etapa origen no
  // esta declarada por `source_etapa_orden` en ninguna referencia de esta etapa.
  // Se resuelven por slug DENTRO DE LA LINEA, que es lo que hace el gate en SQL
  // (`condicion_cumplida`). Sin esto, render y gate discrepan: el bloque no se
  // pinta y el gate lo sigue exigiendo, dejando el negocio sin nada que hacer.
  const slugsFaltantes = [...sourceBloqueSlugs].filter(s => !datosPorSlug[s])
  if (slugsFaltantes.length > 0 && base.negocio.linea_id) {
    const { data: bloquesPorSlug, error: errorPorSlug } = await db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug, etapas_negocio!inner(linea_id))')
      .eq('negocio_id', id)
      .eq('bloque_configs.etapas_negocio.linea_id', base.negocio.linea_id)
      .in('bloque_configs.slug', slugsFaltantes)
    // El error se sube: tragarselo devuelve lista vacia, indistinguible de "el
    // bloque fuente no existe", y el sintoma seria otra vez una etapa en blanco.
    if (errorPorSlug) throw new Error(`No se pudieron resolver los bloques fuente: ${errorPorSlug.message}`)
    for (const b of ((bloquesPorSlug ?? []) as Record<string, unknown>[])) {
      const slug = (b.bloque_configs as { slug?: string | null } | null)?.slug
      if (!slug) continue
      datosPorSlug[slug] = aplanarDataBloque(b.data as Record<string, unknown> | null)
    }
  }

  // ── Cargar data de bloques propuesta_economica del negocio (para herencia readonly)
  // Indexado por etapa_orden — usado mas abajo para que bloques readonly heredados
  // en etapas posteriores muestren el data (versiones, descuento, valor) del bloque
  // origen.
  const propuestaDataPorEtapa: Record<number, Record<string, unknown>> = {}
  // Índice por slug estable del bloque origen (vía preferida de la herencia readonly).
  const propuestaDataPorSlug: Record<string, Record<string, unknown>> = {}
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: propuestaBlocks } = await (db(supabase) as any)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(etapa_id, slug, bloque_definitions!inner(tipo), etapas_negocio!inner(orden))')
      .eq('negocio_id', id)
      .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica')
    if (propuestaBlocks) {
      for (const pb of (propuestaBlocks as Record<string, unknown>[])) {
        const cfg = pb.bloque_configs as Record<string, unknown>
        const etapa = cfg.etapas_negocio as { orden: number } | undefined
        const slug = cfg.slug as string | null
        if (etapa && pb.data) {
          propuestaDataPorEtapa[etapa.orden] = pb.data as Record<string, unknown>
        }
        if (slug && pb.data) propuestaDataPorSlug[slug] = pb.data as Record<string, unknown>
      }
    }
  }

  // ── Cargar data de bloques documento del negocio (para herencia readonly)
  // Indexado por (etapa_orden + nombre normalizado) porque hay multiples documentos
  // por etapa (Factura, RUT, Cedula, Comprobante, etc.) y el matching para herencia
  // se hace por (etapa source, nombre, tipo) en otros sitios. Cuando un bloque tipo
  // 'documento' tiene source_etapa_orden en su config_extra, leemos drive_url +
  // file_name + campos extraidos del bloque origen.
  const documentoDataPorEtapaNombre = new Map<string, Record<string, unknown>>()
  // Índice por slug estable del bloque documento origen (vía preferida).
  const documentoDataPorSlug = new Map<string, Record<string, unknown>>()
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: docBlocks } = await (db(supabase) as any)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(nombre, slug, etapa_id, bloque_definitions!inner(tipo, nombre), etapas_negocio!inner(orden))')
      .eq('negocio_id', id)
      .eq('bloque_configs.bloque_definitions.tipo', 'documento')
    if (docBlocks) {
      for (const db_ of (docBlocks as Record<string, unknown>[])) {
        const cfg = db_.bloque_configs as Record<string, unknown>
        const etapa = cfg.etapas_negocio as { orden: number } | undefined
        if (!etapa || !db_.data) continue
        const defNombre = (cfg.bloque_definitions as { nombre?: string } | undefined)?.nombre ?? ''
        const cfgNombre = (cfg.nombre as string | null) ?? defNombre
        const key = `${etapa.orden}::${cfgNombre.trim().toLowerCase()}`
        documentoDataPorEtapaNombre.set(key, db_.data as Record<string, unknown>)
        const slug = cfg.slug as string | null
        if (slug) documentoDataPorSlug.set(slug, db_.data as Record<string, unknown>)
      }
    }
  }

  // ── Bloque compartido entre etapas (config_extra.compartido_con_origen) ──────────
  // Un bloque `datos` que aparece en dos etapas porque el mismo dato se captura en dos
  // momentos y por dos areas distintas. Caso canonico (SOENA): la fecha de la cita DIAN
  // la registra operaciones en Cita cuando consigue agendamiento, o el comercial en
  // Notificacion cuando la cita salio por PQR y el cliente le reporta la fecha.
  //
  // Sin esto son dos bloques con dos filas: se pueden escribir dos fechas distintas y
  // nadie las concilia, y quien lea el dato (el cross-check de vigencia del certificado
  // bancario) solo mira una de las dos. La herencia normal no sirve porque los bloques
  // `datos` heredados COPIAN el dato en su propia fila; aqui hace falta compartirlo.
  const datosCompartidosPorSlug = new Map<string, Record<string, unknown>>()
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: datosBlocks } = await (db(supabase) as any)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(slug, bloque_definitions!inner(tipo))')
      .eq('negocio_id', id)
      .eq('bloque_configs.bloque_definitions.tipo', 'datos')
    for (const row of ((datosBlocks ?? []) as Record<string, unknown>[])) {
      const cfg = row.bloque_configs as Record<string, unknown>
      const slug = cfg.slug as string | null
      if (slug && row.data) datosCompartidosPorSlug.set(slug, row.data as Record<string, unknown>)
    }
  }

  // ── Historial: bloques con data de etapas previas (con orden < etapa actual)
  // Estructura completa para que el cliente los renderice con BloqueRenderer
  // en modo 'visible' (read-only nativo de cada tipo).
  type BloqueHistorialFull = {
    // BloqueConfig fields
    id: string
    etapa_id: string
    workspace_id: string
    bloque_definition_id: string
    estado: string
    orden: number
    es_gate: boolean
    nombre: string | null
    bloque_definitions: {
      id: string
      tipo: string
      nombre: string
      is_visualization: boolean
      can_be_gate: boolean
    } | null
    // Custom enrichments
    instancia: {
      id: string
      negocio_id: string
      bloque_config_id: string
      estado: string
      data: Record<string, unknown> | null
    } | null
    config_extra: Record<string, unknown>
    items: Array<{
      id: string
      label: string
      tipo: string
      completado: boolean
      completado_por: string | null
      completado_at: string | null
      link_url: string | null
      imagen_data: string | null
      orden: number
    }>
  }
  type BloqueHistorialPlano = BloqueHistorialFull & {
    etapa_orden: number
    etapa_nombre: string
    block_id: string | null
    slug?: string | null
  }
  const bloquesEtapasPrevias: BloqueHistorialPlano[] = []
  {
    const etapaActualOrden = base.etapasLinea.find(
      e => e.id === base.negocio.etapa_actual_id,
    )?.orden ?? 0
    const etapasPrevias = base.etapasLinea
      .filter(e => e.orden < etapaActualOrden)
      .sort((a, b) => a.orden - b.orden) // orden de aparicion en el flujo
    if (etapasPrevias.length > 0) {
      const etapaIdsPrevias = etapasPrevias.map(e => e.id)
      // Cargar bloque_configs + bloque_definitions de etapas previas
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: prevConfigs } = await (db(supabase) as any)
        .from('bloque_configs')
        .select(`
          id, etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, slug,
          bloque_definitions(id, tipo, nombre, is_visualization, can_be_gate)
        `)
        .in('etapa_id', etapaIdsPrevias)
        .eq('workspace_id', workspaceId)
        .order('orden', { ascending: true })
      // Cargar instancias del negocio para esos bloque_configs
      const configIds = (prevConfigs as Record<string, unknown>[] | null)?.map(c => c.id as string) ?? []
      const instanciasMap = new Map<string, {
        id: string; negocio_id: string; bloque_config_id: string; estado: string; data: Record<string, unknown> | null
      }>()
      if (configIds.length > 0) {
        const { data: prevInsts } = await db(supabase)
          .from('negocio_bloques')
          .select('id, negocio_id, bloque_config_id, estado, data')
          .eq('negocio_id', id)
          .in('bloque_config_id', configIds)
        for (const inst of ((prevInsts ?? []) as Record<string, unknown>[])) {
          instanciasMap.set(inst.bloque_config_id as string, {
            id: inst.id as string,
            negocio_id: inst.negocio_id as string,
            bloque_config_id: inst.bloque_config_id as string,
            estado: (inst.estado as string) ?? 'pendiente',
            data: inst.data as Record<string, unknown> | null,
          })
        }
      }
      // Cargar config_extra desde bloqueConfigsExtra ya construido arriba o consultar
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: prevConfigsExtra } = await (db(supabase) as any)
        .from('bloque_configs')
        .select('id, config_extra')
        .in('id', configIds.length > 0 ? configIds : ['00000000-0000-0000-0000-000000000000'])
      const ceMap = new Map<string, Record<string, unknown>>()
      for (const row of ((prevConfigsExtra ?? []) as Record<string, unknown>[])) {
        ceMap.set(row.id as string, (row.config_extra as Record<string, unknown>) ?? {})
      }
      // Cargar bloque_items (cronograma, checklist, etc.)
      const instIds = Array.from(instanciasMap.values()).map(i => i.id)
      const itemsByInst = new Map<string, Array<{
        id: string; label: string; tipo: string; completado: boolean
        completado_por: string | null; completado_at: string | null
        link_url: string | null; imagen_data: string | null; orden: number
      }>>()
      if (instIds.length > 0) {
        // La columna es `negocio_bloque_id`. Decia `bloque_instancia_id`, que existe pero en
        // OTRA tabla (`bloque_locks`), asi que PostgREST devolvia 400 y, como el error no se
        // captura, `prevItems` quedaba vacio: el historial de etapas anteriores mostraba los
        // cronogramas y checklists SIN items, sin avisar. Medido: ~100 errores en 3 horas.
        const { data: prevItems, error: prevItemsError } = await db(supabase)
          .from('bloque_items')
          .select('id, negocio_bloque_id, label, tipo, completado, completado_por, completado_at, link_url, imagen_data, orden')
          .in('negocio_bloque_id', instIds)
          .order('orden', { ascending: true })
        // Sin esto un fallo de esta consulta vuelve a ser mudo.
        if (prevItemsError) {
          console.error('[getNegocioDetalleCompleto] bloque_items de etapas previas:', prevItemsError)
        }
        for (const it of ((prevItems ?? []) as Record<string, unknown>[])) {
          const bid = it.negocio_bloque_id as string
          if (!itemsByInst.has(bid)) itemsByInst.set(bid, [])
          itemsByInst.get(bid)!.push({
            id: it.id as string,
            label: it.label as string,
            tipo: it.tipo as string,
            completado: (it.completado as boolean) ?? false,
            completado_por: (it.completado_por as string | null) ?? null,
            completado_at: (it.completado_at as string | null) ?? null,
            link_url: (it.link_url as string | null) ?? null,
            imagen_data: (it.imagen_data as string | null) ?? null,
            orden: (it.orden as number) ?? 0,
          })
        }
      }
      // Ensamblar bloques planos: una fila por bloque-origen, sin duplicar
      // los readonly heredados (cualquier config con source_etapa_orden) ni
      // los tipos de visualizacion agregada (resumen_financiero, ejecucion,
      // historial). El componente HistorialEtapasPrevias los muestra en
      // orden de aparicion (etapa_orden ASC, bloque.orden ASC).
      const etapaInfoById = new Map(etapasPrevias.map(e => [e.id, { orden: e.orden, nombre: e.nombre }]))
      const HIDDEN_TYPES = new Set(['resumen_financiero', 'ejecucion', 'historial', 'historial_valida'])
      for (const cfg of ((prevConfigs ?? []) as Record<string, unknown>[])) {
        const inst = instanciasMap.get(cfg.id as string) ?? null
        if (!inst) continue
        const ce = ceMap.get(cfg.id as string) ?? {}
        // Filtrar readonly heredados: la version origen ya esta en la lista
        if (typeof (ce as { source_etapa_orden?: unknown }).source_etapa_orden === 'number') continue
        const def = cfg.bloque_definitions as BloqueHistorialFull['bloque_definitions']
        if (def && HIDDEN_TYPES.has(def.tipo)) continue
        const etapaInfo = etapaInfoById.get(cfg.etapa_id as string)
        if (!etapaInfo) continue

        // Calcular auto_fill resuelto contra datosOtrasEtapas (para bloques tipo
        // datos con campos derivados de etapas anteriores que nunca persisten
        // data propia — ej. DA6/DA7 en SOENA, readonly desde el config).
        const ceFields = (ce as { fields?: Array<{
          slug: string
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          auto_fill?: { field: string; source: string; mapping?: Record<string, any>; source_etapa_orden: number; source_bloque?: string; source_bloque_slug?: string; computed?: string; computed_anio?: number }
        }> }).fields ?? []
        const autoFillHist: Record<string, unknown> = {}
        for (const f of ceFields) {
          if (!f.auto_fill) continue
          // Vía preferida: source_bloque_slug (identidad estable). Luego source_bloque
          // por nombre (legacy). Si no hay match, cae al bag aplanado por etapa.
          const srcData =
            (f.auto_fill.source_bloque_slug ? datosPorSlug[f.auto_fill.source_bloque_slug] : undefined)
            ?? (f.auto_fill.source_bloque
              ? datosPorEtapaBloque[f.auto_fill.source_etapa_orden]?.[f.auto_fill.source_bloque.trim().toLowerCase()]
              : undefined)
            ?? datosOtrasEtapas[f.auto_fill.source_etapa_orden]
          if (!srcData) continue
          const rawVal = srcData[f.auto_fill.field]
          if (f.auto_fill.computed) {
            // Referencia calculada (informativa, editable) — ej. tarifa UPME.
            const computed = aplicarComputedAutoFill(f.auto_fill.computed, rawVal, { anio: f.auto_fill.computed_anio, srcData })
            if (computed !== undefined) autoFillHist[f.slug] = computed
          } else if (f.auto_fill.mapping) {
            const srcVal = String(rawVal ?? '').toLowerCase().trim()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            if (srcVal && f.auto_fill.mapping[srcVal] !== undefined) {
              autoFillHist[f.slug] = f.auto_fill.mapping[srcVal]
            }
          } else if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
            autoFillHist[f.slug] = rawVal
          }
        }

        // Excluir solo si todo esta vacio: sin data persistida, sin auto_fill
        // resuelto, y la instancia esta pendiente.
        const dataEmpty = !inst.data || Object.keys(inst.data).length === 0
        const autoFillEmpty = Object.keys(autoFillHist).length === 0
        if (dataEmpty && autoFillEmpty && inst.estado === 'pendiente') continue

        const ceEnriched = autoFillEmpty ? ce : { ...ce, _auto_fill: autoFillHist }

        bloquesEtapasPrevias.push({
          etapa_orden: etapaInfo.orden,
          etapa_nombre: etapaInfo.nombre,
          block_id: base.blockIdByConfigId[cfg.id as string] ?? null,
          id: cfg.id as string,
          etapa_id: cfg.etapa_id as string,
          workspace_id: cfg.workspace_id as string,
          bloque_definition_id: cfg.bloque_definition_id as string,
          estado: (cfg.estado as string) ?? 'editable',
          orden: (cfg.orden as number) ?? 0,
          es_gate: (cfg.es_gate as boolean) ?? false,
          nombre: (cfg.nombre as string | null) ?? null,
          slug: (cfg.slug as string | null) ?? null,
          bloque_definitions: def,
          instancia: inst,
          config_extra: ceEnriched,
          items: itemsByInst.get(inst.id) ?? [],
        })
      }
      bloquesEtapasPrevias.sort((a, b) =>
        a.etapa_orden !== b.etapa_orden ? a.etapa_orden - b.etapa_orden : a.orden - b.orden,
      )
    }
  }

  // ── Build enriched bloques with auto_fill values ──────────────────────────
  // Segmentación por área: si el usuario tiene área(s) asignada(s) y NO cubren el
  // stage de la etapa actual, sus bloques quedan readonly — SALVO los que inviten
  // a su área con `areas_editoras` (se resuelve bloque por bloque más abajo).
  // Sin área → sin restricción (solo se activa donde staff_areas está poblado).
  // owner/admin con área también se restringen (decisión 2026-06-04).
  const stageActualNeg = (base.negocio.stage_actual ?? null) as Stage | null
  const areaDuenaActual = stageActualNeg ? STAGE_TO_AREA[stageActualNeg] : null
  const areasEfectivasUsuario = getAreasEfectivas({
    id: '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  })
  const areaReadonly =
    !!areas && areas.length > 0 && areaDuenaActual !== null
    && !areasEfectivasUsuario.has(areaDuenaActual)

  // Orden de la etapa en la que está el negocio AHORA. Define la ventana de reversión
  // de la propuesta, que no coincide con la etapa donde el bloque vive.
  const ordenEtapaActualNeg = base.etapasLinea.find(
    e => e.id === base.negocio.etapa_actual_id,
  )?.orden ?? null

  // Gates heredados que ya vienen llenos y quedaron de solo lectura: se recogen durante
  // el recorrido y se cierran de una sola vez al terminar (el `map` no admite `await`).
  const gatesHeredadosACerrar: string[] = []

  // UNA marca de tiempo para todo el recorrido: dos documentos del mismo negocio
  // no pueden salir con veredictos distintos por haber cruzado la medianoche
  // entre uno y otro. Bogotá y no UTC (después de las 19:00 el día ya cambió allá).
  const hoyBogotaISO = todayBogotaISO()

  const bloquesConExtra = base.bloques.map(b => {
    const configExtra = bloqueConfigsExtra[b.id] ?? {}

    // Herencia readonly de propuesta_economica: si este bloque es readonly y
    // tiene source_etapa_orden, reemplazar data por la del bloque source (E1)
    // para que el componente renderice el historial de versiones completo.
    const tipoBloque = (b as { _tipo?: string })._tipo
      ?? (bloqueConfigsExtra[b.id] as { _tipo?: string } | undefined)?._tipo
    const isReadonlyPropuesta =
      configExtra.readonly === true
      && typeof configExtra.source_etapa_orden === 'number'
    if (isReadonlyPropuesta && b.instancia) {
      // Vía preferida: slug estable del origen. Fallback legacy: por etapa_orden.
      const srcSlug = configExtra.source_bloque_slug as string | undefined
      const srcData =
        (srcSlug ? propuestaDataPorSlug[srcSlug] : undefined)
        ?? propuestaDataPorEtapa[configExtra.source_etapa_orden as number]
      if (srcData) {
        b = { ...b, instancia: { ...b.instancia, data: srcData } }
      }
    }

    // Herencia readonly de documento: si este bloque es de tipo documento y tiene
    // source_etapa_orden, leer la data del bloque origen (drive_url, file_name,
    // campos extraidos) para que el render readonly tenga acceso al archivo.
    const defTipo = (b as { bloque_definitions?: { tipo?: string } | null }).bloque_definitions?.tipo
    const srcOrden = configExtra.source_etapa_orden as number | undefined
    if (defTipo === 'documento' && typeof srcOrden === 'number' && b.instancia) {
      // Vía preferida: slug estable del origen. Fallback legacy: por (etapa::nombre).
      const srcSlug = configExtra.source_bloque_slug as string | undefined
      const bNombre = (b.nombre ?? (b as { bloque_definitions?: { nombre?: string } | null }).bloque_definitions?.nombre ?? '').trim().toLowerCase()
      const srcData =
        (srcSlug ? documentoDataPorSlug.get(srcSlug) : undefined)
        ?? documentoDataPorEtapaNombre.get(`${srcOrden}::${bNombre}`)
      if (srcData) {
        b = { ...b, instancia: { ...b.instancia, data: srcData } }
      }
    }
    // Bloque compartido: muestra el dato de la instancia origen, no el propio. La
    // escritura la redirige `actualizarBloqueData` a esa misma fila, asi que la copia
    // local nunca se usa y no puede divergir.
    if (configExtra.compartido_con_origen === true && b.instancia) {
      const srcSlug = configExtra.source_bloque_slug as string | undefined
      const srcData = srcSlug ? datosCompartidosPorSlug.get(srcSlug) : undefined
      if (srcData) {
        b = { ...b, instancia: { ...b.instancia, data: srcData } }
      }
    }

    // La VIGENCIA se reevalúa aquí, contra el objetivo de hoy, en vez de leerse
    // del veredicto que quedó guardado el día de la carga. Ese veredicto envejece
    // solo: la cita se reprograma, y con el criterio del margen el objetivo es
    // `hoy + margen`, así que un certificado guardado como vigente lo seguiría
    // pareciendo para siempre. Una pantalla así se ve sana y miente.
    // Es derivado, no se persiste (mismo criterio que `pedirDesde`).
    if (defTipo === 'documento' && b.instancia?.data) {
      const checks = (configExtra.cross_check as { checks?: SpecVigencia[] } | undefined)?.checks ?? []
      const data = b.instancia.data as Record<string, unknown>
      const ccGuardado = data._cross_check as CrossCheckGuardado | undefined
      if (checks.length > 0) {
        const cc = refrescarVigenciaCrossCheck(ccGuardado, checks, spec => {
          // Vía preferida el slug; el orden de etapa queda de respaldo legacy.
          const src =
            (spec.source_bloque_slug ? datosPorSlug[spec.source_bloque_slug] : undefined)
            ?? (typeof spec.source_etapa_orden === 'number' ? datosOtrasEtapas[spec.source_etapa_orden] : undefined)
          // Sin bloque fuente resuelto no se recalcula: `null` significa "no sé",
          // que no es lo mismo que "todavía no hay cita" (cadena vacía).
          if (!src || !spec.source_field) return null
          return String(src[spec.source_field] ?? '')
        }, hoyBogotaISO, spec => {
          // Solo se usa para SINTETIZAR el veredicto de un documento cargado antes
          // de que el check existiera. La fecha vive donde la dejó la extracción.
          const campos = data.campos as Record<string, { value?: unknown }> | undefined
          const valor = campos?.[spec.slug]?.value
          return valor === null || valor === undefined || valor === '' ? null : String(valor)
        })
        if (cc !== ccGuardado) {
          b = { ...b, instancia: { ...b.instancia, data: { ...data, _cross_check: cc } } }
        }
      }
    }

    // Heredado `editable_solo_si_vacio` que ya viene lleno: se pinta de solo lectura, así
    // que NADIE puede cerrarlo desde la pantalla. Si además es gate, dejarlo `pendiente`
    // retendría el negocio esperando un dato que ya tiene — el defecto que este repo ya
    // documentó dos veces (ver `gateVisibleQuedaResuelto`). Se cierra aquí, con la misma
    // data que el render acaba de resolver.
    if (
      b.instancia
      && b.instancia.estado !== 'completo'
      && b.es_gate === true
      && soloLecturaPorDatoLleno(configExtra, b.instancia.data as Record<string, unknown> | null)
    ) {
      // El `map` es síncrono: aquí solo se marca en memoria y el id se acumula para
      // persistirlo en una sola escritura al salir del recorrido.
      gatesHeredadosACerrar.push(b.instancia.id)
      b = { ...b, instancia: { ...b.instancia, estado: 'completo' } }
    }

    // Si el tipo no se infirio, usamos detector indirecto: si hay srcData
    // disponible Y el config_extra del bloque indica readonly+source, lo
    // tratamos como heredado de propuesta_economica (caso canonico SOENA).
    void tipoBloque

    // Compute auto_fill defaults for datos fields
    const autoFill: Record<string, unknown> = {}
    const fields = (configExtra.fields ?? []) as Array<{
      slug: string
      tipo?: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auto_fill?: { field: string; source: string; mapping?: Record<string, any>; source_etapa_orden: number; source_bloque?: string; source_bloque_slug?: string; computed?: string; computed_anio?: number }
      doc_link?: { source_bloque_nombre: string; source_etapa_orden: number; source_bloque_slug?: string }
    }>
    for (const f of fields) {
      if (f.auto_fill) {
        // Vía preferida: source_bloque_slug (identidad estable). Luego source_bloque
        // por nombre (legacy). Si no hay match, cae al bag aplanado por etapa.
        const srcData =
          (f.auto_fill.source_bloque_slug ? datosPorSlug[f.auto_fill.source_bloque_slug] : undefined)
          ?? (f.auto_fill.source_bloque
            ? datosPorEtapaBloque[f.auto_fill.source_etapa_orden]?.[f.auto_fill.source_bloque.trim().toLowerCase()]
            : undefined)
          ?? datosOtrasEtapas[f.auto_fill.source_etapa_orden]
        if (srcData) {
          const rawVal = srcData[f.auto_fill.field]
          if (f.auto_fill.computed) {
            // Referencia calculada (informativa, editable) — ej. tarifa UPME
            // (Res. UPME 135/2025). NUNCA es gate ni bloquea; el operador la
            // sobrescribe y el valor final lo tiene la plataforma UPME.
            const computed = aplicarComputedAutoFill(f.auto_fill.computed, rawVal, { anio: f.auto_fill.computed_anio, srcData })
            if (computed !== undefined) autoFill[f.slug] = computed
          } else if (f.auto_fill.mapping) {
            const srcVal = String(rawVal ?? '').toLowerCase().trim()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents: eléctrico → electrico
            if (srcVal && f.auto_fill.mapping[srcVal] !== undefined) {
              autoFill[f.slug] = f.auto_fill.mapping[srcVal]
            }
          } else if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
            // Valor directo sin mapping: copiar tal cual
            autoFill[f.slug] = rawVal
          }
        }
      }
    }

    // Resolver doc_link: buscar el bloque documento origen en etapas previas y
    // exponer drive_url + file_name del archivo cargado.
    const fieldsConDocLink = fields.filter(f => f.tipo === 'doc_link' && f.doc_link)
    let resolvedFields: typeof fields | null = null
    if (fieldsConDocLink.length > 0) {
      resolvedFields = fields.map(f => {
        if (f.tipo !== 'doc_link' || !f.doc_link) return f
        // Vía preferida: slug estable. Fallback legacy: (etapa_orden, nombre).
        const wantSlug = f.doc_link!.source_bloque_slug
        const target =
          (wantSlug ? bloquesEtapasPrevias.find(bp => bp.slug === wantSlug) : undefined)
          ?? bloquesEtapasPrevias.find(bp =>
            bp.etapa_orden === f.doc_link!.source_etapa_orden
            && (bp.nombre ?? bp.bloque_definitions?.nombre ?? '').trim().toLowerCase()
               === f.doc_link!.source_bloque_nombre.trim().toLowerCase()
          )
        const data = (target?.instancia?.data ?? null) as Record<string, unknown> | null
        const drive_url = (data?.drive_url as string | null) ?? null
        const file_name = (data?.file_name as string | null) ?? null
        return {
          ...f,
          doc_link: { ...f.doc_link, _resolved: { drive_url, file_name } },
        }
      })
    }

    const enrichedConfigExtra: Record<string, unknown> = { ...configExtra }
    if (Object.keys(autoFill).length > 0) enrichedConfigExtra._auto_fill = autoFill
    if (resolvedFields) enrichedConfigExtra.fields = resolvedFields
    // Solo lectura por área: se decide POR BLOQUE, no por etapa. Un bloque puede
    // invitar a otra área (`areas_editoras`) porque su trabajo real es de ella,
    // aunque la etapa pertenezca a otra. Sin la marca, el resultado es el de antes.
    const invitadoAEsteBloque = ((configExtra.areas_editoras ?? []) as Area[])
      .some(a => areasEfectivasUsuario.has(a))
    if (areaReadonly && !invitadoAEsteBloque) enrichedConfigExtra._areaReadonly = true
    // Corrección del valor aprobado: capacidad declarada por persona en el
    // workspace, NO derivada del rol (ver `corregirValorAprobado`). Se resuelve
    // en el servidor y viaja como flag para que el bloque sepa si mostrar el
    // botón; la action revalida la lista antes de escribir.
    // Revertir la aprobación: la ventana NO es la etapa donde vive el bloque, es hasta
    // la etapa que se declare en `revertir_hasta_etapa_orden`. En SOENA la propuesta se
    // aprueba en Propuesta (orden 4) pero se renegocia en Negociación (orden 5), donde
    // el bloque ya es una copia de solo lectura: atar la ventana a la etapa propia
    // dejaba la reversión inalcanzable justo en el escenario que la pidió. Sin la
    // config declarada no se muestra nada (opt-in, conservador).
    if (defTipo === 'propuesta_economica') {
      const hasta = (configExtra as { revertir_hasta_etapa_orden?: number }).revertir_hasta_etapa_orden
      if (typeof hasta === 'number' && ordenEtapaActualNeg != null && ordenEtapaActualNeg <= hasta) {
        enrichedConfigExtra._puedeRevertirAprobacion = true
      }
    }
    if (defTipo === 'propuesta_economica' && puedeCorregirPrecioWs) {
      enrichedConfigExtra._puedeCorregirPrecio = true
    }
    // Sin honorario confirmado el cobro está frenado, así que la propuesta tiene
    // que quedar alcanzable AUNQUE el caso ya haya avanzado de etapa — incluso
    // desde el historial, que es donde vive el bloque nativo cuando el negocio ya
    // se fue. Se apaga solo en el momento en que alguien aprueba: no es una
    // ventana declarada, es la ausencia del dato que el guard exige.
    if (defTipo === 'propuesta_economica' && faltaHonorario) {
      enrichedConfigExtra._faltaHonorarioConfirmado = true
    }

    // Preview para BloqueGuiaDevolucion: resuelve nombre, NIT, ciudad, fecha cita
    // y seccional sugerida desde otros bloques del negocio.
    if (defTipo === 'guia_devolucion') {
      // Resuelto por SLUG estable del bloque (vía preferida), con fallback a
      // nombre por compatibilidad con líneas aún no migradas a slug.
      const rutData = datosGuiaPorSlug['rut'] ?? datosGuiaPorNombre['rut'] ?? {}
      const facturaData =
        datosGuiaPorSlug['factura_venta_vehiculo'] ??
        datosGuiaPorNombre['factura venta vehiculo'] ??
        datosGuiaPorNombre['factura de venta'] ??
        {}
      const razonSocial = (rutData.razon_social as string) ?? ''
      const nit = (rutData.nit as string) ?? ''
      const dv = (rutData.dv as string) ?? ''
      const tipoPersona = (rutData.tipo_persona as string) ?? ''
      const ciudadVenta = (facturaData.ciudad_venta as string) ?? ''
      const fechaCitaData = datosGuiaPorSlug['fecha_cita_dian'] ?? datosGuiaPorNombre['fecha cita dian'] ?? {}
      const fechaCita = (fechaCitaData.fecha_cita_dian as string) ?? null
      // La seccional (y la ciudad que se muestra) heredan lo SELECCIONADO en el 010
      // (negocios.metadata.seccional): así la Guía y el 010 muestran lo mismo. Si el
      // 010 quedó en "Otras seccionales" o sin selección, cae a la ciudad de la factura.
      const seccional010Label = seccional010DelNegocio
      const seccional010 = seccional010Label ? mapCiudadASeccional(seccional010Label, tipoPersona) : null
      const seccional = seccional010 ?? mapCiudadASeccional(ciudadVenta, tipoPersona)
      enrichedConfigExtra._guia_preview = {
        nombre: razonSocial || null,
        nit: nit ? (dv ? `${nit}-${dv}` : nit) : null,
        ciudad_venta: (seccional010 ? seccional010Label : ciudadVenta) || null,
        fecha_cita: fechaCita,
        seccional_sugerida_slug: seccional?.slug ?? null,
      }
    }

    return {
      ...b,
      config_extra: enrichedConfigExtra,
      items: (itemsByBloqueId[b.instancia?.id ?? ''] ?? []) as Array<{
        id: string
        label: string
        tipo: string
        completado: boolean
        completado_por: string | null
        completado_at: string | null
        link_url: string | null
        imagen_data: string | null
        orden: number
      }>,
    }
  })

  // Persistencia del cierre marcado arriba. El gate lo evalúa SQL contra
  // `negocio_bloques.estado`, así que sin esta escritura la pantalla mostraría el bloque
  // resuelto y el motor seguiría reteniendo el negocio.
  if (gatesHeredadosACerrar.length > 0) {
    const { error: errCierre } = await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'completo', completado_at: new Date().toISOString() })
      .in('id', gatesHeredadosACerrar)
    // No se traga: si falla, el negocio queda retenido por un gate que la pantalla no
    // ofrece forma de cerrar, y sin este registro nadie sabría por qué.
    if (errCierre) console.error('[getNegocioDetalle] no se pudieron cerrar los gates heredados ya llenos:', errCierre)
  }

  return {
    negocio: base.negocio,
    bloques: bloquesConExtra,
    etapasLinea: base.etapasLinea,
    datosOtrasEtapas,
    // Data de bloques fuente indexada por slug estable — para que el cliente
    // evalúe `condition.source_bloque_slug` por identidad (no por etapa_orden).
    datosPorSlug,
    bloquesEtapasPrevias,
    profiles: (profilesData ?? []).map(p => ({
      id: p.id,
      full_name: p.full_name,
      email: null as string | null,
    })),
    currentUserId,
    currentUserEsResponsable,
    userRole: role ?? 'read_only',
    cobros: ((cobrosData ?? []) as Record<string, unknown>[]).map(c => ({
      id: c.id as string,
      concepto: c.notas as string | null,
      monto: c.monto as number,
      revisado: (c.revisado as boolean | null) ?? false,
      tipo_cobro: c.tipo_cobro as string | null,
      fecha: c.fecha as string | null,
      fecha_esperada: c.fecha_esperada as string | null,
      numero_cuota: c.numero_cuota as number | null,
      vencido: (c.vencido as boolean | null) ?? false,
      notas: c.notas as string | null,
      external_ref: c.external_ref as string | null,
      es_reparto_comercial:
        ((c.split_json as { origen?: string } | null)?.origen ?? null) === 'comercial',
    })),
    cotizacion,
    cotizacionesNegocio,
    resumenFinanciero: {
      totalCobrado,
      porCobrar: Math.max(0, (precioAprobado ?? 0) - totalCobrado),
      precioAprobado,
      costosEjecutados: (() => {
        const gastos = ((gastosData ?? []) as Array<{ monto: number }>)
        const totalGastos = gastos.reduce((s, g) => s + (g.monto ?? 0), 0)
        // Costo horas = horas * tarifa del staff (simplificado: usar salary/160)
        const staffData = (staffRes.data ?? []) as Array<{ id: string; salary?: number }>
        const staffSalaryMap: Record<string, number> = {}
        for (const s of staffData) staffSalaryMap[s.id] = (s as Record<string, unknown>).salary as number ?? 0
        const horas = ((horasData ?? []) as Array<{ horas: number; staff_id: string | null }>)
        const costoHoras = horas.reduce((s, h) => {
          const salary = h.staff_id ? (staffSalaryMap[h.staff_id] ?? 0) : 0
          const tarifa = salary > 0 ? salary / 160 : 0
          return s + ((h.horas ?? 0) * tarifa)
        }, 0)
        return Math.round(totalGastos + costoHoras)
      })(),
    },
    ejecucionData: (() => {
      const gastos = ((gastosData ?? []) as Array<{ monto: number; categoria: string; fecha: string }>)
      const totalGastos = gastos.reduce((s, g) => s + (g.monto ?? 0), 0)
      // Agrupar gastos por categoría
      const catMap: Record<string, number> = {}
      for (const g of gastos) {
        const cat = g.categoria ?? 'otros'
        catMap[cat] = (catMap[cat] ?? 0) + (g.monto ?? 0)
      }
      const gastosPorCategoria = Object.entries(catMap)
        .map(([categoria, total]) => ({ categoria, total }))
        .sort((a, b) => b.total - a.total)

      const staffDataArr = (staffRes.data ?? []) as Array<{ id: string; full_name: string; salary?: number }>
      const staffNameMap: Record<string, string> = {}
      const staffSalaryMap2: Record<string, number> = {}
      for (const s of staffDataArr) {
        staffNameMap[s.id] = s.full_name
        staffSalaryMap2[s.id] = (s as Record<string, unknown>).salary as number ?? 0
      }

      const horas = ((horasData ?? []) as Array<{ horas: number; descripcion: string | null; fecha: string; staff_id: string | null }>)
      const totalHoras = horas.reduce((s, h) => s + (h.horas ?? 0), 0)
      const costoHoras = horas.reduce((s, h) => {
        const salary = h.staff_id ? (staffSalaryMap2[h.staff_id] ?? 0) : 0
        const tarifa = salary > 0 ? salary / 160 : 0
        return s + ((h.horas ?? 0) * tarifa)
      }, 0)

      return {
        totalGastos,
        totalHoras: Math.round(totalHoras * 100) / 100,
        costoHoras: Math.round(costoHoras),
        gastosPorCategoria,
        presupuestoPorRubro: presupuestoPorRubro.length > 0 ? presupuestoPorRubro : undefined,
        precioAprobado,
      }
    })(),
    historialData: {
      gastos: ((gastosData ?? []) as Array<{ id: string; descripcion: string | null; monto: number; categoria: string; fecha: string }>).map(g => ({
        id: g.id,
        descripcion: g.descripcion ?? null,
        monto: g.monto ?? 0,
        categoria: g.categoria ?? 'otros',
        fecha: g.fecha ?? '',
      })),
      horas: ((horasData ?? []) as Array<{ id: string; horas: number; descripcion: string | null; fecha: string; staff_id: string | null }>).map(h => ({
        id: h.id,
        descripcion: h.descripcion,
        horas: h.horas ?? 0,
        fecha: h.fecha ?? '',
        staff_nombre: h.staff_id ? (staffMap[h.staff_id] ?? null) : null,
      })),
      cobros: ((cobrosData ?? []) as Record<string, unknown>[]).map(c => ({
        id: c.id as string,
        notas: c.notas as string | null,
        monto: c.monto as number,
        fecha: c.fecha as string | null,
        revisado: (c.revisado as boolean | null) ?? false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tipo_cobro: (c as any).tipo_cobro as string | null,
      })),
    },
    actividad,
    staffList: ((staffRes.data ?? []) as { id: string; full_name: string }[]).map(s => ({
      id: s.id,
      full_name: s.full_name,
    })),
    pausaEnabled,
  }
}

// ── Actualizar nombre del negocio ─────────────────────────────────────────────

export async function actualizarNombreNegocio(
  negocioId: string,
  nombre: string,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Guard de rol (mismo patrón que agregarResponsable). Antes solo se validaba
  // la sesión: cualquier autenticado del workspace renombraba cualquier negocio
  // llamando la action directo; el único control era el canEdit de la UI.
  if (!puedeCorregirDocumentos(role)) {
    return { error: 'Sin permisos para renombrar el negocio' }
  }

  const nuevo = nombre.trim()
  if (!nuevo) return { error: 'El nombre no puede estar vacío' }
  if (nuevo.length > 200) return { error: 'El nombre es demasiado largo (máx 200)' }

  const { data: negocioAntes } = await db(supabase)
    .from('negocios')
    .select('nombre')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  const nombreAnterior = (negocioAntes as { nombre: string | null } | null)?.nombre

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({ nombre: nuevo, updated_at: new Date().toISOString() })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
  if (updErr) return { error: (updErr as { message: string }).message }

  if (staffId && (nombreAnterior ?? '') !== nuevo) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio',
      autor_id: staffId,
      campo_modificado: 'nombre',
      valor_anterior: nombreAnterior ?? null,
      valor_nuevo: nuevo,
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// ── Actualizar carpeta URL del negocio ────────────────────────────────────────

export async function actualizarCarpetaUrlNegocio(
  negocioId: string,
  carpetaUrl: string
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const url = carpetaUrl.trim()

  // Obtener valor anterior para comparar
  const { data: negocioAntes } = await db(supabase)
    .from('negocios')
    .select('carpeta_url')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const urlAnterior = (negocioAntes as { carpeta_url: string | null } | null)?.carpeta_url

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({ carpeta_url: url || null })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: (updErr as { message: string }).message }

  // Registrar en activity_log solo si cambió
  if (staffId && (urlAnterior ?? '') !== (url || '')) {
    await supabase
      .from('activity_log')
      .insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio',
        autor_id: staffId,
        campo_modificado: 'carpeta_url',
        valor_anterior: urlAnterior ?? null,
        valor_nuevo: url || null,
        contenido: url ? 'Carpeta Drive actualizada' : 'Carpeta Drive eliminada',
      })
  }

  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// ── Cerrar negocio ────────────────────────────────────────────────────────────

// ── Perder negocio (stage venta) ──────────────────────────────────────────────

export async function perderNegocio(
  negocioId: string,
  razon: string,
  notas?: string,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // El motivo es obligatorio (queda registrado en razon_cierre para medir
  // pérdida de venta y calidad de pauta en el descarte de leads).
  if (!razon || !razon.trim()) {
    return { error: 'Debes registrar el motivo del descarte' }
  }

  // Validar que existe y esta en stage venta
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, stage_actual, estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return { error: 'Negocio no encontrado' }
  if (negocio.stage_actual !== 'venta') {
    return { error: 'Solo se puede perder un negocio en etapa de venta' }
  }
  if (negocio.estado !== 'abierto') {
    return { error: 'El negocio ya esta cerrado' }
  }

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({
      estado: 'perdido',
      razon_cierre: razon,
      descripcion_cierre: notas ?? null,
      closed_at: new Date().toISOString(),
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: (updErr as { message: string }).message }

  // Log en activity_log
  const razonLabel = RAZONES_PERDIDA_NEGOCIO.find(r => r.value === razon)?.label ?? razon
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: `Negocio perdido. Motivo: ${razonLabel}`,
      valor_nuevo: 'perdido',
    })
  }

  // Perder el negocio ya NO marca el contacto. Antes pasaba a 'inactivo' cuando era
  // su único negocio abierto; hoy el desenlace del contacto lo decide el comercial
  // (Descartado o Standby son cosas distintas y el sistema no puede distinguirlas:
  // perder un negocio no significa que la persona deje de ser un prospecto).

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// ── Pausar negocio (stage venta) ──────────────────────────────────────────────

/**
 * Pausa un negocio que el cliente no ha avanzado. Oculto del pipeline activo.
 * Validaciones:
 * - Feature flag workspaces.modules.pausa_enabled = true
 * - Solo stage venta, estado abierto
 * - Motivo en lista cerrada (si otro → detalle requerido)
 * - Existe actividad en ultimos 30d (fuerza contacto real antes de pausar)
 * - fechaReapertura <= ultima_actividad + MAX_DIAS_PAUSA
 * - Al cuarto intento de pausa → auto-perdido con no_conversion_post_pausa
 */
export async function pausarNegocio(
  negocioId: string,
  motivo: string,
  fechaReapertura: string, // YYYY-MM-DD
  detalle?: string,
): Promise<{ error: string | null; autoPerdido?: boolean }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Validar feature flag
  const { data: wsRaw } = await db(supabase)
    .from('workspaces')
    .select('modules')
    .eq('id', workspaceId)
    .single()
  const modules = (wsRaw as { modules: Record<string, unknown> } | null)?.modules ?? {}
  if (modules.pausa_enabled !== true) {
    return { error: 'Funcionalidad de pausa no habilitada en este workspace' }
  }

  // Validar motivo
  const motivosValidos = MOTIVOS_PAUSA.map(m => m.value) as readonly string[]
  if (!motivosValidos.includes(motivo)) {
    return { error: 'Motivo de pausa no valido' }
  }
  if (motivo === 'otro' && !detalle?.trim()) {
    return { error: 'El detalle es obligatorio cuando el motivo es "otro"' }
  }

  // Cargar negocio
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, stage_actual, estado, pausado, veces_pausado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!negocio) return { error: 'Negocio no encontrado' }

  type N = { stage_actual: string; estado: string; pausado: boolean; veces_pausado: number }
  const n = negocio as N
  if (n.estado !== 'abierto') return { error: 'El negocio ya esta cerrado' }
  if (n.stage_actual !== 'venta') return { error: 'Solo se puede pausar un negocio en etapa de venta' }
  if (n.pausado) return { error: 'El negocio ya esta pausado' }

  // Si ya alcanzo el maximo de pausas → auto-perdido
  if (n.veces_pausado >= MAX_PAUSAS) {
    const { error: updErr } = await db(supabase)
      .from('negocios')
      .update({
        estado: 'perdido',
        razon_cierre: 'no_conversion_post_pausa',
        descripcion_cierre: `Maximo de ${MAX_PAUSAS} pausas alcanzado sin conversion`,
        closed_at: new Date().toISOString(),
      })
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
    if (updErr) return { error: (updErr as { message: string }).message }

    if (staffId) {
      await supabase.from('activity_log').insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio_estado',
        autor_id: staffId,
        contenido: `Negocio auto-perdido: ${MAX_PAUSAS} pausas sin conversion`,
        valor_nuevo: 'perdido',
      })
    }
    revalidatePath(`/negocios/${negocioId}`)
    revalidatePath('/negocios')
    return { error: null, autoPerdido: true }
  }

  // Validar actividad reciente (ultimos 30d) — fuerza contacto real antes de pausar
  const desdeFecha = new Date()
  desdeFecha.setDate(desdeFecha.getDate() - 30)
  const { data: actividades } = await supabase
    .from('activity_log')
    .select('created_at')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', 'negocio')
    .eq('entidad_id', negocioId)
    .gte('created_at', desdeFecha.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)

  const ultimaActividad = ((actividades ?? []) as Array<{ created_at: string }>)[0]?.created_at
  if (!ultimaActividad) {
    return { error: 'Debe registrar al menos una interaccion con el cliente antes de pausar' }
  }

  // Validar fecha de reapertura <= ultima_actividad + MAX_DIAS_PAUSA
  const fechaLimite = new Date(ultimaActividad)
  fechaLimite.setDate(fechaLimite.getDate() + MAX_DIAS_PAUSA)
  const fechaReaperturaDate = new Date(`${fechaReapertura}T00:00:00`)
  if (isNaN(fechaReaperturaDate.getTime())) return { error: 'Fecha de reapertura invalida' }
  if (fechaReaperturaDate.getTime() > fechaLimite.getTime()) {
    return { error: `La fecha de reapertura no puede superar ${MAX_DIAS_PAUSA} dias desde la ultima actividad (${todayBogotaISO(fechaLimite)})` }
  }

  const now = new Date().toISOString()
  const { error: pauseErr } = await db(supabase)
    .from('negocios')
    .update({
      pausado: true,
      pausado_hasta: fechaReapertura,
      motivo_pausa: motivo,
      motivo_pausa_detalle: detalle?.trim() || null,
      veces_pausado: n.veces_pausado + 1,
      ultimo_pausado_at: now,
      updated_at: now,
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
  if (pauseErr) return { error: (pauseErr as { message: string }).message }

  const motivoLabel = MOTIVOS_PAUSA.find(m => m.value === motivo)?.label ?? motivo
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: `Pausado hasta ${fechaReapertura}. Motivo: ${motivoLabel}${detalle ? ` — ${detalle}` : ''}`,
      valor_nuevo: `pausado:${motivo}`,
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// ── Reactivar negocio (salir de pausa) ────────────────────────────────────────

/**
 * Reactiva un negocio pausado. Si la reactivacion ocurre dentro de las
 * SAFETY_NET_HORAS siguientes a la pausa, decrementa veces_pausado (evita
 * quemar una pausa por error del comercial).
 */
export async function reactivarNegocio(
  negocioId: string,
): Promise<{ error: string | null; safetyNet?: boolean }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, pausado, veces_pausado, ultimo_pausado_at, estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!negocio) return { error: 'Negocio no encontrado' }

  type N = { pausado: boolean; veces_pausado: number; ultimo_pausado_at: string | null; estado: string }
  const n = negocio as N
  if (n.estado !== 'abierto') return { error: 'El negocio ya esta cerrado' }
  if (!n.pausado) return { error: 'El negocio no esta pausado' }

  // Safety-net 24h: si pausa fue en las ultimas N horas → decrementar contador
  let decrementar = false
  if (n.ultimo_pausado_at) {
    const horasDesdePausa = (Date.now() - new Date(n.ultimo_pausado_at).getTime()) / 3600000
    if (horasDesdePausa <= SAFETY_NET_HORAS) decrementar = true
  }

  const now = new Date().toISOString()
  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({
      pausado: false,
      pausado_hasta: null,
      motivo_pausa: null,
      motivo_pausa_detalle: null,
      veces_pausado: decrementar ? Math.max(0, n.veces_pausado - 1) : n.veces_pausado,
      updated_at: now,
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
  if (updErr) return { error: (updErr as { message: string }).message }

  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: decrementar ? 'Negocio reactivado (safety-net 24h: pausa no consumida)' : 'Negocio reactivado',
      valor_nuevo: 'activo',
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null, safetyNet: decrementar }
}

// ── Cancelar negocio (stage ejecucion) ────────────────────────────────────────

export async function cancelarNegocio(
  negocioId: string,
  motivo: string,
  descripcion: string,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  if (!descripcion || descripcion.trim().length < 20) {
    return { error: 'La descripcion debe tener al menos 20 caracteres' }
  }

  // Validar que existe y esta en stage ejecucion
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, stage_actual, estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return { error: 'Negocio no encontrado' }
  if (negocio.stage_actual !== 'ejecucion') {
    return { error: 'Solo se puede cancelar un proyecto en etapa de ejecucion' }
  }
  if (negocio.estado !== 'abierto') {
    return { error: 'El negocio ya esta cerrado' }
  }

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({
      estado: 'cancelado',
      razon_cierre: motivo,
      descripcion_cierre: descripcion.trim(),
      closed_at: new Date().toISOString(),
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: (updErr as { message: string }).message }

  const motivoLabel = MOTIVOS_CANCELACION.find(m => m.value === motivo)?.label ?? motivo
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: `Proyecto cancelado. Motivo: ${motivoLabel}`,
      valor_nuevo: 'cancelado',
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// ── Completar negocio (stage cobro) ───────────────────────────────────────────

// Gate de cierre source-agnostic: lee el bloque de factura de la etapa de cierre
// (data.campos) y exige consecutivo presente + NIT emisor == NIT esperado del
// workspace. Devuelve mensaje de error o null si pasa. Lo satisface igual la
// extracción IA (manual) que el volcado de Siigo (futuro): ambos escriben en
// data.campos del mismo bloque.
async function validarGateFacturaEmitida(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
  etapaId: string | null,
): Promise<string | null> {
  if (!etapaId) return null
  const { data: etapaRow } = await db(supabase)
    .from('etapas_negocio')
    .select('config_extra')
    .eq('id', etapaId)
    .single()
  const cfg = ((etapaRow as { config_extra?: Record<string, unknown> } | null)?.config_extra ?? {}) as {
    gates?: string[]
    factura_gate?: { bloque_slug?: string; nit_campo?: string; numero_campo?: string; emisor_nit_esperado?: string }
  }
  if (!cfg.gates?.includes('factura:emitida') || !cfg.factura_gate) return null
  const { bloque_slug, nit_campo = 'emisor_nit', numero_campo = 'numero_factura', emisor_nit_esperado } = cfg.factura_gate
  if (!bloque_slug) return null

  // Si la factura la emitió ONE contra Siigo, el gate ya está satisfecho: el
  // número lo devolvió Siigo y el emisor es, por construcción, el del workspace
  // desde cuya cuenta se emitió. Exigirle a alguien que transcriba del PDF un
  // dato que el sistema acaba de recibir es pedirle que copie a mano lo que ya
  // sabe, y la comprobación de emisor existe para otra cosa: detectar que se
  // cargue a mano una factura ajena.
  const { data: negFactura } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .single()
  const marca = ((negFactura as { metadata?: Record<string, unknown> } | null)?.metadata?.siigo_factura ?? null) as
    { numero?: string } | null
  if (marca?.numero) return null

  const { data: bloques } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(slug)')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', bloque_slug)
  // Puede haber más de una instancia (heredadas); toma la que tenga datos.
  let campos: Record<string, { value?: unknown }> = {}
  for (const b of ((bloques ?? []) as Array<{ data: Record<string, unknown> | null }>)) {
    const c = (b.data?.campos ?? {}) as Record<string, { value?: unknown }>
    if (Object.keys(c).length > 0) { campos = c; break }
  }
  const numero = String(campos[numero_campo]?.value ?? '').trim()
  if (!numero) return 'Carga la factura emitida (falta el consecutivo) antes de cerrar el negocio.'

  const emisor = nitSinDv(String(campos[nit_campo]?.value ?? '').trim())
  const esperado = emisor_nit_esperado ? nitSinDv(emisor_nit_esperado) : null
  if (esperado && emisor !== esperado) {
    return 'La factura cargada no es de SOENA (el NIT del emisor no coincide). No se puede cerrar el negocio.'
  }
  return null
}

export async function completarNegocio(
  negocioId: string,
  lecciones?: string,
  cierreNoFacturable?: {
    motivo: 'cortesia_compensacion' | 'incluido_otro_acuerdo' | 'otro'
    nota?: string
  },
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Validar que existe y esta en stage cobro
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, stage_actual, estado, precio_aprobado, precio_estimado, etapa_actual_id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return { error: 'Negocio no encontrado' }
  if (negocio.stage_actual === 'venta') {
    return { error: 'Los negocios en etapa de venta se cierran con Perder, no con Completar' }
  }
  if (negocio.estado !== 'abierto') {
    return { error: 'El negocio ya esta cerrado' }
  }

  const motivosNoFacturable = new Set(['cortesia_compensacion', 'incluido_otro_acuerdo', 'otro'])
  const esCierreNoFacturable = cierreNoFacturable !== undefined
  const motivoNoFacturable = cierreNoFacturable?.motivo
  const notaNoFacturable = cierreNoFacturable?.nota?.trim() || null

  // Gate de cierre "factura:emitida": en el cierre normal conserva exactamente
  // la validación vigente. La excepción explícita solo existe en cobro, para un
  // gate realmente incumplido y con autorización de administración/financiera.
  const gateErr = await validarGateFacturaEmitida(supabase, negocioId, negocio.etapa_actual_id as string | null)
  if (!esCierreNoFacturable) {
    if (gateErr) return { error: gateErr }
  } else {
    if (negocio.stage_actual !== 'cobro') {
      return { error: 'El cierre no facturable solo está disponible en la etapa de cierre.' }
    }
    if (!motivoNoFacturable || !motivosNoFacturable.has(motivoNoFacturable)) {
      return { error: 'Selecciona un motivo válido para el cierre no facturable.' }
    }
    if (motivoNoFacturable === 'otro' && !notaNoFacturable) {
      return { error: 'Describe el motivo cuando seleccionas Otro.' }
    }
    if (!gateErr) {
      return { error: 'La factura ya cumple el gate; usa el cierre normal.' }
    }
    if (!staffId) {
      return { error: 'No se pudo identificar al responsable del cierre.' }
    }

    // Mismo criterio que decide si la pantalla muestra la casilla. Ver
    // `puedeAutorizarCierreNoFacturable`: la regla vive en un solo lugar.
    const autorizado = puedeAutorizarCierreNoFacturable({
      id: staffId,
      role: (role ?? 'read_only') as Role,
      areas: (areas ?? []) as Area[],
    })
    if (!autorizado) {
      return { error: 'Solo administración o financiera puede autorizar un cierre no facturable.' }
    }

    // Conserva la segmentación de áreas y responsabilidad que aplica a la etapa
    // de cobro. El chequeo anterior es la autorización adicional del override.
    const permisoCierre = await guardAvanzarStage(negocioId, 'cobro')
    if (!permisoCierre.ok) {
      return { error: permisoCierre.error ?? 'Sin permisos para cerrar en esta fase.' }
    }
  }

  // Calcular snapshot financiero: buscar cobros del negocio
  const { data: cobrosData } = await db(supabase)
    .from('cobros')
    .select('monto, revisado')
    .eq('negocio_id', negocioId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cobros = ((cobrosData ?? []) as any[]) as Array<{ monto: number }>
  // 2026-04-28: todos los cobros registrados cuentan. revisado es para contador.
  const totalCobrado = cobros.reduce((sum, c) => sum + (c.monto ?? 0), 0)
  const precioAprobado = negocio.precio_aprobado ?? negocio.precio_estimado ?? 0
  const pendiente = Math.max(0, precioAprobado - totalCobrado)

  const now = new Date().toISOString()
  const snapshot = {
    fecha_cierre: now,
    precio_aprobado: precioAprobado,
    total_cobrado: totalCobrado,
    // Se conserva el numero tal cual (es lo que quedo sin cobrar de verdad), pero
    // en un cierre no facturable ese saldo NO es cartera: nadie lo va a cobrar.
    // Sin la marca, cualquier lector futuro del snapshot lo suma como plata por
    // entrar, que es justo lo que la excepcion existe para evitar.
    pendiente_cobro: pendiente,
    ...(esCierreNoFacturable ? { no_facturable: true, motivo_no_facturable: motivoNoFacturable } : {}),
    margen: totalCobrado - 0, // sin costos ejecutados por ahora
  }

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({
      estado: 'completado',
      lecciones_aprendidas: lecciones?.trim() || null,
      cierre_snapshot: snapshot,
      closed_at: now,
      ...(esCierreNoFacturable ? {
        cierre_no_facturable: true,
        cierre_no_facturable_motivo: motivoNoFacturable,
        cierre_no_facturable_nota: notaNoFacturable,
        cierre_no_facturable_at: now,
        cierre_no_facturable_por: staffId,
      } : {}),
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: (updErr as { message: string }).message }

  if (staffId) {
    const motivosLabel: Record<string, string> = {
      cortesia_compensacion: 'Cortesía o compensación',
      incluido_otro_acuerdo: 'Incluido en otro acuerdo',
      otro: 'Otro',
    }
    const motivoLabel = motivosLabel[motivoNoFacturable ?? '']
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      ...(esCierreNoFacturable ? { campo_modificado: 'cierre_no_facturable' } : {}),
      contenido: esCierreNoFacturable
        ? `Proyecto completado sin facturación. Motivo: ${motivoLabel}.${notaNoFacturable ? ` Nota: ${notaNoFacturable}` : ''}`
        : 'Proyecto completado',
      valor_nuevo: 'completado',
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// ── Responsables del negocio (multi · negocio_responsables N:M) ────────────────

// Mantiene negocios.responsable_id (legacy/display) = responsable más antiguo
// restante, o null si no quedan. La fuente de verdad de permisos es la tabla N:M.
async function sincronizarResponsablePrincipal(
  supabase: unknown,
  negocioId: string,
  workspaceId: string,
): Promise<void> {
  const { data } = await db(supabase)
    .from('negocio_responsables')
    .select('staff_id')
    .eq('negocio_id', negocioId)
    .order('assigned_at', { ascending: true })
    .limit(1)
  const principal = ((data ?? []) as { staff_id: string }[])[0]?.staff_id ?? null
  await db(supabase)
    .from('negocios')
    .update({ responsable_id: principal })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
}

/**
 * Staff asignable como responsable de un negocio (para el selector inline de la
 * lista). Devuelve el staff ACTIVO del workspace, sin filtrar por área: la
 * responsabilidad sobre un negocio recorre las tres áreas a lo largo del flujo
 * (comercial vende, operaciones ejecuta, financiera cobra), y `agregarResponsable`
 * valida exactamente eso — que el staff pertenezca al workspace.
 *
 * NO se reusa `getStaffParaResponsable()` del directorio: ese acota a área
 * comercial, que es lo correcto para el responsable de un CONTACTO pero dejaría
 * fuera del selector a la mayoría de responsables reales de negocios.
 */
export async function getStaffParaAsignarNegocio(): Promise<Array<{ id: string; full_name: string }>> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('staff')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  return ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((s) => ({
    id: s.id,
    full_name: s.full_name ?? '—',
  }))
}

export async function agregarResponsable(
  negocioId: string,
  staffMiembroId: string,
): Promise<{
  error: string | null
  /** Rol con el que quedó. `null` = no recibe avisos de etapa (ver `asignarResponsable`). */
  rol?: 'comercial' | 'operaciones' | null
  /** Nombre de quien ocupaba ese puesto y quedó desplazado, para poder decirlo en pantalla. */
  desplazado?: string | null
}> {
  // userId = profile.id (para assigned_by, FK a profiles). staffId = staff.id (para activity_log.autor_id).
  const { supabase, workspaceId, role, userId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const allowed = ['owner', 'admin', 'supervisor']
  if (!role || !allowed.includes(role)) {
    return { error: 'Sin permisos para asignar responsable' }
  }

  // Negocio del workspace
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!negocio) return { error: 'Negocio no encontrado' }

  // Staff del workspace + nombre para el log
  const { data: staff } = await db(supabase)
    .from('staff')
    .select('full_name')
    .eq('id', staffMiembroId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!staff) return { error: 'Staff no encontrado' }

  // El rol (comercial | operaciones) sale del área del staff y decide a quién se le
  // notifica según el stage de la etapa. Vive en `asignarResponsable` porque los otros
  // caminos de asignación tienen que escribirlo igual: una fila sin rol es invisible
  // para el routing y el aviso se va al supervisor con el responsable puesto.
  const asignacion = await asignarResponsable(supabase, {
    negocioId,
    staffId: staffMiembroId,
    assignedBy: userId ?? null,
  })
  if (asignacion.error) return { error: asignacion.error }

  await sincronizarResponsablePrincipal(supabase, negocioId, workspaceId)

  // Nombre del desplazado: se resuelve DESPUÉS de asignar, pero el id se capturó antes
  // de liberar el puesto (después de liberarlo ya no hay a quién preguntarle).
  let desplazadoNombre: string | null = null
  if (asignacion.desplazado) {
    const { data: previo } = await db(supabase)
      .from('staff')
      .select('full_name')
      .eq('id', asignacion.desplazado)
      .maybeSingle()
    desplazadoNombre = (previo as { full_name: string | null } | null)?.full_name ?? null
  }

  if (staffId) {
    const nombre = (staff as { full_name: string | null }).full_name ?? 'Sin nombre'
    const comoRol = asignacion.rol ? ` como ${asignacion.rol}` : ' (sin área: no recibe avisos de etapa)'
    const relevo = desplazadoNombre ? `, en reemplazo de ${desplazadoNombre}` : ''
    await db(supabase).from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_sistema',
      autor_id: staffId,
      contenido: `Responsable agregado: ${nombre}${comoRol}${relevo}`,
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null, rol: asignacion.rol, desplazado: desplazadoNombre }
}

export async function quitarResponsable(
  negocioId: string,
  staffMiembroId: string,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const allowed = ['owner', 'admin', 'supervisor']
  if (!role || !allowed.includes(role)) {
    return { error: 'Sin permisos para quitar responsable' }
  }

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!negocio) return { error: 'Negocio no encontrado' }

  const { error: delErr } = await db(supabase)
    .from('negocio_responsables')
    .delete()
    .eq('negocio_id', negocioId)
    .eq('staff_id', staffMiembroId)
  if (delErr) return { error: (delErr as { message: string }).message }

  await sincronizarResponsablePrincipal(supabase, negocioId, workspaceId)

  if (staffId) {
    const { data: staff } = await db(supabase)
      .from('staff')
      .select('full_name')
      .eq('id', staffMiembroId)
      .single()
    await db(supabase).from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_sistema',
      autor_id: staffId,
      contenido: `Responsable removido: ${(staff as { full_name: string | null } | null)?.full_name ?? 'Sin nombre'}`,
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// Constantes de cierre movidas a src/lib/negocios/constants.ts para evitar
// error "use server file can only export async functions"
