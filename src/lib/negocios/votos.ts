/**
 * Voto entre fuentes: el MISMO dato leído de varios documentos, y cuál lectura es la mala.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────────────
 * En SOENA la IA leyó el RUT de V0142 como 1022424289 (es 1022424269) con confianza 0.98.
 * La factura y el certificado UPME traían el número bueno, y la cédula errada salió
 * impresa en la declaración juramentada y en la relación de facturas que ONE generó para
 * la DIAN. El sistema tenía dos fuentes que contradecían al RUT y no las comparó; y la
 * confianza del modelo no avisó nada, porque la confianza no mide si leyó bien.
 *
 * Un voto compara TODAS las lecturas de un dato (el documento de un titular en el RUT, en
 * la factura y en el certificado). Si dos coinciden y una difiere, la que difiere es una
 * lectura dudosa y se propone corregirla al valor de la mayoría. Si ninguna mayoría
 * existe, el dato queda en revisión manual.
 *
 * ── Las reglas ─────────────────────────────────────────────────────────────────────
 * - La confianza de la IA NO entra en ninguna parte. Lo que da por buena una lectura es
 *   que otra fuente independiente diga lo mismo.
 * - «Lo mismo» es `mismoDocumento` (tolera el DV pegado, el «13» del tipo de documento y
 *   el celular leído como documento), o la igualdad exacta. Un dígito distinto NO se
 *   tolera: es justo el error que el voto existe para ver.
 * - Tolerar al comparar no es dar por buena la lectura. El valor que se propone es siempre
 *   el LIMPIO (sin el «13» delante ni el DV detrás), y una lectura con el código del tipo
 *   de documento pegado es dudosa aunque diga el mismo documento: V0521 guardó 1380180688
 *   en la casilla 26 y la tarjeta decía que «coincidía» con la casilla 5 y la factura.
 *   El DV pegado de la factura sí coincide: así lo imprime la factura. Ver `formaLimpia`.
 * - Una fuente que falta, o cuyo bloque no le aplica al caso, no vota. Con menos de dos
 *   fuentes no hay voto; solo cuenta el dígito de verificación (abajo).
 * - Una lectura que una PERSONA editó (`edicion` en el campo) está verificada: si queda en
 *   minoría no se marca dudosa sino «confirmada», y en un empate desempata. Es la salida
 *   para una diferencia legítima (un NIT de extranjería que la persona conservó).
 * - Dígito de verificación: una fuente puede declarar el campo del DV de su documento. Si
 *   el número leído no valida con el DV, la lectura es mala aunque no haya otra fuente con
 *   qué compararla. Cuando otra fuente la respalda, manda la coincidencia: dos documentos
 *   distintos no se equivocan igual, y el DV también se lee.
 * - En una lista de personas (los compradores de la factura, los beneficiarios del
 *   certificado) se toma la persona del titular por NOMBRE. Si no se reconoce a nadie, la
 *   fuente no vota: adivinar a quién corresponde un número es peor que callar.
 *
 * Configuración: `lineas_negocio.config_extra.votos` (lista). Sin la clave, nada cambia.
 * Se evalúa en cada lectura del negocio, como los cruces: un veredicto guardado vuelve a
 * quedar viejo en cuanto alguien corrige una fuente.
 */

import { calcularDvNit } from '@/lib/dian/nit'
import { formaLimpia } from '@/lib/dian/prefijo-tipo-documento'
import { parsearPersonas } from '@/lib/documentos/personas'
import { valorCumpleCondicion } from './condicion-bloque'
import { mismoDocumento, valorDe, type ContextoFuentes } from './fuentes-negocio'

/** Comparación contra un campo del MISMO bloque de la fuente (misma semántica que `condition`). */
export interface CondicionLocal {
  field: string
  value?: string
  value_in?: unknown[]
}

export interface FuenteVoto {
  /** Cómo la ve el equipo: «RUT (casilla 26)», «Factura», «Certificado UPME». */
  etiqueta: string
  source_bloque_slug: string
  /**
   * Otros bloques con los mismos campos, en orden de preferencia (el certificado UPME
   * vive en Certificación o en Anexos según la ruta). Vota el primero que le aplique al
   * caso y traiga un número para el titular.
   */
  alternativas?: string[]
  /** Campo con el número (fuente de un solo valor). */
  field?: string
  /** Campo con una lista de personas (`NOMBRE (documento); …`). */
  lista?: string
  /** Pares nombre/documento (las filas de beneficiarios de un certificado). */
  personas?: Array<{ nombre: string; documento: string }>
  /** La fuente solo vota si un campo de SU bloque cumple esto. */
  si?: CondicionLocal
  /** Campo del mismo bloque con el dígito de verificación que la lectura debe validar. */
  dv?: string
  /** El número de esta fuente sale impreso en documentos que genera ONE. */
  alimenta_generacion?: boolean
}

