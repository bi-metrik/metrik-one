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

/**
 * El doble en memoria. `esquema` dice qué columnas tiene cada tabla (lo que en la base da
 * PostgREST); `llaves` declara las llaves foráneas que el doble hace cumplir al borrar, para
 * que el orden del borrado se pruebe de verdad y no por suerte.
 */
export function almacenEnMemoria(opts: {
  tablas: Record<string, Fila[]>
  esquema: Record<string, string[]>
  llaves?: { tabla: string; columna: string; apunta: string }[]
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
      for (const f of nuevas) {
        filas(tabla).push({ ...f })
        opts.disparadores?.alInsertar?.(tabla, f, estado)
      }
    },
    async actualizar(tabla, id, patch) {
      for (const f of filas(tabla)) if (f.id === id) Object.assign(f, patch)
    },
    async guardar(tabla, fila, conflicto = 'id') {
      const previa = filas(tabla).find(f => f[conflicto] === fila[conflicto])
      if (previa) Object.assign(previa, fila)
      else filas(tabla).push({ id: `fila-${++n}`, ...fila })
    },
    async borrar(tabla, filtros) {
      const van = filas(tabla).filter(f => cumple(f, filtros))
      const ids = new Set(van.map(f => f.id))
      for (const l of llaves.filter(k => k.apunta === tabla)) {
        if (filas(l.tabla).some(f => ids.has(f[l.columna]))) {
          return { borradas: 0, error: { code: '23503', message: `${l.tabla}.${l.columna} apunta a ${tabla}` } }
        }
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
