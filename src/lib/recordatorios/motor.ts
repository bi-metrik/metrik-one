/**
 * Motor de recordatorios hacia atrás (post-cotización, PR 4; diseño técnico §4, Vera §7.7).
 *
 * Una corrida: lee las líneas con `config_extra.recordatorios.activo`, sus negocios abiertos y las
 * fechas de cada fuente; cruza cada fecha con las reglas de la línea; y por cada aviso que toca hoy
 * lo RECLAMA en `recordatorios_log` antes de mandarlo. La llave única del log
 * (regla, entidad, fecha objetivo, destinatario, canal) hace que dos corridas a la vez manden uno
 * solo. Un aviso que falló se vuelve a reclamar en la siguiente corrida, hasta 3 intentos.
 *
 * Canales: hoy solo `in_app` (fila en `notificaciones` con enlace al negocio). Una regla que pide
 * `email` o `wa_manual` no reclama nada por ese canal (no gasta la llave): esos canales llegan con
 * los avisos al viajero (F2) y entonces mandan desde el primer día que apliquen.
 *
 * El cliente de base es `service_role` (lo crea la ruta del cron); todas las lecturas filtran por
 * las líneas encendidas, y cada escritura lleva el `workspace_id` del negocio.
 */

import { esDiaHabil } from '@/lib/dates/dias-habiles'
import {
  CANALES_SOPORTADOS,
  MAX_INTENTOS,
  aprobadoresDeConfig,
  configDeLinea,
  fechaDeDisparo,
  tocaHoy,
  type CanalRecordatorio,
  type ReglaRecordatorio,
} from './reglas'
import {
  candidatosDeEnvio,
  candidatosDePagoProveedor,
  textoDelAviso,
  tipoDeNotificacion,
  type Candidato,
  type CotizacionEnviada,
  type NegocioFuente,
  type ServicioFuente,
} from './fuentes'

// El esquema nuevo (negocio_servicios, recordatorios_log) no está en los tipos generados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

export interface ResumenRecordatorios {
  lineas: number
  negocios: number
  candidatos: number
  enviados: number
  ya_reclamados: number
  fallidos: number
  sin_destinatario: number
  canal_sin_soporte: number
  reglas_descartadas: number
  dia_no_habil?: boolean
}

/** `.in()` con cientos de uuid rompe PostgREST (cabecera demasiado larga): por tandas. */
const TANDA = 150

async function porTandas<T>(ids: string[], leer: (tanda: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += TANDA) out.push(...(await leer(ids.slice(i, i + TANDA))))
  return out
}

function sinError<T>(res: { data: T[] | null; error: { message: string } | null }, que: string): T[] {
  if (res.error) throw new Error(`recordatorios: no se pudo leer ${que}: ${res.error.message}`)
  return res.data ?? []
}

interface Linea {
  id: string
  workspace_id: string
  config_extra: unknown
}

/** A quién va cada destino de una regla, en `profile_id`. Con caché por negocio y destino. */
class Destinatarios {
  private cache = new Map<string, string[]>()
  constructor(private svc: Db) {}

  async de(destino: string, negocio: NegocioFuente, linea: Linea): Promise<string[]> {
    const llave = `${negocio.id}|${destino}`
    const hit = this.cache.get(llave)
    if (hit) return hit
    const ids = await this.resolver(destino, negocio, linea)
    const unicos = [...new Set(ids.filter(Boolean))]
    this.cache.set(llave, unicos)
    return unicos
  }

  private async perfilesDeStaff(staffIds: string[], workspaceId: string): Promise<string[]> {
    if (staffIds.length === 0) return []
    const res = await this.svc
      .from('staff')
      .select('profile_id')
      .eq('workspace_id', workspaceId)
      .in('id', staffIds)
    return sinError<{ profile_id: string | null }>(res, 'staff').map((s) => s.profile_id ?? '').filter(Boolean)
  }

