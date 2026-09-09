import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import manifest from './manifest'

/**
 * Contrato de los iconos de marca.
 *
 * Los assets oficiales viven FUERA del repo, en `proyectos/metrik/marca/pino/`,
 * asi que esta prueba no puede compararlos byte a byte: en CI ese directorio no
 * existe. Lo que si puede es fijar las propiedades que hacen que el icono sea el
 * de marca y no otra cosa, y que un cambio descuidado rompe en silencio:
 *
 *   - el `.ico` es un contenedor y su contenido no se ve en el diff del PR;
 *   - `icon.svg` volvio a ser texto una vez ya (`font-family: system-ui`), que
 *     es una aproximacion tipografica, no el isotipo;
 *   - una ruta del manifest que apunta a un archivo inexistente no falla el
 *     build: el navegador pide el PNG, recibe 404 y usa el favicon escalado.
 */

const APP = path.resolve(__dirname)
const PUBLICO = path.resolve(__dirname, '../../public')

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Ancho y alto reales de un PNG, leidos del chunk IHDR. */
function medidaPng(datos: Buffer): { ancho: number; alto: number } {
  expect(datos.subarray(0, 8).equals(FIRMA_PNG)).toBe(true)
  return { ancho: datos.readUInt32BE(16), alto: datos.readUInt32BE(20) }
}

/** Directorio de un .ico: cabecera de 6 bytes + una entrada de 16 por imagen. */
function leerIco(datos: Buffer) {
  expect(datos.readUInt16LE(0)).toBe(0) // reservado
  expect(datos.readUInt16LE(2)).toBe(1) // 1 = icono
  const n = datos.readUInt16LE(4)
  return Array.from({ length: n }, (_, i) => {
    const o = 6 + i * 16
    const bytes = datos.readUInt32LE(o + 8)
    const off = datos.readUInt32LE(o + 12)
    return {
      // 0 en este campo significa 256; nuestros tamanos no llegan ahi
      lado: datos[o] === 0 ? 256 : datos[o],
      contenido: datos.subarray(off, off + bytes),
    }
  })
}

describe('favicon.ico', () => {
  const ico = fs.readFileSync(path.join(APP, 'favicon.ico'))
  const entradas = leerIco(ico)

  it('trae los tres tamanos de pestana y ninguno mas', () => {
    expect(entradas.map((e) => e.lado)).toEqual([16, 32, 64])
  })

  it('cada entrada es un PNG cuyo tamano real coincide con el que anuncia', () => {
    // Un .ico que ANUNCIA 32 y guarda otra cosa no falla en ninguna parte: el
    // navegador escala lo que encuentre y el icono sale borroso sin error.
    for (const { lado, contenido } of entradas) {
      expect(medidaPng(contenido)).toEqual({ ancho: lado, alto: lado })
    }
  })

  it('no es el favicon de create-next-app', () => {
    // El de la plantilla pesaba 25.931 bytes y su entrada mas grande era 256.
    // Estuvo en produccion desde el Sprint 0 sirviendo el triangulo de Vercel.
    expect(ico.length).toBeLessThan(10_000)
    expect(entradas.some((e) => e.lado === 256)).toBe(false)
  })
})

describe('icon.svg', () => {
  const svg = fs.readFileSync(path.join(APP, 'icon.svg'), 'utf8')

  it('es el isotipo en contornos, no una letra tipografiada', () => {
    // El icono anterior dibujaba la "M" con `<text font-family="system-ui">` y
    // el sufijo en peso 300, que es el peso que Schibsted Grotesk NO tiene y que
    // la decision de marca descarto. Un icono con texto ademas depende de que
    // la fuente exista en la maquina que lo pinta.
    expect(svg).not.toMatch(/<text[\s>]/)
    expect(svg).not.toMatch(/font-family/)
    expect(svg).toMatch(/<path d="M/)
  })

  it('usa la paleta Pino Profundo: carbon, papel y Pino 300', () => {
    expect(svg).toContain('#191713') // contenedor
    expect(svg).toContain('#F3F1EC') // la M, en negativo
    expect(svg).toContain('#6FB89D') // la linea; el unico verde legible sobre carbon
    expect(svg).not.toContain('#10B981') // verde viejo
  })

  it('lleva su propio fondo, que es lo que lo hace legible sobre claro y sobre oscuro', () => {
    // Sin el rectangulo de fondo el icono seria tinta clara sobre transparente y
    // desapareceria en una pestana clara.
    expect(svg).toMatch(/<rect width="512" height="512" rx="[\d.]+" fill="#191713"\/>/)
  })
})

describe('manifest', () => {
  const m = manifest()

  it('declara los dos tamanos que Android pide para la pantalla de inicio', () => {
    expect(m.icons?.map((i) => i.sizes)).toEqual(['192x192', '512x512'])
  })

  it('cada icono apunta a un archivo que existe y mide lo que dice', () => {
    // Este es el fallo silencioso que la prueba viene a cerrar: mover o renombrar
    // un PNG de `public/icons/` deja el manifest apuntando al vacio y el build
    // sigue en verde.
    for (const icono of m.icons ?? []) {
      const ruta = path.join(PUBLICO, icono.src)
      expect(fs.existsSync(ruta), `falta ${icono.src}`).toBe(true)
      const lado = Number(String(icono.sizes).split('x')[0])
      expect(medidaPng(fs.readFileSync(ruta)), icono.src).toEqual({ ancho: lado, alto: lado })
    }
  })

  it('los colores son los de marca', () => {
    expect(m.background_color).toBe('#F3F1EC')
    expect(m.theme_color).toBe('#191713')
  })
})

describe('apple-icon.png', () => {
  it('mide 180x180, que es lo que Next publica en el sizes del link', () => {
    // Next lee las medidas del archivo y las escribe en `sizes`. Un archivo de
    // otro tamano no rompe el build: publica un `sizes` que miente.
    expect(medidaPng(fs.readFileSync(path.join(APP, 'apple-icon.png')))).toEqual({
      ancho: 180,
      alto: 180,
    })
  })
})
