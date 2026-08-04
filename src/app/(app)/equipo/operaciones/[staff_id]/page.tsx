import { notFound, redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { bogotaYearMonth } from '@/lib/dates/bogota'
import { getOperacionesBono, getOperacionesDetalle } from '../../../tableros/operaciones-actions'
import OperacionesPerfilClient from './operaciones-perfil-client'

interface Props {
  params: Promise<{ staff_id: string }>
  searchParams: Promise<{ mes?: string }>
}

export default async function OperacionesPerfilPage({ params, searchParams }: Props) {
  const { staff_id } = await params
  const sp = await searchParams
  const { supabase, workspaceId, role, staffId } = await getWorkspace()
  if (!workspaceId || !supabase) redirect('/negocios')

  const { data: ws } = await supabase.from('workspaces').select('modules').eq('id', workspaceId).single()
  const modules = (ws?.modules as Record<string, boolean> | null) ?? {}
  if (!modules.operaciones_bonos) redirect('/equipo')

  // Acceso: gerencia ve cualquier hoja. El operativo entra a la de cualquiera de
  // sus pares —eso se acordo a proposito, la comparacion motiva— pero el DINERO
  // de los demas no viaja: lo recorta `getOperacionesBono` en el servidor.
  const esGerencial = ['owner', 'admin', 'supervisor'].includes(role || '')
  if (!esGerencial && role !== 'operator') redirect('/negocios')

  // Periodo: por defecto el mes en curso en hora de Bogota.
  const mesParam = sp.mes ?? bogotaYearMonth()
  const [anioStr, mesStr] = mesParam.split('-')
  const anio = Number(anioStr)
  const mes = Number(mesStr)
  if (!(anio > 0) || !(mes >= 1 && mes <= 12)) redirect('/equipo')

  const [resumen, detalle] = await Promise.all([
    getOperacionesBono(anio, mes),
    getOperacionesDetalle(staff_id, anio, mes),
  ])
  if (!resumen || !detalle) notFound()

  const persona = resumen.personas.find(p => p.staff_id === staff_id)
  const esSupervisor = resumen.supervisor?.staff_id === staff_id
  if (!persona && !esSupervisor) notFound()

  return (
    <OperacionesPerfilClient
      persona={persona ?? null}
      supervisor={esSupervisor ? resumen.supervisor : null}
      equipo={resumen.personas}
      parametros={resumen.parametros}
      calidadMedida={resumen.calidad_medida}
      detalle={detalle}
      anio={anio}
      mes={mes}
      esPropia={staff_id === staffId}
    />
  )
}
