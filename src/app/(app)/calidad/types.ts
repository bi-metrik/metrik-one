/**
 * Tipos del modulo de calidad de llamadas.
 *
 * Dos ejes que NO se promedian y que el tipo mantiene separados a proposito:
 *   - tecnica:      `puntaje_tecnico` 0-100, desglosado en `bloques`.
 *   - cumplimiento: `semaforo` + `banderas`.
 * Una llamada de 81 de tecnica puede estar en rojo. Fundirlos en un solo numero
 * borraria justamente lo que la muestra quiere hacer ver.
 */

export type Semaforo = 'verde' | 'amarillo' | 'rojo'
export type Severidad = 'critica' | 'alta' | 'media'
export type Direccion = 'entrante' | 'saliente'

/**
 * Lo que la lista necesita para no mentir: las filas del periodo, sus KPIs
 * calculados sobre el periodo COMPLETO (no sobre la pagina) y el tope
 * declarado, para poder decir cuantas se muestran de cuantas.
 */
export interface ListaLlamadas {
  /** Inicio del periodo, `YYYY-MM-DD` en hora de Bogota. */
  desde: string
  /** Fin del periodo: la fecha actual. Los dias sembrados por delante no salen. */
  hasta: string
  dias: number
  /** Llamadas del periodo. */
  total: number
  /** Cuantas se devolvieron: `total` si cabe, el tope si no. */
  mostradas: number
  kpis: {
    llamadas: number
    rojo: number
    amarillo: number
    verde: number
    tecnica: number
  }
  filas: LlamadaResumen[]
}

export interface LlamadaResumen {
  id: string
  /** Identificador opaco. La tabla no guarda el nombre del cliente final. */
  clienteRef: string
  /** Marca de tiempo con la que la llamada se lista y se agrupa por dia. */
  fechaHora: string
  /**
   * Fecha y hora VERDADERAS de la grabacion auditada. null en datos de
   * demostracion. En un workspace de muestra `fechaHora` se ancla al dia en
   * curso para que el muro tenga contenido; esto no se mueve nunca.
   */
  fechaGrabacion: string | null
  direccion: Direccion
  duracionSeg: number
  agenteNombre: string
  puntajeTecnico: number
  semaforo: Semaforo
  /** true = tiene transcripcion auditada → hay pantalla de detalle. */
  detalleCompleto: boolean
  /** false = dato de demostracion. Se rotula de forma permanente. */
  esReal: boolean
  /** Codigos de bandera de la llamada, ordenados: C1 C2 C4… */
  codigos: string[]
  criticas: number
}

export interface BloqueTecnica {
  orden: number
  nombre: string
  puntaje: number
  puntajeMax: number
}

export interface Hallazgo {
  id: string
  codigo: string
  severidad: Severidad
  titulo: string
  hecho: string | null
  cita: string | null
  segundo: number
  turnoRef: string | null
}

/** Punto de la cinta temporal que no levanta bandera. */
export interface EventoCinta {
  id: string
  titulo: string
  segundo: number
}

export interface LlamadaDetalle extends LlamadaResumen {
  hablaAgentePct: number | null
  hablaClientePct: number | null
  turnos: number | null
  repreguntas: number | null
  monologos45s: number | null
  bloques: BloqueTecnica[]
  banderas: Hallazgo[]
  eventos: EventoCinta[]
}

export type Periodo = 'dia' | 'semana' | 'mes'

/** Como se titula cada temporalidad y de que rango habla, dicho en pantalla. */
export const PERIODO_LABEL: Record<Periodo, string> = {
  dia: 'Ranking día',
  semana: 'Ranking semana',
  mes: 'Ranking mes',
}

export const PERIODO_RANGO: Record<Periodo, string> = {
  dia: 'hoy',
  semana: 'últimos 7 días',
  mes: 'últimos 30 días',
}

/**
 * Titulo del ENCABEZADO, que desde v6 tambien rota.
 *
 * Antes decia siempre "HOY" mientras la tabla mostraba el mes: quien miraba
 * veia el mes abajo y el dia arriba sin saber cual estaba leyendo.
 */
export const PERIODO_TITULO: Record<Periodo, string> = {
  dia: 'HOY',
  semana: 'ÚLTIMOS 7 DÍAS',
  mes: 'ÚLTIMOS 30 DÍAS',
}

/** Coletilla de la banda: "lo que más se repite HOY / EN LA SEMANA / EN EL MES". */
export const PERIODO_BANDA: Record<Periodo, string> = {
  dia: 'hoy',
  semana: 'en la semana',
  mes: 'en el mes',
}

