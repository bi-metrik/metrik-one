'use server'

/**
 * Pagos que NO entran por la pasarela — registrar, ver, corregir y anular.
 *
 * ePayco viene fallando, asi que el pago externo dejo de ser la excepcion y paso a ser
 * un camino de trabajo. Hasta el 2026-08-11 esta superficie SOLO escribia: registraba
 * un pago y no mostraba nada de lo ya registrado, no admitia soporte, y no habia forma
 * de corregir un error sin SQL. Eso ya costo plata (ver `lib/cobros/sobreasignacion.ts`).
 *
 * Las cuatro capacidades viven aqui:
 *   1. `getPagosExternos`   — el listado, que hace visible el duplicado al cometerlo.
 *   2. `consultarReferencia`/`registrarPagoExterno` — la alerta de referencia
 *      sobre-asignada, ANTES de guardar (y como señal en el listado).
 *   3. soporte adjunto OBLIGATORIO, por la via de archivos que ya usa el producto
 *      (Storage -> carpeta del negocio en Drive).
 *   4. `editarPagoExterno` / `anularPagoExterno` — un cobro no se borra, se anula.
 *
 * GENERICO Y OPT-IN. Nada aqui es de un workspace concreto: el comportamiento se
 * declara en `workspaces.config_extra.pagos_externos`. Un workspace que no declare nada
 * recibe los defaults (soporte obligatorio, dos cuentas). Ver `leerConfigPagosExternos`.
 *
 * PERMISOS: `ctxPagosExternos` -> `puedeGestionarPagosExternos` (can-edit.ts). Esa
 * funcion es la fuente unica: la misma que consume la pantalla para dibujar los botones.
 */

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { ctxPagosExternos } from '@/lib/permissions/ctx-pagos-externos'
import { puedeGestionarPagosExternos } from '@/lib/permissions/can-edit'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { createSubfolderPath, uploadFileToDrive, setFilePublicByLink } from '@/lib/google-drive'
import { registrarPagoEnNegocio } from '@/lib/actions/conciliacion-actions'
import { recalcularNegocioPorCambioDeRecaudo } from '@/app/(app)/negocios/negocio-v2-actions'
import {
  construirRefExterna,
  normalizarRefExterna,
  referenciaVisible,
  MAX_LARGO_REF_EXTERNA,
} from '@/lib/cobros/referencia-externa'
import {
  evaluarReferencia,
  totalDeclaradoDeReferencia,
  type EstadoReferencia,
} from '@/lib/cobros/sobreasignacion'
import {
  esCobroAnulado,
  montoRegistrado,
  normalizarMotivoAnulacion,
  notaAnulacion,
  MOTIVO_ANULACION_MIN,
} from '@/lib/cobros/anulacion'

// Los tipos generados de `cobros` no declaran `split_json` ni las columnas nuevas de
// anulacion/soporte (ver la nota de tipos stale en `lib/negocios/recaudo-confirmado.ts`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

/** Bucket que ya usa el producto para documentos de negocio. No se inventa otro. */
const BUCKET = 've-documentos'
/** `cobros.tipo_cobro` que identifica un pago fuera de la pasarela. */
const TIPO_PAGO_EXTERNO = 'externo'

// ── Configuracion por workspace (opt-in) ─────────────────────────────────────

export interface CuentaPagoExterno {
  /** Se persiste en `cobros.fuente`. 'davivienda' u otro texto libre. */
  valor: string
  label: string
}

export interface ConfigPagosExternos {
  /**
   * Decision de Mauricio con criterio de Carmen (2026-08-11): el soporte es el UNICO
   * respaldo que existe cuando el pago no viene de la pasarela, asi que es obligatorio.
   *
   * El default es `true` y no `false`: un workspace que no declara nada recibe la
   * decision, no la ausencia de ella. Un proceso distinto puede apagarlo declarandolo,
   * y esa declaracion queda escrita — que es justo lo que se pide.
   */
  soporte_obligatorio: boolean
  /** Subcarpeta dentro de la carpeta del negocio en Drive. */
  drive_subfolder: string | null
  cuentas: CuentaPagoExterno[]
}

const CONFIG_POR_DEFECTO: ConfigPagosExternos = {
  soporte_obligatorio: true,
  drive_subfolder: '5. Soportes de pago',
  cuentas: [
    { valor: 'davivienda', label: 'Davivienda' },
    { valor: 'otra', label: 'Otra cuenta' },
  ],
}

async function leerConfigPagosExternos(
  supabase: unknown,
  workspaceId: string,
): Promise<ConfigPagosExternos> {
  const { data } = await db(supabase)
    .from('workspaces')
    .select('config_extra')
    .eq('id', workspaceId)
    .maybeSingle()

  const raw = ((data as { config_extra?: Record<string, unknown> | null } | null)?.config_extra
    ?.pagos_externos ?? {}) as Record<string, unknown>

  const cuentasRaw = Array.isArray(raw.cuentas) ? (raw.cuentas as Array<Record<string, unknown>>) : []
  const cuentas = cuentasRaw
    .map((c) => ({ valor: String(c?.valor ?? '').trim(), label: String(c?.label ?? '').trim() }))
    .filter((c) => c.valor && c.label)

  return {
    soporte_obligatorio: raw.soporte_obligatorio === false ? false : true,
    drive_subfolder:
      typeof raw.drive_subfolder === 'string' && raw.drive_subfolder.trim()
        ? raw.drive_subfolder.trim()
        : CONFIG_POR_DEFECTO.drive_subfolder,
    cuentas: cuentas.length > 0 ? cuentas : CONFIG_POR_DEFECTO.cuentas,
  }
}

