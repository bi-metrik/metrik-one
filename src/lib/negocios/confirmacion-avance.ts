/**
 * Confirmación antes de entregarle un caso a otra área.
 *
 * Hay etapas cuyo paso NO es un avance más: entrega el caso a un área distinta y el
 * equipo que lo traía deja de manejarlo. Cuando además el motor decide ese paso a
 * partir de un saldo, el aviso importa: **el saldo puede estar diciendo algo falso**.
 *
 * El caso que lo motivó (SOENA, 2026-08-13): tres casos entraron a Cobro en 46
 * segundos. Dos eran cartera legítima (plan 50/50, faltaba el tramo que se cobra al
 * éxito). El tercero mostraba $637.500 pendientes y en realidad **nunca tuvo un cobro
 * registrado**: su precio venía del cargue histórico. El comercial no se equivocó, el
 * sistema le mostró un saldo que no era cartera. Medido ese día: 110 negocios abiertos
 * más en la misma condición, por $71,7M.
 *
 * Por eso la confirmación **no regaña ni describe a la otra área como un problema**
 * (criterio de Carmen, CFO): eso le daría al comercial una razón para retener cartera
 * buena, que sale más caro que el ruido. Solo dice qué implica el paso y pide comprobar
 * una cosa concreta: que el saldo sea plata que el cliente NO pagó, y no un pago hecho
 * por otra vía que nadie registró.
 *
 * Opt-in por etapa DESTINO (`config_extra.confirmar_al_avanzar`). Sin esa clave ninguna
 * línea de ningún workspace cambia: no aparece ningún diálogo.
 */

/** Lo que la etapa destino declara en su `config_extra`. */
export interface ConfirmarAlAvanzarConfig {
  titulo?: unknown
  cuerpo?: unknown
  /** Se muestra solo si hay un faltante que mostrar. Admite `{saldo}`. */
  detalle_con_saldo?: unknown
  confirmar?: unknown
  cancelar?: unknown
}

/** Lo que la pantalla necesita para dibujar el diálogo. */
export interface ConfirmacionAvance {
  titulo: string
  /** Párrafos ya resueltos, en orden. */
  parrafos: string[]
  confirmar: string
  cancelar: string
}

const textoDe = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** Formato de moneda del producto (es-CO, sin decimales). */
export function formatearSaldo(valor: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(Math.round(valor))
}

/**
 * ¿La etapa destino exige confirmar antes de recibir el caso?
 *
 * Devuelve `null` cuando no hay nada que confirmar, y ese es el caso por defecto.
 *
 * El faltante entra ya calculado por quien llama (`descuadreConciliacion`, la misma
 * fuente que usan los gates de saldo). Reimplementar aquí la resta produciría una
 * segunda vara para la misma plata, que es el error que este repo ya pagó tres veces.
 * Si no hay faltante que mostrar, el párrafo de la cifra simplemente no se pinta: una
 * nota que dice "faltan $0" invita a ignorar la siguiente.
 */
export function confirmacionAvance(
  configExtraDestino: Record<string, unknown> | null | undefined,
  faltante: number | null,
): ConfirmacionAvance | null {
  const cfg = configExtraDestino?.confirmar_al_avanzar as ConfirmarAlAvanzarConfig | undefined
  if (!cfg || typeof cfg !== 'object') return null

  const titulo = textoDe(cfg.titulo)
  const cuerpo = textoDe(cfg.cuerpo)
  // Sin titulo ni cuerpo no hay nada que preguntar. Una config a medio escribir no debe
  // producir un dialogo vacio que el equipo aprenda a cerrar sin leer.
  if (!titulo || !cuerpo) return null

  const parrafos = [cuerpo]
  const detalle = textoDe(cfg.detalle_con_saldo)
  if (detalle && typeof faltante === 'number' && Number.isFinite(faltante) && faltante > 0) {
    parrafos.push(detalle.replaceAll('{saldo}', formatearSaldo(faltante)))
  }

  return {
    titulo,
    parrafos,
    confirmar: textoDe(cfg.confirmar) ?? 'Sí, pasar el caso',
    cancelar: textoDe(cfg.cancelar) ?? 'Cancelar',
  }
}
