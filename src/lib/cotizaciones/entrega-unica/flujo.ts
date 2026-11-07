import type { BorradorCotizacion, Version } from '@/lib/cotizaciones/asistente/borrador'
import { validarBorrador, type Hallazgo, type Validado } from '@/lib/cotizaciones/asistente/invariantes'
import type { Pantallazo, UsoModelo } from '@/lib/cotizaciones/asistente/armar-con-modelo'
import type { Casa } from '@/lib/cotizaciones/asistente/a-propuesta'
import type { Requisitos, SalidaEntrega } from './esquema'
import type { Llamador, PedidoParaModelo } from './llamada'
import { llavePregunta, sinElAsistente, preguntasQueBloquean, tarifaSabida, viajerosCompletos, type Pregunta } from './preguntas'
import { mensajeDeConfirmacion, mensajeDelPdf, mensajeFrenado, PREGUNTA_TIPO } from './mensaje'

/**
 * EL FLUJO DE LA ENTREGA ÚNICA (brief del 2026-11-04, §El flujo, pasos 3 a 6).
 *
 *  `procesarPedido`: UNA llamada al modelo → si es bloqueo, ONE busca o crea al cliente, abre el viaje
 *  como Bloqueo, guarda la cotización en borrador y pasa el viaje a «Cotización»; todo queda «por
 *  confirmar» (estado de la ENTREGA, no del viaje ni de la cotización) y se guarda la hora de cada paso.
 *  Devuelve UN mensaje para la asesora con lo que entendió y solo las preguntas que bloquean.
 *
 *  `procesarRespuesta`: con lo que contestó, el modelo aplica los cambios, el código vuelve a decidir
 *  qué bloquea, corre el chequeo con los viajeros CONFIRMADOS y, si pasa, sale el PDF. Trappi le manda a
 *  la asesora el PDF y el enlace a la revisión en ONE. A la clienta no le escribe nunca.
 *
 * Sin red ni base propias: todo pasa por `PuertoEntrega` (memoria en las pruebas, Supabase en ONE) y
 * por `Llamador` (el modelo). Así se prueba punta a punta sin tocar los datos de Trappvel.
 */

export type EstadoEntrega =
  | 'recibiendo' | 'procesando' | 'tipo_por_confirmar' | 'por_confirmar' | 'aplicando'
  | 'listo' | 'frenado' | 'a_medida' | 'error' | 'descartada'

export interface Tiempos {
  primerMensaje?: string
  modelo?: string
  guardado?: string
  /** Hora en que el viaje entró a «Solicitud» (lo abrió ONE) y a «Cotización». */
  etapaSolicitud?: string
  etapaCotizacion?: string
  confirmacionEnviada?: string
  respuesta?: string
  pdf?: string
}

export interface Entrega {
  id: string
  workspaceId: string
  /** Quien entrega el pedido (la asesora que le escribe a Trappi). */
  staffId: string | null
  telefono: string
  estado: EstadoEntrega
  codigo: string | null
  negocioId: string | null
  cotizacionId: string | null
  contactoId: string | null
  salida: SalidaEntrega | null
  preguntas: Pregunta[]
  resueltas: string[]
  /** La asesora confirmó que es bloqueo (respondió a «¿bloqueo o a medida?»). */
  tipoConfirmado: boolean
  validacion: { hallazgos: Hallazgo[]; totales: Partial<Record<Version, number>> } | null
  pdfRef: string | null
  tiempos: Tiempos
  uso: (UsoModelo & { ms: number; modelo: string; fase: string })[]
  error: string | null
}

export interface Pieza {
  id: string
  entregaId: string
  direccion: 'entrante' | 'saliente'
  wamid: string | null
  contextoWamid: string | null
  tipo: 'texto' | 'imagen' | 'boton' | 'documento'
  texto: string | null
  mediaRef: string | null
  mime: string | null
  en: string
}

export type Salida =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'botones'; texto: string; botones: { id: string; titulo: string }[] }
  | { tipo: 'documento'; url: string; nombre: string; caption: string }

export interface ConfigEntrega {
  manual: string
  casa: Casa
}

