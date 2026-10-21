'use server'

/**
 * Proveedores (Mauricio, 2026-10-18): la ficha única de cada hotel, operador, parque, transporte,
 * lancha, actividad o mayorista, sus tarifarios y sus cuentas bancarias. La ficha ES el perfil de
 * fotos de #1202 (`fotos_perfiles`, migración `20261018150000`): un hotel que entra a una
 * cotización ya es un proveedor.
 *
 * Lo que se decide AQUÍ y no en el navegador:
 *  · que el espacio tenga propuesta de viaje (como «Hoteles y tours») y que el rol escriba;
 *  · la llave y el espacio de un proveedor nuevo (y si ya existía con otro nombre);
 *  · que el responsable sea del equipo y que «se compra a través de» sea un mayorista del espacio;
 *  · que el archivo subido sea de ESE proveedor, exista y sea PDF o imagen de hasta 20 MB;
 *  · las cuentas bancarias: solo con permiso financiero (`puedeVerCuentasDeProveedor`), con el
 *    cliente de servicio (la tabla es server-only) y filtrando SIEMPRE por workspace; verificar
 *    exige ser otra persona que quien la cargó (también lo exige la base).
 */
import { getWorkspace } from '@/lib/actions/get-workspace'
import { elementosDe, leerTodasLasFotos } from '@/lib/fotos/catalogo'
import { enlacesDeCatalogo } from '@/lib/fotos/catalogo-almacen'
import { fotoImprimible, objetivo } from '@/lib/fotos/clave'
import { leerConocidos, resolverPedidos } from '@/lib/fotos/perfiles-db'
import { puedeVerCuentasDeProveedor, type Area, type Role } from '@/lib/permissions/can-edit'
import { tienePropuestaHtml } from '@/lib/pdf/motor-html'
import { borrarArchivo, confirmarSubida, descargarArchivo, enlaceDeArchivo, urlDeSubida } from '@/lib/proveedores/almacen'
import { BYTES_MAXIMOS_ARCHIVO, extensionDeMime, type ClaseArchivo } from '@/lib/proveedores/archivos'
import { revisarCuenta, revisarDatos, revisarVigencia } from '@/lib/proveedores/datos'
import { establecimientosDe, llaveEstablecimiento, resumenExtraccion, revisarExtraccion, sugerenciasParaFicha, vigenciaPorConfirmar, type ExtraccionRevisada, type ResumenExtraccion } from '@/lib/proveedores/extraccion'
import { INSTRUCCION_VERSION, instruccionVigente } from '@/lib/proveedores/instruccion'
import { correrMotor, type ArchivoParaMotor } from '@/lib/proveedores/motor'
import { revisarAjustesMoneda, tarifasParaCotizar, TEXTO_NO_COTIZA, vigenciaParaCerrar, type AjustesMoneda } from '@/lib/proveedores/tarifas-extraidas'
import { extraccionParaCotizar } from '@/lib/proveedores/extraccion-para-cotizar'
import { ciudadDeFichaEsDepartamento, faltasDeFicha, quitarNotaCiudadPorConfirmar, textoCiudadEsDepartamento, tieneNotaCiudadPorConfirmar, type FaltaFicha } from '@/lib/proveedores/completitud'
import { aliasPorCambio, claveCiudad, claveDeProveedor, ciudadDeClave, espacioDeTipo, esTipoProveedor, tieneFotos, type EspacioProveedor, type TarifaCanal, type TipoProveedor } from '@/lib/proveedores/tipos'
import { hoyBogota, type VigenciaTarifario } from '@/lib/proveedores/vigencia'
import {
  COLUMNAS_PROVEEDOR,
  COLUMNAS_TARIFARIO,
  estadoDeProveedor,
  tarifarioVista,
  vigenciaDeFila,
  type FilaProveedor,
  type FilaTarifario,
  type ProveedorEnLista,
  type TarifarioVista,
} from '@/lib/proveedores/vista'
import { createServiceClient } from '@/lib/supabase/server'

const ROLES_SIN_ESCRITURA = new Set(['read_only', 'contador'])
const MENSAJE_SIN_ROL = 'Tu rol puede ver los proveedores pero no cambiarlos.'
const MENSAJE_SIN_MIGRACION = 'Los proveedores todavía no están disponibles: falta aplicar la migración de la base.'
const MENSAJE_SIN_PERMISO_CUENTAS = 'Las cuentas bancarias solo las ve el área financiera.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOPE = 3000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/** ¿El error es «la columna o la tabla no existe» (migración sin aplicar)? */
function sinMigracion(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === '42703' || e.code === '42P01' || e.code === 'PGRST204' || e.code === 'PGRST205' || /tipo_proveedor|proveedor_tarifarios|proveedor_cuentas|departamento|tarifa_canal|iva_declarado|tarifario_de_id|tarifario_establecimiento|vigencia_desde|vigencia_por|monedas/.test(e.message ?? ''))
}

async function contexto(escribir: boolean) {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { error: String(error ?? 'No autenticado') }
  if (escribir && role && ROLES_SIN_ESCRITURA.has(role)) return { error: MENSAJE_SIN_ROL }
  const db = supabase as Cliente
  const { data: ws } = await db.from('workspaces').select('name, cotizacion_template_slug').eq('id', workspaceId).maybeSingle()
  if (!tienePropuestaHtml((ws as { cotizacion_template_slug?: string | null } | null)?.cotizacion_template_slug)) {
    return { error: 'Los proveedores son de la propuesta de viaje, que este espacio no tiene.' }
  }
  const usuario = { id: (staffId as string | null) ?? '', role: (role ?? 'read_only') as Role, areas: ((areas ?? []) as Area[]) }
  return {
    db,
    workspaceId: workspaceId as string,
    staffId: (staffId as string | null) ?? null,
    editable: !(role && ROLES_SIN_ESCRITURA.has(role as string)),
    verCuentas: puedeVerCuentasDeProveedor(usuario),
    agencia: ((ws as { name?: string | null } | null)?.name ?? '').trim() || 'la agencia',
  }
}

type Contexto = Exclude<Awaited<ReturnType<typeof contexto>>, { error: string }>

export interface PersonaEquipo {
  id: string
  nombre: string
}

