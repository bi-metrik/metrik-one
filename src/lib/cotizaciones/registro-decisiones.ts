/**
 * El registro de decisiones de combinación (§3.2 y §3.2.1 del diseño).
 *
 * *«Sin esto no hay aprendizaje, solo una tabla más bonita.»* Cada vez que una
 * cotización sale al cliente se guarda, **por tarifa**, qué variante entró por cada
 * ranura, contra cuáles se eligió, por qué, en qué viaje y quién lo decidió. Es el
 * material con el que después aprende el motor (§3.4), y por eso se empieza a guardar
 * ANTES de que el motor exista: cuando exista, ya va a haber con qué medirlo.
 *
 * ## Las seis reglas de §3.2.1, y dónde vive cada una
 *
 * 1. **La propuesta nace vacía y no se inventa.** `propuesta` y `precio_propuesta` son
 *    literalmente `null` aquí (`armarFilasDeRegistro` no acepta ni un parámetro para
 *    llenarlos). No es descuido: *«un valor puesto por defecto es indistinguible de una
 *    propuesta real y el día que se mida al motor, se le estaría midiendo contra sí
 *    mismo.»* Cuando el motor exista, éste es el sitio donde escribirá.
 * 2. **Se registra cuando la cotización sale al cliente**, no en cada edición de la
 *    tabla. El disparo vive en `generateCotizacionPDF` — ver ahí el porqué de ese
 *    evento y no otro.
 * 3. **Una segunda salida agrega fila, no pisa la anterior.** Aquí no hay `upsert` ni
 *    llave única por tarifa: cada salida inserta. *«Si alguien reemite con otra
 *    combinación, ese cambio de opinión es exactamente la señal que interesa.»*
 * 4. **El contexto se congela, no se referencia.** Destino, fechas, composición,
 *    anticipación y las variantes que no entraron se COPIAN a la fila, con su nombre y
 *    su precio del momento. Una llave foránea devolvería los valores de hoy: si el
 *    viaje se corre dos semanas o alguien borra una variante, el registro pasaría a
 *    decir que se decidió contra algo que nunca estuvo ahí.
 * 5. **El motivo es opcional y nunca bloquea.** Vive en `motivo-combinacion.ts` y se
 *    captura en la tabla, donde se elige.
 * 6. **Queda escrito quién eligió**, con su id de staff y su nombre congelado.
 *
 * ## R6 — una cotización sin tarifas no escribe nada
 *
 * Sin tarifas que salgan al cliente, `armarFilasDeRegistro` devuelve `[]` y
 * `registrarSalidaAlCliente` no toca la base. Termotech, Arca y WMC no producen una
 * sola fila ni una sola consulta.
 */

import {
  itemsDelItinerario,
  ranurasConAlternativas,
  type ItemConGrupo,
} from './itinerarios'
import { etiquetaDeRanura } from './ranuras-pantallazo'
import { calcularCascada } from './totales'
import { cascadaDeItinerario } from './itinerarios'
import { normalizarMotivo } from './motivo-combinacion'
import type { ContextoCotizacion, FilaItinerario } from './itinerarios-datos'
import type { Composicion } from './tarifa-pasajero'

// ── El contexto del viaje, congelado ─────────────────────────────────────────

/**
 * Lo que rodeaba a la decisión. Números, no prosa: §3.4 propone agrupar por «mismo
 * destino, composición parecida», y eso no se puede hacer sobre «7 días / 6 noches».
 */
export interface ContextoViajeRegistrado {
  destino: string | null
  fecha_salida: string | null
  fecha_regreso: string | null
  /** Noches entre salida y regreso. `null` sin las dos fechas completas. */
  noches: number | null
  adultos: number | null
  ninos: number | null
  infantes: number | null
  pasajeros: number | null
  /** Días entre el día de la salida al cliente y la fecha de viaje. */
  dias_anticipacion: number | null
  /**
   * El día contra el que se midió la anticipación.
   *
   * Va guardado porque la anticipación es lo único del contexto que depende del reloj:
   * sin la fecha de referencia no se puede reconstruir ni auditar el número, y un
   * registro que no se puede auditar tampoco se puede corregir.
   */
  medido_el: string
}

