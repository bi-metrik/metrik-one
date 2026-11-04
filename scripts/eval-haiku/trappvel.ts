/**
 * Las familias de Trappvel del arnés (Mauricio, 2026-11-04: «las lecturas con IA de Trappvel tienen que salir bien con
 * Claude Haiku»). Los casos NO salen de la base ni se copian al repo: se leen del banco de pruebas de la QA punta a
 * punta del 2026-10-29 (10 viajes ficticios), en `TRAPPVEL_QA_DIR` o en su ruta de siempre dentro de `proyectos/`.
 * Cada viaje trae `conversacion.txt` (la entrada de «Pegar conversación»), `png/*.png` (los pantallazos de «Armar el
 * viaje») y `clave.md` (lo que debe salir). El oráculo se arma leyendo `clave.md`; las bitácoras de la QA dan la vara
 * de Gemini en número de campos llenados.
 *
 *   · `trappvel_conversacion`: `leerChatConModelo` + `cargarChatEnBloque`, lo mismo que corre «Pegar conversación»,
 *     con los campos de «Condiciones del viaje» de Trappvel leídos de la config viva (solo GET).
 *   · `trappvel_captura`: un pantallazo. Bloqueo → `leerPantallazoDeBloqueo('detectar')` (y, si la detección no da
 *     la casilla, otra vez con la casilla correcta, para medir la lectura aparte). A medida → `detectarTipoDeCaptura`
 *     y `leerImagenDeCaptura` con el tipo de la clave (lo que hace la persona cuando la detección se equivoca).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { comparar, normalizarTexto, type ComparacionCampo } from './comparar'
import type { Caso, ResultadoFamilia } from './familias'

const RAIZ = path.resolve(__dirname, '../..')
const SUBRUTA = 'proyectos/trappvel/clarity/qa/2026-10-29_punta-a-punta-10-viajes'
/** El día de la QA: los chats son de octubre de 2026 y el año del viaje se infiere desde aquí. */
export const HOY_QA = '2026-10-29'
const LLAVE_RELLENO = 'eval-haiku-sin-gemini'

export function carpetaQa(): string | null {
  const candidatas = [
    process.env.TRAPPVEL_QA_DIR,
    path.resolve(RAIZ, '..', SUBRUTA),
    // Worktree en metrik-one/.claude/worktrees/<x>.
    path.resolve(RAIZ, '../../../..', SUBRUTA),
  ].filter((x): x is string => !!x)
  return candidatas.find((c) => existsSync(path.join(c, 'viajes'))) ?? null
}

// ── La clave ────────────────────────────────────────────────────────────────

export interface FilaClave {
  png: string
  tipo: string
  lectura: string
  moneda: string
  total: number | null
  costo: number | null
}

export interface Clave {
  viaje: string
  destino: string
  fechas: { inicio: string | null; fin: string | null }
  composicion: { adultos: number; ninos: number; infantes: number }
  edades: number[]
  modalidad: 'bloqueo' | 'a_medida'
  todoIncluido: boolean
  filas: FilaClave[]
}

