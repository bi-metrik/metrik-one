/**
 * Por dónde lee y escribe el clonador del espacio de pruebas.
 *
 * Dos implementaciones: la de verdad (Supabase con la llave de servicio, en
 * `scripts/clonar-config-workspace.ts`) y la de memoria de aquí, que es el DOBLE contra el
 * que corren la prueba y el simulacro de `--doble`. El plan (`plan.ts`) solo ve esta interfaz.
 */

export type Fila = Record<string, unknown>

/** `[columna, 'eq', valor]` o `[columna, 'in', valores]`. */
export type Filtro = [string, 'eq', unknown] | [string, 'in', unknown[]]

interface ResultadoBorrado {
  borradas: number
  error: { code?: string; message: string } | null
}

export interface Almacen {
  leer(tabla: string, filtros: Filtro[]): Promise<Fila[]>
  contar(tabla: string, filtros: Filtro[]): Promise<number>
  insertar(tabla: string, filas: Fila[]): Promise<void>
  actualizar(tabla: string, id: string, patch: Fila): Promise<void>
  /**
   * Upsert por `conflicto` (por defecto `id`). Para `profiles` (el id lo pone Auth) y para
   * `fiscal_profiles`, cuya fila la crea un trigger al nacer el workspace.
   */
  guardar(tabla: string, fila: Fila, conflicto?: string): Promise<void>
  borrar(tabla: string, filtros: Filtro[]): Promise<ResultadoBorrado>
  /** Las TABLAS de `public` (no vistas) que se pueden borrar, con sus columnas. */
  tablas(): Promise<Map<string, string[]>>
  /** El id de Auth de un correo, o `null`. */
  buscarUsuario(correo: string): Promise<string | null>
  crearUsuario(correo: string, nombre: string): Promise<string>
  borrarUsuario(id: string): Promise<void>
  /** Los objetos de Storage bajo un prefijo, en todos los buckets. */
  archivos(prefijo: string): Promise<{ bucket: string; ruta: string }[]>
  borrarArchivos(lista: { bucket: string; ruta: string }[]): Promise<void>
}

function cumple(f: Fila, filtros: Filtro[]): boolean {
  return filtros.every(([col, op, val]) =>
    op === 'eq' ? f[col] === val : (val as unknown[]).includes(f[col]),
  )
}

/** Una llave foránea del doble. `alBorrar` es la acción de la base (por defecto, frena). */
export interface LlaveForanea {
  tabla: string
  columna: string
  apunta: string
  alBorrar?: 'restrict' | 'set null' | 'cascade'
}

/**
 * El doble en memoria. `esquema` dice qué columnas tiene cada tabla (lo que en la base da
 * PostgREST); `llaves` declara las llaves foráneas que el doble hace cumplir AL ESCRIBIR
 * (insertar, guardar, actualizar: al cierre de la sentencia, como Postgres con una llave no
 * diferible) y AL BORRAR (frena, anula o borra en cascada según `alBorrar`), para que el orden
 * de la escritura y del borrado se prueben de verdad y no por suerte. Antes solo las cumplía
 * al borrar, y el primer `--apply` contra la base cayó por `workspaces.linea_activa_id`
 * apuntando a una línea que todavía no existía (2026-10-14).
 */
