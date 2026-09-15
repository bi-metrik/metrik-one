// Repositorio de archivos de un negocio cuyo workspace guarda fuera de Google Drive.
// Reemplaza a la carpeta de Drive: lista lo que hay bajo `negocios/<id>/` en el bucket.
//
// La validación de acceso es LA MISMA del endpoint que abre cada archivo
// (`resolverAccesoNegocio`): la vista no puede listar lo que el endpoint no deja abrir.

import { notFound, redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { resolverAccesoNegocio } from '@/lib/almacenamiento/abrir'
import { dependenciasDeSesion } from '@/lib/almacenamiento/sesion'
import { ErrorAlmacenamiento } from '@/lib/almacenamiento/config'
import { almacenamientoExternoDe, type AlmacenamientoSupabaseExterno } from '@/lib/almacenamiento/supabase-externo'
import { agruparRepositorio } from '@/lib/almacenamiento/repositorio'
import RepositorioArchivos, { type EstadoRepositorio } from './repositorio-archivos'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ArchivosNegocioPage({ params }: Props) {
  const { id } = await params

  const acceso = await resolverAccesoNegocio(id, dependenciasDeSesion())
  if (acceso.tipo === 'error') {
    if (acceso.status === 401) redirect('/login')
    if (acceso.status === 404) notFound()
    // 403: el negocio existe en el workspace pero esta persona no lo puede ver. No se
    // pinta ni su nombre.
    return <RepositorioArchivos negocioId={id} negocio={null} estado={{ tipo: 'sin_acceso' }} />
  }

  let almacen: AlmacenamientoSupabaseExterno | null = null
  let errorConfig: string | null = null
  try {
    almacen = await almacenamientoExternoDe(acceso.workspaceId)
  } catch (e) {
    if (!(e instanceof ErrorAlmacenamiento)) throw e
    errorConfig = e.message
  }
  // Un workspace en Drive no tiene repositorio: su carpeta sigue en el detalle.
  // (`redirect` lanza: va fuera del try.)
  if (!almacen && !errorConfig) redirect(`/negocios/${id}`)

  const { supabase } = await getWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: negocioRow } = await db
    .from('negocios')
    .select('codigo, nombre, linea_id')
    .eq('id', id)
    .eq('workspace_id', acceso.workspaceId)
    .maybeSingle()
  const negocio = negocioRow
    ? { codigo: (negocioRow.codigo as string | null) ?? null, nombre: String(negocioRow.nombre ?? '') }
    : null

  let estado: EstadoRepositorio
  if (errorConfig || !almacen) {
    estado = { tipo: 'error', mensaje: errorConfig ?? 'El almacenamiento de este workspace no está configurado.' }
  } else {
    try {
      const [listado, declaradas] = await Promise.all([
        almacen.listarNegocio(id),
        subcarpetasDeLaLinea(db, (negocioRow?.linea_id as string | null) ?? null),
      ])
      estado = {
        tipo: 'ok',
        grupos: agruparRepositorio(id, listado.archivos, declaradas),
        truncado: listado.truncado,
      }
    } catch (e) {
      console.error('[repositorio-archivos] no se pudo listar', { negocioId: id, error: (e as Error).message })
      estado = { tipo: 'error', mensaje: 'No se pudo leer el repositorio de archivos. Intenta de nuevo en un momento.' }
    }
  }

  return <RepositorioArchivos negocioId={id} negocio={negocio} estado={estado} />
}

/**
 * Las subcarpetas que la línea declara en sus bloques (`config_extra.drive_subfolder`):
 * son los compartimentos donde cada bloque guarda su archivo, y se ven aunque estén
 * vacíos. Un bloque desactivado no aporta la suya.
 */
async function subcarpetasDeLaLinea(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  lineaId: string | null,
): Promise<string[]> {
  if (!lineaId) return []
  const { data: etapas, error: errEtapas } = await db.from('etapas_negocio').select('id').eq('linea_id', lineaId)
  if (errEtapas) throw new Error(`etapas de la línea: ${errEtapas.message}`)
  const etapaIds = ((etapas ?? []) as Array<{ id: string }>).map((e) => e.id)
  if (etapaIds.length === 0) return []

  const { data: configs, error: errConfigs } = await db
    .from('bloque_configs')
    .select('config_extra')
    .in('etapa_id', etapaIds)
  if (errConfigs) throw new Error(`bloques de la línea: ${errConfigs.message}`)

  const salida: string[] = []
  for (const c of (configs ?? []) as Array<{ config_extra: Record<string, unknown> | null }>) {
    const extra = c.config_extra ?? {}
    if (extra.desactivado === true) continue
    const sub = extra.drive_subfolder
    if (typeof sub === 'string' && sub.trim()) salida.push(sub.trim())
  }
  return salida
}