async function equipo(ctx: Contexto): Promise<PersonaEquipo[]> {
  const { data } = await ctx.db.from('staff').select('id, full_name, is_active').eq('workspace_id', ctx.workspaceId).limit(500)
  return ((data ?? []) as { id: string; full_name: string | null; is_active: boolean | null }[])
    .filter((s) => s.is_active !== false)
    .map((s) => ({ id: s.id, nombre: s.full_name?.trim() || 'Sin nombre' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

async function filaDe(ctx: Contexto, id: unknown): Promise<FilaProveedor | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const { data } = await ctx.db.from('fotos_perfiles').select(COLUMNAS_PROVEEDOR).eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  return (data as FilaProveedor | null) ?? null
}

/**
 * Los hoteles y tours que solo tenían fotos (de antes de los perfiles) reciben su fila, para que
 * aparezcan en la lista con su ficha. Lo mismo hace la cotización la próxima vez que los nombra.
 */
async function asegurarFilasDeFotos(ctx: Contexto): Promise<void> {
  if (!ctx.editable) return
  const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
  if (!leidos.ok) return
  const conFila = new Set(leidos.conocidos.perfiles.map((p) => `${p.tipo}:${p.clave}`))
  const faltan = elementosDe(leidos.conocidos.fotos).filter((e) => (e.tipo === 'hotel' || e.tipo === 'actividad') && !conFila.has(`${e.tipo}:${e.clave}`))
  for (const e of faltan.slice(0, 200)) {
    // Uno por uno: si otra pestaña lo creó al mismo tiempo, el índice único frena solo ese.
    await ctx.db.from('fotos_perfiles').insert({ workspace_id: ctx.workspaceId, tipo: e.tipo, clave: e.clave, nombre: e.nombre, ciudad: e.ciudad, created_by: ctx.staffId })
  }
}

// ── Lista ────────────────────────────────────────────────────────────────────

export type ListaProveedores = Resultado<{ proveedores: ProveedorEnLista[]; equipo: PersonaEquipo[]; yo: string | null; editable: boolean; hoy: string }>

export async function leerProveedores(): Promise<ListaProveedores> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  await asegurarFilasDeFotos(ctx)
  const hoy = hoyBogota()
  const [p, t, fotos, personas] = await Promise.all([
    ctx.db.from('fotos_perfiles').select(COLUMNAS_PROVEEDOR).eq('workspace_id', ctx.workspaceId).limit(TOPE),
    ctx.db.from('proveedor_tarifarios').select('proveedor_id, vigente_desde, vigente_hasta').eq('workspace_id', ctx.workspaceId).limit(TOPE * 3),
    leerTodasLasFotos(ctx.db, ctx.workspaceId),
    equipo(ctx),
  ])
  if (p.error || t.error) return { ok: false, error: sinMigracion(p.error ?? t.error) ? MENSAJE_SIN_MIGRACION : 'No se pudieron leer los proveedores.' }
  const porProveedor = new Map<string, VigenciaTarifario[]>()
  for (const r of (t.data ?? []) as FilaTarifario[]) porProveedor.set(r.proveedor_id, [...(porProveedor.get(r.proveedor_id) ?? []), vigenciaDeFila(r)])
  // La miniatura: la primera foto que sale en la propuesta.
  const primera = new Map<string, string>()
  if (fotos.ok) {
    for (const e of elementosDe(fotos.filas)) {
      const f = e.fotos.find((x) => fotoImprimible(e.tipo, x.origen, x.revisada))
      if (f) primera.set(`${e.tipo}:${e.clave}`, f.ref)
    }
  }
  const urls = await enlacesDeCatalogo(ctx.workspaceId, [...primera.values()])
  const proveedores = ((p.data ?? []) as FilaProveedor[])
    .map((f): ProveedorEnLista => {
      const estado = estadoDeProveedor(f, porProveedor, hoy)
      const ref = primera.get(`${f.tipo}:${f.clave}`)
      return {
        id: f.id,
        nombre: f.nombre,
        tipoProveedor: f.tipo_proveedor,
        ciudad: f.ciudad,
        // La ciudad de la ficha (la llave conserva la de cuando nació).
        ciudadClave: f.ciudad ? claveCiudad(f.ciudad) : ciudadDeClave(f.clave),
        destino: f.destino ?? null,
        faltas: faltasDeFicha(f).map((x) => x.texto),
        ciudadEsDepartamento: ciudadDeFichaEsDepartamento(f),
        estrellas: f.estrellas,
        etiquetas: f.etiquetas ?? [],
        responsableId: f.responsable_tarifas_id,
        ...estado,
        miniatura: ref ? urls.get(ref) ?? null : null,
      }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return { ok: true, proveedores, equipo: personas, yo: ctx.staffId, editable: ctx.editable, hoy }
}

// ── Crear ────────────────────────────────────────────────────────────────────

export type ResultadoCrear =
  | { ok: true; id: string; yaExistia: boolean }
  | { ok: true; duda: { id: string | null; nombre: string; ciudad: string | null } }
  | { ok: false; error: string }

/**
 * «Agregar proveedor» con nombre, tipo y ciudad. Un hotel o un tour se reconoce como en la
 * cotización: el mismo con otro nombre abre el que ya está (y guarda el alias); uno que solo se
 * parece pregunta (`forzar` = «es otro, créalo»).
 */
export async function crearProveedor(entrada: { nombre: string; tipoProveedor: string; ciudad: string | null; forzar?: boolean }): Promise<ResultadoCrear> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const nombre = typeof entrada?.nombre === 'string' ? entrada.nombre.trim().replace(/\s+/g, ' ').slice(0, 200) : ''
  const ciudad = typeof entrada?.ciudad === 'string' ? entrada.ciudad.trim().slice(0, 120) || null : null
  if (!nombre) return { ok: false, error: 'Escribe el nombre del proveedor.' }
  if (!esTipoProveedor(entrada.tipoProveedor)) return { ok: false, error: 'Elige qué tipo de proveedor es.' }
  const tipoProveedor: TipoProveedor = entrada.tipoProveedor
  const espacio = espacioDeTipo(tipoProveedor)
  const clave = claveDeProveedor(nombre, ciudad)
  if (!clave) return { ok: false, error: 'Escribe el nombre del proveedor.' }

  const porClave = async (c: string, t: EspacioProveedor) => {
    const { data } = await ctx.db.from('fotos_perfiles').select('id').eq('workspace_id', ctx.workspaceId).eq('tipo', t).eq('clave', c).maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  }

  if (tieneFotos(espacio)) {
    const o = objetivo(espacio, nombre, ciudad)
    if (!o) return { ok: false, error: 'Escribe el nombre del proveedor.' }
    const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
    if (!leidos.ok) return { ok: false, error: leidos.mensaje }
    if (!entrada.forzar) {
      const [mirar] = await resolverPedidos(ctx.db, ctx.workspaceId, ctx.staffId, [o], leidos.conocidos, { escribir: false })
      if (mirar?.duda) {
        const id = await porClave(mirar.duda.clave, espacio)
        return { ok: true, duda: { id, nombre: mirar.duda.nombre, ciudad: mirar.duda.ciudad } }
      }
      if (mirar?.perfil && mirar.perfil.clave !== clave) {
        // El mismo con otro nombre: se guarda el alias y se abre el que ya estaba.
        await resolverPedidos(ctx.db, ctx.workspaceId, ctx.staffId, [o], leidos.conocidos, { escribir: true })
        const id = await porClave(mirar.perfil.clave, espacio)
        if (id) return { ok: true, id, yaExistia: true }
      }
    }
  }
  const ya = await porClave(clave, espacio)
  if (ya) return { ok: true, id: ya, yaExistia: true }
  const { data, error } = await ctx.db
    .from('fotos_perfiles')
    .insert({ workspace_id: ctx.workspaceId, tipo: espacio, clave, nombre, ciudad, tipo_proveedor: tipoProveedor, origen: 'manual', created_by: ctx.staffId, updated_by: ctx.staffId })
    .select('id')
    .maybeSingle()
  if (error || !data) {
    if (error?.code === '23505') {
      const otra = await porClave(clave, espacio)
      if (otra) return { ok: true, id: otra, yaExistia: true }
    }
    return { ok: false, error: sinMigracion(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo crear el proveedor. Vuelve a intentarlo.' }
  }
  return { ok: true, id: (data as { id: string }).id, yaExistia: false }
}

// ── Ficha ────────────────────────────────────────────────────────────────────

export interface FichaProveedor {
  id: string
  espacio: EspacioProveedor
  clave: string
  nombre: string
  tipoProveedor: TipoProveedor
  ciudad: string | null
  pais: string | null
  estrellas: number | null
  web: string | null
  contactoNombre: string | null
  celular: string | null
  celularOriginal: string | null
  correo: string | null
  telefono: string | null
  direccion: string | null
  notas: string | null
  etiquetas: string[]
  tarifasMayorista: boolean
  responsableId: string | null
  compradoViaId: string | null
  origen: FilaProveedor['origen']
  origenRef: string | null
  departamento: string | null
  destino: string | null
  ivaDeclarado: boolean | null
  ivaIncluido: boolean | null
  tarifaCanal: TarifaCanal | null
  tarifasSolicitadasAt: string | null
  /** Lo que le falta para poder cotizar. Vacío = completa (`faltasDeFicha`). */
  faltas: FaltaFicha[]
  /** La nota «Ciudad por confirmar» está en las notas (el botón «Confirmar ciudad» la quita). */
  ciudadPorConfirmar: boolean
  /** La «ciudad» es un departamento colombiano: no se puede confirmar, hay que escribir el municipio. */
  ciudadEsDepartamento: boolean
  tarifarios: TarifarioVista[]
  /** El mayorista por el que se compra, con sus tarifarios (respaldo del aviso de vigencia). */
  via: { id: string; nombre: string; tarifarios: TarifarioVista[] } | null
  semaforo: ReturnType<typeof estadoDeProveedor>
}

export type LecturaFicha = Resultado<{
  ficha: FichaProveedor
  equipo: PersonaEquipo[]
  mayoristas: PersonaEquipo[]
  editable: boolean
  verCuentas: boolean
  yo: string | null
  agencia: string
}>

export async function leerFicha(id: string): Promise<LecturaFicha> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, id)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const hoy = hoyBogota()
  const ids = [f.id, ...(f.comprado_via_id ? [f.comprado_via_id] : [])]
  const [t, personas, m] = await Promise.all([
    ctx.db.from('proveedor_tarifarios').select(COLUMNAS_TARIFARIO).eq('workspace_id', ctx.workspaceId).in('proveedor_id', ids).order('subido_at', { ascending: false }),
    equipo(ctx),
    ctx.db.from('fotos_perfiles').select('id, nombre').eq('workspace_id', ctx.workspaceId).eq('tipo_proveedor', 'mayorista').limit(500),
  ])
  if (t.error) return { ok: false, error: sinMigracion(t.error) ? MENSAJE_SIN_MIGRACION : 'No se pudieron leer los tarifarios.' }
  const nombres = new Map(personas.map((p) => [p.id, p.nombre]))
  const filasT = (t.data ?? []) as FilaTarifario[]
  const propios = filasT.filter((x) => x.proveedor_id === f.id)
  const deVia = filasT.filter((x) => x.proveedor_id === f.comprado_via_id)
  const mayoristas = ((m.data ?? []) as { id: string; nombre: string }[]).filter((x) => x.id !== f.id).map((x) => ({ id: x.id, nombre: x.nombre }))
  const via = f.comprado_via_id ? mayoristas.find((x) => x.id === f.comprado_via_id) ?? null : null
  const porProveedor = new Map<string, VigenciaTarifario[]>([[f.id, propios.map(vigenciaDeFila)], ...(f.comprado_via_id ? [[f.comprado_via_id, deVia.map(vigenciaDeFila)] as [string, VigenciaTarifario[]]] : [])])
  return {
    ok: true,
    editable: ctx.editable,
    verCuentas: ctx.verCuentas,
    yo: ctx.staffId,
    agencia: ctx.agencia,
    equipo: personas,
    mayoristas: mayoristas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    ficha: {
      id: f.id,
      espacio: f.tipo,
      clave: f.clave,
      nombre: f.nombre,
      tipoProveedor: f.tipo_proveedor,
      ciudad: f.ciudad,
      pais: f.pais,
      estrellas: f.estrellas,
      web: f.web,
      contactoNombre: f.contacto_nombre,
      celular: f.celular,
      celularOriginal: f.celular_original,
      correo: f.correo,
      telefono: f.telefono,
      direccion: f.direccion,
      notas: f.notas,
      etiquetas: f.etiquetas ?? [],
      tarifasMayorista: f.tarifas_mayorista,
      responsableId: f.responsable_tarifas_id,
      compradoViaId: f.comprado_via_id,
      origen: f.origen,
      origenRef: f.origen_ref,
      departamento: f.departamento ?? null,
      destino: f.destino ?? null,
      ivaDeclarado: f.iva_declarado ?? null,
      ivaIncluido: f.iva_incluido ?? null,
      tarifaCanal: f.tarifa_canal ?? null,
      tarifasSolicitadasAt: f.tarifas_solicitadas_at ?? null,
      faltas: faltasDeFicha(f),
      ciudadPorConfirmar: tieneNotaCiudadPorConfirmar(f.notas),
      ciudadEsDepartamento: ciudadDeFichaEsDepartamento(f),
      tarifarios: propios.map((x) => tarifarioVista(x, hoy, nombres)),
      via: via ? { ...via, tarifarios: deVia.map((x) => tarifarioVista(x, hoy, nombres)) } : null,
      semaforo: estadoDeProveedor(f, porProveedor, hoy),
    },
  }
}

/**
 * Guarda la sección «Datos». Solo nombre y tipo son obligatorios.
 *
 * Si cambian el nombre o la ciudad, la llave de la ficha NO cambia (de ella cuelgan las fotos): se
 * guarda la llave nueva como alias (`fotos_perfiles_alias`), igual que se hizo por SQL el
 * 2026-10-19, para que la próxima cotización reconozca el hotel con su ciudad nueva en vez de crear
 * otra ficha. Si la llave nueva ya es de OTRA ficha, no se guarda: serían dos fichas del mismo
 * proveedor.
 */
export async function guardarDatos(id: string, entrada: unknown): Promise<Resultado<{ alias?: boolean; aviso?: string }>> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, id)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const r = revisarDatos(entrada)
  if (!r.ok) return r
  const c = r.columnas
  if (c.responsable_tarifas_id && !(await equipo(ctx)).some((p) => p.id === c.responsable_tarifas_id)) {
    return { ok: false, error: 'La persona responsable no está en el equipo.' }
  }
  if (c.comprado_via_id) {
    if (c.comprado_via_id === f.id) return { ok: false, error: 'Un proveedor no se compra a través de sí mismo.' }
    const via = await filaDe(ctx, c.comprado_via_id)
    if (!via || via.tipo_proveedor !== 'mayorista') return { ok: false, error: '«Se compra a través de» tiene que ser un mayorista de la lista.' }
  }
  const alias = aliasPorCambio({ espacio: f.tipo, clave: f.clave }, c.nombre, c.ciudad)
  let aliasNuevo = false
  if (alias) {
    const [{ data: otra }, { data: ya }] = await Promise.all([
      ctx.db.from('fotos_perfiles').select('id, nombre').eq('workspace_id', ctx.workspaceId).eq('tipo', f.tipo).eq('clave', alias.clave).maybeSingle(),
      ctx.db.from('fotos_perfiles_alias').select('id, perfil_id').eq('workspace_id', ctx.workspaceId).eq('tipo', f.tipo).eq('clave', alias.clave).maybeSingle(),
    ])
    const otraFicha = otra as { id: string; nombre: string } | null
    if (otraFicha && otraFicha.id !== f.id) {
      return { ok: false, error: `Ya hay otra ficha, «${otraFicha.nombre}», con ese nombre en esa ciudad. Ábrela desde la lista o cambia el nombre.` }
    }
    const yaAlias = ya as { id: string; perfil_id: string } | null
    if (yaAlias && yaAlias.perfil_id !== f.id) {
      return { ok: false, error: 'Ese nombre en esa ciudad ya es otro nombre de otra ficha. Revisa la lista antes de guardar.' }
    }
    aliasNuevo = !yaAlias
  }
  const { error } = await ctx.db
    .from('fotos_perfiles')
    .update({ ...c, updated_by: ctx.staffId, updated_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', f.id)
  if (error) return { ok: false, error: sinMigracion(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar. Vuelve a intentarlo.' }
  if (alias && aliasNuevo) {
    const { error: e } = await ctx.db
      .from('fotos_perfiles_alias')
      .insert({ workspace_id: ctx.workspaceId, perfil_id: f.id, tipo: f.tipo, clave: alias.clave, nombre: alias.nombre, ciudad: alias.ciudad, created_by: ctx.staffId })
    // 23505: otra pestaña lo guardó al mismo tiempo.
    if (e && e.code !== '23505') return { ok: false, error: 'Los datos se guardaron, pero no el nombre nuevo para las cotizaciones. Vuelve a guardar.' }
  }
  // Se guarda igual (el resto de los datos vale), pero la ficha sigue por clasificar y se dice por qué.
  if (c.ciudad && ciudadDeFichaEsDepartamento(c)) {
    return { ok: true, alias: aliasNuevo, aviso: `Guardado, pero ${textoCiudadEsDepartamento(c.ciudad)}. La ficha sigue por clasificar.` }
  }
  return { ok: true, alias: aliasNuevo }
}

/** «Confirmar ciudad»: quita la nota «Ciudad por confirmar» (la ciudad que está es la buena). */
export async function confirmarCiudad(id: string): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, id)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  if (!f.ciudad?.trim()) return { ok: false, error: 'Primero escribe la ciudad y guarda los datos.' }
  // Confirmar un departamento dejaría la ficha con un departamento por ciudad (no se confía en la pantalla).
  if (ciudadDeFichaEsDepartamento(f)) return { ok: false, error: `${textoCiudadEsDepartamento(f.ciudad)} y guarda los datos.` }
  if (!tieneNotaCiudadPorConfirmar(f.notas)) return { ok: true }
  const { error } = await ctx.db
    .from('fotos_perfiles')
    .update({ notas: quitarNotaCiudadPorConfirmar(f.notas), updated_by: ctx.staffId, updated_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', f.id)
  return error ? { ok: false, error: 'No se pudo guardar. Vuelve a intentarlo.' } : { ok: true }
}

/** «Ya la pedí»: anota cuándo y quién le pidió las tarifas al proveedor. */
export async function marcarTarifasPedidas(id: string): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, id)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const { error } = await ctx.db
    .from('fotos_perfiles')
    .update({ tarifas_solicitadas_at: new Date().toISOString(), tarifas_solicitadas_por: ctx.staffId })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', f.id)
  return error ? { ok: false, error: sinMigracion(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar. Vuelve a intentarlo.' } : { ok: true }
}

// ── Archivos (tarifarios y certificados) ─────────────────────────────────────

/**
 * Prepara la subida directa de UN archivo (PDF o imagen) del proveedor. Los certificados bancarios
 * solo con permiso financiero.
 */
export async function pedirSubida(proveedorId: string, clase: ClaseArchivo, mime: string, bytes: number): Promise<Resultado<{ ruta: string; token: string }>> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (clase !== 'tarifarios' && clase !== 'cuentas') return { ok: false, error: 'No se sabe qué archivo es.' }
  if (clase === 'cuentas' && !ctx.verCuentas) return { ok: false, error: MENSAJE_SIN_PERMISO_CUENTAS }
  const f = await filaDe(ctx, proveedorId)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const ext = extensionDeMime(mime)
  if (!ext) return { ok: false, error: 'Sube un PDF o una imagen (JPG, PNG).' }
  if (typeof bytes !== 'number' || bytes <= 0 || bytes > BYTES_MAXIMOS_ARCHIVO) return { ok: false, error: 'El archivo pesa más de 20 MB.' }
  return urlDeSubida(ctx.workspaceId, f.id, clase, ext)
}

/**
 * Registra el tarifario recién subido con su vigencia (en un solo paso). Con `tarifarioId`, le pone
 * el archivo a uno que estaba registrado sin él (los importados de Airtable).
 */
export async function registrarTarifario(
  proveedorId: string,
  entrada: { ruta: string; nombreArchivo: string; desde?: string | null; hasta?: string | null; temporada?: string | null; notas?: string | null; tarifarioId?: string | null },
): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, proveedorId)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const vig = revisarVigencia(entrada)
  if (!vig.ok) return vig
  const archivo = await confirmarSubida(ctx.workspaceId, f.id, 'tarifarios', entrada?.ruta)
  if (!archivo.ok) return archivo
  const nombreArchivo = typeof entrada.nombreArchivo === 'string' && entrada.nombreArchivo.trim() ? entrada.nombreArchivo.trim().slice(0, 300) : 'Tarifario'
  const datos = {
    ref: archivo.ref,
    nombre_archivo: nombreArchivo,
    bytes: archivo.bytes,
    mime: archivo.mime,
    vigente_desde: vig.desde,
    vigente_hasta: vig.hasta,
    vigencia_inferida: false,
    temporada: vig.temporada,
    notas: vig.notas,
    subido_por: ctx.staffId,
    subido_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const { error } = typeof entrada.tarifarioId === 'string' && UUID.test(entrada.tarifarioId)
    ? await ctx.db.from('proveedor_tarifarios').update(datos).eq('workspace_id', ctx.workspaceId).eq('proveedor_id', f.id).eq('id', entrada.tarifarioId)
    : await ctx.db.from('proveedor_tarifarios').insert({ ...datos, workspace_id: ctx.workspaceId, proveedor_id: f.id, origen: 'manual' })
  if (error) {
    await borrarArchivo(ctx.workspaceId, f.id, 'tarifarios', archivo.ref)
    return { ok: false, error: sinMigracion(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar el tarifario. Vuelve a intentarlo.' }
  }
  return { ok: true }
}

async function tarifarioDe(ctx: Contexto, id: unknown): Promise<FilaTarifario | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const { data } = await ctx.db.from('proveedor_tarifarios').select(COLUMNAS_TARIFARIO).eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  return (data as FilaTarifario | null) ?? null
}

/** Corrige desde, hasta, temporada o notas (la vigencia deja de ser «inferida»). */
export async function editarTarifario(id: string, entrada: unknown): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const t = await tarifarioDe(ctx, id)
  if (!t) return { ok: false, error: 'Ese tarifario ya no está. Recarga.' }
  const vig = revisarVigencia(entrada)
  if (!vig.ok) return vig
  const { error } = await ctx.db
    .from('proveedor_tarifarios')
    .update({ vigente_desde: vig.desde, vigente_hasta: vig.hasta, temporada: vig.temporada, notas: vig.notas, vigencia_inferida: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', t.id)
  return error ? { ok: false, error: 'No se pudo guardar. Vuelve a intentarlo.' } : { ok: true }
}

export async function borrarTarifario(id: string): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const t = await tarifarioDe(ctx, id)
  if (!t) return { ok: true }
  const { error } = await ctx.db.from('proveedor_tarifarios').delete().eq('workspace_id', ctx.workspaceId).eq('id', t.id)
  if (error) return { ok: false, error: 'No se pudo quitar. Vuelve a intentarlo.' }
  await borrarArchivo(ctx.workspaceId, t.proveedor_id, 'tarifarios', t.ref)
  return { ok: true }
}

/** Un enlace firmado de 5 minutos para abrir el tarifario. */
export async function abrirTarifario(id: string): Promise<Resultado<{ url: string }>> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const t = await tarifarioDe(ctx, id)
  if (!t?.ref) return { ok: false, error: 'Ese tarifario no tiene archivo todavía.' }
  const url = await enlaceDeArchivo(ctx.workspaceId, t.proveedor_id, 'tarifarios', t.ref)
  return url ? { ok: true, url } : { ok: false, error: 'No se pudo abrir el archivo. Vuelve a intentarlo.' }
}

// ── Extracciones del motor de tarifarios (server-only) ───────────────────────

/** Una fila del tarifario como la ve la revisión (sin citas ni notas: solo lo que se decide). */
export interface FilaExtraccionVista {
  i: number
  establecimiento: string | null
  categoria: string | null
  temporada: string | null
  plan: string | null
  ocupacion: string | null
  pasajero: string | null
  pax: string | null
  base: string | null
  precio: number | null
  /** La moneda que propuso el motor para la fila (o la del tarifario). */
  monedaMotor: string | null
}

export interface ExtraccionVista {
  id: string
  creadaAt: string
  creadaPor: string | null
  modelo: string | null
  instruccion: string | null
  esquema: string
  archivos: string[]
  resumen: ResumenExtraccion
  /** Lo que la extracción le propone a la ficha y la ficha todavía no sabe. */
  sugerencias: ReturnType<typeof sugerenciasParaFicha>
  /** `borrador` = la carga no se ha cerrado; `revisada` = cerrada, cuenta para cotizar. */
  estado: 'borrador' | 'revisada'
  /** La vigencia que confirmó la persona (o tomó del motor) al cerrar la carga. */
  vigenciaConfirmada: { desde: string; hasta: string; por: 'motor' | 'persona' } | null
  /** La carga no se cierra sin que la persona escriba la vigencia. */
  vigenciaPorConfirmar: boolean
  monedas: AjustesMoneda
  filas: FilaExtraccionVista[]
  /** La ficha dueña de la extracción cuando esta ficha toma el tarifario de otra (cadena). */
  deOtraFicha: { id: string; nombre: string } | null
}

export interface UsoTarifario {
  /** La ficha de la que esta toma el tarifario (cadena). `null` = el suyo. */
  tarifarioDe: { id: string; nombre: string } | null
  /** El establecimiento del tarifario que es esta ficha. */
  establecimiento: string | null
  /** Las otras fichas del espacio con extracción: de cuál puede tomar el tarifario. */
  fichasConExtraccion: { id: string; nombre: string }[]
  /**
   * ¿Con lo cargado y lo elegido, esta ficha tiene tarifas para cotizar? Se mide sobre la ÚLTIMA
   * extracción revisada (punto 5 del 2026-10-19): un borrador posterior no le quita los precios.
   */
  cotiza: { ok: true; tarifas: number } | { ok: false; motivo: string }
  /**
   * Hay una extracción más nueva que la revisada, sin revisar: la cotización sigue con la revisada
   * hasta que se cierre la carga de la nueva. `revisadaAt` = de cuándo es la que cuenta (`null` sin ninguna).
   */
  nuevaPorRevisar?: { revisadaAt: string | null } | null
}

type FilaExtraccion = {
  id: string
  proveedor_id: string
  created_at: string
  creada_por: string | null
  modelo: string | null
  instruccion_version: string | null
  esquema_version: string
  archivos: string[] | null
  expediente: Record<string, unknown>
  tarifario: Record<string, unknown> | null
  estado: 'borrador' | 'revisada' | 'descartada'
  vigencia_desde?: string | null
  vigencia_hasta?: string | null
  vigencia_por?: 'motor' | 'persona' | null
  monedas?: AjustesMoneda | null
}

const MAX_FILAS_VISTA = 3000

/** Lo nuevo de la ficha (cadena) leído aparte: sin la migración del motor v13 viene vacío. */
async function usoDeFicha(ctx: Contexto, id: string): Promise<{ tarifarioDeId: string | null; establecimiento: string | null }> {
  const { data } = await ctx.db.from('fotos_perfiles').select('*').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  const d = (data ?? {}) as { tarifario_de_id?: string | null; tarifario_establecimiento?: string | null }
  return { tarifarioDeId: d.tarifario_de_id ?? null, establecimiento: d.tarifario_establecimiento ?? null }
}

/** La última extracción no descartada de un proveedor (cliente de servicio, SIEMPRE por workspace). */
async function ultimaExtraccion(servicio: Cliente, workspaceId: string, proveedorId: string): Promise<{ fila: FilaExtraccion | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await servicio
    .from('proveedor_extracciones')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('proveedor_id', proveedorId)
    .neq('estado', 'descartada')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return { fila: (data as FilaExtraccion | null) ?? null, error }
}

const textoDe = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null)

function filasVista(tarifario: Record<string, unknown> | null): FilaExtraccionVista[] {
  const tarifas = Array.isArray(tarifario?.tarifas) ? (tarifario.tarifas as unknown[]) : []
  const monedaT = textoDe(tarifario?.moneda)
  return tarifas.slice(0, MAX_FILAS_VISTA).map((x, i) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const min = typeof r.pax_min === 'number' ? r.pax_min : null
    const max = typeof r.pax_max === 'number' ? r.pax_max : null
    return {
      i,
      establecimiento: textoDe(r.establecimiento),
      categoria: textoDe(r.categoria),
      temporada: textoDe(r.temporada_id),
      plan: textoDe(r.plan),
      ocupacion: textoDe(r.ocupacion),
      pasajero: textoDe(r.tipo_pasajero),
      pax: min === null && max === null ? null : min === max ? `${min}` : `${min ?? 1}–${max ?? '…'}`,
      base: textoDe(r.base_precio),
      precio: typeof r.precio === 'number' && Number.isFinite(r.precio) ? r.precio : null,
      monedaMotor: textoDe(r.moneda) ?? monedaT,
    }
  })
}

/**
 * La extracción del motor que usa esta ficha, resumida, con su carga (vigencia y monedas) y lo que
 * la ficha eligió del tarifario de cadena. La tabla es server-only (el JSON puede citar datos de los
 * PDF): se lee con el cliente de servicio y SIEMPRE filtrando por workspace. Sin la migración,
 * `null`.
 */
export async function leerExtraccion(proveedorId: string): Promise<Resultado<{ extraccion: ExtraccionVista | null; uso: UsoTarifario | null }>> {
  const ctx = await contexto(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, proveedorId)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const servicio = createServiceClient() as Cliente
  const uso = await usoDeFicha(ctx, f.id)
  const fuenteId = uso.tarifarioDeId ?? f.id
  const [ultima, conExtraccion, paraCotizar] = await Promise.all([
    ultimaExtraccion(servicio, ctx.workspaceId, fuenteId),
    servicio.from('proveedor_extracciones').select('proveedor_id').eq('workspace_id', ctx.workspaceId).neq('estado', 'descartada').limit(TOPE),
    extraccionParaCotizar(servicio, ctx.workspaceId, fuenteId),
  ])
  if (ultima.error) return sinMigracion(ultima.error) ? { ok: true, extraccion: null, uso: null } : { ok: false, error: 'No se pudo leer la extracción.' }
  const idsConExtraccion = [...new Set(((conExtraccion.data ?? []) as { proveedor_id: string }[]).map((r) => r.proveedor_id))].filter((id) => id !== f.id)
  const nombresFichas = new Map<string, string>()
  const pedir = [...new Set([...idsConExtraccion, ...(uso.tarifarioDeId ? [uso.tarifarioDeId] : [])])]
  if (pedir.length > 0) {
    const { data } = await ctx.db.from('fotos_perfiles').select('id, nombre').eq('workspace_id', ctx.workspaceId).in('id', pedir.slice(0, 300))
    for (const r of (data ?? []) as { id: string; nombre: string }[]) nombresFichas.set(r.id, r.nombre)
  }
  const tarifarioDe = uso.tarifarioDeId ? { id: uso.tarifarioDeId, nombre: nombresFichas.get(uso.tarifarioDeId) ?? 'Otra ficha' } : null
  const fichasConExtraccion = idsConExtraccion
    .filter((id) => nombresFichas.has(id))
    .map((id) => ({ id, nombre: nombresFichas.get(id) as string }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const x = ultima.fila
  if (!x) {
    return { ok: true, extraccion: null, uso: { tarifarioDe, establecimiento: uso.establecimiento, fichasConExtraccion, cotiza: { ok: false, motivo: 'Todavía no hay una extracción del tarifario.' } } }
  }
  const resumen = resumenExtraccion({ expediente: x.expediente ?? {}, tarifario: x.tarifario })
  const sug = sugerenciasParaFicha(resumen)
  const personas = await equipo(ctx)
  const monedas = (x.monedas ?? {}) as AjustesMoneda
  const confirmada = x.vigencia_desde && x.vigencia_hasta && x.vigencia_por ? { desde: x.vigencia_desde, hasta: x.vigencia_hasta, por: x.vigencia_por } : null
  // Punto 5 (2026-10-19): para cotizar cuenta la última REVISADA, no la última corrida. Un borrador
  // más nuevo se muestra para revisar, pero no le quita los precios a la cotización.
  const r = paraCotizar.revisada
  const usables = r
    ? tarifasParaCotizar({ estado: 'revisada', vigenciaDesde: r.vigencia_desde ?? null, vigenciaHasta: r.vigencia_hasta ?? null, tarifario: r.tarifario, monedas: (r.monedas ?? {}) as AjustesMoneda }, uso.establecimiento)
    : tarifasParaCotizar({ estado: x.estado, vigenciaDesde: x.vigencia_desde ?? null, vigenciaHasta: x.vigencia_hasta ?? null, tarifario: x.tarifario, monedas }, uso.establecimiento)
  return {
    ok: true,
    uso: {
      tarifarioDe,
      establecimiento: uso.establecimiento,
      fichasConExtraccion,
      cotiza: usables.ok ? { ok: true, tarifas: usables.tarifas.length } : { ok: false, motivo: TEXTO_NO_COTIZA[usables.motivo] },
      nuevaPorRevisar: paraCotizar.nuevaPorRevisar && r ? { revisadaAt: r.created_at } : null,
    },
    extraccion: {
      id: x.id,
      creadaAt: x.created_at,
      creadaPor: x.creada_por ? personas.find((p) => p.id === x.creada_por)?.nombre ?? null : null,
      modelo: x.modelo,
      instruccion: x.instruccion_version,
      esquema: x.esquema_version,
      archivos: x.archivos ?? [],
      resumen,
      sugerencias: {
        tarifaCanal: f.tarifa_canal ? null : sug.tarifaCanal,
        ivaDeclarado: f.iva_declarado !== null && f.iva_declarado !== undefined ? null : sug.ivaDeclarado,
        ivaIncluido: f.iva_incluido !== null && f.iva_incluido !== undefined ? null : sug.ivaIncluido,
      },
      estado: x.estado === 'revisada' ? 'revisada' : 'borrador',
      vigenciaConfirmada: confirmada,
      vigenciaPorConfirmar: vigenciaPorConfirmar(x.tarifario),
      monedas,
      filas: filasVista(x.tarifario),
      deOtraFicha: tarifarioDe,
    },
  }
}

/** Guarda una extracción ya revisada (subida a mano o del motor), en borrador: falta cerrar la carga. */
async function insertarExtraccion(ctx: Contexto, proveedorId: string, e: ExtraccionRevisada, meta: { modelo: string | null; instruccion: string | null }): Promise<Resultado> {
  const corto = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  const servicio = createServiceClient() as Cliente
  const { error } = await servicio.from('proveedor_extracciones').insert({
    workspace_id: ctx.workspaceId,
    proveedor_id: proveedorId,
    esquema_version: e.esquemaVersion,
    instruccion_version: corto(meta.instruccion, 40),
    modelo: corto(meta.modelo, 120),
    expediente: e.expediente,
    tarifario: e.tarifario,
    datos_ficha: e.datosFicha,
    archivos: e.archivos,
    creada_por: ctx.staffId,
  })
  if (error) return { ok: false, error: sinMigracion(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar la extracción. Vuelve a intentarlo.' }
  return { ok: true }
}

/**
 * Guarda una extracción del motor subida a mano (el JSON, esquema 0.2 o 0.3) en la ficha. Se
 * revisa con los chequeos de la torre; el contenido se guarda tal cual, una fila por corrida.
 */
export async function guardarExtraccion(proveedorId: string, json: string, meta?: { modelo?: string | null; instruccion?: string | null }): Promise<Resultado<{ avisos: string[] }>> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, proveedorId)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const r = revisarExtraccion(json, { hoy: hoyBogota() })
  if (!r.ok) return { ok: false, error: r.error }
  const g = await insertarExtraccion(ctx, f.id, r.extraccion, { modelo: meta?.modelo ?? null, instruccion: meta?.instruccion ?? null })
  return g.ok ? { ok: true, avisos: r.extraccion.avisos } : g
}

/**
 * «Extraer con el motor» (punto 6): manda TODOS los tarifarios con archivo de este proveedor (los
 * certificados bancarios viven en otra tabla y otra carpeta: no viajan) con la instrucción vigente
 * al modelo del gateway, revisa la salida con `revisarExtraccion` y la guarda con el modelo y la
 * versión de la instrucción. Queda en borrador: la carga se cierra al confirmar vigencia y moneda.
 */
export async function extraerTarifario(proveedorId: string): Promise<Resultado<{ avisos: string[] }>> {
  // Cualquier excepción vuelve como mensaje: una acción que revienta llega a la pantalla sin texto.
  try {
    return await extraerTarifarioSinCapturar(proveedorId)
  } catch (e) {
    console.error('[motor-extraccion] la extracción falló:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'La extracción no se pudo completar. Vuelve a intentarlo en un rato.' }
  }
}

async function extraerTarifarioSinCapturar(proveedorId: string): Promise<Resultado<{ avisos: string[] }>> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, proveedorId)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const { data, error } = await ctx.db
    .from('proveedor_tarifarios')
    .select('id, ref, nombre_archivo, mime')
    .eq('workspace_id', ctx.workspaceId)
    .eq('proveedor_id', f.id)
    .order('subido_at', { ascending: true })
    .limit(200)
  if (error) return { ok: false, error: sinMigracion(error) ? MENSAJE_SIN_MIGRACION : 'No se pudieron leer los tarifarios.' }
  // Los registrados sin archivo (importados de Airtable) no tienen nada que leer.
  const filas = ((data ?? []) as { id: string; ref: string | null; nombre_archivo: string | null; mime: string | null }[]).filter((t): t is { id: string; ref: string; nombre_archivo: string | null; mime: string | null } => !!t.ref).slice(0, 40)
  const archivos: ArchivoParaMotor[] = []
  for (const [i, t] of filas.entries()) {
    const bajado = await descargarArchivo(ctx.workspaceId, f.id, 'tarifarios', t.ref)
    if (!bajado) return { ok: false, error: `No se pudo leer el archivo «${t.nombre_archivo ?? 'tarifario'}». Vuelve a intentarlo.` }
    const mime = t.mime ?? bajado.mime ?? (t.ref.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
    archivos.push({ nombre: `tar${i}_${t.nombre_archivo ?? 'tarifario'}`, mime, datos: bajado.datos })
  }
  const hoy = hoyBogota()
  const r = await correrMotor({ archivos, instruccion: instruccionVigente(hoy), hoy })
  if (!r.ok) return { ok: false, error: r.error }
  const g = await insertarExtraccion(ctx, f.id, r.extraccion, { modelo: r.modelo, instruccion: INSTRUCCION_VERSION })
  return g.ok ? { ok: true, avisos: r.extraccion.avisos } : g
}

/**
 * Cierra la carga de una extracción (puntos 7 y 8): la vigencia confirmada (obligatoria si el motor
 * no la fijó o la marcó para confirmar; nunca del nombre del archivo ni de la fecha de carga) y los
 * cambios de moneda. Desde aquí cuenta para cotizar. Se puede volver a guardar para corregir.
 */
export async function cerrarCargaExtraccion(extraccionId: string, entrada: { desde?: string | null; hasta?: string | null; monedas?: unknown }): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!ctx.staffId) return { ok: false, error: 'Tu usuario no está en el equipo de este espacio: no puede cerrar la carga.' }
  if (typeof extraccionId !== 'string' || !UUID.test(extraccionId)) return { ok: false, error: 'Esa extracción ya no está. Recarga.' }
  const servicio = createServiceClient() as Cliente
  const { data, error } = await servicio
    .from('proveedor_extracciones')
    .select('id, proveedor_id, tarifario, estado')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', extraccionId)
    .maybeSingle()
  if (error) return { ok: false, error: sinMigracion(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo leer la extracción.' }
  const x = data as { id: string; tarifario: Record<string, unknown> | null; estado: string } | null
  if (!x || x.estado === 'descartada') return { ok: false, error: 'Esa extracción ya no está. Recarga.' }
  const vig = vigenciaParaCerrar(x.tarifario, { desde: entrada?.desde, hasta: entrada?.hasta })
  if (!vig.ok) return vig
  const mon = revisarAjustesMoneda(entrada?.monedas, x.tarifario)
  if (!mon.ok) return mon
  const ahora = new Date().toISOString()
  const { error: e2 } = await servicio
    .from('proveedor_extracciones')
    .update({ estado: 'revisada', vigencia_desde: vig.desde, vigencia_hasta: vig.hasta, vigencia_por: vig.por, monedas: mon.ajustes, revisada_por: ctx.staffId, revisada_at: ahora })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', x.id)
  if (e2) return { ok: false, error: sinMigracion(e2) ? MENSAJE_SIN_MIGRACION : 'No se pudo cerrar la carga. Vuelve a intentarlo.' }
  return { ok: true }
}

/**
 * El tarifario de cadena (2026-10-19): de qué ficha toma esta el tarifario (`null` = el suyo) y qué
 * establecimiento del tarifario es ella. Solo esas filas cuentan para cotizarla.
 */
export async function elegirTarifarioDeFicha(proveedorId: string, entrada: { tarifarioDeId?: string | null; establecimiento?: string | null }): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, proveedorId)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const deId = typeof entrada?.tarifarioDeId === 'string' && entrada.tarifarioDeId ? entrada.tarifarioDeId : null
  if (deId !== null) {
    if (deId === f.id) return { ok: false, error: 'Una ficha no puede tomar el tarifario de sí misma.' }
    if (!(await filaDe(ctx, deId))) return { ok: false, error: 'Esa ficha no está en este espacio.' }
  }
  const establecimiento = typeof entrada?.establecimiento === 'string' && entrada.establecimiento.trim() ? entrada.establecimiento.trim().slice(0, 200) : null
  if (establecimiento) {
    const ultima = await ultimaExtraccion(createServiceClient() as Cliente, ctx.workspaceId, deId ?? f.id)
    const ests = establecimientosDe(ultima.fila?.tarifario ?? null)
    if (!ests.some((e) => llaveEstablecimiento(e) === llaveEstablecimiento(establecimiento))) return { ok: false, error: `«${establecimiento}» no es un establecimiento de ese tarifario.` }
  }
  const { error } = await ctx.db
    .from('fotos_perfiles')
    .update({ tarifario_de_id: deId, tarifario_establecimiento: establecimiento, updated_by: ctx.staffId, updated_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', f.id)
  return error ? { ok: false, error: sinMigracion(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar. Vuelve a intentarlo.' } : { ok: true }
}

/**
 * «Usar en la ficha»: pasa a la ficha lo que la última extracción dice del canal y del IVA, solo en
 * lo que la ficha todavía no sabe (nunca pisa lo que una persona anotó).
 */
export async function usarSugerenciasDeExtraccion(proveedorId: string): Promise<Resultado> {
  const ctx = await contexto(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const r = await leerExtraccion(proveedorId)
  if (!r.ok) return r
  const s = r.extraccion?.sugerencias
  if (!s) return { ok: false, error: 'Este proveedor no tiene extracción del motor.' }
  const patch: Record<string, unknown> = {}
  if (s.tarifaCanal) patch.tarifa_canal = s.tarifaCanal
  if (s.ivaDeclarado !== null) patch.iva_declarado = s.ivaDeclarado
  if (s.ivaIncluido !== null) patch.iva_incluido = s.ivaIncluido
  if (Object.keys(patch).length === 0) return { ok: true }
  const { error } = await ctx.db
    .from('fotos_perfiles')
    .update({ ...patch, updated_by: ctx.staffId, updated_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', proveedorId)
  return error ? { ok: false, error: 'No se pudo guardar. Vuelve a intentarlo.' } : { ok: true }
}

// ── Cuentas bancarias (server-only) ──────────────────────────────────────────

export interface CuentaVista {
  id: string
  banco: string
  tipoCuenta: 'ahorros' | 'corriente' | 'otra'
  numero: string
  titular: string
  titularDocumento: string | null
  tieneCertificado: boolean
  estado: 'pendiente' | 'verificada'
  cargadaPorId: string
  cargadaPor: string
  cargadaAt: string
  verificadaPor: string | null
  verificadaAt: string | null
  historial: { evento: string; por: string | null; at: string; numeroAntes: string | null }[]
}

interface FilaCuenta {
  id: string
  proveedor_id: string
  banco: string
  tipo_cuenta: CuentaVista['tipoCuenta']
  numero: string
  titular: string
  titular_documento: string | null
  certificado_ref: string | null
  estado: CuentaVista['estado']
  cargada_por: string
  cargada_at: string
  verificada_por: string | null
  verificada_at: string | null
  retirada_at: string | null
}

const COLUMNAS_CUENTA = 'id, proveedor_id, banco, tipo_cuenta, numero, titular, titular_documento, certificado_ref, estado, cargada_por, cargada_at, verificada_por, verificada_at, retirada_at'

async function contextoCuentas(escribir: boolean): Promise<{ error: string } | (Contexto & { servicio: Cliente })> {
  const ctx = await contexto(escribir)
  if ('error' in ctx) return { error: ctx.error as string }
  if (!ctx.verCuentas) return { error: MENSAJE_SIN_PERMISO_CUENTAS }
  // server-only: la tabla no tiene grants para la sesión. Filtrar SIEMPRE por workspace.
  return { ...ctx, servicio: createServiceClient() as Cliente }
}

async function cuentaDe(ctx: Contexto & { servicio: Cliente }, id: unknown): Promise<FilaCuenta | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const { data } = await ctx.servicio.from('proveedor_cuentas').select(COLUMNAS_CUENTA).eq('workspace_id', ctx.workspaceId).eq('id', id).is('retirada_at', null).maybeSingle()
  return (data as FilaCuenta | null) ?? null
}

export async function leerCuentas(proveedorId: string): Promise<Resultado<{ cuentas: CuentaVista[] }>> {
  const ctx = await contextoCuentas(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const f = await filaDe(ctx, proveedorId)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const [c, h, personas] = await Promise.all([
    ctx.servicio.from('proveedor_cuentas').select(COLUMNAS_CUENTA).eq('workspace_id', ctx.workspaceId).eq('proveedor_id', f.id).is('retirada_at', null).order('cargada_at', { ascending: false }),
    ctx.servicio.from('proveedor_cuentas_historial').select('cuenta_id, evento, por, created_at, antes').eq('workspace_id', ctx.workspaceId).eq('proveedor_id', f.id).order('created_at', { ascending: false }).limit(200),
    equipo(ctx),
  ])
  if (c.error) return { ok: false, error: sinMigracion(c.error) ? MENSAJE_SIN_MIGRACION : 'No se pudieron leer las cuentas.' }
  const nombre = (id: string | null) => (id ? personas.find((p) => p.id === id)?.nombre ?? 'Alguien que ya no está' : null)
  const historial = (h.data ?? []) as { cuenta_id: string; evento: string; por: string | null; created_at: string; antes: { numero?: string } | null }[]
  const cuentas = ((c.data ?? []) as FilaCuenta[]).map((x) => ({
    id: x.id,
    banco: x.banco,
    tipoCuenta: x.tipo_cuenta,
    numero: x.numero,
    titular: x.titular,
    titularDocumento: x.titular_documento,
    tieneCertificado: !!x.certificado_ref,
    estado: x.estado,
    cargadaPorId: x.cargada_por,
    cargadaPor: nombre(x.cargada_por) ?? '',
    cargadaAt: x.cargada_at,
    verificadaPor: nombre(x.verificada_por),
    verificadaAt: x.verificada_at,
    historial: historial.filter((r) => r.cuenta_id === x.id).map((r) => ({ evento: r.evento, por: nombre(r.por), at: r.created_at, numeroAntes: r.antes?.numero ?? null })),
  }))
  return { ok: true, cuentas }
}

/**
 * Carga una cuenta o la cambia. Un cambio la devuelve a «pendiente» (la base lo hace) y quien la
 * cambió pasa a ser quien la cargó: la tiene que verificar otra persona.
 */
export async function guardarCuenta(proveedorId: string, cuentaId: string | null, entrada: unknown, rutaCertificado?: string | null): Promise<Resultado> {
  const ctx = await contextoCuentas(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!ctx.staffId) return { ok: false, error: 'No se pudo saber quién eres en el equipo. Vuelve a entrar.' }
  const f = await filaDe(ctx, proveedorId)
  if (!f) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const r = revisarCuenta(entrada)
  if (!r.ok) return r
  let certificado: string | undefined
  if (rutaCertificado) {
    const a = await confirmarSubida(ctx.workspaceId, f.id, 'cuentas', rutaCertificado)
    if (!a.ok) return a
    certificado = a.ref
  }
  if (cuentaId) {
    const actual = await cuentaDe(ctx, cuentaId)
    if (!actual || actual.proveedor_id !== f.id) return { ok: false, error: 'Esa cuenta ya no está. Recarga.' }
    const { error } = await ctx.servicio
      .from('proveedor_cuentas')
      .update({ ...r.cuenta, ...(certificado ? { certificado_ref: certificado } : {}), cargada_por: ctx.staffId })
      .eq('workspace_id', ctx.workspaceId)
      .eq('id', actual.id)
    if (error) {
      // Sin cambio de datos, la base no deja que cambie quien la cargó: se guarda igual sin tocarlo.
      if (error.code === '23514' && /solo cambia/.test(error.message ?? '')) return { ok: true }
      return { ok: false, error: 'No se pudo guardar la cuenta. Vuelve a intentarlo.' }
    }
    // El certificado anterior no se borra: su referencia queda en el historial del cambio.
    return { ok: true }
  }
  const { error } = await ctx.servicio
    .from('proveedor_cuentas')
    .insert({ ...r.cuenta, certificado_ref: certificado ?? null, workspace_id: ctx.workspaceId, proveedor_id: f.id, cargada_por: ctx.staffId })
  return error ? { ok: false, error: sinMigracion(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar la cuenta. Vuelve a intentarlo.' } : { ok: true }
}

/** Verificar: solo una persona DISTINTA de quien la cargó. */
export async function verificarCuenta(cuentaId: string): Promise<Resultado> {
  const ctx = await contextoCuentas(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!ctx.staffId) return { ok: false, error: 'No se pudo saber quién eres en el equipo. Vuelve a entrar.' }
  const c = await cuentaDe(ctx, cuentaId)
  if (!c) return { ok: false, error: 'Esa cuenta ya no está. Recarga.' }
  if (c.estado === 'verificada') return { ok: true }
  if (c.cargada_por === ctx.staffId) return { ok: false, error: 'La tiene que verificar otra persona: tú la cargaste.' }
  const { error } = await ctx.servicio
    .from('proveedor_cuentas')
    .update({ estado: 'verificada', verificada_por: ctx.staffId, verificada_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', c.id)
    .eq('estado', 'pendiente')
  return error ? { ok: false, error: 'No se pudo verificar. Vuelve a intentarlo.' } : { ok: true }
}

/** Retirarla: deja de usarse y queda en el historial (no se borra). */
export async function retirarCuenta(cuentaId: string): Promise<Resultado> {
  const ctx = await contextoCuentas(true)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!ctx.staffId) return { ok: false, error: 'No se pudo saber quién eres en el equipo. Vuelve a entrar.' }
  const c = await cuentaDe(ctx, cuentaId)
  if (!c) return { ok: true }
  const { error } = await ctx.servicio
    .from('proveedor_cuentas')
    .update({ retirada_por: ctx.staffId, retirada_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', c.id)
  return error ? { ok: false, error: 'No se pudo retirar. Vuelve a intentarlo.' } : { ok: true }
}

export async function abrirCertificado(cuentaId: string): Promise<Resultado<{ url: string }>> {
  const ctx = await contextoCuentas(false)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const c = await cuentaDe(ctx, cuentaId)
  if (!c) return { ok: false, error: 'Esa cuenta ya no está. Recarga.' }
  const url = c.certificado_ref ? await enlaceDeArchivo(ctx.workspaceId, c.proveedor_id, 'cuentas', c.certificado_ref) : null
  return url ? { ok: true, url } : { ok: false, error: 'Esta cuenta no tiene certificado.' }
}
