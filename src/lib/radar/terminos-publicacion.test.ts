import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { bloquesDeTexto } from '@/lib/valida-api/texto-documento'
import { PRODUCTOS_ENTRADA } from '@/lib/valida-api/producto'

/**
 * La publicación de `terminos-uso-radar` v1.0: que la fila propuesta en
 * `sql/radar/2026-09-28_terminos-uso-radar-v1.0.sql` diga la verdad sobre el texto que registra.
 *
 * Ese archivo no lo corre ningún check y lo aplica una persona sobre producción, así que lo
 * verificable desde el repo se verifica aquí. El PDF vive fuera del repo
 * (`proyectos/metrik/legal/terminos-radar-v1.0/`, junto a su generador), igual que los de los CDA,
 * y por eso su huella solo se compara de forma (64 hex): lo que sí se puede comprobar en CI, y es
 * lo que ya se rompió una vez en Valida, es que `texto_sha256` sea sha256 del `texto_md` TAL CUAL.
 *
 * Y que el texto se pueda LEER en la pantalla de aceptación: el lector de ONE
 * (`texto-documento.ts`) pinta títulos, párrafos, listas con guion y negritas, y nada más. Una
 * tabla de Markdown o un acento grave saldrían con sus barras y sus comillas a la vista, sobre un
 * texto que alguien va a aceptar. Por eso el generador convierte la tabla de la cláusula 8 en una
 * lista, y por eso se comprueba aquí.
 */

const SQL = readFileSync(join(process.cwd(), 'sql/radar/2026-09-28_terminos-uso-radar-v1.0.sql'), 'utf8')

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex')

/** El n-ésimo literal de texto del `values (...)`, ya sin las comillas dobladas. */
function literales(sql: string): string[] {
  const values = sql.slice(sql.indexOf(') values ('))
  return [...values.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
}

const VALORES = literales(SQL)
const TEXTO = VALORES.find((v) => v.startsWith('# Términos de Uso'))!
const HEX = /^[0-9a-f]{64}$/

describe('la fila de terminos-uso-radar v1.0', () => {
  it('registra el texto con su propia huella, sin trim ni salto de más', () => {
    expect(TEXTO).toBeTruthy()
    expect(VALORES).toContain(sha256(TEXTO))
  })

  it('declara slug, versión, alcance y vigencia del documento aprobado', () => {
    expect(VALORES).toContain('terminos-uso-radar')
    expect(VALORES).toContain('1.0')
    expect(VALORES).toContain('plantilla')
    expect(VALORES).toContain('2026-09-28')
    expect(VALORES).toContain('aceptaciones-documentos')
    expect(VALORES).toContain('metrik/terminos-uso-radar-v1.0.pdf')
    // Dos huellas de 64 hex: la del texto y la del PDF, distintas entre sí.
    const huellas = VALORES.filter((v) => HEX.test(v))
    expect(huellas).toHaveLength(2)
    expect(new Set(huellas).size).toBe(2)
  })

  it('el título y la vigencia son los del documento que cerró el CLO', () => {
    expect(VALORES).toContain('Términos de Uso — Radar SECOP')
    // El PDF es el archivo que se entrega: su huella es la que ata la aceptación.
    expect(SQL).toContain('aceptaciones_terminos.documento_sha256 = pdf_sha256')
  })
})

describe('el texto se puede leer en la pantalla de aceptación', () => {
  it('no trae tabla, acento grave ni separador que el lector no sepa pintar', () => {
    expect(TEXTO).not.toContain('|')
    expect(TEXTO).not.toContain('`')
    expect(TEXTO).not.toMatch(/^---$/m)
    // Una cursiva de un asterisco dejaría el asterisco a la vista.
    expect(TEXTO).not.toMatch(/(?<!\*)\*(?!\*)/)
  })

  it('no arrastra la nota interna de revisión', () => {
    expect(TEXTO).not.toContain('Revisado y cerrado')
    expect(TEXTO).not.toContain('Gracia confirmada')
    expect(TEXTO).not.toContain('cerebro/')
  })

  it('las doce cláusulas salen como títulos y la 8 como lista', () => {
    const bloques = bloquesDeTexto(TEXTO)
    const titulos = bloques
      .filter((b) => b.tipo === 'titulo' && b.nivel === 2)
      .map((b) => (b.tipo === 'titulo' ? b.tramos.map((t) => t.texto).join('') : ''))
    expect(titulos).toHaveLength(12)
    expect(titulos[0]).toBe('1. Qué es el Radar SECOP')
    expect(titulos[7]).toBe('8. Qué pasa si una cuota posterior se vence')

    // Los tres momentos de la cláusula 8, que en la fuente son una tabla.
    const items = bloques.flatMap((b) =>
      b.tipo === 'lista' ? b.items.map((i) => i.map((t) => t.texto).join('')) : [],
    )
    expect(items).toContain('Del vencimiento al día 5: Acceso normal. Período de gracia, con aviso escrito')
    expect(items).toContain('Desde el día 6: Solo lectura, en los términos del párrafo siguiente')
    expect(items).toContain('Nunca: Bloqueo total del acceso')
  })

  it('nombra el producto tal como lo nombra la casilla que se firma', () => {
    expect(TEXTO).toContain(PRODUCTOS_ENTRADA.radar_secop.nombre)
  })
})
