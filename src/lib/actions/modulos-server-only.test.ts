/**
 * Funciones sin sesion que NO pueden ser server actions.
 *
 * En un archivo `'use server'` todo export es un endpoint alcanzable por POST en cuanto
 * algo lo importa desde el grafo de la app. Estas cuatro funciones no piden sesion ni
 * miran el workspace, porque la sesion la resuelve quien las llama:
 *
 *   - `proponerCentroCostos({ workspaceId, ... })` leia proveedores e historial de gastos
 *     del workspace que le pasaran (registrada en el manifiesto del build).
 *   - `registrarMapeoAutomatico(gastoId)` escribia reglas en `gastos_recurrentes_map` del
 *     workspace de cualquier gasto (registrada en el manifiesto del build).
 *   - `generarContratoAFI(negocio_id)` y `disparararGeneracionAFI(negocio_id)` generan y
 *     suben documentos con el cliente de servicio. Hoy solo las importan rutas `route.ts`,
 *     que no registran server actions, asi que eran latentes: el dia que una pagina las
 *     importara nacerian endpoints sin ningun control.
 *
 * Lo que se fija es DONDE viven, leyendo el fuente: una prueba de comportamiento daria
 * igual con la funcion en un archivo `'use server'` o fuera de el.
 *
 * Tercera ronda: VISTO FALLAR contra `origin/main` el caso de `cargarConfigPeriodicidad`
 * (su archivo nuevo no existe y `compliance-periodicidad.ts`, que es `'use server'`, la exporta).
 *
 * VISTO FALLAR (2026-09-16):
 *   - contra `origin/main` caen 7 de 8 (los tres archivos empiezan con `'use server'` y
 *     ninguno importa `server-only`). La octava pasa en los dos lados: vigila una
 *     regresion futura, no el hueco de hoy;
 *   - esa octava cae (1) si `nuevo-gasto-form.tsx` cambia su `import type { ... }` por
 *     `import { type ... }`, que segun el compilador puede dejar un import vivo del modulo
 *     server-only dentro del bundle del navegador.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const leer = (ruta: string) => readFileSync(ruta, 'utf8')

/**
 * La directiva cuenta solo si es la primera sentencia del archivo (se permiten comentarios
 * antes). Buscar el literal en cualquier parte daria falsos positivos con los comentarios
 * que la mencionan, como los de estos mismos modulos.
 */
function esUseServer(fuente: string): boolean {
  const sinCabecera = fuente.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '')
  return /^['"]use server['"]/.test(sinCabecera)
}

function archivosTs(dir: string): string[] {
  const salida: string[] = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) salida.push(...archivosTs(ruta))
    else if (/\.tsx?$/.test(nombre) && !nombre.endsWith('.test.ts')) salida.push(ruta)
  }
  return salida
}

const CASOS = [
  { modulo: 'src/lib/actions/centro-costos-asignar.ts', funciones: ['proponerCentroCostos', 'registrarMapeoAutomatico'] },
  { modulo: 'src/lib/afi/generar-contrato.ts', funciones: ['generarContratoAFI'] },
  { modulo: 'src/lib/afi/generar-paquete.ts', funciones: ['disparararGeneracionAFI'] },
  // Tercera ronda (2026-09-16): `cargarConfigPeriodicidad(workspaceId)` estaba registrada en
  // el manifiesto y devolvia la politica de cualquier workspace sin pedir sesion. Y las dos
  // puertas nuevas reciben el workspace o el id por parametro: tampoco pueden ser endpoints.
  { modulo: 'src/lib/compliance/periodicidad-config.ts', funciones: ['cargarConfigPeriodicidad'] },
  { modulo: 'src/lib/modulos/exigir-modulo.ts', funciones: ['exigirModulo'] },
  { modulo: 'src/lib/almacenamiento/drive-del-workspace.ts', funciones: ['archivoDriveOperable'] },
]

const TODOS_LOS_TS = archivosTs('src')

describe('funciones sin sesion fuera de los archivos use server', () => {
  for (const { modulo, funciones } of CASOS) {
    it(`${modulo} empieza con import 'server-only' y no es use server`, () => {
      const fuente = leer(modulo)
      expect(fuente.startsWith("import 'server-only'")).toBe(true)
      expect(esUseServer(fuente)).toBe(false)
    })

    for (const fn of funciones) {
      it(`ningun archivo use server exporta ${fn}`, () => {
        const culpables = TODOS_LOS_TS.filter((ruta) => {
          const fuente = leer(ruta)
          return esUseServer(fuente) && new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`).test(fuente)
        })
        expect(culpables).toEqual([])
      })
    }
  }

  it('los componentes de cliente solo importan TIPOS del motor de centro de costos', () => {
    const importadores = TODOS_LOS_TS.filter((ruta) => leer(ruta).includes("from '@/lib/actions/centro-costos-asignar'"))
    for (const ruta of importadores) {
      const fuente = leer(ruta)
      if (!/^['"]use client['"]/m.test(fuente)) continue
      const importaValores = /import\s+\{[^}]*\}\s+from\s+'@\/lib\/actions\/centro-costos-asignar'/.test(fuente)
      expect(importaValores, `${ruta} importa valores (no tipos) de un modulo server-only`).toBe(false)
    }
  })
})