export interface PuertoEntrega {
  ahora(): Date
  config(workspaceId: string): Promise<ConfigEntrega>
  leerEntrega(id: string): Promise<Entrega | null>
  /** Cambia el estado solo si sigue en `de` (dos webhooks no procesan lo mismo). */
  tomar(id: string, de: EstadoEntrega[], a: EstadoEntrega): Promise<boolean>
  guardarEntrega(id: string, cambios: Partial<Entrega>): Promise<void>
  piezas(entregaId: string): Promise<Pieza[]>
  leerPantallazo(ref: string): Promise<Pantallazo>
  buscarCliente(workspaceId: string, nombre: string): Promise<{ id: string } | null>
  /** Abre el viaje en «Solicitud» con modalidad Bloqueo y los requisitos. Devuelve quién lo lleva. */
  abrirViaje(e: Entrega, r: Requisitos, contactoId: string | null): Promise<{ negocioId: string; responsableStaffId: string | null; en: string }>
  actualizarViaje(negocioId: string, r: Requisitos): Promise<void>
  /** Pasa el viaje a «Cotización» y deja la línea del cambio (con su hora) en el historial. */
  moverACotizacion(negocioId: string, staffId: string | null): Promise<{ en: string }>
  siguienteConsecutivo(workspaceId: string): Promise<string>
  guardarCotizacion(e: Entrega, p: { negocioId: string; consecutivo: string; borrador: BorradorCotizacion | null; totales: Partial<Record<Version, number>>; tarifa: 'publica' | 'neta' | null }): Promise<string>
  renderPdf(e: Entrega, p: { borrador: BorradorCotizacion; validado: Validado; requisitos: Requisitos; pantallazos: Pantallazo[]; casa: Casa }): Promise<{ pdf: Uint8Array; nombre: string }>
  subirPdf(e: Entrega, nombre: string, pdf: Uint8Array): Promise<{ ref: string; url: string }>
  enlaceRevision(e: Entrega): Promise<string>
}

export interface Deps {
  puerto: PuertoEntrega
  modelo: Llamador
}

const hoyBogota = (d: Date) => new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10)

/** R-14: si la tarifa es neta, se suma 15 % sobre la venta (precio = costo / 0,85). Pública: el costo es el precio. */
export function totalesAlCliente(t: Partial<Record<Version, number>>, tarifa: 'publica' | 'neta' | null): Partial<Record<Version, number>> {
  if (tarifa !== 'neta') return { ...t }
  return Object.fromEntries(Object.entries(t).map(([v, x]) => [v, Math.round((x as number) / 0.85)])) as Partial<Record<Version, number>>
}

/** La regla del cambio de etapa: solo si quien entrega es quien va a cotizar (la responsable). */
export function pasaACotizacion(entregaStaffId: string | null, responsableStaffId: string | null): boolean {
  return !!entregaStaffId && entregaStaffId === responsableStaffId
}

async function pedidoDe(e: Entrega, deps: Deps, cfg: ConfigEntrega): Promise<{ pedido: PedidoParaModelo; pantallazos: Pantallazo[] }> {
  const piezas = (await deps.puerto.piezas(e.id)).filter(p => p.direccion === 'entrante').sort((a, b) => a.en.localeCompare(b.en))
  const mensajes = piezas.filter(p => p.tipo === 'texto' && p.texto?.trim()).map(p => p.texto!.trim())
  if (e.tipoConfirmado) mensajes.push('(La asesora confirmó en el chat que este pedido ES un bloqueo.)')
  const pantallazos: Pantallazo[] = []
  for (const p of piezas) {
    if (p.tipo === 'imagen' && p.mediaRef) pantallazos.push(await deps.puerto.leerPantallazo(p.mediaRef))
    if (p.tipo === 'imagen' && p.texto?.trim()) mensajes.push(p.texto.trim())
  }
  return { pedido: { hoy: hoyBogota(deps.puerto.ahora()), codigo: e.codigo ?? '(lo asigna ONE)', mensajes, pantallazos, manual: cfg.manual }, pantallazos }
}

