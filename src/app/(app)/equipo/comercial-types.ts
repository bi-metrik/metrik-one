// Tipos del tablero comercial de SOENA (negocios + responsable_id).
// Distinto de vendedores-types.ts (ese va sobre ventas_hechos / rentabilidad_comercial).

/** Fila de resumen por responsable. sin_responsable=true es el bucket "(sin responsable)". */
export interface ComercialResumenRow {
  responsable_id: string | null
  nombre: string
  position: string | null
  /**
   * Lidera el equipo (owner / admin / supervisor). Toma casos especiales, pero NO
   * compite en el ranking ni se mide con estos indicadores: comparar a quien reparte
   * el trabajo contra quien lo ejecuta no dice nada de ninguno de los dos. Sus casos
   * se muestran aparte para que la suma del equipo siga cuadrando.
   */
  es_lider: boolean
  sin_responsable: boolean
  negocios_total: number
  negocios_abiertos: number
  en_venta: number
  en_ejecucion: number
  en_cobro: number
  cerrados: number
  /** Ventas del negocio = negocios con >=1 pago de honorario recibido (venta = primer pago). */
  num_ventas: number
  /**
   * Ventas del periodo que ademas pasaron el umbral que declara la linea — la "venta
   * completa / bonificable" del punto #13. Es la metrica que premia el ranking (#31).
   *
   * `null` NO es cero: significa que la linea no declaro su umbral
   * (`config_extra.venta_bonificable.pasada_etapa_numero`) y por lo tanto no se pudo
   * medir. Un cero diria "no completo ninguna", que es una afirmacion distinta.
   */
  num_bonificables: number | null
  /**
   * Valor aprobado SIN IVA (base). Lo comercial se mide por el ingreso real: el IVA
   * se recauda para la DIAN y no es ingreso. Sale de `v_negocio_valor`, fuente unica
   * del desglose. Para la cifra que el cliente paga, `valor_aprobado_con_iva`.
   */
  valor_aprobado: number
  /** Valor aprobado CON IVA: lo que el cliente paga. Es la cifra de cartera. */
  valor_aprobado_con_iva: number
  /** Honorario recaudado = ingreso real (excluye tarifa UPME / pasante). Headline. */
  honorario_recaudado: number
  /** Tarifa UPME recaudada (pasante) = plata de terceros. Linea secundaria, aparte. */
  tarifa_recaudada: number
}

export interface ComercialPerfilKpis {
  negocios_total: number
  negocios_abiertos: number
  num_ventas: number
  /** SIN IVA (base): el ingreso real. Ver `ComercialResumenRow.valor_aprobado`. */
  valor_aprobado: number
  /** CON IVA: lo que el cliente paga. */
  valor_aprobado_con_iva: number
  honorario_recaudado: number
  tarifa_recaudada: number
  /**
   * Pendiente de recaudo del honorario, CON IVA (valor con IVA - honorario recaudado).
   * Es cartera: se compara contra plata que entra, que tambien lleva IVA. Por eso NO
   * es `valor_aprobado - honorario_recaudado`: esas dos cifras estan en bases distintas.
   */
  pendiente_honorario: number
  /** Negocios abiertos con SLA de etapa vencido. */
  vencidos: number
}

export interface ComercialPerfilStage {
  stage: string
  negocios: number
  valor_aprobado: number
  pendiente_honorario: number
}

/** Embudo por etapa/estatus con monto pendiente de recaudo. */
export interface ComercialPerfilEtapa {
  etapa_numero: number | null
  etapa_nombre: string
  stage: string | null
  negocios: number
  valor_aprobado: number
  pendiente_honorario: number
}

export interface ComercialPerfilNegocio {
  id: string
  codigo: string | null
  nombre: string | null
  stage: string | null
  estado: string | null
  etapa_nombre: string | null
  etapa_numero: number | null
  es_venta: boolean
  fecha_venta: string | null
  /** Fecha de entrada a la etapa actual (ultimo avance). etapa_cambiada_at. */
  ultimo_avance: string | null
  /** SLA de la etapa actual en horas habiles (null si la etapa no define SLA). */
  sla_horas: number | null
  /** 'a_tiempo' | 'vencido' | 'sin_sla'. */
  sla_estado: 'a_tiempo' | 'vencido' | 'sin_sla'
  /** SIN IVA (base). */
  valor_aprobado: number
  /** CON IVA: lo que el cliente paga. */
  valor_aprobado_con_iva: number
  honorario_recaudado: number
  tarifa_recaudada: number
  pendiente_honorario: number
}

