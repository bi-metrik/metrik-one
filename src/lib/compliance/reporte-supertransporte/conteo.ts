/**
 * Reporte Supertransporte — las cifras de cada literal, sin base de datos.
 *
 * Spec de Lucia (2026-10-08, `proyectos/afi/alma/docs/entrada/2026-10-08_tablero-reporte-supertransporte.md`).
 *
 * Reglas de conteo:
 *
 *   1. Se cuentan CONTRAPARTES DISTINTAS, no consultas. La llave es el número de
 *      documento normalizado (sin puntos, guiones ni espacios); sin documento, el nombre
 *      normalizado (sin tildes, mayúsculas, un solo espacio). La llave NO lleva el tipo de
 *      documento: un mismo número digitado una vez como CC y otra como CE es la misma
 *      persona mal tecleada, no dos contrapartes.
 *   2. Se excluyen las consultas hechas por personas de MéTRIK (pruebas) y las que
 *      terminaron en error. Las excluidas se cuentan y se dicen, no desaparecen.
 *   3. Cada contraparte cae en UN segmento: el de su consulta más reciente del periodo que
 *      tenga segmento. Así el desglose suma el total. Las consultas sin segmento (anteriores
 *      al catálogo) van a "Sin segmento", que se ve.
 *   4. Nunca un cero falso. Lo que ONE no sabe responder sale `sin_dato` con la causa.
 *      El literal a con cero filas en la base de sujetos NO es 0: es "sin base cargada".
 *   5. Literal e: coincidencia = match DEVUELTO por la fuente, no confirmado. Se describe
 *      por tier y por lista, no por severidad.
 */

import { TIER_LABEL, type TierResuelto } from '../tier-fuentes'
import { todayBogotaISO } from '@/lib/dates/bogota'
import {
  fechaEnPeriodo,
  tramoDelMes,
  type PeriodoResuelto,
} from './periodos'

// ─── Entradas ──────────────────────────────────────────────────────────────

export interface ConsultaReporte {
  id: string
  created_at: string
  created_by: string | null
  documento_tipo: string | null
  documento_numero: string | null
  nombre_consultado: string | null
  segmento_id: string | null
  severidad: string | null
  error_mensaje: string | null
  total_matches: number | null
  tier_maximo: string | null
  /** Solo el nombre de la lista de cada match (`matches[].lista`). */
  listas: string[]
}

export interface SegmentoReporte {
  id: string
  nombre: string
  orden: number
  /** Un segmento activo sale en el desglose aunque tenga 0 (es un cero real). */
  activo: boolean
}

export interface SujetoReporte {
  id: string
  tipo: string
  documento_tipo: string
  documento_numero: string
  nombre: string
  segmento_id: string | null
  relacion_desde: string
  relacion_hasta: string | null
}

export interface ExpedienteReporte {
  id: string
  documento_tipo: string | null
  documento_numero: string | null
  nombre: string | null
  estado: string
  creado_en: string
  actualizado_en: string
}

export interface EntradaReporte {
  periodo: PeriodoResuelto
  consultas: ConsultaReporte[]
  segmentos: SegmentoReporte[]
  /** Perfiles de MéTRIK (platform_admin o correo @metrik.com.co): sus consultas son pruebas. */
  creadoresExcluidos: ReadonlySet<string>
  sujetos: SujetoReporte[]
  expedientes: ExpedienteReporte[]
}

// ─── Salida ────────────────────────────────────────────────────────────────

export const SIN_SEGMENTO = 'Sin segmento'

export type EstadoLiteral = 'dato' | 'parcial' | 'sin_dato'

export interface DesgloseSegmento {
  segmento: string
  /** `null` = sin dato para ese segmento (nunca un cero inventado). */
  valor: number | null
}

export interface LiteralReporte {
  letra: 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
  /** Redacción del módulo SARLAFT–RMS de VIGÍA. */
  titulo: string
  estado: EstadoLiteral
  /** `null` cuando no hay dato. */
  valor: number | null
  unidad: 'contrapartes' | 'porcentaje'
  desglose: DesgloseSegmento[]
  /** Por qué falta el dato (o la parte que falta). */
  causa: string | null
  /** Líneas de descripción (p. ej. el tipo de coincidencia del literal e). */
  detalle: string[]
}

