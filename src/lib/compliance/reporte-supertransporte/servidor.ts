import 'server-only'

/**
 * Reporte Supertransporte — lectura de la base. Las reglas viven en `conteo.ts` (puro).
 *
 * Se lee con el cliente de SERVICIO porque `compliance_segmentos` y `compliance_sujetos`
 * son server-only (sin grant a `authenticated`), igual que en el resto del módulo. Quien
 * llama tiene que haber resuelto el `workspaceId` desde la sesión (`getWorkspace`) y
 * validado el rol: esta función no es un endpoint.
 *
 * Toda lectura pasa por `traerTodo`, que LANZA si una página falla: una cifra regulatoria
 * armada sobre una lectura cortada es un cero falso, y eso es lo único que este tablero
 * no puede mostrar.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginar'
import { todayBogotaISO } from '@/lib/dates/bogota'
import {
  calcularReporte,
  listasDeMatches,
  type ConsultaReporte,
  type ExpedienteReporte,
  type ReporteSupertransporte,
  type SegmentoReporte,
  type SujetoReporte,
} from './conteo'
import {
  atajosRegulatorios,
  resolverPeriodo,
  sumarDias,
  type AtajoRegulatorio,
  type ParamsPeriodo,
} from './periodos'

/**
 * Lo que la pestaña necesita: las cifras SIN el listado nominal (los nombres y documentos
 * viajan solo en el Excel, no en cada render de /tableros) y los atajos del selector.
 */
export interface VistaSupertransporte {
  reporte: Omit<ReporteSupertransporte, 'nominal'>
  atajos: AtajoRegulatorio[]
  hoy: string
}

export async function cargarVistaSupertransporte(
  workspaceId: string,
  params: ParamsPeriodo,
  hoy: string = todayBogotaISO(),
): Promise<VistaSupertransporte> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { nominal, ...reporte } = await cargarReporteSupertransporte(workspaceId, params, hoy)
  return { reporte, atajos: atajosRegulatorios(hoy), hoy }
}

/** Dominio de correo de MéTRIK: una consulta hecha desde ahí es una prueba. */
export const DOMINIO_METRIK = '@metrik.com.co'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any

/**
 * Perfiles de MéTRIK entre quienes consultaron: `profiles.platform_admin` (el soporte que
 * entra a los espacios de clientes) o un correo @metrik.com.co (alguien del equipo con
 * cuenta normal dentro del espacio). Son pocos perfiles por workspace, así que el correo
 * se pide uno a uno a Auth.
 */
export async function creadoresMetrik(svc: Svc, ids: string[]): Promise<Set<string>> {
  const unicos = [...new Set(ids.filter(Boolean))]
  const excluidos = new Set<string>()
  if (unicos.length === 0) return excluidos

  const { data, error } = await svc.from('profiles').select('id, platform_admin').in('id', unicos)
  if (error) throw new Error(`[reporte-supertransporte] perfiles: ${error.message}`)
  for (const p of (data ?? []) as Array<{ id: string; platform_admin: boolean | null }>) {
    if (p.platform_admin === true) excluidos.add(p.id)
  }

  for (const id of unicos) {
    if (excluidos.has(id)) continue
    const { data: u, error: errU } = await svc.auth.admin.getUserById(id)
    if (errU) {
      // Un perfil sin usuario de Auth (borrado) no es de MéTRIK por sí solo; se cuenta.
      continue
    }
    const email = (u?.user?.email ?? '').toLowerCase()
    if (email.endsWith(DOMINIO_METRIK)) excluidos.add(id)
  }
  return excluidos
}

