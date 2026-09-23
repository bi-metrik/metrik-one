// ============================================================
// Doble de Supabase con tablas en memoria que LEE y ESCRIBE.
//
// Aplica los filtros en los update (una guarda como `.is('enlace_pago_url', null)` que faltara
// haría fallar la prueba, no pasarla), pagina con `.range()` como PostgREST y simula el DEFAULT
// de `cobros.fecha` (CURRENT_DATE): un cobro programado insertado sin `fecha: null` nace pagado.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

export type Fila = Record<string, unknown>

export interface Tablas {
  [tabla: string]: Fila[]
}

const DEFAULTS: Record<string, Fila> = {
  cobros: { fecha: '2026-01-01', anulado_at: null, enlace_pago_url: null, enlace_pago_expira: null },
}

export function crearDoble(tablas: Tablas) {
  let secuencia = 0
  const escrituras: { tabla: string; op: 'insert' | 'update'; fila: Fila }[] = []

  function from(tabla: string) {
    const filtros: ((f: Fila) => boolean)[] = []
    let rango: [number, number] | null = null
    let tope: number | null = null
    let orden: string | null = null
    let modo: 'select' | 'update' = 'select'
    let patch: Fila = {}

    const filas = () => (tablas[tabla] ??= [])
    const resolver = () => {
      let r = filas().filter((f) => filtros.every((p) => p(f)))
      if (orden) {
        const o = orden
        r = [...r].sort((a, b) => String(a[o] ?? '').localeCompare(String(b[o] ?? '')))
      }
      if (rango) r = r.slice(rango[0], rango[1] + 1)
      if (tope !== null) r = r.slice(0, tope)
      return r
    }
    const ejecutar = () => {
      if (modo === 'update') {
        const tocadas = filas().filter((f) => filtros.every((p) => p(f)))
        for (const f of tocadas) {
          Object.assign(f, patch)
          escrituras.push({ tabla, op: 'update', fila: { ...f } })
        }
        return { data: tocadas.map((f) => ({ id: f.id })), error: null }
      }
      return { data: resolver(), error: null }
    }

    const chain = {
      select: () => chain,
      update: (p: Fila) => {
        modo = 'update'
        patch = p
        return chain
      },
      insert: (v: Fila | Fila[]) => {
        const nuevas = (Array.isArray(v) ? v : [v]).map((x) => {
          const fila: Fila = { id: `${tabla}-${++secuencia}`, ...(DEFAULTS[tabla] ?? {}), ...x }
          // El DEFAULT solo aplica si el payload no trae la clave.
          for (const [k, d] of Object.entries(DEFAULTS[tabla] ?? {})) if (!(k in x)) fila[k] = d
          filas().push(fila)
          escrituras.push({ tabla, op: 'insert', fila: { ...fila } })
          return fila
        })
        const r = { data: nuevas, error: null }
        const ins = {
          select: () => ins,
          single: async () => ({ data: nuevas[0], error: null }),
          maybeSingle: async () => ({ data: nuevas[0] ?? null, error: null }),
          then: (ok: (x: typeof r) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko),
        }
        return ins
      },
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), chain),
      is: (c: string, v: unknown) => (filtros.push((f) => (f[c] ?? null) === v), chain),
      in: (c: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[c])), chain),
      lte: (c: string, v: string) => (filtros.push((f) => String(f[c]) <= v), chain),
      order: (c: string) => ((orden = c), chain),
      range: (a: number, b: number) => ((rango = [a, b]), chain),
      limit: (n: number) => ((tope = n), chain),
      maybeSingle: async () => {
        const r = resolver()
        if (r.length > 1) return { data: null, error: { code: 'PGRST116', message: 'varias filas' } }
        return { data: r[0] ?? null, error: null }
      },
      single: async () => ({ data: resolver()[0] ?? null, error: null }),
      then: (ok: (x: ReturnType<typeof ejecutar>) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(ejecutar()).then(ok, ko),
    }
    return chain
  }

  return { db: { from } as unknown as import('@supabase/supabase-js').SupabaseClient, tablas, escrituras }
}