export interface Voto {
  slug: string
  /** «Documento del titular». */
  label: string
  /** El voto solo se evalúa si esta condición se cumple (misma forma que `condition`). */
  condition?: Record<string, unknown>
  /** El nombre del titular: dice a qué persona de una lista le corresponde el voto. */
  nombre?: { source_bloque_slug: string; field: string }
  fuentes: FuenteVoto[]
  /** Etapas (por `orden`) en las que una lectura dudosa frena el avance. */
  bloquea_en_etapas?: number[]
  /** Con una lectura en disputa que alimenta documentos, ONE no genera formularios. */
  niega_generacion?: boolean
}

/**
 * - `coincide`: su número está en la mayoría.
 * - `dudosa`: está en minoría, o no valida con su DV, y ninguna persona lo verificó.
 * - `confirmada`: está en minoría pero una persona lo editó a mano.
 * - `en_disputa`: no hay mayoría; nadie sabe cuál es el bueno.
 * - `sin_contraste`: es la única fuente con dato y su DV (si lo hay) no la contradice.
 */
export type EstadoLectura = 'coincide' | 'dudosa' | 'confirmada' | 'en_disputa' | 'sin_contraste'

export interface LecturaFuente {
  /** Identifica la fuente dentro del voto: `slug.campo` (y `#n` si es una persona de una lista). */
  clave: string
  etiqueta: string
  bloque_slug: string
  /** El campo que se corrige para arreglar esta lectura. */
  field: string
  /** Posición de la persona en la lista, cuando la fuente es una lista. */
  persona: number | null
  /** Solo los dígitos: es lo que se compara. */
  valor: string
  verificada: boolean
  editada_por: string | null
  dv_invalido: boolean
  /** Enlace al documento de donde sale (para mirarlo al lado). */
  archivo: string | null
  alimenta_generacion: boolean
  estado: EstadoLectura
  /**
   * La lectura dice el mismo documento que la mayoría, pero con algo pegado: el código del
   * tipo de documento delante (`prefijo`, `prefijo_y_dv`: es lectura dudosa) o el dígito de
   * verificación detrás (`dv_pegado`: coincide, es la forma en que la factura lo imprime).
   * Ausente si la lectura es el número limpio. Ver `formaLimpia`.
   */
  forma?: 'prefijo' | 'dv_pegado' | 'prefijo_y_dv'
}

export type EstadoVoto = 'acuerdo' | 'dudosa' | 'manual' | 'sin_contraste'

export interface ResultadoVoto {
  slug: string
  label: string
  estado: EstadoVoto
  /** El valor de la mayoría (el que se propone). `null` sin mayoría. */
  valor: string | null
  fuentes: LecturaFuente[]
  /** ¿Frena el avance en la etapa actual? */
  bloquea: boolean
  /** ¿Impide generar formularios? */
  niega_generacion: boolean
  /** Una frase para el equipo, o `null` si no hay nada que decir. */
  mensaje: string | null
}

// ── Lectura de la configuración ─────────────────────────────────────────────────

function esFuenteVoto(v: unknown): v is FuenteVoto {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  if (typeof f.etiqueta !== 'string' || !f.etiqueta.trim()) return false
  if (typeof f.source_bloque_slug !== 'string' || !f.source_bloque_slug) return false
  const formas = [typeof f.field === 'string' && !!f.field, typeof f.lista === 'string' && !!f.lista, Array.isArray(f.personas)]
  return formas.filter(Boolean).length === 1
}

function esVoto(v: unknown): v is Voto {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  if (typeof c.slug !== 'string' || !c.slug) return false
  if (typeof c.label !== 'string' || !c.label.trim()) return false
  return Array.isArray(c.fuentes) && c.fuentes.filter(esFuenteVoto).length >= 1
}

/** Los votos que declara la línea. Una entrada mal formada se ignora, no rompe la ficha. */
export function leerVotos(configExtraLinea: Record<string, unknown> | null | undefined): Voto[] {
  const crudo = configExtraLinea?.votos
  if (!Array.isArray(crudo)) return []
  return crudo.filter(esVoto).map(v => ({ ...v, fuentes: v.fuentes.filter(esFuenteVoto) }))
}

