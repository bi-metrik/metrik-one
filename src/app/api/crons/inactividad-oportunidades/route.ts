import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// N1 — Cron de inactividad en oportunidades
// Escalamiento: 3d (ejecutor), 5d (ejecutor+supervisor), 7d (ejecutor+supervisor+empresario), 15d (todos)
// Aplica solo a etapas activas: por_contactar, primer_contacto, necesidad_clara, propuesta_presentada, negociacion
// Señales que reinician el reloj: cambio de etapa (etapa_historial), comentario (activity_log), cotización creada

const ETAPAS_ACTIVAS = ['lead_nuevo', 'contactado', 'propuesta_enviada', 'negociacion', 'por_contactar', 'primer_contacto', 'necesidad_clara', 'propuesta_presentada']

export async function GET(req: NextRequest) {
  // Validar header de autenticación para Vercel Cron
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

  // Obtener todas las oportunidades activas por workspace
  const { data: oportunidades } = await supabase
    .from('oportunidades')
    .select('id, workspace_id, descripcion, etapa, responsable_id, created_at')
    .in('etapa', ETAPAS_ACTIVAS)

  if (!oportunidades || oportunidades.length === 0) {
    return NextResponse.json({ ok: true, procesadas: 0, notificaciones: 0 })
  }

  for (const opp of oportunidades) {
    procesadas++

    // Calcular última señal de actividad
    const [historialRes, activityRes, cotizacionRes] = await Promise.all([
      // Último cambio de etapa
      supabase
        .from('etapa_historial')
        .select('created_at')
        .eq('oportunidad_id', opp.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Último comentario en activity_log
      supabase
        .from('activity_log')
        .select('created_at')
        .eq('entidad_tipo', 'oportunidad')
        .eq('entidad_id', opp.id)
        .eq('tipo', 'comentario')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Última cotización creada
      supabase
        .from('cotizaciones')
        .select('created_at')
        .eq('oportunidad_id', opp.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    // Determinar la señal más reciente
    const fechas = [
      historialRes.data?.created_at,
      activityRes.data?.created_at,
      cotizacionRes.data?.created_at,
      opp.created_at,
    ].filter(Boolean) as string[]

    const ultimaActividad = new Date(fechas.sort().reverse()[0])
    const diasSinActividad = Math.floor((now.getTime() - ultimaActividad.getTime()) / (1000 * 60 * 60 * 24))

    if (diasSinActividad < 3) continue

    // Determinar nivel de escalamiento
    const niveles: Array<{ dias: number; nivel: string; roles: string[] }> = [
      { dias: 15, nivel: '15d', roles: ['operator', 'supervisor', 'admin', 'owner'] },
      { dias: 7, nivel: '7d', roles: ['operator', 'supervisor', 'admin', 'owner'] },
      { dias: 5, nivel: '5d', roles: ['operator', 'supervisor'] },
      { dias: 3, nivel: '3d', roles: ['operator'] },
    ]

    const nivelActual = niveles.find(n => diasSinActividad >= n.dias)
    if (!nivelActual) continue

    const textoBase = diasSinActividad >= 15
      ? `"${opp.descripcion}" lleva ${diasSinActividad} días sin gestión — ¿cerrar como perdida?`
      : `"${opp.descripcion}" lleva ${diasSinActividad} días sin actividad`

    // Resolver destinatarios según roles en el workspace
    const { data: perfiles } = await supabase
      .from('profiles')
      .select('id, role, area')
      .eq('workspace_id', opp.workspace_id)

    if (!perfiles) continue

    // Resolver staff del responsable para encontrar su profile
    let responsableProfileId: string | null = null
    if (opp.responsable_id) {
      const { data: staffRecord } = await supabase
        .from('staff')
        .select('profile_id')
        .eq('id', opp.responsable_id)
        .maybeSingle()
      responsableProfileId = staffRecord?.profile_id ?? null
    }

    // Construir set de destinatarios
    const destinatarios = new Set<string>()

    for (const rol of nivelActual.roles) {
      if (rol === 'operator' && responsableProfileId) {
        destinatarios.add(responsableProfileId)
      } else if (rol === 'supervisor') {
        // N1 (oportunidades): solo supervisores con area='comercial' O area IS NULL
        // Si no hay ninguno → escalar directo al owner (se hace en fallback)
        const supervisorComercial = perfiles.find(p =>
          p.role === 'supervisor' && (p.area === 'comercial' || p.area === null)
        )
        if (supervisorComercial) destinatarios.add(supervisorComercial.id)
      } else {
        const perfil = perfiles.find(p => p.role === rol)
        if (perfil) destinatarios.add(perfil.id)
      }
    }

    // Fallback: si ningún destinatario resuelto, al owner
    if (destinatarios.size === 0) {
      const owner = perfiles.find(p => p.role === 'owner')
      if (owner) destinatarios.add(owner.id)
    }

    // Crear notificaciones (deduplicadas por función SQL)
    for (const destinatarioId of destinatarios) {
      // Verificar deduplicación manual
      const { data: existente } = await supabase
        .from('notificaciones')
        .select('id')
        .eq('destinatario_id', destinatarioId)
        .eq('tipo', 'inactividad_oportunidad')
        .eq('entidad_id', opp.id)
        .eq('estado', 'pendiente')
        .maybeSingle()

      if (existente) continue

      const { error } = await supabase.from('notificaciones').insert({
        workspace_id: opp.workspace_id,
        destinatario_id: destinatarioId,
        tipo: 'inactividad_oportunidad',
        estado: 'pendiente',
        contenido: textoBase,
        entidad_tipo: 'oportunidad',
        entidad_id: opp.id,
        deep_link: `/pipeline/${opp.id}`,
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
