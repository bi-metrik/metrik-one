/**
 * Núcleo de escritura del módulo Ferretería. Es la ÚNICA vía por la que cambia una
 * publicación: la usan las server actions de la pantalla y el endpoint del agente y del cron.
 * Por eso el piso del precio y la bitácora no dependen de quién escribe.
 *
 * Recibe el repositorio por parámetro (Supabase en producción, memoria en las pruebas).
 */
import {
  costoVigente,
  esEstado,
  esLinea,
  validarPiso,
  type CanalConversacion,
  type ResultadoConversacion,
} from './reglas'
import type {
  Autor,
  CambiosPublicacion,
  ConversacionFila,
  EventoFila,
  EventoNuevo,
  ItemFicha,
  MedicionFila,
  ProductoFila,
  PublicacionCatalogo,
  PublicacionFila,
  RepoFerreteria,
  TipoEvento,
} from './tipos'

/** Quién origina el cambio. Define si el cambio queda pendiente de aplicar en el canal. */
export type OrigenCambio =
  /** Hecho en ONE: el cron tiene que aplicarlo en Marketplace. */
  | 'one'
  /** Hecho por el agente directamente en Marketplace: ONE solo lo registra. */
  | 'canal'

const CAMPOS_CANAL = ['precio', 'estado', 'titulo', 'descripcion', 'etiquetas'] as const
const CAMPOS_TEXTO = ['titulo', 'descripcion', 'etiquetas'] as const
const CAMPOS_DATO = ['linea', 'link', 'id_aviso', 'perfil', 'fecha_publicacion'] as const

type Campo = keyof CambiosPublicacion

