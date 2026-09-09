import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PALETA, rampaAcento, esBrandingPorDefecto, BRANDING_POR_DEFECTO } from './paleta'

/**
 * Contrato entre las dos representaciones de la paleta.
 *
 * `globals.css` es la fuente: ahi viven los valores que pinta el producto. Este
 * modulo los repite en hex literal para las superficies que no pueden leer una
 * variable CSS (PDF, correo, atributos SVG). Dos copias del mismo color se
 * separan solas, y el sintoma seria el peor de todos: la pantalla con el color
 * nuevo y el documento que se le manda al cliente con el viejo, sin un error en
 * ninguna parte. Estas pruebas leen el CSS y comparan.
 */

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** Lee `--<nombre>: #RRGGBB;` del bloque `:root` de globals.css. */
function varCss(nombre: string): string {
  const m = CSS.match(new RegExp(`--${nombre}:\\s*(#[0-9A-Fa-f]{6})\\s*;`))
  if (!m) throw new Error(`globals.css no declara --${nombre} con un hex literal`)
  return m[1].toUpperCase()
}

/** Lee el porcentaje de un `--<nombre>: color-mix(in srgb, var(--acento) N%, #FFFFFF);`. */
function porcentajeMezcla(nombre: string): number {
  const m = CSS.match(
    new RegExp(`--${nombre}:\\s*color-mix\\(in srgb, var\\(--acento\\) (\\d+)%, #FFFFFF\\)`)
  )
  if (!m) throw new Error(`globals.css no declara --${nombre} como color-mix sobre --acento`)
  return Number(m[1])
}

/** Mezcla `hex` con blanco al `pct`%, que es lo que hace color-mix en srgb. */
function sobreBlanco(hex: string, pct: number): string {
  const p = pct / 100
  const canal = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
    return Math.round(v * p + 255 * (1 - p))
  }
  return (
    '#' +
    [0, 1, 2]
      .map((i) => canal(i).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

describe('paleta literal contra globals.css', () => {
  it.each([
    ['acento', PALETA.acento],
    ['acento-hover', PALETA.acentoHover],
    ['acento-claro', PALETA.acentoClaro],
    ['dato-vivo', PALETA.datoVivo],
    ['tinta', PALETA.tinta],
    ['tinta-suave', PALETA.tintaSuave],
    ['alerta', PALETA.alerta],
    ['advertencia', PALETA.advertencia],
    ['papel', PALETA.papel],
  ])('--%s coincide con la constante', (nombre, valor) => {
    expect(valor.toUpperCase()).toBe(varCss(nombre))
  })

  it('acentoTinte es la mezcla que declara globals.css, recalculada', () => {
    expect(PALETA.acentoTinte.toUpperCase()).toBe(
      sobreBlanco(varCss('acento'), porcentajeMezcla('acento-tinte'))
    )
  })

  it('acentoBorde es la mezcla que declara globals.css, recalculada', () => {
    expect(PALETA.acentoBorde.toUpperCase()).toBe(
      sobreBlanco(varCss('acento'), porcentajeMezcla('acento-borde'))
    )
  })

  it('la mezcla se calcula de verdad: un porcentaje distinto da otro color', () => {
    // Control. Sin esto, un `sobreBlanco` que devolviera siempre la constante
    // dejaria las dos pruebas de arriba en verde sin comparar nada.
    expect(sobreBlanco(varCss('acento'), 8)).not.toBe(sobreBlanco(varCss('acento'), 28))
  })
})

describe('rampa del acento para rankings', () => {
  it.each([2, 4, 6, 8, 12])('con %i pasos, ningun tono se repite', (n) => {
    const rampa = rampaAcento(n)
    expect(rampa).toHaveLength(n)
    expect(new Set(rampa).size).toBe(n)
  })

  it('el primer puesto es el acento y el ultimo es el mas palido', () => {
    const rampa = rampaAcento(8)
    expect(rampa[0]).toBe(PALETA.acento.toUpperCase())
    // "Mas palido" = mas cerca del blanco en los tres canales.
    const luz = (hex: string) =>
      [0, 1, 2].reduce((s, i) => s + parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16), 0)
    for (let i = 1; i < rampa.length; i++) {
      expect(luz(rampa[i])).toBeGreaterThan(luz(rampa[i - 1]))
    }
  })

  it('un solo paso devuelve el acento, sin dividir por cero', () => {
    expect(rampaAcento(1)).toEqual([PALETA.acento])
  })
})

describe('branding por defecto del workspace', () => {
  it('el verde viejo sigue contando como "sin personalizar"', () => {
    // Los workspaces que guardaron su marca antes del rediseno tienen este hex
    // en la base. Si dejara de contar como default, la barra de progreso de
    // Configuracion les daria un punto que nadie se gano.
    expect(esBrandingPorDefecto('#10B981')).toBe(true)
    expect(esBrandingPorDefecto('#10b981')).toBe(true)
  })

  it('el default de hoy tambien cuenta como "sin personalizar"', () => {
    expect(esBrandingPorDefecto(BRANDING_POR_DEFECTO.primario)).toBe(true)
  })

  it('un color elegido por el cliente NO cuenta como default', () => {
    expect(esBrandingPorDefecto('#FF6600')).toBe(false)
  })

  it('sin color guardado se considera sin personalizar', () => {
    expect(esBrandingPorDefecto(null)).toBe(true)
    expect(esBrandingPorDefecto(undefined)).toBe(true)
  })
})