// ── Tipos del panel ──────────────────────────────────────────────────────────

export interface SoportePago {
  url: string
  file_name: string
  mime_type: string | null
  drive_file_id: string | null
  storage_path: string | null
  subido_en: string | null
  /** true si quedo en Storage porque el empuje a Drive no pudo completarse. */
  pendiente_de_drive: boolean
}

/** Una fila del listado de pagos externos. */
export interface PagoExternoFila {
  cobro_id: string
  /** `external_ref` crudo (con su prefijo interno). */
  referencia: string
  /** Lo que se muestra: la referencia sin el prefijo interno. */
  referencia_label: string
  /** true si la referencia la genero el sistema porque no se escribio ninguna. */
  referencia_autogenerada: boolean
  /** Lo que este cobro registro. En un anulado, el valor que tenia al anularlo. */
  monto: number
  fecha: string | null
  fuente: string | null
  negocio_id: string | null
  negocio_codigo: string | null
  negocio_nombre: string | null
  empresa: string | null
  notas: string | null
  registrado_por: string | null
  registrado_en: string | null
  soporte: SoportePago | null
  anulado: boolean
  anulado_en: string | null
  anulado_por: string | null
  anulacion_motivo: string | null
  /** Cuantos negocios VIGENTES comparten esta referencia. >1 = pago repartido. */
  ref_negocios: number
  /** Estado de la referencia completa (no de esta fila). */
  ref_estado: EstadoReferencia
  ref_total: number
  ref_asignado: number
  ref_sin_asignar: number
  ref_excedente: number
}

export interface PanelPagosExternos {
  pagos: PagoExternoFila[]
  /**
   * Workspace de la sesion. La pantalla lo necesita para el path del soporte en
   * Storage: la policy del bucket exige que la primera carpeta sea el workspace.
   */
  workspace_id: string
  /** Resuelto con la MISMA funcion que usa el guard del servidor. */
  puede_gestionar: boolean
  soporte_obligatorio: boolean
  cuentas: CuentaPagoExterno[]
  /** Largo maximo de la referencia escrita a mano. */
  max_largo_referencia: number
  /** Largo minimo del motivo de anulacion. */
  min_largo_motivo: number
}

interface CobroRaw {
  id: string
  negocio_id: string | null
  monto: number | null
  monto_anulado: number | null
  tipo_cobro: string | null
  external_ref: string | null
  fuente: string | null
  fecha: string | null
  notas: string | null
  created_at: string | null
  created_by: string | null
  split_json: Record<string, unknown> | null
  soporte: Record<string, unknown> | null
  anulado_at: string | null
  anulado_por: string | null
  anulacion_motivo: string | null
}

// ── getPagosExternos ─────────────────────────────────────────────────────────

/**
 * El listado que faltaba: TODO lo registrado fuera de la pasarela, con su referencia,
 * su monto, su negocio, quien lo cargo, cuando, si tiene soporte y si la referencia
 * quedo sobre-asignada o a medio repartir.
 *
 * Es la pieza mas barata y la mas importante del frente: hace visible el duplicado en
 * el momento de cometerlo, que es la unica forma de que no se cometa.
 */
