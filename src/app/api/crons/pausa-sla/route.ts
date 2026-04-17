import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cron de SLA de pausa de negocios
// - Reactiva negocios cuya fecha de reapertura llega
// - Notifica al responsable que el negocio volvió al pipeline activo
//
// Schedule: diario 06:00 COT = 11:00 UTC (vercel.json)
// Gobernado por workspaces.modules.pausa_sla_auto_enabled (default: false).
// La escalada por inactividad post-reactivación la cubre el cron
// /api/crons/inactividad-oportunidades que ya existe.

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')

  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const hoy = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  // 1. Workspaces con SLA automático activo
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, modules')
    .filter('modules->pausa_sla_auto_enabled', 'eq', true)

  if (!workspaces || workspaces.length === 0) {
    return NextResponse.json({ ok: true, reactivados: 0, notificaciones: 0, workspaces: 0 })
  }

  const workspaceIds = workspaces.map(w => w.id)

  // 2. Negocios pausados cuya fecha de reapertura llegó
  const { data: negocios } = await supabase
    .from('negocios')
    .select('id, workspace_id, nombre, codigo, responsable_id, pausado_hasta')
    .eq('pausado', true)
    .eq('estado', 'abierto')
    .in('workspace_id', workspaceIds)
    .lte('pausado_hasta', hoy)

  if (!negocios || negocios.length === 0) {
    return NextResponse.json({ ok: true, reactivados: 0, notificaciones: 0, workspaces: workspaceIds.length })
  }

  let reactivados = 0
  let notificacionesCreadas = 0
  const now = new Date().toISOString()

  for (const n of negocios) {
    // Reactivar: preserva veces_pausado (pausa YA se consumió al hacerla)
    const { error: updErr } = await supabase
      .from('negocios')
      .update({
        pausado: false,
        pausado_hasta: null,
        motivo_pausa: null,
        motivo_pausa_detalle: null,
        updated_at: now,
      })
      .eq('id', n.id)

    if (updErr) {
      console.error('[pausa-sla] Error reactivando', n.id, updErr)
      continue
    }

    reactivados++

    // Log en activity_log
    await supabase.from('activity_log').insert({
      workspace_id: n.workspace_id,
      entidad_tipo: 'negocio',
      entidad_id: n.id,
      tipo: 'cambio_estado',
      contenido: `Negocio reactivado automaticamente (fecha de reapertura: ${n.pausado_hasta})`,
      valor_nuevo: 'activo',
    })

    // Notificar al responsable
    if (n.responsable_id) {
      // responsable_id apunta a staff; notificaciones.destinatario_id apunta a profiles.
      // Buscar el profile del staff para notificar.
      const { data: staff } = await supabase
        .from('staff')
        .select('profile_id')
        .eq('id', n.responsable_id)
        .maybeSingle()

      const profileId = (staff as { profile_id: string | null } | null)?.profile_id
      if (profileId) {
        const nombre = n.codigo ? `${n.codigo} — ${n.nombre}` : n.nombre
        const { error: notifErr } = await supabase.from('notificaciones').insert({
          workspace_id: n.workspace_id,
          destinatario_id: profileId,
          tipo: 'negocio_reactivado',
          estado: 'pendiente',
          contenido: `"${nombre}" se reactivo hoy — vuelve al pipeline`,
          entidad_tipo: 'negocio',
          entidad_id: n.id,
          deep_link: `/negocios/${n.id}`,
          metadata: { fecha_reapertura: n.pausado_hasta },
        })
        if (!notifErr) notificacionesCreadas++
      }
    }
  }

  return NextResponse.json({
    ok: true,
    reactivados,
    notificaciones: notificacionesCreadas,
    workspaces: workspaceIds.length,
    timestamp: now,
  })
}
