import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  getConfigNotificaciones,
  supervisoresDeArea,
  type ConfigNotificaciones,
} from '@/lib/notificaciones/routing'
import {
  DISTANCIA_ESCALAMIENTO,
  diaEscalarSupervisor,
} from '@/lib/notificaciones/escalamiento-inactividad'

// N7 — Cron de inactividad en negocios (etapa ejecución)
// Con routing por responsable: responsable de operaciones desde el umbral, supervisor
// del área a partir del día configurado. Sin el flag: legacy (umbral +3 -> owner).
// El umbral sale del SLA de la etapa; con SLA sin declarar son los 2 días de siempre.
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
  const configCache = new Map<string, ConfigNotificaciones>()

  const { data: negocios } = await supabase
    .from('negocios')
    .select('id, workspace_id, nombre, stage_actual')
    .eq('estado', 'abierto')
    .eq('stage_actual', 'ejecucion')

  if (!negocios || negocios.length === 0) {
    return NextResponse.json({ ok: true, procesadas: 0, notificaciones: 0 })
  }

  // Una sola definición de "actividad" para todo el sistema. Esta RPC es la MISMA que
  // usa `resolver_notificaciones_obsoletas` para cerrar estos avisos, y esa es toda la
  // corrección: antes el cron tenía su definición (solo `comentario`) y el resolver la
  // suya (cualquier fila de `activity_log`), así que editar un bloque cerraba el aviso a
  // las 12:45 sin reiniciar este reloj y el aviso volvía a nacer a las 13:00. Medido el
  // 2026-09-01: 658 avisos sobre 213 negocios en 30 días, uno de ellos 10 veces.
  //
  // ⚠️ La lista de lo que cuenta como gestión vive en `ultima_actividad_negocio` y en
  // ningún otro lado. Volver a escribirla acá es volver a abrir el bucle.
  const { data: actividad } = await supabase.rpc('negocios_ultima_actividad', {
    p_ids: negocios.map(n => n.id),
  })
  const porNegocio = new Map(
    (
      (actividad ?? []) as Array<{
        negocio_id: string
        dias_habiles: number | null
        umbral_dias: number | null
        debe_alertar: boolean | null
      }>
    ).map(a => [a.negocio_id, a]),
  )

  for (const negocio of negocios) {
    procesadas++

    // El MOTIVO del aviso lo decide SQL: `debe_alertar` sale de
    // `debe_alertar_inactividad`, la misma función que el resolver consulta a las 12:45
    // para cerrar estos avisos. Reescribir el criterio acá reabre el bucle que cerró la
    // migración 20260901000011 — cerrado a las 12:45, vuelto a nacer a las 13:00.
    //
    // El umbral ya no es el 2 fijo: es el piso del stage ALARGADO por el `sla_horas` de
    // la etapa (`umbral_inactividad_negocio`). Cita concede 7 días hábiles para una cita
    // que agenda la DIAN, y avisaba a los 2 sobre sus 26 negocios abiertos. El SLA solo
    // puede alargar el umbral, nunca acortarlo: ningún aviso se adelanta respecto de hoy.
    //
    // Los números de abajo son solo para el texto y el escalamiento.
    const act = porNegocio.get(negocio.id)
    if (!act?.debe_alertar) continue

    const diasSinActividad = act.dias_habiles ?? 0
    const umbral = act.umbral_dias ?? 2

    const contenido = `"${negocio.nombre}" lleva ${diasSinActividad} días hábiles sin actividad`

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

      if (diasSinActividad >= diaEscalarSupervisor(umbral, cfg.escalar_supervisor_dias)) {
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

      if (supervisorOperaciones) {
        destinatarios.add(supervisorOperaciones.id)
      } else if (admin) {
        destinatarios.add(admin.id)
      } else if (owner) {
        destinatarios.add(owner.id)
      }
      if (diasSinActividad >= umbral + DISTANCIA_ESCALAMIENTO.ownerEjecucion && owner) {
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
