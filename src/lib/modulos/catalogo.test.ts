/**
 * El catálogo de módulos no puede quedarse atrás del código ni de la base.
 *
 * 1. **Rutas sin dueño.** Toda carpeta de `src/app/(app)` es de algún módulo o es común. Una
 *    ruta nueva obliga a decidir a qué módulo pertenece: sin eso, el gate la deja abierta para
 *    cualquier workspace y el primer cliente de un solo módulo la encuentra.
 * 2. **Vocabulario de la base.** `workspace_modulos.modulo` (CHECK) y `proyectar_modulos`
 *    (arreglo de llaves de módulo) repiten la lista de `CLAVES_DE_MODULO`. Se leen de la última
 *    migración que las define y se comparan: una lista copiada se desincroniza en silencio.
 * 3. **Llaves medidas.** Toda llave que hoy existe en `workspaces.modules` está clasificada
 *    como módulo o como función. Una llave sin clasificar es una que la proyección no sabría
 *    si recalcular o conservar.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CLAVES_DE_MODULO,
  IDS_MODULO,
  MODULOS,
  RUTAS_COMUNES,
  RUTAS_POR_FUNCION,
  RUTAS_VITRINA,
} from './catalogo'
import { modulosDeRuta } from './gate'
import { WORKSPACES_2026_09_15 } from './__fixtures__/workspaces-2026-09-15'

const RAIZ = path.resolve(__dirname, '../../..')
const APP = path.join(RAIZ, 'src/app/(app)')
const MIGRACIONES = path.join(RAIZ, 'supabase/migrations')

/** Rutas declaradas en el catálogo cuya carpeta todavía no existe, con la entrega que la crea. */
const RUTAS_POR_CONSTRUIR: Record<string, string> = {
  '/valida-api': 'entrega C2 (módulo Valida API en ONE)',
}

/**
 * Primer segmento de URL de cada carpeta. Un `(grupo)` no es segmento: se entra a sus hijas.
 * Una `_privada` no es ruta. Un `[param]` de primer nivel SÍ se lista (y fallará por no tener
 * dueño): capturaría todas las URLs y hay que decidir qué hacer con él a propósito.
 */
function carpetasDeLaApp(dir = APP): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .flatMap((d) => (d.name.startsWith('(') ? carpetasDeLaApp(path.join(dir, d.name)) : [`/${d.name}`]))
    .sort()
}

describe('rutas de src/app/(app)', () => {
  const carpetas = carpetasDeLaApp()

  it('la lectura de carpetas encuentra la app (guard: sin esto la prueba pasaría vacía)', () => {
    expect(carpetas).toContain('/negocios')
    expect(carpetas).toContain('/valida')
    expect(carpetas.length).toBeGreaterThan(20)
  })

  it('toda carpeta es de algún módulo o es común', () => {
    const sinDueno = carpetas.filter(
      (r) => modulosDeRuta(r).length === 0 && !(RUTAS_COMUNES as readonly string[]).includes(r),
    )
    expect(
      sinDueno,
      `Estas rutas no tienen módulo dueño. Declaralas en MODULOS o en RUTAS_COMUNES de src/lib/modulos/catalogo.ts: ${sinDueno.join(', ')}`,
    ).toEqual([])
  })

  it('ninguna ruta es a la vez común y de un módulo (el gate ignoraría al módulo)', () => {
    const ambas = RUTAS_COMUNES.filter((r) => modulosDeRuta(r).length > 0)
    expect(ambas).toEqual([])
  })

  it('toda ruta declarada existe como carpeta, salvo las que están por construir', () => {
    const declaradas = [
      ...new Set([...IDS_MODULO.flatMap((id) => MODULOS[id].rutas), ...RUTAS_COMUNES]),
    ]
    const huerfanas = declaradas.filter((r) => !carpetas.includes(r) && !(r in RUTAS_POR_CONSTRUIR))
    expect(huerfanas, `Rutas del catálogo sin carpeta: ${huerfanas.join(', ')}`).toEqual([])
  })

  it('las rutas de vitrina y por función caen dentro de rutas con dueño', () => {
    for (const r of RUTAS_VITRINA) expect(modulosDeRuta(r), r).toContain('clarity')
    for (const f of RUTAS_POR_FUNCION) expect(modulosDeRuta(f.ruta).length, f.ruta).toBeGreaterThan(0)
  })
})

describe('vocabulario de llaves', () => {
  const funciones = IDS_MODULO.flatMap((id) => MODULOS[id].funciones as readonly string[])

  it('las llaves de módulo son únicas y no se cruzan con las de función', () => {
    expect(new Set(CLAVES_DE_MODULO).size).toBe(CLAVES_DE_MODULO.length)
    expect(funciones.filter((f) => CLAVES_DE_MODULO.includes(f))).toEqual([])
    expect(new Set(funciones).size).toBe(funciones.length)
  })

  it('las funciones que abren rutas están declaradas en algún módulo', () => {
    for (const f of RUTAS_POR_FUNCION) expect(funciones, f.funcion).toContain(f.funcion)
  })

  it('toda llave medida en producción el 2026-09-15 está clasificada', () => {
    const medidas = [...new Set(WORKSPACES_2026_09_15.flatMap((w) => Object.keys(w.modules)))]
    const sinClasificar = medidas.filter((k) => !CLAVES_DE_MODULO.includes(k) && !funciones.includes(k))
    expect(medidas.length).toBeGreaterThan(20)
    expect(sinClasificar, `Llaves de workspaces.modules sin clasificar: ${sinClasificar.join(', ')}`).toEqual([])
  })
})

describe('la base usa las mismas llaves de módulo que el catálogo', () => {
  const archivos = readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort()

  /** El contenido de la ÚLTIMA migración que contiene el marcador: esa es la definición vigente. */
  function ultimaQueDefine(marcador: RegExp): { archivo: string; sql: string } {
    const conMarcador = archivos.filter((f) => marcador.test(readFileSync(path.join(MIGRACIONES, f), 'utf8')))
    const archivo = conMarcador.at(-1)
    if (!archivo) throw new Error(`Ninguna migración contiene ${marcador}`)
    return { archivo, sql: readFileSync(path.join(MIGRACIONES, archivo), 'utf8') }
  }

  const literales = (texto: string) => [...texto.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  const esperadas = [...CLAVES_DE_MODULO].sort()

  it('CHECK workspace_modulos_modulo', () => {
    const { archivo, sql } = ultimaQueDefine(/constraint\s+workspace_modulos_modulo\s+check/i)
    const lista = sql.match(/constraint\s+workspace_modulos_modulo\s+check\s*\(\s*modulo\s+in\s*\(([^)]*)\)/i)
    expect(lista, `${archivo}: no se encontró la lista del CHECK`).not.toBeNull()
    expect(literales(lista![1]), archivo).toEqual(esperadas)
  })

  it('arreglo de llaves de módulo de proyectar_modulos', () => {
    const { archivo, sql } = ultimaQueDefine(/create\s+or\s+replace\s+function\s+public\.proyectar_modulos/i)
    const arreglo = sql.match(/v_claves_modulo\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/i)
    expect(arreglo, `${archivo}: no se encontró v_claves_modulo`).not.toBeNull()
    expect(literales(arreglo![1]), archivo).toEqual(esperadas)
  })
})