export async function cargarReporteSupertransporte(
  workspaceId: string,
  params: ParamsPeriodo,
  hoy: string = todayBogotaISO(),
): Promise<ReporteSupertransporte> {
  const svc: Svc = createServiceClient()
  const periodo = resolverPeriodo(params, hoy)
  // Límites en hora de Bogotá (UTC-5 todo el año, sin horario de verano).
  const desdeTs = `${periodo.desde}T00:00:00-05:00`
  const hastaTs = `${sumarDias(periodo.hasta, 1)}T00:00:00-05:00`

  const [delPeriodo, identidades, segmentos, sujetos, expedientes] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (a, b) =>
        svc
          .from('consultas_listas_dual')
          .select('id, created_at, created_by, documento_tipo, documento_numero, nombre_consultado, segmento_id, severidad, error_mensaje, total_matches, tier_maximo, matches')
          .eq('workspace_id', workspaceId)
          .gte('created_at', desdeTs)
          .lt('created_at', hastaTs)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      { etiqueta: 'reporte-supertransporte/consultas' },
    ),
    // Segmento de cada documento en TODO el historial: sirve para ubicar sujetos y
    // expedientes que no tienen consulta en el periodo. Sin `matches`: es lo pesado.
    traerTodo<Record<string, unknown>>(
      (a, b) =>
        svc
          .from('consultas_listas_dual')
          .select('id, created_at, documento_numero, nombre_consultado, segmento_id')
          .eq('workspace_id', workspaceId)
          .not('segmento_id', 'is', null)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      { etiqueta: 'reporte-supertransporte/identidades' },
    ),
    traerTodo<SegmentoReporte>(
      (a, b) =>
        svc
          .from('compliance_segmentos')
          .select('id, nombre, orden, activo')
          .eq('workspace_id', workspaceId)
          .order('orden', { ascending: true })
          .range(a, b),
      { etiqueta: 'reporte-supertransporte/segmentos' },
    ),
    traerTodo<SujetoReporte>(
      (a, b) =>
        svc
          .from('compliance_sujetos')
          .select('id, tipo, documento_tipo, documento_numero, nombre, segmento_id, relacion_desde, relacion_hasta')
          .eq('workspace_id', workspaceId)
          .order('id', { ascending: true })
          .range(a, b),
      { etiqueta: 'reporte-supertransporte/sujetos' },
    ),
    traerTodo<Record<string, unknown>>(
      (a, b) =>
        svc
          .from('kyc_expediente_ref')
          .select('id, documento_tipo, documento_numero, nombre, razon_social, estado_cache, creado_en, actualizado_en')
          .eq('workspace_id', workspaceId)
          .order('id', { ascending: true })
          .range(a, b),
      { etiqueta: 'reporte-supertransporte/expedientes' },
    ),
  ])

  const consultas: ConsultaReporte[] = delPeriodo.map((r) => ({
    id: r.id as string,
    created_at: r.created_at as string,
    created_by: (r.created_by as string | null) ?? null,
    documento_tipo: (r.documento_tipo as string | null) ?? null,
    documento_numero: (r.documento_numero as string | null) ?? null,
    nombre_consultado: (r.nombre_consultado as string | null) ?? null,
    segmento_id: (r.segmento_id as string | null) ?? null,
    severidad: (r.severidad as string | null) ?? null,
    error_mensaje: (r.error_mensaje as string | null) ?? null,
    total_matches: (r.total_matches as number | null) ?? 0,
    tier_maximo: (r.tier_maximo as string | null) ?? null,
    listas: listasDeMatches(r.matches),
  }))

  // Las identidades del historial entran como consultas "fantasma" fuera del periodo:
  // `calcularReporte` filtra por fecha para contar y las usa solo para ubicar segmentos.
  const enPeriodo = new Set(consultas.map((c) => c.id))
  const historial: ConsultaReporte[] = identidades
    .filter((r) => !enPeriodo.has(r.id as string))
    .map((r) => ({
      id: r.id as string,
      created_at: r.created_at as string,
      created_by: null,
      documento_tipo: null,
      documento_numero: (r.documento_numero as string | null) ?? null,
      nombre_consultado: (r.nombre_consultado as string | null) ?? null,
      segmento_id: (r.segmento_id as string | null) ?? null,
      severidad: null,
      error_mensaje: null,
      total_matches: 0,
      tier_maximo: null,
      listas: [],
    }))

  const excluidos = await creadoresMetrik(svc, consultas.map((c) => c.created_by ?? ''))

  return calcularReporte({
    periodo,
    consultas: [...consultas, ...historial],
    segmentos,
    creadoresExcluidos: excluidos,
    sujetos,
    expedientes: expedientes.map((x): ExpedienteReporte => ({
      id: x.id as string,
      documento_tipo: (x.documento_tipo as string | null) ?? null,
      documento_numero: (x.documento_numero as string | null) ?? null,
      nombre: ((x.nombre ?? x.razon_social) as string | null) ?? null,
      estado: x.estado_cache as string,
      creado_en: x.creado_en as string,
      actualizado_en: x.actualizado_en as string,
    })),
  })
}