function textoONulo(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function limpiarEtiquetas(v: string[]): string[] {
  return v.map((e) => e.trim()).filter((e) => e.length > 0)
}

/** Forma canónica de un valor para comparar y para escribir en la bitácora. */
function comoTexto(campo: Campo, v: unknown): string | null {
  if (v == null) return null
  if (campo === 'etiquetas') return (v as string[]).join(', ')
  if (campo === 'precio') return String(Number(v))
  return String(v)
}

function normalizar(campo: Campo, v: unknown): unknown {
  switch (campo) {
    case 'precio':
      return v == null ? null : Number(v)
    case 'titulo':
      return typeof v === 'string' ? v.trim() : ''
    case 'etiquetas':
      return limpiarEtiquetas((v as string[] | null) ?? [])
    case 'estado':
      return v
    default:
      return textoONulo(v as string | null)
  }
}

function tipoDeEvento(campo: Campo): TipoEvento {
  if (campo === 'precio') return 'cambio_precio'
  if (campo === 'estado') return 'cambio_estado'
  if ((CAMPOS_TEXTO as readonly string[]).includes(campo)) return 'cambio_texto'
  return 'cambio_dato'
}

export type PlanCambio =
  | { tipo: 'error'; codigo: string; mensaje: string }
  | { tipo: 'sin_cambios' }
  | {
      tipo: 'cambios'
      patch: Partial<PublicacionFila>
      eventos: Omit<EventoNuevo, 'workspace_id' | 'publicacion_id' | 'autor_tipo' | 'autor_id' | 'autor_nombre'>[]
      quedaPendiente: boolean
      ganancia: number | null
    }

/**
 * Qué cambia y qué se escribe, sin tocar la base. Puro: es lo que prueban
 * `nucleo.test.ts` y lo que decide el aviso de la pantalla.
 */
export function planearCambio(
  actual: PublicacionFila,
  propuesto: CambiosPublicacion,
  costoF: number | null,
  opciones: { origen: OrigenCambio; motivo?: string | null; ahora: string },
): PlanCambio {
  if (propuesto.estado !== undefined && !esEstado(propuesto.estado)) {
    return { tipo: 'error', codigo: 'estado_invalido', mensaje: `Estado desconocido: ${String(propuesto.estado)}.` }
  }
  if (propuesto.linea !== undefined && propuesto.linea !== null && !esLinea(propuesto.linea)) {
    return { tipo: 'error', codigo: 'linea_invalida', mensaje: `Línea desconocida: ${String(propuesto.linea)}.` }
  }

  const motivo = textoONulo(opciones.motivo)
  const patch: Partial<PublicacionFila> = {}
  const eventos: Extract<PlanCambio, { tipo: 'cambios' }>['eventos'] = []
  let tocaCanal = false
  let ganancia: number | null = null

  const campos = [...CAMPOS_CANAL, ...CAMPOS_DATO] as Campo[]
  for (const campo of campos) {
    if (propuesto[campo] === undefined) continue
    const nuevo = normalizar(campo, propuesto[campo])
    const viejo = normalizar(campo, actual[campo as keyof PublicacionFila])
    const tNuevo = comoTexto(campo, nuevo)
    const tViejo = comoTexto(campo, viejo)
    if (tNuevo === tViejo) continue

    if (campo === 'precio') {
      if (nuevo == null) {
        return { tipo: 'error', codigo: 'precio_invalido', mensaje: 'Una publicación con precio no puede quedar sin precio.' }
      }
      const veredicto = validarPiso(nuevo as number, costoF, motivo)
      if (!veredicto.ok) return { tipo: 'error', codigo: veredicto.codigo, mensaje: veredicto.mensaje }
      ganancia = veredicto.ganancia
    }

    ;(patch as Record<string, unknown>)[campo] = nuevo
    eventos.push({
      tipo: tipoDeEvento(campo),
      campo: tipoDeEvento(campo) === 'cambio_texto' || tipoDeEvento(campo) === 'cambio_dato' ? campo : null,
      valor_anterior: tViejo,
      valor_nuevo: tNuevo,
      motivo,
    })
    if ((CAMPOS_CANAL as readonly string[]).includes(campo)) tocaCanal = true
  }

  if (eventos.length === 0) return { tipo: 'sin_cambios' }

  const quedaPendiente = tocaCanal && opciones.origen === 'one'
  if (quedaPendiente) {
    patch.pendiente_en_canal = true
    patch.pendiente_desde = actual.pendiente_desde ?? opciones.ahora
    patch.version_canal = actual.version_canal + 1
    patch.intentos_fallidos = 0
    patch.ultimo_error_canal = null
  }
  patch.updated_at = opciones.ahora
  return { tipo: 'cambios', patch, eventos, quedaPendiente, ganancia }
}

export function conAutor(
  ws: string,
  pubId: string,
  autor: Autor,
  e: Omit<EventoNuevo, 'workspace_id' | 'publicacion_id' | 'autor_tipo' | 'autor_id' | 'autor_nombre'>,
): EventoNuevo {
  return { ...e, workspace_id: ws, publicacion_id: pubId, autor_tipo: autor.tipo, autor_id: autor.id, autor_nombre: autor.nombre }
}

async function costoFVigente(repo: RepoFerreteria, ws: string, productoId: string): Promise<number | null> {
  const vigente = costoVigente((await repo.costos(ws, productoId)).map((c) => ({ ...c, costo_f: Number(c.costo_f) })))
  return vigente ? vigente.costo_f : null
}

export type ResultadoEscritura =
  | { ok: true; estado: 'actualizada' | 'creada' | 'sin_cambios'; publicacion_id: string; pendiente_en_canal: boolean; ganancia: number | null }
  | { ok: false; codigo: string; mensaje: string }

/** Cambia una publicación existente: valida, actualiza con control de versión y escribe la bitácora. */
export async function cambiarPublicacion(
  repo: RepoFerreteria,
  ws: string,
  actual: PublicacionFila,
  propuesto: CambiosPublicacion,
  opciones: { origen: OrigenCambio; motivo?: string | null; autor: Autor; ahora: string },
): Promise<ResultadoEscritura> {
  const tocaPrecio = propuesto.precio !== undefined
  const costoF = tocaPrecio ? await costoFVigente(repo, ws, actual.producto_id) : null
  const plan = planearCambio(actual, propuesto, costoF, opciones)
  if (plan.tipo === 'error') return { ok: false, codigo: plan.codigo, mensaje: plan.mensaje }
  if (plan.tipo === 'sin_cambios') {
    return { ok: true, estado: 'sin_cambios', publicacion_id: actual.id, pendiente_en_canal: actual.pendiente_en_canal, ganancia: null }
  }
  const escrito = await repo.actualizarPublicacion(ws, actual.id, actual.version_canal, plan.patch)
  if (!escrito) {
    return { ok: false, codigo: 'conflicto', mensaje: 'La publicación cambió mientras se guardaba. Recarga y vuelve a intentar.' }
  }
  await repo.insertarEventos(plan.eventos.map((e) => conAutor(ws, actual.id, opciones.autor, e)))
  return {
    ok: true,
    estado: 'actualizada',
    publicacion_id: actual.id,
    pendiente_en_canal: plan.quedaPendiente || actual.pendiente_en_canal,
    ganancia: plan.ganancia,
  }
}

export interface PublicacionEntrada extends CambiosPublicacion {
  codigo: string
  sku?: string
  canal?: 'marketplace' | 'tienda' | 'whatsapp'
  motivo?: string | null
}

/**
 * Crea o actualiza una publicación por su código (upsert del agente). Lo que el agente escribe
 * ya está en el canal, así que NO queda pendiente (origen `canal`).
 */
export async function guardarPublicacion(
  repo: RepoFerreteria,
  ws: string,
  entrada: PublicacionEntrada,
  opciones: { origen: OrigenCambio; autor: Autor; ahora: string },
): Promise<ResultadoEscritura> {
  const existente = await repo.publicacionPorCodigo(ws, entrada.codigo)
  const { codigo, sku, canal, motivo, ...cambios } = entrada

  if (existente) {
    if (sku !== undefined) {
      const producto = await repo.productoPorSku(ws, sku)
      if (!producto || producto.id !== existente.producto_id) {
        return { ok: false, codigo: 'sku_distinto', mensaje: `La publicación ${codigo} es de otro producto; el SKU no se cambia.` }
      }
    }
    return cambiarPublicacion(repo, ws, existente, cambios, { ...opciones, motivo })
  }

  if (!sku) return { ok: false, codigo: 'falta_sku', mensaje: `La publicación ${codigo} no existe: para crearla hace falta el SKU.` }
  const producto = await repo.productoPorSku(ws, sku)
  if (!producto) return { ok: false, codigo: 'producto_no_existe', mensaje: `No existe el producto con SKU ${sku}.` }
  if (cambios.estado !== undefined && !esEstado(cambios.estado)) {
    return { ok: false, codigo: 'estado_invalido', mensaje: `Estado desconocido: ${String(cambios.estado)}.` }
  }
  if (cambios.linea != null && !esLinea(cambios.linea)) {
    return { ok: false, codigo: 'linea_invalida', mensaje: `Línea desconocida: ${String(cambios.linea)}.` }
  }

  let ganancia: number | null = null
  const precio = cambios.precio == null ? null : Number(cambios.precio)
  if (precio != null) {
    const veredicto = validarPiso(precio, await costoFVigente(repo, ws, producto.id), motivo)
    if (!veredicto.ok) return { ok: false, codigo: veredicto.codigo, mensaje: veredicto.mensaje }
    ganancia = veredicto.ganancia
  }

  const creada = await repo.insertarPublicacion({
    workspace_id: ws,
    codigo,
    producto_id: producto.id,
    canal: canal ?? 'marketplace',
    titulo: (cambios.titulo ?? '').trim(),
    descripcion: textoONulo(cambios.descripcion),
    etiquetas: limpiarEtiquetas(cambios.etiquetas ?? []),
    precio,
    linea: cambios.linea ?? null,
    link: textoONulo(cambios.link),
    id_aviso: textoONulo(cambios.id_aviso),
    perfil: textoONulo(cambios.perfil),
    fecha_publicacion: cambios.fecha_publicacion ?? null,
    estado: cambios.estado ?? 'borrador',
    pendiente_en_canal: false,
    pendiente_desde: null,
    version_canal: 0,
    intentos_fallidos: 0,
    ultimo_error_canal: null,
    created_at: opciones.ahora,
    updated_at: opciones.ahora,
  })
  await repo.insertarEventos([
    conAutor(ws, creada.id, opciones.autor, {
      tipo: 'creada',
      campo: null,
      valor_anterior: null,
      valor_nuevo: [creada.titulo, precio != null ? `precio ${precio}` : null, `estado ${creada.estado}`]
        .filter(Boolean)
        .join(' · '),
      motivo: textoONulo(motivo),
    }),
  ])
  return { ok: true, estado: 'creada', publicacion_id: creada.id, pendiente_en_canal: false, ganancia }
}

// ── Pendientes y confirmaciones del cron ──────────────────────────────────────

export interface PendienteCanal {
  codigo: string
  publicacion_id: string
  version: number
  link: string | null
  id_aviso: string | null
  pendiente_desde: string
  intentos_fallidos: number
  ultimo_error: string | null
  deseado: {
    precio: number | null
    estado: string
    titulo: string
    descripcion: string | null
    etiquetas: string[]
  }
  cambios: { tipo: string; campo: string | null; valor_anterior: string | null; valor_nuevo: string | null; motivo: string | null; fecha: string }[]
}

export async function listarPendientes(repo: RepoFerreteria, ws: string): Promise<PendienteCanal[]> {
  const pubs = await repo.publicacionesPendientes(ws)
  const salida: PendienteCanal[] = []
  for (const p of pubs.sort((a, b) => a.codigo.localeCompare(b.codigo))) {
    const desde = p.pendiente_desde ?? p.updated_at ?? new Date(0).toISOString()
    const eventos: EventoFila[] = await repo.eventosDesde(ws, p.id, desde)
    salida.push({
      codigo: p.codigo,
      publicacion_id: p.id,
      version: p.version_canal,
      link: p.link,
      id_aviso: p.id_aviso,
      pendiente_desde: desde,
      intentos_fallidos: p.intentos_fallidos,
      ultimo_error: p.ultimo_error_canal,
      deseado: {
        precio: p.precio == null ? null : Number(p.precio),
        estado: p.estado,
        titulo: p.titulo,
        descripcion: p.descripcion,
        etiquetas: p.etiquetas ?? [],
      },
      cambios: eventos
        .filter((e) => e.tipo === 'cambio_precio' || e.tipo === 'cambio_estado' || e.tipo === 'cambio_texto')
        .map((e) => ({
          tipo: e.tipo,
          campo: e.campo,
          valor_anterior: e.valor_anterior,
          valor_nuevo: e.valor_nuevo,
          motivo: e.motivo,
          fecha: e.created_at,
        })),
    })
  }
  return salida
}

/** Catálogo completo del workspace, ordenado por código: lo que el cron tiene que medir. */
export async function listarPublicaciones(repo: RepoFerreteria, ws: string): Promise<PublicacionCatalogo[]> {
  const pubs = await repo.catalogoPublicaciones(ws)
  // Campo a campo, en el orden del contrato: que ninguna columna extra del repo se cuele.
  return pubs
    .map((p) => ({
      codigo: p.codigo,
      sku: p.sku,
      canal: p.canal,
      titulo: p.titulo,
      precio: p.precio == null ? null : Number(p.precio),
      estado: p.estado,
      linea: p.linea,
      link: p.link,
      id_aviso: p.id_aviso,
      fecha_publicacion: p.fecha_publicacion,
      pendiente_en_canal: p.pendiente_en_canal,
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
}

export interface ConfirmacionEntrada {
  codigo: string
  version: number
  resultado: 'aplicado' | 'error'
  visto?: { precio?: number | null; estado?: string | null; link?: string | null; id_aviso?: string | null }
  error?: string | null
}

export type EstadoConfirmacion = 'aplicado' | 'error_registrado' | 'no_coincide' | 'obsoleto' | 'sin_pendiente' | 'no_encontrada'

/**
 * Registra lo que el cron hizo con un cambio pendiente. El servidor compara lo que el cron VIO
 * al releer el aviso contra lo que ONE quiere: si no coincide, el cambio sigue pendiente con el
 * error, aunque el cron diga «aplicado».
 */
export async function confirmarCambio(
  repo: RepoFerreteria,
  ws: string,
  conf: ConfirmacionEntrada,
  opciones: { autor: Autor; ahora: string },
): Promise<{ codigo: string; estado: EstadoConfirmacion; mensaje?: string }> {
  const pub = await repo.publicacionPorCodigo(ws, conf.codigo)
  if (!pub) return { codigo: conf.codigo, estado: 'no_encontrada' }
  if (!pub.pendiente_en_canal) return { codigo: conf.codigo, estado: 'sin_pendiente' }
  if (conf.version !== pub.version_canal) {
    return {
      codigo: conf.codigo,
      estado: 'obsoleto',
      mensaje: 'Hubo otro cambio en ONE después de pedir los pendientes; queda para la próxima corrida.',
    }
  }

  let error = conf.resultado === 'error' ? textoONulo(conf.error) ?? 'Error sin detalle' : null
  if (!error && conf.visto) {
    const difs: string[] = []
    if (conf.visto.precio !== undefined && conf.visto.precio !== null && pub.precio != null && Number(conf.visto.precio) !== Number(pub.precio)) {
      difs.push(`precio visto ${conf.visto.precio}, esperado ${Number(pub.precio)}`)
    }
    if (conf.visto.estado !== undefined && conf.visto.estado !== null && conf.visto.estado !== pub.estado) {
      difs.push(`estado visto ${conf.visto.estado}, esperado ${pub.estado}`)
    }
    if (difs.length > 0) error = `Lo visto en el canal no coincide: ${difs.join('; ')}.`
  }

  const eventos: EventoNuevo[] = []
  const patch: Partial<PublicacionFila> = { updated_at: opciones.ahora }
  if (error) {
    patch.intentos_fallidos = pub.intentos_fallidos + 1
    patch.ultimo_error_canal = error
    eventos.push(
      conAutor(ws, pub.id, opciones.autor, { tipo: 'error_en_canal', campo: null, valor_anterior: null, valor_nuevo: null, motivo: error }),
    )
  } else {
    patch.pendiente_en_canal = false
    patch.pendiente_desde = null
    patch.intentos_fallidos = 0
    patch.ultimo_error_canal = null
    eventos.push(
      conAutor(ws, pub.id, opciones.autor, {
        tipo: 'aplicado_en_canal',
        campo: null,
        valor_anterior: null,
        valor_nuevo: [pub.precio != null ? `precio ${Number(pub.precio)}` : null, `estado ${pub.estado}`].filter(Boolean).join(' · '),
        motivo: null,
      }),
    )
  }
  // Link e id del aviso: el cron los captura releyendo, se anotan si cambiaron.
  for (const campo of ['link', 'id_aviso'] as const) {
    const visto = textoONulo(conf.visto?.[campo] ?? null)
    if (visto && visto !== pub[campo]) {
      patch[campo] = visto
      eventos.push(conAutor(ws, pub.id, opciones.autor, { tipo: 'cambio_dato', campo, valor_anterior: pub[campo], valor_nuevo: visto, motivo: null }))
    }
  }

  const escrito = await repo.actualizarPublicacion(ws, pub.id, pub.version_canal, patch)
  if (!escrito) return { codigo: conf.codigo, estado: 'obsoleto', mensaje: 'La publicación cambió mientras se confirmaba.' }
  await repo.insertarEventos(eventos)
  if (error) return { codigo: conf.codigo, estado: conf.resultado === 'error' ? 'error_registrado' : 'no_coincide', mensaje: error }
  return { codigo: conf.codigo, estado: 'aplicado' }
}

// ── Lote diario: mediciones y conversaciones ──────────────────────────────────

export interface MedicionEntrada {
  codigo: string
  clics: number
  guardados?: number | null
  estado_visto?: string | null
  link?: string | null
  id_aviso?: string | null
}

export interface ConversacionEntrada {
  codigo: string
  fecha?: string
  interesado: string
  canal: CanalConversacion
  resultado?: ResultadoConversacion
  motivo_perdida?: string | null
  id_externo?: string | null
}

export interface ResultadoLote {
  mediciones: number
  conversaciones: number
  links_capturados: number
  rechazadas: { tipo: 'medicion' | 'conversacion'; codigo: string; motivo: string }[]
}

export function claveConversacion(pubId: string, c: { fecha: string; interesado: string; canal: string; id_externo?: string | null }): string {
  const externo = textoONulo(c.id_externo ?? null)
  if (externo) return `ext:${externo}`
  return `${pubId}|${c.fecha}|${c.interesado.trim().toLowerCase()}|${c.canal}`
}

export async function registrarLote(
  repo: RepoFerreteria,
  ws: string,
  lote: { fecha: string; mediciones: MedicionEntrada[]; conversaciones: ConversacionEntrada[] },
  opciones: { autor: Autor; ahora: string },
): Promise<ResultadoLote> {
  const codigos = [...new Set([...lote.mediciones.map((m) => m.codigo), ...lote.conversaciones.map((c) => c.codigo)])]
  const pubs = new Map((await repo.publicacionesPorCodigos(ws, codigos)).map((p) => [p.codigo, p]))
  const rechazadas: ResultadoLote['rechazadas'] = []

  const mediciones: MedicionFila[] = []
  let links = 0
  for (const m of lote.mediciones) {
    const pub = pubs.get(m.codigo)
    if (!pub) {
      rechazadas.push({ tipo: 'medicion', codigo: m.codigo, motivo: 'La publicación no existe en ONE.' })
      continue
    }
    mediciones.push({
      workspace_id: ws,
      publicacion_id: pub.id,
      fecha: lote.fecha,
      clics_acumulados: m.clics,
      guardados: m.guardados ?? null,
      estado_visto: textoONulo(m.estado_visto ?? null),
    })
    // Primera corrida: el cron captura el link y el id del aviso.
    const patch: Partial<PublicacionFila> = {}
    const eventos: EventoNuevo[] = []
    for (const campo of ['link', 'id_aviso'] as const) {
      const visto = textoONulo(m[campo] ?? null)
      if (visto && visto !== pub[campo]) {
        patch[campo] = visto
        eventos.push(conAutor(ws, pub.id, opciones.autor, { tipo: 'cambio_dato', campo, valor_anterior: pub[campo], valor_nuevo: visto, motivo: null }))
      }
    }
    if (eventos.length > 0) {
      patch.updated_at = opciones.ahora
      if (await repo.actualizarPublicacion(ws, pub.id, pub.version_canal, patch)) {
        await repo.insertarEventos(eventos)
        links += 1
      }
    }
  }

  const conversaciones: ConversacionFila[] = []
  for (const c of lote.conversaciones) {
    const pub = pubs.get(c.codigo)
    if (!pub) {
      rechazadas.push({ tipo: 'conversacion', codigo: c.codigo, motivo: 'La publicación no existe en ONE.' })
      continue
    }
    const fecha = c.fecha ?? lote.fecha
    conversaciones.push({
      workspace_id: ws,
      publicacion_id: pub.id,
      fecha,
      interesado: c.interesado.trim(),
      canal: c.canal,
      resultado: c.resultado ?? 'pregunto',
      motivo_perdida: textoONulo(c.motivo_perdida ?? null),
      clave: claveConversacion(pub.id, { fecha, interesado: c.interesado, canal: c.canal, id_externo: c.id_externo }),
    })
  }

  // Un mismo upsert no puede tocar dos veces la misma fila (Postgres lo rechaza): si el lote
  // repite una publicación o una conversación, gana la última.
  const medicionesUnicas = [...new Map(mediciones.map((m) => [m.publicacion_id, m])).values()]
  const conversacionesUnicas = [...new Map(conversaciones.map((c) => [c.clave, c])).values()]
  if (medicionesUnicas.length > 0) await repo.guardarMediciones(medicionesUnicas)
  if (conversacionesUnicas.length > 0) await repo.guardarConversaciones(conversacionesUnicas)
  return {
    mediciones: medicionesUnicas.length,
    conversaciones: conversacionesUnicas.length,
    links_capturados: links,
    rechazadas,
  }
}

// ── Productos, notas y ventas ─────────────────────────────────────────────────

export interface ProductoEntrada {
  sku: string
  nombre?: string
  marca?: string | null
  categoria?: string | null
  proveedor?: string | null
  pagina_catalogo?: string | null
  fotos?: string[]
  ficha?: ItemFicha[]
  observaciones?: string | null
  costo?: { fecha_lista: string; costo_f: number; costo_d?: number | null }
}

export async function guardarProducto(
  repo: RepoFerreteria,
  ws: string,
  entrada: ProductoEntrada,
  ahora: string,
): Promise<{ ok: true; estado: 'creado' | 'actualizado'; producto_id: string } | { ok: false; codigo: string; mensaje: string }> {
  const sku = entrada.sku.trim()
  if (!sku) return { ok: false, codigo: 'falta_sku', mensaje: 'Falta el SKU.' }
  const existente = await repo.productoPorSku(ws, sku)
  if (!existente && !textoONulo(entrada.nombre ?? null)) {
    return { ok: false, codigo: 'falta_nombre', mensaje: `El producto ${sku} no existe: para crearlo hace falta el nombre.` }
  }
  const base: Omit<ProductoFila, 'id'> & { id?: string } = existente ?? {
    workspace_id: ws,
    sku,
    nombre: '',
    marca: null,
    categoria: null,
    proveedor: null,
    pagina_catalogo: null,
    fotos: [],
    ficha: [],
    observaciones: null,
    created_at: ahora,
  }
  const fila: Omit<ProductoFila, 'id'> & { id?: string } = {
    ...base,
    nombre: textoONulo(entrada.nombre ?? null) ?? base.nombre,
    marca: entrada.marca !== undefined ? textoONulo(entrada.marca) : base.marca,
    categoria: entrada.categoria !== undefined ? textoONulo(entrada.categoria) : base.categoria,
    proveedor: entrada.proveedor !== undefined ? textoONulo(entrada.proveedor) : base.proveedor,
    pagina_catalogo: entrada.pagina_catalogo !== undefined ? textoONulo(entrada.pagina_catalogo) : base.pagina_catalogo,
    fotos: entrada.fotos ?? base.fotos,
    ficha: entrada.ficha ?? base.ficha,
    observaciones: entrada.observaciones !== undefined ? textoONulo(entrada.observaciones) : base.observaciones,
    updated_at: ahora,
  }
  const guardado = await repo.guardarProducto(fila)
  if (entrada.costo) {
    await repo.guardarCosto({
      workspace_id: ws,
      producto_id: guardado.id,
      fecha_lista: entrada.costo.fecha_lista,
      costo_f: entrada.costo.costo_f,
      costo_d: entrada.costo.costo_d ?? null,
    })
  }
  return { ok: true, estado: existente ? 'actualizado' : 'creado', producto_id: guardado.id }
}

export async function agregarNota(
  repo: RepoFerreteria,
  ws: string,
  pub: PublicacionFila,
  texto: string,
  autor: Autor,
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const t = textoONulo(texto)
  if (!t) return { ok: false, mensaje: 'La nota está vacía.' }
  await repo.insertarEventos([conAutor(ws, pub.id, autor, { tipo: 'nota', campo: null, valor_anterior: null, valor_nuevo: t, motivo: null })])
  return { ok: true }
}

// Registrar una venta, entregarla y cobrarla vive en `ventas.ts`: desde que cada venta es un
// negocio de ONE, esas escrituras también mueven el negocio.