/** Punto de la serie mensual del vendedor (ventas + recaudo). */
export interface ComercialPerfilSerie {
  anio: number
  mes: number
  label: string
  num_ventas: number
  valor_aprobado: number
  honorario_recaudado: number
}

export interface ComercialPerfil {
  responsable_id: string | null
  nombre: string
  position: string | null
  sin_responsable: boolean
  /** Periodo del perfil: null = acumulado; con anio+mes = ese mes. */
  anio: number | null
  mes: number | null
  kpis: ComercialPerfilKpis
  porStage: ComercialPerfilStage[]
  porEtapa: ComercialPerfilEtapa[]
  serie: ComercialPerfilSerie[]
  negocios: ComercialPerfilNegocio[]
}

/** Etiqueta legible por stage. */
export const STAGE_LABEL: Record<string, string> = {
  venta: 'En venta',
  ejecucion: 'En ejecucion',
  cobro: 'En cobro',
  cerrado: 'Cerrado',
}

// ── Iteracion 2: paridad Sheet SOENA (tabla por vendedor del mes, KPIs, series) ──

/** Fila de la tabla por vendedor del mes. Espeja el Sheet "INDICADORES DE VENTA". */
export interface ComercialVendedorMes {
  responsable_id: string | null
  nombre: string
  sin_responsable: boolean
  /** Lidera el equipo: se lista aparte, fuera de la comparacion. Ver ComercialResumenRow. */
  es_lider: boolean
  num_ventas: number
  /** Honorario sin IVA (ingreso limpio). Headline. */
  valor_sin_iva: number
  /** Honorario con IVA. Columna secundaria de paridad. */
  valor_con_iva: number
  primer_pago: number
  segundo_pago: number
  casos_completos: number
  tasa_casos_completos: number | null
  /** Ventas del mes que pasaron el umbral de la linea (#13). `null` = sin medir. */
  bonificables: number | null
  participacion_pct: number | null
  meta_num_ventas: number | null
  meta_valor: number | null
}

/** Panel de KPIs mensuales. */
export interface ComercialKpisMes {
  num_ventas: number
  valor_sin_iva: number
  valor_con_iva: number
  primer_pago: number
  segundo_pago: number
  honorario_recaudado: number
  tarifa_recaudada: number
  casos_completos: number
  tasa_casos_completos: number | null
  /**
   * ── Las TRES definiciones que el negocio distingue (punto #13) ──
   *
   * `num_ventas`      = entro dinero (definicion #12, la que aprobo el cliente).
   * `casos_completos` = el honorario recaudado cubre el aprobado. Es recaudo.
   * `bonificables`    = paso el umbral que declara la linea. Es la que bonifica.
   *
   * Miden cosas distintas y por eso viajan las tres. `bonificables` es `null` cuando
   * NINGUNA venta del mes se pudo medir (la linea no declaro umbral): la pantalla
   * pinta raya. `bonificable_sin_medir` dice cuantas de las `num_ventas` quedaron
   * fuera de la medicion, para que la tasa no se lea sobre un denominador que no es.
   */
  bonificables: number | null
  bonificable_sin_medir: number
  tasa_bonificables: number | null
  ticket_promedio: number
  mejor_dia: string | null
  mejor_dia_ventas: number
  promedio_ventas_dia: number
  ingreso_promedio_dia: number
  ventas_proyectadas: number
  n_perdidos: number
  tasa_cancelacion: number | null
  tasa_recaudo: number | null
  meta_num_ventas: number | null
  meta_valor: number | null
  cumplimiento_num: number | null
  cumplimiento_valor: number | null
}

/** Ventas de un dia del mes (para el grafico de ventas diarias). */
export interface ComercialVentaDia {
  dia: string
  ventas: number
}

export interface ComercialMesResponse {
  anio: number
  mes: number
  kpis: ComercialKpisMes
  porDia: ComercialVentaDia[]
  porVendedor: ComercialVendedorMes[]
}

