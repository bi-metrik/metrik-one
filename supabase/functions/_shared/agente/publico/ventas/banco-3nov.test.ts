import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REGLAMENTO_DIMPRO } from './reglamento-dimpro'
import { actualizacionSqlDimpro, CLAVES_BANCO_3NOV, TEXTOS_BANCO_3NOV } from './semilla-sql-dimpro'

/** Las fichas que cambió el banco con Haiku real del 3-nov y su SQL (lo corre la sesión principal, no este PR). */
describe('fichas del banco con Haiku real (3-nov)', () => {
  const ficha = (c: string) => REGLAMENTO_DIMPRO.find((f) => f.clave === c)!

  it('el archivo es la salida del generador', () => {
    const sql = readFileSync(join(process.cwd(), 'sql/dimpro/2026-11-03_banco-haiku.sql'), 'utf8')
    expect(sql.trimEnd()).toBe(actualizacionSqlDimpro(CLAVES_BANCO_3NOV, REGLAMENTO_DIMPRO, TEXTOS_BANCO_3NOV).trimEnd())
  })

  it('pago sin link: persona de una vez; link sin pedido: sigue la compra, sin persona', () => {
    expect(ficha('alc.pago').hacer).toMatch(/pasar_a_persona motivo pago de una vez, sin preguntarle/)
    const l = ficha('alc.link_sin_pedido')
    expect(l.tipo).toBe('alcance')
    expect(l.hacer).toMatch(/no pases a persona ni llames verificar_pago/)
  })

  it('el complemento rechazado no trae otra oferta; la pregunta de ver_catalogo va sola', () => {
    expect(ficha('alc.complemento').hacer).toMatch(/sin «¿Necesitas algo más\?» ni otra oferta/)
    expect(ficha('alc.producto').hacer).toMatch(/Si ver_catalogo trae `pregunta`, esa es LA pregunta del mensaje/)
  })
})