/** «4.593.600 COP», «US$ 1,674.00», «1.184,00 EUR», «456,00 EUR» → número. `null` si no hay cifra. */
export function montoDeClave(texto: string): number | null {
  const m = /-?\d[\d.,]*/.exec(texto.replace(/\*/g, ''))
  if (!m) return null
  let s = m[0].replace(/[.,]$/, '')
  const ultimoPunto = s.lastIndexOf('.')
  const ultimaComa = s.lastIndexOf(',')
  if (ultimoPunto >= 0 && ultimaComa >= 0) {
    const dec = ultimoPunto > ultimaComa ? '.' : ','
    s = s.replace(dec === '.' ? /,/g : /\./g, '').replace(dec, '.')
  } else if (ultimaComa >= 0) {
    s = /,\d{2}$/.test(s) ? s.replace(/,/g, '.') : s.replace(/,/g, '')
  } else if (ultimoPunto >= 0) {
    s = /\.\d{3}(\.|$)/.test(s) ? s.replace(/\./g, '') : s
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const iso = (d: string, m: string, a: string) => `${a}-${m}-${d}`

export function leerClave(md: string): Clave {
  const linea = (rotulo: string) => new RegExp(`\\*\\*${rotulo}:\\*\\*\\s*(.+)`).exec(md)?.[1] ?? ''
  const titulo = /^# Clave · Viaje (\d+) · (.+)$/m.exec(md)
  const f = /(\d{2})\/(\d{2})\/(\d{4})\s*→\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(linea('Fechas'))
  const viajeros = linea('Viajeros')
  const cuantos = (re: RegExp) => Number(re.exec(viajeros)?.[1] ?? 0)
  const edadesDe = (re: RegExp) => {
    const m = re.exec(viajeros)
    return m ? (m[1].match(/\d+/g) ?? []).map(Number) : []
  }
  const modalidad = linea('Modalidad')
  const filas: FilaClave[] = []
  for (const l of md.split('\n')) {
    const c = /^\|\s*`([^`]+\.png)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/.exec(l)
    if (!c) continue
    filas.push({
      png: c[1], tipo: c[2].trim(), lectura: c[3].trim(), moneda: c[4].trim(),
      total: montoDeClave(c[5]), costo: montoDeClave(c[6]),
    })
  }
  return {
    viaje: titulo?.[1] ?? '?',
    destino: (titulo?.[2] ?? '').trim(),
    fechas: f ? { inicio: iso(f[1], f[2], f[3]), fin: iso(f[4], f[5], f[6]) } : { inicio: null, fin: null },
    composicion: {
      adultos: cuantos(/(\d+)\s+adultos?/),
      ninos: cuantos(/(\d+)\s+niñ[oa]s?/),
      infantes: cuantos(/(\d+)\s+infantes?/),
    },
    edades: [...edadesDe(/\d+\s+niñ[oa]s?\s*\(([^)]*)\)/), ...edadesDe(/\d+\s+infantes?\s*\(([^)]*)\)/)],
    modalidad: /bloqueo/i.test(modalidad) ? 'bloqueo' : 'a_medida',
    todoIncluido: /todo incluido/i.test(modalidad),
    filas,
  }
}

/** Aeropuertos de Colombia que aparecen en el banco: con todos los vuelos entre ellos, el viaje es nacional. */
const NACIONALES = new Set(['BOG', 'ADZ', 'CTG', 'SMR', 'MDE', 'CLO', 'BAQ', 'PEI', 'BGA', 'CUC', 'LET'])

export function destinoTipoDeClave(c: Clave): 'nacional' | 'internacional' | null {
  const codigos = c.filas.filter((f) => /vuelo/i.test(f.tipo)).flatMap((f) => f.lectura.match(/\b[A-Z]{3}\b/g) ?? [])
    .filter((x) => !['COP', 'USD', 'EUR', 'SIN'].includes(x))
  if (!codigos.length) return null
  return codigos.every((x) => NACIONALES.has(x)) ? 'nacional' : 'internacional'
}

export function composicionDeClave(c: Clave): string {
  const { adultos, ninos, infantes } = c.composicion
  if (ninos + infantes > 0) return 'familia'
  if (adultos === 1) return 'individual'
  if (adultos === 2) return 'pareja'
  return 'grupo'
}

/** Los operadores de los paquetes de bloqueo (primer tramo de la lectura del hotel: «Aliados Travel · …»). */
export function operadoresDeClave(c: Clave): string[] {
  return [...new Set(c.filas.filter((f) => /bloqueo · hotel/i.test(f.tipo)).map((f) => f.lectura.split('·')[0].trim()))]
}

/** «→ 15 campos», «→ **17 campos**», «Llené 15 campos» del DA1 de la bitácora del viaje: la vara de Gemini. */
export function varaDeBitacora(md: string): number | null {
  const l = md.split('\n').find((x) => /pegar conversaci/i.test(x))
  const m = l ? /(\d+)\s*campos/.exec(l.replace(/\*/g, '')) : null
  return m ? Number(m[1]) : null
}

/**
 * El presupuesto que Gemini puso en la QA (la clave no lo trae): la etiqueta de la opción tal como la anotó la bitácora
 * en el DA1 («Entre $8 y $12 millones», «Más de $20 millones», «presupuesto <3 M»). `null` si la bitácora no lo dice.
 */
export function presupuestoDeBitacora(md: string): string | null {
  const l = md.split('\n').find((x) => /pegar conversaci/i.test(x))
  if (!l) return null
  const t = normalizarTexto(l)
  const m = /entre (\d+) y (\d+) millones/.exec(t)
  if (m) return `${m[1]}m_${m[2]}m`
  if (/mas de 20 millones/.test(t)) return 'mas_20m'
  if (/menos de 3 millones/.test(t) || /presupuesto\s*<\s*3/i.test(l)) return 'menos_3m'
  if (/aun no tiene presupuesto definido/.test(t)) return 'sin_definir'
  return null
}

