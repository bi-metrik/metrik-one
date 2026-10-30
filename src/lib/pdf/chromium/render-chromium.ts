/**
 * Imprime un HTML a PDF con Chromium headless (`Page.printToPDF`), el mismo motor con el
 * que se aprobó el prototipo de la propuesta de Trappvel (2026-10-14).
 *
 * - En Vercel: `@sparticuz/chromium` (binario comprimido que se descomprime en /tmp en el
 *   arranque en frío) + `puppeteer-core`. Las dos van fijadas a la misma versión mayor de
 *   Chrome (153): `puppeteer-core@25.11.0` habla el protocolo de Chrome 153.
 * - Fuera de Vercel (la torre, CI): `CHROMIUM_EJECUTABLE` apunta a un Chrome local; si no
 *   está, se intenta el de `@sparticuz/chromium`, que corre en Linux x64.
 *
 * **Sin red.** Toda petición que no sea `data:`/`about:blank` se aborta: el HTML lleva sus
 * fotos y fuentes dentro. Así un HTML no puede hacer que la función pida URLs internas, y un
 * recurso que falta se nota (lo reporta `peticionesBloqueadas`) en vez de esperar un timeout.
 *
 * Devuelve las medidas del ensayo (PR 0): tiempos por fase, memoria y peso.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { peticionPermitida } from './recursos'

export interface OpcionesPdf {
  /** HTML del pie (ver `pieDePagina`). Sin él no se imprime pie. */
  pie?: string
  /** HTML del encabezado de cada hoja. Sin él no se imprime encabezado. */
  encabezado?: string
  /** Tope de toda la impresión, en ms. */
  timeoutMs?: number
  /**
   * Otra versión del mismo documento, más compacta (QA del #1359). Si la primera sale en más de una
   * hoja, se imprime también esta en la MISMA página de Chromium y gana la que tenga menos hojas (a
   * igual número, la primera). Ausente, o igual a la primera, no se imprime.
   */
  alternativa?: string | null
}

export interface MedidasRender {
  /** Encontrar o descomprimir el binario (en frío descomprime ~67 MB a /tmp). */
  ejecutableMs: number
  lanzarMs: number
  cargarMs: number
  fuentesMs: number
  imprimirMs: number
  totalMs: number
  /** ¿El binario ya estaba en /tmp? (instancia tibia). */
  binarioEnTmp: boolean
  pdfBytes: number
  htmlBytes: number
  /** Pico de RSS del proceso de Node durante el render, en MB. */
  nodeRssPicoMb: number
  /** Suma de los picos (VmHWM) de los procesos de Chromium, en MB. Cota superior. */
  chromiumPicoMb: number | null
  /** RSS de Chromium sumado en el muestreo más alto, en MB. */
  chromiumRssPicoMb: number | null
  peticionesBloqueadas: string[]
  version: string
  /** Hojas de la primera versión y, si se imprimió la alternativa, las suyas. */
  hojas?: { primera: number; alternativa: number | null; gano: 'primera' | 'alternativa' }
}

export interface ResultadoPdf {
  pdf: Buffer
  medidas: MedidasRender
  /** El HTML que se imprimió, solo si fue la alternativa. */
  html?: string
}

/** Cuántas hojas tiene un PDF. `null` si no se puede leer. */
export async function hojasDelPdf(pdf: Uint8Array): Promise<number | null> {
  try {
    const { PDFDocument } = await import('pdf-lib')
    return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount()
  } catch {
    return null
  }
}

const MB = 1024 * 1024

/** RSS y VmHWM (kB) de un pid, o null si ya no existe o no hay /proc. */
function memoriaDe(pid: number): { rss: number; hwm: number } | null {
  try {
    const s = readFileSync(`/proc/${pid}/status`, 'utf8')
    const rss = Number(/VmRSS:\s+(\d+)/.exec(s)?.[1] ?? 0)
    const hwm = Number(/VmHWM:\s+(\d+)/.exec(s)?.[1] ?? 0)
    return { rss, hwm }
  } catch {
    return null
  }
}

/** Pids descendientes de `raiz` (incluida), leyendo /proc. Vacío si no hay /proc. */
function descendientes(raiz: number): number[] {
  let pids: number[]
  try {
    pids = readdirSync('/proc')
      .filter((d) => /^\d+$/.test(d))
      .map(Number)
  } catch {
    return []
  }
  const hijos = new Map<number, number[]>()
  for (const pid of pids) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      // El nombre va entre paréntesis y puede tener espacios: el ppid es el 2.º campo tras «)».
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      const l = hijos.get(ppid) ?? []
      l.push(pid)
      hijos.set(ppid, l)
    } catch {
      /* el proceso terminó entre readdir y read */
    }
  }
  const salida: number[] = []
  const cola = [raiz]
  while (cola.length) {
    const p = cola.shift()!
    salida.push(p)
    cola.push(...(hijos.get(p) ?? []))
  }
  return salida
}

