#!/usr/bin/env node
// Vuelca el texto de un PDF sin depender de poppler (que no está instalado en
// este entorno). Sirve para comprobar que un documento generado DICE lo que debe
// decir, en vez de confiar en que pesa bytes: un PDF puede renderizar sin error
// y salir con un renglón vacío donde iba la periodicidad.
//
//   node scripts/leer-pdf.mjs /tmp/carta-sin-aceptar.pdf
//   node scripts/leer-pdf.mjs /tmp/carta-sin-aceptar.pdf --debug
//
// Dos detalles que hacen fallar la versión ingenua:
//
//   1. Los bytes que preceden a `endstream` incluyen el salto de línea que el
//      PDF agrega; si se le pasan a inflate, revienta. Hay que recortarlos.
//   2. `@react-pdf/renderer` incrusta las fuentes y escribe el texto como
//      cadenas HEXADECIMALES dentro de arreglos `TJ` (`[<4e6f6d> 0 <627265>] TJ`),
//      no como cadenas literales `(...)`. Un extractor que solo mire `(...)`
//      devuelve vacío y parece que el PDF no tuviera texto.

import { readFileSync } from 'node:fs'
import { inflateSync, inflateRawSync } from 'node:zlib'

const ruta = process.argv[2]
const debug = process.argv.includes('--debug')
if (!ruta) {
  console.error('uso: node scripts/leer-pdf.mjs <archivo.pdf> [--debug]')
  process.exit(2)
}

const buf = readFileSync(ruta)

function descomprimir(raw) {
  let fin = raw.length
  while (fin > 0 && (raw[fin - 1] === 0x0a || raw[fin - 1] === 0x0d)) fin -= 1
  const cuerpo = raw.subarray(0, fin)
  for (const fn of [inflateSync, inflateRawSync]) {
    try {
      return fn(cuerpo)
    } catch {
      /* siguiente estrategia */
    }
  }
  return null
}

const streams = []
let pos = 0
while (true) {
  const i = buf.indexOf('stream', pos)
  if (i === -1) break
  let j = i + 6
  while (j < buf.length && (buf[j] === 0x0d || buf[j] === 0x0a)) j += 1
  const k = buf.indexOf('endstream', j)
  if (k === -1) break
  streams.push(descomprimir(buf.subarray(j, k)))
  pos = k + 9
}

if (debug) {
  streams.forEach((s, n) => {
    const ops = s ? [...new Set(s.toString('latin1').match(/\b(Tj|TJ|BT|ET)\b/g) ?? [])] : []
    console.log(
      `--- stream ${n + 1}: ${s ? `${s.length} bytes, ops: ${ops.join(',') || 'ninguno'}` : 'no descomprimible'}`,
    )
  })
}

function textoDeStream(s) {
  const salida = []
  // Cada bloque BT...ET es un fragmento de texto. Dentro, las piezas van como
  // <hex> (lo que usa react-pdf) o como (literal).
  for (const bloque of s.matchAll(/BT\b([\s\S]*?)\bET/g)) {
    let frag = ''
    for (const m of bloque[1].matchAll(/<([0-9a-fA-F\s]*)>|\((?:\\.|[^()\\])*\)/g)) {
      if (m[1] !== undefined) {
        const hex = m[1].replace(/\s+/g, '')
        for (let i = 0; i + 1 < hex.length; i += 2) {
          frag += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
        }
      } else {
        frag += m[0]
          .slice(1, -1)
          .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
          .replace(/\\([()\\])/g, '$1')
      }
    }
    if (frag.trim()) salida.push(frag)
  }
  return salida
}

const texto = streams
  .filter(Boolean)
  .flatMap((s) => textoDeStream(s.toString('latin1')))
  .join(' ')

if (!texto.trim()) {
  console.error('no se encontró texto: ¿el PDF es solo imagen, o cambió el formato de salida?')
  process.exit(1)
}
console.log(texto)