/**
 * Una fila del ranking. Los DOS EJES de la rubrica, separados:
 *
 *   - `tecnica`  — promedio de puntaje del periodo, 0-100. Como ejecuta la venta.
 *   - `banderas` — CONTEO de errores criticos del periodo. A que expone a la
 *     empresa. Es conteo y no promedio a proposito: un error critico no se
 *     promedia con nada, y el promedio de una falla grave con muchas llamadas
 *     limpias la hace desaparecer.
 *
 * Son independientes y por eso van en columnas distintas. Un semaforo unico
 * (que era lo que habia hasta v4) los fundia y, agregado a un dia entero,
 * dejaba a casi todos en rojo: una columna donde todos valen lo mismo no
 * ordena, solo ocupa espacio.
 */
export interface FilaRanking {
  agente: string
  llamadas: number
  cierres: number
  pctCierre: number
  tecnica: number
  banderas: number
}

/**
 * Umbrales de color, calculados del propio dato: son los terciles (p33/p67) del
 * equipo EN ESE PERIODO, no numeros escritos a mano en el componente.
 *
 * Un umbral fijo ("tecnica bajo 70 es mala") es una opinion sobre una operacion
 * que no conocemos. Los terciles se auto-normalizan y siempre señalan el mejor
 * y el peor tercio. Si no hay dispersion (alta = baja) la pantalla no pinta
 * nada: no hay a quien señalar.
 */
export interface UmbralesRanking {
  tecnicaBaja: number
  tecnicaAlta: number
  banderasBaja: number
  banderasAlta: number
}

export interface RankingPeriodo {
  filas: FilaRanking[]
  umbrales: UmbralesRanking
}

/**
 * TODO lo agregado de un periodo, en un solo bloque.
 *
 * Es una sola fuente a proposito: si el heroe y el ranking se calcularan por
 * separado, en algun borde (zona horaria, limite del dia) darian numeros
 * distintos y la pantalla se contradiria a si misma sin que nadie pueda decir
 * cual de los dos miente.
 *
 * Las ULTIMAS LLAMADAS no estan aqui: son el pulso en vivo, no un agregado, y
 * no rotan.
 */
export interface BloquePeriodo {
  desde: string
  hasta: string

  /**
   * El heroe del periodo. Cierres partidos por forma de pago.
   *
   * `tarjeta` es caja: entra completo. `cuenta` es una promesa a seis cuotas, y
   * si el cliente deja de pagar el servicio se suspende. Contar los dos como
   * "una venta" es el error del Excel que hoy se proyecta.
   */
  cierres: {
    total: number
    montoUsd: number
    llamadas: number
    /** % de conversion: el numero que la operacion entiende. */
    pctCierre: number
    /** Precio del programa segun los cierres. Define "cobrado" en el pie. */
    montoUnitarioUsd: number
    tarjeta: { n: number; montoUsd: number }
    cuenta: { n: number; montoUsd: number; primeraCuotaUsd: number }
  } | null

  /**
   * Sello del encabezado. `baseline` es el contrafactual (lo que se auditaba a
   * mano) SUMADO en el periodo: 5 al dia son 150 en 30 dias. Sale del dato.
   */
  cobertura: { recibidas: number; auditadas: number; baseline: number; pct: number } | null

  /** Banda destacada: lo unico realmente accionable para el piso. */
  banderaTop: { codigo: string; titulo: string; veces: number } | null

  ranking: RankingPeriodo
}

/**
 * Datos del muro proyectable.
 *
 * Desde v6 el PERIODO manda sobre toda la pantalla: encabezado, cobertura,
 * heroe, banda y ranking salen del mismo bloque. Antes solo rotaba la tabla y
 * el resto se quedaba en el dia, asi que con "Ranking mes" abajo el encabezado
 * seguia diciendo "HOY" — el que miraba no sabia cual de los dos leer.
 */
export interface MuroData {
  /** Fecha EFECTIVA de los datos mostrados, no necesariamente la pedida. */
  fecha: string
  /**
   * true = el dia pedido no tenia actividad y esto es el ultimo dia con
   * llamadas. Red de seguridad para que el televisor nunca quede en blanco.
   */
  esFallback: boolean

  /**
   * Los tres periodos, en la MISMA respuesta. Re-consultar en cada giro haria
   * que la rotacion dependa de la red, y un fallo de fetch dejaria la pantalla
   * en blanco a mitad de ciclo.
   */
  periodos: Record<Periodo, BloquePeriodo>