export async function getPagosExternos(): Promise<{
  data: PanelPagosExternos | null
  error?: string
}> {
  const ctx = await ctxPagosExternos()
  if (!ctx.ok) return { data: null, error: ctx.error }
  const { supabase, workspaceId, user } = ctx

  const config = await leerConfigPagosExternos(supabase, workspaceId)

  // El error se LEE: descartarlo deja un fallo mudo indistinguible de "no hay pagos".
  const { data: raw, error: qErr } = await db(supabase)
    .from('cobros')
    .select(
      'id, negocio_id, monto, monto_anulado, tipo_cobro, external_ref, fuente, fecha, notas, created_at, created_by, split_json, soporte, anulado_at, anulado_por, anulacion_motivo, negocios:negocio_id ( codigo, nombre, empresas:empresa_id ( nombre ) )',
    )
    .eq('workspace_id', workspaceId)
    .eq('tipo_cobro', TIPO_PAGO_EXTERNO)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (qErr) {
    return { data: null, error: `No se pudieron cargar los pagos: ${(qErr as { message: string }).message}` }
  }

  const filas = (raw ?? []) as Array<
    CobroRaw & {
      negocios: { codigo: string | null; nombre: string | null; empresas: { nombre: string | null } | null } | null
    }
  >

  // El estado de una referencia se mide sobre TODOS sus cobros del workspace, no solo
  // sobre los externos: un pago repartido puede tener una porcion ePayco y otra manual.
  const referencias = Array.from(
    new Set(filas.map((f) => f.external_ref).filter((r): r is string => !!r)),
  )
  const porReferencia = await cargarReferencias(supabase, workspaceId, referencias)

  const nombres = await resolverNombres(
    supabase,
    filas.flatMap((f) => [f.created_by, f.anulado_por]).filter((v): v is string => !!v),
  )

  const pagos: PagoExternoFila[] = filas.map((f) => {
    const ref = f.external_ref ?? ''
    const info = porReferencia.get(ref)
    const total = info?.total ?? montoRegistrado(f)
    const asignado = info?.asignado ?? montoRegistrado(f)
    const veredicto = evaluarReferencia({ total, registrado: asignado })

    return {
      cobro_id: f.id,
      referencia: ref,
      referencia_label: referenciaVisible(ref),
      referencia_autogenerada: ref.startsWith('FUERA-EPAYCO-'),
      monto: montoRegistrado(f),
      fecha: f.fecha,
      fuente: f.fuente,
      negocio_id: f.negocio_id,
      negocio_codigo: f.negocios?.codigo ?? null,
      negocio_nombre: f.negocios?.nombre ?? null,
      empresa: f.negocios?.empresas?.nombre ?? null,
      notas: f.notas,
      registrado_por: f.created_by ? (nombres.get(f.created_by) ?? null) : null,
      registrado_en: f.created_at,
      soporte: leerSoporte(f.soporte),
      anulado: esCobroAnulado(f),
      anulado_en: f.anulado_at,
      anulado_por: f.anulado_por ? (nombres.get(f.anulado_por) ?? null) : null,
      anulacion_motivo: f.anulacion_motivo,
      ref_negocios: info?.negocios ?? (f.negocio_id ? 1 : 0),
      ref_estado: veredicto.estado,
      ref_total: veredicto.total,
      ref_asignado: veredicto.asignado,
      ref_sin_asignar: veredicto.sin_asignar,
      ref_excedente: veredicto.excedente,
    }
  })

  return {
    data: {
      pagos,
      workspace_id: workspaceId,
      puede_gestionar: puedeGestionarPagosExternos(user),
      soporte_obligatorio: config.soporte_obligatorio,
      cuentas: config.cuentas,
      max_largo_referencia: MAX_LARGO_REF_EXTERNA,
      min_largo_motivo: MOTIVO_ANULACION_MIN,
    },
  }
}

interface EstadoRefCargado {
  total: number
  asignado: number
  negocios: number
  cobros: CobroRaw[]
}

/**
 * Carga el estado VIGENTE de un conjunto de referencias.
 *
 * `anulado_at is null` es explicito y no redundante: un cobro anulado tiene monto 0
 * (asi ninguna suma lo cuenta), pero aqui tambien se cuentan negocios y se lee el total
 * declarado, y eso va por PRESENCIA. Ver `lib/cobros/anulacion.ts`.
 */
async function cargarReferencias(
  supabase: unknown,
  workspaceId: string,
  referencias: string[],
): Promise<Map<string, EstadoRefCargado>> {
  const out = new Map<string, EstadoRefCargado>()
  if (referencias.length === 0) return out

  const { data } = await db(supabase)
    .from('cobros')
    .select(
      'id, negocio_id, monto, monto_anulado, tipo_cobro, external_ref, fuente, fecha, notas, created_at, created_by, split_json, soporte, anulado_at, anulado_por, anulacion_motivo',
    )
    .eq('workspace_id', workspaceId)
    .in('external_ref', referencias)
    .is('anulado_at', null)

  for (const c of ((data ?? []) as CobroRaw[])) {
    const ref = c.external_ref
    if (!ref) continue
    const acc = out.get(ref) ?? { total: 0, asignado: 0, negocios: 0, cobros: [] }
    acc.cobros.push(c)
    out.set(ref, acc)
  }

  for (const [, acc] of out) {
    acc.total = totalDeclaradoDeReferencia(
      acc.cobros.map((c) => ({
        monto: c.monto,
        split_json: c.split_json as { split_total?: unknown } | null,
      })),
    )
    acc.asignado = acc.cobros.reduce((s, c) => s + Number(c.monto ?? 0), 0)
    acc.negocios = new Set(acc.cobros.map((c) => c.negocio_id).filter(Boolean)).size
  }
  return out
}

/** Nombres de `profiles` para "quien lo cargo" y "quien lo anulo". */
async function resolverNombres(supabase: unknown, ids: string[]): Promise<Map<string, string>> {
  const unicos = Array.from(new Set(ids))
  const out = new Map<string, string>()
  if (unicos.length === 0) return out
  const { data } = await db(supabase).from('profiles').select('id, full_name').in('id', unicos)
  for (const p of ((data ?? []) as Array<{ id: string; full_name: string | null }>)) {
    if (p.full_name) out.set(p.id, p.full_name)
  }
  return out
}