// ── Casos ───────────────────────────────────────────────────────────────────

export function casosTrappvel(familias: string[] | null): Caso[] {
  const dir = carpetaQa()
  const quiere = (f: string) => !familias || familias.includes(f)
  if (!dir || (!quiere('trappvel_conversacion') && !quiere('trappvel_captura'))) return []
  const casos: Caso[] = []
  const viajes = readdirSync(path.join(dir, 'viajes')).filter((d) => /^\d{2}-/.test(d)).sort()
  for (const v of viajes) {
    const base = path.join(dir, 'viajes', v)
    if (!existsSync(path.join(base, 'clave.md'))) continue
    const clave = leerClave(readFileSync(path.join(base, 'clave.md'), 'utf8'))
    const n = v.slice(0, 2)
    // El viaje 03 escribió su bitácora en `bitacora.md` (fue el primero).
    const bitacoras = [path.join(dir, `bitacora-viaje${n}.md`), ...(n === '03' ? [path.join(dir, 'bitacora.md')] : [])]
      .filter((p) => existsSync(p)).map((p) => readFileSync(p, 'utf8'))
    const bit = bitacoras.map(varaDeBitacora).find((x) => x !== null) ?? null
    const presupuesto = bitacoras.map(presupuestoDeBitacora).find((x) => x !== null) ?? null
    if (quiere('trappvel_conversacion') && existsSync(path.join(base, 'conversacion.txt'))) {
      casos.push({ familia: 'trappvel_conversacion', id: v, entrada: { ruta: path.join(base, 'conversacion.txt'), clave }, oraculo: { vara: bit, presupuesto } })
    }
    if (quiere('trappvel_captura')) {
      for (const fila of clave.filas) {
        const ruta = path.join(base, 'png', fila.png)
        if (!existsSync(ruta)) continue
        casos.push({ familia: 'trappvel_captura', id: `${n}/${fila.png.replace(/\.png$/, '')}`, entrada: { ruta, clave, fila }, oraculo: {} })
      }
    }
  }
  return casos
}

// ── Conversación ────────────────────────────────────────────────────────────

let camposCache: unknown[] | null = null

/** Los campos de «Condiciones del viaje» de Trappvel (el bloque con `modalidad_viaje`), de la config viva. Solo GET. */
async function camposDeTrappvel(): Promise<unknown[]> {
  if (camposCache) return camposCache
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !k) throw new Error('faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para leer la config de Trappvel')
  const h = { apikey: k, Authorization: `Bearer ${k}` }
  const ws = (await (await fetch(`${url}/rest/v1/workspaces?slug=eq.trappvel&select=id`, { headers: h })).json()) as Array<{ id: string }>
  if (!ws[0]) throw new Error('no se encontró el espacio trappvel')
  const filtro = encodeURIComponent(JSON.stringify({ fields: [{ slug: 'modalidad_viaje' }] }))
  const bc = (await (await fetch(`${url}/rest/v1/bloque_configs?workspace_id=eq.${ws[0].id}&config_extra=cs.${filtro}&select=config_extra`, { headers: h })).json()) as Array<{ config_extra: { fields: unknown[] } }>
  if (!bc[0]) throw new Error('Trappvel no tiene un bloque con modalidad_viaje')
  camposCache = bc[0].config_extra.fields
  return camposCache
}

const contiene = (obtenido: unknown, esperado: string) => {
  const o = normalizarTexto(obtenido)
  return esperado.split(/\s*(?:[/+–·,-]|\by\b)\s*/).map((p) => normalizarTexto(p.replace(/\([^)]*\)/g, ''))).filter(Boolean)
    .every((p) => p.split(' ').filter((w) => w.length >= 4).some((w) => o.includes(w)))
}

function campoLibre(campo: string, esperado: unknown, obtenido: unknown, ok: boolean): ComparacionCampo {
  return { campo, esperado, obtenido, ok }
}

const edadesDe = (v: unknown) => (String(v ?? '').match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b)

