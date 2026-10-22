/**
 * Hitos de gestión en la campana (brief del 2026-10-22, regla 7): un RESUMEN DIARIO por persona,
 * no una notificación por hito, y un solo aviso a la dirección por hito vencido.
 *
 * Corre en el mismo cron del motor de recordatorios (7:30 Bogotá) y, como él, solo en día hábil.
 * Que nada se pierda en el fin de semana lo garantiza el cálculo, no el cron:
 *   · el resumen del último día hábil antes de uno o más no hábiles trae «Este fin de semana tienes
 *     …» con lo que cae en esos días (`resumenDelDia`);
 *   · un hito que se venció en el fin de semana se escala el siguiente día hábil (`escalablesHoy`
 *     mira hacia atrás `VENTANA_ESCALAMIENTO_DIAS`).
 *
 * Los hitos se calculan con el MISMO módulo que la Agenda (`hitos.ts` + `hitos-datos.ts`): la
 * campana y la Agenda no pueden decir cosas distintas. Por eso no se usa la fuente genérica
 * «servicio» que propuso el PR de fechas (#1236) para el motor de reglas: duplicaría el cálculo de
 * ventanas de check-in, no hábiles y responsables.
 *
 * Idempotencia:
 *   · escalamiento: `recordatorios_log` (llave regla, entidad, fecha objetivo, destinatario, canal),
 *     reclamado antes de mandar, como todo aviso del motor. Dos corridas = un aviso;
 *   · resumen: una notificación `agenda_del_dia` por persona y día (`grupo_clave =
 *     agenda_del_dia:<fecha>`), mirada antes de insertar. El candado del cron evita dos corridas a
 *     la vez.
 *
 * Nada al viajero. Nada por hitos hechos, viajes cancelados (solo se leen abiertos) ni servicios
 * «No va» (no generan hitos).
 */

import { esDiaHabil } from '@/lib/dates/dias-habiles'
import { hitosDelViaje, type Hito, type ViajeHitos } from '@/lib/viaje/hitos'
import { leerViajesParaHitos } from '@/lib/viaje/hitos-datos'
import { escalablesHoy, resumenDelDia, textoEscalamiento } from '@/lib/viaje/agenda'
import { reclamar } from './motor'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export interface ResumenHitos {
  lineas: number
  viajes: number
  hitos: number
  resumenes: number
  resumenes_ya: number
  escalados: number
  escalados_ya: number
  sin_destinatario: number
  fallidos: number
  dia_no_habil?: boolean
}

export const LINK_AGENDA = '/negocios?vista=pendientes'

export function reglaEscalamiento(h: Pick<Hito, 'hitoId' | 'tramo'>): string {
  return `hito_vencido:${h.hitoId}${h.tramo ? `:t${h.tramo}` : ''}`
}

