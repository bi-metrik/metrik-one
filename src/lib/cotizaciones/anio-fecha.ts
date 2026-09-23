/**
 * El año de una fecha que la captura muestra sin él.
 *
 * Las apps de los proveedores (Satena, Avianca, Amadeus) nunca muestran el año: «Lun, 23 Nov».
 * Hasta el 2026-09-23 cada una de esas fechas se completaba con el año del viaje y salía con
 * un aviso para confirmar, o sea que TODOS los vuelos quedaban en «Requiere atención» y el
 * aviso enseñaba a ignorar los avisos. Regla (coordinador, a pedido de Mauricio): el año se
 * DEDUCE sin preguntar, y solo se pregunta cuando la deducción falla.
 *
 *  1. Con día de la semana («Lun 23 Nov»): el primer año, desde hoy, en que esa fecha cae
 *     ese día. El 23 de noviembre de 2026 es lunes, así que es 2026.
 *  2. Sin día de la semana: el año de las fechas del viaje si la fecha cae en ellas; si no,
 *     la primera vez futura de esa fecha. Nunca «el año en curso», que en diciembre falla
 *     para un viaje de enero.
 *  3. El regreso nunca queda antes de la salida: si quedaría, es del año siguiente.
 *  4. Solo hay aviso cuando la deducción falla: el día de la semana no coincide en ninguno
 *     de los dos años posibles, o la fecha queda a más de 30 días de las del viaje. El aviso
 *     dice qué año asumió y por qué.
 *
 * Puro: el «hoy» entra por parámetro (Bogotá, lo pone quien llama).
 */

const DIA_MS = 86_400_000
/** Cuánto puede alejarse una fecha de las del viaje antes de avisar. */
export const HOLGURA_VIAJE_DIAS = 30

/** «--MM-DD» o «--MM-DD/lun»: la pantalla mostró día y mes, sin año, y a veces el día de la semana. */
const SIN_ANIO = /^--(\d{2})-(\d{2})(?:\s*[/(,|]\s*([a-záéíóúü]+)\.?\)?)?$/i
/** «AAAA-MM-DD», con el día de la semana pegado si el modelo lo agregó igual. */
const CON_ANIO = /^(\d{4}-\d{2}-\d{2})(?:\s*[/(,|]\s*[a-záéíóúü]+\.?\)?)?$/i

const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

/** Día de la semana (0 = domingo) desde lo que muestra la pantalla, en español o inglés. */
export function diaDeLaSemana(texto: string | null | undefined): number | null {
  const t = (texto ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (t.length < 2) return null
  const prefijos: [string, number][] = [
    ['dom', 0], ['sun', 0], ['lun', 1], ['mon', 1], ['mar', 2], ['tue', 2], ['mie', 3], ['wed', 3],
    ['jue', 4], ['thu', 4], ['vie', 5], ['fri', 5], ['sab', 6], ['sat', 6],
  ]
  for (const [p, n] of prefijos) if (t.startsWith(p)) return n
  // Las abreviaturas de dos letras de algunas apps: «Lu», «Ma», «Mi», «Ju», «Vi», «Sa», «Do».
  const dos: Record<string, number> = { do: 0, lu: 1, ma: 2, mi: 3, ju: 4, vi: 5, sa: 6 }
  return t.length === 2 && t in dos ? dos[t] : null
}

/** ¿Es una fecha sin año (con o sin día de la semana)? */
export function esFechaSinAnio(valor: string | null | undefined): boolean {
  return SIN_ANIO.test((valor ?? '').trim())
}

/** Quita el día de la semana pegado a una fecha completa. Lo demás lo deja igual. */
export function fechaSinDiaDeLaSemana(valor: string): string {
  const m = CON_ANIO.exec(valor.trim())
  return m ? m[1] : valor
}

function iso(anio: number, mes: number, dia: number): string | null {
  const t = Date.UTC(anio, mes - 1, dia)
  const d = new Date(t)
  // 29 de febrero en un año no bisiesto: la fecha no existe ese año.
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function ms(fecha: string): number {
  const [a, m, d] = fecha.slice(0, 10).split('-').map(Number)
  return Date.UTC(a, m - 1, d)
}

function fechaISO(v: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v ?? '')
  return m ? m[1] : null
}

/** «23 nov 2026». */
function corta(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number)
  return `${d} ${MES_CORTO[m - 1]} ${a}`
}

/** Las primeras apariciones de esa fecha desde `desde` (incluido), en orden. */
function apariciones(mes: number, dia: number, desde: string, cuantas: number): string[] {
  const out: string[] = []
  const base = ms(desde)
  for (let anio = Number(desde.slice(0, 4)); out.length < cuantas && anio < Number(desde.slice(0, 4)) + 12; anio++) {
    const f = iso(anio, mes, dia)
    if (f && ms(f) >= base) out.push(f)
  }
  return out
}