/** Punto de la serie historica mensual. */
export interface ComercialSeriePunto {
  anio: number
  mes: number
  label: string
  num_ventas: number
  valor_sin_iva: number
  valor_con_iva: number
  honorario_recaudado: number
  primer_pago: number
  segundo_pago: number
  tarifa_recaudada: number
}

export interface ComercialSerieResponse {
  serie: ComercialSeriePunto[]
  tasa_recaudo_global: number | null
}

/** Fila de meta para la mini UI de edicion (staff_id null = meta global). */
export interface MetaComercial {
  id: string
  staff_id: string | null
  anio: number
  mes: number
  meta_num_ventas: number | null
  meta_valor: number | null
}

export const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

/**
 * Un caso detras de una cifra del tablero comercial.
 *
 * Sale de `get_comercial_ventas_mes_soena`, que consume la MISMA vista
 * (`v_venta_mes_comercial`) que produce la cifra. Ese es el punto: la lista no puede
 * contradecir al numero en el que se hizo clic.
 */
export interface ComercialVentaCaso {
  negocio_id: string
  codigo: string | null
  nombre: string
  estado: string | null
  responsable: string | null
  /** Dia en que entro el primer pago: es la definicion de venta que aprobo el cliente. */
  fecha_venta: string
  /** Dia en que el honorario quedo cubierto. `null` mientras el caso no este completo. */
  fecha_completado: string | null
  fecha_creacion: string
  /** Ultimo formulario llenado por el contacto. `null` si nunca registro interaccion. */
  ultima_conversion: string | null
  n_conversiones: number
  /**
   * De donde vino, en tres piezas que NO se colapsan en una.
   *
   * `origen_declarado` es lo que alguien escribio al crear el negocio (catalogo de
   * `ORIGENES_NEGOCIO`); puede ser null. `tiene_rastro_meta` es lo unico
   * verificable: hubo una interaccion de Meta del contacto. `campana` sale del
   * formulario de Meta.
   *
   * Los tres estados que la pantalla debe distinguir:
   *   · rastro + campana        -> atribuido
   *   · rastro sin campana      -> vino de Meta y no se pudo atribuir
   *   · sin rastro              -> sin rastro de Meta (NO es "no vino de Meta")
   */
  origen_declarado: string | null
  tiene_rastro_meta: boolean
  campana: string | null
  /** Lo declarado y el rastro no coinciden. Se muestra, no se corrige: decide comision. */
  atribucion_en_conflicto: boolean
  /**
   * El subconjunto del conflicto que mueve dinero HACIA AFUERA: se declaro promotor
   * (20% a un tercero) y el lead entro por Meta (16% de marketing). Mientras este en
   * true la comision NO se liquida — lo decide una persona, caso por caso (#46).
   */
  comision_retenida: boolean
  /**
   * Paso el umbral que declara la linea: es una venta bonificable (#13).
   * `null` = la linea no declaro umbral. NO es "no bonifica".
   */
  bonificable: boolean | null
  /**
   * Con que plan se cobra el honorario: 1 = 50/50 (hay segundo pago), 2 = 100%
   * anticipado (NO hay segundo pago, y eso es un dato). `null` = nadie lo declaro al
   * aprobar la propuesta, y entonces no se sabe si el segundo pago existe.
   *
   * Sin este dato, `segundo_pago: 0` se lee como "no ha pagado" cuando puede significar
   * "no tiene que pagar" o "no sabemos si tiene que pagar". Las tres frases son
   * distintas y solo el plan las separa.
   */
  plan_pago: number | null
  valor_sin_iva: number
  valor_con_iva: number
  recaudado: number
  primer_pago: number
  segundo_pago: number
  caso_completo: boolean
  /**
   * El caso figura completo pero NO tiene honorario aprobado, asi que el sistema comparo
   * su recaudo contra cero. Se marca en la lista en vez de esconderlo: es la unica forma
   * de que quien mira la cifra entienda por que ese caso esta ahi.
   */
  sin_honorario_aprobado: boolean
}

// ── Origen del lead y campana (punto #23 del inventario SOENA) ──────────────