/** Corrige lo que el modelo dejó distinto de lo que dicen las reglas fijas: la tarifa sabida. */
function conTarifa(b: BorradorCotizacion | null, tarifa: 'publica' | 'neta' | null): BorradorCotizacion | null {
  if (!b) return b
  const t: 'publica' | 'neta' | 'desconocida' = tarifa ?? 'desconocida'
  const hoteles = b.hoteles.map(h => ({ ...h, tipoTarifa: t }))
  const dudas = tarifa || b.dudas.some(d => /tarifa|p[uú]blica|neta/i.test(`${d.campo} ${d.pregunta}`))
    ? b.dudas
    : [...b.dudas, { campo: 'tarifa', pregunta: '¿La tarifa es pública o neta?', queSePusoMientras: 'pública', bloquea: true }]
  return { ...b, hoteles, dudas }
}

/** «sí», «Sí.», «ok», «listo», «dale», «correcto», «perfecto». */
export const SI_LIMPIO = /^\s*(s[ií]|ok|listo|dale|correcto|perfecto)\s*[.!👍]*\s*$/iu

const errores = (v: Validado | null) => (v?.hallazgos ?? []).filter(h => h.nivel === 'error')

export async function procesarPedido(entregaId: string, deps: Deps): Promise<Salida[]> {
  const { puerto } = deps
  if (!(await puerto.tomar(entregaId, ['recibiendo', 'tipo_por_confirmar'], 'procesando'))) return []
  const e = (await puerto.leerEntrega(entregaId))!
  try {
    const cfg = await puerto.config(e.workspaceId)
    const { pedido } = await pedidoDe(e, deps, cfg)
    const uso = [...e.uso]

    let r = await deps.modelo.armar(pedido)
    uso.push({ ...r.uso, ms: r.ms, modelo: r.modelo, fase: 'armar' })
    let salida = sinElAsistente(r.salida)
    if (e.tipoConfirmado) salida = { ...salida, requisitos: { ...salida.requisitos, tipoViaje: 'bloqueo' } }
    const tiempos: Tiempos = { ...e.tiempos, modelo: puerto.ahora().toISOString() }

    if (salida.requisitos.tipoViaje !== 'bloqueo') {
      await puerto.guardarEntrega(e.id, { estado: 'tipo_por_confirmar', salida, uso, tiempos })
      return [{ tipo: 'botones', texto: PREGUNTA_TIPO, botones: [{ id: `eb|tipo|bloqueo|${e.id}`, titulo: 'Bloqueo' }, { id: `eb|tipo|a_medida|${e.id}`, titulo: 'A medida' }] }]
    }

    // Si el chequeo frena el primer borrador, el modelo lo arma otra vez antes de molestarla (nota de Noor,
    // 2026-11-04). Una sola vez: se queda el que tenga menos errores.
    const chequeo = (s: SalidaEntrega) => s.borrador && viajerosCompletos(s.requisitos)
      ? validarBorrador(conTarifa(s.borrador, tarifaSabida(s.requisitos) ?? 'publica')!, s.requisitos.viajeros!)
      : null
    let validado = chequeo(salida)
    if (errores(validado).length > 0) {
      r = await deps.modelo.armar(pedido)
      uso.push({ ...r.uso, ms: r.ms, modelo: r.modelo, fase: 'rearmar' })
      const otra0 = sinElAsistente(r.salida)
      const otra = e.tipoConfirmado ? { ...otra0, requisitos: { ...otra0.requisitos, tipoViaje: 'bloqueo' as const } } : otra0
      const v2 = chequeo(otra)
      if (otra.requisitos.tipoViaje === 'bloqueo' && errores(v2).length < errores(validado).length) {
        salida = otra
        validado = v2
      }
    }
    const tarifa = tarifaSabida(salida.requisitos)
    salida = { ...salida, borrador: viajerosCompletos(salida.requisitos) ? conTarifa(salida.borrador, tarifa) : null }

    // ONE guarda: cliente, viaje en Bloqueo, cotización en borrador y el viaje en «Cotización».
    const cliente = salida.requisitos.cliente ? await puerto.buscarCliente(e.workspaceId, salida.requisitos.cliente) : null
    const viaje = e.negocioId
      ? { negocioId: e.negocioId, responsableStaffId: e.staffId, en: tiempos.etapaSolicitud ?? puerto.ahora().toISOString() }
      : await puerto.abrirViaje(e, salida.requisitos, cliente?.id ?? null)
    if (e.negocioId) await puerto.actualizarViaje(e.negocioId, salida.requisitos)
    tiempos.etapaSolicitud = viaje.en
    const codigo = e.codigo ?? (await puerto.siguienteConsecutivo(e.workspaceId))
    const conCodigo = { ...e, codigo, negocioId: viaje.negocioId }
    const cotizacionId = await puerto.guardarCotizacion({ ...conCodigo, cotizacionId: e.cotizacionId }, {
      negocioId: viaje.negocioId, consecutivo: codigo, borrador: salida.borrador,
      totales: totalesAlCliente(validado?.totales ?? {}, tarifa), tarifa,
    })
    tiempos.guardado = puerto.ahora().toISOString()
    if (!tiempos.etapaCotizacion && pasaACotizacion(e.staffId, viaje.responsableStaffId)) {
      tiempos.etapaCotizacion = (await puerto.moverACotizacion(viaje.negocioId, e.staffId)).en
    }

    const preguntas = preguntasQueBloquean({ requisitos: salida.requisitos, borrador: salida.borrador, redaccion: salida.redaccion, hoy: pedido.hoy, resueltas: new Set(e.resueltas) })
    const texto = mensajeDeConfirmacion({ codigo, requisitos: salida.requisitos, borrador: salida.borrador, preguntas, faltaCelularCliente: !cliente })
    tiempos.confirmacionEnviada = puerto.ahora().toISOString()
    await puerto.guardarEntrega(e.id, {
      estado: 'por_confirmar', codigo, negocioId: viaje.negocioId, cotizacionId, contactoId: cliente?.id ?? null,
      salida, preguntas, uso, tiempos,
      validacion: validado ? { hallazgos: validado.hallazgos, totales: validado.totales } : null,
    })
    return [{ tipo: 'texto', texto }]
  } catch (err) {
    await puerto.guardarEntrega(e.id, { estado: 'error', error: String(err).slice(0, 500) })
    return [{ tipo: 'texto', texto: `No pude procesar el pedido${e.codigo ? ` ${e.codigo}` : ''}: algo falló de mi lado. Ya quedó anotado; vuelve a mandármelo en unos minutos o ábrelo en ONE.` }]
  }
}

