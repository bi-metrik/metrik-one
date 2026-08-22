// ============================================================
// Resolucion participante -> cliente (empresa y negocio de ONE)
//
// El plan original era cruzar correo por correo contra el directorio de ONE.
// Se midio con `scripts/actas-participantes.ts 30` y el resultado fue 0 de 6:
// el workspace metrik tiene 3 correos en todo el directorio y ninguno aparece
// en una reunion. Cruzar por correo hoy no resuelve nada.
//
// Lo que SI resuelve hoy es el titulo del evento. Mauricio los titula siempre
// "Tema - Cliente x MeTRIK", y ese patron acerto en las 6 reuniones medidas.
// Y dos de los seis correos son gmail (Trappvel), asi que el dominio tampoco
// alcanza por si solo.
//
// De ahi el diseno: una cascada de senales ordenadas por cuanto se puede
// confiar en ellas, cada resolucion declara CUAL la resolvio, y ninguna
// inventa un cliente cuando no hay senal.
//
//   1. correo_exacto        el correo ya esta en contactos/empresas   -> alta
//   2. dominio_corporativo  el dominio ya se vio en esa empresa       -> alta
//   3. titulo_evento        "X x MeTRIK" contra el nombre de empresa  -> media
//   ninguna                 se marca sin cliente, decide Mauricio     -> ninguna
//
// El punto 1 hoy vale cero, pero es el que crece: `correosNuevos` devuelve los
// participantes externos que faltan en el directorio para que el acta, al
// confirmarse, los escriba. La proxima reunion con esa gente ya resuelve por
// correo. El flujo genera la data limpia que el flujo necesita.
//
// Las funciones de resolucion son PURAS. Solo `cargarDirectorio` toca la red.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { contraparteEn } from './transcripcion'

/** Dominios de correo personal: nunca identifican a una empresa. */
const DOMINIOS_PUBLICOS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.es',
  'outlook.com',
  'outlook.es',
  'live.com',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
])

/** Una contraparte mas corta que esto no se matchea: "A" pegaria con todo. */
const MINIMO_CONTRAPARTE = 3

export type SenalCliente = 'correo_exacto' | 'dominio_corporativo' | 'titulo_evento'
export type Confianza = 'alta' | 'media' | 'ninguna'

/** Como se eligio el negocio. null = quedo ambiguo y decide Mauricio. */
export type SenalNegocio = 'unico_abierto' | 'unico_en_ejecucion'

export interface NegocioDirectorio {
  id: string
  codigo: string | null
  nombre: string
  estado: string
  stageActual: string
}

export interface EmpresaDirectorio {
  id: string
  nombre: string
  codigo: string | null
  /** Correos conocidos de la empresa y de sus contactos, en minuscula. */
  correos: string[]
  /** Dominios corporativos derivados de esos correos (sin los publicos). */
  dominios: string[]
  negocios: NegocioDirectorio[]
}

export interface Directorio {
  empresas: EmpresaDirectorio[]
}

export interface ResolucionCliente {
  empresa: EmpresaDirectorio | null
  senal: SenalCliente | null
  confianza: Confianza
  /** El negocio, solo si una senal lo elige sin ambiguedad. */
  negocio: NegocioDirectorio | null
  senalNegocio: SenalNegocio | null
  /** Los abiertos de la empresa cuando hay mas de uno y hay que elegir. */
  negociosCandidatos: NegocioDirectorio[]
  /** Correos externos que no estan en el directorio. Alimentan contactos. */
  correosNuevos: string[]
}

// ── Normalizacion ───────────────────────────────────────────────────────────

/** Minuscula sin tildes ni puntuacion, para comparar nombres de empresa. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Solo formas juridicas: quitar palabras del nombre real (Group, Holding)
    // haria empatar empresas distintas, y un empate no resuelve nada.
    .replace(/\b(s\.?a\.?s\.?|ltda\.?|s\.?a\.?s|s\.?a\.?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function dominioDe(email: string): string | null {
  const d = email.toLowerCase().split('@')[1]?.trim()
  if (!d || DOMINIOS_PUBLICOS.has(d)) return null
  return d
}

// ── Resolucion (pura) ───────────────────────────────────────────────────────

/**
 * Elige el negocio dentro de la empresa ya resuelta.
 *
 * Medido sobre 30 dias: la empresa sale 8 de 8, pero 6 de esas 8 caen en una
 * empresa con varios negocios abiertos a la vez (Soena tiene 3, AFI tiene 4),
 * asi que "un solo abierto" solo alcanza para Trappvel.
 *
 * El desempate es el stage: una reunion de trabajo pertenece al proyecto que
 * se esta EJECUTANDO, no al que todavia se esta vendiendo ni al que ya esta en
 * cobro. Con ese filtro Soena y AFI quedan en uno solo cada una. No es un
 * heuristico de conveniencia: es la diferencia entre reunirse para acordar el
 * trabajo y reunirse para hacerlo.
 *
 * Si el stage tampoco desempata, no se elige. Un acta colgada del proyecto
 * equivocado es peor que un acta sin proyecto.
 */
function elegirNegocio(empresa: EmpresaDirectorio): {
  negocio: NegocioDirectorio | null
  senal: SenalNegocio | null
  candidatos: NegocioDirectorio[]
} {
  const abiertos = empresa.negocios.filter((n) => n.estado === 'abierto')
  if (abiertos.length === 1) {
    return { negocio: abiertos[0], senal: 'unico_abierto', candidatos: abiertos }
  }

  const enEjecucion = abiertos.filter((n) => n.stageActual === 'ejecucion')
  if (enEjecucion.length === 1) {
    return { negocio: enEjecucion[0], senal: 'unico_en_ejecucion', candidatos: abiertos }
  }

  return { negocio: null, senal: null, candidatos: abiertos }
}