export function almacenEnMemoria(opts: {
  tablas: Record<string, Fila[]>
  esquema: Record<string, string[]>
  llaves?: LlaveForanea[]
  usuarios?: { id: string; correo: string }[]
  archivos?: { bucket: string; ruta: string }[]
  /** Lo que en la base hacen los triggers (sembrar al crear un workspace, registrar al borrar una etapa). */
  disparadores?: {
    alInsertar?: (tabla: string, fila: Fila, estado: Record<string, Fila[]>) => void
    alBorrar?: (tabla: string, fila: Fila, estado: Record<string, Fila[]>) => void
  }
}): Almacen & { estado: Record<string, Fila[]>; usuarios: { id: string; correo: string }[]; objetos: { bucket: string; ruta: string }[] } {
  const estado = opts.tablas
  const usuarios = opts.usuarios ?? []
  const objetos = opts.archivos ?? []
  const llaves = opts.llaves ?? []
  let n = 0
  const filas = (t: string) => (estado[t] ??= [])

  /** Lo que Postgres diría al cierre de la sentencia si alguna fila escrita apunta a la nada. */
  const violacion = (tabla: string, escritas: Fila[]): string | null => {
    for (const l of llaves.filter(k => k.tabla === tabla)) {
      for (const f of escritas) {
        const v = f[l.columna]
        if (v == null) continue
        if (!filas(l.apunta).some(x => x.id === v)) {
          return `insert or update on table "${tabla}" violates foreign key constraint "${tabla}_${l.columna}_fkey"`
        }
      }
    }
    return null
  }

  return {
    estado,
    usuarios,
    objetos,
    async leer(tabla, filtros) {
      return filas(tabla).filter(f => cumple(f, filtros)).map(f => ({ ...f }))
    },
    async contar(tabla, filtros) {
      return filas(tabla).filter(f => cumple(f, filtros)).length
    },
    async insertar(tabla, nuevas) {
      // Una sentencia: todas las filas entran y la llave se revisa al final (una fila puede
      // apuntar a otra del mismo lote). Si falla, no queda ninguna.
      const copias = nuevas.map(f => ({ ...f }))
      filas(tabla).push(...copias)
      const error = violacion(tabla, copias)
      if (error) {
        estado[tabla] = filas(tabla).filter(f => !copias.includes(f))
        throw new Error(`insertar ${tabla}: ${error}`)
      }
      for (const f of nuevas) opts.disparadores?.alInsertar?.(tabla, f, estado)
    },
    async actualizar(tabla, id, patch) {
      const van = filas(tabla).filter(f => f.id === id)
      const error = violacion(tabla, van.map(f => ({ ...f, ...patch })))
      if (error) throw new Error(`actualizar ${tabla}: ${error}`)
      for (const f of van) Object.assign(f, patch)
    },
    async guardar(tabla, fila, conflicto = 'id') {
      const previa = filas(tabla).find(f => f[conflicto] === fila[conflicto])
      const error = violacion(tabla, [{ ...(previa ?? {}), ...fila }])
      if (error) throw new Error(`guardar ${tabla}: ${error}`)
      if (previa) Object.assign(previa, fila)
      else filas(tabla).push({ id: `fila-${++n}`, ...fila })
    },
    async borrar(tabla, filtros) {
      const van = filas(tabla).filter(f => cumple(f, filtros))
      const ids = new Set(van.map(f => f.id))
      const hijas = (l: LlaveForanea) => filas(l.tabla).filter(f => ids.has(f[l.columna]) && !(l.tabla === tabla && van.includes(f)))
      for (const l of llaves.filter(k => k.apunta === tabla && (k.alBorrar ?? 'restrict') === 'restrict')) {
        if (hijas(l).length) {
          return { borradas: 0, error: { code: '23503', message: `${l.tabla}.${l.columna} apunta a ${tabla}` } }
        }
      }
      for (const l of llaves.filter(k => k.apunta === tabla && k.alBorrar === 'set null')) {
        for (const f of hijas(l)) f[l.columna] = null
      }
      for (const l of llaves.filter(k => k.apunta === tabla && k.alBorrar === 'cascade')) {
        const cascada = hijas(l)
        if (cascada.length) estado[l.tabla] = filas(l.tabla).filter(f => !cascada.includes(f))
      }
      estado[tabla] = filas(tabla).filter(f => !van.includes(f))
      for (const f of van) opts.disparadores?.alBorrar?.(tabla, f, estado)
      return { borradas: van.length, error: null }
    },
    async tablas() {
      return new Map(Object.entries(opts.esquema))
    },
    async buscarUsuario(correo) {
      return usuarios.find(u => u.correo === correo.toLowerCase())?.id ?? null
    },
    async crearUsuario(correo) {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
      usuarios.push({ id, correo: correo.toLowerCase() })
      return id
    },
    async borrarUsuario(id) {
      const i = usuarios.findIndex(u => u.id === id)
      if (i >= 0) usuarios.splice(i, 1)
    },
    async archivos(prefijo) {
      return objetos.filter(o => o.ruta.startsWith(prefijo))
    },
    async borrarArchivos(lista) {
      for (const o of lista) {
        const i = objetos.findIndex(x => x.bucket === o.bucket && x.ruta === o.ruta)
        if (i >= 0) objetos.splice(i, 1)
      }
    },
  }
}