export interface MesReporte {
  mes: string
  desde: string
  hasta: string
  consultas: number
  contrapartes: number
  conCoincidencia: number
  porSegmento: Record<string, number>
}

export interface FilaConocimiento {
  documento_tipo: string
  documento_numero: string
  nombre: string
  segmento: string
  /** Fecha (Bogotá) de la consulta más reciente del periodo. */
  fecha: string
  consultas: number
  resultado: string
  coincidencias: number
  tier: string
  listas: string
  /** Consulta de la que sale el soporte PDF. */
  consulta_id: string
}

export interface FilaExcluida {
  fecha: string
  documento_numero: string
  nombre: string
  motivo: 'Consulta de MéTRIK (prueba)' | 'Consulta con error'
  consulta_id: string
}

export interface FilaDiligencia {
  documento_tipo: string
  documento_numero: string
  nombre: string
  segmento: string
  estado: string
  fecha: string
}

export interface FilaRelacion {
  documento_tipo: string
  documento_numero: string
  nombre: string
  segmento: string
  tipo: string
  relacion_desde: string
  relacion_hasta: string
}

export interface ReporteSupertransporte {
  periodo: PeriodoResuelto
  /** Columnas del desglose, en el orden del catálogo (+ "Sin segmento" si hay). */
  segmentos: string[]
  literales: LiteralReporte[]
  mensual: MesReporte[]
  excluidas: { metrik: number; error: number }
  nominal: {
    conocimiento: FilaConocimiento[]
    coincidencias: FilaConocimiento[]
    relacion: FilaRelacion[]
    diligencia: FilaDiligencia[]
    excluidas: FilaExcluida[]
  }
}

// ─── Llaves ────────────────────────────────────────────────────────────────

export function normalizarNumeroDocumento(n: string | null | undefined): string {
  return (n ?? '').replace(/[\s.\-_]/g, '').trim().toUpperCase()
}

