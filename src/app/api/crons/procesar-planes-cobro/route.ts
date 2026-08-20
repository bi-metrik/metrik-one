import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { generarCuentasCobroPeriodo } from '@/lib/cobros/generar-cuentas-cobro'
import { emitirCuentasExplicitasPeriodo } from '@/lib/cobros/emitir-cuota-explicita'
import { particionarPorCronograma, planesConCronogramaExplicito } from '@/lib/cobros/cronograma-explicito'

// Cron diario — Procesa planes_cobro activos:
//   1. Genera cobros programados con fecha_esperada = T+3 dias si no existe ya la cuota
//      (solo planes SIN cronograma explicito — los que lo tienen los cubre el paso 4)
//   2. Marca como vencido cobros programados pasados con 3+ dias de gracia sin confirmar
//   3. Genera notificaciones cobro_vencido a responsable + dueno + staff del area financiera (staff_areas)
//   4. Emite las cuentas del mes: agrupadas por empresa (planes uniformes) + una por
//      cuota (planes con cronograma explicito en plan_cobro_cuotas)
//   5. Plan se marca inactivo automaticamente cuando todas las cuotas se cobran (trigger DB)
//
// Spec: docs/specs/2026-04-26_mc-ebitda-capa-fiscal-simplificada.md (extension B/Fase 1)
// Schedule: 0 13 * * * (mismo bucket que crons existentes)

const DIAS_ANTICIPACION = 3
const DIAS_GRACIA = 3
// Dia del mes en que se ABRE la ventana de emision de cuentas. La ventana no se
// cierra: ver el comentario del paso 4.
const DIA_APERTURA_EMISION = 10
// Dia con el que se fecha la cuenta (dia de envio al cliente). No depende del dia
// en que el cron logre correr.
const DIA_EMISION_CUENTA = 13

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
  // Interpretamos fecha_inicio como dia calendario Bogota (UTC-5).
  // 05:00 UTC del dia = 00:00 Bogota.
  const inicio = new Date(`${fechaInicio}T05:00:00Z`)
  const offset = numeroCuota - 1
  switch (frecuencia) {
    case 'mensual':     return addMeses(inicio, offset)
    case 'trimestral':  return addMeses(inicio, offset * 3)
    case 'anual':       return addMeses(inicio, offset * 12)
    default:            return inicio
  }
}

