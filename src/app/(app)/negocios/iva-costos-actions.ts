'use server'

/**
 * La casilla «Calcular con IVA» de la cotización (Mauricio, 2026-10-19).
 *
 * Los costos de los proveedores se guardan SIN IVA. Con la casilla encendida, cada línea cuyo
 * proveedor declara IVA (`fotos_perfiles.iva_declarado`) lleva `items.iva_costo_pct = 19`, la
 * cascada le suma el IVA al costo (`costosDelItem`) y todo se recalcula: precio, total, PDF.
 *
 * Nadie la tocó (`cotizaciones.costos_con_iva` NULL) → nace encendida si algún proveedor de la
 * cotización declara IVA y el viajero es residente (`viajero_residente` NULL = residente).
 *
 * Qué proveedor tiene cada línea lo decide AQUÍ el servidor, con el mismo pedido que usa la
 * tarjeta (`pedidoDeLinea`) y el mismo reconocimiento de nombres (`resolverPedidos`, sin escribir).
 *
 * Solo escribe en una cotización en BORRADOR y con un rol que escribe: una cotización enviada no
 * cambia de precio porque alguien clasificó un proveedor después.
 */
import { getWorkspace } from '@/lib/actions/get-workspace'
import { casillaIva, ivaDeLinea, pctDeIva } from '@/lib/cotizaciones/iva-costo'
import { pedidoDeLinea } from '@/lib/cotizaciones/proveedor-de-linea'
import { objetivo, type ObjetivoFoto } from '@/lib/fotos/clave'
import { leerConocidos, resolverPedidos } from '@/lib/fotos/perfiles-db'
import { tienePropuestaHtml } from '@/lib/pdf/motor-html'
import { recalcularTotales } from './cotizacion-actions'

