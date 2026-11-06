/**
 * Piloto del asistente de cotización (2026-11-03): pantallazos + manual de la casa → borrador (JSON)
 * validado por invariantes → PDF con la plantilla real. No lee ni escribe la base: todo entra por
 * archivos, para poder correrlo contra casos reales sin tocar producción.
 *
 *   npx tsx scripts/piloto-asistente-cotizacion.ts \
 *     --caso <dir con solicitud.json y *.png> --manual <manual.md> --casa <casa.json> \
 *     --salida <dir> [--corridas 3] [--sin-pdf] [--via-claude-cli]
 *
 * Modelo: el de `MODELO_ASISTENTE` (por defecto `claude-haiku-5-5`, pide `ANTHROPIC_API_KEY`).
 * `MODELO_ASISTENTE=gemini-…` pide `GEMINI_API_KEY`. `--via-claude-cli` manda el mismo
 * prompt y el mismo esquema por `claude -p` con la sesión de Claude Code de la máquina, para probar
 * sin llave de API: los tokens que reporta incluyen el contexto propio del CLI.
 *
 * Por corrida deja `corrida-N.json` (borrador, hallazgos, totales, tokens, tiempos) y el PDF.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { armarBorrador, MODELO_ASISTENTE, partesDelCaso, sistemaDelAsistente, type ResultadoArmado } from '@/lib/cotizaciones/asistente/armar-con-modelo'
import { ESQUEMA_BORRADOR_JSON } from '@/lib/cotizaciones/asistente/borrador'
import { validarBorrador } from '@/lib/cotizaciones/asistente/invariantes'
import { entradaDePropuesta, type Casa, type Solicitud } from '@/lib/cotizaciones/asistente/a-propuesta'
import { pdfDePropuestaHtml } from '@/lib/pdf/html/propuesta-html'
import { fotosDeCiudad } from '@/lib/pdf/fotos-ciudad'
import { nombrePdfCotizacion, tituloPdfCotizacion } from '@/lib/cotizaciones/nombre-pdf-cotizacion'

function arg(nombre: string, porDefecto?: string): string {
  const i = process.argv.indexOf(`--${nombre}`)
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1]
  if (porDefecto !== undefined) return porDefecto
  throw new Error(`Falta --${nombre}`)
}

/** Recorta la foto del hotel con la caja que dio el modelo ([ymin, xmin, ymax, xmax] en 0-1000). */
async function recortarFoto(archivo: string, caja: number[] | null, destino: string) {
  if (!caja || caja.length !== 4) return null
  const { width = 0, height = 0 } = await sharp(archivo).metadata()
  const [y0, x0, y1, x1] = caja.map(n => Math.max(0, Math.min(1000, n)) / 1000)
  const left = Math.round(x0 * width), top = Math.round(y0 * height)
  const w = Math.round((x1 - x0) * width), h = Math.round((y1 - y0) * height)
  if (w < 40 || h < 40) return null
  await sharp(archivo).extract({ left, top, width: w, height: h }).jpeg({ quality: 90 }).toFile(destino)
  return { url: destino, proporcion: w / h }
}

