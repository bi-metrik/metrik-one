import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// N6 — Cron de streak roto
// Si el usuario no registró ningún gasto, cobro, hora NI cambio de saldo_banco ayer
// y tenía streak activo (>0 días), generar notificación.

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

  const now = new Date()
  // "Ayer" en Colombia (UTC-5)
  const ayer = new Date(now)
  ayer.setDate(ayer.getDate() - 1)
  const ayerStr = ayer.toISOString().split('T')[0]
  const ayerStart = `${ayerStr}T00:00:00.000Z`
  const ayerEnd = `${ayerStr}T23:59:59.999Z`

  let notificacionesCreadas = 0

  // Obtener todos los perfiles activos con su workspace
  const { data: perfiles } = await supabase
    .from('profiles')
    .select('id, workspace_id, full_name')

  if (!perfiles || perfiles.length === 0) {
    return NextResponse.json({ ok: true, notificaciones: 0 })
  }

  for (const perfil of perfiles) {
    // Calcular streak actual: cuántos días consecutivos tiene el usuario con actividad
    // Simplificación: verificar si registró algo HOY o en los últimos días
    // Si el streak es 0, no hay racha que romper

    // Verificar si hubo actividad AYER para este workspace
    const [gastosAyer, cobrosAyer, horasAyer, saldosAyer] = await Promise.all([
      supabase
        .from('gastos')
        .select('id')
        .eq('workspace_id', perfil.workspace_id)
        .gte('created_at', ayerStart)
        .lte('created_at', ayerEnd)
        .eq('created_by', perfil.id)
        .limit(1),
      supabase
        .from('cobros')
        .select('id')
        .eq('workspace_id', perfil.workspace_id)
        .gte('created_at', ayerStart)
        .lte('created_at', ayerEnd)
        .eq('created_by', perfil.id)
        .limit(1),
      supabase
        .from('horas')
        .select('id')
        .eq('workspace_id', perfil.workspace_id)
        .gte('created_at', ayerStart)
        .lte('created_at', ayerEnd)
        .limit(1),
      supabase
        .from('saldos_banco')
        .select('id')
        .eq('workspace_id', perfil.workspace_id)
        .gte('created_at', ayerStart)
        .lte('created_at', ayerEnd)
        .limit(1),
    ])

    const huboActividadAyer = (
      (gastosAyer.data?.length ?? 0) > 0 ||
      (cobrosAyer.data?.length ?? 0) > 0 ||
      (horasAyer.data?.length ?? 0) > 0 ||
      (saldosAyer.data?.length ?? 0) > 0
    )

    if (huboActividadAyer) continue // Streak intacto, no notificar

    // Calcular la racha previa: cuántos días CONSECUTIVOS previos a ayer tuvo actividad
    let streakDias = 0
    const maxDays = 30

    for (let i = 2; i <= maxDays; i++) {
      const diaCheck = new Date(now)
      diaCheck.setDate(diaCheck.getDate() - i)
      const diaStr = diaCheck.toISOString().split('T')[0]
      const diaStart = `${diaStr}T00:00:00.000Z`
      const diaEnd = `${diaStr}T23:59:59.999Z`

      const [g, c] = await Promise.all([
        supabase.from('gastos').select('id').eq('workspace_id', perfil.workspace_id)
          .gte('created_at', diaStart).lte('created_at', diaEnd).eq('created_by', perfil.id).limit(1),
        supabase.from('cobros').select('id').eq('workspace_id', perfil.workspace_id)
          .gte('created_at', diaStart).lte('created_at', diaEnd).eq('created_by', perfil.id).limit(1),
      ])

      if ((g.data?.length ?? 0) > 0 || (c.data?.length ?? 0) > 0) {
        streakDias++
      } else {
        break // Racha rota antes
      }
    }

    if (streakDias === 0) continue // No había racha que romper

    // Verificar deduplicación
    const { data: existente } = await supabase
      .from('notificaciones')
      .select('id')
      .eq('destinatario_id', perfil.id)
      .eq('tipo', 'streak_roto')
      .eq('estado', 'pendiente')
      .gte('created_at', `${ayerStr}T00:00:00.000Z`)
      .maybeSingle()

    if (existente) continue

    const { error } = await supabase.from('notificaciones').insert({
      workspace_id: perfil.workspace_id,
      destinatario_id: perfil.id,
      tipo: 'streak_roto',
      estado: 'pendiente',
      contenido: `Tu racha de ${streakDias} día${streakDias !== 1 ? 's' : ''} se rompió ayer — registra hoy para empezar de nuevo`,
      entidad_tipo: null,
      entidad_id: null,
      deep_link: '/numeros',
      metadata: {
        streak_dias: streakDias,
        fecha_rotura: ayerStr,
      },
    })

    if (!error) notificacionesCreadas++
  }

  return NextResponse.json({
    ok: true,
    notificaciones: notificacionesCreadas,
    timestamp: now.toISOString(),
  })
}