export async function correrHitos(svc: Db, opts: { hoy: string }): Promise<ResumenHitos> {
  const { hoy } = opts
  const r: ResumenHitos = { lineas: 0, viajes: 0, hitos: 0, resumenes: 0, resumenes_ya: 0, escalados: 0, escalados_ya: 0, sin_destinatario: 0, fallidos: 0 }
  if (!esDiaHabil(hoy)) return { ...r, dia_no_habil: true }

  const { data: lineasRaw, error } = await svc
    .from('lineas_negocio')
    .select('id, workspace_id, config_extra')
    .filter('config_extra->hitos->>activo', 'eq', 'true')
  if (error) throw new Error(`hitos: no se pudieron leer las líneas: ${error.message}`)
  const lineas = (lineasRaw ?? []) as Array<{ id: string; workspace_id: string; config_extra: unknown }>
  r.lineas = lineas.length
  if (lineas.length === 0) return r

  const viajes = await leerViajesParaHitos(svc, { lineas })
  r.viajes = viajes.length
  const viajeDe = new Map<string, ViajeHitos>(viajes.map(v => [v.id, v]))
  const hitos = viajes.flatMap(v => hitosDelViaje(v, hoy))
  r.hitos = hitos.length

  // Staff → perfil y nombre (responsables y aprobadores).
  const staffIds = [...new Set([...hitos.flatMap(h => h.responsables), ...viajes.flatMap(v => v.aprobadoresStaffIds)])]
  const staff = new Map<string, { profile_id: string | null; nombre: string | null; workspace_id: string }>()
  for (let i = 0; i < staffIds.length; i += 150) {
    const { data, error: e } = await svc.from('staff').select('id, profile_id, full_name, workspace_id').in('id', staffIds.slice(i, i + 150))
    if (e) throw new Error(`hitos: no se pudo leer el staff: ${e.message}`)
    for (const s of (data ?? []) as Array<{ id: string; profile_id: string | null; full_name: string | null; workspace_id: string }>) {
      staff.set(s.id, { profile_id: s.profile_id, nombre: (s.full_name ?? '').trim().split(/\s+/)[0] || null, workspace_id: s.workspace_id })
    }
  }

  // ── Resumen diario por persona ──
  const grupo = `agenda_del_dia:${hoy}`
  for (const staffId of new Set(hitos.flatMap(h => h.responsables))) {
    const resumen = resumenDelDia(hitos, staffId, hoy)
    const st = staff.get(staffId)
    if (!resumen) continue
    if (!st?.profile_id) { r.sin_destinatario++; continue }
    try {
      const { data: ya } = await svc.from('notificaciones').select('id').eq('destinatario_id', st.profile_id).eq('tipo', 'agenda_del_dia').eq('grupo_clave', grupo).limit(1)
      if ((ya ?? []).length > 0) { r.resumenes_ya++; continue }
      const { error: insErr } = await svc.from('notificaciones').insert({
        workspace_id: st.workspace_id,
        destinatario_id: st.profile_id,
        tipo: 'agenda_del_dia',
        estado: 'pendiente',
        contenido: resumen.texto,
        deep_link: LINK_AGENDA,
        grupo_clave: grupo,
        metadata: { fecha: hoy, hoy: resumen.hoy, no_habiles: resumen.noHabiles },
      })
      if (insErr) throw new Error(insErr.message)
      r.resumenes++
    } catch (e) {
      console.error('[hitos] resumen no salió', staffId, e instanceof Error ? e.message : e)
      r.fallidos++
    }
  }

  // ── Escalamiento único a la dirección ──
  for (const h of escalablesHoy(hitos, hoy)) {
    const v = viajeDe.get(h.negocioId)
    if (!v || !v.workspaceId) continue
    const perfiles = [...new Set(v.aprobadoresStaffIds.map(id => staff.get(id)?.profile_id).filter((p): p is string => !!p))]
    if (perfiles.length === 0) { r.sin_destinatario++; continue }
    const quien = h.responsables.length > 0 ? h.responsables.map(id => staff.get(id)?.nombre ?? 'Alguien').join(' y ') : null
    const contenido = textoEscalamiento(h, quien, hoy)
    for (const destinatario of perfiles) {
      const reclamo = await reclamar(svc, {
        workspace_id: v.workspaceId,
        negocio_id: h.negocioId,
        regla_id: reglaEscalamiento(h),
        entidad_tipo: h.servicioId ? 'servicio' : 'negocio',
        entidad_id: h.servicioId ?? h.negocioId,
        fecha_objetivo: h.fechaAncla!,
        destinatario,
        canal: 'in_app',
      })
      if (!reclamo) { r.escalados_ya++; continue }
      try {
        const { error: insErr } = await svc.from('notificaciones').insert({
          workspace_id: v.workspaceId,
          destinatario_id: destinatario,
          tipo: 'hito_vencido',
          estado: 'pendiente',
          contenido,
          entidad_tipo: h.servicioId ? 'servicio' : 'negocio',
          entidad_id: h.servicioId ?? h.negocioId,
          deep_link: `/negocios/${h.negocioId}`,
          metadata: { hito_id: h.hitoId, llave: h.llave, fecha_objetivo: h.fechaAncla, negocio_id: h.negocioId },
        })
        if (insErr) throw new Error(insErr.message)
        await svc.from('recordatorios_log').update({ estado: 'enviado', enviado_at: new Date().toISOString(), error: null }).eq('id', reclamo.id)
        r.escalados++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[hitos] escalamiento no salió', h.llave, msg)
        await svc.from('recordatorios_log').update({ estado: 'fallido', error: msg.slice(0, 500) }).eq('id', reclamo.id)
        r.fallidos++
      }
    }
  }
  return r
}