function leerSoporte(raw: Record<string, unknown> | null): SoportePago | null {
  if (!raw || typeof raw !== 'object') return null
  const url = typeof raw.url === 'string' ? raw.url : ''
  if (!url) return null
  return {
    url,
    file_name: typeof raw.file_name === 'string' ? raw.file_name : 'soporte',
    mime_type: typeof raw.mime_type === 'string' ? raw.mime_type : null,
    drive_file_id: typeof raw.drive_file_id === 'string' ? raw.drive_file_id : null,
    storage_path: typeof raw.storage_path === 'string' ? raw.storage_path : null,
    subido_en: typeof raw.subido_en === 'string' ? raw.subido_en : null,
    pendiente_de_drive: raw.drive_file_id == null,
  }
}

// ── Negocios elegibles (buscador del formulario) ─────────────────────────────

export interface NegocioParaPagoExterno {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  empresa: string | null
}

export async function getNegociosParaPagoExterno(): Promise<{
  negocios: NegocioParaPagoExterno[]
  error?: string
}> {
  const ctx = await ctxPagosExternos()
  if (!ctx.ok) return { negocios: [], error: ctx.error }
  const { supabase, workspaceId } = ctx

  const { data: raw, error: qErr } = await db(supabase)
    .from('negocios')
    .select('id, codigo, nombre, empresas:empresa_id ( nombre )')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')
    .order('created_at', { ascending: false })
    // Sin limite explicito manda el tope del servidor (1000) y el filtrado es en el
    // cliente: un truncamiento silencioso se ve como "ese negocio no existe".
    .limit(5000)

  if (qErr) {
    return { negocios: [], error: `No se pudieron cargar los negocios: ${(qErr as { message: string }).message}` }
  }

  return {
    negocios: ((raw ?? []) as Array<{
      id: string
      codigo: string | null
      nombre: string | null
      empresas: { nombre: string | null } | null
    }>).map((n) => ({
      negocio_id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      empresa: n.empresas?.nombre ?? null,
    })),
  }
}

// ── consultarReferencia — la alerta ANTES de guardar ─────────────────────────

export interface PorcionReferencia {
  negocio_codigo: string | null
  negocio_nombre: string | null
  monto: number
  fecha: string | null
  fuente: string | null
}

export interface EstadoReferenciaConsulta {
  referencia: string
  referencia_label: string
  estado: EstadoReferencia
  total: number
  asignado: number
  sin_asignar: number
  excedente: number
  porciones: PorcionReferencia[]
}

/**
 * ¿Que hay registrado ya bajo esta referencia, y que pasaria si registro `monto` mas?
 *
 * La llama la pantalla mientras se escribe, para que la alerta aparezca DONDE SIRVE:
 * antes de guardar. El servidor vuelve a evaluarla al registrar — esto es ayuda, no
 * control.
 */
export async function consultarReferencia(
  referenciaEscrita: string,
  montoNuevo?: number,
  totalDeclarado?: number,
): Promise<{ data: EstadoReferenciaConsulta | null; error?: string }> {
  const ctx = await ctxPagosExternos()
  if (!ctx.ok) return { data: null, error: ctx.error }
  const { supabase, workspaceId } = ctx

  const referencia = construirRefExterna(referenciaEscrita)
  if (!referencia) return { data: null }

  const mapa = await cargarReferencias(supabase, workspaceId, [referencia])
  const info = mapa.get(referencia)
  const total = Math.max(info?.total ?? 0, Number(totalDeclarado ?? 0) || 0)
  const veredicto = evaluarReferencia({
    total,
    registrado: info?.asignado ?? 0,
    nuevo: Number(montoNuevo ?? 0) || 0,
  })

  const negocioIds = Array.from(new Set((info?.cobros ?? []).map((c) => c.negocio_id).filter((v): v is string => !!v)))
  const negocios = new Map<string, { codigo: string | null; nombre: string | null }>()
  if (negocioIds.length > 0) {
    const { data } = await db(supabase)
      .from('negocios')
      .select('id, codigo, nombre')
      .in('id', negocioIds)
    for (const n of ((data ?? []) as Array<{ id: string; codigo: string | null; nombre: string | null }>)) {
      negocios.set(n.id, { codigo: n.codigo, nombre: n.nombre })
    }
  }

  return {
    data: {
      referencia,
      referencia_label: referenciaVisible(referencia),
      estado: veredicto.estado,
      total: veredicto.total,
      asignado: veredicto.asignado,
      sin_asignar: veredicto.sin_asignar,
      excedente: veredicto.excedente,
      porciones: (info?.cobros ?? []).map((c) => ({
        negocio_codigo: c.negocio_id ? (negocios.get(c.negocio_id)?.codigo ?? null) : null,
        negocio_nombre: c.negocio_id ? (negocios.get(c.negocio_id)?.nombre ?? null) : null,
        monto: Number(c.monto ?? 0),
        fecha: c.fecha,
        fuente: c.fuente,
      })),
    },
  }
}

// ── registrarPagoExterno ─────────────────────────────────────────────────────

export interface SoporteSubidoInput {
  /** Path dentro del bucket `ve-documentos`. Lo sube el navegador, como los documentos. */
  storage_path: string
  file_name: string
  mime_type?: string
}

