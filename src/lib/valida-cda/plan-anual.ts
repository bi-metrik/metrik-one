/**
 * El Plan Anual de VALIDA · Plan CDA (decisión de Mauricio del 2026-10-06, Anexo v1 de Emilio). Puro:
 * todas las fechas son 'YYYY-MM-DD' de Bogotá y entran por parámetro.
 *
 * ## Qué es
 *
 * Doce períodos mensuales consecutivos por un pago único de $1.650.000 (11 x $150.000; precio de lista
 * $1.800.000, un mes de descuento). Corren desde el primer período que empieza DESPUÉS de aprobado el
 * pago; el período en curso no entra y su cuota se paga aparte (anexo 3.1 y 3.2). Las fechas se fijan
 * al aceptar y el enlace vence al empezar el día de inicio: si no se paga antes, la elección queda sin
 * efecto (2.3).
 *
 * ## Quién lo puede elegir
 *
 *   - un contrato con `parametros.plan_anual_habilitado = true` (el anexo sigue en borrador: nadie lo
 *     ve mientras MeTRIK no lo encienda contrato por contrato);
 *   - hoy, en Bogotá, a más tardar el 2027-03-31 (2.4);
 *   - sin cuotas vencidas e impagas, al elegir y al pagar (2.2).
 *
 * ## Qué pasa al aprobarse el pago (`planDeActivacion`)
 *
 * Las cuotas mensuales de los doce períodos dejan de cobrar el servicio: cada una queda como cuota de
 * USUARIOS ADICIONALES (tipo `usuarios_adicionales`) por lo que sumen sus cargos de licencias (cero si
 * no hay), y se crea la de los períodos que no tenían cuota, también en cero. Así un usuario adicional
 * comprado durante el plan se sigue cobrando mes a mes, con su enlace y su factura (5.2), por la misma
 * maquinaria de `periodos.ts`. Una cuota en cero no se cobra, no tiene enlace y no se pinta.
 *
 * Y se crea UNA cuota `anual` por $1.650.000, a la que se ata el cobro pagado: una sola cuota, una sola
 * factura (7.1, carga manual con `facturas_cuota`). Vence el día ANTERIOR al pago a propósito: el reparto
 * FIFO cubre las cuotas por vencimiento, y con el vencimiento en el día del pago una cuota mensual del
 * período en curso que venciera ese mismo día se llevaría parte de la plata del anual.
 *
 * ## La mora
 *
 * Los períodos del plan están pagados (la cuota anual queda cubierta), así que no hay restricción ni
 * suspensión por ellos (6.1). Las cuotas de usuarios adicionales no cuentan para la mora del servicio
 * (`TIPOS_CUOTA_SIN_MORA`): si una no se paga, se deshabilita ese usuario, no el servicio (5.2).
 */

import {
  conceptoConDesglose,
  diaInicioDeContrato,
  periodoDe,
  periodoDeCuota,
  periodoSiguiente,
  sumarDiasISO,
  type Cargo,
  type Periodo,
} from '@/lib/seccion-suscripcion/periodos'
import { ANEXO_PLAN_ANUAL_PLANTILLA } from './plan-anual-anexo'

export const PLAN_ANUAL = {
  periodos: 12,
  /** Lo que se paga, en pesos. */
  monto: 1_650_000,
  /** 12 x $150.000. */
  precioLista: 1_800_000,
  descuento: 150_000,
  /** Último día (Bogotá) en que se puede aprobar un pago del plan (anexo 2.4). */
  ofertaHasta: '2027-03-31',
} as const

export const TIPO_CUOTA_ANUAL = 'anual'
export const TIPO_CUOTA_USUARIOS_ADICIONALES = 'usuarios_adicionales'

/** Tipos de cuota que no cuentan para la mora del servicio (anexo 5.2). */
export const TIPOS_CUOTA_SIN_MORA: readonly string[] = [TIPO_CUOTA_USUARIOS_ADICIONALES]

/** El interruptor por contrato: `servicios_contratados.parametros.plan_anual_habilitado`. */
export function planAnualHabilitado(parametros: Record<string, unknown> | null | undefined): boolean {
  return parametros?.plan_anual_habilitado === true
}

export interface PlazoAnual {
  desde: string
  hasta: string
  periodos: Periodo[]
}

/** Los doce períodos que siguen al período en curso de `hoy`. */
export function plazoAnual(hoy: string, vigenteDesde: string): PlazoAnual {
  const dia = diaInicioDeContrato(vigenteDesde)
  let p = periodoSiguiente(periodoDe(hoy, dia), dia)
  const periodos: Periodo[] = []
  for (let i = 0; i < PLAN_ANUAL.periodos; i++) {
    periodos.push(p)
    p = periodoSiguiente(p, dia)
  }
  return { desde: periodos[0].desde, hasta: periodos[periodos.length - 1].hasta, periodos }
}

