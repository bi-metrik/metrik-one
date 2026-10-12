// ============================================================
// Doble de Supabase de la PRUEBA DE IGUALDAD DEL SERVIDOR (C0 de la cotización integrada).
//
// Igual que `cotizacion-pdf-doble.ts` (tablas en memoria que leen y escriben), con dos cosas
// más que la prueba necesita:
//
//  · REGISTRO de cada ida a la base, en orden: tabla, operación, filtros y lo que se escribió.
//    De ahí salen «las mismas escrituras» (criterio N1) y el presupuesto de idas por acción
//    (criterio V5).
//  · Un método que el doble no conoce REVIENTA. Un filtro ignorado en silencio devolvería
//    filas de más y la igualdad compararía contra una lectura falsa.
//
// Vive aparte del doble compartido a propósito: la prueba de igualdad no puede cambiar de
// resultado porque otra prueba le enseñe algo nuevo al doble compartido.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

export type Fila = Record<string, unknown>

export interface Ida {
  tabla: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'rpc'
  /** Los filtros como se pidieron: `['eq', 'id', 'cot-1']`. */
  filtros: unknown[][]
  /** Lo escrito (insert/update) o los argumentos (rpc). */
  payload?: unknown
}

export const base: {
  tablas: Record<string, Fila[]>
  secuencia: number
  registro: Ida[]
} = { tablas: {}, secuencia: 0, registro: [] }

/** Una fecha fija por inserción: la prueba no puede depender del reloj. */
const creadaEn = (n: number) => new Date(Date.UTC(2026, 9, 12, 12, 0, n)).toISOString()

export function clienteFalso() {
  return {
    from: (tabla: string) => constructor(tabla),
    rpc: async (nombre: string, args?: unknown) => {
      base.registro.push({ tabla: `rpc:${nombre}`, op: 'rpc', filtros: [], payload: args ?? null })
      return nombre === 'get_next_cotizacion_consecutivo'
        ? { data: `COT-2026-${String(++base.secuencia).padStart(4, '0')}`, error: null }
        : { data: null, error: null }
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { message: 'storage no disponible en la prueba' } }),
        download: async () => ({ data: null, error: { message: 'storage no disponible en la prueba' } }),
        remove: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: null, error: { message: 'storage no disponible en la prueba' } }),
      }),
    },
  }
}

function constructor(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  const filtrosPedidos: unknown[][] = []
  let operacion: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Fila | Fila[] = {}
  let columnas = ''
  let limite: number | null = null
  let orden: { col: string; asc: boolean } | null = null
  let ejecutada = false

  const proyectar = (f: Fila): Fila => {
    const salida: Fila = structuredClone(f)
    const tablas = base.tablas
    if (columnas.includes('rubros(')) {
      salida.rubros = (tablas.rubros ?? []).filter(r => r.item_id === f.id).map(r => structuredClone(r))
    }
    if (columnas.includes('lineas_negocio(')) {
      const l = (tablas.lineas_negocio ?? []).find(x => x.id === f.linea_id)
      salida.lineas_negocio = l ? structuredClone(l) : null
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
    if (!ejecutada) {
      ejecutada = true
      base.registro.push({
        tabla,
        op: operacion,
        filtros: filtrosPedidos,
        ...(operacion === 'insert' || operacion === 'update' ? { payload: structuredClone(payload) } : {}),
      })
    }
    const tablas = base.tablas
    const todas = tablas[tabla] ?? (tablas[tabla] = [])
    const coinciden = todas.filter(f => filtros.every(fn => fn(f)))
    if (operacion === 'insert') {
      const nuevas = (Array.isArray(payload) ? payload : [payload]).map(p => {
        base.secuencia += 1
        return {
          id: `${tabla}-${base.secuencia}`,
          created_at: creadaEn(base.secuencia),
          ...structuredClone(p),
          // `rubros.valor_total` es GENERATED en la base: nadie lo inserta, la base lo calcula.
          ...(tabla === 'rubros' ? { valor_total: Number(p.cantidad) * Number(p.valor_unitario) } : {}),
        }
      })
      todas.push(...nuevas)
      return { data: nuevas.map(proyectar), error: null }
    }
    if (operacion === 'update') {
      for (const f of coinciden) {
        Object.assign(f, structuredClone(payload as Fila))
        if (tabla === 'rubros') f.valor_total = Number(f.cantidad) * Number(f.valor_unitario)
      }
      return { data: coinciden.map(proyectar), error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = todas.filter(f => !coinciden.includes(f))
      return { data: null, error: null }
    }
    let filas = [...coinciden]
    if (orden) {
      const { col, asc } = orden
      filas.sort((a, b) => {
        const x = a[col]
        const y = b[col]
        const n = Number(x) - Number(y)
        const c = Number.isFinite(n) && n !== 0 ? n : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0
        return c * (asc ? 1 : -1)
      })
    }
    if (limite !== null) filas = filas.slice(0, limite)
    return { data: filas.map(proyectar), error: null }
  }

  const filtro = (nombre: string, col: string, val: unknown, fn: (f: Fila) => boolean) => {
    filtrosPedidos.push([nombre, col, val])
    filtros.push(fn)
    return api
  }

  const api: Record<string, unknown> = {
    select(cols?: string) {
      if (operacion === 'select') columnas = typeof cols === 'string' ? cols : '*'
      return api
    },
    insert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    upsert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    delete() { operacion = 'delete'; return api },
    eq: (col: string, val: unknown) => filtro('eq', col, val, f => f[col] === val),
    neq: (col: string, val: unknown) => filtro('neq', col, val, f => f[col] !== val),
    is: (col: string, val: unknown) => filtro('is', col, val, f => (f[col] ?? null) === val),
    in: (col: string, vals: unknown[]) => filtro('in', col, vals, f => vals.includes(f[col])),
    gte: (col: string, val: unknown) => filtro('gte', col, val, f => String(f[col]) >= String(val)),
    lte: (col: string, val: unknown) => filtro('lte', col, val, f => String(f[col]) <= String(val)),
    order(col: string, opts?: { ascending?: boolean }) {
      orden = { col, asc: opts?.ascending !== false }
      return api
    },
    limit(n: number) { limite = n; return api },
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
  // Un método que el doble no conoce revienta: ignorarlo devolvería una lectura falsa.
  return new Proxy(api, {
    get(objetivo, prop) {
      if (typeof prop === 'symbol' || prop in objetivo) return objetivo[prop as string]
      throw new Error(`[igualdad-servidor-doble] método no soportado: ${tabla}.${String(prop)}()`)
    },
  })
}

/** Vacía el registro y devuelve lo que había. */
export function tomarRegistro(): Ida[] {
  const r = base.registro
  base.registro = []
  return r
}

/** Las escrituras de un registro (lo que la base guardó), sin las lecturas. */
export function escrituras(registro: readonly Ida[]): Ida[] {
  return registro.filter(i => i.op !== 'select')
}
