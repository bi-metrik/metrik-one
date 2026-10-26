/**
 * Cómo se nombra a un responsable en el detalle del negocio: con su área
 * («Comercial · Tatiana Cortés») y el nombre completo, sin truncar.
 *
 * `negocio_responsables.rol` es 'comercial' | 'operaciones' | null. Null (staff
 * financiero o sin área declarada) muestra solo el nombre: no se inventa etiqueta.
 */

import { fechaCortaBogota } from '@/lib/cotizaciones/marco-negocio'

/**
 * Quién y cómo lo asignó (`negocio_responsables.assigned_by` / `asignado_origen`, migración 20261026090000).
 * Ausente = no se pudo leer (la línea no se pinta).
 */
export type QuienAsigno = {
  assigned_at: string | null
  /** 'persona' | 'bot_whatsapp' | 'regla_etapa' | null (filas anteriores al 2026-10-26). */
  origen: string | null
  /** Nombre del staff del workspace cuyo perfil es `assigned_by`; null si no hay o no se resuelve. */
  asignadoPor: string | null
  /** `assigned_by` es el perfil del propio responsable. */
  seAsigno: boolean
  /** Con origen `regla_etapa`: nombre de la etapa a la que entró el negocio. */
  etapa: string | null
}

export type ResponsableConRol = { id: string; full_name: string; rol?: string | null; asignacion?: QuienAsigno }

const ETIQUETAS: Record<string, string> = {
  comercial: 'Comercial',
  operaciones: 'Operaciones',
}

const ORDEN: Record<string, number> = { comercial: 0, operaciones: 1 }

/** 'Comercial' | 'Operaciones' | null (rol ausente o desconocido: sin etiqueta). */
export function etiquetaRol(rol: string | null | undefined): string | null {
  if (!rol) return null
  return ETIQUETAS[rol] ?? null
}

/** Comercial primero, luego operaciones, luego sin rol. Estable dentro de cada grupo; no muta. */
export function ordenarResponsables<T extends ResponsableConRol>(responsables: readonly T[]): T[] {
  const peso = (r: T) => (r.rol != null && r.rol in ORDEN ? ORDEN[r.rol] : 2)
  return responsables
    .map((r, i) => ({ r, i }))
    .sort((a, b) => peso(a.r) - peso(b.r) || a.i - b.i)
    .map(({ r }) => r)
}

/** Texto de la ficha: «Comercial · Tatiana Cortés», o solo el nombre si no hay rol. */
export function textoResponsable(r: ResponsableConRol): string {
  const etiqueta = etiquetaRol(r.rol)
  return etiqueta ? `${etiqueta} · ${r.full_name}` : r.full_name
}

/**
 * La línea bajo el nombre en la ficha (texto de Noor, 2026-10-26), con la fecha corta de Bogotá:
 *   · persona: «Asignó Edgar Alarcón · 23 oct»; si es el mismo responsable, «Se asignó · 23 oct»
 *   · bot: «Asignado por el bot de WhatsApp · 23 oct» (y el `title` lo dice completo)
 *   · etapa: «Automático al entrar a Cotización · 23 oct», o «Automático por etapa» si no se sabe cuál
 *   · sin origen ni quién asignó: null (no se pinta).
 * Una persona que no se resuelve a un nombre del workspace (p. ej. soporte de MéTRIK) tampoco se pinta: no se inventa.
 */
export function lineaAsignador(a: QuienAsigno | undefined): { texto: string; title?: string } | null {
  if (!a) return null
  const fecha = fechaCortaBogota(a.assigned_at)
  const conFecha = (t: string) => (fecha ? `${t} · ${fecha}` : t)
  if (a.origen === 'bot_whatsapp') {
    return {
      texto: conFecha('Asignado por el bot de WhatsApp'),
      title: `Asignado automáticamente por el bot de WhatsApp${fecha ? ` el ${fecha}` : ''}`,
    }
  }
  if (a.origen === 'regla_etapa') {
    const etapa = (a.etapa ?? '').trim()
    return { texto: conFecha(etapa ? `Automático al entrar a ${etapa}` : 'Automático por etapa') }
  }
  if (a.seAsigno) return { texto: conFecha('Se asignó') }
  if (a.asignadoPor) return { texto: conFecha(`Asignó ${a.asignadoPor}`) }
  return null
}
