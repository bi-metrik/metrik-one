import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getConfigNotificaciones,
  supervisoresDeArea,
  type ConfigNotificaciones,
} from '@/lib/notificaciones/routing'

// N7 — Cron de inactividad en negocios (etapa ejecución)
// Con routing por responsable: responsable de operaciones desde el día 2,
// supervisor del área a partir del día configurado. Sin el flag: legacy (día 5 -> owner).
// Señales que reinician el reloj: horas, gastos, comentario

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
  let procesadas = 0
  let notificacionesCreadas = 0
  const configCache = new Map<string, ConfigNotificaciones>()

  const { data: negocios } = await supabase
    .from('negocios')
    .select('id, workspace_id, nombre, stage_actual, created_at, updated_at')
    .eq('estado', 'abierto')
    .eq('stage_actual', 'ejecucion')

  if (!negocios || negocios.length === 0) {
    return NextResponse.json({ ok: true, procesadas: 0, notificaciones: 0 })
  }

  for (const negocio of negocios) {
    procesadas++

    const [horasRes, gastosRes, activityRes] = await Promise.all([
      supabase
        .from('horas')
        .select('created_at')
        .eq('negocio_id', negocio.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('gastos')
        .select('created_at')
        .eq('negocio_id', negocio.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('activity_log')
        .select('created_at')
        .eq('entidad_tipo', 'negocio')
        .eq('entidad_id', negocio.id)
        .eq('tipo', 'comentario')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const fechas = [
      horasRes.data?.created_at,
      gastosRes.data?.created_at,
      activityRes.data?.created_at,
      negocio.updated_at,
      negocio.created_at,
    ].filter(Boolean) as string[]

    const ultimaActividad = new Date(fechas.sort().reverse()[0])
    const diasSinActividad = Math.floor((now.getTime() - ultimaActividad.getTime()) / (1000 * 60 * 60 * 24))

    if (diasSinActividad < 2) continue

    const contenido = `"${negocio.nombre}" lleva ${diasSinActividad} días sin actividad`

    const destinatarios = new Set<string>()
    const cfg = await getConfigNotificaciones(supabase, negocio.workspace_id, configCache)

    if (cfg.routing_por_responsable) {
      // El negocio está en ejecución -> le toca al responsable de operaciones.
      // `destinatarios_negocio` cae al supervisor del área si el puesto está vacío.
      const { data: dest } = await supabase.rpc('destinatarios_negocio', {
        p_negocio_id: negocio.id,
      })
      for (const d of (dest ?? []) as Array<{ profile_id: string }>) {
        if (d.profile_id) destinatarios.add(d.profile_id)
      }

      if (diasSinActividad >= cfg.escalar_supervisor_dias) {
        for (const id of await supervisoresDeArea(supabase, negocio.workspace_id, 'operaciones')) {
          destinatarios.add(id)
        }
      }
      // El `>= 5 && owner` de abajo era la fuente del ruido: mandaba al owner
      // TODOS los negocios en ejecución del workspace. Aquí no existe.
    } else {
      const { data: perfiles } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('workspace_id', negocio.workspace_id)

      if (!perfiles) continue

      const supervisorOperaciones = perfiles.find(p => p.role === 'supervisor')
      const admin = perfiles.find(p => p.role === 'admin')
      const owner = perfiles.find(p => p.role === 'owner')

      if (diasSinActividad >= 2) {
        if (supervisorOperaciones) {
          destinatarios.add(supervisorOperaciones.id)
        } else if (admin) {
          destinatarios.add(admin.id)
        } else if (owner) {
          destinatarios.add(owner.id)
        }
      }
      if (diasSinActividad >= 5 && owner) {
        destinatarios.add(owner.id)
      }
    }

    for (const destinatarioId of destinatarios) {
      const { data: existente } = await supabase
        .from('notificaciones')
        .select('id')
        .eq('destinatario_id', destinatarioId)
        .eq('tipo', 'inactividad_proyecto')
        .eq('entidad_id', negocio.id)
        .eq('estado', 'pendiente')
        .maybeSingle()

      if (existente) continue

      const { error } = await supabase.from('notificaciones').insert({
        workspace_id: negocio.workspace_id,
        destinatario_id: destinatarioId,
        tipo: 'inactividad_proyecto',
        estado: 'pendiente',
        contenido,
        entidad_tipo: 'negocio',
        entidad_id: negocio.id,
        deep_link: `/negocios/${negocio.id}`,
        metadata: {
          dias_inactivo: diasSinActividad,
        },
      })

      if (!error) notificacionesCreadas++
    }
  }

  return NextResponse.json({
    ok: true,
    procesadas,
    notificaciones: notificacionesCreadas,
    timestamp: now.toISOString(),
  })
}