/** Lo que contestó a «¿bloqueo o a medida?». */
export async function responderTipo(entregaId: string, tipo: 'bloqueo' | 'a_medida', deps: Deps): Promise<Salida[]> {
  const e = await deps.puerto.leerEntrega(entregaId)
  if (!e || e.estado !== 'tipo_por_confirmar') return []
  if (tipo === 'a_medida') {
    await deps.puerto.guardarEntrega(e.id, { estado: 'a_medida' })
    return [{ tipo: 'texto', texto: 'Listo, no es bloqueo. Los viajes a medida van por el registro de siempre: mándame el pedido sin decir «bloqueo» y lo registro.' }]
  }
  await deps.puerto.guardarEntrega(e.id, { tipoConfirmado: true })
  return procesarPedido(entregaId, deps)
}

export async function procesarRespuesta(entregaId: string, respuesta: string, deps: Deps): Promise<Salida[]> {
  const { puerto } = deps
  if (!(await puerto.tomar(entregaId, ['por_confirmar', 'frenado'], 'aplicando'))) return []
  const e = (await puerto.leerEntrega(entregaId))!
  const codigo = e.codigo ?? ''
  try {
    const cfg = await puerto.config(e.workspaceId)
    const { pedido, pantallazos } = await pedidoDe(e, deps, cfg)
    const tiempos: Tiempos = { ...e.tiempos, respuesta: puerto.ahora().toISOString() }
    const r = await deps.modelo.aplicar(pedido, e.salida!, e.preguntas, respuesta)
    const uso = [...e.uso, { ...r.uso, ms: r.ms, modelo: r.modelo, fase: 'aplicar' }]
    const s = sinElAsistente(r.salida)
    // Las que contestó, por número de la pregunta que se le hizo.
    const resueltas = new Set(e.resueltas)
    for (const x of s.respuestas) {
      const q = e.preguntas.find(p => p.numero === x.numero) ?? e.preguntas.find(p => p.clave === x.clave && p.pantallazo === x.pantallazo)
      if (q && x.resuelta) resueltas.add(llavePregunta(q.clave, q.pantallazo))
    }
    // La tarifa contestada vale como dicha (y la redacción de la pregunta deja de importar).
    const resp = s.respuestas.find(x => x.clave === 'tarifa' && x.resuelta)
    const requisitos: Requisitos = {
      ...s.requisitos, tipoViaje: 'bloqueo',
      tarifaDicha: s.requisitos.tarifaDicha ?? (resp ? (/neta/i.test(resp.valor) ? 'neta' : 'publica') : null),
    }
    if (!viajerosCompletos(requisitos)) resueltas.delete(llavePregunta('viajeros', null))
    const tarifa = tarifaSabida(requisitos) ?? (resueltas.has(llavePregunta('tarifa', null)) ? 'publica' : null)
    const borrador = viajerosCompletos(requisitos) ? conTarifa(s.borrador, tarifa) : null
    const salida: SalidaEntrega = { requisitos, redaccion: s.redaccion, borrador }
    if (e.negocioId) await puerto.actualizarViaje(e.negocioId, requisitos)

    const preguntas = preguntasQueBloquean({ requisitos, borrador, redaccion: s.redaccion, hoy: pedido.hoy, resueltas })
    // Un «sí» limpio a un mensaje sin preguntas no tiene nada que no se entienda: qué bloquea lo decide el código
    // (el modelo convirtió en «noEntendido» dudas que el código ya había descartado, QA del 2026-11-04).
    const noEntendido = SI_LIMPIO.test(respuesta) && e.preguntas.length === 0 ? null : s.noEntendido
    if (noEntendido || preguntas.length > 0 || !borrador) {
      const texto = [
        noEntendido ? `${codigo} · ${noEntendido}` : null,
        preguntas.length || !borrador ? mensajeDeConfirmacion({ codigo, requisitos, borrador, preguntas, faltaCelularCliente: false }) : null,
      ].filter(Boolean).join('\n\n')
      await puerto.guardarEntrega(e.id, { estado: 'por_confirmar', salida, preguntas, resueltas: [...resueltas], uso, tiempos })
      return [{ tipo: 'texto', texto }]
    }

    // El chequeo del código, otra vez, con los viajeros CONFIRMADOS.
    const validado = validarBorrador(borrador, requisitos.viajeros!)
    const totales = totalesAlCliente(validado.totales, tarifa)
    await puerto.guardarCotizacion(e, { negocioId: e.negocioId!, consecutivo: codigo, borrador, totales, tarifa })
    const enlace = await puerto.enlaceRevision(e)
    const fallas = errores(validado)
    if (fallas.length > 0) {
      await puerto.guardarEntrega(e.id, { estado: 'frenado', salida, preguntas: [], resueltas: [...resueltas], uso, tiempos, validacion: { hallazgos: validado.hallazgos, totales } })
      return [{ tipo: 'texto', texto: mensajeFrenado({ codigo, motivos: fallas.map(f => `${f.campo.replace(/^hotel /, '')}: ${f.mensaje}`), enlace }) }]
    }
    const paraPdf: Validado = { ...validado, totales }
    const { pdf, nombre } = await puerto.renderPdf({ ...e, salida }, { borrador, validado: paraPdf, requisitos, pantallazos, casa: cfg.casa })
    const subido = await puerto.subirPdf(e, nombre, pdf)
    tiempos.pdf = puerto.ahora().toISOString()
    await puerto.guardarEntrega(e.id, {
      estado: 'listo', salida, preguntas: [], resueltas: [...resueltas], uso, tiempos, pdfRef: subido.ref,
      validacion: { hallazgos: validado.hallazgos, totales },
    })
    return [{ tipo: 'documento', url: subido.url, nombre, caption: mensajeDelPdf({ codigo, cliente: borrador.clienteParaDocumento || requisitos.cliente, destino: requisitos.destino, enlace }) }]
  } catch (err) {
    await puerto.guardarEntrega(e.id, { estado: 'por_confirmar', error: String(err).slice(0, 500) })
    return [{ tipo: 'texto', texto: `${codigo} · No pude aplicar tu respuesta: algo falló de mi lado. Vuelve a mandármela citando el mensaje.` }]
  }
}