  private async resolver(destino: string, negocio: NegocioFuente, linea: Linea): Promise<string[]> {
    if (destino === 'responsable') {
      // El mismo enrutamiento de todos los avisos del negocio: comercial en venta, operaciones
      // en ejecución (función `destinatarios_negocio`, 2026-07-27).
      const { data, error } = await this.svc.rpc('destinatarios_negocio', { p_negocio_id: negocio.id })
      if (error) throw new Error(`recordatorios: destinatarios_negocio: ${error.message}`)
      return ((data ?? []) as Array<{ profile_id: string | null }>).map((d) => d.profile_id ?? '')
    }
    if (destino === 'aprobadores') {
      return this.perfilesDeStaff(aprobadoresDeConfig(linea.config_extra), negocio.workspace_id)
    }
    const area = /^area:(comercial|operaciones|financiera)$/.exec(destino)?.[1]
    if (area) {
      // Primero quien lleva ese espacio del negocio; si nadie, todo el área del workspace.
      const resp = sinError<{ staff_id: string }>(
        await this.svc.from('negocio_responsables').select('staff_id').eq('negocio_id', negocio.id).eq('rol', area),
        'negocio_responsables',
      )
      if (resp.length > 0) return this.perfilesDeStaff(resp.map((r) => r.staff_id), negocio.workspace_id)
      const delArea = sinError<{ profile_id: string | null }>(
        await this.svc
          .from('staff')
          .select('profile_id, staff_areas!inner(area)')
          .eq('workspace_id', negocio.workspace_id)
          .eq('is_active', true)
          .eq('staff_areas.area', area),
        'staff del área',
      )
      return delArea.map((s) => s.profile_id ?? '')
    }
    // `cliente` y destinos desconocidos: ningún canal de hoy los alcanza.
    return []
  }
}

type Reclamo = { id: string; intentos: number } | null

const CONFLICTO = 'regla_id,entidad_id,fecha_objetivo,destinatario,canal'

/**
 * Reclama el aviso. Devuelve la fila reclamada, o `null` si ya lo reclamó otra corrida (o ya
 * salió, o ya se agotaron los intentos). Un `fallido` con intentos libres se reclama otra vez.
 */
export async function reclamar(
  svc: Db,
  fila: {
    workspace_id: string
    negocio_id: string
    regla_id: string
    entidad_tipo: string
    entidad_id: string
    fecha_objetivo: string
    destinatario: string
    canal: string
  },
): Promise<Reclamo> {
  const ins = await svc
    .from('recordatorios_log')
    .upsert({ ...fila, estado: 'reclamado', intentos: 1 }, { onConflict: CONFLICTO, ignoreDuplicates: true })
    .select('id, intentos')
  if (ins.error) throw new Error(`recordatorios: no se pudo reclamar: ${ins.error.message}`)
  const nueva = (ins.data ?? [])[0] as { id: string; intentos: number } | undefined
  if (nueva) return nueva

  const prev = await svc
    .from('recordatorios_log')
    .select('id, estado, intentos')
    .eq('regla_id', fila.regla_id)
    .eq('entidad_id', fila.entidad_id)
    .eq('fecha_objetivo', fila.fecha_objetivo)
    .eq('destinatario', fila.destinatario)
    .eq('canal', fila.canal)
    .maybeSingle()
  const p = prev.data as { id: string; estado: string; intentos: number } | null
  if (!p || p.estado !== 'fallido' || p.intentos >= MAX_INTENTOS) return null

  // El reintento también reclama: solo pasa quien lo saca de `fallido` con ese número de intentos.
  const upd = await svc
    .from('recordatorios_log')
    .update({ estado: 'reclamado', intentos: p.intentos + 1, error: null })
    .eq('id', p.id)
    .eq('estado', 'fallido')
    .eq('intentos', p.intentos)
    .select('id, intentos')
  const r = (upd.data ?? [])[0] as { id: string; intentos: number } | undefined
  return r ?? null
}

