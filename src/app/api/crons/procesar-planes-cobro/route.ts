import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cron diario — Procesa planes_cobro activos:
//   1. Genera cobros programados con fecha_esperada = T+3 dias si no existe ya la cuota
//   2. Marca como vencido cobros programados pasados con 3+ dias de gracia sin confirmar
//   3. Genera notificaciones cobro_vencido a responsable + dueno + staff area=admin_finanzas
//   4. Plan se marca inactivo automaticamente cuando todas las cuotas se cobran (trigger DB)
//
// Spec: docs/specs/2026-04-26_mc-ebitda-capa-fiscal-simplificada.md (extension B/Fase 1)
// Schedule: 0 13 * * * (mismo bucket que crons existentes)

const DIAS_ANTICIPACION = 3
const DIAS_GRACIA = 3

export const runtime = 'nodejs'

interface PlanCobro {
  id: string
  workspace_id: string
  negocio_id: string
  monto: number
  frecuencia: 'mensual' | 'trimestral' | 'anual'
  fecha_inicio: string
  fecha_fin: string
  total_cuotas: number
  pasarela: string
}

function addMeses(fecha: Date, meses: number): Date {
  const d = new Date(fecha)
  d.setMonth(d.getMonth() + meses)
  return d
}

function fechaCuota(fechaInicio: string, frecuencia: string, numeroCuota: number): Date {
  const inicio = new Date(fechaInicio + 'T00:00:00Z')
  const offset = numeroCuota - 1
  switch (frecuencia) {
    case 'mensual':     return addMeses(inicio, offset)
    case 'trimestral':  return addMeses(inicio, offset * 3)
    case 'anual':       return addMeses(inicio, offset * 12)
    default:            return inicio
  }
}

function toIsoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

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

  const hoy = new Date()
  const hoyStr = toIsoDate(hoy)

  let cobrosCreados = 0
  let cobrosVencidos = 0
  let notificacionesCreadas = 0

  // ── 1. Generar cobros programados (T+3 dias) ─────────────
  const { data: planes } = await supabase
    .from('planes_cobro')
    .select('id, workspace_id, negocio_id, monto, frecuencia, fecha_inicio, fecha_fin, total_cuotas, pasarela')
    .eq('activo', true)

  for (const plan of (planes ?? []) as PlanCobro[]) {
    // Encontrar cuotas cuya fecha esperada cae en [hoy, hoy + 3d] y aun no existen
    for (let n = 1; n <= plan.total_cuotas; n++) {
      const fechaEsp = fechaCuota(plan.fecha_inicio, plan.frecuencia, n)
      const fechaEspStr = toIsoDate(fechaEsp)
      const dias = Math.floor((fechaEsp.getTime() - hoy.getTime()) / 86400000)

      if (dias < 0 || dias > DIAS_ANTICIPACION) continue

      // Idempotencia via unique index (plan_cobro_id, numero_cuota)
      const { error: insertErr } = await supabase
        .from('cobros')
        .insert({
          workspace_id: plan.workspace_id,
          negocio_id: plan.negocio_id,
          plan_cobro_id: plan.id,
          numero_cuota: n,
          monto: plan.monto,
          tipo_cobro: 'programado',
          fecha_esperada: fechaEspStr,
          fecha: null,
          revisado: false,
          notas: `Cuota ${n} de ${plan.total_cuotas}`,
          retencion: 0,
        })

      if (!insertErr) cobrosCreados++
      // 23505 = duplicate key (cuota ya creada en run previo) → ignorar
    }
  }

  // ── 2. Marcar cobros programados vencidos ─────────────────
  const fechaLimite = new Date(hoy)
  fechaLimite.setDate(fechaLimite.getDate() - DIAS_GRACIA)
  const fechaLimiteStr = toIsoDate(fechaLimite)

  const { data: cobrosPorVencer } = await supabase
    .from('cobros')
    .select('id, workspace_id, negocio_id, plan_cobro_id, numero_cuota, monto, fecha_esperada')
    .eq('tipo_cobro', 'programado')
    .eq('vencido', false)
    .is('fecha', null)
    .lte('fecha_esperada', fechaLimiteStr)

  for (const cobro of cobrosPorVencer ?? []) {
    await supabase
      .from('cobros')
      .update({ vencido: true, vencido_at: new Date().toISOString() })
      .eq('id', cobro.id)

    cobrosVencidos++

    // ── 3. Notificaciones a 3 destinatarios ─────────────────
    // Buscar responsable + dueno (owner) + staff area=admin_finanzas
    const { data: negocio } = await supabase
      .from('negocios')
      .select('responsable_id, nombre, codigo, staff:responsable_id(profile_id)')
      .eq('id', cobro.negocio_id!)
      .single()

    const staffJoined = negocio?.staff as unknown as { profile_id: string | null } | { profile_id: string | null }[] | null
    const responsableProfile = Array.isArray(staffJoined)
      ? (staffJoined[0]?.profile_id ?? null)
      : (staffJoined?.profile_id ?? null)

    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('workspace_id', cobro.workspace_id!)
      .eq('role', 'owner')
      .maybeSingle()

    const { data: financierosStaff } = await supabase
      .from('staff')
      .select('profile_id')
      .eq('workspace_id', cobro.workspace_id!)
      .eq('area', 'admin_finanzas')
      .eq('is_active', true)

    const destinatarios = new Set<string>()
    if (responsableProfile) destinatarios.add(responsableProfile)
    if (ownerProfile?.id) destinatarios.add(ownerProfile.id)
    for (const f of financierosStaff ?? []) {
      if (f.profile_id) destinatarios.add(f.profile_id)
    }

    const fechaEsp = cobro.fecha_esperada ?? ''
    const diasVencido = Math.floor((hoy.getTime() - new Date(fechaEsp).getTime()) / 86400000) - DIAS_GRACIA
    const negocioCodigo = (negocio as { codigo: string | null } | null)?.codigo ?? ''
    const negocioNombre = (negocio as { nombre: string | null } | null)?.nombre ?? 'Negocio'

    for (const profileId of destinatarios) {
      const { error: notifErr } = await supabase
        .from('notificaciones')
        .insert({
          workspace_id: cobro.workspace_id,
          destinatario_id: profileId,
          tipo: 'cobro_vencido',
          estado: 'pendiente',
          contenido: `Cuota ${cobro.numero_cuota ?? ''} de ${negocioCodigo} ${negocioNombre} vencida hace ${diasVencido} dia${diasVencido !== 1 ? 's' : ''} ($${Number(cobro.monto).toLocaleString('es-CO')})`,
          entidad_tipo: 'cobro',
          entidad_id: cobro.id,
          deep_link: `/negocios/${cobro.negocio_id}`,
          metadata: {
            plan_cobro_id: cobro.plan_cobro_id,
            numero_cuota: cobro.numero_cuota,
            monto: cobro.monto,
            dias_vencido: diasVencido,
          },
        })
      if (!notifErr) notificacionesCreadas++
    }
  }

  return NextResponse.json({
    ok: true,
    fecha: hoyStr,
    cobros_creados: cobrosCreados,
    cobros_vencidos: cobrosVencidos,
    notificaciones_creadas: notificacionesCreadas,
  })
}