/** Los slugs de bloque que hay que cargar para evaluar estos votos. */
export function slugsDeVotos(votos: Voto[]): string[] {
  const s = new Set<string>()
  for (const v of votos) {
    const cond = v.condition?.source_bloque_slug
    if (typeof cond === 'string' && cond) s.add(cond)
    if (v.nombre) s.add(v.nombre.source_bloque_slug)
    for (const f of v.fuentes) {
      s.add(f.source_bloque_slug)
      for (const a of f.alternativas ?? []) s.add(a)
    }
  }
  return [...s]
}

// ── Personas y dígitos ──────────────────────────────────────────────────────────

const soloDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

function tokensNombre(v: unknown): Set<string> {
  const s = String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
  return new Set(s.split(/\s+/).filter(t => t.length > 1 && !/^\d+$/.test(t)))
}

/**
 * ¿Dos nombres son la misma persona? El orden cambia entre documentos («BENAVIDES MORENO
 * SANTIAGO» en el RUT, «SANTIAGO BENAVIDES MORENO» en la factura) y a veces sobra o falta
 * un nombre. Se exigen dos palabras en común, y que uno contenga al otro o que compartan
 * tres: dos hermanos comparten los dos apellidos y ninguno contiene al otro.
 */
export function mismaPersona(a: unknown, b: unknown): boolean {
  const x = tokensNombre(a)
  const y = tokensNombre(b)
  if (x.size === 0 || y.size === 0) return false
  const comun = [...x].filter(t => y.has(t)).length
  return comun >= 2 && (comun === x.size || comun === y.size || comun >= 3)
}

/** ¿Dos lecturas del documento son el mismo? Igualdad exacta, o `mismoDocumento`. */
export function mismoValor(a: string, b: string): boolean {
  return a === b || mismoDocumento(a, b)
}

/**
 * ¿El número valida con el dígito de verificación? Tolera las mismas formas que
 * `mismoDocumento`: el DV pegado al final y el «13» (o «1») del tipo de documento
 * delante. Esas formas ya las ven otros controles; aquí interesa el dígito cambiado.
 */
export function validaConDv(valor: string, dv: string): boolean {
  const d = soloDigitos(dv)
  if (d.length !== 1 || valor.length < 6) return true
  const candidatos = [valor]
  if (valor.endsWith(d) && valor.length > 6) candidatos.push(valor.slice(0, -1))
  for (const p of ['13', '1']) {
    const resto = valor.slice(p.length)
    if (valor.startsWith(p) && resto.length >= 6 && !resto.startsWith('0')) candidatos.push(resto)
  }
  return candidatos.some(c => calcularDvNit(c) === d)
}

// ── Resolución de cada fuente ───────────────────────────────────────────────────

type CampoGuardado = { value?: unknown; edicion?: { editado_por_nombre?: string }; leido?: unknown }

function campoGuardado(ctx: ContextoFuentes, slug: string, field: string): CampoGuardado | null {
  const campos = ctx.porSlug[slug]?.campos as Record<string, CampoGuardado> | undefined
  return campos?.[field] ?? null
}

/** El DV contra el que se valida: el que LEYÓ la IA si la normalización lo reemplazó. */
function testigoDv(ctx: ContextoFuentes, slug: string, field: string): string | null {
  const c = campoGuardado(ctx, slug, field)
  const leido = soloDigitos(c?.leido)
  if (leido) return leido
  const v = soloDigitos(valorDe(ctx, slug, field))
  return v || null
}

type Leida = Omit<LecturaFuente, 'estado' | 'forma'>