/** El instante en que vence el enlace: el comienzo (00:00 Bogotá) del día de inicio del plan. */
export function expiraEnlaceAnualMs(desde: string): number {
  return Date.parse(`${desde}T00:00:00-05:00`)
}

/** Lo mínimo que tiene que vivir un enlace recién generado para ofrecerlo. */
const VIDA_MINIMA_ENLACE_MS = 2 * 60 * 60 * 1000

export type MotivoSinOferta = 'apagado' | 'fuera_de_plazo' | 'cuotas_vencidas' | 'plan_activo' | 'sin_tiempo'

export const TEXTO_SIN_OFERTA: Record<MotivoSinOferta, string> = {
  apagado: 'El plan anual no está disponible para tu suscripción.',
  fuera_de_plazo: 'La oferta del plan anual fue hasta el 31 de marzo de 2027.',
  cuotas_vencidas: 'Para elegir el plan anual primero hay que pagar las cuotas vencidas.',
  plan_activo: 'Tu suscripción ya tiene un plan anual vigente.',
  sin_tiempo: 'Hoy termina el período en curso: el plan anual se puede elegir desde mañana.',
}

/**
 * ¿Se ofrece hoy el plan anual? En este orden: el interruptor del contrato, la fecha de la oferta, un
 * plan anual que todavía corre, las cuotas vencidas impagas y que al enlace le quede tiempo.
 */
export function ofertaPlanAnual(p: {
  habilitado: boolean
  hoy: string
  ahoraMs: number
  hayCuotasVencidas: boolean
  /** El último día de un plan anual ya activo, si lo hay. */
  planActivoHasta: string | null
  plazo: PlazoAnual
}): { disponible: true } | { disponible: false; motivo: MotivoSinOferta } {
  if (!p.habilitado) return { disponible: false, motivo: 'apagado' }
  if (p.hoy > PLAN_ANUAL.ofertaHasta) return { disponible: false, motivo: 'fuera_de_plazo' }
  if (p.planActivoHasta && p.planActivoHasta >= p.hoy) return { disponible: false, motivo: 'plan_activo' }
  if (p.hayCuotasVencidas) return { disponible: false, motivo: 'cuotas_vencidas' }
  if (expiraEnlaceAnualMs(p.plazo.desde) - p.ahoraMs < VIDA_MINIMA_ENLACE_MS) return { disponible: false, motivo: 'sin_tiempo' }
  return { disponible: true }
}

// ── El texto del anexo ──────────────────────────────────────────────────────────────────

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