/** `YYYY-MM-DD` completo, o `null`. Lo demás no sirve para restar días. */
function fechaCompleta(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

/**
 * Días enteros entre dos fechas `YYYY-MM-DD`. `null` si alguna no es completa.
 *
 * Se resta en UTC a mediodía para que el resultado no dependa de la zona del runtime:
 * un `new Date('2026-10-01')` se lee como UTC y en Bogotá cae el día anterior, que es
 * el defecto que este repo ya documenta para las fechas de los recibos.
 */
export function diasEntre(desde: string | null, hasta: string | null): number | null {
  const a = fechaCompleta(desde)
  const b = fechaCompleta(hasta)
  if (!a || !b) return null
  const ta = Date.parse(`${a}T12:00:00Z`)
  const tb = Date.parse(`${b}T12:00:00Z`)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null
  return Math.round((tb - ta) / 86_400_000)
}

/** Lo que hace falta del viaje. La forma que devuelve `leerViajeDelNegocio`. */
export interface ViajeParaContexto {
  destino: string | null
  fechas: { inicio: string | null; fin: string | null }
  composicion: Composicion | null
}

/**
 * El contexto del viaje, listo para congelar.
 *
 * ⚠️ `hoyISO` entra por PARÁMETRO y no se lee del reloj aquí. Es la misma decisión que
 * el criterio de vigencia de documentos: una marca por salida, igual para las tres
 * tarifas, y una función que se puede probar sin congelar el reloj global. Si cada
 * fila llamara al reloj por su cuenta, tres tarifas emitidas a medianoche podrían
 * quedar con dos anticipaciones distintas.
 *
 * ⚠️ Una anticipación NEGATIVA se guarda tal cual. Un viaje que ya salió y se recotiza
 * es un caso real; redondearlo a cero o a nulo escondería justo el caso raro.
 */
export function contextoDelViaje(
  viaje: ViajeParaContexto | null,
  hoyISO: string,
): ContextoViajeRegistrado {
  const salida = fechaCompleta(viaje?.fechas.inicio ?? null)
  const regreso = fechaCompleta(viaje?.fechas.fin ?? null)
  const c = viaje?.composicion ?? null
  return {
    destino: (viaje?.destino ?? null) || null,
    fecha_salida: salida,
    fecha_regreso: regreso,
    noches: diasEntre(salida, regreso),
    adultos: c ? c.adultos : null,
    ninos: c ? c.ninos : null,
    infantes: c ? c.infantes : null,
    pasajeros: c ? c.adultos + c.ninos + c.infantes : null,
    dias_anticipacion: diasEntre(hoyISO, salida),
    medido_el: hoyISO,
  }
}

// ── Las variantes, congeladas con su nombre y su precio ──────────────────────

/** Una variante de una ranura, tal como estaba el día de la salida. */
export interface VarianteRegistrada {
  /** El `items.grupo` crudo: «vuelo 2: san andrés a providencia». */
  ranura: string
  /** Cómo se llamaba en pantalla: «Vuelo 2 · San Andrés a Providencia». */
  etiqueta: string
  /** `true` si abre columna en la tabla (vuelo y hotel). Ver `ranurasCombinables`. */
  combinable: boolean
  item_id: string
  nombre: string | null
  /** Precio de esa línea, el mismo que imprime el PDF. `null` si no se pudo calcular. */
  precio: number | null
}

/** La fila que se inserta. Nombres en `snake_case`: van derecho a la tabla. */
export interface FilaDecision {
  workspace_id: string
  cotizacion_id: string
  negocio_id: string | null
  itinerario_id: string
  tarifa_nombre: string | null
  elegida: VarianteRegistrada[]
  precio_elegida: number
  costo_elegida: number
  margen_elegida_pct: number | null
  /** R1 · SIEMPRE null hoy: no hay motor. No se rellena con nada calculado. */
  propuesta: null
  precio_propuesta: null
  propuesta_origen: null
  descartadas: VarianteRegistrada[]
  motivo_codigo: string | null
  motivo_texto: string | null
  contexto: ContextoViajeRegistrado
  decidido_por: string | null
  decidido_por_nombre: string | null
  salida_at: string
}

export interface QuienDecidio {
  staffId: string | null
  nombre: string | null
}

/**
 * Las filas de UNA salida al cliente: una por tarifa.
 *
 * `filas` son las tarifas que efectivamente salen (las marcadas `va_en_propuesta`).
 * Una tarifa armada que nadie marcó no llegó al cliente y no se registra: R2 dice que
 * se guarda cuando la cotización sale, no cada vez que alguien mueve la tabla.
 *
 * ⚠️ El precio de cada variante sale de UNA sola cascada sobre todos los ítems. Se
 * puede hacer porque el precio de una línea no depende de qué otras líneas la
 * acompañen —los administrativos se reparten proporcionales al costo, que es la
 * propiedad que documenta `totales.ts`—. Calcularlo por itinerario daría el mismo
 * número y una cascada por tarifa.
 */
export function armarFilasDeRegistro(args: {
  workspaceId: string
  cotizacionId: string
  negocioId: string | null
  ctx: ContextoCotizacion
  filas: FilaItinerario[]
  contexto: ContextoViajeRegistrado
  quien: QuienDecidio
  salidaAt: string
}): FilaDecision[] {
  const { ctx, filas } = args
  if (filas.length === 0) return []

  const cascada = calcularCascada(ctx.items, ctx.params)
  // ⚠️ `precioConAdicionales`, no `precioLinea`: lo que se guarda es **el precio que se le
  // mostró al cliente**, y una variante con maleta extra se le mostró con la maleta
  // adentro. Con el base, el precio congelado de Avianca-con-maleta sería idéntico al de
  // Avianca-sin-maleta y la comparación que este registro existe para permitir se
  // volvería ciega justo en el caso que la motivó. `precio_elegida` no necesita cambio:
  // sale de la cascada del itinerario, que ya suma los adicionales de lo que incluye.
  const precioDe = new Map(cascada.lineas.map(l => [l.id ?? '', l.precioConAdicionales]))
  const nombreDe = new Map(ctx.items.map(i => [i.id, i.nombre]))
  const ranuras = ranurasConAlternativas(ctx.items as ItemConGrupo[])

  return filas.map(fila => {
    const dentro = new Set(itemsDelItinerario(ctx.items, fila.seleccion))
    const elegida: VarianteRegistrada[] = []
    const descartadas: VarianteRegistrada[] = []

    for (const r of ranuras) {
      const etiqueta = etiquetaDeRanura(r.grupo)
      for (const id of r.candidatos) {
        const variante: VarianteRegistrada = {
          ranura: r.grupo,
          etiqueta,
          combinable: r.combinable,
          item_id: id,
          nombre: nombreDe.get(id) ?? null,
          precio: precioDe.get(id) ?? null,
        }
        if (dentro.has(id)) elegida.push(variante)
        else descartadas.push(variante)
      }
    }

    const suya = cascadaDeItinerario(ctx.items, fila.seleccion, ctx.params)
    const motivo = normalizarMotivo(fila.motivoCodigo, fila.motivoTexto)

    return {
      workspace_id: args.workspaceId,
      cotizacion_id: args.cotizacionId,
      negocio_id: args.negocioId,
      itinerario_id: fila.id,
      tarifa_nombre: fila.nombre,
      elegida,
      precio_elegida: suya.precioVenta,
      costo_elegida: suya.costoDeVenta,
      margen_elegida_pct: suya.margenRealPct,
      // R1 · la propuesta nace nula. No hay motor, así que no hay nada que comparar.
      propuesta: null,
      precio_propuesta: null,
      propuesta_origen: null,
      descartadas,
      motivo_codigo: motivo.codigo,
      motivo_texto: motivo.texto,
      contexto: args.contexto,
      decidido_por: args.quien.staffId,
      decidido_por_nombre: args.quien.nombre,
      salida_at: args.salidaAt,
    }
  })
}

// ── La escritura ─────────────────────────────────────────────────────────────

/** La tabla que crea la migración pendiente. */
export const TABLA_DECISIONES = 'decisiones_combinacion'

/**
 * ¿El insert falló porque la tabla todavía no existe?
 *
 * Hermana de `faltanLasTablasDeItinerarios`, y por el mismo motivo: el deploy va ANTES
 * que el SQL, así que este caso es **esperado** durante la ventana y merece un aviso
 * distinto de un defecto real. Se exige que el mensaje nombre la tabla: sin eso, un
 * `42P01` de otra cosa se leería como «falta la migración» y el defecto real quedaría
 * invisible.
 */
export function faltaLaTablaDeDecisiones(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false
  const codigo = error.code ?? ''
  if (codigo !== '42P01' && codigo !== 'PGRST205') return false
  return (error.message ?? '').toLowerCase().includes(TABLA_DECISIONES)
}

export interface ResultadoRegistro {
  registradas: number
  /** `null` si no hubo nada que hacer o si salió bien. */
  error: string | null
  /** `true` cuando el fallo es «la migración todavía no está aplicada». */
  faltaMigracion: boolean
}

// El cliente de Supabase llega sin tipar: `decisiones_combinacion` no está en los tipos
// generados (la migración es pendiente) y nombrarla con el cliente tipado no compila.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

/**
 * Escribe las filas. **Nunca lanza, nunca bloquea.**
 *
 * *«Una cotización que no se puede emitir porque no pudo guardar una fila de
 * aprendizaje es el peor intercambio posible.»* El documento ya existe cuando esto
 * corre; lo único que puede pasar aquí es que se pierda una fila de registro, y eso se
 * reporta por consola en vez de convertir una emisión buena en un error.
 *
 * ⚠️ Se escribe con el cliente de SERVICIO, que no pasa por RLS. Por eso
 * `workspace_id` sale de la sesión (`getWorkspace`) y nunca de un parámetro del
 * navegador: la tabla guarda precios de proveedor y un id equivocado los metería en el
 * inquilino de otro.
 */
export async function registrarSalidaAlCliente(
  service: Supabase,
  filas: FilaDecision[],
): Promise<ResultadoRegistro> {
  if (filas.length === 0) return { registradas: 0, error: null, faltaMigracion: false }
  try {
    const { error } = await service.from(TABLA_DECISIONES).insert(filas)
    if (error) {
      const falta = faltaLaTablaDeDecisiones(error)
      if (falta) {
        console.warn(
          `[registro-decisiones] ${filas.length} decisiones no se guardaron: falta aplicar `
          + `la migración de ${TABLA_DECISIONES}. La cotización salió igual.`,
        )
      } else {
        console.error('[registro-decisiones] no se pudo registrar la salida:', error.message)
      }
      return { registradas: 0, error: error.message ?? 'error desconocido', faltaMigracion: falta }
    }
    return { registradas: filas.length, error: null, faltaMigracion: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[registro-decisiones] no se pudo registrar la salida:', msg)
    return { registradas: 0, error: msg, faltaMigracion: false }
  }
}
