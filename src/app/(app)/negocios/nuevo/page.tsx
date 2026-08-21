import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getAliadosActivos } from '@/app/(app)/directorio/aliados/actions'
import NuevoNegocioForm from './nuevo-negocio-form'
import { getCachedUser } from '@/lib/supabase/auth-user'

export default async function NuevoNegocioPage() {
  const supabase = await createClient()
  const { user } = await getCachedUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/onboarding')

  // Lineas/flujos del workspace — visibles para todo workspace (no solo clarity).
  // Solo activos. Si el workspace tiene >= 1 linea, el form muestra el selector.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lineasData } = await (supabase as any)
    .from('lineas_negocio')
    .select('id, nombre, descripcion, numero')
    .eq('workspace_id', profile.workspace_id)
    .eq('is_active', true)
    .order('numero')
  const lineas = (lineasData ?? []) as { id: string; nombre: string; descripcion: string | null; numero: number }[]

  // Líneas con nombre automático = contacto (config_extra.negocio_codigo_format).
  // El form oculta el campo "nombre del negocio" para esas líneas.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (supabase as any)
    .from('workspaces')
    .select('config_extra, modules')
    .eq('id', profile.workspace_id)
    .single()
  const codigoFormat = (ws?.config_extra?.negocio_codigo_format ?? []) as Array<{ linea_id?: string; nombre_auto?: string }>
  const lineasAutoNombre = Array.isArray(codigoFormat)
    ? codigoFormat.filter(r => r.nombre_auto === 'contacto' && r.linea_id).map(r => r.linea_id as string)
    : []

  // Aliados activos para el origen 'alianza'. Solo se cargan (y solo se ofrece
  // la opción) si el workspace tiene el módulo `aliados`: sin él no hay contra
  // qué marcar la alianza y ofrecerla dejaría el negocio en un callejón sin salida.
  const aliadosHabilitado = (ws?.modules as Record<string, boolean> | null)?.aliados === true
  const aliados = aliadosHabilitado ? await getAliadosActivos() : []

  return (
    <NuevoNegocioForm
      lineas={lineas}
      lineasAutoNombre={lineasAutoNombre}
      aliados={aliados}
      aliadosHabilitado={aliadosHabilitado}
    />
  )
}
