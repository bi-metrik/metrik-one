import { asignarResponsableCon, sincronizarResponsablePrincipal } from '../../../../supabase/functions/_shared/asignar-responsable.ts'
import type { Pantallazo } from '@/lib/cotizaciones/asistente/armar-con-modelo'
import type { Casa } from '@/lib/cotizaciones/asistente/a-propuesta'
import { politicaYReglasDelNegocio } from '@/lib/cotizaciones/convencion-margen'
import { reglasAlNacer } from '@/lib/cotizaciones/reglas-margen'
import { terminosInicialesDeCotizacion } from '@/lib/cotizaciones/terminos-al-crear'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import type { Requisitos } from './esquema'
import type { ConfigEntrega, Entrega, EstadoEntrega, Pieza, PuertoEntrega } from './flujo'
import { pdfDeLaEntrega } from './pdf'

/**
 * El puerto de la entrega única contra Supabase, con el cliente de SERVICIO: lo invoca el webhook de
 * WhatsApp por la ruta interna (`/api/interno/entrega-bloqueo`), sin sesión. Cada lectura y escritura
 * va filtrada por el workspace de la entrega.
 *
 * Lo que replica de la app (sin sesión no se pueden llamar las server actions):
 *  · el viaje nace como lo crea el bot (`wa-entendimiento.ts › crearNegocio`): línea de la bandeja,
 *    etapa «Solicitud», bloques de la etapa, empresa espejo y responsable = quien entrega;
 *  · el paso a «Cotización» como `cambiarEtapaNegocio`: `etapa_actual_id`/`stage_actual`, los bloques
 *    de la etapa y la línea `cambio_etapa` en `activity_log` (la hora; `etapa_cambiada_at` la pone el
 *    trigger);
 *  · la cotización nace como `createCotizacionDetalladaNegocio`: consecutivo por RPC, política de margen
 *    y términos copiados de la línea, en borrador.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

const BUCKET = 'gastos-soportes'

function aEntrega(f: Record<string, unknown>): Entrega {
  return {
    id: f.id as string, workspaceId: f.workspace_id as string, staffId: (f.staff_id as string | null) ?? null, telefono: f.telefono as string,
    estado: f.estado as EstadoEntrega, codigo: (f.codigo as string | null) ?? null, negocioId: (f.negocio_id as string | null) ?? null,
    cotizacionId: (f.cotizacion_id as string | null) ?? null, contactoId: (f.contacto_id as string | null) ?? null,
    salida: (f.salida as Entrega['salida']) ?? null, preguntas: (f.preguntas as Entrega['preguntas']) ?? [], resueltas: (f.resueltas as string[]) ?? [],
    tipoConfirmado: f.tipo_confirmado === true, validacion: (f.validacion as Entrega['validacion']) ?? null, pdfRef: (f.pdf_ref as string | null) ?? null,
    tiempos: (f.tiempos as Entrega['tiempos']) ?? {}, uso: (f.uso as Entrega['uso']) ?? [], error: (f.error as string | null) ?? null,
  }
}

const COLUMNA: Partial<Record<keyof Entrega, string>> = {
  staffId: 'staff_id', estado: 'estado', codigo: 'codigo', negocioId: 'negocio_id', cotizacionId: 'cotizacion_id', contactoId: 'contacto_id',
  salida: 'salida', preguntas: 'preguntas', resueltas: 'resueltas', tipoConfirmado: 'tipo_confirmado', validacion: 'validacion',
  pdfRef: 'pdf_ref', tiempos: 'tiempos', uso: 'uso', error: 'error',
}

/** `one://bucket/ruta` → { bucket, ruta }. */
export function partirRef(ref: string): { bucket: string; ruta: string } {
  const m = /^one:\/\/([^/]+)\/(.+)$/.exec(ref)
  if (!m) throw new Error(`Referencia de archivo inválida: ${ref}`)
  return { bucket: m[1], ruta: m[2] }
}

