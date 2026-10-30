/**
 * Servicios del viaje contra la base (F0): crear las filas desde la cotización aceptada, leer las
 * del negocio y soltar las de una aceptación que se corrige.
 *
 * No es `'use server'` a propósito: estas funciones reciben el cliente y el workspace de quien
 * llama (que ya pasó su guarda); exportadas desde un archivo de acciones serían endpoints sin
 * control (ver `lib/actions/modulos-server-only.test.ts`).
 *
 * Todo detrás de `lineas_negocio.config_extra.servicios_viaje.activo`: con el interruptor
 * apagado, aceptar una cotización hace lo de siempre y no se escribe ninguna fila (F0-7).
 */

import { contextoDeCotizacion, leerItinerarios } from '@/lib/cotizaciones/itinerarios-datos'
import { empresaDelOperador, fechasDelServicio, filasDeServicioDeTarifa, type FilaServicioNueva, type TipoServicio } from './servicios-desde-tarifa'
import { completadoDeFila, fechasDeFila, leerTramos, type FechasServicio, type TramoServicio } from './fechas-servicio'
import { serviciosViajeActivo, type EstadoEscrito } from './estado-servicio'
import { GATE_SERVICIOS_LISTOS, faltaParaServiciosListos, type FaltaServicio } from './gate-servicios'
import { configReglasPago } from './reglas-pago'
import { columnasMonedaServicio, esColumnaFaltante, monedaDelServicioConRespaldo, type MonedaDelServicio } from './moneda-servicio'

/** QA G9 · las columnas de moneda (migración `20261029221700`). */
const COLUMNAS_MONEDA_SERVICIO = 'moneda, costo_moneda, tasa_cotizada'
const COLUMNAS_MONEDA_GASTO = 'moneda, monto_moneda, tasa_cambio'
type ColumnasMonedaServicio = { moneda?: unknown; costo_moneda?: unknown; tasa_cotizada?: unknown }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export const MENSAJE_SERVICIOS_CON_PAGOS =
  'Esta cotización ya tiene pagos a proveedores registrados en sus servicios. No se puede corregir: duplícala para cambiarla.'

export type ResultadoGeneracion =
  | { ok: true; creadas: number; existentes: number; completadas?: number; apagado?: false }
  | { ok: true; creadas: 0; existentes: 0; apagado: true }
  | { ok: false; error: string }

/** El interruptor de la línea del negocio. Si no se puede leer, apagado (lo de siempre). */
export async function serviciosActivosDelNegocio(db: Db, negocioId: string): Promise<boolean> {
  const { data, error } = await db
    .from('negocios')
    .select('linea_id, lineas_negocio(config_extra)')
    .eq('id', negocioId)
    .maybeSingle()
  if (error || !data) return false
  const linea = (data as { lineas_negocio?: unknown }).lineas_negocio
  const fila = Array.isArray(linea) ? linea[0] : linea
  return serviciosViajeActivo((fila as { config_extra?: unknown } | null)?.config_extra)
}

/**
 * Crea las filas de servicio de la cotización aceptada del negocio. Idempotente (F0-3): un ítem
 * ya convertido en fila no se vuelve a insertar, y si dos llamadas se cruzan, el índice único
 * `(negocio_id, item_id)` frena la segunda y aquí se cuenta como ya existente.
 *
 * Nunca lanza: quien la llama justo después de aceptar NO deshace la aceptación si esto falla
 * (F0-4); la fila se trae después con «Traer los servicios de la cotización aceptada».
 */