export function normalizarNombre(n: string | null | undefined): string {
  return (n ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/**
 * La identidad con la que se cuenta una contraparte. `null` si no hay ni documento ni
 * nombre: esa consulta no se puede atribuir a nadie y se cuenta sola (por su id).
 */
export function llaveContraparte(
  documentoNumero: string | null | undefined,
  nombre: string | null | undefined,
): string | null {
  const doc = normalizarNumeroDocumento(documentoNumero)
  if (doc) return `D:${doc}`
  const nom = normalizarNombre(nombre)
  if (nom) return `N:${nom}`
  return null
}

/** Fecha civil en Bogotá de un timestamp. */
export function fechaBogota(ts: string): string {
  return todayBogotaISO(new Date(ts))
}

/** Por qué una consulta no entra al reporte, o `null` si entra. */
export function motivoExclusion(
  c: Pick<ConsultaReporte, 'created_by' | 'severidad' | 'error_mensaje'>,
  creadoresExcluidos: ReadonlySet<string>,
): FilaExcluida['motivo'] | null {
  if (c.created_by && creadoresExcluidos.has(c.created_by)) return 'Consulta de MéTRIK (prueba)'
  if (c.severidad === 'error' || (c.error_mensaje ?? '').trim() !== '') return 'Consulta con error'
  return null
}

// ─── Redacción ─────────────────────────────────────────────────────────────

/**
 * Títulos de los literales en el orden del módulo SARLAFT–RMS de VIGÍA (mapa del spec de
 * Lucia). Si la Superintendencia cambia la redacción, se cambia aquí y en ningún otro lado.
 */
export const TITULOS_LITERALES: Record<LiteralReporte['letra'], string> = {
  a: 'Número de contrapartes con relación vigente',
  b: 'Porcentaje de cobertura del conocimiento de la contraparte',
  c: 'Número de contrapartes y beneficiarios finales con conocimiento en el periodo',
  d: 'Número de contrapartes con debida diligencia y con debida diligencia intensificada',
  e: 'Número de coincidencias en listas y descripción del tipo',
  f: 'Capacitaciones',
}

const ESTADOS_DECIDIDOS = new Set(['aprobado', 'rechazado'])

// ─── El cálculo ────────────────────────────────────────────────────────────

interface Acumulado {
  llave: string
  ultima: ConsultaReporte
  ultimaFecha: string
  segmentoId: string | null
  consultas: number
  /** Consulta con más coincidencias del periodo (la que respalda el literal e). */
  conMatch: ConsultaReporte | null
  listas: Set<string>
}

function acumular(filas: Array<{ c: ConsultaReporte; fecha: string }>): Map<string, Acumulado> {
  const porLlave = new Map<string, Acumulado>()
  // En orden cronológico: la última en pisar es la más reciente.
  const orden = [...filas].sort((x, y) => x.c.created_at.localeCompare(y.c.created_at))
  for (const { c, fecha } of orden) {
    const llave = llaveContraparte(c.documento_numero, c.nombre_consultado) ?? `ID:${c.id}`
    const prev = porLlave.get(llave)
    const acc: Acumulado = prev ?? {
      llave,
      ultima: c,
      ultimaFecha: fecha,
      segmentoId: null,
      consultas: 0,
      conMatch: null,
      listas: new Set(),
    }
    acc.ultima = c
    acc.ultimaFecha = fecha
    acc.consultas += 1
    if (c.segmento_id) acc.segmentoId = c.segmento_id
    if ((c.total_matches ?? 0) > 0) {
      if (!acc.conMatch || (c.total_matches ?? 0) >= (acc.conMatch.total_matches ?? 0)) acc.conMatch = c
      for (const l of c.listas) if (l) acc.listas.add(l)
    }
    porLlave.set(llave, acc)
  }
  return porLlave
}

function etiquetaTier(tier: string | null | undefined): string {
  if (!tier) return TIER_LABEL.sin_clasificar
  return TIER_LABEL[tier as TierResuelto] ?? tier
}

function contarPor<T>(items: T[], clave: (t: T) => string, columnas: string[]): DesgloseSegmento[] {
  const conteo = new Map<string, number>()
  for (const it of items) conteo.set(clave(it), (conteo.get(clave(it)) ?? 0) + 1)
  return columnas.map((segmento) => ({ segmento, valor: conteo.get(segmento) ?? 0 }))
}

export function calcularReporte(e: EntradaReporte): ReporteSupertransporte {
  const { periodo } = e
  const nombreSeg = new Map(e.segmentos.map((s) => [s.id, s.nombre] as const))
  const segDe = (id: string | null | undefined) => (id && nombreSeg.get(id)) || SIN_SEGMENTO

  // 1. Filtrar al periodo y separar las excluidas.
  const validas: Array<{ c: ConsultaReporte; fecha: string }> = []
  const excluidas: FilaExcluida[] = []
  for (const c of e.consultas) {
    const fecha = fechaBogota(c.created_at)
    if (!fechaEnPeriodo(fecha, periodo)) continue
    const motivo = motivoExclusion(c, e.creadoresExcluidos)
    if (motivo) {
      excluidas.push({
        fecha,
        documento_numero: c.documento_numero ?? '',
        nombre: c.nombre_consultado ?? '',
        motivo,
        consulta_id: c.id,
      })
      continue
    }
    validas.push({ c, fecha })
  }

  // 2. Contrapartes distintas del periodo.
  const contrapartes = [...acumular(validas).values()]

  // Segmento de cada documento en el workspace (para cruzar sujetos y expedientes que
  // no tienen consulta en el periodo): el de su consulta con segmento más reciente.
  const segPorLlave = new Map<string, string>()
  for (const c of [...e.consultas].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const k = llaveContraparte(c.documento_numero, c.nombre_consultado)
    if (k && c.segmento_id) segPorLlave.set(k, segDe(c.segmento_id))
  }

  // 3. Columnas del desglose: los segmentos ACTIVOS del catálogo en su orden (uno sin
  // consultas es un cero real), los inactivos solo si tienen algo en el periodo, y
  // "Sin segmento" solo si hace falta. Todos los universos cuentan como contraparte
  // (proveedores, clientes y empleados): no se filtra por `universo`.
  const usados = new Set<string>([
    ...contrapartes.map((c) => c.segmentoId ?? ''),
    ...e.sujetos.map((s) => s.segmento_id ?? ''),
  ])
  const columnas = [...e.segmentos]
    .filter((s) => s.activo || usados.has(s.id))
    .sort((a, b) => a.orden - b.orden)
    .map((s) => s.nombre)
  const necesitaSinSegmento =
    contrapartes.some((c) => !c.segmentoId) ||
    e.sujetos.some((s) => !s.segmento_id)
  if (necesitaSinSegmento) columnas.push(SIN_SEGMENTO)

  // ── c: conocimiento en el periodo ──
  // Contrapartes consultadas + expedientes de vinculación DECIDIDOS en el periodo (un
  // expediente aprobado o rechazado es conocimiento aunque nadie haya pasado por listas).
  const expedientesDecididos = e.expedientes.filter(
    (x) => ESTADOS_DECIDIDOS.has(x.estado) && fechaEnPeriodo(fechaBogota(x.actualizado_en), periodo),
  )
  const conocimiento = new Map<string, string>() // llave -> segmento
  for (const c of contrapartes) conocimiento.set(c.llave, segDe(c.segmentoId))
  for (const x of expedientesDecididos) {
    const k = llaveContraparte(x.documento_numero, x.nombre)
    if (k && !conocimiento.has(k)) conocimiento.set(k, segPorLlave.get(k) ?? SIN_SEGMENTO)
  }
  const asegurarColumnas = (nombres: Iterable<string>) => {
    for (const n of nombres) if (!columnas.includes(n)) columnas.push(n)
  }
  asegurarColumnas(conocimiento.values())

  const litC: LiteralReporte = {
    letra: 'c',
    titulo: TITULOS_LITERALES.c,
    estado: 'parcial',
    valor: conocimiento.size,
    unidad: 'contrapartes',
    desglose: contarPor([...conocimiento.values()], (s) => s, columnas),
    causa: 'Beneficiarios finales: la consulta de listas no los captura. La cifra cuenta solo contrapartes.',
    detalle: [
      `${validas.length} consulta${validas.length === 1 ? '' : 's'} a listas en el periodo` +
        (expedientesDecididos.length > 0
          ? ` y ${expedientesDecididos.length} expediente${expedientesDecididos.length === 1 ? '' : 's'} de vinculación decidido${expedientesDecididos.length === 1 ? '' : 's'}`
          : ''),
    ],
  }

  // ── a: relación vigente ──
  let litA: LiteralReporte
  const vigentes = e.sujetos.filter(
    (s) => s.relacion_desde <= periodo.hasta && (!s.relacion_hasta || s.relacion_hasta >= periodo.desde),
  )
  if (e.sujetos.length === 0) {
    litA = {
      letra: 'a',
      titulo: TITULOS_LITERALES.a,
      estado: 'sin_dato',
      valor: null,
      unidad: 'contrapartes',
      desglose: columnas.map((segmento) => ({ segmento, valor: null })),
      causa: 'Sin base de terceros cargada en ONE (Cumplimiento → Sujetos).',
      detalle: [],
    }
  } else {
    litA = {
      letra: 'a',
      titulo: TITULOS_LITERALES.a,
      estado: 'dato',
      valor: vigentes.length,
      unidad: 'contrapartes',
      desglose: contarPor(vigentes, (s) => segDe(s.segmento_id), columnas),
      causa: null,
      detalle: ['Sujetos de la base con la relación abierta en algún momento del periodo.'],
    }
  }

  // ── b: cobertura = vigentes con conocimiento en el periodo / vigentes ──
  let litB: LiteralReporte
  if (litA.estado === 'sin_dato') {
    litB = {
      letra: 'b',
      titulo: TITULOS_LITERALES.b,
      estado: 'sin_dato',
      valor: null,
      unidad: 'porcentaje',
      desglose: columnas.map((segmento) => ({ segmento, valor: null })),
      causa: 'Depende del literal a, que no tiene dato.',
      detalle: [],
    }
  } else if (vigentes.length === 0) {
    litB = {
      letra: 'b',
      titulo: TITULOS_LITERALES.b,
      estado: 'sin_dato',
      valor: null,
      unidad: 'porcentaje',
      desglose: columnas.map((segmento) => ({ segmento, valor: null })),
      causa: 'No hay contrapartes con relación vigente en el periodo: no hay sobre qué calcular la cobertura.',
      detalle: [],
    }
  } else {
    const cubierto = (s: SujetoReporte) =>
      conocimiento.has(llaveContraparte(s.documento_numero, s.nombre) ?? '')
    const pct = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 1000) / 10)
    litB = {
      letra: 'b',
      titulo: TITULOS_LITERALES.b,
      estado: 'dato',
      valor: pct(vigentes.filter(cubierto).length, vigentes.length),
      unidad: 'porcentaje',
      desglose: columnas.map((segmento) => {
        const del = vigentes.filter((s) => segDe(s.segmento_id) === segmento)
        return { segmento, valor: pct(del.filter(cubierto).length, del.length) }
      }),
      causa: null,
      detalle: [
        `${vigentes.filter(cubierto).length} de ${vigentes.length} contrapartes vigentes tuvieron conocimiento en el periodo.`,
      ],
    }
  }

  // ── d: debida diligencia ──
  let litD: LiteralReporte
  const enCurso = e.expedientes.filter(
    (x) => !ESTADOS_DECIDIDOS.has(x.estado) && fechaEnPeriodo(fechaBogota(x.creado_en), periodo),
  )
  const causaD =
    'Debida diligencia intensificada (marca y criterio) y operaciones intentadas: ONE todavía no las registra.'
  if (e.expedientes.length === 0) {
    litD = {
      letra: 'd',
      titulo: TITULOS_LITERALES.d,
      estado: 'sin_dato',
      valor: null,
      unidad: 'contrapartes',
      desglose: columnas.map((segmento) => ({ segmento, valor: null })),
      causa: `Sin expedientes de vinculación en ONE. ${causaD}`,
      detalle: [],
    }
  } else {
    const ddPorSeg = expedientesDecididos.map((x) => {
      const k = llaveContraparte(x.documento_numero, x.nombre)
      return (k && segPorLlave.get(k)) || SIN_SEGMENTO
    })
    asegurarColumnas(ddPorSeg)
    litD = {
      letra: 'd',
      titulo: TITULOS_LITERALES.d,
      estado: 'parcial',
      valor: new Set(expedientesDecididos.map((x) => llaveContraparte(x.documento_numero, x.nombre) ?? x.id)).size,
      unidad: 'contrapartes',
      desglose: contarPor(ddPorSeg, (s) => s, columnas),
      causa: causaD,
      detalle: [
        'Debida diligencia = expediente de vinculación aprobado o rechazado en el periodo.',
        ...(enCurso.length > 0
          ? [`${enCurso.length} expediente${enCurso.length === 1 ? '' : 's'} abierto${enCurso.length === 1 ? '' : 's'} en el periodo todavía sin decisión (no se cuentan).`]
          : []),
      ],
    }
  }

  // ── e: coincidencias devueltas por la fuente ──
  const conMatch = contrapartes.filter((c) => c.conMatch)
  const porTier = new Map<string, number>()
  const porLista = new Map<string, number>()
  for (const c of conMatch) {
    const t = etiquetaTier(c.conMatch!.tier_maximo)
    porTier.set(t, (porTier.get(t) ?? 0) + 1)
    for (const l of c.listas) porLista.set(l, (porLista.get(l) ?? 0) + 1)
  }
  const litE: LiteralReporte = {
    letra: 'e',
    titulo: TITULOS_LITERALES.e,
    estado: 'dato',
    valor: conMatch.length,
    unidad: 'contrapartes',
    desglose: contarPor(conMatch, (c) => segDe(c.segmentoId), columnas),
    causa: null,
    detalle: [
      'Coincidencias devueltas por la fuente (no confirmadas). La confirmación la decide la oficial.',
      ...[...porTier.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `Tier · ${t}: ${n}`),
      ...[...porLista.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `Lista · ${l}: ${n}`),
    ],
  }

  // ── f: capacitaciones ──
  const litF: LiteralReporte = {
    letra: 'f',
    titulo: TITULOS_LITERALES.f,
    estado: 'sin_dato',
    valor: null,
    unidad: 'contrapartes',
    desglose: [],
    causa: 'ONE todavía no registra capacitaciones (cobertura, horas, modalidad, evaluación).',
    detalle: [],
  }

  // Los desgloses que se armaron antes de que apareciera "Sin segmento" se completan.
  const literales = [litA, litB, litC, litD, litE, litF].map((l) =>
    l.desglose.length === 0 && l.letra === 'f'
      ? l
      : {
          ...l,
          desglose: columnas.map(
            (segmento) =>
              l.desglose.find((d) => d.segmento === segmento) ??
              { segmento, valor: l.estado === 'sin_dato' ? null : 0 },
          ),
        },
  )

  // 4. Detalle mes a mes.
  const mensual: MesReporte[] = periodo.meses.map((mes) => {
    const tramo = tramoDelMes(mes, periodo)
    const delMes = validas.filter((v) => v.fecha >= tramo.desde && v.fecha <= tramo.hasta)
    const acc = [...acumular(delMes).values()]
    const porSegmento: Record<string, number> = {}
    for (const col of columnas) porSegmento[col] = 0
    for (const c of acc) {
      const s = segDe(c.segmentoId)
      porSegmento[s] = (porSegmento[s] ?? 0) + 1
    }
    return {
      mes,
      desde: tramo.desde,
      hasta: tramo.hasta,
      consultas: delMes.length,
      contrapartes: acc.length,
      conCoincidencia: acc.filter((c) => c.conMatch).length,
      porSegmento,
    }
  })

  // 5. Listado nominal.
  const fila = (c: Acumulado, base: ConsultaReporte, fecha: string): FilaConocimiento => ({
    documento_tipo: base.documento_tipo ?? '',
    documento_numero: base.documento_numero ?? '',
    nombre: base.nombre_consultado ?? '',
    segmento: segDe(c.segmentoId),
    fecha,
    consultas: c.consultas,
    resultado: (base.total_matches ?? 0) > 0
      ? `${base.total_matches} coincidencia${base.total_matches === 1 ? '' : 's'} devuelta${base.total_matches === 1 ? '' : 's'} (no confirmada${base.total_matches === 1 ? '' : 's'})`
      : 'Sin coincidencias',
    coincidencias: base.total_matches ?? 0,
    tier: (base.total_matches ?? 0) > 0 ? etiquetaTier(base.tier_maximo) : '',
    listas: [...new Set(base.listas.filter(Boolean))].join('; '),
    consulta_id: base.id,
  })
  const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre)
  const conocimientoFilas = contrapartes.map((c) => fila(c, c.ultima, c.ultimaFecha)).sort(porNombre)
  const coincidenciasFilas = conMatch
    .map((c) => fila(c, c.conMatch!, fechaBogota(c.conMatch!.created_at)))
    .sort(porNombre)

  const relacion: FilaRelacion[] = (litA.estado === 'sin_dato' ? [] : vigentes)
    .map((s) => ({
      documento_tipo: s.documento_tipo,
      documento_numero: s.documento_numero,
      nombre: s.nombre,
      segmento: segDe(s.segmento_id),
      tipo: s.tipo,
      relacion_desde: s.relacion_desde,
      relacion_hasta: s.relacion_hasta ?? '',
    }))
    .sort(porNombre)

  const diligencia: FilaDiligencia[] = [...expedientesDecididos, ...enCurso]
    .map((x) => {
      const k = llaveContraparte(x.documento_numero, x.nombre)
      const decidido = ESTADOS_DECIDIDOS.has(x.estado)
      return {
        documento_tipo: x.documento_tipo ?? '',
        documento_numero: x.documento_numero ?? '',
        nombre: x.nombre ?? '',
        segmento: (k && segPorLlave.get(k)) || SIN_SEGMENTO,
        estado: decidido ? x.estado : `${x.estado} (sin decisión, no se cuenta)`,
        fecha: fechaBogota(decidido ? x.actualizado_en : x.creado_en),
      }
    })
    .sort(porNombre)

  return {
    periodo,
    segmentos: columnas,
    literales,
    mensual,
    excluidas: {
      metrik: excluidas.filter((x) => x.motivo === 'Consulta de MéTRIK (prueba)').length,
      error: excluidas.filter((x) => x.motivo === 'Consulta con error').length,
    },
    nominal: {
      conocimiento: conocimientoFilas,
      coincidencias: coincidenciasFilas,
      relacion,
      diligencia,
      excluidas: excluidas.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    },
  }
}

/** Listas de un `matches` crudo de la fuente (`matches[].lista` o `matches[].detalle.lista`). */
export function listasDeMatches(matches: unknown): string[] {
  if (!Array.isArray(matches)) return []
  const out: string[] = []
  for (const m of matches as Array<{ lista?: unknown; detalle?: { lista?: unknown } } | null>) {
    const l = m?.lista ?? m?.detalle?.lista
    if (typeof l === 'string' && l.trim()) out.push(l.trim())
  }
  return out
}
