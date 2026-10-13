/**
 * El plan del espacio de pruebas: qué se escribe para clonar la configuración de un workspace
 * en otro, sembrar los casos de prueba y dar acceso; y cómo se borra todo después.
 *
 * Se arma LEYENDO (nunca escribe) y se ejecuta aparte (`ejecutar`), así el simulacro y la
 * escritura recorren exactamente el mismo plan. Lo que se copia y lo que no, con su motivo,
 * vive en `clasificacion.ts`.
 *
 * ## Los ids
 *
 * Cada fila copiada recibe un id nuevo generado aquí, y TODO string que sea un id de la
 * cliente se cambia por el suyo (`remapear`), en columnas y dentro de los jsonb por igual.
 * El staff y los perfiles de la cliente no se copian: sus ids se cambian por los del usuario
 * dueño de prueba, que es quien queda como aprobador, autorizador y responsable.
 *
 * ## Las guardas
 *
 *  · El destino nunca es el origen, y un workspace ya existente solo se toca si nació de aquí
 *    (`config_extra.espacio_de_pruebas = true` y `clon_de = <origen>`).
 *  · Un alias que ya es de otro workspace no se mueve.
 *  · `--apply` se niega con tablas sin clasificar que tengan filas de la cliente.
 */

import type { Almacen, Fila, Filtro } from './almacen'
import {
  CLAVES_WORKSPACE_QUE_SE_COPIAN,
  CLAVES_WORKSPACE_QUE_SE_DESCARTAN,
  LLAVE_DE_CREDENCIAL,
  clasificarTabla,
  modulosParaPruebas,
} from './clasificacion'
import { pareceDatoPersonal, remapear, sinLlaves, uuidsEn } from './jsonb'
import { MARCA_SEMILLA, SEMILLAS, filasDeSemilla, type EntradaCaso } from './semillas'

export interface UsuarioDePrueba {
  correo: string
  nombre: string
  role: 'owner' | 'operator'
  rolPlataforma: 'dueno' | 'ejecutor'
  cargo: string
  areas: string[]
}

/** Los dos accesos: la dueña autoriza bajo el mínimo (P6, V3) y la asesora arma el viaje. */
export function usuariosDePrueba(correoBase: string, destino: string): UsuarioDePrueba[] {
  const [local, dominio] = correoBase.split('@')
  if (!local || !dominio) throw new Error(`Correo base inválido: ${correoBase}`)
  const alias = (sufijo: string) => `${local.split('+')[0]}+${destino}-${sufijo}@${dominio}`.toLowerCase()
  return [
    { correo: alias('dueno'), nombre: 'Dueña de Prueba', role: 'owner', rolPlataforma: 'dueno', cargo: 'Dirección', areas: ['direccion'] },
    { correo: alias('asesora'), nombre: 'Asesora de Prueba', role: 'operator', rolPlataforma: 'ejecutor', cargo: 'Asesora comercial', areas: ['comercial'] },
  ]
}

export interface OpcionesPlan {
  origen: string
  destino: string
  nombre: string
  correoBase: string
  /** Llaves de `workspaces.config_extra` que se agregan a la lista blanca tras revisar el simulacro. */
  incluirClaves: string[]
  hoy: string
  nuevoId: () => string
  caso: EntradaCaso
}

export type Paso =
  | { tipo: 'insertar'; tabla: string; filas: Fila[] }
  | { tipo: 'guardar'; tabla: string; fila: Fila }
  | { tipo: 'actualizar'; tabla: string; id: string; patch: Fila }

export interface InformePlan {
  clavesCopiadas: string[]
  clavesDescartadas: { clave: string; motivo: string }[]
  modulosApagados: string[]
  llavesQuitadas: string[]
  datosPersonales: string[]
  uuidsSueltos: string[]
  excluidas: { tabla: string; filas: number; motivo: string }[]
  sinClasificar: { tabla: string; filas: number }[]
  semillas: { clave: string; nombre: string; para: string; estado: 'nueva' | 'ya existe' }[]
  avisos: string[]
}

