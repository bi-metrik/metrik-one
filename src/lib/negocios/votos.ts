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
 * - Uno o dos dígitos de más (o de menos) NO son el mismo número, salvo que lo que sobra
 *   sea el DV de verdad (módulo 11). `mismoDocumento` los tolera para comparar personas,
 *   pero en el voto son justo la lectura mala: V0326 leyó la casilla 26 como 520238523
 *   con el NIT de la casilla 5 en 52023852, V0354 168394259 por 16839425, V0361 397853081
 *   por 39785308 (el «1» de la fecha de expedición de la casilla 27). Ver `mismoValor`.
 * - Una fuente TESTIGO (`testigo`, el NIT de la casilla 5 contra la cédula de la 26) no
 *   es una lectura independiente: vota solo si su número es el de otra fuente o lo
 *   contiene con uno o dos dígitos de más, y en ese caso desempata a su favor. Si es un
 *   número completamente distinto (V0012: NIT 700004389 asignado antes de la cédula
 *   1015442918) no vota y queda un aviso que NO frena. Ver `separarTestigos`.
 *
 * Configuración: `lineas_negocio.config_extra.votos` (lista). Sin la clave, nada cambia.
 * Se evalúa en cada lectura del negocio, como los cruces: un veredicto guardado vuelve a
 * quedar viejo en cuanto alguien corrige una fuente.
 */

import { calcularDvNit } from '@/lib/dian/nit'
import {
  conDigitosDeMas,
  conDvPegado,
  difierenEnDigitosDeMas,
  formaLimpia,
} from '@/lib/dian/prefijo-tipo-documento'
import { parsearPersonas } from '@/lib/documentos/personas'
import { valorCumpleCondicion } from './condicion-bloque'
import { mismoDocumento, valorDe, type ContextoFuentes } from './fuentes-negocio'

export { conDigitosDeMas, difierenEnDigitosDeMas }

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
  /**
   * La fuente es un testigo de las demás y no una lectura independiente (el NIT de la
   * casilla 5 frente a la cédula de la casilla 26 del mismo RUT). Vota solo si dice el
   * mismo número que otra fuente o si uno contiene al otro con uno o dos dígitos de más;
   * entonces gana un empate. Si dice un número del todo distinto, no vota: queda un aviso
   * que no frena.
   */
  testigo?: boolean
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
 * - `distinta`: un testigo con un número del todo distinto. No vota; es solo un aviso.
 */
export type EstadoLectura = 'coincide' | 'dudosa' | 'confirmada' | 'en_disputa' | 'sin_contraste' | 'distinta'

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
  /** Es un testigo (ver `FuenteVoto.testigo`). */
  testigo: boolean
  estado: EstadoLectura
  /**
   * La lectura dice el mismo documento que la mayoría, pero con algo pegado: el código del
   * tipo de documento delante (`prefijo`, `prefijo_y_dv`: es lectura dudosa) o el dígito de
   * verificación detrás (`dv_pegado`: coincide, es la forma en que la factura lo imprime).
   * Ausente si la lectura es el número limpio. Ver `formaLimpia`.
   *
   * En una lectura dudosa, `digitos_de_mas` / `digitos_de_menos`: es el número de la
   * mayoría con uno o dos dígitos que sobran (o que faltan), y lo que sobra no es el DV.
   */
  forma?: 'prefijo' | 'dv_pegado' | 'prefijo_y_dv' | 'digitos_de_mas' | 'digitos_de_menos'
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
  /** Avisos que NO frenan ni niegan nada (un testigo con un número del todo distinto). */
  avisos: string[]
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

/**
 * ¿Dos lecturas del documento son el mismo? Igualdad exacta, o `mismoDocumento` sin su
 * tolerancia a los dígitos que sobran al final: en un voto, uno empieza por el otro solo
 * vale si lo que sobra es el DV de verdad (la factura imprime el NIT con su DV). Un dígito
 * de más que no es el DV es una lectura mala (V0326, V0354, V0361), no el mismo número.
 */
