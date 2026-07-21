import { notFound, redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import {
  getComercialPerfil,
  getComercialResumen,
  getMetasPorVendedorPeriodo,
} from '../../comercial-actions'
import { computeRanking } from '../../comercial-ranking'
import ComercialPerfilClient from './comercial-perfil-client'

interface Props {
  params: Promise<{ staff_id: string }>
  searchParams: Promise<{ mes?: string }>
}

export default async function ComercialPerfilPage({ params, searchParams }: Props) {
  const { staff_id } = await params
  const sp = await searchParams
  const { supabase, workspaceId, role, staffId } = await getWorkspace()
  if (!workspaceId || !supabase) redirect('/negocios')

  // Solo workspaces con el tablero comercial sobre negocios lo exponen.
  const { data: ws } = await supabase.from('workspaces').select('modules').eq('id', workspaceId).single()
  const modules = (ws?.modules as Record<string, boolean> | null) ?? {}
  if (!modules.comercial_negocios) redirect('/equipo')

  // Acceso: gerencia (owner/admin/supervisor) ve cualquier perfil. El vendedor
  // (operator) ve SOLO el suyo; si intenta abrir otro staff_id, se le redirige al
  // propio. Sin staff resuelto, no puede ver perfiles.
  const esGerencial = ['owner', 'admin', 'supervisor'].includes(role || '')
  if (!esGerencial) {
    if (role === 'operator' && staffId) {
      if (staff_id !== staffId) redirect(`/equipo/comercial/${staffId}`)
    } else {
      redirect('/negocios')
    }
  }

  // Periodo: default acumulado (mes ausente). Con ?mes=YYYY-MM se segmenta ese mes.
  // El periodo filtra TODOS los indicadores del perfil Y el ranking.
  let anio: number | null = null
  let mes: number | null = null
  if (sp.mes) {
    const [a, m] = sp.mes.split('-')
    const an = Number(a)
    const mn = Number(m)
    if (an > 0 && mn >= 1 && mn <= 12) {
      anio = an
      mes = mn
    }
  }

  const [perfil, resumen, metasPorVendedor] = await Promise.all([
    getComercialPerfil(staff_id, anio, mes),
    getComercialResumen(anio, mes),
    getMetasPorVendedorPeriodo(anio, mes),
  ])
  if (!perfil) notFound()

  // Ranking del equipo en el mismo periodo (acumulado o por mes). Cumplimiento por
  // vendedor requiere meta propia; sin meta, ese vendedor queda fuera de ese ranking.
  const ranking = computeRanking(resumen, metasPorVendedor)

  return (
    <ComercialPerfilClient
      perfil={perfil}
      ranking={ranking}
      staffId={perfil.sin_responsable ? null : staff_id}
      anio={anio}
      mes={mes}
    />
  )
}
