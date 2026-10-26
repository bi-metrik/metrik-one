import 'server-only'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { enPeticionDeRuta } from '@/lib/actions/memo-de-ruta'
import { claveValida, jsonEstable, resultadoEsFalla } from './clave'

/**
 * Una server action que, si la misma intención llega dos veces, se ejecuta UNA.
 *
 * ## Por qué
 *
 * Una server action es un POST y Next no lo deduplica. La misma intención llega dos veces sin
 * que nadie la repita a propósito: Chromium reenvía solo un POST cuyo socket se cortó (medido el
 * 2026-10-06), «Reintentar» después de «No se confirmó», el doble toque, dos pestañas. Para un
 * comentario es una fila de más; para un pago, una factura, un correo o un WhatsApp, es algo que
 * no se deshace.
 *
 * ## Contrato
 *
 * - `clave` la genera el navegador por intención (`useIntencion`). Sin clave válida la acción
 *   corre como siempre: nada cambia para quien no la mande (una pestaña vieja, un script).
 * - La fila se identifica por acción + persona + clave + huella de los argumentos. Otra persona
 *   no puede leer el resultado de una clave ajena, y la misma clave con otros datos es otra
 *   intención.
 * - Primera llegada: reserva la fila (`en_curso`), ejecuta y guarda el resultado (`hecha`).
 * - Repetida y terminada: devuelve el resultado guardado SIN ejecutar.
 * - Repetida y en curso: espera a que la primera termine (hasta `esperaMaxMs`) y devuelve su
 *   resultado; si no termina, devuelve `enCurso()` (un aviso, nunca una segunda ejecución).
 * - Una reserva `en_curso` de más de 6 min es una ejecución que murió (el tope de una función
 *   es 300 s): la toma quien llegue y ejecuta. Lo que esa ejecución alcanzó a hacer lo cuidan
 *   las barreras propias de la acción, igual que hoy.
 * - Si el resultado es una FALLA (`{ error }`, `ok: false`, `success: false`) o la acción lanza,
 *   la reserva se suelta: un reintento con la misma clave vuelve a ejecutar.
 * - Sin la tabla (migración sin aplicar) o con la base caída en la reserva: corre sin
 *   protección y lo dice en el log. Proteger nunca puede impedir trabajar.
 *
 * ⚠️ El resultado se guarda como JSON: lo que devuelve la acción tiene que ser serializable,
 * que ya es requisito de toda server action.
 */

/** Lo mínimo del cliente de Supabase que se usa aquí (para poder probarlo con un doble). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = { from: (tabla: string) => any }

export interface OpcionesIdempotencia<T> {
  /** Nombre estable de la acción (`'addComment'`). Entra en la clave. */
  accion: string
  /** La clave de la intención que mandó el navegador. */
  clave: unknown
  /** Los argumentos de la acción, para la huella. */
  args: unknown
  /** Qué responder si la misma intención sigue en curso pasado `esperaMaxMs`. */
  enCurso: () => T
  /** Cuánto esperar a una primera ejecución que no ha terminado. Default 25 s. */
  esperaMaxMs?: number
  /** Inyectables para pruebas. */
  svc?: Cliente
  persona?: { usuarioId: string | null; workspaceId: string | null }
  dormir?: (ms: number) => Promise<void>
}

const TABLA = 'claves_idempotencia'
const VIGENCIA_MS = 24 * 60 * 60 * 1000
const PAUSA_MS = 300
/** Más que el tope de cualquier función del proyecto (300 s): pasado esto, la primera murió. */
const ABANDONADA_MS = 6 * 60 * 1000

let avisadoSinTabla = false

function sinTabla(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /claves_idempotencia/.test(error.message ?? '') && /exist|find/i.test(error.message ?? '')
}

export function claveEfectiva(accion: string, usuarioId: string | null, clave: string, args: unknown): string {
  const huella = createHash('sha256').update(jsonEstable(args)).digest('hex')
  return createHash('sha256').update(`${accion}|${usuarioId ?? '-'}|${clave}|${huella}`).digest('hex')
}