export interface Plan {
  origen: { id: string; slug: string }
  destino: { id: string; slug: string; existe: boolean }
  usuarios: (UsuarioDePrueba & { id: string | null; staffId: string; existe: boolean })[]
  pasos: Paso[]
  informe: InformePlan
}

const SLUG_VALIDO = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])?$/

const COLUMNAS_QUE_SE_ANULAN: Record<string, string[]> = {
  lineas_negocio: ['drive_folder_id'],
}

/** Qué filas de cada tabla copiada se leen del origen. */
function filtroDeCopia(tabla: string, origenId: string, ids: Record<string, string[]>): Filtro[] {
  switch (tabla) {
    case 'etapas_negocio':
      return [['linea_id', 'in', ids.lineas_negocio]]
    case 'bloque_configs':
      return [['etapa_id', 'in', ids.etapas_negocio]]
    case 'servicio_tarifas_versiones':
      return [['servicio_id', 'in', ids.servicios]]
    default:
      return [['workspace_id', 'eq', origenId]]
  }
}

/** Cuántas filas escribe el plan, por tabla (lo que imprime el simulacro). */
export function contarPorTabla(pasos: Paso[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of pasos) {
    const n = p.tipo === 'insertar' ? p.filas.length : 1
    const k = p.tipo === 'actualizar' ? `${p.tabla} (actualizar)` : p.tabla
    m.set(k, (m.get(k) ?? 0) + n)
  }
  return m
}


