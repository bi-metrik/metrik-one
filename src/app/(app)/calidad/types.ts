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

/**
 * Datos del muro proyectable. Tres zonas y nada mas: es lo que cabe en un
 * televisor y se lee a tres metros.
 *
 * La cobertura NO es el heroe. Una vez instalado el producto marca 100% todos
 * los dias: informa una vez y despues es constante. Lo que se mueve durante el
 * dia, y sobre lo que el piso puede actuar, son los cierres.
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
   * Zona 1 — el heroe. Cierres del dia partidos por forma de pago.
   *
   * `tarjeta` es caja: entra completo hoy. `cuenta` es una promesa a seis
   * cuotas, y si el cliente deja de pagar el servicio se suspende. Contar los
   * dos como "una venta" es el error del Excel que hoy se proyecta.
   */
  cierres: {
    total: number
    montoUsd: number
    llamadas: number
    /** Precio del programa segun los cierres del dia. Define "cobrado" en el pie. */
    montoUnitarioUsd: number
    tarjeta: { n: number; montoUsd: number }
    cuenta: { n: number; montoUsd: number; primeraCuotaUsd: number }
  } | null

  /**
   * Zona 2a — el ranking: el ACUMULADO del dia. Agentes por nombre de pila.
   *
   * `tarjeta` es la forma de pago en el dato, pero en pantalla se llama
   * "cobrado": lo que importa no es el instrumento sino que el dinero entro
   * completo hoy. "Tarjeta · 1 de 6" solo se entiende si ya sabes que tarjeta
   * significa cobro inmediato, y una pantalla que se mira de reojo no puede
   * pedir eso.
   */
  ranking: {
    agente: string
    cierres: number
    /** Cuantos de esos cierres se cobraron completos (forma de pago tarjeta). */
    tarjeta: number
    montoUsd: number
    llamadas: number
    semaforo: Semaforo
  }[]

  /**
   * Zona 2b — el flujo: lo que esta pasando AHORA.
   *
   * El ranking es el acumulado y no se mueve mucho durante el dia; esto si. Sin
   * duraciones (se leian como horas del dia al lado de la columna de hora), sin
   * apellidos y sin `cliente_ref`.
   */
  ultimas: {
    hora: string
    agente: string
    tecnica: number
    semaforo: Semaforo
    cerroVenta: boolean
  }[]

  /** Zona 3 — el pie. Discreto: contexto, no protagonismo. */
  pie: {
    recobro: {
      debitosRebotados: number
      pendientesRecobro: number
      montoEnRiesgoUsd: number
    } | null
    cobertura: { recibidas: number; auditadas: number; baseline: number; pct: number } | null
    banderaTop: { codigo: string; titulo: string; veces: number } | null
  }
}

export interface DineroCuota {
  cuota: number
  ventas: number
  vendidoUsd: number
  recaudadoUsd: number
}

export interface DuenoData {
  cuotas: DineroCuota[]
  vendidoTotal: number
  recaudadoTotal: number
  recaudoPct: number
  ventasCerradas: number
  llegaronCuota6: number
  criticasAbiertas: { codigo: string; titulo: string; veces: number }[]
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
