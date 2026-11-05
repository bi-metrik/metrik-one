import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REGLAMENTO_DIMPRO } from './reglamento-dimpro'
import { actualizacionSqlDimpro, CLAVES_BANCO_5NOV, TEXTOS_BANCO_5NOV } from './semilla-sql-dimpro'

/** Las fichas que cambió el banco del 5-nov (Haiku real, k=3) y su SQL. */
describe('fichas del banco del 5-nov', () => {
  const ficha = (c: string) => REGLAMENTO_DIMPRO.find((f) => f.clave === c)!

  it('el archivo es la salida del generador', () => {
    const sql = readFileSync(join(process.cwd(), 'sql/dimpro/2026-11-05_banco-5nov.sql'), 'utf8')
    expect(sql.trimEnd()).toBe(actualizacionSqlDimpro(CLAVES_BANCO_5NOV, REGLAMENTO_DIMPRO, TEXTOS_BANCO_5NOV).trimEnd())
  })

  it('el «sí» a «¿Necesitas algo más?» pregunta qué más; el uso va con sus palabras; lo que no está no repite datos', () => {
    expect(ficha('alc.complemento').hacer).toMatch(/ese «sí» no es la autorización de datos/)
    expect(ficha('alc.producto').hacer).toMatch(/con SUS palabras y no con las de tu pregunta/)
    expect(ficha('alc.especificacion').hacer).toMatch(/sin volver a decir datos que ya le diste/)
    expect(ficha('alc.especificacion').hacer).not.toMatch(/lo que sí sabes/)
    expect(ficha('proc.compra').hacer).toMatch(/si ya la dijo en cualquier mensaje, como «con despacho en Bogotá» o «lo recojo», NO la preguntes/)
  })
})