export async function generarServiciosDesdeTarifa(
  db: Db,
  args: { workspaceId: string; negocioId: string; cotizacionId: string; staffId?: string | null },
): Promise<ResultadoGeneracion> {
  try {
    if (!(await serviciosActivosDelNegocio(db, args.negocioId))) {
      return { ok: true, creadas: 0, existentes: 0, apagado: true }
    }

    const { data: cot, error: cotErr } = await db
      .from('cotizaciones')
      .select('*')
      .eq('id', args.cotizacionId)
      .eq('workspace_id', args.workspaceId)
      .maybeSingle()
    if (cotErr) return { ok: false, error: cotErr.message }
    const c = cot as { estado?: string | null; negocio_id?: string | null; tarifa_aceptada_id?: string | null } | null
    if (!c || c.negocio_id !== args.negocioId) return { ok: false, error: 'Cotización no encontrada en este negocio' }
    if (c.estado !== 'aceptada') return { ok: false, error: 'La cotización todavía no está aceptada' }

    const ctx = await contextoDeCotizacion(db, args.cotizacionId)
    if (!ctx) return { ok: false, error: 'Cotización no encontrada' }

    let seleccion: string[] | null = null
    let itinerarioId: string | null = null
    if (c.tarifa_aceptada_id) {
      const filas = await leerItinerarios(db, args.cotizacionId)
      const tarifa = filas?.find(f => f.id === c.tarifa_aceptada_id) ?? null
      if (!tarifa) return { ok: false, error: 'No se encontró la tarifa aceptada' }
      seleccion = tarifa.seleccion
      itinerarioId = tarifa.id
    }

    const [tipoRanuraPorItem, salidaViaje, tramosPorItem] = await Promise.all([
      tiposDeRanura(db, args.cotizacionId),
      salidaDelViaje(db, args.negocioId),
      tramosDeItems(db, args.cotizacionId),
    ])
    // `items.tramos` se lee aquí y no en `contextoDeCotizacion`: esa corre en cada recálculo y la
    // pantalla la espeja campo a campo (P3); los tramos solo los usa la fila de servicio.
    const items = ctx.items.map(i => ({ ...i, tramos: tramosPorItem[i.id] ?? null }))
    const nuevas = filasDeServicioDeTarifa({ items, seleccion, params: ctx.params, tipoRanuraPorItem, salidaViaje })

    const { data: existentesRows, error: exErr } = await db
      .from('negocio_servicios')
      .select('item_id')
      .eq('negocio_id', args.negocioId)
      .not('item_id', 'is', null)
    if (exErr) return { ok: false, error: exErr.message }
    const yaEstan = new Set(((existentesRows ?? []) as Array<{ item_id: string }>).map(r => r.item_id))
    const faltan = nuevas.filter(f => !yaEstan.has(f.item_id))
    const existentes = nuevas.length - faltan.length
    // Las que ya estaban ganan las fechas nuevas de su ítem (las corregidas a mano, no).
    const completar = async () =>
      existentes > 0 ? (await completarFechasDeServicios(db, { workspaceId: args.workspaceId, negocioId: args.negocioId, salidaViaje })).completadas : 0
    if (faltan.length === 0) return { ok: true, creadas: 0, existentes, completadas: await completar() }

    const empresas = await empresasDeOperadores(db, args.workspaceId, faltan)
    let filas: Array<Record<string, unknown>> = faltan.map(f => aFila(f, args, itinerarioId, empresas))
    let { error: insErr } = await db.from('negocio_servicios').insert(filas)
    // Sin la migración de moneda (QA G9), la base no tiene las columnas: se inserta como antes y
    // la moneda se sigue leyendo del ítem.
    if (esColumnaFaltante(insErr)) {
      filas = filas.map(({ moneda: _m, costo_moneda: _c, tasa_cotizada: _t, ...resto }) => resto)
      ;({ error: insErr } = await db.from('negocio_servicios').insert(filas))
    }
    if (!insErr) return { ok: true, creadas: filas.length, existentes, completadas: await completar() }
    if (!esChoqueDeUnico(insErr)) return { ok: false, error: insErr.message }

    // Otra llamada insertó algunas entre la lectura y la escritura: una por una, y la que
    // choca ya existe. Es la ruta rara; la normal es un solo insert.
    let creadas = 0
    let chocaron = 0
    for (const fila of filas) {
      const { error } = await db.from('negocio_servicios').insert(fila)
      if (!error) creadas++
      else if (esChoqueDeUnico(error)) chocaron++
      else return { ok: false, error: error.message }
    }
    return { ok: true, creadas, existentes: existentes + chocaron }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function esChoqueDeUnico(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === '23505'
}

function aFila(
  f: FilaServicioNueva,
  args: { workspaceId: string; negocioId: string; cotizacionId: string; staffId?: string | null },
  itinerarioId: string | null,
  empresas: ReadonlyArray<{ id: string; nombre?: string | null; razon_social?: string | null }> = [],
) {
  return {
    workspace_id: args.workspaceId,
    negocio_id: args.negocioId,
    cotizacion_id: args.cotizacionId,
    itinerario_id: itinerarioId,
    item_id: f.item_id,
    tipo: f.tipo,
    nombre: f.nombre,
    proveedor_nombre: f.proveedor_nombre,
    proveedor_empresa_id: f.buscarEmpresa ? empresaDelOperador(f.proveedor_nombre, empresas) : null,
    // H-17: la «Compra antes del» del paquete. Solo si la trae: sin ella, la columna queda como antes.
    ...(f.fecha_limite_pago ? { fecha_limite_pago: f.fecha_limite_pago } : {}),
    ...columnasDeFechas(f),
    fechas_leidas_at: new Date().toISOString(),
    costo_cotizado: f.costo_cotizado,
    ...columnasMonedaServicio(f.moneda ?? null),
    orden: f.orden,
    origen: 'cotizacion',
    estado: 'por_reservar',
    created_by: args.staffId ?? null,
  }
}

/**
 * Las empresas del Directorio que podrían ser el operador de un paquete de bloqueo (H10, 2026-10-29).
 * Solo se consulta si alguna fila lo pide; si la lectura falla, ninguna (la fila queda con el texto).
 */
async function empresasDeOperadores(
  db: Db,
  workspaceId: string,
  filas: readonly FilaServicioNueva[],
): Promise<Array<{ id: string; nombre: string | null; razon_social: string | null }>> {
  if (!filas.some(f => f.buscarEmpresa && f.proveedor_nombre)) return []
  const { data, error } = await db.from('empresas').select('id, nombre, razon_social').eq('workspace_id', workspaceId)
  if (error) return []
  return (data ?? []) as Array<{ id: string; nombre: string | null; razon_social: string | null }>
}

/**
 * `items.tramos` de cada ítem, por id (ida y regreso del vuelo, cada uno con su número). Si no se
 * puede leer, vacío: el vuelo sale de la lectura, como antes del 2026-10-22.
 */
async function tramosDeItems(db: Db, cotizacionId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db.from('items').select('id, tramos').eq('cotizacion_id', cotizacionId)
  if (error) return {}
  return Object.fromEntries(((data ?? []) as Array<{ id: string; tramos?: unknown }>).map(i => [i.id, i.tramos ?? null]))
}

/** El tipo de la ranura de cada ítem (`items.ranura_id` → `cotizacion_ranuras.tipo`). */
async function tiposDeRanura(db: Db, cotizacionId: string): Promise<Record<string, string | null>> {
  const [itemsRes, ranurasRes] = await Promise.all([
    db.from('items').select('id, ranura_id').eq('cotizacion_id', cotizacionId),
    db.from('cotizacion_ranuras').select('id, tipo').eq('cotizacion_id', cotizacionId),
  ])
  // Sin la columna o sin la tabla, el tipo sale del grupo: no se frena por esto.
  if (itemsRes.error || ranurasRes.error) return {}
  const tipoPorRanura = new Map(
    ((ranurasRes.data ?? []) as Array<{ id: string; tipo: string | null }>).map(r => [r.id, r.tipo]),
  )
  const salida: Record<string, string | null> = {}
  for (const it of (itemsRes.data ?? []) as Array<{ id: string; ranura_id: string | null }>) {
    salida[it.id] = it.ranura_id ? tipoPorRanura.get(it.ranura_id) ?? null : null
  }
  return salida
}

/**
 * La salida del viaje: `data.fecha_salida` del primer bloque del negocio que la tenga (el de la
 * etapa 1). `null` si no hay o no se puede leer: entonces el día N de una actividad no da fecha.
 */
export async function salidaDelViaje(db: Db, negocioId: string): Promise<string | null> {
  const { data, error } = await db
    .from('negocio_bloques')
    .select('fecha_salida:data->fecha_salida')
    .eq('negocio_id', negocioId)
  if (error) return null
  for (const b of (data ?? []) as Array<{ fecha_salida: unknown }>) {
    const m = typeof b.fecha_salida === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(b.fecha_salida.trim()) : null
    if (m) return m[1]
  }
  return null
}

/** Columnas de fechas de la fila, tal como se escriben (tramos vacíos = `null`). */
export function columnasDeFechas(f: FechasServicio): Record<string, unknown> {
  return {
    fecha_servicio: f.fecha_servicio,
    fecha_fin: f.fecha_fin,
    hora_inicio: f.hora_inicio,
    hora_fin: f.hora_fin,
    tramos: f.tramos && f.tramos.length > 0 ? f.tramos : null,
  }
}

/**
 * ¿Un vuelo guardado con algún tramo, después del primero, sin número? Son las filas leídas antes
 * del número por tramo (brief del 2026-10-22): la ida se quedaba con los dos números y el regreso
 * sin ninguno. Abrir el tablero las vuelve a leer aunque tengan la marca puesta.
 *
 * Idempotente sin marca nueva: si el ítem ya da el número, la fila lo gana y deja de calzar aquí;
 * si no lo da (sin `items.tramos`), releerla no cambia nada y no se escribe (`completadoDeFila`).
 * Lo corregido a mano ni llega (lo filtra la consulta y el UPDATE).
 */
export function vueloSinNumeroDeRegreso(r: { tipo: string; tramos: unknown }): boolean {
  if (r.tipo !== 'vuelo') return false
  const tramos = leerTramos(r.tramos)
  return !!tramos && tramos.length > 1 && tramos.slice(1).some(t => !t.numero_vuelo)
}

/**
 * Completa las fechas de las filas YA generadas desde su ítem (punto 5 del brief del 2026-10-21):
 * las filas anteriores a las fechas nuevas solo tenían el inicio (y el vuelo, solo la ida).
 *
 * Idempotente: escribe solo si lo leído cambia algo, y pone `fechas_leidas_at` para que abrir el
 * tablero no lo vuelva a intentar. NUNCA toca una fila corregida a mano (`fechas_corregidas_at`,
 * también en la condición del UPDATE: si la asesora corrige mientras esto corre, gana ella) ni una
 * fila `origen = 'manual'`. Nunca lanza.
 *
 * @param args.soloSinMarca solo las filas que nunca se completaron (lo que pide abrir el tablero),
 *   más los vuelos con un tramo después del primero sin número (`vueloSinNumeroDeRegreso`).
 */
export async function completarFechasDeServicios(
  db: Db,
  args: { workspaceId: string; negocioId: string; salidaViaje?: string | null; soloSinMarca?: boolean },
): Promise<{ completadas: number }> {
  try {
    const q = db
      .from('negocio_servicios')
      .select('id, item_id, tipo, fecha_servicio, fecha_fin, hora_inicio, hora_fin, tramos, fechas_leidas_at')
      .eq('workspace_id', args.workspaceId)
      .eq('negocio_id', args.negocioId)
      .eq('origen', 'cotizacion')
      .is('fechas_corregidas_at', null)
      .not('item_id', 'is', null)
    const { data: filas, error } = await q
    if (error || !filas) return { completadas: 0 }
    const rows = (filas as Array<{
      id: string; item_id: string; tipo: string; fecha_servicio: string | null; fecha_fin: string | null
      hora_inicio: string | null; hora_fin: string | null; tramos: unknown; fechas_leidas_at: string | null
    }>).filter(r => !args.soloSinMarca || !r.fechas_leidas_at || vueloSinNumeroDeRegreso(r))
    if (rows.length === 0) return { completadas: 0 }

    const [itemsRes, salida] = await Promise.all([
      db.from('items').select('id, tarifa_pax, dia_relativo, tramos').in('id', [...new Set(rows.map(r => r.item_id))]),
      args.salidaViaje !== undefined ? Promise.resolve(args.salidaViaje) : salidaDelViaje(db, args.negocioId),
    ])
    if (itemsRes.error) return { completadas: 0 }
    const itemDe = new Map(((itemsRes.data ?? []) as Array<{ id: string; tarifa_pax: unknown; dia_relativo: number | null; tramos?: unknown }>).map(i => [i.id, i]))

    const ahora = new Date().toISOString()
    let completadas = 0
    for (const r of rows) {
      const item = itemDe.get(r.item_id)
      const leidas = item
        ? fechasDelServicio({ tarifa_pax: item.tarifa_pax as never, dia_relativo: item.dia_relativo ?? null, tramos: item.tramos ?? null }, r.tipo as TipoServicio, salida)
        : null
      const cambio = leidas ? completadoDeFila(fechasDeFila(r), leidas) : null
      // Sin cambio y con la marca ya puesta: nada que escribir.
      if (!cambio && r.fechas_leidas_at) continue
      const { data: escritas, error: upErr } = await db
        .from('negocio_servicios')
        .update({ ...(cambio ? columnasDeFechas(cambio) : {}), fechas_leidas_at: ahora })
        .eq('id', r.id)
        .eq('workspace_id', args.workspaceId)
        .is('fechas_corregidas_at', null)
        .select('id')
      if (upErr) {
        console.error('[servicios-viaje] no se pudieron completar las fechas:', upErr.message)
        continue
      }
      if (cambio && (escritas ?? []).length > 0) completadas++
    }
    return { completadas }
  } catch (e) {
    console.error('[servicios-viaje] completar fechas:', e instanceof Error ? e.message : String(e))
    return { completadas: 0 }
  }
}

/**
 * Antes de borrar filas (prerreserva vencida o aceptación que se corrige): el texto de la
 * Actividad con las fechas corregidas a mano que se van con ellas, o `null` si no hay ninguna.
 *
 * ⚠️ Se pierden a propósito y no se pasan a la versión nueva: los ítems de la versión nueva tienen
 * id nuevo y la cotización se vuelve a armar (otras fechas, otras capturas). Pegarle una fecha
 * vieja a «el ítem que se parece» por nombre podría dejar una fecha mala en silencio, que es peor
 * que «Falta la fecha». El rastro deja dicho qué había para volverlo a escribir si sigue valiendo.
 */
export function rastroDeFechasCorregidas(
  filas: ReadonlyArray<{ nombre: string; fechas_corregidas_at?: string | null; fecha_servicio?: string | null; fecha_fin?: string | null }>,
): string | null {
  const corregidas = filas.filter(f => f.fechas_corregidas_at)
  if (corregidas.length === 0) return null
  const lista = corregidas
    .map(f => `${f.nombre} (${f.fecha_servicio ?? 'sin fecha'}${f.fecha_fin && f.fecha_fin !== f.fecha_servicio ? ` a ${f.fecha_fin}` : ''})`)
    .join('; ')
  return `Se descartaron fechas corregidas a mano: ${lista}. Si siguen valiendo, escríbelas otra vez en la fila nueva.`.slice(0, 280)
}

// ── Lectura para el bloque ───────────────────────────────────────────────────

export interface ServicioDelNegocio {
  id: string
  tipo: string
  nombre: string
  proveedor_nombre: string | null
  localizador: string | null
  estado: EstadoEscrito
  fecha_servicio: string | null
  /** Fechas nuevas (2026-10-21). Opcionales: las pruebas puras viejas no las traen. */
  fecha_fin?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
  tramos?: TramoServicio[] | null
  item_id?: string | null
  fechas_leidas_at?: string | null
  fechas_corregidas_at?: string | null
  fechas_corregidas_por?: string | null
  responsable_staff_id?: string | null
  fecha_limite_pago: string | null
  costo_cotizado: number
  valor_por_pagar: number | null
  voucher_ref: string | null
  confirmacion_ref: string | null
  orden: number
  origen: 'cotizacion' | 'manual'
  gastos: GastoDeServicio[]
  aprobaciones: AprobacionDeServicio[]
  /**
   * H6-1 / H9-1 · la moneda en que se cotizó (del ítem de la cotización, `moneda-servicio.ts`).
   * `null` o ausente = en pesos.
   */
  moneda?: MonedaDelServicio | null
}

export interface GastoDeServicio {
  /** Opcionales: las pruebas puras no los necesitan; la lectura de la base siempre los trae. */
  id?: string
  fecha?: string | null
  monto: number
  soporte_url: string | null
  medio_pago: string | null
  titular_medio: string | null
  /** El texto del gasto: trae la TRM del pago en otra moneda (`marcaTrm`). */
  descripcion?: string | null
  /** QA G9 · moneda, monto en la moneda y TRM del pago (`gastos`). Null = en pesos o pago de antes. */
  moneda?: string | null
  monto_moneda?: number | null
  tasa_cambio?: number | null
}

export interface AprobacionDeServicio {
  id?: string
  tipo?: string
  estado: 'solicitada' | 'aprobada' | 'rechazada' | 'caducada'
  huella?: string
  motivo?: string | null
  detalle?: Record<string, unknown> | null
  solicitada_por?: string | null
  decidida_at?: string | null
}

/** Las filas del negocio en el orden del viaje, con lo pagado y las aprobaciones de cada una. */
export async function leerServiciosDelNegocio(
  db: Db,
  args: { workspaceId: string; negocioId: string },
): Promise<ServicioDelNegocio[] | null> {
  const COLUMNAS = 'id, tipo, nombre, proveedor_nombre, localizador, estado, fecha_servicio, fecha_fin, hora_inicio, hora_fin, tramos, item_id, fechas_leidas_at, fechas_corregidas_at, fechas_corregidas_por, responsable_staff_id, fecha_limite_pago, costo_cotizado, valor_por_pagar, voucher_ref, confirmacion_ref, orden, origen'
  const leerFilas = (columnas: string) => db
    .from('negocio_servicios')
    .select(columnas)
    .eq('workspace_id', args.workspaceId)
    .eq('negocio_id', args.negocioId)
    .order('orden', { ascending: true })
  // QA G9 · la moneda del servicio en sus columnas; sin la migración, la base no las tiene y la
  // fila se lee como antes (la moneda sale del ítem).
  let { data, error } = await leerFilas(`${COLUMNAS}, ${COLUMNAS_MONEDA_SERVICIO}`)
  if (esColumnaFaltante(error)) ({ data, error } = await leerFilas(COLUMNAS))
  if (error) {
    console.error('[servicios-viaje] no se pudieron leer:', error.message)
    return null
  }
  const filas = (data ?? []) as Array<Omit<ServicioDelNegocio, 'gastos' | 'aprobaciones'> & ColumnasMonedaServicio>
  if (filas.length === 0) return []
  const ids = filas.map(f => f.id)
  const COLUMNAS_GASTO = 'id, fecha, servicio_id, monto, soporte_url, medio_pago, titular_medio, descripcion'
  const leerGastos = async () => {
    const leer = (columnas: string) => db.from('gastos').select(columnas).in('servicio_id', ids).order('fecha', { ascending: true })
    const r = await leer(`${COLUMNAS_GASTO}, ${COLUMNAS_MONEDA_GASTO}`)
    return esColumnaFaltante(r.error) ? leer(COLUMNAS_GASTO) : r
  }
  const [gastosRes, aprobRes] = await Promise.all([
    leerGastos(),
    // Las caducadas no pintan nada: la vigente o la última decisión son las que cuentan.
    db.from('aprobaciones_excepcion')
      .select('id, entidad_id, tipo, estado, huella, motivo, detalle, solicitada_por, decidida_at')
      .eq('entidad_tipo', 'servicio')
      .in('entidad_id', ids)
      .neq('estado', 'caducada'),
  ])
  // Sin pagos o sin aprobaciones la fila se pintaría (y el gate la juzgaría) con menos de lo que
  // tiene: una rechazada perdida deja pasar un pago que Edgar no aprobó. Mejor no saber.
  if (gastosRes.error || aprobRes.error) {
    console.error('[servicios-viaje] no se pudieron leer pagos o aprobaciones:', (gastosRes.error ?? aprobRes.error).message)
    return null
  }
  const gastos = (gastosRes.data ?? []) as Array<GastoDeServicio & { servicio_id: string }>
  const itemDe = await itemsDeServicios(db, filas)
  const aprob = (aprobRes.data ?? []) as Array<AprobacionDeServicio & { entidad_id: string }>
  return filas.map(f => ({
    ...f,
    // `time` llega con segundos y `tramos` es jsonb: se leen sin confiar en su forma.
    ...fechasDeFila(f),
    costo_cotizado: Number(f.costo_cotizado) || 0,
    valor_por_pagar: f.valor_por_pagar === null ? null : Number(f.valor_por_pagar),
    gastos: gastos.filter(g => g.servicio_id === f.id).map(g => ({
      id: g.id,
      fecha: g.fecha ?? null,
      monto: Number(g.monto) || 0,
      soporte_url: g.soporte_url,
      medio_pago: g.medio_pago,
      titular_medio: g.titular_medio,
      descripcion: g.descripcion ?? null,
      moneda: g.moneda ?? null,
      monto_moneda: g.monto_moneda === null || g.monto_moneda === undefined ? null : Number(g.monto_moneda),
      tasa_cambio: g.tasa_cambio === null || g.tasa_cambio === undefined ? null : Number(g.tasa_cambio),
    })),
    // Manda la columna (QA G9); las filas de antes, el ítem de la cotización (#1364).
    moneda: monedaDelServicioConRespaldo(f, f.item_id ? itemDe.get(f.item_id) : null, Number(f.costo_cotizado) || 0),
    aprobaciones: vigentesPorTipo(aprob.filter(a => a.entidad_id === f.id)).map(a => ({
      id: a.id,
      tipo: a.tipo,
      estado: a.estado,
      huella: a.huella,
      motivo: a.motivo ?? null,
      detalle: a.detalle ?? null,
      solicitada_por: a.solicitada_por ?? null,
      decidida_at: a.decidida_at ?? null,
    })),
  }))
}

/**
 * `tarifa_pax` y `subtotal` de los ítems de las filas, para la moneda de cada servicio. Si no se
 * pueden leer, ninguno: la fila se ve en pesos, como antes del 2026-10-29.
 */
async function itemsDeServicios(
  db: Db,
  filas: ReadonlyArray<{ item_id?: string | null }>,
): Promise<Map<string, { tarifa_pax: unknown; subtotal: number | null }>> {
  const ids = [...new Set(filas.map(f => f.item_id).filter((x): x is string => !!x))]
  if (ids.length === 0) return new Map()
  try {
    const { data, error } = await db.from('items').select('id, tarifa_pax, subtotal').in('id', ids)
    if (error || !Array.isArray(data)) return new Map()
    return new Map((data as Array<{ id: string; tarifa_pax: unknown; subtotal: number | null }>).map(i => [i.id, { tarifa_pax: i.tarifa_pax, subtotal: i.subtotal }]))
  } catch {
    return new Map()
  }
}

/**
 * Por tipo de regla, solo la que manda: la pedida o aprobada (hay a lo sumo una, índice único) y,
 * si no hay, la última rechazada. Una rechazada vieja que ya se volvió a pedir y se aprobó no
 * puede dejar la fila en «No aprobado».
 */
function vigentesPorTipo<T extends AprobacionDeServicio>(filas: readonly T[]): T[] {
  const porTipo = new Map<string, T>()
  for (const a of filas) {
    const clave = a.tipo ?? ''
    const actual = porTipo.get(clave)
    if (!actual) { porTipo.set(clave, a); continue }
    const viva = (x: T) => x.estado === 'solicitada' || x.estado === 'aprobada'
    if (viva(a) && !viva(actual)) { porTipo.set(clave, a); continue }
    if (!viva(a) && !viva(actual) && (a.decidida_at ?? '') > (actual.decidida_at ?? '')) porTipo.set(clave, a)
  }
  return [...porTipo.values()]
}

// ── Gate `servicios_listos` (F3-7) ───────────────────────────────────────────

const TEXTO_NO_SE_PUDO_LEER = 'No se pudieron leer los servicios del viaje. Intenta de nuevo.'

/**
 * Lo que falta para salir de Reservas y pagos. Opt-in por `etapas_negocio.config_extra.gates`: una
 * etapa sin `servicios_listos` no consulta nada (SOENA, AFI y Termotech no cambian). Con la línea
 * apagada tampoco frena: el tablero no se edita y frenar con él sería un bloqueo sin salida.
 */
export async function evaluarGateServicios(
  db: Db,
  args: { workspaceId: string; negocioId: string; gates: readonly string[] },
): Promise<FaltaServicio[]> {
  if (!args.gates.includes(GATE_SERVICIOS_LISTOS)) return []
  const { data, error } = await db
    .from('negocios')
    .select('linea_id, lineas_negocio(config_extra)')
    .eq('id', args.negocioId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()
  // Falla cerrado (como la autorización de datos): sin saber si la línea lo exige, no se suelta.
  if (error || !data) return [{ servicioId: '', texto: TEXTO_NO_SE_PUDO_LEER }]
  const linea = (data as { lineas_negocio?: unknown } | null)?.lineas_negocio
  const config = ((Array.isArray(linea) ? linea[0] : linea) as { config_extra?: unknown } | null)?.config_extra ?? null
  if (!serviciosViajeActivo(config)) return []
  const filas = await leerServiciosDelNegocio(db, args)
  // Si no se pudieron leer, la duda frena: no se suelta un viaje sin saber si se pagó.
  if (filas === null) return [{ servicioId: '', texto: TEXTO_NO_SE_PUDO_LEER }]
  return faltaParaServiciosListos(filas, configReglasPago(config).exigeConfirmacion)
}

// ── Corregir una aceptación ──────────────────────────────────────────────────

/**
 * Antes de soltar una aceptación (`corregirCotizacionAceptada`): borra las filas de servicio
 * nacidas de la cotización que no tienen pagos y se niega, sin tocar nada, si alguna los tiene (F0-5). Ya salió plata a
 * un proveedor: la salida es duplicar la cotización, igual que con los cobros confirmados.
 *
 * Se mira siempre, no solo con el interruptor encendido: una línea que lo apagó después puede
 * tener filas con pagos, y esos no se pueden dejar colgando de una cotización que cambia.
 */
export async function soltarServiciosDeAceptacion(
  db: Db,
  args: { workspaceId: string; negocioId: string },
): Promise<{ ok: true; borradas: number; rastro?: string | null } | { ok: false; error: string }> {
  // Solo las que nacieron de la cotización: una fila agregada a mano no depende de ella.
  const { data, error } = await db
    .from('negocio_servicios')
    .select('id, nombre, fecha_servicio, fecha_fin, fechas_corregidas_at')
    .eq('workspace_id', args.workspaceId)
    .eq('negocio_id', args.negocioId)
    .eq('origen', 'cotizacion')
  if (error) {
    // Sin la tabla (migración sin aplicar) no hay nada que soltar.
    if (error.code === '42P01' || error.code === 'PGRST205') return { ok: true, borradas: 0 }
    return { ok: false, error: 'No se pudieron leer los servicios del viaje' }
  }
  const ids = ((data ?? []) as Array<{ id: string }>).map(r => r.id)
  if (ids.length === 0) return { ok: true, borradas: 0 }

  const { data: pagos, error: pagosErr } = await db
    .from('gastos')
    .select('id')
    .in('servicio_id', ids)
    .limit(1)
  // Si los pagos no se pudieron leer, NO se asume que no hay: la duda frena.
  if (pagosErr) return { ok: false, error: 'No se pudieron leer los pagos a proveedores' }
  if ((pagos ?? []).length > 0) return { ok: false, error: MENSAJE_SERVICIOS_CON_PAGOS }

  const { error: delErr } = await db
    .from('negocio_servicios')
    .delete()
    .eq('workspace_id', args.workspaceId)
    .in('id', ids)
  if (delErr) return { ok: false, error: delErr.message }
  // Quien llama lo deja en la Actividad: las fechas corregidas a mano se van con las filas.
  const rastro = rastroDeFechasCorregidas((data ?? []) as Array<{ nombre: string; fechas_corregidas_at: string | null; fecha_servicio: string | null; fecha_fin: string | null }>)
  return { ok: true, borradas: ids.length, rastro }
}
