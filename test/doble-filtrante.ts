// ============================================================
// Doble de Supabase que APLICA los filtros más comunes sobre tablas en memoria.
//
// Para las pruebas del negocio de prueba (F8-1) en superficies sin doble propio
// (conciliación, tableros genéricos, bandejas): lo que importa es que la consulta
// `negocios.eq('metadata->>es_prueba', 'true')` devuelva lo mismo que PostgREST y
// que el resto de las lecturas traigan sus filas. Filtros que el doble no conoce
// (`or`, `filter`) no recortan: la prueba solo depende de los que sí aplica.
// ============================================================

export type Fila = Record<string, unknown>

function leer(f: Fila, ruta: string): unknown {
  if (ruta.includes('->')) {
    const v = ruta.split(/->>?/).reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Fila)[k] : undefined), f)
    return ruta.includes('->>') && v != null ? String(v) : v
  }
  return ruta.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Fila)[k] : undefined), f)
}

export function dobleFiltrante(tablas: () => Record<string, Fila[]>) {
  const cliente = {
    rpc: async (_fn: string, _args?: Record<string, unknown>): Promise<{ data: unknown; error: null }> => ({ data: [], error: null }),
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      let tope: number | null = null
      let rango: [number, number] | null = null
      const correr = () => {
        let filas = (tablas()[tabla] ?? []).filter((f) => filtros.every((p) => p(f)))
        if (rango) filas = filas.slice(rango[0], rango[1] + 1)
        if (tope !== null) filas = filas.slice(0, tope)
        return { data: filas.map((f) => ({ ...f })), error: null, count: filas.length }
      }
      const q: Record<string, unknown> = {
        insert: (filas: Fila | Fila[]) => {
          const t = tablas()
          t[tabla] ??= []
          t[tabla].push(...(Array.isArray(filas) ? filas : [filas]).map((f) => ({ ...f })))
          return { then: (r: (v: unknown) => unknown) => r({ data: null, error: null }) }
        },
        select: () => q,
        eq: (c: string, v: unknown) => { filtros.push((f) => leer(f, c) === v); return q },
        neq: (c: string, v: unknown) => { filtros.push((f) => leer(f, c) !== v); return q },
        in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(leer(f, c))); return q },
        is: (c: string, v: unknown) => { filtros.push((f) => (leer(f, c) ?? null) === v); return q },
        not: (c: string, op: string, v: unknown) => {
          filtros.push((f) => (op === 'is' ? (leer(f, c) ?? null) !== v : leer(f, c) !== v))
          return q
        },
        gte: (c: string, v: string) => { filtros.push((f) => String(leer(f, c) ?? '') >= v); return q },
        gt: (c: string, v: string) => { filtros.push((f) => String(leer(f, c) ?? '') > v); return q },
        lt: (c: string, v: string) => { filtros.push((f) => String(leer(f, c) ?? '') < v); return q },
        lte: (c: string, v: string) => { filtros.push((f) => String(leer(f, c) ?? '') <= v); return q },
        or: () => q,
        filter: () => q,
        order: () => q,
        limit: (n: number) => { tope = n; return q },
        range: (d: number, h: number) => { rango = [d, h]; return q },
        single: async () => ({ data: correr().data[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: correr().data[0] ?? null, error: null }),
        then: (r: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(correr()).then(r, rej),
      }
      return q
    },
  }
  return cliente
}
