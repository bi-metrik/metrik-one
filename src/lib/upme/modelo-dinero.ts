/**
 * Modelo de dinero SOENA (rediseño 2026-07-16) — helpers PUROS y testables.
 *
 * El cliente paga en UN recaudo dos componentes distintos:
 *   - HONORARIO de SOENA  → es el INGRESO. Vive en `negocios.precio_aprobado`.
 *   - TARIFA UPME (pasante) → SOENA solo la RECAUDA y la desembolsa a la UPME; NO
 *     es ingreso. Se confirma en Validación (bloque "Confirmar tarifa UPME") y vive
 *     en el `data` de ese bloque, NO en el precio del negocio.
 *
 * Regla cardinal del rediseño (GO Vera 2026-07-16, reemplaza el diseño "Ola 2"
 * donde `precio_aprobado = honorario + tarifa`):
 *
 *     precio_aprobado   = HONORARIO            (ingreso — lo que entra al P&L)
 *     valor_a_recaudar  = honorario + tarifa   (lo que el cliente le paga a SOENA)
 *
 * El P&L (`v_pyl_mes`) reconoce solo cobros NO-pasante, así que la tarifa nunca
 * infla EBITDA. Por eso `precio_aprobado` debe quedarse en honorario: es la señal
 * de ingreso en todo el sistema y mezclarle la tarifa la corrompe.
 *
 * Modalidad de la propuesta (aplica SOLO al honorario; la tarifa va completa por
 * adelantado en ambos planes):
 *   - Plan 1 = 50/50: tarifa COMPLETA + 50% honorario ahora, 50% después.
 *   - Plan 2 = único: todo ahora.
 *
 * Estos helpers NO tocan DB ni red — viven aparte de las server actions para poder
 * probarse sin mocks. Los `'use server'` (propuesta/conciliación/cobros) los consumen.
 *
 * REGLA DURA: nada aquí bloquea, descarta ni "gatea" — solo compone y reparte.
 */

import { imputarPago } from './imputacion-pago'