export interface EntradaAnio {
  /** «--MM-DD» o «--MM-DD/lun», tal como lo devolvió la lectura. */
  valor: string
  /** Hoy en Bogotá, «AAAA-MM-DD». */
  hoy: string
  /** Las fechas del viaje del negocio, si las tiene. */
  viaje?: { inicio: string | null; fin: string | null } | null
  /** Para un regreso: la salida ya resuelta. El regreso no puede quedar antes. */
  noAntesDe?: string | null
  /** «la salida», «el regreso»: para redactar el aviso. */
  nombre: string
}

export interface AnioDeducido {
  fecha: string
  /** Solo cuando la deducción falló: qué año se asumió y por qué. `null` = sin aviso. */
  aviso: string | null
}

/**
 * Deduce el año de una fecha sin año. `null` si el valor no es una fecha sin año.
 */
export function deducirAnio(e: EntradaAnio): AnioDeducido | null {
  const m = SIN_ANIO.exec(e.valor.trim())
  if (!m) return null
  const mes = Number(m[1])
  const dia = Number(m[2])
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const semana = diaDeLaSemana(m[3])

  const hoy = fechaISO(e.hoy) ?? e.hoy
  const noAntesDe = fechaISO(e.noAntesDe)
  // El piso: hoy, o la salida si es posterior (regla 3).
  const piso = noAntesDe && noAntesDe > hoy ? noAntesDe : hoy
  const inicio = fechaISO(e.viaje?.inicio)
  const fin = fechaISO(e.viaje?.fin) ?? inicio

  const dentroDelViaje = (f: string): boolean | null => {
    if (!inicio || !fin) return null
    return ms(f) >= ms(inicio) - HOLGURA_VIAJE_DIAS * DIA_MS && ms(f) <= ms(fin) + HOLGURA_VIAJE_DIAS * DIA_MS
  }
  const lejosDelViaje = (f: string): string | null =>
    dentroDelViaje(f) === false
      ? `queda a más de ${HOLGURA_VIAJE_DIAS} días de las fechas del viaje (${corta(inicio!)} a ${corta(fin!)})`
      : null

  let fecha: string
  let motivo: string | null = null

  if (semana !== null) {
    // Regla 1: los dos años posibles desde el piso; el primero donde cae ese día.
    const posibles = apariciones(mes, dia, piso, 2)
    const coincide = posibles.find(f => new Date(ms(f)).getUTCDay() === semana)
    if (coincide) {
      fecha = coincide
    } else {
      fecha = posibles[0] ?? `${piso.slice(0, 4)}-${m[1]}-${m[2]}`
      const anios = posibles.map(f => f.slice(0, 4)).join(' ni en ')
      motivo = `la captura dice ${NOMBRE_DIA[semana]} y el ${dia} ${MES_CORTO[mes - 1]} no cae ${NOMBRE_DIA[semana]} ni en ${anios}`
    }
  } else {
    // Regla 2: el año del viaje si la fecha cae en él; si no, la primera vez futura.
    const delViaje = [inicio, fin]
      .filter((f): f is string => !!f)
      .map(f => iso(Number(f.slice(0, 4)), mes, dia))
      .filter((f): f is string => !!f && ms(f) >= ms(inicio!) && ms(f) <= ms(fin!))
    const candidato = delViaje[0] ?? null
    if (candidato && (!noAntesDe || candidato >= noAntesDe)) {
      fecha = candidato
    } else {
      fecha = apariciones(mes, dia, piso, 1)[0] ?? `${piso.slice(0, 4)}-${m[1]}-${m[2]}`
    }
  }

  if (!motivo) motivo = lejosDelViaje(fecha)
  return {
    fecha,
    aviso: motivo
      ? `La captura no muestra el año de ${e.nombre}: se asume ${fecha.slice(0, 4)} (${corta(fecha)}) porque ${motivo}. Confírmalo.`
      : null,
  }
}

/**
 * El aviso que dejaba la regla anterior en TODA fecha sin año («se completa con el del
 * viaje»). Las lecturas guardadas antes del 2026-09-23 lo traen; se deja de mostrar al leer
 * la tarifa, sin tocar la base (el año que completó es el del viaje, el mismo que deduce hoy
 * la regla 2).
 */
export function esAvisoDeAnioViejo(aviso: string): boolean {
  return /^La captura no muestra el año de .+: se completa con el del viaje/.test(aviso)
}
