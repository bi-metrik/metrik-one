/**
 * Entrar y salir de «En viaje» por fechas, sin intervención (F6-1, F6-2; diseño técnico §6).
 *
 * Lo corre el cron diario con `service_role`. Para cada línea con `config_extra.etapas_por_fecha`:
 *   · el día de salida (o después, si el cron no corrió), un negocio en la etapa anterior a «En
 *     viaje» entra. Si los gates de esa etapa no se cumplen, entra IGUAL (el viaje ocurre aunque
 *     el sistema diga que no; P5) con la traza y un aviso `viaje_sin_listo` a la dirección;
 *   · el día de salida, si el saldo no está en cero, aviso a la comercial y a la dirección:
 *     «{nombre} viaja hoy con saldo de $X» (no frena: no se puede frenar);
 *   · el día después del regreso, sale a la etapa siguiente.
 *
 * Idempotente: el update RECLAMA (`.eq('etapa_actual_id', desde)`): dos corridas a la vez mueven
 * una sola vez, y solo quien movió avisa e instancia. Las casillas de la etapa nueva las crea la
 * misma función del avance a mano (`instanciarBloquesDeEtapa`).
 */

import { cobradoConfirmado } from '@/lib/cobros/saldo-negocio'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { instanciarBloquesDeEtapa } from '@/lib/negocios/instanciar-bloques-etapa'
import { evaluarGateEntrega } from './entrega-datos'
import { configEtapasPorFecha, movimientoPorFecha, pesosCierre } from './cierre-viaje'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface ResumenEtapasPorFecha {
  lineas: number
  negocios: number
  entraron: number
  salieron: number
  sin_listo: number
  con_saldo: number
}

const TANDA = 150

async function porTandas<T>(ids: string[], leer: (t: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += TANDA) out.push(...(await leer(ids.slice(i, i + TANDA))))
  return out
}

function filas<T>(res: { data: T[] | null; error: { message: string } | null }, que: string): T[] {
  if (res.error) throw new Error(`etapas por fecha: no se pudo leer ${que}: ${res.error.message}`)
  return res.data ?? []
}

const fecha = (v: unknown): string | null => (typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(v.trim())?.[1] ?? null : null)

async function perfiles(svc: Db, workspaceId: string, staffIds: string[]): Promise<string[]> {
  if (staffIds.length === 0) return []
  const r = filas<{ profile_id: string | null }>(await svc.from('staff').select('profile_id').eq('workspace_id', workspaceId).in('id', staffIds), 'staff')
  return r.map((s) => s.profile_id ?? '').filter(Boolean)
}

async function responsables(svc: Db, negocioId: string): Promise<string[]> {
  const { data } = await svc.rpc('destinatarios_negocio', { p_negocio_id: negocioId })
  return ((data ?? []) as Array<{ profile_id: string | null }>).map((d) => d.profile_id ?? '').filter(Boolean)
}

async function avisar(svc: Db, workspaceId: string, negocioId: string, destinatarios: string[], contenido: string, motivo: string) {
  const unicos = [...new Set(destinatarios)]
  if (unicos.length === 0) return
  const { error } = await svc.from('notificaciones').insert(unicos.map((p) => ({
    workspace_id: workspaceId,
    destinatario_id: p,
    tipo: 'viaje_sin_listo',
    estado: 'pendiente',
    contenido: contenido.slice(0, 500),
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    deep_link: `/negocios/${negocioId}`,
    metadata: { motivo, negocio_id: negocioId },
  })))
  if (error) console.error('[etapas por fecha] aviso no salió:', error.message)
}