export async function trappvelConversacion(c: Caso): Promise<ResultadoFamilia> {
  process.env.GEMINI_API_KEY = LLAVE_RELLENO
  const clave = c.entrada.clave as Clave
  const fields = (await camposDeTrappvel()) as never[]
  const { normalizarChat, mensajesDelChat, cargarChatEnBloque, viajeParaModelo } = await import('../../src/lib/negocios/pegar-conversacion')
  const { leerChatConModelo } = await import('../../src/lib/negocios/pegar-conversacion-modelo')
  const limpio = normalizarChat(readFileSync(String(c.entrada.ruta), 'utf8'))
  const { mensajes, total, recortado } = mensajesDelChat(limpio)
  const viaje = viajeParaModelo({ codigo: 'T1 26 1', nombre: `${clave.destino} (prueba ${clave.viaje})`, cliente: null })
  // Solo para comparar, sin tocar el código: `EVAL_ESFUERZO_CHAT` (low | medium | high) mide otro esfuerzo, y
  // `EVAL_CHAT_COMO_ANTES=1` corre el pedido como estaba antes del 2026-11-04 (sin el párrafo de Haiku, sin pensamiento).
  const esf = process.env.EVAL_ESFUERZO_CHAT as 'low' | 'medium' | 'high' | undefined
  const antes = process.env.EVAL_CHAT_COMO_ANTES === '1'
  const { crearFetchModelo, fetchModelo } = await import('../../supabase/functions/_shared/llm-anthropic')
  const lectura = await leerChatConModelo({
    fields, mensajes, hoyISO: HOY_QA, yaTiene: {}, viaje, apiKey: LLAVE_RELLENO,
    ...(antes ? { fetch: fetchModelo, paraHaiku: false } : esf ? { fetch: crearFetchModelo({ esfuerzo: esf }) } : {}),
  })
  if (lectura.error || lectura.json === null) return { campos: [], error: lectura.error ?? 'sin lectura' }
  const carga = cargarChatEnBloque({ fields, data: {}, raw: lectura.json, mensajes, total, recortado, hoyISO: HOY_QA, ahoraIso: new Date().toISOString(), huella: 'evalhaiku' })
  const v = carga.valores
  const campos: ComparacionCampo[] = [
    campoLibre('destino', clave.destino, v.destino ?? null, contiene(v.destino, clave.destino)),
    comparar('fecha_salida', clave.fechas.inicio, v.fecha_salida ?? null),
    comparar('fecha_regreso', clave.fechas.fin, v.fecha_regreso ?? null),
    comparar('adultos', clave.composicion.adultos, v.adultos ?? null),
    comparar('ninos', clave.composicion.ninos, v.ninos ?? 0),
    comparar('infantes', clave.composicion.infantes, v.infantes ?? 0),
    comparar('composicion', composicionDeClave(clave), v.composicion ?? null),
    comparar('modalidad_viaje', clave.modalidad, v.modalidad_viaje ?? (clave.modalidad === 'a_medida' ? 'a_medida' : null)),
  ]
  const dt = destinoTipoDeClave(clave)
  if (dt) campos.push(comparar('destino_tipo', dt, v.destino_tipo ?? null))
  if (clave.edades.length) {
    const e = [...clave.edades].sort((a, b) => a - b)
    campos.push(campoLibre('edades_menores', e.join(', '), v.edades_menores ?? null, JSON.stringify(edadesDe(v.edades_menores)) === JSON.stringify(e)))
  }
  const ops = operadoresDeClave(clave)
  if (clave.modalidad === 'bloqueo' && ops.length) {
    campos.push(campoLibre('operador_bloqueo', ops.join(' / '), v.operador_bloqueo ?? null, ops.every((o) => contiene(v.operador_bloqueo, o))))
  }
  if (clave.todoIncluido) campos.push(comparar('plan_alimentacion', 'todo_incluido', v.plan_alimentacion ?? null))
  // El presupuesto no está en la clave: la vara es lo que Gemini puso en la QA (bitácora). El chat 10 se pegó en dos
  // partes en la QA; con el chat entero el presupuesto cambia, así que ahí no se califica.
  const pres = c.oraculo.presupuesto as string | null
  if (pres && clave.viaje !== '10') campos.push(comparar('presupuesto(Gemini)', pres, v.presupuesto ?? null))
  const llenados = carga.resumen.llenados.length
  const vara = c.oraculo.vara as number | null
  if (vara !== null) campos.push(campoLibre('llenados≥Gemini', vara, llenados, llenados >= vara))
  return { campos }
}

// ── Pantallazos ─────────────────────────────────────────────────────────────

type TipoClave = 'bloqueo_hotel' | 'bloqueo_vuelo' | 'vuelo' | 'hotel' | 'actividad' | 'traslado' | 'tren' | 'otro'

