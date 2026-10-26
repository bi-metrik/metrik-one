/**
 * Proveedores de Airtable → SQL idempotente para un workspace de ONE (Mauricio, 2026-10-18).
 *
 * NO se conecta a nada: lee archivos y escribe el SQL. Quien lo aplica (MCP execute_sql) es otra
 * persona, después de leer la lista de revisión. Nunca comitees el JSON de entrada ni la salida:
 * son datos del cliente. Pásalos con rutas FUERA del repo.
 *
 *   npx tsx scripts/importar-proveedores-airtable.ts <entrada.json> --workspace <slug|uuid> \
 *     [--conocidos conocidos.json] [--decisiones decisiones.json] [--salida importar.sql]
 *
 *   npx tsx scripts/importar-proveedores-airtable.ts --consulta-conocidos --workspace trappvel
 *     → imprime la consulta de SOLO LECTURA cuyo resultado (el JSON) va en --conocidos.
 *
 * - entrada.json: array de filas de Airtable ({ id: "rec…", creado, "Nombre proveedor", … }).
 * - conocidos.json: lo que devuelve la consulta de arriba (los hoteles y tours que el espacio ya
 *   tiene). Sin él, solo se une por la llave exacta; con él, también «mismas palabras» (con alias)
 *   y las dudas van a revisión.
 * - decisiones.json: { "recXXX": "nuevo" | "<llave del perfil>" } para las dudas ya resueltas.
 *
 * La lista de revisión sale en el encabezado del SQL y por stderr.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { consultaConocidos, prepararImportacion, sqlDeImportacion, type ConocidoImportacion, type Decisiones, type FilaAirtable } from '@/lib/proveedores/importar-airtable'

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(nombre)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

function leerJson<T>(ruta: string): T {
  return JSON.parse(readFileSync(resolve(ruta), 'utf8')) as T
}

function main() {
  const workspace = arg('--workspace')
  if (!workspace) {
    console.error('Falta --workspace <slug|uuid>. Ver el encabezado del script.')
    process.exit(1)
  }
  if (process.argv.includes('--consulta-conocidos')) {
    console.log(consultaConocidos(workspace))
    return
  }
  const entrada = process.argv[2]
  if (!entrada || entrada.startsWith('--')) {
    console.error('Uso: npx tsx scripts/importar-proveedores-airtable.ts <entrada.json> --workspace <slug|uuid> [--conocidos c.json] [--decisiones d.json] [--salida s.sql]')
    process.exit(1)
  }
  if (resolve(entrada).startsWith(resolve(__dirname, '..'))) {
    console.error('⚠️  La entrada está DENTRO del repo. Muévela fuera: son datos del cliente y no se comitean.')
    process.exit(1)
  }
  const filas = leerJson<FilaAirtable[]>(entrada)
  if (!Array.isArray(filas)) throw new Error('La entrada tiene que ser un array de filas')
  const rutaConocidos = arg('--conocidos')
  const rutaDecisiones = arg('--decisiones')
  const conocidosCrudos = rutaConocidos ? leerJson<unknown>(rutaConocidos) : []
  // El resultado de execute_sql puede venir como [{ coalesce: [...] }] o como el array solo.
  const conocidos = (
    Array.isArray(conocidosCrudos) && conocidosCrudos.length === 1 && conocidosCrudos[0] && typeof conocidosCrudos[0] === 'object' && !('clave' in conocidosCrudos[0])
      ? Object.values(conocidosCrudos[0] as object)[0]
      : conocidosCrudos
  ) as ConocidoImportacion[]
  const decisiones = rutaDecisiones ? leerJson<Decisiones>(rutaDecisiones) : {}

  const imp = prepararImportacion(filas, { conocidos, decisiones })
  const sql = sqlDeImportacion(imp, workspace)
  const salida = arg('--salida')
  if (salida) {
    if (resolve(salida).startsWith(resolve(__dirname, '..'))) {
      console.error('⚠️  La salida está DENTRO del repo. Escríbela fuera: lleva datos del cliente.')
      process.exit(1)
    }
    writeFileSync(resolve(salida), sql)
  } else {
    process.stdout.write(sql)
  }
  console.error(`Filas: ${filas.length}. Proveedores en el SQL: ${imp.proveedores.length} (${imp.proveedores.filter((p) => p.union).length} se unen a una ficha que ya existe).`)
  console.error(`Tarifarios registrados: ${imp.proveedores.reduce((n, p) => n + p.tarifarios.length, 0)} (los archivos se suben aparte).`)
  if (imp.revision.length > 0) {
    console.error(`\nREVISAR (${imp.revision.length}):`)
    for (const r of imp.revision) console.error(`  ${r.excluida ? '[NO SE IMPORTA] ' : ''}${r.rec} «${r.nombre}»: ${r.motivo}`)
  }
}

main()