  /**
   * El flujo: lo que esta pasando AHORA. NO rota — es el pulso en vivo, no un
   * agregado, y en vista de mes serian las mismas diez que en vista de dia.
   *
   * Sin duraciones (se leian como horas del dia al lado de la columna de hora),
   * sin apellidos y sin `cliente_ref`.
   */
  ultimas: {
    hora: string
    agente: string
    tecnica: number
    semaforo: Semaforo
    cerroVenta: boolean
  }[]
}

export interface DineroCuota {
  cuota: number
  /** Cuantas de las ventas a cuotas siguen pagando en esta cuota. */
  ventas: number
  /** Lo que deberia entrar: siempre el mismo sexto del total a cuotas. */
  esperadoUsd: number
  /** Lo que entra de verdad, ya descontado lo que rebota y no se recupera. */
  entraUsd: number
}

export interface DuenoData {
  /** Inicio del periodo, `YYYY-MM-DD` en Bogota. */
  desde: string
  /** Fin: la fecha actual. Mismo corte que el muro. */
  hasta: string
  dias: number
  /** US$799. Viaja desde la base para no quedar escrito en dos sitios. */
  precioUsd: number
  /**
   * Fraccion que se cae en CADA cuota, derivada del recobro real del periodo
   * (`pendientes_recobro / ventas`). No es una constante escrita a mano: si el
   * recobro mejora, la curva mejora sola. La calcula `calidad_reparto_cuotas`,
   * la misma funcion que reparte en el muro.
   */
  tasaCaida: number
  cuotas: DineroCuota[]
  ventasCerradas: number
  vendidoUsd: number
  /**
   * Pago completo al cierre. NO pasa por la curva de caida: esa plata ya
   * entro, y aplicarle el riesgo de los debitos exageraba el hueco con dinero
   * que ya estaba en la casa.
   */
  deUnaVez: { n: number; usd: number }
  /** Las que se exponen a la caida, cuota por cuota. */
  aCuotas: {
    n: number
    usd: number
    /** El sexto que se debe cobrar en cada cuota. */
    cuotaUsd: number
    /** Lo que entra de la primera cuota, ya descontado lo que rebota. */
    primeraCuotaUsd: number
    /** Lo que entra sumando las seis. */
    entraUsd: number
  }
  recaudadoUsd: number
  recaudoPct: number
  llegaronCuota6: number
  criticasAbiertas: { codigo: string; titulo: string; veces: number }[]
  /**
   * Debitos rebotados por fondos insuficientes. Vivia en el muro del piso y se
   * movio aqui: es cobranza, no operacion del dia. El muro responde "que esta
   * pasando ahora"; esto responde "cuanto se esta cayendo", que es pregunta de
   * dueno y va junto al recaudo a seis cuotas.
   */
  recobro: {
    hoy: { debitosRebotados: number; pendientesRecobro: number; montoEnRiesgoUsd: number } | null
    acumulado: { debitosRebotados: number; pendientesRecobro: number; montoEnRiesgoUsd: number }
    dias: number
  }
}

/**
 * Disclaimer obligatorio en toda pieza que muestre banderas. Fijado por el memo
 * legal de Emilio (2026-07-27): MeTRIK entrega observaciones sobre hechos
 * verificables en la grabacion, no dictamina derecho estadounidense.
 */
export const DISCLAIMER_BANDERAS =
  'Observaciones sobre hechos registrados en la grabación. No constituyen concepto jurídico sobre normativa de Estados Unidos.'

export const SEVERIDAD_LABEL: Record<Severidad, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Media',
}

export const SEMAFORO_LABEL: Record<Semaforo, string> = {
  verde: 'Verde',
  amarillo: 'Amarillo',
  rojo: 'Rojo',
}

/**
 * POSICION dentro de la grabacion, en mm:ss. 1497 → "24:57".
 *
 * Este formato es canonico y no se toca: la auditoria cita los minutos asi
 * ("el codigo de seguridad se pidio en 24:57") y el memo legal los reproduce
 * textualmente. Cambiarlo desalinearia la pantalla del documento.
 *
 * NO usar para duraciones — para eso esta `duracion()`.
 */