async function mandarInApp(svc: Db, c: Candidato, regla: ReglaRecordatorio, destinatario: string, hoy: string) {
  const { error } = await svc.from('notificaciones').insert({
    workspace_id: c.negocio.workspace_id,
    destinatario_id: destinatario,
    tipo: tipoDeNotificacion(c, regla.offset, hoy),
    estado: 'pendiente',
    contenido: textoDelAviso(c, regla.offset, hoy),
    entidad_tipo: c.entidadTipo === 'servicio' ? 'servicio' : 'negocio',
    entidad_id: c.entidadTipo === 'servicio' ? c.entidadId : c.negocio.id,
    deep_link: `/negocios/${c.negocio.id}`,
    metadata: { regla_id: regla.id, fecha_objetivo: c.fechaObjetivo, fuente: c.fuente, negocio_id: c.negocio.id },
  })
  if (error) throw new Error(error.message)
}

/** Carga lo que leen las fuentes para las líneas encendidas. */
async function cargar(svc: Db, lineas: Linea[], fuentes: Set<string>) {
  const lineaIds = lineas.map((l) => l.id)
  const negociosRaw = await porTandas(lineaIds, async (t) =>
    sinError<{
      id: string; workspace_id: string; linea_id: string; nombre: string; codigo: string | null
      contacto_id: string | null; etapa_actual_id: string | null; pausado: boolean | null; estado: string
    }>(
      await svc
        .from('negocios')
        .select('id, workspace_id, linea_id, nombre, codigo, contacto_id, etapa_actual_id, pausado, estado')
        .in('linea_id', t)
        .eq('estado', 'abierto'),
      'negocios',
    ),
  )
  const etapaIds = [...new Set(negociosRaw.map((n) => n.etapa_actual_id).filter((x): x is string => !!x))]
  const etapas = await porTandas(etapaIds, async (t) =>
    sinError<{ id: string; numero: number }>(await svc.from('etapas_negocio').select('id, numero').in('id', t), 'etapas'),
  )
  const numeroDe = new Map(etapas.map((e) => [e.id, e.numero]))
  const contactoIds = [...new Set(negociosRaw.map((n) => n.contacto_id).filter((x): x is string => !!x))]
  const contactos = fuentes.has('envio')
    ? await porTandas(contactoIds, async (t) =>
        sinError<{ id: string; nombre: string }>(await svc.from('contactos').select('id, nombre').in('id', t), 'contactos'),
      )
    : []
  const nombreDe = new Map(contactos.map((c) => [c.id, c.nombre]))

  const negocios: NegocioFuente[] = negociosRaw.map((n) => ({
    id: n.id,
    workspace_id: n.workspace_id,
    linea_id: n.linea_id,
    nombre: n.nombre,
    codigo: n.codigo,
    contacto_nombre: n.contacto_id ? nombreDe.get(n.contacto_id) ?? null : null,
    etapa_numero: n.etapa_actual_id ? numeroDe.get(n.etapa_actual_id) ?? null : null,
    pausado: n.pausado === true,
    estado: n.estado,
  }))
  const negocioIds = negocios.map((n) => n.id)

  const cotizaciones: CotizacionEnviada[] = fuentes.has('envio')
    ? await porTandas(negocioIds, async (t) =>
        sinError<CotizacionEnviada>(
          await svc.from('cotizaciones').select('id, negocio_id, fecha_envio').in('negocio_id', t).not('fecha_envio', 'is', null),
          'cotizaciones',
        ),
      )
    : []

  let servicios: ServicioFuente[] = []
  const pagado = new Map<string, number>()
  if (fuentes.has('pago_proveedor')) {
    servicios = await porTandas(negocioIds, async (t) =>
      sinError<ServicioFuente>(
        await svc
          .from('negocio_servicios')
          .select('id, negocio_id, nombre, estado, fecha_limite_pago, costo_cotizado, valor_por_pagar')
          .in('negocio_id', t)
          .in('estado', ['por_reservar', 'reservado'])
          .not('fecha_limite_pago', 'is', null),
        'servicios',
      ),
    )
    const gastos = await porTandas(servicios.map((s) => s.id), async (t) =>
      sinError<{ servicio_id: string; monto: number }>(
        await svc.from('gastos').select('servicio_id, monto').in('servicio_id', t),
        'gastos',
      ),
    )
    for (const g of gastos) pagado.set(g.servicio_id, (pagado.get(g.servicio_id) ?? 0) + Number(g.monto ?? 0))
  }
  return { negocios, cotizaciones, servicios, pagado }
}

