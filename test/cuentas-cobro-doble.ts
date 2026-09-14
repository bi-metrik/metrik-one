// ============================================================
// Doble del cliente de Supabase para la emision de cuentas de cobro.
//
// ⚠️ EL DOBLE REPRODUCE EL DEFECTO: `.maybeSingle()` se comporta como PostgREST.
// Con dos o mas filas NO devuelve la primera: devuelve `data: null` y un error
// PGRST116. Ese era el bug de septiembre de 2026 — el generador leia `data`,
// veia null, concluia "no hay cuenta" y emitia otra vez, todos los dias desde el
// 10. Un doble que devolviera la primera fila dejaria pasar el codigo viejo.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite.
// ============================================================

export type Fila = Record<string, unknown>

export const estado: {
  fixtures: Record<string, Fila[]>
  /** Tablas cuya lectura devuelve error, para probar que nadie lo disimula. */
  tablasQueFallan: Set<string>
  /** Numero que devuelve el RPC del correlativo. */
  siguienteNumero: string
} = { fixtures: {}, tablasQueFallan: new Set(), siguienteNumero: 'CC-2026-09-099' }

export function reiniciarDoble(): void {
  estado.fixtures = {}
  estado.tablasQueFallan = new Set()
  estado.siguienteNumero = 'CC-2026-09-099'
}

function valorEn(fila: Fila, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>(
    (acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]),
    fila,
  )
}

const ERROR_FALLA = { code: 'XX000', message: 'fallo simulado de lectura' }

export function clienteFalso() {
  return {
    rpc: async () => ({ data: estado.siguienteNumero, error: null }),
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      let orden: string | null = null
      let tope: number | null = null

      const resolver = (): Fila[] => {
        let filas = (estado.fixtures[tabla] ?? []).filter((f) => filtros.every((p) => p(f)))
        if (orden) {
          const campo = orden
          filas = [...filas].sort((a, b) =>
            String(valorEn(a, campo) ?? '').localeCompare(String(valorEn(b, campo) ?? '')),
          )
        }
        if (tope !== null) filas = filas.slice(0, tope)
        return filas
      }

      const falla = () => estado.tablasQueFallan.has(tabla)

      const chain = {
        select: () => chain,
        eq: (campo: string, valor: unknown) => {
          filtros.push((f) => valorEn(f, campo) === valor)
          return chain
        },
        neq: (campo: string, valor: unknown) => {
          filtros.push((f) => valorEn(f, campo) !== valor)
          return chain
        },
        in: (campo: string, valores: unknown[]) => {
          const set = new Set(valores)
          filtros.push((f) => set.has(valorEn(f, campo)))
          return chain
        },
        is: (campo: string, valor: unknown) => {
          filtros.push((f) => (valorEn(f, campo) ?? null) === valor)
          return chain
        },
        gte: (campo: string, valor: string) => {
          filtros.push((f) => String(valorEn(f, campo)) >= valor)
          return chain
        },
        lte: (campo: string, valor: string) => {
          filtros.push((f) => String(valorEn(f, campo)) <= valor)
          return chain
        },
        contains: (campo: string, valores: unknown[]) => {
          filtros.push((f) => {
            const arr = (valorEn(f, campo) as unknown[] | undefined) ?? []
            return valores.every((v) => arr.includes(v))
          })
          return chain
        },
        overlaps: (campo: string, valores: unknown[]) => {
          filtros.push((f) => {
            const arr = (valorEn(f, campo) as unknown[] | undefined) ?? []
            return valores.some((v) => arr.includes(v))
          })
          return chain
        },
        order: (campo: string) => {
          orden = campo
          return chain
        },
        limit: (n: number) => {
          tope = n
          return chain
        },
        maybeSingle: async () => {
          if (falla()) return { data: null, error: ERROR_FALLA }
          const filas = resolver()
          if (filas.length > 1) {
            return {
              data: null,
              error: {
                code: 'PGRST116',
                message: 'JSON object requested, multiple (or no) rows returned',
              },
            }
          }
          return { data: filas[0] ?? null, error: null }
        },
        then: (
          ok: (r: { data: Fila[] | null; error: typeof ERROR_FALLA | null }) => unknown,
          ko?: (e: unknown) => unknown,
        ) => {
          const r = falla() ? { data: null, error: ERROR_FALLA } : { data: resolver(), error: null }
          return Promise.resolve(r).then(ok, ko)
        },
      }
      return chain
    },
  }
}