export function tipoDeFila(f: FilaClave): TipoClave {
  const t = normalizarTexto(f.tipo)
  if (t.startsWith('bloqueo')) return t.includes('vuelo') ? 'bloqueo_vuelo' : 'bloqueo_hotel'
  if (t.includes('tren')) return 'tren'
  if (t.startsWith('vuelo')) return 'vuelo'
  if (t.startsWith('hotel')) return 'hotel'
  if (t.startsWith('actividad')) return 'actividad'
  if (t.startsWith('traslado')) return 'traslado'
  return 'otro'
}

/** «AV 9586», «P5 7520», «FR 9248», «vuelo 5260» → los números de vuelo o tren de la clave. */
export function numerosDeVuelo(lectura: string): string[] {
  const xs = [...lectura.matchAll(/\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b|\bvuelo (\d{3,4})\b/g)].map((m) => m[1] ?? m[2])
  return [...new Set(xs)]
}

/** «P5 7312», «AV9586», «7312» frente al número de la clave («7312»): el código de la aerolínea no cuenta. */
export function numeroIgual(leido: unknown, n: string): boolean {
  const m = /(\d{1,4})\s*$/.exec(String(leido ?? '').trim())
  return !!m && m[1] === n
}

const nochesDe = (lectura: string) => {
  const m = /(\d+)\s+noches/.exec(lectura)
  return m ? Number(m[1]) : null
}

/** Precio por persona de una acomodación del bloqueo: con tres columnas (pública / descuento / neta), la neta. */
export function precioBloqueo(lectura: string, rotulo: RegExp): number | null {
  const m = new RegExp(`${rotulo.source}[^$]*((?:\\$\\s*[\\d.]+\\s*/?\\s*)+)`).exec(lectura)
  if (!m) return null
  const precios = m[1].match(/[\d.]+/g) ?? []
  return precios.length ? montoDeClave(precios[precios.length - 1]) : null
}

const nombreDe = (lectura: string, i: number) => lectura.split('·')[i]?.replace(/★/g, '').trim() ?? ''

/** El texto entero de lo que se leyó, para buscar números de vuelo y noches sin depender del campo exacto. */
const textoDe = (x: unknown) => JSON.stringify(x ?? null)

async function dataUrl(ruta: string): Promise<string> {
  return `data:image/png;base64,${readFileSync(ruta).toString('base64')}`
}

