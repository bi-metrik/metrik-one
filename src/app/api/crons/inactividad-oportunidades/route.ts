import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getConfigNotificaciones,
  supervisoresDeArea,
  type ConfigNotificaciones,
} from '@/lib/notificaciones/routing'

// N1 — Cron de inactividad en negocios (etapa venta)
// Escalamiento: 3d (ejecutor), 5d (ejecutor+supervisor), 7d (ejecutor+supervisor+admin), 15d (todos)
// Señales que reinician el reloj: las que declare `ultima_actividad_negocio` en SQL,
// que es la misma función con la que el resolver cierra estos avisos.

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
  // El loop recorre negocios; la config es por workspace y se repite mucho.
  const configCache = new Map<string, ConfigNotificaciones>()

  // Obtener negocios en venta (abiertos)
  const { data: negocios } = await supabase
    .from('negocios')
    .select('id, workspace_id, nombre, stage_actual')
    .eq('estado', 'abierto')
    .eq('stage_actual', 'venta')

  if (!negocios || negocios.length === 0) {
    return NextResponse.json({ ok: true, procesadas: 0, notificaciones: 0 })
  }

  // Una sola definición de "actividad" para todo el sistema. Esta RPC es la MISMA que
  // usa `resolver_notificaciones_obsoletas` para cerrar estos avisos, y esa es toda la
  // corrección: antes el cron tenía su definición (solo `comentario`) y el resolver la
  // suya (cualquier fila de `activity_log`), así que editar un bloque cerraba el aviso a
  // las 12:45 sin reiniciar este reloj y el aviso volvía a nacer a las 13:00. Medido el
  // 2026-09-01: 2.011 avisos sobre 343 negocios en 30 días, uno de ellos 17 veces.
  //
  // ⚠️ La lista de lo que cuenta como gestión vive en `ultima_actividad_negocio` y en
  // ningún otro lado. Volver a escribirla acá es volver a abrir el bucle.
  const { data: actividad } = await supabase.rpc('negocios_ultima_actividad', {
    p_ids: negocios.map(n => n.id),
  })
  const ultimaPorNegocio = new Map(
    ((actividad ?? []) as Array<{ negocio_id: string; ultima_actividad: string | null }>)
      .map(a => [a.negocio_id, a.ultima_actividad]),
  )

  for (const negocio of negocios) {
    procesadas++

    // Sin fila en el mapa el negocio ya no existe: se salta en vez de inventarle fecha.
    const ultima = ultimaPorNegocio.get(negocio.id)
    if (!ultima) continue

    const ultimaActividad = new Date(ultima)
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

    const destinatarios = new Set<string>()
    const cfg = await getConfigNotificaciones(supabase, negocio.workspace_id, configCache)

    if (cfg.routing_por_responsable) {
      // ── Routing por responsable (opt-in por workspace) ──────────────────
      // El aviso sigue a QUIEN LLEVA EL NEGOCIO. Antes se elegía por rol
      // global del workspace (el primer operator, el primer supervisor, el
      // owner) sin mirar el caso: medido en SOENA, el 96% de los avisos
      // llegaba a gente ajena al negocio — incluido el owner de MeTRIK.
      const { data: dest } = await supabase.rpc('destinatarios_negocio', {
        p_negocio_id: negocio.id,
      })
      for (const d of (dest ?? []) as Array<{ profile_id: string }>) {
        if (d.profile_id) destinatarios.add(d.profile_id)
      }

      // El supervisor entra recién cuando el caso de verdad se estancó, no
      // desde el primer aviso (evita que vea 50 avisos al día).
      if (diasSinActividad >= cfg.escalar_supervisor_dias) {
        for (const id of await supervisoresDeArea(supabase, negocio.workspace_id, 'comercial')) {
          destinatarios.add(id)
        }
      }
      // Sin fallback a owner: es deliberado. El owner de un workspace Clarity
      // puede ser MeTRIK, que no opera el día a día del cliente.
    } else {
      // ── Comportamiento histórico (workspaces sin el flag) ───────────────
      const { data: perfiles } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('workspace_id', negocio.workspace_id)

      if (!perfiles) continue

      for (const rol of nivelActual.roles) {
        if (rol === 'supervisor') {
          const supervisorComercial = perfiles.find(p => p.role === 'supervisor')
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