const ROLES_SIN_ESCRITURA = new Set(['read_only', 'contador'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export interface EstadoIvaCostos {
  /** El espacio tiene propuesta de viaje y la migración está: la casilla existe. */
  disponible: boolean
  encendida: boolean
  /** Nadie la ha tocado: el estado es el valor por defecto. */
  porDefecto: boolean
  viajeroResidente: boolean
  /** Los proveedores de la cotización que declaran IVA (nombres, sin repetir). */
  proveedoresConIva: string[]
  /** Las líneas que llevan IVA en su costo después de aplicar. */
  lineasConIva: number
  /** Se puede cambiar (borrador y rol que escribe). */
  editable: boolean
  /** Esta llamada cambió el IVA de alguna línea (la pantalla tiene que refrescar los totales). */
  cambio: boolean
}

type Resultado = ({ ok: true } & EstadoIvaCostos) | { ok: false; error: string }

const NO_DISPONIBLE: EstadoIvaCostos = { disponible: false, encendida: false, porDefecto: true, viajeroResidente: true, proveedoresConIva: [], lineasConIva: 0, editable: false, cambio: false }

interface FilaCot {
  id: string
  estado: string
  costos_con_iva?: boolean | null
  viajero_residente?: boolean | null
}

interface FilaItem {
  id: string
  nombre: string | null
  grupo: string | null
  tarifa_pax?: unknown
  es_ajuste?: boolean | null
  iva_costo_pct?: number | string | null
}

async function aplicar(cotizacionId: string, cambio: { encendida?: boolean; viajeroResidente?: boolean } | null): Promise<Resultado> {
  if (typeof cotizacionId !== 'string' || !UUID.test(cotizacionId)) return { ok: false, error: 'Esa cotización no existe.' }
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: String(error ?? 'No autenticado') }
  const db = supabase as Cliente
  const { data: ws } = await db.from('workspaces').select('cotizacion_template_slug').eq('id', workspaceId).maybeSingle()
  if (!tienePropuestaHtml((ws as { cotizacion_template_slug?: string | null } | null)?.cotizacion_template_slug)) return { ok: true, ...NO_DISPONIBLE }

  const { data: cotData, error: eCot } = await db
    .from('cotizaciones')
    .select('id, estado, costos_con_iva, viajero_residente')
    .eq('workspace_id', workspaceId)
    .eq('id', cotizacionId)
    .maybeSingle()
  // Sin la migración (columnas que no existen) la casilla no aparece y nada cambia.
  if (eCot) return { ok: true, ...NO_DISPONIBLE }
  const cot = cotData as FilaCot | null
  if (!cot) return { ok: false, error: 'Esa cotización no está en este espacio.' }
  const editable = cot.estado === 'borrador' && !ROLES_SIN_ESCRITURA.has(role ?? '')
  if (cambio && !editable) {
    return { ok: false, error: cot.estado === 'borrador' ? 'Tu rol puede ver la cotización pero no cambiarla.' : 'La cotización ya salió de borrador: su precio no cambia.' }
  }

  // Lo que la persona decidió se guarda primero: la casilla y si el viajero reside.
  let guardada = cot.costos_con_iva ?? null
  let residente = cot.viajero_residente ?? null
  if (cambio) {
    const patch: Record<string, boolean> = {}
    if (typeof cambio.encendida === 'boolean') patch.costos_con_iva = guardada = cambio.encendida
    if (typeof cambio.viajeroResidente === 'boolean') patch.viajero_residente = residente = cambio.viajeroResidente
    if (Object.keys(patch).length > 0) {
      const { error: e } = await db.from('cotizaciones').update(patch).eq('workspace_id', workspaceId).eq('id', cot.id)
      if (e) return { ok: false, error: 'No se pudo guardar. Vuelve a intentarlo.' }
    }
  }

  const { data: itemsData } = await db.from('items').select('*').eq('cotizacion_id', cot.id)
  const items = ((itemsData ?? []) as FilaItem[]).filter((i) => !i.es_ajuste)

  // El proveedor de cada línea: el mismo pedido de la tarjeta, reconocido sin escribir.
  const pedidos = new Map<string, ObjetivoFoto>()
  for (const i of items) {
    const p = pedidoDeLinea({ nombre: i.nombre, grupo: i.grupo, tarifa_pax: i.tarifa_pax })
    const o = p ? objetivo(p.tipo, p.nombre, p.ciudad) : null
    if (o) pedidos.set(i.id, o)
  }
  const declara = new Map<string, { nombre: string; iva: boolean }>()
  if (pedidos.size > 0) {
    const leidos = await leerConocidos(db, workspaceId)
    if (leidos.ok) {
      const unicos = [...new Map([...pedidos.values()].map((o) => [`${o.tipo}:${o.clave}`, o])).values()]
      const resueltos = await resolverPedidos(db, workspaceId, staffId ?? null, unicos, leidos.conocidos, { escribir: false })
      const perfilDe = new Map(resueltos.map((r) => [`${r.pedido.tipo}:${r.pedido.clave}`, r.perfil]))
      const claves = [...new Set(resueltos.flatMap((r) => (r.perfil ? [r.perfil.clave] : [])))]
      if (claves.length > 0) {
        const { data: fichas } = await db.from('fotos_perfiles').select('tipo, clave, nombre, iva_declarado').eq('workspace_id', workspaceId).in('clave', claves)
        const porClave = new Map(((fichas ?? []) as { tipo: string; clave: string; nombre: string; iva_declarado: boolean | null }[]).map((f) => [`${f.tipo}:${f.clave}`, f]))
        for (const [itemId, o] of pedidos) {
          const perfil = perfilDe.get(`${o.tipo}:${o.clave}`)
          const ficha = perfil ? porClave.get(`${perfil.tipo}:${perfil.clave}`) : undefined
          if (ficha) declara.set(itemId, { nombre: ficha.nombre, iva: ficha.iva_declarado === true })
        }
      }
    }
  }

  const proveedoresConIva = [...new Set([...declara.values()].filter((d) => d.iva).map((d) => d.nombre))].sort((a, b) => a.localeCompare(b, 'es'))
  const estado = casillaIva({ guardada, algunProveedorDeclaraIva: proveedoresConIva.length > 0, viajeroResidente: residente })

  let cambioLineas = false
  let lineasConIva = 0
  const escrituras: PromiseLike<{ error: unknown }>[] = []
  for (const i of items) {
    const deseado = ivaDeLinea(estado.encendida, declara.get(i.id)?.iva ?? null)
    const actual = pctDeIva(i.iva_costo_pct) || null
    if ((deseado ?? 0) > 0) lineasConIva++
    if (deseado === actual) continue
    if (!editable) continue
    escrituras.push(db.from('items').update({ iva_costo_pct: deseado }).eq('cotizacion_id', cot.id).eq('id', i.id))
  }
  if (escrituras.length > 0) {
    const resultados = await Promise.all(escrituras)
    if (resultados.some((r) => r.error)) return { ok: false, error: 'No se pudo aplicar el IVA a todas las líneas. Vuelve a intentarlo.' }
    cambioLineas = true
    await recalcularTotales(cot.id)
  }
  if (!editable) {
    // Sin poder escribir se informa lo que de verdad tiene cada línea, no lo que tendría.
    lineasConIva = items.filter((i) => pctDeIva(i.iva_costo_pct) > 0).length
  }

  return {
    ok: true,
    disponible: true,
    encendida: estado.encendida,
    porDefecto: estado.porDefecto,
    viajeroResidente: residente !== false,
    proveedoresConIva,
    lineasConIva,
    editable,
    cambio: cambioLineas,
  }
}

/**
 * Al abrir la cotización: deja cada línea con el IVA que le toca según la casilla (la guardada o
 * la de por defecto). Las líneas nuevas desde la última vez lo reciben aquí. Solo escribe si algo
 * cambia y la cotización está en borrador.
 */
export async function sincronizarIvaDeCostos(cotizacionId: string): Promise<Resultado> {
  return aplicar(cotizacionId, null)
}

/** La persona prende o apaga la casilla, o dice si el viajero reside en Colombia. */
export async function cambiarIvaDeCostos(cotizacionId: string, cambio: { encendida?: boolean; viajeroResidente?: boolean }): Promise<Resultado> {
  return aplicar(cotizacionId, cambio && typeof cambio === 'object' ? cambio : {})
}