export function mmss(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * DURACION de una llamada, con unidad explicita. 3914 → "1 h 05 min".
 *
 * En mm:ss una llamada de 66 minutos se muestra "66:02", y al lado de una
 * columna de horas se lee como una hora del dia. La unidad quita la ambiguedad
 * sin obligar a leer dos veces.
 */
export function duracion(segundos: number): string {
  const h = Math.floor(segundos / 3600)
  const m = Math.floor((segundos % 3600) / 60)
  const s = segundos % 60
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`
  return `${s} s`
}

// ── Perfil de agente ────────────────────────────────────────────────────────

/**
 * Slug estable del agente para la URL. `Óscar Peñaloza` → `oscar-penaloza`.
 * Se normaliza sin acentos para que la URL no dependa de como venga escrito el
 * nombre en la fuente.
 */
export function slugAgente(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Una llamada como punto de la dispersion. */
export interface PuntoPerfil {
  id: string
  ref: string
  /** `YYYY-MM-DDTHH:MM` en hora de Bogota. */
  fecha: string
  dia: string
  tecnica: number
  semaforo: Semaforo
  cerroVenta: boolean
  /** true = tiene transcripcion auditada, o sea hay pantalla de detalle. */
  detalle: boolean
}

/**
 * Tendencia del score en el periodo.
 *
 * `t` es la pendiente dividida por su propio error estandar. Es lo que permite
 * decir "va al alza" sin inventarse un umbral: con |t| >= 2 la subida es mayor
 * que la dispersion del propio agente. Es `null` cuando no hay puntos
 * suficientes (menos de 3) — y en ese caso la pantalla lo dice, no rellena.
 */
export interface TendenciaPerfil {
  n: number
  porSemana: number | null
  t: number | null
  primeraMitad: number | null
  segundaMitad: number | null
}

/** Un bloque de la rubrica, promediado en el periodo. */
export interface BloquePerfil {
  orden: number
  nombre: string
  promedio: number
  maximo: number
  /** Puntos de score que quedan sobre la mesa en este bloque. */
  enJuego: number
  pctLogro: number
  llamadas: number
}

export interface PerfilAgente {
  agente: string
  desde: string
  hasta: string
  kpis: {
    llamadas: number
    tecnica: number
    cierres: number
    /** Lo vendido en esas llamadas. Misma fuente que el ranking del muro. */
    vendidoUsd: number
    pctCierre: number
    criticas: number
    verde: number
    amarillo: number
    rojo: number
  }
  puntos: PuntoPerfil[]
  tendencia: TendenciaPerfil
  /** Ya vienen ordenados por puntos en juego, de mayor a menor. */
  bloques: BloquePerfil[]
}

export type LecturaTendencia = 'alza' | 'baja' | 'estable' | 'sin_datos'

/**
 * Traduce la tendencia a una de cuatro lecturas.
 *
 * El corte es |t| >= 2 (≈95% de confianza), NO una cantidad de puntos. Un
 * umbral en puntos seria una opinion disfrazada: 3 puntos son mucho en un
 * agente parejo y ruido en uno errativo. Con el t, "al alza" significa que la
 * subida es mayor que la dispersion del propio agente — lo unico que se puede
 * afirmar sin inventar.
 *
 * `estable` no es un consuelo por no encontrar nada: es un hallazgo. Dice que
 * el agente rinde igual que hace un mes, que es informacion accionable para
 * quien entrena.
 */
export function leerTendencia(t: TendenciaPerfil): LecturaTendencia {
  if (t.n < 3 || t.t === null) return 'sin_datos'
  if (t.t >= 2) return 'alza'
  if (t.t <= -2) return 'baja'
  return 'estable'
}

/**
 * Que hacer para subir, por bloque. Es entrenamiento, no expediente: cada linea
 * dice una conducta concreta, no un juicio sobre la persona.
 *
 * El texto va atado al bloque de la rubrica, no al agente: quien salga bajo en
 * Escucha recibe el mismo consejo, porque el consejo es sobre la conducta. Lo
 * que cambia entre personas es CUALES aparecen y en que orden, y eso lo decide
 * su propio dato.
 */
export const COMO_SUBIR: Record<string, string> = {
  'Apertura e identificación':
    'Da nombre completo, empresa y motivo en los primeros treinta segundos, y confirma que hablas con el titular antes de avanzar.',
  Descubrimiento:
    'Antes de proponer, pregunta por la situación y deja que la responda: qué le está pasando, desde cuándo y qué ha intentado.',
  'Escucha y control':
    'Corta los monólogos: haz una pregunta cada dos minutos y repite con tus palabras lo que entendiste antes de seguir.',
  'Educación técnica':
    'Explica el qué y el cómo del servicio antes del precio, y comprueba que quedó claro pidiendo que lo repita.',
  'Propuesta y precio':
    'Presenta el precio completo de una vez, sin condicionarlo a cerrar hoy, y deja explícito qué incluye y qué no.',
  'Manejo de objeciones':
    'Cuando aparezca una objeción, pregunta antes de responder: qué le preocupa exactamente y por qué. Rebatir sin entender la refuerza.',
  'Cierre y próximos pasos':
    'Cierra diciendo qué pasa después, quién lo hace y cuándo, y confirma que la persona lo repite.',
}