// Dias enteros entre dos instantes contando por dias calendario Bogota.
function diasEntreBogota(desde: Date, hasta: Date): number {
  const a = new Date(`${todayBogotaISO(desde)}T05:00:00Z`)
  const b = new Date(`${todayBogotaISO(hasta)}T05:00:00Z`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function toIsoDate(d: Date): string {
  return todayBogotaISO(d)
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

  // Un plan CON cronograma explicito no se toca aqui: sus cuotas tienen monto y
  // vencimiento propios en `plan_cobro_cuotas`, y este paso las crearia con
  // `plan.monto` uniforme y la fecha calculada desde `fecha_inicio`. Sobre
  // Trappvel eso significa la cuota 6 por $833.333 en vez de $833.335; como la
  // idempotencia es el unique (plan_cobro_id, numero_cuota), gana el que llegue
  // primero y el monto equivocado se queda. Las emite el paso 4.
  const planesExplicitos = await planesConCronogramaExplicito(
    supabase,
    ((planes ?? []) as PlanCobro[]).map((p) => p.id),
  )
  const { uniformes: planesUniformes } = particionarPorCronograma(
    (planes ?? []) as PlanCobro[],
    planesExplicitos,
  )

  for (const plan of planesUniformes) {
    // Encontrar cuotas cuya fecha esperada cae en [hoy, hoy + 3d] y aun no existen
    for (let n = 1; n <= plan.total_cuotas; n++) {
      const fechaEsp = fechaCuota(plan.fecha_inicio, plan.frecuencia, n)
      const fechaEspStr = toIsoDate(fechaEsp)
      const dias = diasEntreBogota(hoy, fechaEsp)

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
  // "hoy Bogota - 3 dias" como dia calendario Bogota.
  const fechaLimite = new Date(`${todayBogotaISO(hoy)}T05:00:00Z`)
  fechaLimite.setUTCDate(fechaLimite.getUTCDate() - DIAS_GRACIA)
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
    // Buscar responsable + dueno (owner) + staff del area financiera (staff_areas)
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

    // Staff del area financiera segun staff_areas (fuente canonica de areas).
    // staff_areas no tiene workspace_id: se resuelve via los staff del workspace.
    const { data: staffWs } = await supabase
      .from('staff')
      .select('id, profile_id')
      .eq('workspace_id', cobro.workspace_id!)
      .eq('is_active', true)

    const staffWsIds = (staffWs ?? []).map((s) => s.id)
    let financierosStaff: { profile_id: string | null }[] = []
    if (staffWsIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: areasFin } = await (supabase as any)
        .from('staff_areas')
        .select('staff_id')
        .in('staff_id', staffWsIds)
        .eq('area', 'financiera')
      const finIds = new Set(((areasFin ?? []) as { staff_id: string }[]).map((r) => r.staff_id))
      financierosStaff = (staffWs ?? [])
        .filter((s) => finIds.has(s.id))
        .map((s) => ({ profile_id: s.profile_id }))
    }

    const destinatarios = new Set<string>()
    if (responsableProfile) destinatarios.add(responsableProfile)
    if (ownerProfile?.id) destinatarios.add(ownerProfile.id)
    for (const f of financierosStaff ?? []) {
      if (f.profile_id) destinatarios.add(f.profile_id)
    }

    const fechaEsp = cobro.fecha_esperada ?? ''
    // diasVencido cuenta dias calendario Bogota desde fecha_esperada hasta hoy, menos gracia.
    const diasVencido = fechaEsp
      ? diasEntreBogota(new Date(`${fechaEsp}T05:00:00Z`), hoy) - DIAS_GRACIA
      : 0
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

  // ── 4. Emitir cuentas de cobro DESDE el dia 10 ────────────
  // Para workspaces con modules.cobros_recurrentes=true, agrupa cobros
  // programados del mes por empresa pagadora y emite 1 cuenta por grupo.
  // La ventana se abre el dia 10 para dar margen de revision/aprobacion antes
  // del envio (dia 13) y del vencimiento (dia 15).
  //
  // La ventana se queda ABIERTA el resto del mes a proposito. Con la guarda
  // anterior (`diaHoy === 10`) una sola invocacion perdida dejaba el mes entero
  // sin facturar, en silencio y sin reintento: paso el 2026-08-10, cuando el
  // proyecto todavia estaba en plan Hobby de Vercel (precision por hora, no por
  // minuto) y ese cron no se disparo ese dia, mientras el de las 13:00 si corrio.
  // La emision ya es idempotente (`generarCuentasCobroPeriodo` salta la cuenta si
  // ya existe para workspace + anio + mes + empresa), asi que reintentar cada dia
  // no duplica nada: el dia 11 emite lo que el 10 no pudo, y del 12 en adelante
  // no hace nada. La fecha de emision sigue clavada al dia 13 para que la cuenta
  // no cambie de forma segun el dia en que el cron logre correr.
  let cuentasEmitidas = 0
  let cuentasOmitidas = 0
  const cuentasErrores: { workspace_id: string; error: string }[] = []

  // hoyStr formato YYYY-MM-DD en Bogota
  const [añoStr, mesStr, diaStr] = hoyStr.split('-')
  const diaHoy = parseInt(diaStr, 10)
  const añoHoy = parseInt(añoStr, 10)
  const mesHoy = parseInt(mesStr, 10)

  if (diaHoy >= DIA_APERTURA_EMISION) {
    const { data: workspacesConFlag } = await supabase
      .from('workspaces')
      .select('id, slug')
      .filter('modules->cobros_recurrentes', 'eq', 'true')

    for (const ws of (workspacesConFlag ?? []) as { id: string; slug: string }[]) {
      try {
        const r = await generarCuentasCobroPeriodo(supabase, ws.id, añoHoy, mesHoy, {
          dryRun: false,
          isDraft: false,
          // La cuenta se fecha el dia 13 (dia de envio al cliente) corra el cron el
          // dia que corra; el vencimiento sigue el dia 15 (fechaEsperada interna).
          fechaEmisionOverride: `${añoHoy}-${String(mesHoy).padStart(2, '0')}-${DIA_EMISION_CUENTA}`,
        })
        cuentasEmitidas += r.cuentasCreadas
        cuentasOmitidas += r.cuentasOmitidas
        for (const e of r.errores) {
          cuentasErrores.push({ workspace_id: ws.id, error: `${e.empresa_id}: ${e.error}` })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        cuentasErrores.push({ workspace_id: ws.id, error: msg })
      }

      // Cronogramas explicitos (`plan_cobro_cuotas`): una cuenta por cuota, con
      // el monto y el vencimiento del contrato. El generador de arriba no los ve
      // — filtra por `fecha_esperada = dia 15` y estas cuotas vencen cuando dice
      // el contrato (Trappvel: el 20). Sin esta llamada el emisor explicito
      // existia sin que nadie lo invocara, y Trappvel llevaba desde julio sin
      // que se le emitiera una sola cuota.
      //
      // Reintentar cada dia no duplica: `emitirCuentaDesdeCuota` aborta si el
      // cobro de la cuota ya esta dentro de una cuenta emitida.
      try {
        const rx = await emitirCuentasExplicitasPeriodo(supabase, ws.id, añoHoy, mesHoy, {
          dryRun: false,
          isDraft: false,
          // Misma fecha de envio que el camino uniforme. Si la cuota vence ANTES
          // del 13, `fechaEmisionSegura` recorta al vencimiento: una cuenta no
          // puede nacer fechada despues del dia en que se pide el pago.
          fechaEmisionOverride: `${añoHoy}-${String(mesHoy).padStart(2, '0')}-${String(DIA_EMISION_CUENTA).padStart(2, '0')}`,
        })
        cuentasEmitidas += rx.cuentasCreadas
        cuentasOmitidas += rx.cuentasOmitidas
        for (const e of rx.errores) {
          cuentasErrores.push({ workspace_id: ws.id, error: `cuota ${e.plan_cuota_id}: ${e.error}` })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        cuentasErrores.push({ workspace_id: ws.id, error: `explicitas: ${msg}` })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    fecha: hoyStr,
    cobros_creados: cobrosCreados,
    cobros_vencidos: cobrosVencidos,
    notificaciones_creadas: notificacionesCreadas,
    cuentas_emitidas: cuentasEmitidas,
    cuentas_omitidas: cuentasOmitidas,
    cuentas_errores: cuentasErrores,
  })
}