export async function trappvelCaptura(c: Caso): Promise<ResultadoFamilia> {
  process.env.GEMINI_API_KEY = LLAVE_RELLENO
  const fila = c.entrada.fila as FilaClave
  const clave = c.entrada.clave as Clave
  const tipo = tipoDeFila(fila)
  const url = await dataUrl(String(c.entrada.ruta))
  const campos: ComparacionCampo[] = []

  if (tipo === 'bloqueo_hotel' || tipo === 'bloqueo_vuelo') {
    const { leerPantallazoDeBloqueo } = await import('../../src/lib/cotizaciones/bloqueo-leer')
    const cual = tipo === 'bloqueo_hotel' ? 'hotel' : 'vuelo'
    let r = await leerPantallazoDeBloqueo('detectar', url)
    const detectada = r.ok ? r.cual : r.elegir ? `(elegir${r.detalle ? `: ${r.detalle}` : ''})` : `(falló: ${r.mensaje})`
    campos.push(comparar('casilla_detectada', cual, detectada))
    if (!r.ok || r.cual !== cual) r = await leerPantallazoDeBloqueo(cual, url)
    if (!r.ok) return { campos, error: `${r.mensaje}${r.detalle ? ` — ${r.detalle}` : ''}`.slice(0, 300) }
    if (r.cual === 'hotel') {
      const h = r.hotel
      campos.push(campoLibre('hotel', nombreDe(fila.lectura, 1), h.hotel, contiene(h.hotel, nombreDe(fila.lectura, 1))))
      campos.push(campoLibre('operador', nombreDe(fila.lectura, 0), r.operador ?? null, contiene(r.operador, nombreDe(fila.lectura, 0))))
      campos.push(comparar('noches', nochesDe(fila.lectura), h.noches))
      campos.push(comparar('moneda', fila.moneda, h.moneda))
      if (/todo incluido/i.test(fila.lectura)) campos.push(campoLibre('plan', 'todo incluido', h.planAlimentacion, /todo incluido/.test(normalizarTexto(h.planAlimentacion))))
      for (const [acom, re] of [['sencilla', /Sencilla/], ['doble', /Doble/], ['triple', /Triple/], ['cuadruple', /Cuádruple/]] as const) {
        const esperado = precioBloqueo(fila.lectura, re)
        if (esperado === null) continue
        campos.push(comparar(`precio_${acom}`, esperado, h.precios.find((p) => p.acomodacion === acom)?.precioPorPersona ?? null))
      }
      const chd = precioBloqueo(fila.lectura, /CHD/)
      if (chd !== null) campos.push(comparar('precio_chd', chd, h.nino?.precio ?? null))
      const inf = precioBloqueo(fila.lectura, /INF/)
      if (inf !== null) campos.push(comparar('precio_inf', inf, h.infante?.precio ?? null))
    } else {
      const nums = numerosDeVuelo(fila.lectura)
      const t = r.vuelo.tramos
      campos.push(comparar('n_tramos', nums.length, t.length))
      campos.push(campoLibre('numeros_vuelo', nums.join(' '), t.map((x) => x.numeroVuelo).join(' '), nums.every((n) => t.some((x) => numeroIgual(x.numeroVuelo, n)))))
      campos.push(campoLibre('fechas_tramos', clave.fechas.inicio, t.map((x) => x.fecha).join(' '), !!clave.fechas.inicio && t.some((x) => x.fecha === clave.fechas.inicio)))
    }
    return { campos }
  }

  const { detectarTipoDeCaptura } = await import('../../src/lib/ai/detectar-tipo-captura')
  const { leerImagenDeCaptura } = await import('../../src/lib/cotizaciones/leer-imagen-captura')
  const { definicionDeTipo } = await import('../../src/lib/cotizaciones/ranuras-cotizacion')
  const buffer = readFileSync(String(c.entrada.ruta))
  const d = await detectarTipoDeCaptura(buffer, 'image/png', LLAVE_RELLENO)
  // El carro no tiene tipo propio: lo elige la persona como «Otro servicio». El tren puede verse como traslado.
  if (tipo !== 'otro') {
    const ok = d.data?.tipo === tipo || (tipo === 'tren' && d.data?.tipo === 'traslado')
    campos.push(campoLibre('tipo_detectado', tipo, d.data?.tipo ?? d.error ?? null, ok))
  }
  const opciones = tipo === 'hotel' ? { reservaVariasHabitaciones: true } : tipo === 'traslado' ? { trasladoIdaYRegreso: true } : null
  const r = await leerImagenDeCaptura({
    ranura: definicionDeTipo(tipo),
    dataUrl: url,
    viaje: { composicion: clave.composicion, fechas: clave.fechas, destino: clave.destino, presentacion: null, nivelDetalle: 'normal' as never },
    ...(opciones ? { opciones } : {}),
  })
  if (!r.ok) return { campos, error: `${r.codigo}: ${r.mensaje}${r.detalle ? ` — ${r.detalle}` : ''}`.slice(0, 300) }
  const l = r.leida
  campos.push(comparar('moneda', fila.moneda, l.moneda))
  campos.push(comparar('total', fila.total, l.total))
  campos.push(comparar('costo', fila.costo, l.aPagarAgencia ?? l.total))
  const todo = textoDe({ identidad: l.identidad, campos: l.campos, nombre: l.nombre, descripcion: l.descripcion })
  if (tipo === 'vuelo' || tipo === 'tren') {
    const nums = numerosDeVuelo(fila.lectura)
    campos.push(campoLibre('numeros_vuelo', nums.join(' '), nums.filter((n) => new RegExp(`\\b[A-Z0-9]{0,2}\\s?${n}\\b`).test(todo)).join(' '), nums.every((n) => new RegExp(`\\b[A-Z0-9]{0,2}\\s?${n}\\b`).test(todo))))
  }
  if (tipo === 'hotel') {
    const nombre = nombreDe(fila.lectura, 0)
    campos.push(campoLibre('hotel', nombre, l.nombre, contiene(`${l.nombre} ${l.identidad.hotel ?? ''}`, nombre)))
    const n = nochesDe(fila.lectura)
    if (n !== null) campos.push(comparar('noches', n, l.campos.find((k) => normalizarTexto(k.label) === 'noches')?.valor ?? null))
    const f = /(\d{2})\/(\d{2})\/(\d{4})\s*→\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(fila.lectura)
    if (f) {
      campos.push(comparar('check_in', iso(f[1], f[2], f[3]), l.identidad.check_in ?? null))
      campos.push(comparar('check_out', iso(f[4], f[5], f[6]), l.identidad.check_out ?? null))
    }
  }
  return { campos }
}
