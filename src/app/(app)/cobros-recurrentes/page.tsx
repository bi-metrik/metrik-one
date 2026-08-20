import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import CobrosRecurrentesClient from './cobros-recurrentes-client'
import type { CobroDeCuentaUI } from './registrar-pago-dialog'
import { getCachedUser } from '@/lib/supabase/auth-user'

export const runtime = 'nodejs'

export default async function CobrosRecurrentesPage() {
  const supabase = await createClient()

  const { user } = await getCachedUser()
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

  // Los cobros que cada cuenta agrupa. Sin esto la pantalla no puede ofrecer
  // registrar el pago: el modelo decide contra COBROS enteros, no contra el
  // total de la cuenta (ver src/lib/cobros/registrar-pago-cuenta.ts).
  const idsCobros = Array.from(
    new Set((cuentas ?? []).flatMap(c => (c.cobros_ids ?? []) as string[])),
  )

  let cobros: CobroDeCuentaUI[] = []
  if (idsCobros.length > 0) {
    const { data, error: cobrosErr } = await supabase
      .from('cobros')
      .select('id, monto, fecha, negocio_id, numero_cuota, negocios:negocio_id (codigo, nombre)')
      .in('id', idsCobros)

    // Un error aquí no puede quedar como "no hay cobros": eso ofrecería registrar
    // un pago sobre una lista vacía. Se deja la acción apagada y se dice por qué.
    if (cobrosErr) {
      console.error('[cobros-recurrentes] no se pudieron leer los cobros:', cobrosErr.message)
    } else {
      cobros = (data ?? []).map(c => {
        const neg = c.negocios as unknown as { codigo: string | null; nombre: string | null } | null
        return {
          id: c.id,
          monto: Number(c.monto),
          fecha: c.fecha,
          numero_cuota: c.numero_cuota,
          negocio_label: neg ? `${neg.codigo ?? ''} ${neg.nombre ?? ''}`.trim() : 'Sin negocio',
        }
      })
    }
  }

  return (
    <CobrosRecurrentesClient
      cuentas={cuentas ?? []}
      cobros={cobros}
      role={profile.role ?? 'admin'}
    />
  )
}