export interface RegistrarPagoExternoInput {
  negocio_id: string
  monto: number
  /** 'YYYY-MM-DD'. Default: hoy (Bogota). */
  fecha?: string
  /** `valor` de una de las cuentas configuradas. Se persiste en `cobros.fuente`. */
  fuente: string
  /** Numero de consignacion o comprobante. Opcional: si falta, se genera una interna. */
  referencia?: string
  /**
   * Valor TOTAL del pago original, cuando se va a repartir entre varios negocios.
   * Vacio = el pago vale lo que se esta registrando.
   */
  total_pago?: number
  soporte?: SoporteSubidoInput
  /**
   * La financiera vio la alerta de sobre-asignacion y decidio seguir. Requiere motivo:
   * queda en el timeline del negocio.
   */
  confirmar_sobreasignacion?: boolean
  justificacion?: string
}

export type ResultadoRegistroPago =
  | { success: true }
  | {
      success: false
      error: string
      code?: 'referencia_sobreasignada' | 'soporte_requerido'
      referencia?: EstadoReferenciaConsulta
    }

/**
 * Registra un pago que no entro por la pasarela.
 *
 * Tres barreras, en este orden:
 *   1. Soporte (si el workspace lo exige). Sin respaldo no se registra plata.
 *   2. Sobre-asignacion de la referencia. NO bloquea la repeticion de la referencia
 *      (el reparto es legitimo): bloquea que la suma supere el pago original, y se
 *      puede pasar con justificacion escrita, que queda guardada.
 *   3. Las que ya vivian en `registrarPagoEnNegocio` (via unica de escritura).
 *
 * Cuando la referencia YA tiene cobros vigentes, este registro se declara como REPARTO:
 * se estampa un `split_id` compartido y el `split_total` en todas las porciones. Sin
 * eso, el resto del sistema (panel de duplicados, congelamiento por duplicado) leeria
 * un pago repartido a proposito como un duplicado accidental y frenaria los negocios.
 */
export async function registrarPagoExterno(
  input: RegistrarPagoExternoInput,
): Promise<ResultadoRegistroPago> {
  const ctx = await ctxPagosExternos()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, userId, staffId } = ctx

  const negocioId = (input.negocio_id ?? '').trim()
  if (!negocioId) return { success: false, error: 'Elige el negocio al que cae el pago' }

  const monto = Number(input.monto)
  if (!Number.isFinite(monto) || monto <= 0) {
    return { success: false, error: 'El valor del pago debe ser mayor a cero' }
  }

  const config = await leerConfigPagosExternos(supabase, workspaceId)

  const fuenteElegida = (input.fuente ?? '').trim()
  const cuenta = config.cuentas.find((c) => c.valor === fuenteElegida)
  if (!cuenta) return { success: false, error: 'Elige la cuenta por la que entro el pago' }

  if (config.soporte_obligatorio && !input.soporte?.storage_path) {
    return {
      success: false,
      code: 'soporte_requerido',
      error: 'Adjunta el soporte del pago. Cuando el pago no entra por la pasarela, el comprobante es el unico respaldo que existe.',
    }
  }

  const refEscrita = normalizarRefExterna(input.referencia)
  if (refEscrita && refEscrita.length > MAX_LARGO_REF_EXTERNA) {
    return { success: false, error: `La referencia no puede superar ${MAX_LARGO_REF_EXTERNA} caracteres` }
  }

  const fecha = (input.fecha ?? '').trim() || todayBogotaISO()
  const referencia =
    construirRefExterna(refEscrita) ??
    `FUERA-EPAYCO-${fecha.replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`

  // ── Barrera 2: sobre-asignacion (sobre el MONTO, nunca sobre la unicidad) ──
  const mapa = await cargarReferencias(supabase, workspaceId, [referencia])
  const info = mapa.get(referencia)
  const yaRegistrado = info?.asignado ?? 0
  const totalDeclarado = Math.max(info?.total ?? 0, Number(input.total_pago ?? 0) || 0, monto)
  const veredicto = evaluarReferencia({ total: totalDeclarado, registrado: yaRegistrado, nuevo: monto })

  const justificacion = (input.justificacion ?? '').trim().slice(0, 300)
  if (veredicto.estado === 'sobreasignada' && !input.confirmar_sobreasignacion) {
    const { data: detalle } = await consultarReferencia(refEscrita ?? '', monto, input.total_pago)
    return {
      success: false,
      code: 'referencia_sobreasignada',
      error: `Esta referencia ya tiene ${cop(yaRegistrado)} registrados sobre un pago de ${cop(totalDeclarado)}. Sumar ${cop(monto)} la deja ${cop(veredicto.excedente)} por encima del pago original.`,
      referencia: detalle ?? undefined,
    }
  }
  if (veredicto.estado === 'sobreasignada' && !justificacion) {
    return {
      success: false,
      code: 'referencia_sobreasignada',
      error: 'Escribe por que este registro es correcto pese a superar el pago original.',
    }
  }

  // ── Soporte: Storage (ya subido por el navegador) -> carpeta del negocio en Drive ──
  let soporte: Record<string, unknown> | null = null
  if (input.soporte?.storage_path) {
    soporte = await archivarSoporte(supabase, workspaceId, negocioId, input.soporte, config.drive_subfolder, userId)
    if (!soporte) {
      return { success: false, error: 'No se pudo guardar el soporte del pago. Intenta de nuevo.' }
    }
  }

  const esReparto = (info?.cobros.length ?? 0) > 0
  const splitId = esReparto ? (splitIdExistente(info!.cobros) ?? randomUUID()) : null

  const res = await registrarPagoEnNegocio(
    supabase,
    workspaceId,
    staffId,
    {
      negocio_id: negocioId,
      fuente: cuenta.valor === 'davivienda' ? 'davivienda' : 'otra',
      fuente_nombre: cuenta.valor === 'davivienda' ? undefined : cuenta.valor,
      referencia,
      monto,
      fecha,
      tipo_cobro: TIPO_PAGO_EXTERNO,
      soporte,
      split_json: splitId
        ? { split_id: splitId, split_total: totalDeclarado, origen: 'financiera_externo' }
        : undefined,
      // El control de esta via es el de MONTO que acaba de correr arriba. El bloqueo
      // duro por referencia repetida no aplica aqui: repetirla es legitimo cuando el
      // pago se reparte, y ese es el caso de uso que este panel tiene que soportar.
      permitirRefCompartida: true,
    },
    'conciliacion',
  )
  if (!res.success) return { success: false, error: res.error }

  // Declarar el reparto tambien en las porciones que ya existian: si una queda sin
  // `split_id`, el panel de duplicados y el congelamiento por duplicado siguen leyendo
  // la referencia como un duplicado accidental y frenan los negocios.
  if (splitId && info) {
    await db(supabase)
      .from('cobros')
      .update({ split_json: { split_id: splitId, split_total: totalDeclarado, origen: 'financiera_externo' } })
      .eq('workspace_id', workspaceId)
      .eq('external_ref', referencia)
      .is('anulado_at', null)
      .is('split_json->>split_id', null)
  }

  await registrarEnTimeline(
    supabase,
    workspaceId,
    negocioId,
    staffId,
    [
      `Pago fuera de la pasarela registrado — ${cop(monto)}, cuenta ${cuenta.label}, referencia ${referenciaVisible(referencia)}.`,
      esReparto ? `La referencia se reparte entre varios negocios (total declarado ${cop(totalDeclarado)}).` : '',
      soporte ? 'Soporte adjunto.' : '',
      veredicto.estado === 'sobreasignada'
        ? `⚠️ Se registro por encima del pago original con justificacion: ${justificacion}`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  )

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/conciliacion')
  return { success: true }
}