export async function accionIdempotente<T>(o: OpcionesIdempotencia<T>, ejecutar: () => Promise<T>): Promise<T> {
  if (!claveValida(o.clave)) return ejecutar()
  return enPeticionDeRuta(async () => {
    const persona = o.persona ?? (await personaDeLaSesion())
    const svc = o.svc ?? (createServiceClient() as unknown as Cliente)
    const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const clave = claveEfectiva(o.accion, persona.usuarioId, o.clave as string, o.args)
    const limite = Date.now() + (o.esperaMaxMs ?? 25_000)

    for (;;) {
      // 1. Reservar. La llave primaria decide quién es el primero: dos a la vez no pueden.
      const { error: errReserva } = await svc.from(TABLA).insert({
        clave,
        ambito: 'accion',
        nombre: o.accion,
        workspace_id: persona.workspaceId,
        usuario_id: persona.usuarioId,
        estado: 'en_curso',
        vence_at: new Date(Date.now() + VIGENCIA_MS).toISOString(),
      })

      if (!errReserva) return ejecutarYGuardar(svc, clave, o.accion, ejecutar)

      if (errReserva.code !== '23505') {
        if (sinTabla(errReserva)) {
          if (!avisadoSinTabla) {
            avisadoSinTabla = true
            console.warn(`[idempotencia] sin la tabla ${TABLA}: ${o.accion} corre sin protección (migración pendiente)`)
          }
        } else {
          console.error(`[idempotencia] no se pudo reservar ${o.accion}; corre sin protección:`, errReserva.message)
        }
        return ejecutar()
      }

      // 2. Ya existe: ¿terminó?
      const { data: fila, error: errLectura } = await svc
        .from(TABLA)
        .select('estado, resultado, creada_at')
        .eq('clave', clave)
        .maybeSingle()
      if (errLectura) {
        // No se sabe si la primera terminó. Ejecutar otra vez es justo lo que no se puede.
        console.error(`[idempotencia] no se pudo leer la reserva de ${o.accion}:`, errLectura.message)
        return o.enCurso()
      }
      if (fila?.estado === 'hecha') {
        console.info(`[idempotencia] ${o.accion}: intención repetida, se devuelve el resultado guardado`)
        return fila.resultado as T
      }
      // Una reserva vieja es una ejecución que murió a mitad (tope de la función): se toma.
      if (fila?.estado === 'en_curso' && fila.creada_at && Date.now() - Date.parse(fila.creada_at) > ABANDONADA_MS) {
        const { data: tomada } = await svc
          .from(TABLA)
          .update({ creada_at: new Date().toISOString() })
          .eq('clave', clave)
          .eq('estado', 'en_curso')
          .eq('creada_at', fila.creada_at)
          .select('clave')
        if (Array.isArray(tomada) && tomada.length > 0) {
          console.warn(`[idempotencia] ${o.accion}: la reserva anterior murió en curso; se ejecuta de nuevo`)
          return ejecutarYGuardar(svc, clave, o.accion, ejecutar)
        }
        continue
      }
      // `null`: la primera falló y soltó la reserva entre el insert y esta lectura → reintentar.
      if (fila && Date.now() >= limite) {
        console.warn(`[idempotencia] ${o.accion}: la misma intención sigue en curso`)
        return o.enCurso()
      }
      if (fila) await dormir(PAUSA_MS)
    }
  })
}

async function ejecutarYGuardar<T>(svc: Cliente, clave: string, accion: string, ejecutar: () => Promise<T>): Promise<T> {
  let resultado: T
  try {
    resultado = await ejecutar()
  } catch (e) {
    await soltar(svc, clave, accion)
    throw e
  }
  if (resultadoEsFalla(resultado)) {
    await soltar(svc, clave, accion)
    return resultado
  }
  const { error } = await svc
    .from(TABLA)
    .update({ estado: 'hecha', resultado: resultado === undefined ? null : resultado, terminada_at: new Date().toISOString() })
    .eq('clave', clave)
  if (error) console.error(`[idempotencia] ${accion} se ejecutó pero no se guardó su resultado:`, error.message)
  return resultado
}

async function soltar(svc: Cliente, clave: string, accion: string): Promise<void> {
  const { error } = await svc.from(TABLA).delete().eq('clave', clave)
  if (error) console.error(`[idempotencia] no se pudo soltar la reserva de ${accion}:`, error.message)
}

async function personaDeLaSesion(): Promise<{ usuarioId: string | null; workspaceId: string | null }> {
  const { userId, workspaceId } = await getWorkspace()
  return { usuarioId: userId ?? null, workspaceId: workspaceId ?? null }
}

/** Para pruebas: vuelve a avisar la falta de tabla. */
export function __reiniciarAvisoSinTabla(): void {
  avisadoSinTabla = false
}