/** Una fila del desglose por origen declarado. */
export interface ComercialOrigenFila {
  /** `null` = el negocio se creo sin declarar origen. Va en raya, no en "otro". */
  origen: string | null
  ventas: number
  valor_sin_iva: number
  recaudado: number
  /** De esas ventas, cuantas tienen rastro verificable de Meta. */
  con_rastro_meta: number
  /** De esas ventas, cuantas tienen la comision retenida por origen en disputa (#46). */
  comision_retenida: number
}

/** Una fila del desglose por campana de Meta. */
export interface ComercialCampanaFila {
  /** `null` = vino de Meta y la interaccion no trae campana. Es su propio estado. */
  campana: string | null
  ventas: number
  valor_sin_iva: number
  recaudado: number
}

/**
 * Desglose de las ventas del mes por origen y campana.
 *
 * Los tres conteos de arriba no son excluyentes con `por_origen`: son la lectura
 * honesta de la cobertura. `sin_rastro` NO significa "no vino de Meta" — significa
 * que no dejo huella en el sistema, que es lo unico que se puede afirmar.
 */
export interface ComercialOrigenMes {
  total: number
  con_rastro_meta: number
  sin_rastro: number
  /** Vino de Meta y aun asi no se le pudo poner campana. */
  meta_sin_campana: number
  /** Lo declarado y el rastro no coinciden. Decide la comision: se muestra. */
  en_conflicto: number
  /**
   * El subconjunto del conflicto que decide un pago a un TERCERO: promotor declarado
   * sobre un lead con rastro de Meta. Va aparte de `en_conflicto` porque son problemas
   * de gravedad distinta — el resto es atribucion interna, esto es plata que sale.
   */
  comision_retenida: number
  comision_retenida_valor: number
  por_origen: ComercialOrigenFila[]
  por_campana: ComercialCampanaFila[]
}

// ── Corte por seccional DIAN (puntos #22 y #43 del inventario SOENA) ────────

/**
 * Una seccional en el corte del mes.
 *
 * `seccional` es el nombre CANONICO (ya colapsado con `canonizarSeccional`), y `null`
 * es el bucket "sin registrar": va visible y en raya, nunca repartido entre las demas
 * ni escondido. Medido el 2026-08-22: 96 de 289 negocios de la linea no tienen
 * seccional, un tercio de la cartera — repartirlos inventaria una distribucion que
 * nadie midio.
 */
export interface ComercialSeccionalFila {
  seccional: string | null
  ventas: number
  valor_sin_iva: number
  valor_con_iva: number
  primer_pago: number
  segundo_pago: number
  recaudado: number
  casos_completos: number
  /** `null` = la linea no declaro umbral de bonificacion. No es cero. */
  bonificables: number | null
  /**
   * Los casos exactos que suman esta fila. El drill los abre tal cual, en vez de
   * recalcular el criterio: la lista no puede discrepar de la cifra por construccion.
   */
  negocio_ids: string[]
}

export interface ComercialSeccionalMes {
  /** Total del mes, el mismo `num_ventas` del panel. Sirve para cuadrar la suma. */
  total_ventas: number
  filas: ComercialSeccionalFila[]
}

// ── Corte por plan de pago ──────────────────────────────────────────────────

/**
 * Los dos planes con los que SOENA cobra el honorario, y el tercer grupo que no es un
 * plan: el de los negocios donde nadie lo declaro.
 *
 * Medido el 2026-08-22 sobre las 93 ventas historicas de la linea GIT EV/HEV: 8 son
 * plan 1, 77 son plan 2 y 8 no tienen plan declarado. De las 8 de plan 1 solo dos han
 * pagado su segundo 50% (V0025 y V0099, $425.000 cada una).
 */
export const PLAN_PAGO_LABEL: Record<number, string> = {
  1: 'Plan 1 · 50/50',
  2: 'Plan 2 · 100% anticipado',
}

/** Etiqueta corta para una insignia. `null` NO se traduce a un plan. */
export function planPagoLabel(plan: number | null): string {
  if (plan === null) return 'Plan sin declarar'
  return PLAN_PAGO_LABEL[plan] ?? `Plan ${plan}`
}

/**
 * Un plan de pago en el corte del mes.
 *
 * `plan_pago = null` es el grupo "sin declarar", que va aparte y NUNCA plegado a plan 2:
 * es justo el error que la vista cometia en silencio. `segundo_pago` es `null` fuera del
 * plan 1 — en plan 2 el tramo no existe y en "sin declarar" no se sabe si existe, y en
 * ninguno de los dos casos un $0 seria una medicion.
 */