function medirChromium(raiz: number | undefined): { rss: number; hwm: number } | null {
  if (!raiz) return null
  let rss = 0
  let hwm = 0
  let alguno = false
  for (const pid of descendientes(raiz)) {
    const m = memoriaDe(pid)
    if (!m) continue
    alguno = true
    rss += m.rss
    hwm += m.hwm
  }
  return alguno ? { rss, hwm } : null
}

async function rutaDelEjecutable(): Promise<{ ruta: string; args: string[]; enTmp: boolean }> {
  const local = process.env.CHROMIUM_EJECUTABLE
  if (local && !process.env.VERCEL) {
    return { ruta: local, args: ['--no-sandbox', '--disable-gpu'], enTmp: true }
  }
  const { existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const enTmp = existsSync(join(tmpdir(), 'chromium'))
  const chromium = (await import('@sparticuz/chromium')).default
  chromium.setGraphicsMode = false
  return { ruta: await chromium.executablePath(), args: chromium.args, enTmp }
}

export async function imprimirHtmlAPdf(html: string, opts: OpcionesPdf = {}): Promise<ResultadoPdf> {
  const t0 = performance.now()
  let nodeRssPico = process.memoryUsage().rss
  const bloqueadas: string[] = []

  const { ruta, args, enTmp } = await rutaDelEjecutable()
  const t1 = performance.now()

  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({
    executablePath: ruta,
    args: await puppeteer.defaultArgs({ args, headless: 'shell' }),
    headless: 'shell',
    defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 1 },
  })
  const t2 = performance.now()

  const pidRaiz = browser.process()?.pid
  let chromiumPico: { rss: number; hwm: number } | null = null
  const muestrear = () => {
    nodeRssPico = Math.max(nodeRssPico, process.memoryUsage().rss)
    const m = medirChromium(pidRaiz)
    if (!m) return
    const antes = chromiumPico as { rss: number; hwm: number } | null
    chromiumPico = { rss: Math.max(antes?.rss ?? 0, m.rss), hwm: Math.max(antes?.hwm ?? 0, m.hwm) }
  }
  const reloj = setInterval(muestrear, 100)

  try {
    const version = await browser.version()
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = req.url()
      if (peticionPermitida(url)) {
        void req.continue()
      } else {
        bloqueadas.push(url.slice(0, 120))
        void req.abort('blockedbyclient')
      }
    })
    const timeout = opts.timeoutMs ?? 45_000
    await page.setContent(html, { waitUntil: 'load', timeout })
    const t3 = performance.now()
    await page.evaluate(() => document.fonts.ready.then(() => true))
    const t4 = performance.now()
    muestrear()
    const imprimir = () => page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: Boolean(opts.pie || opts.encabezado),
      headerTemplate: opts.encabezado ?? '<span></span>',
      footerTemplate: opts.pie ?? '<span></span>',
      timeout,
    })
    let pdf = await imprimir()
    let hojas: MedidasRender['hojas']
    let htmlImpreso: string | undefined
    // QA del #1359 · la última hoja casi vacía: la versión compacta, si ahorra una hoja.
    if (opts.alternativa && opts.alternativa !== html) {
      const primera = await hojasDelPdf(pdf)
      if (primera !== null && primera > 1) {
        await page.setContent(opts.alternativa, { waitUntil: 'load', timeout })
        await page.evaluate(() => document.fonts.ready.then(() => true))
        const otro = await imprimir()
        const alternativa = await hojasDelPdf(otro)
        const gana = alternativa !== null && alternativa < primera
        hojas = { primera, alternativa, gano: gana ? 'alternativa' : 'primera' }
        if (gana) {
          pdf = otro
          htmlImpreso = opts.alternativa
        }
      }
    }
    const t5 = performance.now()
    muestrear()
    const pico = chromiumPico as { rss: number; hwm: number } | null
    return {
      pdf: Buffer.from(pdf),
      medidas: {
        ejecutableMs: Math.round(t1 - t0),
        lanzarMs: Math.round(t2 - t1),
        cargarMs: Math.round(t3 - t2),
        fuentesMs: Math.round(t4 - t3),
        imprimirMs: Math.round(t5 - t4),
        totalMs: Math.round(t5 - t0),
        binarioEnTmp: enTmp,
        pdfBytes: pdf.byteLength,
        htmlBytes: Buffer.byteLength(html),
        nodeRssPicoMb: Math.round(nodeRssPico / MB),
        chromiumPicoMb: pico ? Math.round(pico.hwm / 1024) : null,
        chromiumRssPicoMb: pico ? Math.round(pico.rss / 1024) : null,
        peticionesBloqueadas: bloqueadas,
        version,
        ...(hojas ? { hojas } : {}),
      },
      ...(htmlImpreso ? { html: htmlImpreso } : {}),
    }
  } finally {
    clearInterval(reloj)
    await browser.close().catch(() => undefined)
  }
}