export async function planificar(a: Almacen, o: OpcionesPlan): Promise<Plan> {
  if (o.destino === o.origen) throw new Error('El destino no puede ser el mismo workspace que el origen.')
  if (!SLUG_VALIDO.test(o.destino)) throw new Error(`Slug de destino inválido: ${o.destino}`)

  const [origen] = await a.leer('workspaces', [['slug', 'eq', o.origen]])
  if (!origen) throw new Error(`No existe el workspace de origen «${o.origen}».`)
  const [previo] = await a.leer('workspaces', [['slug', 'eq', o.destino]])
  if (previo) {
    const cfg = (previo.config_extra ?? {}) as Record<string, unknown>
    if (cfg.espacio_de_pruebas !== true || cfg.clon_de !== o.origen) {
      throw new Error(`El workspace «${o.destino}» ya existe y no es un espacio de pruebas de «${o.origen}». No se toca.`)
    }
  }
  const wsId = previo ? String(previo.id) : o.nuevoId()
  const informe: InformePlan = {
    clavesCopiadas: [], clavesDescartadas: [], modulosApagados: [], llavesQuitadas: [], datosPersonales: [],
    uuidsSueltos: [], excluidas: [], sinClasificar: [], semillas: [], avisos: [],
  }
  const pasos: Paso[] = []

  // ── Usuarios de prueba ─────────────────────────────────────────────────────
  const usuarios: Plan['usuarios'] = []
  for (const u of usuariosDePrueba(o.correoBase, o.destino)) {
    const id = await a.buscarUsuario(u.correo)
    let staffId = o.nuevoId()
    let existe = false
    if (id) {
      const [perfil] = await a.leer('profiles', [['id', 'eq', id]])
      if (perfil?.workspace_id && perfil.workspace_id !== wsId) {
        throw new Error(`${u.correo} ya es usuario de otro workspace (${String(perfil.workspace_id)}). No se mueve.`)
      }
      const [staff] = await a.leer('staff', [['profile_id', 'eq', id]])
      if (staff && staff.workspace_id !== wsId) {
        throw new Error(`${u.correo} ya tiene staff en otro workspace (${String(staff.workspace_id)}). No se mueve.`)
      }
      if (staff) {
        staffId = String(staff.id)
        existe = true
      }
    }
    usuarios.push({ ...u, id, staffId, existe })
  }
  const dueno = usuarios[0]
  const asesora = usuarios[1]
  // Sin `--apply` un usuario nuevo todavía no tiene id: el simulacro usa uno provisional.
  const perfilDe = (u: (typeof usuarios)[number]) => u.id ?? `pendiente-${u.correo}`

  // ── Configuración (solo si el destino es nuevo) ───────────────────────────
  let lineas: Fila[] = []
  let etapas: Fila[] = []
  let bloques: Fila[] = []
  const nuevas = new Set<string>([wsId])

  if (!previo) {
    const mapa = new Map<string, string>([[String(origen.id).toLowerCase(), wsId]])
    for (const s of await a.leer('staff', [['workspace_id', 'eq', origen.id]])) mapa.set(String(s.id).toLowerCase(), dueno.staffId)
    for (const p of await a.leer('profiles', [['workspace_id', 'eq', origen.id]])) mapa.set(String(p.id).toLowerCase(), perfilDe(dueno))

    // Lo que se lee del origen, tabla por tabla (las de configuración, en orden).
    const leidas: Record<string, Fila[]> = {}
    const ids: Record<string, string[]> = {}
    const esquema = await a.tablas()
    for (const tabla of ['lineas_negocio', 'etapas_negocio', 'bloque_configs', 'custom_fields', 'custom_field_mappings', 'labels',
      'workspace_stages', 'stage_transition_rules', 'expense_categories', 'workspace_features', 'servicios', 'servicio_tarifas_versiones']) {
      if (!esquema.has(tabla)) {
        informe.avisos.push(`La tabla ${tabla} no existe en la base: no se copia.`)
        leidas[tabla] = []
        ids[tabla] = []
        continue
      }
      let filas = await a.leer(tabla, filtroDeCopia(tabla, String(origen.id), ids))
      if (tabla === 'lineas_negocio') filas = filas.filter(f => f.is_active === true)
      if (tabla === 'servicios') filas = filas.filter(f => f.linea_id == null || ids.lineas_negocio.includes(String(f.linea_id)))
      leidas[tabla] = filas
      ids[tabla] = filas.map(f => String(f.id))
      for (const f of filas) if (f.id != null) {
        const nuevo = o.nuevoId()
        mapa.set(String(f.id).toLowerCase(), nuevo)
        nuevas.add(nuevo)
      }
    }
    for (const u of usuarios) {
      nuevas.add(u.staffId)
      nuevas.add(perfilDe(u))
    }

    const transformar = (tabla: string, f: Fila): Fila => {
      const out: Fila = {}
      for (const [k, v] of Object.entries(f)) {
        if (k === 'created_at' || k === 'updated_at') continue
        if (COLUMNAS_QUE_SE_ANULAN[tabla]?.includes(k)) {
          out[k] = null
          continue
        }
        if (v && typeof v === 'object') {
          const limpio = sinLlaves(v, LLAVE_DE_CREDENCIAL, `${tabla}.${k}`)
          informe.llavesQuitadas.push(...limpio.quitadas)
          out[k] = remapear(limpio.valor, mapa)
        } else {
          out[k] = remapear(v, mapa)
        }
      }
      for (const { ruta, uuid } of uuidsEn(out, tabla)) {
        if (!nuevas.has(uuid) && !ruta.endsWith('.bloque_definition_id')) informe.uuidsSueltos.push(ruta)
      }
      for (const d of pareceDatoPersonal(out, tabla)) informe.datosPersonales.push(`${d.ruta} (${d.tipo})`)
      return out
    }

    // El workspace: columnas de configuración, módulos sin canales, config_extra por lista blanca.
    const cfgOrigen = (origen.config_extra ?? {}) as Record<string, unknown>
    const permitidas = new Set([...Object.keys(CLAVES_WORKSPACE_QUE_SE_COPIAN), ...o.incluirClaves])
    const cfg: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cfgOrigen)) {
      if (permitidas.has(k) && !(k in CLAVES_WORKSPACE_QUE_SE_DESCARTAN)) {
        const limpio = sinLlaves(v, LLAVE_DE_CREDENCIAL, `workspaces.config_extra.${k}`)
        informe.llavesQuitadas.push(...limpio.quitadas)
        cfg[k] = remapear(limpio.valor, mapa)
        informe.clavesCopiadas.push(k)
      } else {
        informe.clavesDescartadas.push({ clave: k, motivo: CLAVES_WORKSPACE_QUE_SE_DESCARTAN[k] ?? 'Sin clasificar: no se copia (agrégala con --incluir-clave si hace falta)' })
      }
    }
    for (const d of pareceDatoPersonal(cfg, 'workspaces.config_extra')) informe.datosPersonales.push(`${d.ruta} (${d.tipo})`)
    const modulos = modulosParaPruebas(origen.modules)
    informe.modulosApagados = modulos.apagados
    const lineaActiva = origen.linea_activa_id ? mapa.get(String(origen.linea_activa_id).toLowerCase()) ?? null : null

    pasos.push({
      tipo: 'insertar',
      tabla: 'workspaces',
      filas: [{
        id: wsId,
        slug: o.destino,
        name: o.nombre,
        tipo: origen.tipo ?? 'clarity',
        subscription_status: 'trial',
        onboarding_completed: true,
        max_seats: origen.max_seats ?? 10,
        equipo_declarado: origen.equipo_declarado ?? 1,
        color_primario: origen.color_primario ?? null,
        color_secundario: origen.color_secundario ?? null,
        cotizacion_template_slug: origen.cotizacion_template_slug ?? null,
        stages_activos: origen.stages_activos ?? null,
        proyecto_modules: origen.proyecto_modules ?? null,
        profession: origen.profession ?? null,
        linea_activa_id: lineaActiva,
        modules: modulos.copiados,
        config_extra: {
          ...cfg,
          espacio_de_pruebas: true,
          clon_de: o.origen,
          grupo: 'demo',
          cotizacion_por_pasos: { activo: true },
        },
      }],
    })
    // Personas antes que la configuración: hay columnas de configuración que apuntan a staff y perfiles.
    pasos.push(...pasosDeUsuarios(usuarios, wsId, perfilDe))

    for (const [tabla, filas] of Object.entries(leidas)) {
      if (filas.length) pasos.push({ tipo: 'insertar', tabla, filas: filas.map(f => transformar(tabla, f)) })
    }

    // El perfil fiscal: el régimen de la cliente, con una identidad inventada.
    const [fiscal] = esquema.has('fiscal_profiles') ? await a.leer('fiscal_profiles', [['workspace_id', 'eq', origen.id]]) : []
    const REGIMEN = ['person_type', 'tax_regime', 'iva_responsible', 'is_declarante', 'self_withholder', 'gran_contribuyente',
      'agente_retenedor', 'ica_rate', 'ica_city', 'ciiu', 'actividad_secundaria', 'tipo_documento']
    pasos.push({
      tipo: 'insertar',
      tabla: 'fiscal_profiles',
      filas: [{
        ...Object.fromEntries(REGIMEN.filter(k => fiscal && k in fiscal).map(k => [k, fiscal![k]])),
        workspace_id: wsId,
        nit: '900000001',
        razon_social: 'AGENCIA DE PRUEBA S.A.S',
        is_complete: true,
      }],
    })

    // Lo que NO se copia, contado, para que el informe diga qué se dejó y por qué.
    for (const [tabla, columnas] of esquema) {
      if (!columnas.includes('workspace_id') || tabla === 'workspaces') continue
      const c = clasificarTabla(tabla)
      if (c.accion === 'copia') continue
      const n = await a.contar(tabla, [['workspace_id', 'eq', origen.id]])
      if (n === 0) continue
      if (c.accion === 'excluye') informe.excluidas.push({ tabla, filas: n, motivo: c.motivo })
      else informe.sinClasificar.push({ tabla, filas: n })
    }

    lineas = pasos.flatMap(p => (p.tipo === 'insertar' && p.tabla === 'lineas_negocio' ? p.filas : []))
    etapas = pasos.flatMap(p => (p.tipo === 'insertar' && p.tabla === 'etapas_negocio' ? p.filas : []))
    bloques = pasos.flatMap(p => (p.tipo === 'insertar' && p.tabla === 'bloque_configs' ? p.filas : []))
  } else {
    // Destino ya creado: no se recopia nada. Solo usuarios, interruptor y semillas que falten.
    pasos.push(...pasosDeUsuarios(usuarios.filter(u => !u.existe), wsId, perfilDe))
    const cfg = (previo.config_extra ?? {}) as Record<string, unknown>
    const interruptor = cfg.cotizacion_por_pasos as { activo?: unknown } | undefined
    if (interruptor?.activo !== true) {
      pasos.push({ tipo: 'actualizar', tabla: 'workspaces', id: wsId, patch: { config_extra: { ...cfg, cotizacion_por_pasos: { ...(interruptor ?? {}), activo: true } } } })
    }
    informe.avisos.push('El espacio de pruebas ya existe: la configuración no se vuelve a copiar (para recopiarla: --borrar y luego --apply).')
    lineas = (await a.leer('lineas_negocio', [['workspace_id', 'eq', wsId]])).filter(l => l.is_active === true)
    etapas = lineas.length ? await a.leer('etapas_negocio', [['linea_id', 'in', lineas.map(l => l.id)]]) : []
    bloques = etapas.length ? await a.leer('bloque_configs', [['etapa_id', 'in', etapas.map(e => e.id)]]) : []
  }

  // ── Semillas ───────────────────────────────────────────────────────────────
  pasos.push(...(await pasosDeSemillas(a, o, { wsId, existe: !!previo, lineas, etapas, bloques, asesoraStaffId: asesora.staffId }, informe)))

  return { origen: { id: String(origen.id), slug: o.origen }, destino: { id: wsId, slug: o.destino, existe: !!previo }, usuarios, pasos, informe }
}

