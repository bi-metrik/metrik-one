import 'server-only'

/**
 * La instrucción del motor de extracción de tarifarios (Mauricio, 2026-10-19): vive en el repo como
 * ARCHIVO, una versión por archivo (`instruccion/v13.md`). La siguiente llega igual, como archivo
 * nuevo, y se cambia `INSTRUCCION_VERSION`. La versión se guarda en
 * `proveedor_extracciones.instruccion_version` junto con el modelo.
 *
 * El archivo se lee en el servidor (la ruta de la ficha lo incluye en `outputFileTracingIncludes`).
 * Trae escrita la fecha del día en que se redactó («Fecha de hoy: AAAA-MM-DD», con ella el motor
 * decide qué está vencido): se cambia por la de hoy en Bogotá al mandarla.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { conFechaDeHoy } from './instruccion-texto'

export const INSTRUCCION_VERSION = 'v13'

const RUTA = join(process.cwd(), 'src/lib/proveedores/instruccion', `${INSTRUCCION_VERSION}.md`)

let cache: string | null = null

/** La instrucción vigente, con la fecha de hoy. */
export function instruccionVigente(hoy: string): string {
  cache ??= readFileSync(RUTA, 'utf8')
  return conFechaDeHoy(cache, hoy)
}