export function mismoValor(a: string, b: string): boolean {
  if (a === b) return true
  if (!mismoDocumento(a, b)) return false
  const [largo, corto] = a.length >= b.length ? [a, b] : [b, a]
  if (largo.length > corto.length && largo.startsWith(corto)) return conDvPegado(largo, corto)
  return true
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
      testigo: f.testigo === true,
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
  const { votan, distintas, avisos } = separarTestigos(voto.label, lecturas)
  lecturas = votan
  const cerrar = (estado: EstadoVoto, valor: string | null, fuentes: LecturaFuente[], mensaje: string | null): ResultadoVoto => {
    const enDisputa = estado === 'dudosa' || estado === 'manual'
    return {
      slug: voto.slug,
      label: voto.label,
      estado,
      valor,
      fuentes: [...fuentes, ...distintas],
      bloquea: enDisputa && frenaAqui,
      niega_generacion:
        voto.niega_generacion === true &&
        (estado === 'manual' || fuentes.some(f => f.estado === 'dudosa' && f.alimenta_generacion)),
      mensaje,
      avisos,
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
  let [primero] = orden
  const segundo = orden[1]
  let hayMayoria = !segundo || primero.length > segundo.length || verificadas(primero) > verificadas(segundo)
  if (!hayMayoria) {
    const ganador = desempateDelTestigo(orden)
    if (ganador) {
      primero = ganador
      hayMayoria = true
    }
  }

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
    if (!primero.includes(l)) {
      if (l.verificada) return { ...l, estado: 'confirmada' }
      const f = formaDeMas(l.valor, valor)
      return f ? { ...l, estado: 'dudosa', forma: f } : { ...l, estado: 'dudosa' }
    }
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
  const detalle = (d: LecturaFuente) => {
    if (d.forma === 'prefijo' || d.forma === 'prefijo_y_dv') {
      return `${d.etiqueta} (${d.valor}: trae pegado delante el código del tipo de documento)`
    }
    const n = Math.abs(d.valor.length - valor.length)
    if (d.forma === 'digitos_de_mas') return `${d.etiqueta} (${d.valor}: ${n === 1 ? 'un dígito' : 'dos dígitos'} de más)`
    if (d.forma === 'digitos_de_menos') return `${d.etiqueta} (${d.valor}: ${n === 1 ? 'le falta un dígito' : 'le faltan dos dígitos'})`
    return `${d.etiqueta} (${d.valor})`
  }
  return cerrar('dudosa', valor, fuentes,
    `${voto.label}: lectura dudosa en ${dudosas.map(detalle).join(' y ')}. ` +
    `${listaEtiquetas(mayoria)} ${mayoria.length === 1 ? 'dice' : 'dicen'} ${valor}.`)
}

/** La forma de una lectura minoritaria frente al valor de la mayoría, si sobra o falta algo. */
function formaDeMas(v: string, mayoria: string): 'digitos_de_mas' | 'digitos_de_menos' | null {
  if (conDigitosDeMas(v, mayoria)) return 'digitos_de_mas'
  if (conDigitosDeMas(mayoria, v)) return 'digitos_de_menos'
  return null
}

/**
 * Aparta los testigos que dicen un número del todo distinto: ni el mismo que otra fuente
 * ni uno que lo contenga con uno o dos dígitos de más. Esos no votan (V0012: el NIT se
 * asignó antes que la cédula), quedan como `distinta` y dejan un aviso que no frena. Un
 * testigo sin otra fuente con qué compararse vota solo (`sin_contraste`), como cualquiera.
 */
function separarTestigos(
  label: string,
  lecturas: Leida[],
): { votan: Leida[]; distintas: LecturaFuente[]; avisos: string[] } {
  const votan: Leida[] = []
  const distintas: LecturaFuente[] = []
  const avisos: string[] = []
  for (const l of lecturas) {
    const otras = lecturas.filter(o => o !== l && !o.testigo)
    const seParece = otras.some(o => mismoValor(o.valor, l.valor) || difierenEnDigitosDeMas(o.valor, l.valor))
    if (!l.testigo || otras.length === 0 || seParece) {
      votan.push(l)
      continue
    }
    distintas.push({ ...l, estado: 'distinta' })
    avisos.push(
      `${label}: ${l.etiqueta} dice ${l.valor} y ${otras.map(o => `${o.etiqueta} ${o.valor}`).join(', ')}. ` +
      'Son números distintos: puede ser un NIT asignado antes de la cédula. No frena el avance; revisa el documento si no es así.',
    )
  }
  return { votan, distintas, avisos }
}

/**
 * En un empate entre exactamente dos grupos, gana el del testigo si el otro grupo trae su
 * mismo número con uno o dos dígitos de más o de menos: la casilla 26 con un dígito de
 * más frente a la casilla 5 (V0326, V0354, V0361, que tenían bien leído el NIT). Con
 * cualquier otra diferencia el empate sigue siendo revisión manual.
 */
function desempateDelTestigo(orden: Leida[][]): Leida[] | null {
  const [a, b, c] = orden
  if (!a || !b || a.length !== b.length) return null
  const verif = (g: Leida[]) => g.filter(l => l.verificada).length
  if (verif(a) !== verif(b)) return null
  if (c && c.length === a.length && verif(c) === verif(a)) return null
  const conTestigo = [a, b].filter(g => g.some(l => l.testigo))
  if (conTestigo.length !== 1) return null
  const suyo = conTestigo[0]
  const otro = suyo === a ? b : a
  const parecidos = suyo.some(t => t.testigo && otro.some(o => difierenEnDigitosDeMas(t.valor, o.valor)))
  return parecidos ? suyo : null
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