function pasosDeUsuarios(usuarios: Plan['usuarios'], wsId: string, perfilDe: (u: Plan['usuarios'][number]) => string): Paso[] {
  const pasos: Paso[] = []
  for (const u of usuarios) {
    const id = perfilDe(u)
    pasos.push({ tipo: 'guardar', tabla: 'profiles', fila: { id, workspace_id: wsId, home_workspace_id: wsId, full_name: u.nombre, role: u.role, platform_admin: false } })
    if (!u.existe) {
      pasos.push({ tipo: 'insertar', tabla: 'staff', filas: [{ id: u.staffId, workspace_id: wsId, profile_id: id, full_name: u.nombre, position: u.cargo, rol_plataforma: u.rolPlataforma, tipo_acceso: 'app', is_active: true }] })
      pasos.push({ tipo: 'insertar', tabla: 'staff_areas', filas: u.areas.map(area => ({ staff_id: u.staffId, area })) })
    }
  }
  return pasos
}

/** La línea de viaje: la activa cuya etapa 1 declara quiénes viajan (`adultos`). */
function lineaDeViaje(lineas: Fila[], etapas: Fila[], bloques: Fila[]): Fila | null {
  for (const l of [...lineas].sort((x, y) => Number(x.numero ?? 0) - Number(y.numero ?? 0))) {
    const e1 = etapas.find(e => e.linea_id === l.id && Number(e.numero) === 1 && e.is_active !== false)
    if (!e1) continue
    const declara = bloques.some(b => b.etapa_id === e1.id && JSON.stringify((b.config_extra as { fields?: unknown } | null)?.fields ?? []).includes('"adultos"'))
    if (declara) return l
  }
  return null
}