function splitIdExistente(cobros: CobroRaw[]): string | null {
  for (const c of cobros) {
    const id = c.split_json?.split_id
    if (typeof id === 'string' && id) return id
  }
  return null
}

/**
 * Empuja el soporte del navegador (ya en Storage) a la carpeta del negocio en Drive.
 * Misma mecanica que `pushDocumentoBloqueToDrive`: no se inventa una via nueva.
 *
 * Si Drive falla, el soporte NO se pierde: queda la URL publica de Storage y la fila
 * lo declara como pendiente de archivar. Perder el registro del pago porque Drive no
 * respondio seria peor que archivarlo despues.
 */
async function archivarSoporte(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
  entrada: SoporteSubidoInput,
  subcarpeta: string | null,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const storagePath = entrada.storage_path
  // El path llega del navegador y abajo se lee con el cliente de servicio, que NO pasa
  // por RLS. Sin esta comprobacion, un path apuntado a otro workspace terminaria
  // archivado como soporte propio. La policy del bucket exige el mismo prefijo.
  if (!storagePath.startsWith(`${workspaceId}/`) || storagePath.includes('..')) {
    console.warn('[pagos-externos] soporte con path fuera del workspace, descartado')
    return null
  }

  const admin = createServiceClient()
  const fileName = entrada.file_name || storagePath.split('/').pop() || 'soporte'
  const mimeType = entrada.mime_type || mimeDesdeNombre(fileName)

  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)
  const base: Record<string, unknown> = {
    url: publicData?.publicUrl ?? '',
    file_name: fileName,
    mime_type: mimeType,
    storage_path: storagePath,
    drive_file_id: null,
    subido_por: userId,
    subido_en: new Date().toISOString(),
  }
  if (!base.url) return null

  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('carpeta_url, codigo')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const carpetaUrl = (negRaw as { carpeta_url: string | null } | null)?.carpeta_url ?? null
  const folderId = carpetaUrl?.match(/folders\/([-\w]+)/)?.[1] ?? null
  if (!folderId) return base // sin carpeta del negocio: queda en Storage, declarado.

  try {
    const { data: fileData, error: dlErr } = await admin.storage.from(BUCKET).download(storagePath)
    if (dlErr || !fileData) return base
    const buffer = Buffer.from(await fileData.arrayBuffer())
    const targetFolderId = await createSubfolderPath(subcarpeta, folderId, workspaceId)
    const subido = await uploadFileToDrive(buffer, fileName, mimeType, targetFolderId, workspaceId)
    await setFilePublicByLink(subido.fileId, workspaceId)
    return { ...base, url: subido.webViewLink, drive_file_id: subido.fileId }
  } catch (err) {
    console.warn(
      '[pagos-externos] soporte quedo en Storage, Drive no respondio:',
      err instanceof Error ? err.message : String(err),
    )
    return base
  }
}