async function leerFuente(
  f: FuenteVoto,
  indice: number,
  ctx: ContextoFuentes,
  nombreTitular: unknown,
): Promise<Leida | null> {
  for (const slug of [f.source_bloque_slug, ...(f.alternativas ?? [])]) {
    const datos = ctx.porSlug[slug]
    if (!datos) continue
    if (!(await ctx.aplica(slug))) continue
    if (f.si && !valorCumpleCondicion(datos[f.si.field], f.si)) return null

    let field: string | null = null
    let persona: number | null = null
    let valor = ''
    if (f.field) {
      field = f.field
      valor = soloDigitos(valorDe(ctx, slug, f.field))
    } else if (f.lista) {
      const personas = parsearPersonas(valorDe(ctx, slug, f.lista))
      const idx = elegirPersona(personas.map(p => ({ nombre: p.nombre, documento: p.documento })), nombreTitular)
      if (idx !== null) {
        field = f.lista
        persona = idx
        valor = soloDigitos(personas[idx].documento)
      }
    } else if (f.personas) {
      const filas = f.personas.map(p => ({
        nombre: valorDe(ctx, slug, p.nombre),
        documento: soloDigitos(valorDe(ctx, slug, p.documento)),
      }))
      const idx = elegirPersona(filas, nombreTitular)
      if (idx !== null) {
        field = f.personas[idx].documento
        valor = filas[idx].documento
      }
    }
    if (!field || !valor) continue

    const guardado = campoGuardado(ctx, slug, field)
    const testigo = f.dv ? testigoDv(ctx, slug, f.dv) : null
    return {
      clave: `${indice}:${slug}.${field}${persona !== null ? `#${persona}` : ''}`,
      etiqueta: f.etiqueta,
      bloque_slug: slug,
      field,
      persona,
      valor,
      verificada: !!guardado?.edicion,
      editada_por: guardado?.edicion?.editado_por_nombre ?? null,
      dv_invalido: testigo !== null && !validaConDv(valor, testigo),
      archivo: typeof datos.drive_url === 'string' && datos.drive_url ? datos.drive_url : null,
      alimenta_generacion: f.alimenta_generacion === true,
    }
  }
  return null
}

/**
 * La persona del titular dentro de una lista: la única cuyo nombre coincide y que trae
 * documento. Sin nombre del titular, solo una lista de UNA persona dice a quién se refiere.
 */
function elegirPersona(filas: Array<{ nombre: unknown; documento: string }>, nombreTitular: unknown): number | null {
  const conDoc = filas.map((p, i) => ({ ...p, i })).filter(p => p.documento)
  if (nombreTitular === undefined || nombreTitular === null || String(nombreTitular).trim() === '') {
    return conDoc.length === 1 && filas.length === 1 ? conDoc[0].i : null
  }
  const suyas = conDoc.filter(p => mismaPersona(p.nombre, nombreTitular))
  return suyas.length === 1 ? suyas[0].i : null
}

// ── El voto ─────────────────────────────────────────────────────────────────────

/**
 * El valor que se propone: el de la mayoría, en su forma LIMPIA. Una lectura con el «13»
 * del tipo de documento o con el DV pegado cuenta para la mayoría (dice el mismo documento)
 * pero nunca es el valor propuesto: ese es el que se escribe al corregir y el que se
 * imprime en los documentos para la DIAN.
 */
function valorDeLaMayoria(grupo: Leida[], limpio: (l: Leida) => string): string {
  const verificada = grupo.find(l => l.verificada)
  if (verificada) return limpio(verificada)
  const cuenta = new Map<string, number>()
  for (const l of grupo) cuenta.set(limpio(l), (cuenta.get(limpio(l)) ?? 0) + 1)
  let mejor = limpio(grupo[0])
  for (const l of grupo) if ((cuenta.get(limpio(l)) ?? 0) > (cuenta.get(mejor) ?? 0)) mejor = limpio(l)
  return mejor
}

function listaEtiquetas(ls: Array<{ etiqueta: string }>): string {
  const e = [...new Set(ls.map(l => l.etiqueta))]
  return e.length <= 1 ? (e[0] ?? '') : `${e.slice(0, -1).join(', ')} y ${e[e.length - 1]}`
}

