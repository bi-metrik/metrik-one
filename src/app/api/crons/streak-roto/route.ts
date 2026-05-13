import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { FEATURES } from '@/lib/feature-flags'
import { todayBogotaISO } from '@/lib/dates/bogota'

// Rango UTC del dia calendario Bogota (UTC-5, sin DST).
// El dia Bogota YYYY-MM-DD empieza a las 05:00 UTC y termina a las 04:59:59.999 UTC del dia siguiente.
function rangoUtcDiaBogota(diaBogotaISO: string): { start: string; end: string } {
  const start = new Date(`${diaBogotaISO}T05:00:00.000Z`)
  const end = new Date(start.getTime() + 86400000 - 1) // 23:59:59.999 del siguiente dia Bogota
  return { start: start.toISOString(), end: end.toISOString() }
}

// N6 — Cron de streak roto
// Si el usuario no registró ningún gasto, cobro, hora NI cambio de saldo_banco ayer
// y tenía streak activo (>0 días), generar notificación.

export async function GET(req: NextRequest) {
  if (!FEATURES.CONCILIACION) return NextResponse.json({ skipped: true })

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
  // "Ayer" en calendario Bogota (UTC-5, sin DST). El cron corre 13:00 UTC = 08:00 Bogota,
  // asi que "hoy Bogota" coincide con el dia calendario actual UTC; ayer es ese dia menos 1.
  const hoyBogota = todayBogotaISO(now)
  const ayerStrDate = new Date(`${hoyBogota}T05:00:00.000Z`)
  ayerStrDate.setUTCDate(ayerStrDate.getUTCDate() - 1)
  const ayerStr = todayBogotaISO(ayerStrDate)
  const { start: ayerStart, end: ayerEnd } = rangoUtcDiaBogota(ayerStr)

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
      const diaCheck = new Date(`${hoyBogota}T05:00:00.000Z`)
      diaCheck.setUTCDate(diaCheck.getUTCDate() - i)
      const diaStr = todayBogotaISO(diaCheck)
      const { start: diaStart, end: diaEnd } = rangoUtcDiaBogota(diaStr)

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
      .gte('created_at', ayerStart)
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
