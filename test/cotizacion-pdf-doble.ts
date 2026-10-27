// ============================================================
// Doble de Supabase para llamar a las ACCIONES de la cotización (PDF, recálculo, itinerarios)
// sobre tablas en memoria que leen y escriben.
//
// Mismo patrón que el doble de `recomendada-tarifa-elegida-e2e.test.ts`, sacado aquí para que
// lo compartan las pruebas de los vuelos de punta a punta. Proyecta los embeds que esas
// acciones piden (`rubros(`, `lineas_negocio(`, `itinerario_opciones(`, `bloque_definitions`).
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

export type Fila = Record<string, unknown>

export const base: { tablas: Record<string, Fila[]>; secuencia: number } = { tablas: {}, secuencia: 0 }

export function clienteFalso() {
  return {
    from: (tabla: string) => constructor(tabla),
    rpc: async (nombre: string) =>
      nombre === 'get_next_cotizacion_consecutivo'
        ? { data: `COT-2026-${String(++base.secuencia).padStart(4, '0')}`, error: null }
        : { data: null, error: null },
  }
}

function constructor(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let operacion: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Fila | Fila[] = {}
  let columnas = ''
  let limite: number | null = null
  let orden: { col: string; asc: boolean } | null = null
  const tablas = base.tablas

  const proyectar = (f: Fila): Fila => {
    const salida: Fila = { ...f }
    if (columnas.includes('rubros(')) {
      salida.rubros = (tablas.rubros ?? []).filter(r => r.item_id === f.id).map(r => ({ ...r }))
    }
    if (columnas.includes('lineas_negocio(')) {
      const l = (tablas.lineas_negocio ?? []).find(x => x.id === f.linea_id)
      salida.lineas_negocio = l ? { config_extra: l.config_extra } : null
    }
    if (columnas.includes('itinerario_opciones(')) {
      salida.itinerario_opciones = (tablas.itinerario_opciones ?? [])
        .filter(o => o.itinerario_id === f.id)
        .map(o => ({ item_id: o.item_id }))
    }
    if (tabla === 'bloque_configs' && columnas.includes('bloque_definitions')) {
      salida.bloque_definitions = { tipo: f.tipo }
    }
    // La cotización de una línea (`items` con `cotizaciones(...)`): su estado, negocio y espacio.
    if (tabla === 'items' && columnas.includes('cotizaciones(')) {
      const c = (tablas.cotizaciones ?? []).find(x => x.id === f.cotizacion_id)
      salida.cotizaciones = c ? { estado: c.estado, negocio_id: c.negocio_id ?? null, workspace_id: c.workspace_id ?? null, convencion_margen: c.convencion_margen ?? null } : null
    }
    // Las etapas de la línea del negocio (`autorizacion-datos/envio.ts`): ¿alguna pide la
    // autorización de datos? En `negocios` directo, o embebido en la cotización (`negocio_envio`).
    const etapasDe = (lineaId: unknown) => (tablas.etapas_negocio ?? [])
      .filter(e => e.linea_id === lineaId)
      .map(e => ({ config_extra: e.config_extra ?? null }))
    if (tabla === 'negocios' && columnas.includes('lineas_negocio(etapas_negocio(')) {
      salida.lineas_negocio = f.linea_id ? { etapas_negocio: etapasDe(f.linea_id) } : null
    }
    // El cliente del negocio para el PDF (`cotizacion-pdf-actions.ts`): su empresa y su contacto.
    if (tabla === 'negocios' && columnas.includes('empresas(')) {
      const e = (tablas.empresas ?? []).find(x => x.id === f.empresa_id)
      salida.empresas = e ? { ...e } : null
    }
    if (tabla === 'negocios' && columnas.includes('contactos(')) {
      const c = (tablas.contactos ?? []).find(x => x.id === f.contacto_id)
      salida.contactos = c ? { nombre: c.nombre ?? null } : null
    }
    if (tabla === 'cotizaciones' && columnas.includes('negocio_envio:negocios')) {
      const n = (tablas.negocios ?? []).find(x => x.id === f.negocio_id)
      salida.negocio_envio = n
        ? { linea_id: n.linea_id ?? null, contacto_id: n.contacto_id ?? null, lineas_negocio: n.linea_id ? { etapas_negocio: etapasDe(n.linea_id) } : null }
        : null
    }
    // La ficha fijada en la línea (`items.proveedor_id` → `fotos_perfiles`), para las fotos del PDF.
    if (tabla === 'items' && columnas.includes('ficha:fotos_perfiles(')) {
      const p = (tablas.fotos_perfiles ?? []).find(x => x.id === f.proveedor_id)
      salida.ficha = p ? { tipo: p.tipo, clave: p.clave } : null
    }
    if (columnas.includes('empresas(') && salida.empresas === undefined) salida.empresas = null
    if (columnas.includes('oportunidades(')) salida.oportunidades = null
    return salida
  }

  const ejecutar = (): { data: unknown; error: { code?: string; message: string } | null } => {
    // La vista `fotos_catalogo_por_clave` (migración 20261017090000): las fotos por su llave y por
    // la de cada alias de su perfil. Se calcula de las tablas en cada lectura, como la base.
    if (tabla === 'fotos_catalogo_por_clave') {
      const fotos = tablas.fotos_catalogo ?? []
      const perfiles = tablas.fotos_perfiles ?? []
      const deAlias = (tablas.fotos_perfiles_alias ?? []).flatMap(a => {
        const p = perfiles.find(x => x.id === a.perfil_id)
        return p ? fotos.filter(f => f.workspace_id === p.workspace_id && f.tipo === p.tipo && f.clave === p.clave).map(f => ({ ...f, clave_pedida: a.clave })) : []
      })
      const filas = [...fotos.map(f => ({ ...f, clave_pedida: f.clave })), ...deAlias].filter(f => filtros.every(fn => fn(f)))
      return { data: filas, error: null }
    }
    const todas = tablas[tabla] ?? (tablas[tabla] = [])
    const coinciden = todas.filter(f => filtros.every(fn => fn(f)))
    if (operacion === 'insert') {
      const nuevas = (Array.isArray(payload) ? payload : [payload]).map(p => ({
        id: `${tabla}-${++base.secuencia}`,
        created_at: new Date(Date.UTC(2026, 9, 8, 12, 0, base.secuencia)).toISOString(),
        ...p,
      }))
      todas.push(...nuevas)
      return { data: nuevas.map(proyectar), error: null }
    }
    if (operacion === 'update') {
      for (const f of coinciden) Object.assign(f, payload)
      return { data: coinciden.map(proyectar), error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = todas.filter(f => !coinciden.includes(f))
      return { data: null, error: null }
    }
    let filas = [...coinciden]
    if (orden) {
      const { col, asc } = orden
      filas.sort((a, b) => (Number(a[col]) - Number(b[col]) || (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0)) * (asc ? 1 : -1))
    }
    if (limite !== null) filas = filas.slice(0, limite)
    return { data: filas.map(proyectar), error: null }
  }

  const api = {
    select(cols?: string) {
      if (operacion === 'select') columnas = typeof cols === 'string' ? cols : '*'
      return api
    },
    insert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    upsert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    delete() { operacion = 'delete'; return api },
    eq(col: string, val: unknown) { filtros.push(f => f[col] === val); return api },
    neq(col: string, val: unknown) { filtros.push(f => f[col] !== val); return api },
    is(col: string, val: unknown) { filtros.push(f => (f[col] ?? null) === val); return api },
    in(col: string, vals: unknown[]) { filtros.push(f => vals.includes(f[col])); return api },
    ilike(col: string, patron: string) {
      const re = new RegExp(`^${patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i')
      filtros.push(f => typeof f[col] === 'string' && re.test(f[col] as string))
      return api
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orden = { col, asc: opts?.ascending !== false }
      return api
    },
    limit(n: number) { limite = n; return api },
    range() { return api },
    single() {
      const r = ejecutar()
      return Promise.resolve({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error })
    },
    maybeSingle() {
      const r = ejecutar()
      return Promise.resolve({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(ejecutar()).then(resolve, reject)
    },
  }
  return api
}