/** '2026-11-23' → '23 de noviembre de 2026'. */
export function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`
}

/** '2026-11-23' → '23/11/2026', la forma del período en el concepto de las cuotas. */
export function fechaNumerica(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export const TIPOS_DOCUMENTO_ACEPTANTE = ['CC', 'CE', 'PA'] as const
export type TipoDocumentoAceptante = (typeof TIPOS_DOCUMENTO_ACEPTANTE)[number]

const NOMBRE_TIPO_DOCUMENTO: Record<TipoDocumentoAceptante, string> = {
  CC: 'cédula de ciudadanía',
  CE: 'cédula de extranjería',
  PA: 'pasaporte',
}

export interface DatosAnexo {
  razonSocial: string
  nit: string
  /** La versión de los Términos aceptados, sin la «v» («1.3»). */
  versionTerminos: string
  plazo: Pick<PlazoAnual, 'desde' | 'hasta'>
  nombreUsuario: string
  tipoDocumento: TipoDocumentoAceptante
  numeroDocumento: string
}

const MARCA_ACEPTACION = '\n---\n\n### Texto de aceptación'

/**
 * El anexo con sus datos, partido en dos: el texto que se lee (`anexo`) y el de la casilla (`casilla`,
 * sin el `>` de la cita ni el botón). Lo que se guarda y se firma es exactamente esto.
 */
export function renderAnexoPlanAnual(d: DatosAnexo, plantilla: string = ANEXO_PLAN_ANUAL_PLANTILLA): { anexo: string; casilla: string } {
  const valores: Record<string, string> = {
    razon_social: d.razonSocial,
    nit: d.nit,
    version_terminos: d.versionTerminos,
    fecha_inicio_plan: fechaLarga(d.plazo.desde),
    fecha_fin_plan: fechaLarga(d.plazo.hasta),
    nombre_usuario: d.nombreUsuario,
    tipo_documento: NOMBRE_TIPO_DOCUMENTO[d.tipoDocumento],
    numero_documento: d.numeroDocumento,
  }
  const lleno = plantilla.replace(/\{([a-z_]+)\}/g, (todo, llave: string) => valores[llave] ?? todo)
  const i = lleno.indexOf(MARCA_ACEPTACION)
  if (i === -1) throw new Error('El anexo no trae su texto de aceptación.')
  const anexo = `${lleno.slice(0, i).trimEnd()}\n`
  const cita = lleno.slice(i + MARCA_ACEPTACION.length)
  // Solo la cita (las líneas con «>»): el título de la sección no es parte de lo que se acepta.
  const lineas = cita
    .split('\n')
    .filter((l) => l.startsWith('>'))
    .map((l) => l.replace(/^>\s?/, '').trim())
    .filter((l) => l.length > 0 && !/^\*\*\[.*\]\*\*$/.test(l))
  const casilla = lineas.join(' ').replace(/^☐\s*/, '').replace(/\*\*/g, '')
  return { anexo, casilla }
}

/** Los datos que escribe la persona: nombre y documento. */
export function validarAceptante(p: {
  nombre: unknown
  tipoDocumento: unknown
  numeroDocumento: unknown
}): { ok: true; nombre: string; tipoDocumento: TipoDocumentoAceptante; numeroDocumento: string } | { ok: false; error: string } {
  const nombre = typeof p.nombre === 'string' ? p.nombre.replace(/\s+/g, ' ').trim() : ''
  if (nombre.length < 5 || nombre.length > 120 || !/\s/.test(nombre)) {
    return { ok: false, error: 'Escribe tu nombre completo, como aparece en tu documento.' }
  }
  const tipo = TIPOS_DOCUMENTO_ACEPTANTE.find((t) => t === p.tipoDocumento)
  if (!tipo) return { ok: false, error: 'Elige el tipo de documento.' }
  const numero = typeof p.numeroDocumento === 'string' ? p.numeroDocumento.replace(/[\s.]/g, '') : ''
  const valido = tipo === 'PA' ? /^[A-Za-z0-9]{5,15}$/.test(numero) : /^\d{5,12}$/.test(numero)
  if (!valido) return { ok: false, error: 'Revisa el número de tu documento.' }
  return { ok: true, nombre, tipoDocumento: tipo, numeroDocumento: numero.toUpperCase() }
}

/** El texto del enlace en la pasarela (máximo 100). */
export function descripcionEnlaceAnual(plazo: Pick<PlazoAnual, 'desde' | 'hasta'>): string {
  return `Suscripción VALIDA · Plan Anual · 12 períodos del ${fechaNumerica(plazo.desde)} al ${fechaNumerica(plazo.hasta)}`
}

// ── La activación ───────────────────────────────────────────────────────────────────────

export interface CuotaParaActivar {
  id: string
  numero: number
  tipo: string
  monto: number
  fechaVencimiento: string
  concepto: string | null
  /** El cobro programado vivo atado a la cuota (`plan_cobro_id` + `numero_cuota`), si lo hay. */
  cobroVivo: { id: string; pagado: boolean } | null
  /** La plata recibida, repartida FIFO SIN el pago del anual, ya la cubrió en todo o en parte. */
  conPlata: boolean
  /** Sus cargos vivos de licencias adicionales: lo que la cuota sigue cobrando durante el plan. */
  cargos: readonly Omit<Cargo, 'cuotaId' | 'cuotaNumero'>[]
}

export interface CambioCuota {
  id: string
  /** Lo que la función de la base comprueba antes de escribir: que nadie la tocó. */
  montoEsperado: number
  tipoEsperado: string
  monto: number
  concepto: string
}

export interface CuotaNueva {
  numero: number
  tipo: string
  monto: number
  fechaVencimiento: string
  concepto: string
}

export type PlanActivacion =
  | {
      ok: true
      actualizar: CambioCuota[]
      insertar: CuotaNueva[]
      /** Cobros programados SIN pagar de cuotas del plazo (un enlace mensual ya emitido): se anulan. */
      anularCobros: string[]
      cuotaAnual: CuotaNueva
    }
  | { ok: false; motivo: string }

export function conceptoCuotaAnual(plazo: Pick<PlazoAnual, 'desde' | 'hasta'>): string {
  return `Suscripción VALIDA · Plan CDA — Plan Anual (12 períodos) · periodo del ${fechaNumerica(plazo.desde)} al ${fechaNumerica(plazo.hasta)}`
}

export function conceptoUsuariosAdicionales(p: Periodo): string {
  return `Usuarios adicionales · periodo del ${fechaNumerica(p.desde)} al ${fechaNumerica(p.hasta)}`
}

/**
 * Qué se escribe al aprobarse el pago del plan. Puro: la función de la base lo aplica en una
 * transacción y vuelve a comprobar, con las filas bloqueadas, que ninguna cuota cambió.
 *
 * No activa (y la elección pasa a revisión de una persona, que devuelve la plata) si al pagar había
 * cuotas vencidas e impagas (2.2), si el pago llegó después de la oferta o del día de inicio (2.3, 2.4),
 * o si una cuota del plazo ya recibió plata como mensualidad (se pagó dos veces el mismo período).
 */
export function planDeActivacion(p: {
  plazo: Pick<PlazoAnual, 'desde' | 'hasta'>
  vigenteDesde: string
  fechaPago: string
  cuotas: readonly CuotaParaActivar[]
  /** Las cuotas vencidas e impagas al pagar, con el reparto SIN el pago del anual. */
  hayCuotasVencidas: boolean
}): PlanActivacion {
  if (p.fechaPago > PLAN_ANUAL.ofertaHasta) {
    return { ok: false, motivo: `El pago del plan anual se aprobó el ${p.fechaPago}, después de la oferta (31-mar-2027).` }
  }
  if (p.fechaPago >= p.plazo.desde) {
    return { ok: false, motivo: `El pago del plan anual se aprobó el ${p.fechaPago}, cuando el plazo ya debía haber empezado (${p.plazo.desde}).` }
  }
  if (p.hayCuotasVencidas) {
    return { ok: false, motivo: 'Al aprobarse el pago del plan anual había cuotas vencidas e impagas (anexo 2.2): no se activa y se devuelve.' }
  }

  const dia = diaInicioDeContrato(p.vigenteDesde)
  const periodos = plazoAnual(sumarDiasISO(p.plazo.desde, -1), p.vigenteDesde).periodos
  if (periodos[0].desde !== p.plazo.desde || periodos[periodos.length - 1].hasta !== p.plazo.hasta) {
    return { ok: false, motivo: 'Las fechas del plan anual no coinciden con los períodos del contrato.' }
  }

  const actualizar: CambioCuota[] = []
  const insertar: CuotaNueva[] = []
  const anularCobros: string[] = []
  const ordenadas = [...p.cuotas].sort((a, b) => a.numero - b.numero)
  let siguienteNumero = ordenadas.reduce((m, c) => Math.max(m, c.numero), 0) + 1

  // Cuántos días después de empezar su período vence una cuota mensual (la del 23-sep vence el 30-sep).
  const mensuales = ordenadas.filter((c) => c.tipo === 'cuota')
  const ultima = mensuales[mensuales.length - 1]
  const desfase = ultima
    ? Math.max(0, Math.round((Date.parse(ultima.fechaVencimiento) - Date.parse(periodoDeCuota(ultima, dia).desde)) / 86_400_000))
    : 7

  for (const periodo of periodos) {
    const delPeriodo = ordenadas.filter(
      (c) => (c.tipo === 'cuota' || c.tipo === TIPO_CUOTA_USUARIOS_ADICIONALES) && periodoDeCuota(c, dia).desde === periodo.desde,
    )
    if (delPeriodo.length > 1) {
      return { ok: false, motivo: `El período que empieza el ${periodo.desde} tiene ${delPeriodo.length} cuotas: revisar a mano.` }
    }
    const cuota = delPeriodo[0]
    if (!cuota) {
      insertar.push({
        numero: siguienteNumero++,
        tipo: TIPO_CUOTA_USUARIOS_ADICIONALES,
        monto: 0,
        fechaVencimiento: sumarDiasISO(periodo.desde, desfase),
        concepto: conceptoUsuariosAdicionales(periodo),
      })
      continue
    }
    if (cuota.tipo === TIPO_CUOTA_USUARIOS_ADICIONALES) continue
    if (cuota.conPlata || cuota.cobroVivo?.pagado) {
      return {
        ok: false,
        motivo: `La cuota ${cuota.numero} (período del ${periodo.desde}) ya recibió un pago mensual: el período quedaría pagado dos veces.`,
      }
    }
    if (cuota.cobroVivo) anularCobros.push(cuota.cobroVivo.id)
    actualizar.push({
      id: cuota.id,
      montoEsperado: cuota.monto,
      tipoEsperado: cuota.tipo,
      monto: cuota.cargos.reduce((s, c) => s + c.monto, 0),
      concepto: conceptoConDesglose(conceptoUsuariosAdicionales(periodo), cuota.cargos) ?? conceptoUsuariosAdicionales(periodo),
    })
  }

  return {
    ok: true,
    actualizar,
    insertar,
    anularCobros,
    cuotaAnual: {
      numero: siguienteNumero,
      tipo: TIPO_CUOTA_ANUAL,
      monto: PLAN_ANUAL.monto,
      fechaVencimiento: sumarDiasISO(p.fechaPago, -1),
      concepto: conceptoCuotaAnual(p.plazo),
    },
  }
}
