/**
 * Pegar una conversación en el viaje (Mauricio, 2026-10-11: «Pegar el chat o cargar una conversación y que el sistema
 * entienda y llene los campos»).
 *
 * La comercial pega el chat (o sube el .txt que exporta WhatsApp) en el bloque de la solicitud y ONE lo entiende con la
 * MISMA extracción del bot: el prompt, el esquema y las invariantes viven en
 * `supabase/functions/_shared/agente/bandeja/extraccion.ts`, y la escritura que no pisa a una persona en
 * `supabase/functions/_shared/wa-carga-reglas.ts` (`cargarEnExistente`). Aquí no hay una segunda copia de nada de eso:
 * se IMPORTA (los módulos de `_shared` que se importan son puros, sin `Deno`). El modelo interpreta y clasifica; el código
 * solo protege invariantes. Por eso esto no lee el chat: lo parte en líneas (cada línea, un mensaje), quita los
 * caracteres invisibles que mete WhatsApp al exportar y se queda con lo más reciente si no cabe.
 *
 * Cómo queda en el bloque:
 *   · campo vacío → el valor entra como SUGERIDO (`_sugeridos`, la marca de siempre; la comercial confirma o corrige);
 *   · campo con un sugerido que nadie confirmó → lo dicho gana (como en el bot);
 *   · campo que escribió o confirmó una persona y el chat dice otra cosa → NO se pisa: va a `_conflictos`.
 *
 * Puro: no escribe ni llama al modelo. El servidor es `pegar-conversacion-servidor.ts`.
 */

import { validarCarga } from '../../../supabase/functions/_shared/agente/bandeja/extraccion.ts'
import type { SugeridoAgente } from '../../../supabase/functions/_shared/agente/bandeja/extraccion.ts'
import { cargarEnExistente, valorLegible } from '../../../supabase/functions/_shared/wa-carga-reglas.ts'
import type { CampoEntendible } from '../../../supabase/functions/_shared/wa-entendimiento-reglas.ts'
import { aplanarBloques, calcularNiveles } from './niveles-solicitud'
import { PREFIJO_ENTREGA_CHAT } from './sugeridos'

/** Lo más que se le pasa al modelo (lo más reciente del chat). El mismo tope de escritos que usa el bot. */
export const TOPE_CHAT_CARACTERES = 24_000
/** Lo más que acepta el servidor (un chat exportado de años). Lo que pase de aquí ni se lee. */
export const MAX_ENTRADA_CARACTERES = 2_000_000

// Marcas de dirección y de ancho cero que WhatsApp mete al exportar o copiar (LRM antes de «<adjunto>», BOM al inicio,
// el espacio angosto de «10:15 p. m.»). No son texto: se quitan o se vuelven espacio.
const INVISIBLES = /[​-‏‪-‮⁦-⁩﻿]/g
const ESPACIOS_RAROS = /[   ]/g

/** El chat sin marcas invisibles y con saltos de línea normales. Pura. */
export function normalizarChat(texto: string): string {
  return texto.replace(/\r\n?/g, '\n').replace(INVISIBLES, '').replace(ESPACIOS_RAROS, ' ').trim()
}

/**
 * Las líneas del chat, cada una un mensaje, sin las vacías. Si no caben en el tope se queda con las más RECIENTES (el
 * final del chat es lo último que se dijo). Pura.
 */
export function mensajesDelChat(texto: string, tope = TOPE_CHAT_CARACTERES): { mensajes: string[]; total: number; recortado: boolean } {
  const lineas = normalizarChat(texto).split('\n').map((l) => l.trim()).filter(Boolean)
  const mensajes: string[] = []
  let usados = 0
  for (let i = lineas.length - 1; i >= 0; i--) {
    usados += lineas[i].length + 1
    if (usados > tope && mensajes.length) break
    mensajes.unshift(lineas[i].slice(0, tope))
  }
  return { mensajes, total: lineas.length, recortado: mensajes.length < lineas.length }
}

/** Cómo se nombra el viaje para el modelo: código, nombre y cliente. Pura. */
export function viajeParaModelo(p: { codigo?: string | null; nombre?: string | null; cliente?: string | null }): string {
  const partes = [p.codigo, p.nombre ? `«${p.nombre}»` : null].filter(Boolean).join(' ')
  const base = partes || 'el viaje abierto'
  return p.cliente ? `${base}, del cliente ${p.cliente}` : base
}

export interface ResumenChat {
  /** «Destino: CARTAGENA», «Infantes: 1 (deducido)». Quedan como sugeridos. */
  llenados: string[]
  /** Sugeridos que nadie había confirmado y el chat cambió: «Adultos: 2 → 3». */
  reemplazados: string[]
  /** Lo que ya tenía un valor de una persona y el chat dice otra cosa: no se tocó. */
  conflictos: string[]
  /** Sugeridos sin confirmar que el chat pidió quitar. */
  quitados: string[]
  /** Lo que el modelo no entendió claro: se pregunta, no se llena. */
  dudas: string[]
  /** Otros viajes o personas que aparecen en el chat y no se llenaron. */
  otros: string[]
  /** Lo que sigue faltando para el mínimo de cotizar, como pregunta. */
  faltaMinimo: string[]
  /** Hay mínimo declarado en el bloque (si no, `faltaMinimo` vacío no dice «completo»). */
  hayMinimo: boolean
  mensajes: number
  recortado: boolean
}

