/**
 * ¿El Radar sigue abierto? El trial de 5 días, su vencimiento y la mora, en un solo lugar. **Puro**:
 * todas las fechas son 'YYYY-MM-DD' de Bogotá y `hoy` entra por parámetro.
 *
 * Decisión de Mauricio (2026-09-28), textual: «que quede el periodo de prueba de 5 días después de
 * aceptar los términos y que para seguir usando el servicio tenga que pagar con el link».
 *
 * ## Por qué el Radar se CIERRA y Valida solo pasa a «solo lectura»
 *
 * La regla D4 del 2026-09-15 dice que el impago de una licencia da 5 días de gracia y después **solo
 * lectura, nunca bloqueo**. Eso tiene sentido donde el valor del módulo es ESCRIBIR: un CDA en mora
 * conserva sus consultas hechas y sus soportes, y lo que pierde es registrar más. **En el Radar no
 * hay nada que escribir:** todo su valor es LEER la lista priorizada. Aplicarle «solo lectura»
 * sería no aplicarle nada — el cliente seguiría viendo cada mañana las convocatorias que paga.
 *
 * Por eso aquí la única forma de que el corte signifique algo es cerrar la lista y dejar a la vista
 * el enlace de pago, que es exactamente lo que pidió Mauricio. **No se toca la regla de Clarity ni
 * la de Valida**: `estadoMora` (`valida-cda/plazos.ts`) y `accesoWorkspace` siguen igual, y este
 * módulo no participa de ellas.
 *
 * ## Fail-open cuando no se puede leer, igual que la mora de Valida
 *
 * «No pude leer las cuotas» NO es «no pagó»: sin prueba de impago el módulo no se cierra
 * (`acceso-servidor.ts` devuelve `no_disponible` y la pantalla abre). Es lo contrario del gate de
 * TÉRMINOS, que es fail-closed, y la diferencia es deliberada: ahí la ausencia de evidencia de
 * aceptación significa que no aceptó; aquí la ausencia de evidencia de mora no significa que deba.
 */

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

/** '2026-10-04' → '4-oct'. Lo que no es fecha sale tal cual. */
export function fechaDiaMes(iso: string): string {
  const m = FECHA.exec(iso)
  if (!m) return iso
  return `${Number(m[3])}-${MESES[Number(m[2]) - 1]}`
}

/** Días de calendario entre dos fechas ISO (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Una cuota del contrato del Radar, ya resuelta con el reparto FIFO de los pagos. */
export interface CuotaDelRadar {
  numero: number
  fechaVencimiento: string
  /** Cubierta por los pagos recibidos (incluido el excedente de cuotas anteriores). */
  pagada: boolean
  saldo: number
  /** Enlace de pago vigente de su cobro programado, si lo tiene. */
  enlace: string | null
}

export interface ContratoDelRadar {
  estado: string
  /** `parametros.dias_trial` del contrato, o el `por_defecto` de su ficha. */
  diasTrial: number | null
}

export type AccesoRadar =
  /** El espacio no tiene contrato de Radar: no hay nada que cobrar (uso interno, demo, cortesía). */
  | { estado: 'sin_contrato' }
  /** Hay contrato pero nadie aceptó los términos: de eso se encarga el gate de términos, no esto. */
  | { estado: 'sin_aceptacion' }
  | { estado: 'en_trial'; finTrial: string; diasRestantes: number }
  | { estado: 'al_dia'; cubiertoHasta: string | null }
  | { estado: 'cerrado'; motivo: 'trial_vencido' | 'cuota_vencida'; desde: string; cuota: CuotaDelRadar | null }
  /** No se pudo leer: NO cierra (ver la cabecera). */
  | { estado: 'no_disponible' }

