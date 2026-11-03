/**
 * La v1.5 de los Términos VALIDA · Plan CDA (Emilio, gate de Vera del 2026-10-29): la pantalla de
 * aceptación (anexo A de la fuente), el correo del aviso (anexo C) y las fechas que dicen. Puro: lo usan
 * la página `/valida`, el script del correo y las pruebas.
 *
 * Fuente del texto: proyectos/metrik/valida/docs/legal/terminos-valida-v1.5-cda.md. Los textos de aquí
 * son los del anexo A con sus variables llenas; si Emilio cambia el anexo, cambia este archivo.
 *
 * ## Todas las fechas salen del dato, nunca de una constante
 *
 *   - {vigencia_aviso}: el `vigente_desde` registrado de la v1.5 (publicación + 30 días);
 *   - el día «al día» (30-nov) y el fin de la gracia (5-dic): la vigencia − 1 y − 1 + 5 (cláusula 11.7);
 *   - {dia_renovacion}, {fecha_12_1} y la fecha base de {fecha_exige_aceptacion}: el TEXTO registrado de la
 *     v1.5 de ESE CDA (cláusulas 2.4, 12.1 y 16.4), que es lo que el CDA acepta (`datosDelTextoV15`);
 *   - {fecha_exige_aceptacion}: esa fecha base, o el día siguiente al fin del último período pagado si es
 *     posterior (16.4: «no se bloquea un período pagado»), con las cuotas y pagos del contrato;
 *   - {periodos_pendientes_al_30_nov}: los períodos que empiezan antes de la vigencia y no están pagados,
 *     con el mismo reparto de pagos de la pestaña Pagos (`cuotasConEstado`), y su total.
 *
 * ## Qué NO hace
 *
 * No bloquea nada. La exigencia de la aceptación desde {fecha_exige_aceptacion} (16.4) no está construida:
 * la primera es la de Maxitec, el 22-dic-2026.
 */

import { leerPeriodoEnConcepto } from '@/lib/cobros/periodo-en-concepto'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'
import { CORREO_TERMINACION, diaDePublicacion, fechaLarga } from './modificacion-terminos'
import type { CuotaConEstado } from './pago-pendiente'
import { esVersionCdaDesde, sumarDias } from './plazos'

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

/** ¿Es la v1.5 (o posterior) de los Términos del Plan CDA, publicada por aviso? */
export function esTerminosV15(doc: Pick<DocumentoContractual, 'slug' | 'version' | 'rigePorAviso'>): boolean {
  return doc.rigePorAviso === true && esVersionCdaDesde(doc, [1, 5])
}