async function pasosDeSemillas(
  a: Almacen,
  o: OpcionesPlan,
  d: { wsId: string; existe: boolean; lineas: Fila[]; etapas: Fila[]; bloques: Fila[]; asesoraStaffId: string },
  informe: InformePlan,
): Promise<Paso[]> {
  const linea = lineaDeViaje(d.lineas, d.etapas, d.bloques)
  if (!linea) {
    informe.avisos.push('Ninguna línea activa declara quiénes viajan en su etapa 1: no se siembra nada.')
    return []
  }
  const etapa = (n: number) => d.etapas.find(e => e.linea_id === linea.id && Number(e.numero) === n && e.is_active !== false)
  const e1 = etapa(1)
  const e2 = etapa(2)
  if (!e1 || !e2) {
    informe.avisos.push(`La línea «${String(linea.nombre)}» no tiene etapas 1 y 2 activas: no se siembra nada.`)
    return []
  }
  // La etapa 2 tiene que ser la de la cotización: su bloque es de tipo `cotizacion`.
  const defIds = d.bloques.filter(b => b.etapa_id === e2.id).map(b => b.bloque_definition_id)
  const defs = defIds.length ? await a.leer('bloque_definitions', [['id', 'in', defIds]]) : []
  if (!defs.some(x => x.tipo === 'cotizacion')) {
    informe.avisos.push(`La etapa 2 de «${String(linea.nombre)}» no tiene bloque de cotización: no se siembra nada.`)
    return []
  }

  const ya = d.existe ? await a.leer('negocios', [['workspace_id', 'eq', d.wsId]]) : []
  const sembradas = new Set(ya.map(n => (n.metadata as Record<string, unknown> | null)?.[MARCA_SEMILLA]).filter(Boolean))
  const contactos = d.existe ? await a.leer('contactos', [['workspace_id', 'eq', d.wsId]]) : []
  const previo = contactos.find(c => (c.custom_data as Record<string, unknown> | null)?.[MARCA_SEMILLA] === true)

  const pasos: Paso[] = []
  const contactoNombre = 'Familia de Prueba'
  const contactoId = previo ? String(previo.id) : o.nuevoId()
  const faltan = SEMILLAS.filter(s => !sembradas.has(s.clave))
  if (!previo && faltan.length) {
    pasos.push({ tipo: 'insertar', tabla: 'contactos', filas: [{ id: contactoId, workspace_id: d.wsId, nombre: contactoNombre, custom_data: { es_prueba: true, [MARCA_SEMILLA]: true } }] })
  }

  const acumulado: Record<string, Fila[]> = {}
  SEMILLAS.forEach((s, i) => {
    const existe = sembradas.has(s.clave)
    informe.semillas.push({ clave: s.clave, nombre: s.nombre, para: s.para, estado: existe ? 'ya existe' : 'nueva' })
    if (existe) return
    const filas = filasDeSemilla(s, i + 1, {
      wsId: d.wsId,
      lineaId: String(linea.id),
      etapa1: { id: String(e1.id), stage: (e1.stage as string | null) ?? null },
      etapa2: { id: String(e2.id), stage: (e2.stage as string | null) ?? null },
      bloques: d.bloques.filter(b => b.etapa_id === e1.id || b.etapa_id === e2.id).map(b => ({ id: String(b.id), etapa_id: String(b.etapa_id), config_extra: b.config_extra })),
      contactoId,
      contactoNombre,
      asesoraStaffId: d.asesoraStaffId,
      hoy: o.hoy,
      nuevoId: o.nuevoId,
    }, o.caso)
    for (const [t, f] of Object.entries(filas)) (acumulado[t] ??= []).push(...f)
  })
  for (const t of ['negocios', 'negocio_bloques', 'negocio_responsables', 'cotizaciones', 'items', 'rubros', 'cotizacion_itinerarios', 'itinerario_opciones']) {
    if (acumulado[t]?.length) pasos.push({ tipo: 'insertar', tabla: t, filas: acumulado[t] })
  }
  return pasos
}

