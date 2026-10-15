// ============================================================
// Doble de Supabase para el cargue masivo de Valida en el servidor (2026-10-15).
//
// Tablas en memoria que APLICAN los filtros (eq, in, is, not is, gte numérico y de texto, lt,
// order, range, limit), insert con la llave única `valida_consultas.lote_fila_id` (error 23505
// como PostgREST), update y delete con filtros, `count` con `head`, y las cinco RPC de la
// migración `20261015231700_valida_lotes_servidor.sql` escritas en JS con la MISMA regla. Las RPC
// de verdad se prueban en PGlite (`lote-sql.test.ts`); aquí sirven para correr el trabajador entero.
//
// Cada operación cede el turno (`await` de un microtask) para que los corredores concurrentes se
// intercalen como lo harían contra la base.
// ============================================================

export type Fila = Record<string, unknown>

export type DobleLotes = ReturnType<typeof crearDobleLotes>

let secuencia = 0
const uuid = () => `00000000-0000-4000-8000-${String(++secuencia).padStart(12, '0')}`

export function crearDobleLotes(opciones: { ahora?: () => number; tablas?: Record<string, Fila[]> } = {}) {
  const ahora = opciones.ahora ?? Date.now
  const tablas: Record<string, Fila[]> = opciones.tablas ?? {}
  const t = (n: string) => (tablas[n] ??= [])
  const iso = (ms: number) => new Date(ms).toISOString()
  const ceder = () => new Promise<void>((r) => setTimeout(r, 0))
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []
  const huellas = new Map<string, string>()

  function from(tabla: string) {
    const filtros: Array<(f: Fila) => boolean> = []
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Fila | Fila[] = {}
    let conSelect = false
    let contar = false
    let soloCuenta = false
    let orden: { c: string; asc: boolean } | null = null
    let rango: [number, number] | null = null
    let tope: number | null = null

    const correr = async (): Promise<{ data: unknown; error: { code?: string; message: string } | null; count?: number }> => {
      await ceder()
      const filas = t(tabla)
      if (op === 'insert') {
        const nuevas = (Array.isArray(payload) ? payload : [payload]).map((f) => ({ id: uuid(), created_at: iso(ahora()), ...f }))
        if (tabla === 'valida_consultas') {
          for (const n of nuevas) {
            if (n.lote_fila_id && filas.some((f) => f.lote_fila_id === n.lote_fila_id)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "valida_consultas_lote_fila_unica"' } }
            }
          }
        }
        if (tabla === 'valida_lotes') {
          for (const n of nuevas) {
            n.estado ??= 'preparando'
            n.procesadas ??= 0
            n.severidades ??= {}
            n.omitidas ??= 0
          }
        }
        if (tabla === 'valida_lote_filas') {
          for (const n of nuevas) {
            n.estado ??= 'pendiente'
            n.intentos ??= 0
          }
        }
        filas.push(...nuevas)
        return { data: conSelect ? nuevas.map((f) => ({ ...f })) : null, error: null }
      }
      let elegidas = filas.filter((f) => filtros.every((p) => p(f)))
      if (op === 'update') {
        const cambio = payload as Fila
        // La llave única de un lote activo por espacio.
        if (tabla === 'valida_lotes' && (cambio.estado === 'en_cola' || cambio.estado === 'procesando')) {
          for (const f of elegidas) {
            const otro = filas.some(
              (o) => o !== f && o.workspace_id === f.workspace_id && (o.estado === 'en_cola' || o.estado === 'procesando'),
            )
            if (otro) return { data: null, error: { code: '23505', message: 'valida_lotes_uno_activo_por_espacio' } }
          }
        }
        elegidas.forEach((f) => Object.assign(f, cambio))
        return { data: conSelect ? elegidas.map((f) => ({ ...f })) : null, error: null }
      }
      if (op === 'delete') {
        tablas[tabla] = filas.filter((f) => !elegidas.includes(f))
        // Cascada del lote a sus filas.
        if (tabla === 'valida_lotes') {
          const ids = new Set(elegidas.map((f) => f.id))
          tablas.valida_lote_filas = t('valida_lote_filas').filter((f) => !ids.has(f.lote_id))
        }
        return { data: null, error: null }
      }
      if (orden) {
        const { c, asc } = orden
        elegidas = [...elegidas].sort((a, b) => {
          const x = a[c] as number | string
          const y = b[c] as number | string
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1)
        })
      }
      const total = elegidas.length
      if (rango) elegidas = elegidas.slice(rango[0], rango[1] + 1)
      if (tope !== null) elegidas = elegidas.slice(0, tope)
      return { data: soloCuenta ? null : elegidas.map((f) => ({ ...f })), error: null, ...(contar ? { count: total } : {}) }
    }

    const q: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => {
        conSelect = true
        if (o?.count) contar = true
        if (o?.head) soloCuenta = true
        return q
      },
      insert: (p: Fila | Fila[]) => { op = 'insert'; payload = p; return q },
      update: (p: Fila) => { op = 'update'; payload = p; return q },
      delete: () => { op = 'delete'; return q },
      eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return q },
      in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q },
      is: (c: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) === v); return q },
      not: (c: string, o: string, v: unknown) => { filtros.push((f) => (o === 'is' ? (f[c] ?? null) !== v : f[c] !== v)); return q },
      gte: (c: string, v: number | string) => {
        filtros.push((f) => (typeof v === 'number' ? Number(f[c]) >= v : String(f[c] ?? '') >= v))
        return q
      },
      lt: (c: string, v: string) => { filtros.push((f) => String(f[c] ?? '') < v); return q },
      // `despertado_at.is.null,despertado_at.lt.<iso>`: lo único que usa el código.
      or: (expr: string) => {
        const m = /^(\w+)\.is\.null,\1\.lt\.(.+)$/.exec(expr)
        if (m) filtros.push((f) => f[m[1]] == null || String(f[m[1]]) < m[2])
        return q
      },
      order: (c: string, o?: { ascending?: boolean }) => { orden = { c, asc: o?.ascending !== false }; return q },
      range: (d: number, h: number) => { rango = [d, h]; return q },
      limit: (n: number) => { tope = n; return q },
      single: async () => {
        const r = await correr()
        if (r.error) return r
        const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data
        return { data: d, error: d ? null : { message: 'sin fila' } }
      },
      maybeSingle: async () => {
        const r = await correr()
        if (r.error) return r
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => correr().then(ok, ko),
    }
    return q
  }

  async function rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
    await ceder()
    rpcs.push({ fn, args })
    const lotes = t('valida_lotes')
    const filas = t('valida_lote_filas')
    const ms = ahora()
    if (fn === 'valida_lote_tomar_turno') {
      const ocupados = lotes.filter((l) => l.estado === 'procesando' && l.turno_hasta && Date.parse(l.turno_hasta as string) > ms).length
      if (ocupados >= (args.p_max_simultaneos as number)) return { data: [], error: null }
      const libre = lotes
        .filter((l) => (l.estado === 'en_cola' || l.estado === 'procesando') && (!l.turno_hasta || Date.parse(l.turno_hasta as string) <= ms))
        .sort((a, b) => {
          const x = (a.ultimo_turno_at as string | null) ?? ''
          const y = (b.ultimo_turno_at as string | null) ?? ''
          return x < y ? -1 : x > y ? 1 : String(a.created_at) < String(b.created_at) ? -1 : 1
        })[0]
      if (!libre) return { data: [], error: null }
      Object.assign(libre, {
        estado: 'procesando',
        trabajador: args.p_trabajador,
        turno_hasta: iso(ms + (args.p_turno_s as number) * 1000),
        ultimo_turno_at: iso(ms),
      })
      return { data: [{ ...libre }], error: null }
    }
    if (fn === 'valida_lote_reclamar_fila') {
      const lote = lotes.find((l) => l.id === args.p_lote && l.estado === 'procesando' && l.trabajador === args.p_trabajador)
      if (!lote) return { data: [], error: null }
      const fila = filas
        .filter((f) => f.lote_id === args.p_lote && (f.estado === 'pendiente' || (f.estado === 'en_curso' && Date.parse(f.reclamada_hasta as string) <= ms)))
        .sort((a, b) => (a.posicion as number) - (b.posicion as number))[0]
      if (!fila) return { data: [], error: null }
      Object.assign(fila, {
        estado: 'en_curso',
        intentos: (fila.intentos as number) + 1,
        reclamada_hasta: iso(ms + (args.p_reclamo_s as number) * 1000),
      })
      return { data: [{ ...fila }], error: null }
    }
    if (fn === 'valida_lote_fila_terminar') {
      const fila = filas.find((f) => f.id === args.p_fila && f.estado === 'en_curso')
      if (!fila) return { data: false, error: null }
      Object.assign(fila, {
        estado: args.p_estado,
        severidad: args.p_severidad,
        consulta_local_id: args.p_consulta_local_id,
        valida_consulta_id: args.p_valida_consulta_id,
        total_matches: args.p_total_matches,
        resultado_error: args.p_error,
        reclamada_hasta: null,
      })
      const lote = lotes.find((l) => l.id === fila.lote_id)!
      const sev = { ...(lote.severidades as Record<string, number>) }
      const k = args.p_severidad_conteo as string
      sev[k] = (sev[k] ?? 0) + 1
      Object.assign(lote, { procesadas: (lote.procesadas as number) + 1, severidades: sev })
      return { data: true, error: null }
    }
    if (fn === 'valida_lote_cerrar_turno') {
      const lote = lotes.find((l) => l.id === args.p_lote && l.trabajador === args.p_trabajador)
      if (!lote) return { data: null, error: null }
      const quedan = filas.some((f) => f.lote_id === lote.id && (f.estado === 'pendiente' || f.estado === 'en_curso'))
      if (lote.estado === 'procesando' && !quedan) lote.estado = 'completado'
      Object.assign(lote, { trabajador: null, turno_hasta: null })
      return { data: lote.estado, error: null }
    }
    if (fn === 'valida_lote_huella_acceso') {
      return { data: huellas.get(args.p_workspace as string) ?? '', error: null }
    }
    return { data: null, error: { message: `rpc desconocida en el doble: ${fn}` } }
  }

  return { tablas, from, rpc, rpcs, huellas }
}