/** Los valores del bloque «Condiciones del viaje» que se conocen por los requisitos (solo los slugs que existan). */
export function datosDelViaje(r: Requisitos, slugs: ReadonlySet<string>): Record<string, unknown> {
  const v: Record<string, unknown> = {
    destino: r.destino?.toUpperCase() ?? null,
    ciudad_origen: r.ciudadOrigen?.toUpperCase() ?? null,
    modalidad_viaje: 'bloqueo',
    operador_bloqueo: r.operadorDeclarado,
    fecha_salida: r.fechaIda,
    fecha_regreso: r.fechaRegreso,
    adultos: r.viajeros?.adultos ?? null,
    ninos: r.viajeros ? r.viajeros.ninos.length : null,
    numero_pasajeros: r.viajeros ? r.viajeros.adultos + r.viajeros.ninos.length : null,
    edades_menores: r.viajeros?.ninos.length ? r.viajeros.ninos.map(n => n.edad).join(', ') : null,
  }
  return Object.fromEntries(Object.entries(v).filter(([k, x]) => slugs.has(k) && x !== null && x !== undefined))
}

export function puertoSupabase(sb: Sb, opts: { baseDominio: string }): PuertoEntrega {
  async function lineaYEtapas(workspaceId: string) {
    const { data: ws, error } = await sb.from('workspaces').select('slug, linea_activa_id, config_extra').eq('id', workspaceId).single()
    if (error || !ws) throw new Error(`No se pudo leer el workspace: ${error?.message ?? 'no existe'}`)
    const lineaId = ws.config_extra?.bandeja_solicitudes?.linea_id || ws.linea_activa_id
    if (!lineaId) throw new Error('El workspace no declara la línea de viajes (bandeja_solicitudes.linea_id)')
    const { data: etapas } = await sb.from('etapas_negocio').select('id, nombre, stage, orden').eq('linea_id', lineaId).order('orden', { ascending: true })
    const lista = (etapas ?? []) as { id: string; nombre: string; stage: string | null; orden: number }[]
    const solicitud = lista[0]
    const cotizacion = lista.find(e => /cotizaci/i.test(e.nombre)) ?? lista[1]
    if (!solicitud || !cotizacion) throw new Error('La línea no tiene las etapas Solicitud y Cotización')
    return { slug: ws.slug as string, config: ws.config_extra ?? {}, lineaId: lineaId as string, solicitud, cotizacion }
  }

  async function instanciarBloques(negocioId: string, workspaceId: string, etapaId: string, datos: Record<string, unknown> = {}) {
    const { data: bcs } = await sb.from('bloque_configs').select('id, config_extra, bloque_definitions(tipo)').eq('etapa_id', etapaId).eq('workspace_id', workspaceId)
    const { data: ya } = await sb.from('negocio_bloques').select('bloque_config_id').eq('negocio_id', negocioId)
    const existentes = new Set(((ya ?? []) as { bloque_config_id: string }[]).map(x => x.bloque_config_id))
    const filas = ((bcs ?? []) as { id: string; config_extra: { fields?: { slug: string; default?: unknown }[] } | null; bloque_definitions: { tipo: string } | null }[])
      .filter(b => !existentes.has(b.id))
      .map(b => {
        const fields = Array.isArray(b.config_extra?.fields) ? b.config_extra!.fields : []
        const data: Record<string, unknown> = {}
        for (const f of fields) if (f.default !== undefined) data[f.slug] = f.default
        if (b.bloque_definitions?.tipo === 'datos') Object.assign(data, datosDelViaje(datos as unknown as Requisitos, new Set(fields.map(f => f.slug))))
        return { negocio_id: negocioId, bloque_config_id: b.id, estado: 'pendiente', data }
      })
    if (filas.length) {
      const { error } = await sb.from('negocio_bloques').insert(filas)
      if (error) console.error(`[entrega-bloqueo] negocio ${negocioId} sin bloques de la etapa:`, error.message)
    }
  }

  return {
    ahora: () => new Date(),

    async config(workspaceId): Promise<ConfigEntrega> {
      const { data } = await sb.from('workspaces').select('config_extra').eq('id', workspaceId).single()
      const c = data?.config_extra?.entrega_bloqueo ?? {}
      if (typeof c.manual !== 'string' || !c.manual.trim()) throw new Error('Falta config_extra.entrega_bloqueo.manual')
      if (!c.casa || typeof c.casa !== 'object') throw new Error('Falta config_extra.entrega_bloqueo.casa')
      return { manual: c.manual, casa: c.casa as Casa }
    },

    async leerEntrega(id) {
      const { data } = await sb.from('entregas_bloqueo').select('*').eq('id', id).maybeSingle()
      return data ? aEntrega(data) : null
    },

    async tomar(id, de, a) {
      const { data } = await sb.from('entregas_bloqueo').update({ estado: a, updated_at: new Date().toISOString() }).eq('id', id).in('estado', de).select('id')
      return (data ?? []).length === 1
    },

    async guardarEntrega(id, cambios) {
      const fila: Record<string, unknown> = { updated_at: new Date().toISOString() }
      for (const [k, v] of Object.entries(cambios)) { const col = COLUMNA[k as keyof Entrega]; if (col) fila[col] = v }
      const { error } = await sb.from('entregas_bloqueo').update(fila).eq('id', id)
      if (error) throw new Error(`No se pudo guardar la entrega: ${error.message}`)
    },

    async piezas(entregaId): Promise<Pieza[]> {
      const { data } = await sb.from('entregas_bloqueo_piezas').select('*').eq('entrega_id', entregaId).order('created_at', { ascending: true })
      return ((data ?? []) as Record<string, unknown>[]).map(p => ({
        id: p.id as string, entregaId: p.entrega_id as string, direccion: p.direccion as Pieza['direccion'], wamid: (p.wamid as string | null) ?? null,
        contextoWamid: (p.contexto_wamid as string | null) ?? null, tipo: p.tipo as Pieza['tipo'], texto: (p.texto as string | null) ?? null,
        mediaRef: (p.media_ref as string | null) ?? null, mime: (p.mime as string | null) ?? null, en: p.created_at as string,
      }))
    },

    async leerPantallazo(ref): Promise<Pantallazo> {
      const { bucket, ruta } = partirRef(ref)
      const { data, error } = await sb.storage.from(bucket).download(ruta)
      if (error || !data) throw new Error(`No se pudo leer el pantallazo ${ruta}: ${error?.message ?? 'vacío'}`)
      const buf = Buffer.from(await data.arrayBuffer())
      return { nombre: ruta.split('/').pop()!, mime: data.type || 'image/jpeg', base64: buf.toString('base64') }
    },

    async buscarCliente(workspaceId, nombre) {
      const { data, error } = await sb.rpc('buscar_clientes_por_nombre', { p_workspace_id: workspaceId, p_texto: nombre })
      if (error) return null
      const exactos = ((data ?? []) as { id: string; exacto?: boolean }[]).filter(f => f.exacto === true)
      // Uno solo y exacto: es ella. Varios o ninguno: no se adivina (el viaje queda sin cliente y se le pide el celular).
      return exactos.length === 1 ? { id: exactos[0].id } : null
    },

    async abrirViaje(e, r, contactoId) {
      const l = await lineaYEtapas(e.workspaceId)
      let empresaId: string | null = null
      if (contactoId) {
        const { data: ya } = await sb.from('empresas').select('id').eq('workspace_id', e.workspaceId).eq('contacto_id', contactoId).limit(1).maybeSingle()
        empresaId = ya?.id ?? null
      }
      const nombre = [r.destino, r.cliente].filter(Boolean).join(' · ').toUpperCase() || 'BLOQUEO'
      const { data: neg, error } = await sb.from('negocios').insert({
        workspace_id: e.workspaceId, nombre, linea_id: l.lineaId, contacto_id: contactoId, ...(empresaId ? { empresa_id: empresaId } : {}),
        etapa_actual_id: l.solicitud.id, stage_actual: l.solicitud.stage, estado: 'abierto', origen: 'whatsapp',
        metadata: { nombre_auto: nombre, nombre_provisional: !r.destino, entrega_bloqueo_id: e.id, cliente_por_confirmar: contactoId ? null : r.cliente },
      }).select('id, created_at').single()
      if (error || !neg) throw new Error(`No se pudo abrir el viaje: ${error?.message ?? 'sin fila'}`)
      await instanciarBloques(neg.id, e.workspaceId, l.solicitud.id, r as unknown as Record<string, unknown>)
      if (e.staffId) {
        const { data: st } = await sb.from('staff').select('profile_id').eq('id', e.staffId).maybeSingle()
        const asignadoPor = (st?.profile_id as string | null) ?? null
        const res = await asignarResponsableCon(sb, { negocioId: neg.id, staffId: e.staffId, assignedBy: asignadoPor, origen: asignadoPor ? 'persona' : 'bot_whatsapp' }, async fila => {
          await registrarActividad(sb, fila, 'entregaBloqueo.responsable')
        })
        if (!res.error) await sincronizarResponsablePrincipal(sb, neg.id, e.workspaceId)
      }
      await registrarActividad(sb, {
        workspace_id: e.workspaceId, entidad_tipo: 'negocio', entidad_id: neg.id, tipo: 'cambio_sistema', autor_id: e.staffId,
        contenido: 'Viaje en Bloqueo abierto desde WhatsApp (entrega única). Los datos quedan por confirmar hasta que la asesora responda.',
      }, 'entregaBloqueo.abrirViaje')
      const { data: n2 } = await sb.from('negocios').select('responsable_id').eq('id', neg.id).maybeSingle()
      return { negocioId: neg.id as string, responsableStaffId: (n2?.responsable_id as string | null) ?? e.staffId, en: neg.created_at as string }
    },

    async actualizarViaje(negocioId, r) {
      const { data: bloques } = await sb.from('negocio_bloques').select('id, data, bloque_configs!inner(config_extra, bloque_definitions(tipo))').eq('negocio_id', negocioId)
      for (const b of (bloques ?? []) as { id: string; data: Record<string, unknown>; bloque_configs: { config_extra: { fields?: { slug: string }[] } | null; bloque_definitions: { tipo: string } | null } }[]) {
        if (b.bloque_configs?.bloque_definitions?.tipo !== 'datos') continue
        const slugs = new Set((b.bloque_configs.config_extra?.fields ?? []).map(f => f.slug))
        const nuevos = datosDelViaje(r, slugs)
        if (!Object.keys(nuevos).length) continue
        await sb.from('negocio_bloques').update({ data: { ...(b.data ?? {}), ...nuevos } }).eq('id', b.id)
      }
    },

    async moverACotizacion(negocioId, staffId) {
      const { data: n } = await sb.from('negocios').select('workspace_id, etapa_actual_id').eq('id', negocioId).single()
      const l = await lineaYEtapas(n.workspace_id)
      const { error } = await sb.from('negocios').update({ etapa_actual_id: l.cotizacion.id, stage_actual: l.cotizacion.stage }).eq('id', negocioId).eq('workspace_id', n.workspace_id)
      if (error) throw new Error(`No se pudo pasar el viaje a Cotización: ${error.message}`)
      await instanciarBloques(negocioId, n.workspace_id, l.cotizacion.id)
      const en = new Date().toISOString()
      await registrarActividad(sb, {
        workspace_id: n.workspace_id, entidad_tipo: 'negocio', entidad_id: negocioId, tipo: 'cambio_etapa', autor_id: staffId,
        campo_modificado: 'etapa', valor_anterior: l.solicitud.nombre, valor_nuevo: l.cotizacion.nombre,
        contenido: 'Pasó solo al entregar el pedido por WhatsApp: quien lo entregó es quien lo cotiza.',
      }, 'entregaBloqueo.moverACotizacion')
      return { en }
    },

    async siguienteConsecutivo(workspaceId) {
      const { data } = await sb.rpc('get_next_cotizacion_consecutivo', { p_workspace_id: workspaceId })
      if (!data) throw new Error('No se pudo sacar el consecutivo de la cotización')
      return data as string
    },

    async guardarCotizacion(e, c) {
      const valor = c.totales.Recomendada ?? Object.values(c.totales)[0] ?? 0
      const comunes = {
        valor_total: valor, descripcion: c.borrador?.titular ?? null,
        notas: 'Armada por Trappi desde WhatsApp (entrega única). El detalle y el PDF están en la revisión de la entrega.',
      }
      if (e.cotizacionId) {
        const { error } = await sb.from('cotizaciones').update(comunes).eq('id', e.cotizacionId).eq('workspace_id', e.workspaceId).eq('estado', 'borrador')
        if (error) throw new Error(`No se pudo actualizar la cotización: ${error.message}`)
        return e.cotizacionId
      }
      const { politica, reglas } = await politicaYReglasDelNegocio(sb, c.negocioId)
      const terminos = await terminosInicialesDeCotizacion(sb, { workspaceId: e.workspaceId, negocioId: c.negocioId })
      const { data, error } = await sb.from('cotizaciones').insert({
        workspace_id: e.workspaceId, negocio_id: c.negocioId, consecutivo: c.consecutivo, codigo: '', modo: 'detallada', estado: 'borrador',
        convencion_margen: politica.convencion, margen_default_pct: politica.defaultPct, piso_margen_pct: politica.pisoPct, aviso_margen_pct: politica.avisoPct,
        ...(terminos ? { terminos_condiciones: terminos } : {}), ...(reglas ? { reglas_margen: reglasAlNacer(reglas) } : {}),
        ...comunes,
      }).select('id').single()
      if (error || !data) throw new Error(`No se pudo crear la cotización: ${error?.message ?? 'sin fila'}`)
      return data.id as string
    },

    async renderPdf(e, x) {
      // La asesora del documento es la que entregó el pedido (su ficha de staff), no la del ejemplo de la casa.
      let casa = x.casa
      if (e.staffId) {
        const { data: st } = await sb.from('staff').select('full_name, phone_whatsapp').eq('id', e.staffId).maybeSingle()
        if (st?.full_name) {
          const cel = String(st.phone_whatsapp ?? '').replace(/\D/g, '')
          casa = { ...casa, asesora: { ...casa.asesora, nombre: st.full_name, celular: cel ? `+${cel}` : casa.asesora.celular, whatsapp: cel || casa.asesora.whatsapp } }
        }
      }
      const hoy = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)
      return pdfDeLaEntrega({ codigo: e.codigo!, hoy, borrador: x.borrador, validado: x.validado, requisitos: x.requisitos, pantallazos: x.pantallazos, casa })
    },

    async subirPdf(e, nombre, pdf) {
      const ruta = `${e.workspaceId}/entregas-bloqueo/${e.id}/${Date.now()}.pdf`
      const { error } = await sb.storage.from(BUCKET).upload(ruta, pdf, { contentType: 'application/pdf', upsert: false })
      if (error) throw new Error(`No se pudo guardar el PDF: ${error.message}`)
      // Meta baja el documento de este enlace (document-messages: `link`); vale 1 hora.
      const { data: firmado } = await sb.storage.from(BUCKET).createSignedUrl(ruta, 3600, { download: nombre })
      if (!firmado?.signedUrl) throw new Error('No se pudo firmar el enlace del PDF')
      return { ref: `one://${BUCKET}/${ruta}`, url: firmado.signedUrl as string }
    },

    async enlaceRevision(e) {
      const { data } = await sb.from('workspaces').select('slug').eq('id', e.workspaceId).single()
      return `https://${data?.slug}.${opts.baseDominio}/negocios/entrega/${e.id}`
    },
  }
}
