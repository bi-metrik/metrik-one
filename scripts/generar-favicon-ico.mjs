/**
 * Arma `src/app/favicon.ico` a partir de los PNG oficiales de marca.
 *
 * El .ico NO se dibuja: es un contenedor. Este script escribe la cabecera
 * ICONDIR y una entrada por tamano, y **pega los bytes del PNG oficial tal
 * cual**. Por eso al final vuelve a extraer cada entrada y compara su sha256
 * contra el archivo de origen: si el .ico no contiene el asset oficial byte a
 * byte, el script falla en vez de escribir.
 *
 * Los PNG viven fuera del repo, en el monorepo de marca
 * (`proyectos/metrik/marca/pino/png-one/`), y se generan desde
 * `logo-export-pino.html`, que es la fuente de verdad de la geometria. Aqui no
 * se reescala ni se recolorea nada.
 *
 * Uso:  node scripts/generar-favicon-ico.mjs [ruta/a/png-one]
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEN =
  process.argv[2] ??
  path.resolve(RAIZ, '../../../../proyectos/metrik/marca/pino/png-one')
const DESTINO = path.join(RAIZ, 'src/app/favicon.ico')

/**
 * Tamanos que van al .ico y por que solo estos tres.
 *
 * El .ico cubre el icono de pestana y sus variantes de alta densidad; los
 * tamanos grandes los sirven `icon.svg` (vectorial) y el manifest. Ademas
 * `png-one/` solo publica 16, 32, 64, 180, 192 y 512: meter un 48 obligaria a
 * reescalar, y un asset reescalado aqui deja de ser el asset oficial.
 */
const TAMANOS = [16, 32, 64]

/** Firma de PNG: los 8 bytes que abren todo archivo PNG valido. */
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const sha = (b) => createHash('sha256').update(b).digest('hex')

const imagenes = TAMANOS.map((lado) => {
  const ruta = path.join(ORIGEN, `metrik-icono-${lado}.png`)
  const datos = fs.readFileSync(ruta)
  if (!datos.subarray(0, 8).equals(FIRMA_PNG)) {
    throw new Error(`${ruta} no es un PNG`)
  }
  // Ancho y alto reales, leidos del chunk IHDR (bytes 16..24). No se confia en
  // el nombre del archivo: si alguien renombra un PNG, el .ico anunciaria un
  // tamano que no existe y el navegador elegiria mal.
  const ancho = datos.readUInt32BE(16)
  const alto = datos.readUInt32BE(20)
  if (ancho !== lado || alto !== lado) {
    throw new Error(`${ruta} mide ${ancho}x${alto} y el nombre dice ${lado}`)
  }
  return { lado, ruta, datos }
})

const CABECERA = 6
const ENTRADA = 16
const inicioDatos = CABECERA + ENTRADA * imagenes.length

const dir = Buffer.alloc(inicioDatos)
dir.writeUInt16LE(0, 0) // reservado
dir.writeUInt16LE(1, 2) // 1 = icono (2 seria cursor)
dir.writeUInt16LE(imagenes.length, 4)

let desplazamiento = inicioDatos
imagenes.forEach((img, i) => {
  const o = CABECERA + i * ENTRADA
  // 0 significa 256 en este campo; ninguno de nuestros tamanos llega ahi.
  dir.writeUInt8(img.lado, o)
  dir.writeUInt8(img.lado, o + 1)
  dir.writeUInt8(0, o + 2) // sin paleta
  dir.writeUInt8(0, o + 3) // reservado
  dir.writeUInt16LE(1, o + 4) // planos de color
  dir.writeUInt16LE(32, o + 6) // bits por pixel (RGBA)
  dir.writeUInt32LE(img.datos.length, o + 8)
  dir.writeUInt32LE(desplazamiento, o + 12)
  img.desplazamiento = desplazamiento
  desplazamiento += img.datos.length
})

const ico = Buffer.concat([dir, ...imagenes.map((i) => i.datos)])

// Verificacion: se relee lo que se acaba de armar y se compara cada entrada
// contra su origen. Sin esto, "genero el ico" seria una afirmacion.
const n = ico.readUInt16LE(4)
if (n !== imagenes.length) throw new Error(`el ico declara ${n} entradas y son ${imagenes.length}`)
imagenes.forEach((img, i) => {
  const o = CABECERA + i * ENTRADA
  const bytes = ico.readUInt32LE(o + 8)
  const off = ico.readUInt32LE(o + 12)
  const extraido = ico.subarray(off, off + bytes)
  if (sha(extraido) !== sha(img.datos)) {
    throw new Error(`la entrada ${img.lado} no coincide con ${img.ruta}`)
  }
  console.log(`  ${String(img.lado).padStart(3)}x${img.lado}  ${String(bytes).padStart(6)} bytes  sha256 ${sha(extraido).slice(0, 12)}  = ${path.basename(img.ruta)}`)
})

fs.writeFileSync(DESTINO, ico)
console.log(`\n${path.relative(RAIZ, DESTINO)}  ${ico.length} bytes, ${imagenes.length} entradas PNG`)
