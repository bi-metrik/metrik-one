import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// N7 — Cron de inactividad en proyectos
// Solo proyectos en estado 'en_ejecucion'
// Día 2: Supervisor. Día 5: Supervisor + Empresario
// Señales que reinician el reloj: horas, gastos, comentario, cambio de estado

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

  const { data: proyectos } = await supabase
    .from('proyectos')
    .select('id, workspace_id, nombre, estado, responsable_id, created_at')
    .eq('estado', 'en_ejecucion')

  if (!proyectos || proyectos.length === 0) {
    return NextResponse.json({ ok: true, procesadas: 0, notificaciones: 0 })
  }

  for (const proyecto of proyectos) {
    procesadas++

    // Calcular última señal de actividad
    const [horasRes, gastosRes, activityRes] = await Promise.all([
      supabase
        .from('horas')
        .select('created_at')
        .eq('proyecto_id', proyecto.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('gastos')
        .select('created_at')
        .eq('proyecto_id', proyecto.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('activity_log')
        .select('created_at')
        .eq('entidad_tipo', 'proyecto')
        .eq('entidad_id', proyecto.id)
        .eq('tipo', 'comentario')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const fechas = [
      horasRes.data?.created_at,
      gastosRes.data?.created_at,
      activityRes.data?.created_at,
      proyecto.created_at,
    ].filter(Boolean) as string[]

    const ultimaActividad = new Date(fechas.sort().reverse()[0])
    const diasSinActividad = Math.floor((now.getTime() - ultimaActividad.getTime()) / (1000 * 60 * 60 * 24))

    if (diasSinActividad < 2) continue

    // Resolver nombre del responsable
    let responsableNombre = 'Sin asignar'
    if (proyecto.responsable_id) {
      const { data: st } = await supabase
        .from('staff')
        .select('full_name')
        .eq('id', proyecto.responsable_id)
        .maybeSingle()
      if (st?.full_name) responsableNombre = st.full_name
    }

    const contenido = `"${proyecto.nombre}" lleva ${diasSinActividad} días sin actividad — responsable: ${responsableNombre}`

    // Perfiles del workspace
    const { data: perfiles } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('workspace_id', proyecto.workspace_id)

    if (!perfiles) continue

    const destinatarios = new Set<string>()

    const supervisor = perfiles.find(p => p.role === 'admin')
    const owner = perfiles.find(p => p.role === 'owner')

    if (diasSinActividad >= 2) {
      if (supervisor) destinatarios.add(supervisor.id)
      else if (owner) destinatarios.add(owner.id) // fallback
    }
    if (diasSinActividad >= 5 && owner) {
      destinatarios.add(owner.id)
    }

    for (const destinatarioId of destinatarios) {
      const { data: existente } = await supabase
        .from('notificaciones')
        .select('id')
        .eq('destinatario_id', destinatarioId)
        .eq('tipo', 'inactividad_proyecto')
        .eq('entidad_id', proyecto.id)
        .eq('estado', 'pendiente')
        .maybeSingle()

      if (existente) continue

      const { error } = await supabase.from('notificaciones').insert({
        workspace_id: proyecto.workspace_id,
        destinatario_id: destinatarioId,
        tipo: 'inactividad_proyecto',
        estado: 'pendiente',
        contenido,
        entidad_tipo: 'proyecto',
        entidad_id: proyecto.id,
        deep_link: `/proyectos/${proyecto.id}`,
        metadata: {
          dias_inactivo: diasSinActividad,
          responsable_nombre: responsableNombre,
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