/** Decide el voto con las lecturas ya resueltas. Puro: lo prueban los tests sin base. */
export function decidirVoto(
  voto: Pick<Voto, 'slug' | 'label' | 'bloquea_en_etapas' | 'niega_generacion'>,
  lecturas: Leida[],
  etapaOrden: number | null,
): ResultadoVoto | null {
  if (lecturas.length === 0) return null
  const frenaAqui = etapaOrden !== null && (voto.bloquea_en_etapas ?? []).includes(etapaOrden)
  const cerrar = (estado: EstadoVoto, valor: string | null, fuentes: LecturaFuente[], mensaje: string | null): ResultadoVoto => {
    const enDisputa = estado === 'dudosa' || estado === 'manual'
    return {
      slug: voto.slug,
      label: voto.label,
      estado,
      valor,
      fuentes,
      bloquea: enDisputa && frenaAqui,
      niega_generacion:
        voto.niega_generacion === true &&
        (estado === 'manual' || fuentes.some(f => f.estado === 'dudosa' && f.alimenta_generacion)),
      mensaje,
    }
  }

  // Una sola fuente: nada con qué compararla, salvo su propio DV.
  if (lecturas.length === 1) {
    const l = lecturas[0]
    if (l.dv_invalido && !l.verificada) {
      return cerrar('dudosa', null, [{ ...l, estado: 'dudosa' }],
        `${voto.label}: la lectura de ${l.etiqueta} (${l.valor}) no valida con su dígito de verificación.`)
    }
    return cerrar('sin_contraste', l.valor, [{ ...l, estado: 'sin_contraste' }], null)
  }

  // Grupos de lecturas que dicen lo mismo, en el orden de la configuración.
  const grupos: Leida[][] = []
  for (const l of lecturas) {
    const g = grupos.find(gr => gr.some(o => mismoValor(o.valor, l.valor)))
    if (g) g.push(l)
    else grupos.push([l])
  }
  const verificadas = (g: Leida[]) => g.filter(l => l.verificada).length
  const orden = [...grupos].sort((a, b) => b.length - a.length || verificadas(b) - verificadas(a))
  const [primero, segundo] = orden
  const hayMayoria = !segundo || primero.length > segundo.length || verificadas(primero) > verificadas(segundo)

  if (!hayMayoria) {
    const fuentes = lecturas.map(l => ({ ...l, estado: 'en_disputa' as const }))
    return cerrar('manual', null, fuentes,
      `${voto.label}: las fuentes no coinciden (${fuentes.map(f => `${f.etiqueta} ${f.valor}`).join(', ')}). Hay que revisarlo a mano.`)
  }

  // La forma de cada lectura de la mayoría, contra las demás de la mayoría (el testigo es
  // siempre otra fuente, nunca la forma del número sola).
  const formas = new Map<Leida, ReturnType<typeof formaLimpia>>()
  for (const l of primero) formas.set(l, formaLimpia(l.valor, primero.filter(o => o !== l).map(o => o.valor)))
  const limpio = (l: Leida) => formas.get(l)?.limpio ?? l.valor
  const valor = valorDeLaMayoria(primero, limpio)
  const fuentes: LecturaFuente[] = lecturas.map(l => {
    if (!primero.includes(l)) return { ...l, estado: l.verificada ? 'confirmada' : 'dudosa' }
    const forma = formas.get(l)?.forma ?? 'limpio'
    if (forma === 'limpio') return { ...l, estado: 'coincide' }
    // El «13» pegado es una lectura mala aunque diga el mismo documento: es la que salió
    // impresa ante la DIAN en V0177. Ni una edición a mano la deja pasar.
    if (forma === 'prefijo' || forma === 'prefijo_y_dv') return { ...l, estado: 'dudosa', forma }
    return { ...l, estado: 'coincide', forma }
  })
  const dudosas = fuentes.filter(f => f.estado === 'dudosa')
  if (dudosas.length === 0) return cerrar('acuerdo', valor, fuentes, null)
  const mayoria = fuentes.filter(f => f.estado === 'coincide')
  const detalle = (d: LecturaFuente) =>
    d.forma === 'prefijo' || d.forma === 'prefijo_y_dv'
      ? `${d.etiqueta} (${d.valor}: trae pegado delante el código del tipo de documento)`
      : `${d.etiqueta} (${d.valor})`
  return cerrar('dudosa', valor, fuentes,
    `${voto.label}: lectura dudosa en ${dudosas.map(detalle).join(' y ')}. ` +
    `${listaEtiquetas(mayoria)} ${mayoria.length === 1 ? 'dice' : 'dicen'} ${valor}.`)
}

/** Los votos de un negocio contra sus datos de HOY. */
export async function evaluarVotos(
  votos: Voto[],
  ctx: ContextoFuentes,
  etapaOrden: number | null,
): Promise<ResultadoVoto[]> {
  const out: ResultadoVoto[] = []
  for (const v of votos) {
    if (v.condition && !(await ctx.evaluar(v.condition))) continue
    const nombre = v.nombre ? valorDe(ctx, v.nombre.source_bloque_slug, v.nombre.field) : undefined
    const lecturas: Leida[] = []
    for (let i = 0; i < v.fuentes.length; i++) {
      const l = await leerFuente(v.fuentes[i], i, ctx, nombre)
      if (l) lecturas.push(l)
    }
    const r = decidirVoto(v, lecturas, etapaOrden)
    if (r) out.push(r)
  }
  return out
}

/** ¿El voto está en disputa? (lo que se pinta en rojo y lo que el gate mira). */
export function votoEnDisputa(r: ResultadoVoto): boolean {
  return r.estado === 'dudosa' || r.estado === 'manual'
}