export async function correrRecordatorios(svc: Db, opts: { hoy: string }): Promise<ResumenRecordatorios> {
  const { hoy } = opts
  const resumen: ResumenRecordatorios = {
    lineas: 0, negocios: 0, candidatos: 0, enviados: 0, ya_reclamados: 0, fallidos: 0,
    sin_destinatario: 0, canal_sin_soporte: 0, reglas_descartadas: 0,
  }
  // Todo aviso sale en día hábil (la fecha de disparo siempre lo es); un sábado no se lee nada.
  if (!esDiaHabil(hoy)) return { ...resumen, dia_no_habil: true }

  const lineasRaw = sinError<Linea>(
    await svc
      .from('lineas_negocio')
      .select('id, workspace_id, config_extra')
      .filter('config_extra->recordatorios->>activo', 'eq', 'true'),
    'líneas',
  )
  const lineas: Linea[] = []
  const reglasDe = new Map<string, ReglaRecordatorio[]>()
  for (const l of lineasRaw) {
    const cfg = configDeLinea(l.config_extra)
    resumen.reglas_descartadas += cfg.descartadas
    if (!cfg.activo || cfg.reglas.length === 0) continue
    lineas.push(l)
    reglasDe.set(l.id, cfg.reglas)
  }
  resumen.lineas = lineas.length
  if (lineas.length === 0) return resumen

  const fuentes = new Set([...reglasDe.values()].flat().map((r) => r.fuente))
  const { negocios, cotizaciones, servicios, pagado } = await cargar(svc, lineas, fuentes)
  resumen.negocios = negocios.length
  const lineaDe = new Map(lineas.map((l) => [l.id, l]))

  const candidatos = [
    ...(fuentes.has('envio') ? candidatosDeEnvio(negocios, cotizaciones) : []),
    ...(fuentes.has('pago_proveedor') ? candidatosDePagoProveedor(negocios, servicios, pagado) : []),
  ]
  const destinatarios = new Destinatarios(svc)

  for (const c of candidatos) {
    const linea = lineaDe.get(c.negocio.linea_id)
    if (!linea) continue
    for (const regla of reglasDe.get(linea.id) ?? []) {
      if (regla.fuente !== c.fuente) continue
      if (regla.etapa_numero !== null && c.negocio.etapa_numero !== regla.etapa_numero) continue
      if (regla.fuente === 'envio' && c.negocio.pausado) continue
      const disparo = fechaDeDisparo(regla, c.fechaObjetivo)
      if (!tocaHoy(disparo, hoy)) continue
      resumen.candidatos++

      const canales = regla.canales.filter((k): k is CanalRecordatorio =>
        (CANALES_SOPORTADOS as readonly string[]).includes(k),
      )
      resumen.canal_sin_soporte += regla.canales.length - canales.length
      if (canales.length === 0) continue

      const perfiles = new Set<string>()
      for (const destino of regla.a) for (const p of await destinatarios.de(destino, c.negocio, linea)) perfiles.add(p)
      if (perfiles.size === 0) { resumen.sin_destinatario++; continue }

      for (const destinatario of perfiles) {
        for (const canal of canales) {
          const reclamo = await reclamar(svc, {
            workspace_id: c.negocio.workspace_id,
            negocio_id: c.negocio.id,
            regla_id: regla.id,
            entidad_tipo: c.entidadTipo,
            entidad_id: c.entidadId,
            fecha_objetivo: c.fechaObjetivo,
            destinatario,
            canal,
          })
          if (!reclamo) { resumen.ya_reclamados++; continue }
          try {
            await mandarInApp(svc, c, regla, destinatario, hoy)
            await svc
              .from('recordatorios_log')
              .update({ estado: 'enviado', enviado_at: new Date().toISOString(), error: null })
              .eq('id', reclamo.id)
            resumen.enviados++
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error('[recordatorios] no salió', regla.id, c.entidadId, msg)
            await svc.from('recordatorios_log').update({ estado: 'fallido', error: msg.slice(0, 500) }).eq('id', reclamo.id)
            resumen.fallidos++
          }
        }
      }
    }
  }
  return resumen
}