/** Escribe el plan. Los usuarios de Auth ya tienen que existir (`crearUsuarios`). */
export async function ejecutar(a: Almacen, plan: Plan): Promise<void> {
  for (const p of plan.pasos) {
    if (p.tipo === 'insertar') await a.insertar(p.tabla, p.filas)
    else if (p.tipo === 'guardar') await a.guardar(p.tabla, p.fila)
    else await a.actualizar(p.tabla, p.id, p.patch)
  }
}

/** Crea en Auth los usuarios de prueba que falten. Devuelve los ids creados (para deshacer). */
export async function crearUsuarios(a: Almacen, correoBase: string, destino: string): Promise<string[]> {
  const creados: string[] = []
  for (const u of usuariosDePrueba(correoBase, destino)) {
    if (await a.buscarUsuario(u.correo)) continue
    creados.push(await a.crearUsuario(u.correo, u.nombre))
  }
  return creados
}

// ── Borrar ───────────────────────────────────────────────────────────────────

export interface InformeBorrado {
  borradas: Record<string, number>
  residuo: Record<string, number>
  errores: Record<string, string>
  bloqueos: string[]
  usuariosBorrados: string[]
  archivosBorrados: number
  workspaceBorrado: boolean
}

/** Las columnas por las que una fila cuelga del espacio de pruebas, y de dónde salen sus ids. */
const ENLACES: [columna: string, tabla: string, desde: (ids: Record<string, string[]>) => Filtro][] = [
  ['negocio_id', 'negocios', ids => ['workspace_id', 'in', ids.ws]],
  ['cotizacion_id', 'cotizaciones', ids => ['workspace_id', 'in', ids.ws]],
  ['item_id', 'items', ids => ['cotizacion_id', 'in', ids.cotizacion_id]],
  ['itinerario_id', 'cotizacion_itinerarios', ids => ['workspace_id', 'in', ids.ws]],
  ['linea_id', 'lineas_negocio', ids => ['workspace_id', 'in', ids.ws]],
  ['etapa_id', 'etapas_negocio', ids => ['linea_id', 'in', ids.linea_id]],
  ['bloque_config_id', 'bloque_configs', ids => ['workspace_id', 'in', ids.ws]],
  ['staff_id', 'staff', ids => ['workspace_id', 'in', ids.ws]],
  ['contacto_id', 'contactos', ids => ['workspace_id', 'in', ids.ws]],
  ['empresa_id', 'empresas', ids => ['workspace_id', 'in', ids.ws]],
  ['servicio_id', 'servicios', ids => ['workspace_id', 'in', ids.ws]],
]