export interface CargaDelChat {
  /** La `data` nueva del bloque, o `null` si no cambia nada. */
  data: Record<string, unknown> | null
  /** Los campos cuyo valor cambió (para refrescar la pantalla sin recargar). */
  valores: Record<string, unknown>
  /** Slugs llenados o reemplazados (los que quedan con la marca de sugerido). */
  sugeridos: string[]
  /** Slugs en conflicto. */
  enConflicto: string[]
  resumen: ResumenChat
}

function marcaComo(s: SugeridoAgente | undefined): string {
  const como = s?.como ?? (s?.deduccion ? 'deducido' : undefined)
  return como ? ` (${como})` : ''
}

const vacio = (v: unknown) => v === undefined || v === null || v === ''

/**
 * Lo que el modelo devolvió, pasado por las invariantes del bot (`validarCarga`) y metido en la `data` del bloque sin
 * pisar a nadie (`cargarEnExistente` con `delModelo`). Pura.
 */
export function cargarChatEnBloque(p: {
  fields: ReadonlyArray<unknown>
  data: Record<string, unknown>
  raw: unknown
  mensajes: ReadonlyArray<string>
  total?: number
  recortado?: boolean
  hoyISO: string
  ahoraIso: string
  /** Huella corta del texto: queda en la marca de cada sugerido (`chat:<huella>`), no el texto. */
  huella: string
}): CargaDelChat {
  const campos = (p.fields ?? []) as CampoEntendible[]
  const { valores: yaTiene } = aplanarBloques([{ fields: campos, data: p.data }])
  const v = validarCarga(p.raw, campos, p.mensajes, { hoyISO: p.hoyISO, yaTiene })
  const meta = { entrega_id: `${PREFIJO_ENTREGA_CHAT}${p.huella}`, en: p.ahoraIso, origenDe: () => 'mensaje' as const }
  const r = cargarEnExistente(p.data, campos, v.sugeridos, meta, new Set(), {
    delModelo: true,
    ...(Object.keys(v.quitar).length ? { quitar: v.quitar } : {}),
  })
  const cambia = r.escritos.length + r.actualizados.length + r.conflictos.length + r.quitados.length > 0

  const porSlug = new Map(campos.map((f) => [f.slug, f]))
  const et = (slug: string) => porSlug.get(slug)?.label ?? slug
  const leg = (slug: string, x: unknown) => {
    const f = porSlug.get(slug)
    return f ? valorLegible(f, x) : String(x)
  }

  const valores: Record<string, unknown> = {}
  if (cambia) {
    for (const f of campos) {
      if (typeof f.slug !== 'string' || f.slug.startsWith('_')) continue
      if (String(p.data[f.slug] ?? '') !== String(r.data[f.slug] ?? '')) valores[f.slug] = r.data[f.slug] ?? ''
    }
  }

  const quedo = cambia ? r.data : p.data
  const niveles = calcularNiveles(campos, aplanarBloques([{ fields: campos, data: quedo }]).valores)

  const resumen: ResumenChat = {
    llenados: r.escritos.map((s) => `${et(s)}: ${leg(s, r.data[s])}${marcaComo(v.sugeridos[s])}`),
    reemplazados: r.actualizados.map((a) => `${et(a.slug)}: ${leg(a.slug, a.anterior)} → ${leg(a.slug, r.data[a.slug] ?? a.valor)}${marcaComo(v.sugeridos[a.slug])}`),
    conflictos: r.conflictos.map((c) => `${et(c.slug)}: tiene ${vacio(c.actual) ? '(vacío)' : leg(c.slug, c.actual)}, el chat dice ${leg(c.slug, c.valor)}`),
    quitados: r.quitados.map(et),
    dudas: v.dudas.map((d) => `${et(d.campo)}: ${d.pregunta}`),
    otros: v.otros,
    faltaMinimo: niveles.minimo.faltan.map((f) => f.pregunta),
    hayMinimo: niveles.minimo.total > 0,
    mensajes: p.total ?? p.mensajes.length,
    recortado: !!p.recortado,
  }
  return {
    data: cambia ? r.data : null,
    valores,
    sugeridos: [...r.escritos, ...r.actualizados.map((a) => a.slug)],
    enConflicto: r.conflictos.map((c) => c.slug),
    resumen,
  }
}

/** Lo que queda en la actividad del negocio: quién pegó lo dice el autor; aquí, la huella y lo que pasó. Pura. */
export function textoActividadChat(huella: string, c: CargaDelChat, fields: ReadonlyArray<unknown>): string {
  const porSlug = new Map((fields as CampoEntendible[]).map((f) => [f.slug, f.label ?? f.slug]))
  const nombres = (xs: string[]) => xs.map((s) => porSlug.get(s) ?? s).join(', ')
  const partes = [`Conversación pegada (huella ${huella}, ${c.resumen.mensajes} mensajes).`]
  if (c.sugeridos.length) partes.push(`Sugirió: ${nombres(c.sugeridos)}.`)
  if (c.enConflicto.length) partes.push(`En conflicto, sin cambiar: ${nombres(c.enConflicto)}.`)
  if (c.resumen.quitados.length) partes.push(`Quitó: ${c.resumen.quitados.join(', ')}.`)
  if (!c.sugeridos.length && !c.enConflicto.length && !c.resumen.quitados.length) partes.push('No cambió ningún dato.')
  const t = partes.join(' ')
  const chars = [...t]
  return chars.length <= 280 ? t : `${chars.slice(0, 279).join('')}…`
}