/** El mismo prompt y esquema por `claude -p` (sin herramientas ni ajustes del proyecto). */
function armarPorCli(manual: string, solicitud: Solicitud, pantallazos: { nombre: string; mime: string; base64: string }[]): ResultadoArmado {
  const content = partesDelCaso(solicitud, pantallazos).map(p =>
    'texto' in p ? { type: 'text', text: p.texto } : { type: 'image', source: { type: 'base64', media_type: p.imagen.mime, data: p.imagen.base64 } })
  const t0 = Date.now()
  const r = spawnSync('claude', ['-p', '--model', MODELO_ASISTENTE, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--system-prompt', sistemaDelAsistente(manual), '--tools', '', '--setting-sources', '', '--max-turns', '3',
    '--json-schema', JSON.stringify(ESQUEMA_BORRADOR_JSON)],
  { input: JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n', encoding: 'utf8', maxBuffer: 64 << 20, cwd: tmpdir() })
  const fin = r.stdout.trim().split('\n').map(l => { try { return JSON.parse(l) } catch { return null } }).find(x => x?.type === 'result')
  if (!fin?.structured_output) throw new Error(`claude -p no devolvió el borrador: ${(fin?.result ?? r.stderr ?? '').toString().slice(0, 300)}`)
  const u = fin.usage ?? {}
  const entrada = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return {
    borrador: fin.structured_output,
    uso: { promptTokens: entrada, salidaTokens: u.output_tokens ?? 0, pensamientoTokens: 0, totalTokens: entrada + (u.output_tokens ?? 0), costoUsd: fin.total_cost_usd } as ResultadoArmado['uso'],
    ms: Date.now() - t0,
    modelo: Object.keys(fin.modelUsage ?? {})[0] ?? MODELO_ASISTENTE,
  }
}

async function main() {
  const caso = arg('caso'), salida = arg('salida'), corridas = Number(arg('corridas', '3'))
  const conPdf = !process.argv.includes('--sin-pdf')
  const manual = readFileSync(arg('manual'), 'utf8')
  const casa = JSON.parse(readFileSync(arg('casa'), 'utf8')) as Casa
  const solicitud = JSON.parse(readFileSync(path.join(caso, 'solicitud.json'), 'utf8')) as Solicitud
  const porCli = process.argv.includes('--via-claude-cli')
  const apiKey = process.env.GEMINI_API_KEY
  if (MODELO_ASISTENTE.startsWith('gemini') && !apiKey) throw new Error('Falta GEMINI_API_KEY (la de pruebas)')
  const archivos = readdirSync(caso).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort()
  const pantallazos = archivos.map(f => ({
    nombre: f,
    mime: f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
    base64: readFileSync(path.join(caso, f)).toString('base64'),
  }))
  mkdirSync(salida, { recursive: true })

  for (let n = 1; n <= corridas; n++) {
    const r = porCli ? armarPorCli(manual, solicitud, pantallazos) : await armarBorrador({ manual, solicitud, pantallazos, apiKey })
    const validado = validarBorrador(r.borrador, solicitud.viajeros)
    const registro: Record<string, unknown> = { corrida: n, modelo: r.modelo, ms: r.ms, uso: r.uso, ...validado, borrador: r.borrador }
    const errores = validado.hallazgos.filter(h => h.nivel === 'error')
    if (conPdf && errores.length === 0) {
      const t0 = Date.now()
      const fotos = new Map<number, { url: string; proporcion: number }>()
      for (const h of r.borrador.hoteles) {
        const f = archivos[h.pantallazo - 1]
        if (!f) continue
        const foto = await recortarFoto(path.join(caso, f), h.cajaFoto, path.join(salida, `foto-c${n}-p${h.pantallazo}.jpg`))
        if (foto) fotos.set(h.pantallazo, foto)
      }
      const entrada = entradaDePropuesta(r.borrador, validado, solicitud, casa, fotos)
      const datos = { codigo: solicitud.consecutivo, cliente: r.borrador.clienteParaDocumento || solicitud.cliente, destino: solicitud.destino, borrador: false }
      const nombre = nombrePdfCotizacion(datos as never)
      const { pdf, medidas } = await pdfDePropuestaHtml(entrada, {
        marca: casa.marca, logoUrl: process.env.LOGO ?? null, tituloDocumento: tituloPdfCotizacion(datos as never),
        fotoDeCiudad: (c: string) => fotosDeCiudad(c).map(f => ({ url: f.ruta, rotulo: f.rotulo, credito: f.credito, foco: f.foco, proporcion: f.proporcion })),
        catalogo: null,
      } as never)
      const archivoPdf = path.join(salida, `corrida-${n} - ${nombre}`)
      writeFileSync(archivoPdf, pdf)
      registro.pdf = { archivo: archivoPdf, nombre, hojas: medidas.hojas, msPdf: Date.now() - t0 }
    }
    writeFileSync(path.join(salida, `corrida-${n}.json`), JSON.stringify(registro, null, 1))
    console.log(JSON.stringify({ corrida: n, ms: r.ms, uso: r.uso, errores: errores.length, avisos: validado.hallazgos.length - errores.length, dudas: r.borrador.dudas.length, totales: validado.totales }))
  }
}
main().catch(e => { console.error(e); process.exit(1) })