import { TOLERANCIA_SALDO_COP, saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'

/**
 * Tolerancia de materialidad de saldo (piso de Carmen, CFO). Un residuo ≤ $1.000 COP
 * no bloquea los gates de avance: no es cobrable en la práctica. La tolerancia SOLO
 * destraba la comparación del gate — NUNCA genera cobro ni reconoce ingreso, no toca
 * `precio_aprobado` ni el P&L/EBITDA. Faltantes > $1.000 siguen bloqueando.
 *
 * La constante se mudó a `lib/negocios/tolerancia-saldo.ts` (el motor de avance también la
 * necesita y no tiene por qué depender del modelo de dinero de SOENA). Se re-exporta desde
 * aquí para no partir a los consumidores que ya la importaban de este módulo.
 */
export { TOLERANCIA_SALDO_COP, saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'

/** Modelo de dinero de un negocio, leído de su propuesta aprobada + tarifa confirmada. */
export interface ModeloDinero {
  /**
   * Tarifa UPME (pasante) CONFIRMADA en Validación, completa por adelantado. 0 si
   * aún no se confirma. Es la que alimenta el reparto pasante/honorario y el gate
   * de handoff. NO es la referencia calculada (esa es `tarifa_upme_ref`).
   */
  tarifa_upme: number
  /** Modalidad: 1 = 50/50, 2 = único, null = sin modalidad. */
  aprobado_plan: 1 | 2 | null
  /** Honorario del plan elegido (= precio_aprobado del negocio). */
  aprobado_honorario: number | null
  /**
   * Tarifa UPME de REFERENCIA calculada (Art. 13) desde el valor del vehículo,
   * SOLO para mostrar/pre-llenar cuando la tarifa aún no se confirma. NO la leen
   * los gates ni el reparto (esos usan `tarifa_upme`). Informativa.
   */
  tarifa_upme_ref?: number
}

/**
 * Valor a recaudar del cliente = honorario (precio_aprobado) + tarifa UPME (pasante).
 * Es la base del saldo del bloque de Cobros y del umbral de handoff. NO se almacena:
 * se deriva del `precio_aprobado` del negocio (honorario) + la tarifa confirmada del
 * modelo. Sin tarifa (0), el valor a recaudar queda = honorario.
 *
 * @param precioAprobado precio_aprobado del negocio = HONORARIO, en COP.
 * @param modelo         modelo de dinero (aporta la tarifa confirmada). null → sin tarifa.
 */
export function valorARecaudar(precioAprobado: number, modelo: ModeloDinero | null): number {
  const honorario = Number.isFinite(precioAprobado) && precioAprobado > 0 ? precioAprobado : 0
  const tarifa = modelo && Number.isFinite(modelo.tarifa_upme) && modelo.tarifa_upme > 0 ? modelo.tarifa_upme : 0
  return Math.round(honorario + tarifa)
}

// ── Tarifa confirmada: resolución EN LOTE ────────────────────────────────────
//
// `leerModeloDineroCompleto` resuelve el modelo de UN negocio con varias consultas.
// El panel de conciliación necesita la tarifa de TODOS los negocios del workspace
// (235 abiertos en SOENA), así que no puede llamarlo en un bucle. Estas funciones
// son la MISMA decisión, extraída pura: el caller trae las filas en una consulta
// por lote y aquí se aplican las tres reglas. Si la regla cambia, cambia acá y en
// `leerModeloDineroCompleto` — el contrato entre las dos lo fija `tarifa-lote.test.ts`.

/** Fila mínima de un `negocio_bloques` para resolver la tarifa en lote. */
export interface FilaBloqueTarifa {
  negocio_id: string
  data: Record<string, unknown> | null
}

/**
 * Tarifa UPME CONFIRMADA que declara el `data` de un bloque de confirmación. 0 si no
 * está confirmada.
 *
 * El toggle `tarifa_confirmada` es obligatorio: el bloque también guarda la tarifa de
 * REFERENCIA calculada (Art. 13), y esa no es una obligación del cliente hasta que
 * alguien la confirma. Tomarla sin el toggle inflaría el valor a recaudar de negocios
 * que todavía no cerraron la cifra.
 */
export function tarifaConfirmadaDeData(data: Record<string, unknown> | null | undefined): number {
  if (!data || typeof data !== 'object') return 0
  if (data.tarifa_confirmada !== true) return 0
  const valor = Number(data.tarifa_upme_confirmada ?? 0)
  return Number.isFinite(valor) && valor > 0 ? valor : 0
}

/**
 * ¿Este bloque declara que el negocio NO contrató la certificación UPME? Solo cuenta
 * si el campo EXISTE y está en `false`: un bloque sin tocar no debe anular la tarifa
 * de un negocio normal.
 */
export function niegaCertificacionUpme(data: Record<string, unknown> | null | undefined): boolean {
  if (!data || typeof data !== 'object') return false
  return 'requiere_certificacion_upme' in data && data.requiere_certificacion_upme === false
}

/**
 * Mapa negocio → tarifa UPME confirmada, resuelto en lote.
 *
 * Un negocio puede traer varias filas del bloque (las copias readonly heredadas viajan
 * con él entre etapas): gana la confirmada, sin importar el orden de llegada. Si el
 * negocio declaró que no contrató la certificación, la tarifa se anula: no hay nada
 * que pasarle al cliente y sumársela escondería un sobrepago real.
 *
 * Puro: no toca DB ni red.
 *
 * @param confirmaciones filas de los bloques con `config_extra.tarifa_confirmacion.enabled`.
 * @param certificaciones filas del bloque `certificacion_upme` (decisión comercial).
 */
export function tarifaConfirmadaPorNegocio(
  confirmaciones: FilaBloqueTarifa[],
  certificaciones: FilaBloqueTarifa[],
): Map<string, number> {
  const tarifas = new Map<string, number>()
  for (const fila of confirmaciones) {
    if (!fila?.negocio_id) continue
    const tarifa = tarifaConfirmadaDeData(fila.data)
    if (tarifa <= 0) continue
    // Máximo entre filas: determinista, no depende del orden en que lleguen.
    tarifas.set(fila.negocio_id, Math.max(tarifas.get(fila.negocio_id) ?? 0, tarifa))
  }
  for (const fila of certificaciones) {
    if (!fila?.negocio_id) continue
    if (niegaCertificacionUpme(fila.data)) tarifas.set(fila.negocio_id, 0)
  }
  return tarifas
}

/**
 * tipo_cobro del componente honorario según la modalidad:
 *   - 50/50 (plan 1) → 'anticipo' (el 1er pago es el anticipo; el saldo llega después)
 *   - único (plan 2) o sin modalidad → 'pago'
 */
export function tipoCobroHonorario(plan: 1 | 2 | null): 'anticipo' | 'pago' {
  return plan === 1 ? 'anticipo' : 'pago'
}

/**
 * Saldo ESPERADO (pendiente legítimo) del HONORARIO según la modalidad. En 50/50 el
 * 2º 50% del honorario está pendiente por diseño hasta el pago de éxito → NO es
 * descuadre. La tarifa (pasante) va completa por adelantado, así que no cuenta como
 * pendiente. En único o sin modalidad → 0. Si no se conoce el honorario, 0 (no asume
 * pendiente para no ocultar un faltante real).
 */
export function saldoEsperadoPorModalidad(modelo: ModeloDinero | null): number {
  if (!modelo || modelo.aprobado_plan !== 1) return 0
  const honorario = modelo.aprobado_honorario ?? 0
  if (!Number.isFinite(honorario) || honorario <= 0) return 0
  return Math.round(honorario * 0.5)
}

/**
 * Umbral de recaudo para SOLTAR el negocio a operaciones (handoff Documentación →
 * Cargue): el cliente debe haber pagado a SOENA todo el VALOR A RECAUDAR excepto el
 * saldo legítimamente diferido por la modalidad. Como
 * `valor_a_recaudar = honorario + tarifa`, el umbral queda:
 *   - Plan 1 (50/50): tarifa + 50% honorario   (100% UPME + anticipo)
 *   - Plan 2 (único): tarifa + 100% honorario   (100% UPME + honorario)
 * Es decir `valor_a_recaudar − saldoEsperadoPorModalidad`. Nunca negativo.
 *
 * @param precioAprobado precio_aprobado del negocio = HONORARIO, en COP.
 * @param modelo         modelo de dinero (aporta la tarifa confirmada + modalidad).
 */
export function umbralRecaudoHandoff(precioAprobado: number, modelo: ModeloDinero | null): number {
  const vr = valorARecaudar(precioAprobado, modelo)
  return Math.max(0, Math.round(vr - saldoEsperadoPorModalidad(modelo)))
}

/** Desglose del recaudo pendiente para el handoff a operaciones. */
export interface PendienteHandoff {
  /** Umbral exigido = valor a recaudar − saldo diferido. */
  umbral: number
  /** Recaudo real del cliente considerado. */
  recaudado: number
  /** Falta total para alcanzar el umbral (nunca negativo). */
  pendienteTotal: number
  /** Falta del componente UPME (pasante). Se cubre primero. */
  pendienteUpme: number
  /** Falta del componente honorario del plan. */
  pendienteHonorario: number
  /** true si el recaudo cubre el umbral (con tolerancia de materialidad `TOLERANCIA_SALDO_COP`). */
  cubierto: boolean
}

/**
 * Calcula el pendiente para el handoff a operaciones, desglosado en UPME vs
 * honorario. El chequeo agregado (recaudado ≥ umbral) no depende del orden y no
 * cambió; el desglose sí, y ahora usa la regla única del sistema (`imputarPago`):
 * **el recaudo cubre el HONORARIO primero, después la tarifa** (decisión de Mauricio,
 * 2026-08-18). Antes decía lo contrario, y eso mandaba a cobrar la bolsa equivocada.
 *
 * @param precioAprobado precio_aprobado del negocio = HONORARIO, en COP.
 * @param modelo         modelo de dinero del negocio (plan + honorario + tarifa confirmada).
 * @param recaudado      recaudo real del cliente (suma de cobros reales), en COP.
 */
export function calcularPendienteHandoff(
  precioAprobado: number,
  modelo: ModeloDinero | null,
  recaudado: number,
): PendienteHandoff {
  const umbral = umbralRecaudoHandoff(precioAprobado, modelo)
  const rec = Number.isFinite(recaudado) && recaudado > 0 ? recaudado : 0

  const tarifa = modelo && Number.isFinite(modelo.tarifa_upme) && modelo.tarifa_upme > 0 ? modelo.tarifa_upme : 0
  const honorarioRequerido = Math.max(0, umbral - tarifa)
  // HONORARIO PRIMERO, la misma regla que parte los cobros (`imputarPago`). El total
  // pendiente no depende del orden; el desglose si, y decir "falta la tarifa" cuando lo
  // que falta es el honorario manda a cobrar lo que no es.
  const imputado = imputarPago({
    pago: rec,
    escalones: { techoTramo1: honorarioRequerido, techoTarifa: tarifa, techoTramo2: 0 },
  })
  const pendienteUpme = Math.max(0, Math.round(tarifa - imputado.a_tarifa))
  const pendienteHonorario = Math.max(0, Math.round(honorarioRequerido - imputado.a_tramo1))

  const pendienteTotal = Math.max(0, Math.round(umbral - rec))
  return {
    umbral,
    recaudado: rec,
    pendienteTotal,
    pendienteUpme,
    pendienteHonorario,
    cubierto: pendienteTotal <= TOLERANCIA_SALDO_COP,
  }
}

/** Fila mínima de un bloque `propuesta_economica` para detectar el cero deliberado. */
export interface PropuestaBloqueData {
  data: Record<string, unknown> | null
}

/**
 * ¿El negocio tiene un "cero DELIBERADO"? No hay honorario que cobrar porque su
 * propuesta económica está APROBADA y el valor final aprobado es 0.
 *
 * Distingue este caso del "aún sin cotizar" (precio null/0 porque nunca se aprobó una
 * propuesta). La señal es que la propuesta canónica del negocio tiene `aprobado_at`
 * (fue aprobada) Y su honorario aprobado es <= 0 (`aprobado_honorario`, con fallback al
 * `precio_aprobado` del negocio — al aprobar, `precio_aprobado` queda igual al honorario
 * elegido, que puede ser 0).
 *
 * SOLO un cero deliberado da por satisfecho el gate de anticipo/handoff — un negocio sin
 * propuesta aprobada sigue bloqueando (no se abre la puerta a saltar el anticipo de algo
 * no cotizado). Puro: no toca DB ni red.
 *
 * @param propuestas    filas de `negocio_bloques` tipo `propuesta_economica` del negocio.
 * @param precioAprobado `negocios.precio_aprobado` (fallback del honorario aprobado).
 */
export function esCeroDeliberado(
  propuestas: PropuestaBloqueData[],
  precioAprobado: number | null,
): boolean {
  for (const pb of propuestas) {
    const d = pb.data
    if (!d || typeof d !== 'object') continue
    // Solo cuenta si la propuesta fue APROBADA (no una versión generada sin aprobar).
    if (!d.aprobado_at) continue
    const honorarioRaw = d.aprobado_honorario
    const honorario = typeof honorarioRaw === 'number' ? honorarioRaw : precioAprobado
    // Aprobada + honorario conocido y no positivo → cero deliberado.
    if (typeof honorario === 'number' && honorario <= 0) return true
  }
  return false
}

// ── Cartera: cuándo la tarifa es plata por cobrar y cuándo es ruido ──────────
//
// La tarifa UPME se confirma en Validación, mucho ANTES de que exista una propuesta
// aprobada. `valorARecaudar` la suma siempre, que es lo correcto para el gate de
// handoff y para el sobrepago: son preguntas sobre plata que ya se movió o que está a
// punto de moverse. Pero para la pregunta "¿este negocio le debe plata a SOENA?" ese
// mismo número convierte al pipeline temprano en cartera inventada: un negocio recién
// entrado aparece debiendo una tarifa que nadie le ha cotizado.
//
// El criterio vive acá, en el resolvedor, y NO dentro del panel: escribirlo al lado
// del consumidor es exactamente el patrón que dejó seis copias de `precio_aprobado −
// cobrado` regadas por el sistema.

/** Lo que hay que saber del negocio para decidir si su tarifa es cartera. */
export interface ContextoCartera {
  /** Recaudo real del cliente (suma de cobros reales), en COP. */
  recaudado: number
  /** ¿Su propuesta fue APROBADA con honorario 0? Sale de `esCeroDeliberado`. */
  ceroDeliberado: boolean
  /**
   * `negocios.precio_aprobado` CRUDO: la señal de que hay un monto aprobado.
   * OJO: no es el honorario que se muestra en pantalla, que cae a `precio_estimado`
   * cuando no hay aprobado. Un estimado es una hipótesis comercial, no un monto
   * aprobado, y no debe volver cobrable la tarifa.
   */
  honorarioAprobado: number | null
}

/**
 * ¿La tarifa confirmada de este negocio es CARTERA (plata que alguien debe cobrar)?
 *
 * Sí en cuanto se cumpla cualquiera de las tres:
 *   1. Ya hay plata recaudada → hay dinero real en juego; esconderlo es peor que el
 *      ruido que este criterio quita.
 *   2. Hay honorario aprobado → el negocio se cerró y la tarifa va con él.
 *   3. Es un cero deliberado → una propuesta aprobada en 0 SIGUE siendo aprobada, y su
 *      tarifa pendiente es cartera legítima.
 *
 * No, solo cuando no se cumple ninguna: sin monto aprobado y sin un peso recaudado, no
 * hay nada que cobrar todavía.
 *
 * Puro: no toca DB ni red.
 */
export function tarifaEsCartera(ctx: ContextoCartera): boolean {
  const recaudado = Number.isFinite(ctx.recaudado) ? ctx.recaudado : 0
  if (recaudado > 0) return true
  const aprobado = ctx.honorarioAprobado
  if (typeof aprobado === 'number' && Number.isFinite(aprobado) && aprobado > 0) return true
  return ctx.ceroDeliberado === true
}

/**
 * Valor a recaudar para efectos de CARTERA: igual a `valorARecaudar`, salvo que deja la
 * tarifa por fuera cuando todavía no es cobrable (ver `tarifaEsCartera`).
 *
 * ⚠️ INVARIANTE que lo hace seguro: **con recaudo > 0 nunca difiere de
 * `valorARecaudar`**. Por eso este criterio no puede mover un sobrepago ni el badge —
 * un sobrepago exige un cobro, y con cobro las dos funciones dan lo mismo. Está fijado
 * en `cartera.test.ts`; si alguien cambia `tarifaEsCartera`, esa prueba es la que avisa.
 *
 * @param precioAprobado honorario que se muestra (con su fallback a `precio_estimado`).
 * @param modelo         modelo de dinero (aporta la tarifa confirmada).
 * @param ctx            señales del negocio para decidir si la tarifa es cobrable.
 */
export function valorARecaudarCartera(
  precioAprobado: number,
  modelo: ModeloDinero | null,
  ctx: ContextoCartera,
): number {
  return valorARecaudar(precioAprobado, tarifaEsCartera(ctx) ? modelo : null)
}

/** Descuadre de la conciliación final del recaudo, desglosado por lado. */
export interface DescuadreConciliacion {
  /** Honorario que el cliente todavía le debe a SOENA. 0 si está cubierto. */
  faltante: number
  /** Plata recibida por encima del valor a recaudar (honorario + tarifa). 0 si no hay. */
  exceso: number
  /** true si cualquiera de los dos lados supera el piso de materialidad. */
  hayDescuadre: boolean
}

/**
 * Residuo tolerado por la conciliación final.
 *
 * Nació en $1 (el redondeo, no la materialidad) con el argumento de que aquí se cierra la
 * plata del caso en vez de dejarlo pasar. En la práctica esa distinción no se sostuvo: el
 * gate `conciliacion_diana` que consume esta función es un gate de AVANCE como los demás, así
 * que un residuo de $120 frenaba el caso igual, solo que con otro número. Decisión de Mauricio
 * (2026-08-06): el piso de materialidad es uno solo para todo el sistema.
 *
 * Se conserva el nombre porque lo importan otros módulos, pero ya no es una constante propia:
 * es el mismo piso de Carmen. Cambiarlo se hace en `lib/negocios/tolerancia-saldo.ts`.
 */
export const RESIDUO_CONCILIACION_COP = TOLERANCIA_SALDO_COP

/**
 * ¿Está cuadrada la plata del cliente para cerrar el caso? Cada lado se mide con el
 * criterio que el sistema YA declaró para él, y son distintos a propósito:
 *
 *   - FALTANTE contra el HONORARIO (`precio_aprobado`), igual que el gate `saldo_cero`.
 *     La tarifa UPME no se exige aquí: su recaudo tiene su propio control aguas arriba
 *     (`saldo:handoff`), y en muchos casos el cliente le paga la tarifa DIRECTO a la
 *     UPME, así que nunca entra como cobro de SOENA. Exigirla convertiría ese flujo
 *     normal en una deuda inventada.
 *
 *   - EXCESO contra el VALOR A RECAUDAR (honorario + tarifa), igual que el gate
 *     `sobrepago_conciliado`. Cuando el cliente paga los dos componentes en un solo
 *     recaudo, la tarifa NO es plata de más: es el caso normal, no la excepción.
 *
 * Medirlo simétrico contra uno solo de los dos rompe por el otro lado. Medido contra
 * producción SOENA el 2026-08-04 sobre 223 negocios abiertos: la versión simétrica
 * (honorario + tarifa en ambos lados) destrababa 17 y RETENÍA 62 casos que hoy pasan,
 * la mayoría ya en Cita, Envío o Generación. Esta versión destraba 18 y retiene 0.
 *
 * Puro: no toca DB ni red.
 *
 * @param precioAprobado precio_aprobado del negocio = HONORARIO, en COP.
 * @param modelo         modelo de dinero (aporta la tarifa confirmada). null → sin tarifa.
 * @param recaudado      suma de cobros reales del negocio, en COP.
 */
export function descuadreConciliacion(
  precioAprobado: number,
  modelo: ModeloDinero | null,
  recaudado: number,
): DescuadreConciliacion {
  const honorario = Number.isFinite(precioAprobado) && precioAprobado > 0 ? precioAprobado : 0
  const rec = Number.isFinite(recaudado) && recaudado > 0 ? recaudado : 0
  const faltante = Math.max(0, Math.round(honorario - rec))
  const exceso = Math.max(0, Math.round(rec - valorARecaudar(honorario, modelo)))
  return {
    faltante,
    exceso,
    // Cada lado se compara contra el MISMO piso de materialidad que usan los demás gates.
    // `saldoCuadrado` mide valor absoluto y aquí los dos lados ya llegan positivos.
    hayDescuadre: !saldoCuadrado(faltante) || !saldoCuadrado(exceso),
  }
}

/**
 * Saldo del cliente CON SIGNO, para pintarlo en una lista: `> 0` le falta plata a
 * SOENA, `< 0` le sobra, `0` está cuadrado.
 *
 * Es `descuadreConciliacion` puesto en un solo número — no una resta propia. Hereda,
 * por lo tanto, su asimetría deliberada:
 *
 *   - FALTA contra el HONORARIO. Un cliente que le pagó la tarifa DIRECTO a la UPME no
 *     le debe nada a SOENA, y ese es un flujo normal, no una excepción. Medir el
 *     faltante contra honorario + tarifa lo convertía en deudor: medido el 2026-08-06,
 *     de 33 faltantes en producción 25 tenían un faltante idéntico a la tarifa y
 *     NINGUNO debía honorario.
 *   - SOBRA contra el VALOR A RECAUDAR. Cuando el cliente paga los dos componentes
 *     juntos, la tarifa no es plata de más: es el caso normal (arreglado en #214).
 *
 * Entre las dos varas hay una franja donde el saldo es 0 a propósito: ahí no se sabe
 * (ni importa para cobrar) cuánto de la tarifa entró por SOENA. Como `faltante` y
 * `exceso` nunca son positivos a la vez, la resta no tiene signo ambiguo.
 *
 * ⚠️ NO "simplificar" midiendo ambos lados contra la misma vara. Ya se midió: la
 * versión simétrica retenía 62 casos que hoy pasan (ver el gotcha de CLAUDE.md y #206).
 *
 * Puro: no toca DB ni red.
 *
 * @param precioAprobado precio_aprobado del negocio = HONORARIO, en COP.
 * @param modelo         modelo de dinero (aporta la tarifa confirmada).
 * @param recaudado      suma de cobros reales del negocio, en COP.
 */
export function saldoConciliacion(
  precioAprobado: number,
  modelo: ModeloDinero | null,
  recaudado: number,
): number {
  const { faltante, exceso } = descuadreConciliacion(precioAprobado, modelo, recaudado)
  return faltante - exceso
}
