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
    if (columnas.includes('empresas(')) salida.empresas = null
    if (columnas.includes('oportunidades(')) salida.oportunidades = null
    return salida
  }

  const ejecutar = (): { data: unknown; error: { code?: string; message: string } | null } => {
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
