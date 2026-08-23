#!/usr/bin/env node
// Vuelca el texto de un PDF sin depender de poppler. Sirve para comprobar que un
// documento generado dice lo que debe decir, en vez de confiar en que pesa bytes.
//
//   node scripts/leer-pdf.mjs /tmp/carta-sin-aceptar.pdf

import { readFileSync } from 'node:fs'
import { inflateSync, inflateRawSync, gunzipSync } from 'node:zlib'

const ruta = process.argv[2]
if (!ruta) {
  console.error('uso: node scripts/leer-pdf.mjs <archivo.pdf>')
  process.exit(2)
}

const buf = readFileSync(ruta)

function inflar(raw) {
  for (const fn of [inflateSync, inflateRawSync, gunzipSync]) {
    try {
      return fn(raw)
    } catch {
      /* siguiente estrategia */
    }
  }
  return null
}

const trozos = []
let i = 0
while (true) {
  const ini = buf.indexOf('stream', i)
  if (ini === -1) break
  let j = ini + 6
  while (j < buf.length && (buf[j] === 0x0d || buf[j] === 0x0a)) j += 1
  const fin = buf.indexOf('endstream', j)
  if (fin === -1) break
  let raw = buf.subarray(j, fin)
  // El `endstream` suele venir precedido de EOL que no es parte del dato.
  while (raw.length && (raw[raw.length - 1] === 0x0a || raw[raw.length - 1] === 0x0d)) {
    raw = raw.subarray(0, raw.length - 1)
  }
  const dec = inflar(raw)
  if (dec) trozos.push(dec.toString('latin1'))
  i = fin + 9
}

if (trozos.length === 0) {
  console.error('no se pudo descomprimir ningún stream')
  process.exit(1)
}

const salida = []
for (const contenido of trozos) {
  // Los textos van en `(...) Tj` y en arreglos `[(...) n (...)] TJ`.
  for (const m of contenido.matchAll(/\((?:\\.|[^()\\])*\)/g)) {
    const t = m[0]
      .slice(1, -1)
      .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\([()\\])/g, '$1')
    if (t.trim()) salida.push(t)
  }
}
console.log(salida.join(' '))