function mimeDesdeNombre(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }
  return map[ext] ?? 'application/octet-stream'
}

// ── editarPagoExterno ────────────────────────────────────────────────────────

export interface EditarPagoExternoInput {
  cobro_id: string
  fecha?: string
  fuente?: string
  referencia?: string
  notas?: string
  confirmar_sobreasignacion?: boolean
  justificacion?: string
}

/**
 * Corrige los campos DESCRIPTIVOS de un pago: fecha, cuenta, referencia y nota.
 *
 * ⚠️ El MONTO no se edita, y el NEGOCIO tampoco. Los dos mueven plata: cambiarlos en
 * caliente dejaria un saldo distinto sin que nada lo delate y sin rastro de cual era el
 * valor anterior. Para eso esta anular y volver a registrar, que deja las dos filas.
 *
 * Un pago anulado no se edita: su historia esta cerrada.
 */
export async function editarPagoExterno(
  input: EditarPagoExternoInput,
): Promise<ResultadoRegistroPago> {
  const ctx = await ctxPagosExternos()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, staffId } = ctx

  const cobro = await leerPagoExterno(supabase, workspaceId, input.cobro_id)
  if (!cobro) return { success: false, error: 'Pago no encontrado' }
  if (esCobroAnulado(cobro)) {
    return { success: false, error: 'Este pago esta anulado. Su registro ya no se modifica.' }
  }

  const config = await leerConfigPagosExternos(supabase, workspaceId)
  const cambios: Record<string, unknown> = {}
  const descripcion: string[] = []

  if (input.fecha && input.fecha.trim() && input.fecha.trim() !== cobro.fecha) {
    cambios.fecha = input.fecha.trim()
    descripcion.push(`fecha ${cobro.fecha ?? '—'} → ${input.fecha.trim()}`)
  }

  if (input.fuente && input.fuente.trim()) {
    const cuenta = config.cuentas.find((c) => c.valor === input.fuente!.trim())
    if (!cuenta) return { success: false, error: 'Cuenta no valida' }
    const nuevaFuente = cuenta.valor === 'davivienda' ? 'davivienda' : cuenta.valor
    if (nuevaFuente !== cobro.fuente) {
      cambios.fuente = nuevaFuente
      descripcion.push(`cuenta ${cobro.fuente ?? '—'} → ${cuenta.label}`)
    }
  }

  if (input.notas !== undefined) {
    const notas = input.notas.trim().slice(0, 500)
    if (notas !== (cobro.notas ?? '')) {
      cambios.notas = notas
      descripcion.push('nota corregida')
    }
  }

  // La referencia SI es descriptiva (un numero de consignacion mal tecleado es el
  // error mas comun), pero es tambien la llave del control de duplicado: cambiarla
  // vuelve a pasar por la alerta de sobre-asignacion sobre la referencia DESTINO.
  if (input.referencia !== undefined) {
    const refEscrita = normalizarRefExterna(input.referencia)
    if (refEscrita && refEscrita.length > MAX_LARGO_REF_EXTERNA) {
      return { success: false, error: `La referencia no puede superar ${MAX_LARGO_REF_EXTERNA} caracteres` }
    }
    const nueva = construirRefExterna(refEscrita)
    if (nueva && nueva !== cobro.external_ref) {
      const mapa = await cargarReferencias(supabase, workspaceId, [nueva])
      const info = mapa.get(nueva)
      const total = Math.max(info?.total ?? 0, Number(cobro.monto ?? 0))
      const veredicto = evaluarReferencia({
        total,
        registrado: info?.asignado ?? 0,
        nuevo: Number(cobro.monto ?? 0),
      })
      if (veredicto.estado === 'sobreasignada' && !input.confirmar_sobreasignacion) {
        const { data: detalle } = await consultarReferencia(refEscrita ?? '', Number(cobro.monto ?? 0))
        return {
          success: false,
          code: 'referencia_sobreasignada',
          error: `Mover este pago a la referencia ${referenciaVisible(nueva)} la dejaria ${cop(veredicto.excedente)} por encima del pago original.`,
          referencia: detalle ?? undefined,
        }
      }
      cambios.external_ref = nueva
      descripcion.push(`referencia ${referenciaVisible(cobro.external_ref ?? '')} → ${referenciaVisible(nueva)}`)
    }
  }

  if (Object.keys(cambios).length === 0) return { success: true }

  const { error: upErr } = await db(supabase)
    .from('cobros')
    .update(cambios)
    .eq('id', cobro.id)
    .eq('workspace_id', workspaceId)
  if (upErr) {
    return { success: false, error: (upErr as { message?: string }).message ?? 'No se pudo corregir el pago' }
  }

  const justificacion = (input.justificacion ?? '').trim().slice(0, 300)
  await registrarEnTimeline(
    supabase,
    workspaceId,
    cobro.negocio_id,
    staffId,
    `Pago fuera de la pasarela corregido: ${descripcion.join(', ')}.${justificacion ? ` Justificacion: ${justificacion}` : ''} El monto y el negocio no se editan: para eso se anula y se vuelve a registrar.`,
  )

  revalidatePath('/conciliacion')
  if (cobro.negocio_id) revalidatePath(`/negocios/${cobro.negocio_id}`)
  return { success: true }
}

