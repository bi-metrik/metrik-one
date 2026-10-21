import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import { fechaYHoraBogota } from './cobro-prueba'
import { CALENDARIO_MORA, DIAS_GRACIA_CICLO, planDeConfig } from './plan'

/**
 * El aviso ANTES de suspender una cuenta autogestionada por una cuota sin pagar (Términos de
 * autoservicio 11.1: «previo aviso por correo»; fila 21 de Vera).
 *
 * Cómo se suspende hoy: cada pago abre en Valida una bolsa que vence al terminar su período más
 * `DIAS_GRACIA_CICLO` (`cicloDeCuota` en `plan.ts`). Si la cuota siguiente no se paga, esa bolsa vence
 * y Valida responde que no hay consultas: esa es la suspensión. Pagar abre la bolsa nueva y la levanta.
 *
 * El aviso sale UNA vez por vencimiento (`valida_registros.aviso_suspension_para`), el día 7 de mora
 * (`CALENDARIO_MORA.avisoSuspension`, Carmen §2.3, decisión de Mauricio del 2026-10-14) o en la primera
 * corrida después, y antes de que venza la bolsa el día 10. Si la cuota se paga, la bolsa se corre un mes y el aviso ya no aplica. Corre después del paso
 * 8 del cron (la reconciliación de ciclos), para no avisar a quien pagó y cuyo ciclo abre en esa corrida.
 *
 * La suspensión es el día `DIAS_GRACIA_CICLO` (10), la única perilla del calendario.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const DIA_MS = 24 * 3_600_000

/** ¿Toca avisar hoy? Desde el día 7 de mora de la cuota hasta que vence la bolsa (día 10). */
export function debeAvisarSuspension(
  venceEn: string,
  ahoraMs: number,
  diasGracia: number = DIAS_GRACIA_CICLO,
  diaAviso: number = CALENDARIO_MORA.avisoSuspension,
): boolean {
  const vence = Date.parse(venceEn)
  if (!Number.isFinite(vence)) return false
  const vencioLaCuota = vence - diasGracia * DIA_MS
  return ahoraMs >= vencioLaCuota + diaAviso * DIA_MS && ahoraMs < vence
}

/**
 * ⚠️ PENDIENTE DE VERA: texto propuesto por Max el 2026-10-12. No promete nada que no digan los Términos
 * (no nombra la terminación a los 30 días de la 11.2, que no está construida).
 */
export function correoAvisoSuspension(p: { razonSocial: string; venceEn: string; urlPago: string }): { subject: string; text: string; html: string } {
  const fecha = fechaYHoraBogota(p.venceEn)
  const lineas = [
    'Hola:',
    `No hemos recibido el pago de este mes del plan de Valida de ${p.razonSocial}.`,
    `Si no se paga antes del ${fecha} (hora de Colombia), se suspenden las consultas nuevas hasta que se pague. Los reportes que ya generaste siguen disponibles.`,
    `Puedes pagar aquí: ${p.urlPago}. Si ya pagaste, no tienes que hacer nada.`,
    'METRIK IA S.A.S.',
  ]
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return { subject: 'Valida: el pago de tu plan está pendiente', text: lineas.join('\n\n'), html: lineas.map((l) => `<p>${esc(l)}</p>`).join('\n') }
}

export interface DepsSuspension {
  db: SupabaseClient
  ahoraMs?: number
  enviarCorreo: (m: CorreoSaliente) => Promise<ResultadoEnvio>
  urlPago?: (slug: string) => string
}

export interface ResumenSuspension {
  revisados: number
  avisos: number
  fallidos: { workspaceId: string; error: string }[]
}

function urlPagoPorDefecto(slug: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${slug}.${base}/suscripcion`
}

export async function avisarSuspensionesProximas(deps: DepsSuspension): Promise<ResumenSuspension> {
  const db = deps.db as Db
  const ahoraMs = deps.ahoraMs ?? Date.now()
  const resumen: ResumenSuspension = { revisados: 0, avisos: 0, fallidos: [] }

  const ws = await db.from('workspaces').select('id, slug, config_extra').eq('config_extra->>origen_registro', 'valida_autogestion')
  if (ws.error) throw new Error(`espacios autogestionados: ${ws.error.message}`)
  for (const w of (ws.data ?? []) as { id: string; slug: string; config_extra: Record<string, unknown> | null }[]) {
    const plan = planDeConfig(w.config_extra)
    if (!plan || !debeAvisarSuspension(plan.vence_en, ahoraMs)) continue
    resumen.revisados += 1

    // Sin contrato activo (retirado o terminado) no hay nada que pagar ni que avisar.
    const sc = await db.from('servicios_contratados').select('id').eq('workspace_pagador_id', w.id).eq('estado', 'activo')
    if (sc.error || (sc.data ?? []).length === 0) continue

    const reg = await db
      .from('valida_registros')
      .select('id, correo, razon_social, aviso_suspension_para')
      .eq('workspace_id', w.id)
      .eq('estado', 'creado')
      .maybeSingle()
    const r = reg.data as { id: string; correo: string; razon_social: string; aviso_suspension_para: string | null } | null
    if (reg.error || !r) continue
    if (r.aviso_suspension_para && Date.parse(r.aviso_suspension_para) === Date.parse(plan.vence_en)) continue

    // Se reclama con el valor que se leyó: dos corridas a la vez mandan un solo correo.
    const previo = r.aviso_suspension_para
    let q = db.from('valida_registros').update({ aviso_suspension_para: plan.vence_en }).eq('id', r.id)
    q = previo ? q.eq('aviso_suspension_para', previo) : q.is('aviso_suspension_para', null)
    const reclamo = await q.select('id')
    if (reclamo.error || (reclamo.data ?? []).length === 0) continue

    const correo = correoAvisoSuspension({ razonSocial: r.razon_social, venceEn: plan.vence_en, urlPago: (deps.urlPago ?? urlPagoPorDefecto)(w.slug) })
    const envio = await deps.enviarCorreo({ to: r.correo, ...correo, idempotencyKey: `valida-aviso-suspension-${r.id}-${Date.parse(plan.vence_en)}` })
    if (envio.ok) resumen.avisos += 1
    else {
      await db.from('valida_registros').update({ aviso_suspension_para: previo }).eq('id', r.id).eq('aviso_suspension_para', plan.vence_en)
      resumen.fallidos.push({ workspaceId: w.id, error: envio.error })
    }
  }
  return resumen
}