/** '15 de enero de 2027' → '2027-01-15'. Lo que no es una fecha larga, `null`. */
export function deFechaLarga(texto: string): string | null {
  const m = /^(\d{1,2}) de ([a-z]+) de (\d{4})$/.exec(texto.trim())
  if (!m) return null
  const mes = MESES.indexOf(m[2] as (typeof MESES)[number]) + 1
  if (mes === 0) return null
  const iso = `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso
}

/** '2026-12-05' → '5 de diciembre' (sin año, como lo escribe el anexo A). */
export function diaYMes(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const mes = m ? MESES[Number(m[2]) - 1] : undefined
  return m && mes ? `${Number(m[3])} de ${mes}` : iso
}

export interface DatosDelTextoV15 {
  /** Cláusula 2.4: «La fecha de renovación del Cliente es el día N de cada mes». */
  diaRenovacion: number | null
  /** Cláusula 12.1: el fin del plazo de los compromisos de METRIK ('YYYY-MM-DD'). */
  fin12_1: string | null
  /** Cláusula 16.4: desde cuándo se exige la aceptación, sin contar un período pagado posterior. */
  exigeDesde: string | null
  /** «EL CLIENTE»: la razón social del CDA. */
  razonSocial: string | null
}

/**
 * Lo que la pantalla necesita del texto REGISTRADO de la v1.5 del CDA. El generador
 * (terminos-cda-v1.5/_generador/generar.py) exige que el texto traiga estas formas exactas.
 */
export function datosDelTextoV15(textoMd: string): DatosDelTextoV15 {
  const dia = /La fecha de renovación del Cliente es el día (\d{1,2}) de cada mes/.exec(textoMd)
  const fin = /Hasta el \*\*(\d{1,2} de [a-z]+ de \d{4})\*\*, fecha en que vencía/.exec(textoMd)
  const exige = /Desde el \*\*(\d{1,2} de [a-z]+ de \d{4})\*\*, o desde el día siguiente al fin del último período pagado/.exec(
    textoMd,
  )
  const cliente = /\*\*EL CLIENTE\*\*: (.+?), NIT /.exec(textoMd)
  const n = dia ? Number(dia[1]) : Number.NaN
  return {
    diaRenovacion: Number.isInteger(n) && n >= 1 && n <= 31 ? n : null,
    fin12_1: fin ? deFechaLarga(fin[1]) : null,
    exigeDesde: exige ? deFechaLarga(exige[1]) : null,
    razonSocial: cliente ? cliente[1].trim() : null,
  }
}

export interface PeriodoPendiente {
  /** 'YYYY-MM-DD'; `null` si el concepto no dice el período. */
  desde: string | null
  hasta: string | null
  /** «23-oct al 22-nov» (del concepto) o, sin él, el vencimiento. */
  corto: string
  /** Lo que falta de la cuota. */
  saldo: number
}

/** El período de una cuota, del concepto anclado en su vencimiento. */
function periodoDe(c: Pick<CuotaConEstado, 'concepto' | 'fechaVencimiento'>) {
  return leerPeriodoEnConcepto(c.concepto, c.fechaVencimiento)
}

/**
 * Los períodos que EMPIEZAN antes de `vigencia` y no están pagados (con saldo): los de la cláusula 11.7.
 * `cuotas` es la salida de `cuotasConEstado` (el mismo reparto de la pestaña Pagos). Sin período en el
 * concepto, el vencimiento decide (las cuotas de los CDA vencen dentro del período que pagan).
 */
export function periodosPendientesAntesDe(cuotas: readonly CuotaConEstado[], vigencia: string): PeriodoPendiente[] {
  return cuotas
    .filter((c) => c.estado !== 'pagada' && c.saldo > 0)
    .map((c) => ({ c, p: periodoDe(c) }))
    .filter(({ c, p }) => (p?.desde ?? c.fechaVencimiento) < vigencia)
    .map(({ c, p }) => ({
      desde: p?.desde ?? null,
      hasta: p?.hasta ?? null,
      corto: p?.corto ?? `cuota que vence el ${fechaLarga(c.fechaVencimiento)}`,
      saldo: c.saldo,
    }))
}

/** El último día del período pagado más reciente, o `null` si no hay ninguno con período legible. */
export function finUltimoPeriodoPagado(cuotas: readonly CuotaConEstado[]): string | null {
  const fines = cuotas
    .filter((c) => c.estado === 'pagada')
    .map((c) => periodoDe(c)?.hasta ?? null)
    .filter((f): f is string => f !== null && FECHA.test(f))
    .sort()
  return fines.at(-1) ?? null
}

/** 16.4: la fecha base, o el día siguiente al fin del último período pagado, la que sea posterior. */
export function fechaExigeAceptacion(base: string | null, finPagado: string | null): string | null {
  if (!base) return null
  const despuesDelPagado = finPagado ? sumarDias(finPagado, 1) : null
  return despuesDelPagado && despuesDelPagado > base ? despuesDelPagado : base
}

/** 300000 → '$300.000'. */
export function pesos(n: number): string {
  const entero = Math.round(n)
  return `$${String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

/** «23-oct al 22-nov de 2026 y 23-nov al 22-dic de 2026 ($300.000)». Vacío si no hay ninguno. */
export function textoPeriodos(periodos: readonly PeriodoPendiente[]): string {
  if (periodos.length === 0) return ''
  const partes = periodos.map((p) => (p.hasta ? `${p.corto} de ${p.hasta.slice(0, 4)}` : p.corto))
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
  return `${lista} (${pesos(periodos.reduce((s, p) => s + p.saldo, 0))})`
}

export type PeriodosAlDia =
  | { estado: 'ok'; periodos: PeriodoPendiente[] }
  /** No se pudieron leer las cuotas (o no las ve este espacio): se dice la regla, sin la lista. */
  | { estado: 'sin_dato' }

export interface DatosPantallaV15 {
  doc: Pick<DocumentoContractual, 'documentoId' | 'version' | 'vigenteDesde' | 'publicadaAt' | 'pdfSha256'>
  texto: DatosDelTextoV15
  periodos: PeriodosAlDia
  /** {fecha_exige_aceptacion} ya con el último período pagado; `null` si no se pudo calcular. */
  fechaExige: string | null
}

export interface TextosPantallaV15 {
  titulo: string
  /** Párrafo de entrada, con `**negritas**`. */
  intro: string
  /** «Qué cambia», en orden (1 a 6), con `**negritas**`. */
  queCambia: string[]
  /** «Si no la aceptas ahora», con `**negritas**`. */
  siNoAceptas: string
  /** «Aviso publicado en la plataforma el …», o `null` sin fecha de publicación. */
  publicado: string | null
  huella: string
}

/** Las fechas de la cláusula 11.7 para una vigencia: al día (vigencia − 1) y fin de la gracia (+5). */
export function fechasTransicion(vigencia: string): { alDia: string; finGracia: string } {
  const alDia = sumarDias(vigencia, -1)
  return { alDia, finGracia: sumarDias(alDia, 5) }
}

/** El ítem 6 del anexo A (estar al día), según lo que se sepa de las cuotas. */
function itemAlDia(vigencia: string, periodos: PeriodosAlDia): string {
  const { alDia, finGracia } = fechasTransicion(vigencia)
  const antes = `los períodos que empiezan antes del ${fechaLarga(vigencia)}`
  if (periodos.estado === 'ok' && periodos.periodos.length === 0) {
    return `**Para estar al día:** ya tienes pagados ${antes}.`
  }
  const cuales = periodos.estado === 'ok' ? textoPeriodos(periodos.periodos) : `${antes} que no estén pagados`
  return (
    `**Para estar al día:** a más tardar el **${fechaLarga(alDia)}** debes tener pagados: ${cuales}. ` +
    `Hasta el ${diaYMes(finGracia)} no se restringen tus consultas por esos períodos.`
  )
}

export function textosPantallaV15(d: DatosPantallaV15): TextosPantallaV15 {
  const vigencia = d.doc.vigenteDesde.slice(0, 10)
  const dia = d.texto.diaRenovacion
  const fin = d.texto.fin12_1 ? fechaLarga(d.texto.fin12_1) : 'el fin del plazo de la cláusula 12.1'
  const exige = d.fechaExige
    ? fechaLarga(d.fechaExige)
    : d.texto.exigeDesde
      ? `${fechaLarga(d.texto.exigeDesde)} (o el día siguiente al fin de tu último período pagado, si es posterior)`
      : 'la fecha de la cláusula 16.4'
  const publicadoEl = diaDePublicacion(d.doc)
  return {
    titulo: `Nuevos Términos de tu suscripción a Valida (versión ${d.doc.version.replace(/^v/, '')})`,
    intro:
      'Con esta versión, Valida funciona como una suscripción mensual, de fecha a fecha. Reemplaza la versión 1.4. ' +
      '**El precio, las consultas ilimitadas y los tres usuarios no cambian.**',
    queCambia: [
      'Pagas cada mes por anticipado con el enlace que te enviamos antes de tu fecha de renovación: ' +
        (dia ? `el día ${dia} de cada mes.` : 'el día en que empiezan tus períodos.'),
      'Si no pagas en esa fecha, tienes **5 días** más para seguir consultando normalmente.',
      '**Del día 6 al 30** sin pago, la suscripción queda **Suspendida por pago**: no puedes hacer consultas nuevas, ' +
        'pero entras, ves tu historial y descargas tus reportes. Si pagas, todo vuelve y tu fecha de renovación no cambia.',
      '**Desde el día 31** sin pago, la suscripción queda **Cancelada**: tu información queda guardada, pero no puedes ' +
        'ver el historial ni los reportes en Valida. Puedes pedir por correo la copia de tu bitácora y tus reportes, sin ' +
        'costo, durante 10 años. Si pagas, todo vuelve y tu nueva fecha de renovación es el día del pago.',
      'No pagar no genera intereses ni penalidad, y puedes dejar de renovar cuando quieras, sin aviso.',
      itemAlDia(vigencia, d.periodos),
    ],
    siNoAceptas:
      `**Si no la aceptas ahora:** puedes seguir usando Valida. Esta versión rige de todas formas desde el ` +
      `**${fechaLarga(vigencia)}** por la cláusula 13.1 de tus Términos (aviso con treinta días de anticipación). ` +
      `Hasta el **${fin}** METRIK mantiene su compromiso de no terminar sin causa ni subir el precio. Este aviso es ` +
      `también el aviso de no renovación de la cláusula 12.2: **desde el ${exige} necesitarás haberla aceptado para ` +
      `seguir consultando.** Si no estás de acuerdo, puedes terminar sin penalidad antes del ${fechaLarga(vigencia)}, ` +
      `con reembolso a prorrata de los días ya pagados que no se presten, escribiendo a ${CORREO_TERMINACION}.`,
    publicado: publicadoEl ? `Aviso publicado en la plataforma el ${fechaLarga(publicadoEl)}.` : null,
    huella: d.doc.pdfSha256,
  }
}

/** «Esta aceptación la hace …», para quien no es la persona designada. */
export function textoQuienAceptaV15(designadoNombre: string | null): string {
  return designadoNombre
    ? `Esta aceptación la hace ${designadoNombre}, la persona designada por tu empresa.`
    : 'Esta aceptación la hace la persona designada por tu empresa.'
}

// ── «Ahora no, recordármelo» ─────────────────────────────────────────────────────────────

/** La cookie que recuerda que la pantalla se pospuso: `<documento>:<día en Bogotá>`, de sesión. */
export const COOKIE_POSPONER_V15 = 'valida_terminos_v15_luego'

/**
 * ¿La pantalla se pospuso para ESTA versión y HOY? La cookie es de sesión (sin fecha de vencimiento) y
 * además lleva el día: la pantalla vuelve en un ingreso posterior (otra sesión del navegador) y, aunque
 * el navegador conserve la sesión, al día siguiente.
 */
export function pospuestaHoy(valor: string | null | undefined, documentoId: string, hoy: string): boolean {
  return typeof valor === 'string' && valor === `${documentoId}:${hoy}`
}

// ── El correo del aviso (anexo C) ────────────────────────────────────────────────────────

export interface CorreoAvisoV15 {
  asunto: string
  texto: string
  html: string
}

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const negritasHtml = (s: string) => escapar(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
const sinNegritas = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1')

/**
 * El correo que acompaña el aviso (cláusula 15.1): el texto de la pantalla A sin la casilla, el enlace a
 * Valida para aceptar y el PDF adjunto (lo adjunta quien lo manda).
 *
 * La lista de períodos pendientes NO va: el correo se programa antes de salir y un pago entre tanto la
 * volvería falsa. Va la regla (los períodos que empiezan antes de la vigencia, al 30-nov) y dónde verlos.
 */
export function correoAvisoV15(p: {
  doc: DatosPantallaV15['doc']
  texto: DatosDelTextoV15
  /** https://<espacio>.metrikone.co/valida */
  urlValida: string
}): CorreoAvisoV15 {
  const t = textosPantallaV15({ doc: p.doc, texto: p.texto, periodos: { estado: 'sin_dato' }, fechaExige: null })
  const vigencia = p.doc.vigenteDesde.slice(0, 10)
  const queCambia = [...t.queCambia]
  queCambia[5] = `${queCambia[5]} En Valida, la persona designada ve en Suscripción cuáles tiene pendientes.`
  const saludo = p.texto.razonSocial ? `Hola, equipo de ${p.texto.razonSocial}:` : 'Hola:'
  const cierre = [
    `Para leer los Términos completos y aceptarlos, entra a Valida: ${p.urlValida}. La aceptación la hace la persona ` +
      'designada por tu empresa. Adjuntamos el PDF de los Términos.',
    `Huella SHA-256 del PDF: ${t.huella}`,
    `Este correo acompaña el aviso publicado en la plataforma el ${
      t.publicado ? t.publicado.replace(/^Aviso publicado en la plataforma el /, '').replace(/\.$/, '') : fechaLarga(vigencia)
    } (cláusula 15.1).`,
    'METRIK IA S.A.S. · NIT 902.079.601-9 · mauricio.moreno@metrik.com.co',
  ]
  const texto = [
    saludo,
    sinNegritas(t.intro),
    'Qué cambia:',
    ...queCambia.map((q, i) => `${i + 1}. ${sinNegritas(q)}`),
    sinNegritas(t.siNoAceptas),
    ...cierre,
  ].join('\n\n')
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1A1A1A;max-width:640px">` +
    `<p>${escapar(saludo)}</p>` +
    `<h2 style="font-size:17px">${escapar(t.titulo)}</h2>` +
    `<p>${negritasHtml(t.intro)}</p>` +
    `<p><strong>Qué cambia:</strong></p><ol>${queCambia.map((q) => `<li style="margin-bottom:6px">${negritasHtml(q)}</li>`).join('')}</ol>` +
    `<p>${negritasHtml(t.siNoAceptas)}</p>` +
    `<p><a href="${escapar(p.urlValida)}" style="display:inline-block;background:#10B981;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:bold">Leer y aceptar en Valida</a></p>` +
    `<p>La aceptación la hace la persona designada por tu empresa. Adjuntamos el PDF de los Términos.</p>` +
    `<p style="font-size:12px;color:#6B7280">${escapar(cierre[1])}<br>${escapar(cierre[2])}<br>${escapar(cierre[3])}</p>` +
    `</div>`
  return { asunto: t.titulo, texto, html }
}
