import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { IDS_MODULO, MODULOS, type IdModulo } from '@/lib/modulos/catalogo'

/**
 * Qué módulos tiene un workspace y qué tipo de servicio del catálogo cubre cada uno.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §2.4 y §3 (A2).
 *
 * ## Qué puede y qué no puede decir esta entrega
 *
 * **No hay servicios contratados todavía** (`servicios_contratados` nace vacía; los 7 contratos
 * de hoy son carga de datos en producción y van en A3). Así que esto no puede decir «al día» ni
 * «próxima renovación»: **lo dice cuando lo sepa, y mientras tanto lo declara**. Inventar un
 * estado sobre una tabla vacía sería la pantalla sana que miente.
 *
 * Lo que SÍ puede decir hoy, y es útil: qué módulos están encendidos, cuál es el tipo de
 * servicio que le corresponde a cada uno y bajo qué condiciones se vende (disparador de cobro,
 * tratamiento de IVA, versión y de dónde salió).
 *
 * ## Por qué lee con el cliente de servicio
 *
 * Las tablas del catálogo son server-only: sin grants, invisibles para `authenticated` aunque
 * el RLS fuera perfecto. La lista de precios de todos los productos no tiene por qué ser
 * legible con la anon key. El filtro por workspace lo pone esta función, no la base.
 */

export interface ServicioDelCatalogo {
  slug: string
  nombre: string
  modulo: string
  disparadorCobro: 'ciclo' | 'consumo' | 'unico'
  versionVigente: number
  activo: boolean
  tratamientoIva: string | null
  descripcion: string | null
  /** De dónde salió, para que la pantalla pueda citarlo: el catálogo se lee, no se edita. */
  fuenteRuta: string | null
}

export interface ModuloDelWorkspace {
  id: IdModulo
  nombre: string
  clave: string
  inicio: string
  /** El tipo de servicio que lo cubre, si el catálogo ya lo tiene. */
  servicio: ServicioDelCatalogo | null
}

export interface CatalogoDeWorkspace {
  modulos: ModuloDelWorkspace[]
  /** Todo el catálogo. Solo se llena para la vista de operador. */
  catalogo: ServicioDelCatalogo[]
  /** Cuántos contratos tiene este workspace. Hoy 0 hasta A3; la pantalla lo dice tal cual. */
  contratos: number
  /** Una lectura que falló no se disfraza de «no hay nada». */
  error: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

async function leerCatalogo(svc: Cliente): Promise<{ servicios: ServicioDelCatalogo[]; error: string | null }> {
  const { data, error } = await svc
    .from('catalogo_servicios')
    .select('slug, nombre, modulo, disparador_cobro, version_vigente, activo')
    .order('nombre')
  if (error) return { servicios: [], error: error.message }

  const filas = (data ?? []) as {
    slug: string
    nombre: string
    modulo: string
    disparador_cobro: ServicioDelCatalogo['disparadorCobro']
    version_vigente: number
    activo: boolean
  }[]
  if (filas.length === 0) return { servicios: [], error: null }

  // La definición y la ruta fuente viven en la versión vigente de cada servicio. Se piden solo
  // las versiones que hacen falta, no la historia entera.
  const { data: versiones, error: e2 } = await svc
    .from('catalogo_servicios_versiones')
    .select('slug, version, definicion, fuente_ruta')
    .in('slug', filas.map((f) => f.slug))
  if (e2) return { servicios: [], error: e2.message }

  const porSlugVersion = new Map<string, { definicion: Record<string, unknown>; fuente_ruta: string }>()
  for (const v of (versiones ?? []) as { slug: string; version: number; definicion: Record<string, unknown>; fuente_ruta: string }[]) {
    porSlugVersion.set(`${v.slug}@${v.version}`, { definicion: v.definicion, fuente_ruta: v.fuente_ruta })
  }

  return {
    error: null,
    servicios: filas.map((f) => {
      const v = porSlugVersion.get(`${f.slug}@${f.version_vigente}`)
      return {
        slug: f.slug,
        nombre: f.nombre,
        modulo: f.modulo,
        disparadorCobro: f.disparador_cobro,
        versionVigente: f.version_vigente,
        activo: f.activo,
        tratamientoIva: (v?.definicion?.tratamiento_iva as string | undefined) ?? null,
        descripcion: (v?.definicion?.descripcion as string | undefined) ?? null,
        fuenteRuta: v?.fuente_ruta ?? null,
      }
    }),
  }
}

export async function catalogoDeWorkspace(
  workspaceId: string,
  opciones: { vistaOperador?: boolean } = {},
): Promise<CatalogoDeWorkspace> {
  const svc = createServiceClient() as Cliente
  const vacio: CatalogoDeWorkspace = { modulos: [], catalogo: [], contratos: 0, error: null }

  const [ws, cat, contratos] = await Promise.all([
    svc.from('workspaces').select('modules').eq('id', workspaceId).single(),
    leerCatalogo(svc),
    svc
      .from('servicios_contratados')
      .select('id', { count: 'exact', head: true })
      .or(`workspace_pagador_id.eq.${workspaceId},workspace_id.eq.${workspaceId}`),
  ])

  // Un error de lectura se dice. El `?? []` que lo convierte en «no hay nada» ya costó una
  // pantalla que afirmaba «cero fuentes consultadas» cuando la columna no existía.
  const error = ws.error?.message ?? cat.error ?? contratos.error?.message ?? null
  if (error) return { ...vacio, error }

  const modules = ((ws.data?.modules ?? {}) as Record<string, unknown>) ?? {}
  const porModulo = new Map(cat.servicios.map((s) => [s.modulo, s]))

  const modulos = IDS_MODULO.filter((id) => modules[MODULOS[id].clave] === true).map((id) => ({
    id,
    nombre: MODULOS[id].nombre,
    clave: MODULOS[id].clave,
    inicio: MODULOS[id].inicio,
    servicio: porModulo.get(MODULOS[id].clave) ?? null,
  }))

  return {
    modulos,
    catalogo: opciones.vistaOperador ? cat.servicios : [],
    contratos: contratos.count ?? 0,
    error: null,
  }
}
