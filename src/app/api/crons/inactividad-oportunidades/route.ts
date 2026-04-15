import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// N1 — Cron de inactividad en negocios (etapa venta)
// Escalamiento: 3d (ejecutor), 5d (ejecutor+supervisor), 7d (ejecutor+supervisor+admin), 15d (todos)
// Señales que reinician el reloj: cambio de etapa, comentario (activity_log), cotización creada

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

  // Obtener negocios en venta (abiertos)
  const { data: negocios } = await supabase
    .from('negocios')
    .select('id, workspace_id, nombre, stage_actual, created_at, updated_at')
    .eq('estado', 'abierto')
    .eq('stage_actual', 'venta')

  if (!negocios || negocios.length === 0) {
    return NextResponse.json({ ok: true, procesadas: 0, notificaciones: 0 })
  }

  for (const negocio of negocios) {
    procesadas++

    // Última señal de actividad
    const [activityRes, cotizacionRes] = await Promise.all([
      supabase
        .from('activity_log')
        .select('created_at')
        .eq('entidad_tipo', 'negocio')
        .eq('entidad_id', negocio.id)
        .eq('tipo', 'comentario')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('cotizaciones')
        .select('created_at')
        .eq('negocio_id', negocio.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const fechas = [
      activityRes.data?.created_at,
      cotizacionRes.data?.created_at,
      negocio.updated_at,
      negocio.created_at,
    ].filter(Boolean) as string[]

    const ultimaActividad = new Date(fechas.sort().reverse()[0])
    const diasSinActividad = Math.floor((now.getTime() - ultimaActividad.getTime()) / (1000 * 60 * 60 * 24))

    if (diasSinActividad < 3) continue

    const niveles: Array<{ dias: number; nivel: string; roles: string[] }> = [
      { dias: 15, nivel: '15d', roles: ['operator', 'supervisor', 'admin', 'owner'] },
      { dias: 7, nivel: '7d', roles: ['operator', 'supervisor', 'admin', 'owner'] },
      { dias: 5, nivel: '5d', roles: ['operator', 'supervisor'] },
      { dias: 3, nivel: '3d', roles: ['operator'] },
    ]

    const nivelActual = niveles.find(n => diasSinActividad >= n.dias)
    if (!nivelActual) continue

    const textoBase = diasSinActividad >= 15
      ? `"${negocio.nombre}" lleva ${diasSinActividad} días sin gestión — ¿cerrar como perdido?`
      : `"${negocio.nombre}" lleva ${diasSinActividad} días sin actividad`

    const { data: perfiles } = await supabase
      .from('profiles')
      .select('id, role, area')
      .eq('workspace_id', negocio.workspace_id)

    if (!perfiles) continue

    const destinatarios = new Set<string>()

    for (const rol of nivelActual.roles) {
      if (rol === 'supervisor') {
        const supervisorComercial = perfiles.find(p =>
          p.role === 'supervisor' && (p.area === 'comercial' || p.area === null)
        )
        if (supervisorComercial) destinatarios.add(supervisorComercial.id)
      } else {
        const perfil = perfiles.find(p => p.role === rol)
        if (perfil) destinatarios.add(perfil.id)
      }
    }

    if (destinatarios.size === 0) {
      const owner = perfiles.find(p => p.role === 'owner')
      if (owner) destinatarios.add(owner.id)
    }

    for (const destinatarioId of destinatarios) {
      const { data: existente } = await supabase
        .from('notificaciones')
        .select('id')
        .eq('destinatario_id', destinatarioId)
        .eq('tipo', 'inactividad_oportunidad')
        .eq('entidad_id', negocio.id)
        .eq('estado', 'pendiente')
        .maybeSingle()

      if (existente) continue

      const { error } = await supabase.from('notificaciones').insert({
        workspace_id: negocio.workspace_id,
        destinatario_id: destinatarioId,
        tipo: 'inactividad_oportunidad',
        estado: 'pendiente',
        contenido: textoBase,
        entidad_tipo: 'negocio',
        entidad_id: negocio.id,
        deep_link: `/negocios/${negocio.id}`,
        metadata: {
          dias_inactivo: diasSinActividad,
          nivel: nivelActual.nivel,
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