/**
 * Borra TODO lo del espacio de pruebas, o solo los negocios sembrados (`soloSemillas`, para
 * volver a sembrar). Recorre todas las tablas de la base que cuelgan del workspace por alguna
 * de sus columnas y repite por pasadas: lo que una llave foránea frena en una pasada sale en la
 * siguiente, cuando ya no tiene hijos. Lo que quede se informa como residuo.
 */
export async function purgar(a: Almacen, o: { origen: string; destino: string; correoBase: string; soloSemillas?: boolean }): Promise<InformeBorrado> {
  const inf: InformeBorrado = { borradas: {}, residuo: {}, errores: {}, bloqueos: [], usuariosBorrados: [], archivosBorrados: 0, workspaceBorrado: false }
  if (o.destino === o.origen) throw new Error('El destino no puede ser el origen.')
  const [ws] = await a.leer('workspaces', [['slug', 'eq', o.destino]])
  if (!ws) return inf
  const cfg = (ws.config_extra ?? {}) as Record<string, unknown>
  if (cfg.espacio_de_pruebas !== true || cfg.clon_de !== o.origen) {
    throw new Error(`«${o.destino}» no es un espacio de pruebas de «${o.origen}»: no se borra.`)
  }
  const wsId = String(ws.id)
  const esquema = await a.tablas()

  // Los ids de cada enlace.
  const ids: Record<string, string[]> = { ws: [wsId] }
  if (o.soloSemillas) {
    const negocios = (await a.leer('negocios', [['workspace_id', 'eq', wsId]])).filter(n => (n.metadata as Record<string, unknown> | null)?.[MARCA_SEMILLA])
    ids.negocio_id = negocios.map(n => String(n.id))
    ids.cotizacion_id = ids.negocio_id.length ? (await a.leer('cotizaciones', [['negocio_id', 'in', ids.negocio_id]])).map(c => String(c.id)) : []
    ids.item_id = ids.cotizacion_id.length ? (await a.leer('items', [['cotizacion_id', 'in', ids.cotizacion_id]])).map(i => String(i.id)) : []
    ids.itinerario_id = ids.cotizacion_id.length ? (await a.leer('cotizacion_itinerarios', [['cotizacion_id', 'in', ids.cotizacion_id]])).map(i => String(i.id)) : []
  } else {
    for (const [col, tabla, desde] of ENLACES) {
      if (!esquema.has(tabla)) {
        ids[col] = []
        continue
      }
      const f = desde(ids)
      ids[col] = (f[2] as unknown[]).length ? (await a.leer(tabla, [f])).map(x => String(x.id)) : []
    }
  }

  // Los perfiles que están parados en este workspace y no son los alias: no se borran ni se mueven.
  const alias = usuariosDePrueba(o.correoBase, o.destino)
  const idsAlias: string[] = []
  for (const u of alias) {
    const id = await a.buscarUsuario(u.correo)
    if (id) idsAlias.push(id)
  }
  if (!o.soloSemillas) {
    for (const col of ['workspace_id', 'home_workspace_id']) {
      for (const p of await a.leer('profiles', [[col, 'eq', wsId]])) {
        if (!idsAlias.includes(String(p.id))) inf.bloqueos.push(`El perfil ${String(p.id)} (${String(p.full_name ?? '')}) tiene ${col} en este workspace: muévelo antes de borrarlo.`)
      }
    }
    if (inf.bloqueos.length) return inf
  }

  // Qué (tabla, columna, ids) hay que vaciar.
  const objetivos: { tabla: string; filtro: Filtro }[] = []
  const columnasEnlace = o.soloSemillas ? ['negocio_id', 'cotizacion_id', 'item_id', 'itinerario_id'] : ['workspace_id', ...ENLACES.map(e => e[0])]
  for (const [tabla, columnas] of esquema) {
    if (tabla === 'workspaces' || tabla === 'profiles' || tabla.startsWith('backup_')) continue
    for (const col of columnasEnlace) {
      if (!columnas.includes(col)) continue
      const lista = col === 'workspace_id' ? [wsId] : ids[col] ?? []
      if (lista.length) objetivos.push({ tabla, filtro: [col, 'in', lista] })
    }
  }
  if (o.soloSemillas && ids.negocio_id.length) objetivos.push({ tabla: 'negocios', filtro: ['id', 'in', ids.negocio_id] })

  for (let pasada = 0; pasada < 12; pasada++) {
    let avance = false
    for (const ob of objetivos) {
      if ((await a.contar(ob.tabla, [ob.filtro])) === 0) continue
      const r = await a.borrar(ob.tabla, [ob.filtro])
      if (r.borradas > 0) {
        avance = true
        inf.borradas[ob.tabla] = (inf.borradas[ob.tabla] ?? 0) + r.borradas
      }
      if (r.error) inf.errores[ob.tabla] = r.error.message
      else delete inf.errores[ob.tabla]
    }
    if (!avance) break
  }
  for (const ob of objetivos) {
    const n = await a.contar(ob.tabla, [ob.filtro])
    if (n > 0) inf.residuo[ob.tabla] = (inf.residuo[ob.tabla] ?? 0) + n
  }
  if (o.soloSemillas || Object.keys(inf.residuo).length) return inf

  // Archivos del workspace (y de sus negocios) en Storage.
  const archivos = [
    ...(await a.archivos(`${wsId}/`)),
    ...(await Promise.all((ids.negocio_id ?? []).map(n => a.archivos(`negocios/${n}/`)))).flat(),
  ]
  if (archivos.length) await a.borrarArchivos(archivos)
  inf.archivosBorrados = archivos.length

  // Los alias: perfil y cuenta.
  for (const id of idsAlias) {
    const r = await a.borrar('profiles', [['id', 'eq', id]])
    if (r.error) {
      inf.errores.profiles = r.error.message
      continue
    }
    await a.borrarUsuario(id)
    inf.usuariosBorrados.push(id)
  }
  const r = await a.borrar('workspaces', [['id', 'eq', wsId]])
  if (r.error) inf.errores.workspaces = r.error.message
  inf.workspaceBorrado = !r.error && r.borradas === 1
  return inf
}

/** Deshace un `--apply` que falló a medias: borra lo escrito y los usuarios creados en esta corrida. */
export async function deshacer(a: Almacen, o: { origen: string; destino: string; correoBase: string }, creados: string[]): Promise<InformeBorrado> {
  const inf = await purgar(a, o)
  for (const id of creados) {
    if (inf.usuariosBorrados.includes(id)) continue
    await a.borrar('profiles', [['id', 'eq', id]])
    await a.borrarUsuario(id)
    inf.usuariosBorrados.push(id)
  }
  return inf
}
