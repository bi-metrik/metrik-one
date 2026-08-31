'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { columnaDirectivo, COLUMNAS_DIRECTIVO, type ColumnaDirectivo } from '@/lib/dian/agrupacion-directivo'

/** Una celda de la matriz de operaciones, tal como la devuelve la RPC (seccional cruda). */
type FilaCruda = { fila_orden: number; fila: string; seccional: string; cantidad: number }
type CeldaSeccional = { seccional: string; cantidad: number }

type DirectivoCrudo = {
  comercial: {
    leads_generados: number
    leads_calificados: number
    negocios_cerrados: number
    primer_pago: number
    segundo_pago: number
    ventas_totales: number
  }
  metas: {
    meta_ventas_mensual?: number | null
    meta_leads_mensual?: number | null
    meta_leads_calificados_mensual?: number | null
    meta_negocios_mensual?: number | null
  }
  operaciones: FilaCruda[]
  terminados: CeldaSeccional[]
  citas: CeldaSeccional[]
}

export type FilaProceso = {
  orden: number
  nombre: string
  /** Una entrada por columna del directivo, en el orden de COLUMNAS_DIRECTIVO. */
  columnas: Record<ColumnaDirectivo, number>
  total: number
}

export type DirectivoData = {
  anio: number
  mes: number
  comercial: DirectivoCrudo['comercial']
  metas: DirectivoCrudo['metas']
  operaciones: FilaProceso[]
  citas: { columnas: Record<ColumnaDirectivo, number>; total: number }
  totalCartera: number
}

function columnasVacias(): Record<ColumnaDirectivo, number> {
  return Object.fromEntries(COLUMNAS_DIRECTIVO.map(c => [c, 0])) as Record<ColumnaDirectivo, number>
}

/**
 * Datos de la pestana Direccion: la replica de lo que JD llena a mano en el Sheet.
 *
 * La agrupacion de seccionales en las cinco columnas se hace AQUI, no en SQL: el
 * catalogo canonico vive en `@/lib/dian/seccionales` y copiarlo a la base crearia una
 * segunda fuente que se desincroniza el dia que la DIAN cambie una seccional.
 */
export async function getDirectivo(anio: number, mes: number): Promise<DirectivoData | null> {
  const { supabase, workspaceId, role } = await getWorkspace()
  if (!supabase || !workspaceId) return null

  // Mismo gate que el tablero comercial: cifras agregadas de toda la operacion.
  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) return null
  if (!['owner', 'admin', 'supervisor'].includes(role || '')) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_directivo_soena', {
    p_workspace_id: workspaceId,
    p_anio: anio,
    p_mes: mes,
  })
  if (error || !data) return null

  const crudo = data as DirectivoCrudo

  // La matriz se arma sobre las filas que la RPC devolvio. Una fila del mapeo sin un
  // solo caso NO se omite: el Sheet de JD tiene esas filas en blanco y su ausencia se
  // leeria como que la etapa desaparecio del proceso.
  const porOrden = new Map<number, FilaProceso>()
  for (const f of crudo.operaciones ?? []) {
    let fila = porOrden.get(f.fila_orden)
    if (!fila) {
      fila = { orden: f.fila_orden, nombre: f.fila, columnas: columnasVacias(), total: 0 }
      porOrden.set(f.fila_orden, fila)
    }
    fila.columnas[columnaDirectivo(f.seccional)] += f.cantidad
    fila.total += f.cantidad
  }

  // Los completados no tienen etapa viva y entran por estado a "Proceso terminado".
  const terminada = [...porOrden.values()].find(f => f.nombre === 'Proceso terminado')
  if (terminada) {
    for (const t of crudo.terminados ?? []) {
      terminada.columnas[columnaDirectivo(t.seccional)] += t.cantidad
      terminada.total += t.cantidad
    }
  }

  const citas = { columnas: columnasVacias(), total: 0 }
  for (const c of crudo.citas ?? []) {
    citas.columnas[columnaDirectivo(c.seccional)] += c.cantidad
    citas.total += c.cantidad
  }

  const operaciones = [...porOrden.values()].sort((a, b) => a.orden - b.orden)

  return {
    anio,
    mes,
    comercial: crudo.comercial,
    metas: crudo.metas ?? {},
    operaciones,
    citas,
    totalCartera: operaciones.reduce((s, f) => s + f.total, 0),
  }
}