/**
 * Resuelve a que cliente pertenece una reunion.
 *
 * @param correosExternos participantes que no son de MeTRIK, en cualquier caja
 * @param tituloEvento    titulo del evento de Calendar, si lo hay
 */
export function resolverCliente(
  correosExternos: string[],
  tituloEvento: string | null,
  directorio: Directorio,
): ResolucionCliente {
  const correos = correosExternos.map((c) => c.toLowerCase().trim()).filter(Boolean)

  const vacia: ResolucionCliente = {
    empresa: null,
    senal: null,
    confianza: 'ninguna',
    negocio: null,
    senalNegocio: null,
    negociosCandidatos: [],
    correosNuevos: [],
  }

  const conocidos = new Set(directorio.empresas.flatMap((e) => e.correos))
  const correosNuevos = [...new Set(correos.filter((c) => !conocidos.has(c)))]

  const armar = (
    empresa: EmpresaDirectorio,
    senal: SenalCliente,
    confianza: Confianza,
  ): ResolucionCliente => {
    const { negocio, senal: senalNegocio, candidatos } = elegirNegocio(empresa)
    return {
      empresa,
      senal,
      confianza,
      negocio,
      senalNegocio,
      negociosCandidatos: candidatos,
      correosNuevos,
    }
  }

  // 1. Correo exacto.
  for (const correo of correos) {
    const empresa = directorio.empresas.find((e) => e.correos.includes(correo))
    if (empresa) return armar(empresa, 'correo_exacto', 'alta')
  }

  // 2. Dominio corporativo ya visto en esa empresa.
  for (const correo of correos) {
    const dominio = dominioDe(correo)
    if (!dominio) continue
    const empresa = directorio.empresas.find((e) => e.dominios.includes(dominio))
    if (empresa) return armar(empresa, 'dominio_corporativo', 'alta')
  }

  // 3. Titulo del evento: "Tema - Cliente x MeTRIK".
  const contraparte = tituloEvento ? contraparteEn(tituloEvento) : null
  if (contraparte) {
    const aguja = normalizar(contraparte)
    if (aguja.length >= MINIMO_CONTRAPARTE) {
      const porTitulo = directorio.empresas.filter((e) => {
        const pajar = normalizar(e.nombre)
        if (!pajar) return false
        if (pajar === aguja) return true
        // "AFI" contra "AFI International Group": la contraparte abre el nombre
        // de la empresa en frontera de palabra. No al reves, para que "Soena
        // Group SAS" en el titulo no pegue con una empresa llamada "Soena G".
        return pajar === aguja || pajar.startsWith(`${aguja} `)
      })
      // Dos empresas que empiezan igual no es una resolucion: es un empate.
      if (porTitulo.length === 1) return armar(porTitulo[0], 'titulo_evento', 'media')
    }
  }

  return { ...vacia, correosNuevos }
}

// ── Carga del directorio (I/O) ──────────────────────────────────────────────

/**
 * Arma el directorio del workspace en una pasada: empresas, sus correos
 * conocidos (propios y de sus contactos via negocios) y sus negocios.
 */
export async function cargarDirectorio(
  sb: SupabaseClient,
  workspaceId: string,
): Promise<Directorio> {
  const [empresasRes, contactosRes, negociosRes] = await Promise.all([
    sb.from('empresas').select('id, nombre, codigo, contacto_email').eq('workspace_id', workspaceId),
    sb.from('contactos').select('id, nombre, email').eq('workspace_id', workspaceId),
    sb
      .from('negocios')
      .select('id, codigo, nombre, estado, stage_actual, empresa_id, contacto_id')
      .eq('workspace_id', workspaceId),
  ])

  if (empresasRes.error) throw empresasRes.error
  if (contactosRes.error) throw contactosRes.error
  if (negociosRes.error) throw negociosRes.error

  const correoDeContacto = new Map<string, string>()
  for (const c of contactosRes.data ?? []) {
    if (c.email) correoDeContacto.set(c.id, c.email.toLowerCase().trim())
  }

  // Un contacto se ata a la empresa por el negocio que comparten: es el unico
  // vinculo que existe hoy entre contactos y empresas.
  const correosPorEmpresa = new Map<string, Set<string>>()
  const negociosPorEmpresa = new Map<string, NegocioDirectorio[]>()
  for (const n of negociosRes.data ?? []) {
    if (!n.empresa_id) continue
    const lista = negociosPorEmpresa.get(n.empresa_id) ?? []
    lista.push({
      id: n.id,
      codigo: n.codigo,
      nombre: n.nombre,
      estado: n.estado,
      stageActual: n.stage_actual,
    })
    negociosPorEmpresa.set(n.empresa_id, lista)

    const correo = n.contacto_id ? correoDeContacto.get(n.contacto_id) : undefined
    if (correo) {
      const set = correosPorEmpresa.get(n.empresa_id) ?? new Set()
      set.add(correo)
      correosPorEmpresa.set(n.empresa_id, set)
    }
  }

  const empresas: EmpresaDirectorio[] = (empresasRes.data ?? []).map((e) => {
    const set = correosPorEmpresa.get(e.id) ?? new Set<string>()
    if (e.contacto_email) set.add(e.contacto_email.toLowerCase().trim())
    const correos = [...set]
    const dominios = [...new Set(correos.map(dominioDe).filter((d): d is string => !!d))]
    return {
      id: e.id,
      nombre: e.nombre,
      codigo: e.codigo,
      correos,
      dominios,
      negocios: negociosPorEmpresa.get(e.id) ?? [],
    }
  })

  return { empresas }
}