/** El día en que termina el trial: la fecha (Bogotá) de la aceptación + los días pactados. */
export function finDelTrialDesdeFecha(fechaAceptacion: string, diasTrial: number): string {
  const m = FECHA.exec(fechaAceptacion)
  if (!m) throw new Error(`fecha inválida: ${fechaAceptacion}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.trunc(diasTrial)))
    .toISOString()
    .slice(0, 10)
}

/**
 * La decisión. En este orden, porque cada paso supone el anterior:
 *
 *   1. sin contrato → nada que cobrar;
 *   2. sin aceptación → el gate de términos ya no lo dejó entrar;
 *   3. hoy antes del fin del trial → en trial;
 *   4. desde el fin del trial, manda la CUOTA: si alguna ya venció y no está pagada, cerrado; si la
 *      última vencida está pagada, al día; y si no hay ninguna cuota vencida (el cron todavía no
 *      enroló el contrato), cerrado por trial vencido — porque el trial se acabó y no hay pago.
 *
 * El punto 4 usa la MISMA regla para el día 6 y para el mes 7: «hay una cuota vencida sin pagar».
 * No hay un concepto de mora aparte para el Radar, que es lo que evita dos relojes.
 */
export function estadoAccesoRadar(p: {
  contrato: ContratoDelRadar | null
  /** Fecha (Bogotá) de la aceptación más vieja del contrato. */
  fechaAceptacion: string | null
  cuotas: readonly CuotaDelRadar[]
  hoy: string
}): AccesoRadar {
  if (!p.contrato) return { estado: 'sin_contrato' }
  // Un contrato que todavía no arranca o que ya terminó no se cobra por esta vía: el módulo se
  // apaga (o se enciende) por `workspaces.modules`, que es otro acto.
  if (p.contrato.estado !== 'activo' && p.contrato.estado !== 'pausado') return { estado: 'sin_contrato' }
  if (!p.fechaAceptacion) return { estado: 'sin_aceptacion' }
  // Sin `dias_trial` en ninguna de las dos fuentes no se inventa un trial de cero días: eso cerraría
  // el módulo el mismo día de la aceptación por un dato ausente.
  if (p.contrato.diasTrial === null) return { estado: 'sin_aceptacion' }

  const finTrial = finDelTrialDesdeFecha(p.fechaAceptacion, p.contrato.diasTrial)
  if (p.hoy < finTrial) {
    return { estado: 'en_trial', finTrial, diasRestantes: diasEntre(p.hoy, finTrial) }
  }

  const vencidas = p.cuotas.filter((c) => c.fechaVencimiento <= p.hoy)
  const impagas = vencidas.filter((c) => !c.pagada).sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento))
  if (impagas.length > 0) {
    const cuota = impagas[0]
    return {
      estado: 'cerrado',
      // La primera cuota es el propio fin del trial: se nombra como tal, porque para el cliente es
      // «se acabó la prueba» y no «estás en mora».
      motivo: cuota.fechaVencimiento === finTrial ? 'trial_vencido' : 'cuota_vencida',
      desde: cuota.fechaVencimiento,
      cuota,
    }
  }
  if (vencidas.length === 0) {
    // El trial venció y no hay ni una cuota emitida: el módulo se cierra igual. Que el cron no haya
    // enrolado el contrato no es una extensión del trial.
    return { estado: 'cerrado', motivo: 'trial_vencido', desde: finTrial, cuota: null }
  }

  const siguiente = p.cuotas
    .filter((c) => c.fechaVencimiento > p.hoy)
    .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento))[0]
  return { estado: 'al_dia', cubiertoHasta: siguiente?.fechaVencimiento ?? null }
}

/** ¿Se puede usar el Radar? Solo `cerrado` cierra; `no_disponible` no (ver la cabecera). */
export function radarAbierto(a: AccesoRadar): boolean {
  return a.estado !== 'cerrado'
}

/** Lo que responde cualquier acción del Radar con el módulo cerrado por pago. */
export function mensajeRadarCerrado(a: Extract<AccesoRadar, { estado: 'cerrado' }>): string {
  return a.motivo === 'trial_vencido'
    ? `Tu prueba del Radar terminó el ${fechaDiaMes(a.desde)}. Para seguir usándolo, paga con el enlace de la pantalla del Radar.`
    : `El Radar está cerrado por un pago vencido desde el ${fechaDiaMes(a.desde)}. Se reabre cuando se registre el pago.`
}

/**
 * El texto del banner de prueba (bloque G de la spec). **El número de días lo calcula el servidor**
 * y llega ya restado: la pantalla no recibe la fecha de la aceptación para restarla en el navegador,
 * porque un reloj mal puesto —o movido a propósito— regalaría días de prueba. Es lo único de este
 * banner que es seguridad y no diseño.
 *
 * Días COMPLETOS restantes, no una cuenta atrás al segundo: el cobro es por día.
 *
 * ⚠️ Los tramos de la spec «1 día: Mañana termina tu prueba» y «Último día: Hoy es el último día»
 * son **el mismo día** en este modelo, y no es un detalle de redacción: el trial de 5 días son los
 * días 1 a 5 y el día 6 es el vencimiento de la primera cuota (lo hace cumplir el CHECK de
 * `servicio_cobro_enrolamiento`). Con `diasRestantes = 1`, hoy es el último día de uso Y mañana
 * vence. Se dice las dos cosas en un texto, en vez de inventar un sexto día de prueba que le
 * regalaría uno al cliente.
 */
export function textoBannerTrial(diasRestantes: number): string {
  if (diasRestantes <= 1) return 'Hoy es el último día de tu prueba: mañana se cierra el Radar si no registras el pago.'
  return `Te quedan ${diasRestantes} días de prueba del Radar.`
}

/** El aviso del trial para la pantalla. `null` = no hay nada que avisar. */
export function avisoTrialRadar(a: AccesoRadar): string | null {
  if (a.estado !== 'en_trial') return null
  return textoBannerTrial(a.diasRestantes)
}