export interface ComercialPlanPagoFila {
  plan_pago: number | null
  ventas: number
  valor_sin_iva: number
  valor_con_iva: number
  primer_pago: number
  /** Solo el plan 1 tiene segundo tramo. `null` = no existe o no se sabe si existe. */
  segundo_pago: number | null
  recaudado: number
  casos_completos: number
  /** `null` = la linea no declaro umbral de bonificacion. No es cero. */
  bonificables: number | null
  /** Los casos exactos que suman esta fila; el drill los abre tal cual. */
  negocio_ids: string[]
}

export interface ComercialPlanPagoMes {
  /** Total del mes, el mismo `num_ventas` del panel. Sirve para cuadrar la suma. */
  total_ventas: number
  filas: ComercialPlanPagoFila[]
}

/** Un punto de una serie de capacidad: cuantos hubo en ese mes en esa seccional. */
export interface CapacidadPunto {
  /** Nombre canonico; `null` = sin seccional registrada. */
  seccional: string | null
  /** 'YYYY-MM'. */
  mes: string
  n: number
}

/**
 * Cuanto puede procesar cada seccional por mes (punto #43).
 *
 * JD: "si en Bogota sacamos 18 citas al mes, el equipo comercial tiene cabida para 18
 * clientes de Bogota". Lo que importa es la capacidad POR SECCIONAL, no el total.
 *
 * ⚠️ Las cuatro series que pidio NO tienen el mismo respaldo, y el tipo lo refleja en
 * vez de dejar que la pantalla las pinte todas iguales:
 *
 *   · `citas` se fecha sola (la fecha de la cita ES el dato).
 *   · `certificaciones` sale del rastro de cambios de etapa, que NO cubre a todos:
 *     `certificaciones_cobertura` dice sobre cuantos casos habla realmente.
 *   · los certificados CON ERROR no tienen ni un registro (`errores_sin_fuente`), asi
 *     que esa serie no se dibuja: un cero se leeria como "calidad perfecta".
 *   · `finalizados` cuenta `estado = 'completado'`, que NO es la definicion #17
 *     (IVA devuelto o certificado entregado y sin saldo), todavia sin acordar.
 */
export interface CapacidadSeccional {
  desde: string
  hasta: string
  /** 'YYYY-MM' en que arranca el rastro de etapas. NO es "desde cuando es confiable". */
  rastro_etapas_desde: string | null
  /** Sobre cuantos casos habla de verdad la serie de certificaciones. */
  certificaciones_cobertura: { con_rastro: number; con_evidencia: number }
  /** No hay ni un reproceso registrado: la serie de errores no se dibuja. */
  errores_sin_fuente: boolean
  citas: CapacidadPunto[]
  certificaciones: CapacidadPunto[]
  finalizados: CapacidadPunto[]
}

/** Un negocio perdido del mes: lo que hay detras de la tasa de cancelacion. */
export interface ComercialPerdido {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  responsable: string | null
  fecha: string
  razon: string | null
  detalle: string | null
  etapa: string | null
  origen_declarado: string | null
  tiene_rastro_meta: boolean
  campana: string | null
}

/**
 * Un pago que entro en el mes, con la franja a la que se abono.
 *
 * Es la unidad de las DOS barras de recaudo del historico, y no es un negocio: un pago
 * de agosto puede abonarse a una venta de junio, asi que la lista de ventas del mes
 * nunca reconstruye esas barras. Por eso este tipo existe aparte de `ComercialVentaCaso`.
 *
 * `monto` es lo que entro a la cuenta; `honorario` (tramo 1 + tramo 2) es lo unico que
 * es ingreso propio. La diferencia es tarifa UPME —plata de terceros— o excedente.
 */
export interface ComercialPagoMes {
  cobro_id: string
  fecha: string
  monto: number
  honorario: number
  a_tramo1: number
  a_tramo2: number
  a_tarifa: number
  excedente: number
  negocio_id: string | null
  codigo: string | null
  nombre: string | null
  /** De que mes es la venta a la que se abona. NULL si el cobro no cuelga de un negocio. */
  fecha_venta: string | null
}