export async function correrEtapasPorFecha(svc: Db, opts: { hoy: string; soloNegocioId?: string | null }): Promise<ResumenEtapasPorFecha> {
  const resumen: ResumenEtapasPorFecha = { lineas: 0, negocios: 0, entraron: 0, salieron: 0, sin_listo: 0, con_saldo: 0 }
  const lineasRaw = filas<{ id: string; workspace_id: string; config_extra: unknown }>(
    await svc.from('lineas_negocio').select('id, workspace_id, config_extra').not('config_extra->etapas_por_fecha', 'is', null),
    'líneas',
  )
  const lineas = lineasRaw.map((l) => ({ ...l, cfg: configEtapasPorFecha(l.config_extra) })).filter((l) => l.cfg)
  resumen.lineas = lineas.length
  if (lineas.length === 0) return resumen

  const etapas = await porTandas(lineas.map((l) => l.id), async (t) =>
    filas<{ id: string; linea_id: string; numero: number; stage: string | null; nombre: string; is_active: boolean | null; config_extra: { gates?: unknown } | null }>(
      await svc.from('etapas_negocio').select('id, linea_id, numero, stage, nombre, is_active, config_extra').in('linea_id', t),
      'etapas',
    ),
  )
  let negocios = await porTandas(lineas.map((l) => l.id), async (t) =>
    filas<{ id: string; workspace_id: string; linea_id: string; nombre: string; etapa_actual_id: string | null; contacto_id: string | null; precio_aprobado: number | null; metadata: { es_prueba?: unknown } | null }>(
      await svc.from('negocios').select('id, workspace_id, linea_id, nombre, etapa_actual_id, contacto_id, precio_aprobado, metadata').in('linea_id', t).eq('estado', 'abierto'),
      'negocios',
    ),
  )
  if (opts.soloNegocioId) negocios = negocios.filter((n) => n.id === opts.soloNegocioId)
  resumen.negocios = negocios.length
  if (negocios.length === 0) return resumen

  const bloques = await porTandas(negocios.map((n) => n.id), async (t) =>
    filas<{ negocio_id: string; fecha_salida: unknown; fecha_regreso: unknown }>(
      await svc.from('negocio_bloques').select('negocio_id, fecha_salida:data->fecha_salida, fecha_regreso:data->fecha_regreso').in('negocio_id', t),
      'fechas del viaje',
    ),
  )
  const fechasDe = new Map<string, { salida: string | null; regreso: string | null }>()
  for (const b of bloques) {
    const f = fechasDe.get(b.negocio_id) ?? { salida: null, regreso: null }
    f.salida ??= fecha(b.fecha_salida)
    f.regreso ??= fecha(b.fecha_regreso)
    fechasDe.set(b.negocio_id, f)
  }

  for (const n of negocios) {
    const linea = lineas.find((l) => l.id === n.linea_id)!
    const cfg = linea.cfg!
    const activas = etapas.filter((e) => e.linea_id === n.linea_id && e.is_active !== false)
    const actual = activas.find((e) => e.id === n.etapa_actual_id) ?? null
    const f = fechasDe.get(n.id) ?? { salida: null, regreso: null }
    const mov = movimientoPorFecha({ config: cfg, etapaNumero: actual?.numero ?? null, salida: f.salida, regreso: f.regreso, hoy: opts.hoy })
    if (!mov || !actual) continue
    const destinoNumero = mov === 'entrar' ? cfg.entrar.etapa_numero : cfg.salir.etapa_numero
    const destino = activas.find((e) => e.numero === destinoNumero)
    if (!destino) continue

    // Antes de mover: lo que faltaba en la etapa que deja (para la traza y el aviso, P5).
    const faltaba = mov === 'entrar'
      ? await evaluarGateEntrega(svc, {
          workspaceId: n.workspace_id,
          negocioId: n.id,
          gates: ((actual.config_extra?.gates ?? []) as unknown[]).filter((g): g is string => typeof g === 'string'),
        }).catch(() => [] as string[])
      : []

    // Reclamar: solo quien lo saca de la etapa de origen sigue.
    const upd = await svc
      .from('negocios')
      .update({ etapa_actual_id: destino.id, stage_actual: destino.stage, updated_at: new Date().toISOString() })
      .eq('id', n.id)
      .eq('workspace_id', n.workspace_id)
      .eq('etapa_actual_id', actual.id)
      .select('id')
    if (upd.error) {
      console.error('[etapas por fecha] no se movió', n.id, upd.error.message)
      continue
    }
    if (((upd.data ?? []) as unknown[]).length === 0) continue
    await instanciarBloquesDeEtapa(svc, { negocioId: n.id, etapaId: destino.id, workspaceId: n.workspace_id })

    const textoMov = mov === 'entrar'
      ? `Entró a ${destino.nombre}: hoy sale el viaje.${faltaba.length ? ` Salió el viaje sin estar listo: ${faltaba.join(' ')}` : ''}`
      : `Pasó a ${destino.nombre}: el viaje regresó.`
    await registrarActividad(svc, {
      workspace_id: n.workspace_id,
      entidad_tipo: 'negocio',
      entidad_id: n.id,
      tipo: 'cambio',
      autor_id: null,
      contenido: textoMov.slice(0, 280),
    }, 'etapasPorFecha')

    if (mov === 'salir') {
      resumen.salieron++
      continue
    }
    resumen.entraron++
    const aprobadores = await perfiles(svc, n.workspace_id, (((linea.config_extra as { aprobaciones?: { staff_ids?: unknown } } | null)?.aprobaciones?.staff_ids ?? []) as unknown[]).filter((x): x is string => typeof x === 'string'))
    if (faltaba.length > 0) {
      resumen.sin_listo++
      await avisar(svc, n.workspace_id, n.id, aprobadores, `${n.nombre} salió de viaje sin estar listo: ${faltaba.join(' ')}`, 'viaje_sin_listo')
    }
    // F6-2: el día de salida con saldo, aviso a la comercial y a la dirección.
    const precio = Number(n.precio_aprobado ?? 0)
    if (precio > 0) {
      const cobros = filas<{ monto: number | null; fecha: string | null; retencion_iva: number | null; anulado_at: string | null }>(
        await svc.from('cobros').select('monto, fecha, retencion_iva, anulado_at').eq('negocio_id', n.id).eq('workspace_id', n.workspace_id),
        'pagos',
      )
      const saldo = precio - cobradoConfirmado(cobros)
      if (saldo > 0) {
        resumen.con_saldo++
        const { data: c } = n.contacto_id ? await svc.from('contactos').select('nombre').eq('id', n.contacto_id).maybeSingle() : { data: null }
        const quien = ((c as { nombre?: string } | null)?.nombre ?? '').trim() || n.nombre
        await avisar(svc, n.workspace_id, n.id, [...(await responsables(svc, n.id)), ...aprobadores], `${quien} viaja hoy con saldo de ${pesosCierre(saldo)}.`, 'viaja_con_saldo')
      }
    }
  }
  return resumen
}