// ── anularPagoExterno ────────────────────────────────────────────────────────

/**
 * ANULA un pago. No lo borra.
 *
 * La fila se conserva con motivo, autor y fecha, y deja de contar para saldos, gates y
 * cartera: su `monto` queda en 0 y el valor original se preserva en `monto_anulado`
 * (el razonamiento completo esta en `lib/cobros/anulacion.ts`).
 *
 * Y no basta con dejar de contar: hay decisiones que YA se tomaron con esa plata. Por
 * eso llama a `recalcularNegocioPorCambioDeRecaudo`, que des-concilia el negocio,
 * reevalua sus bloques de cobros y REABRE el gate de anticipo si se habia cerrado solo
 * por saldo y el saldo ya no alcanza. Un cobro anulado que deja un gate cerrado detras
 * es exactamente el estado que la anulacion existe para evitar.
 */
export async function anularPagoExterno(
  cobroId: string,
  motivo: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await ctxPagosExternos()
  if (!ctx.ok) return { success: false, error: ctx.error }
  const { supabase, workspaceId, userId, staffId } = ctx

  const motivoLimpio = normalizarMotivoAnulacion(motivo)
  if (!motivoLimpio) {
    return {
      success: false,
      error: `Escribe el motivo de la anulacion (minimo ${MOTIVO_ANULACION_MIN} caracteres). Queda guardado con tu nombre y la fecha.`,
    }
  }

  const cobro = await leerPagoExterno(supabase, workspaceId, cobroId)
  if (!cobro) return { success: false, error: 'Pago no encontrado' }
  if (esCobroAnulado(cobro)) return { success: false, error: 'Este pago ya estaba anulado' }

  const montoOriginal = Number(cobro.monto ?? 0)
  const ahora = new Date().toISOString()

  const { error: upErr } = await db(supabase)
    .from('cobros')
    .update({
      monto: 0,
      monto_anulado: montoOriginal,
      anulado_at: ahora,
      anulado_por: userId,
      anulacion_motivo: motivoLimpio,
      notas: `${notaAnulacion(motivoLimpio, ahora)}${cobro.notas ? ` · ${cobro.notas}` : ''}`.slice(0, 1000),
    })
    .eq('id', cobro.id)
    .eq('workspace_id', workspaceId)
    // Carrera: si otra sesion lo anulo entre la lectura y esta escritura, este filtro
    // hace que la segunda no pise el `monto_anulado` de la primera con un 0.
    .is('anulado_at', null)

  if (upErr) {
    return { success: false, error: (upErr as { message?: string }).message ?? 'No se pudo anular el pago' }
  }

  if (cobro.negocio_id) {
    await registrarEnTimeline(
      supabase,
      workspaceId,
      cobro.negocio_id,
      staffId,
      `Pago ANULADO — ${cop(montoOriginal)}, referencia ${referenciaVisible(cobro.external_ref ?? '')}. Motivo: ${motivoLimpio}. Deja de contar para el saldo del negocio.`,
    )
    // Lo que dependia de esa plata se recalcula. Ver el comentario de la funcion.
    await recalcularNegocioPorCambioDeRecaudo(cobro.negocio_id, `anulacion de pago (${motivoLimpio})`)
    revalidatePath(`/negocios/${cobro.negocio_id}`)
  }

  revalidatePath('/conciliacion')
  return { success: true }
}

// ── Helpers internos ─────────────────────────────────────────────────────────

async function leerPagoExterno(
  supabase: unknown,
  workspaceId: string,
  cobroId: string,
): Promise<CobroRaw | null> {
  if (!cobroId) return null
  const { data } = await db(supabase)
    .from('cobros')
    .select(
      'id, negocio_id, monto, monto_anulado, tipo_cobro, external_ref, fuente, fecha, notas, created_at, created_by, split_json, soporte, anulado_at, anulado_por, anulacion_motivo',
    )
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const fila = data as CobroRaw | null
  if (!fila) return null
  // Esta superficie solo gobierna pagos fuera de la pasarela. Un cobro de ePayco o una
  // porcion de reparto del comercial se corrigen por su propio camino, con sus reglas.
  if (fila.tipo_cobro !== TIPO_PAGO_EXTERNO) return null
  return fila
}

async function registrarEnTimeline(
  supabase: unknown,
  workspaceId: string,
  negocioId: string | null,
  staffId: string | null,
  contenido: string,
) {
  if (!negocioId || !staffId) return
  try {
    await db(supabase).from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'comentario',
      // activity_log.autor_id es FK a staff(id), NO a profiles. Campo minado conocido.
      autor_id: staffId,
      contenido: contenido.slice(0, 1000),
    })
  } catch {
    /* el registro ya quedo: un fallo del log no lo revierte */
  }
}

function cop(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0)
}
