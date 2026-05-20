import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CobrosRecurrentesClient from './cobros-recurrentes-client'

export const runtime = 'nodejs'

export default async function CobrosRecurrentesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.workspace_id) redirect('/onboarding')

  // Validar módulo activo
  const { data: ws } = await supabase
    .from('workspaces')
    .select('modules')
    .eq('id', profile.workspace_id)
    .single()

  const modules = (ws as { modules: Record<string, boolean> | null } | null)?.modules
  if (!modules?.cobros_recurrentes) {
    redirect('/numeros')
  }

  // Cargar cuentas emitidas del workspace (anio actual + previos para historial)
  const anioActual = new Date().getFullYear()
  const { data: cuentas } = await supabase
    .from('cuentas_cobro_emitidas')
    .select(`
      id, numero, anio, mes, monto_total, estado, fecha_emision, fecha_vencimiento,
      pdf_drive_url, email_destinatarios, email_enviado_at, pagado_at, conciliado_at,
      empresa_id_pagador, cobros_ids,
      empresas:empresa_id_pagador (id, nombre, razon_social, codigo)
    `)
    .eq('workspace_id', profile.workspace_id)
    .gte('anio', anioActual - 1)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .order('numero', { ascending: false })

  return (
    <CobrosRecurrentesClient
      cuentas={cuentas ?? []}
      role={profile.role ?? 'admin'}
    />
  )
}
