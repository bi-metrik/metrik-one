'use client'

import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { etiquetaMes, mesConDelta, paramMes } from './mes-navegacion'

/**
 * Selector de mes de /equipo. Misma marca visual que el de la pestana Comercial de
 * Tableros (dos flechas y el mes al centro): no se invento otro, se reuso el que la
 * gente ya sabe usar.
 *
 * Lo que cambia es DONDE vive el estado. En Tableros el mes es estado del cliente y
 * cada bloque se vuelve a pedir por accion; aqui el mes viaja en la URL
 * (`?mes=YYYY-MM`), que ya era el contrato de esta pagina. Con eso: el link de un mes
 * se puede compartir, el boton "atras" del navegador funciona, y una sola navegacion
 * vuelve a pedir TODO lo del periodo (comercial y operaciones) desde el servidor, sin
 * un re-fetch a mano por bloque que se pueda quedar desincronizado.
 *
 * Manda sobre las dos pestanas, por eso se pinta arriba de ellas y no dentro de una.
 *
 * El perfil de una persona (`/equipo/comercial/[staff_id]`) reusa este mismo selector y
 * agrega una salida al historico (`?mes=acumulado`), que su RPC si sabe responder. En
 * acumulado las flechas quedan apagadas a proposito: no hay mes desde el cual moverse, y
 * dejarlas activas haria saltar a un mes que nadie eligio. `anio`/`mes` siguen llegando
 * (el mes de referencia, el que esta en curso) para poder volver a un mes en un clic.
 */
export default function SelectorMesEquipo({
  anio,
  mes,
  conAcumulado = false,
  enAcumulado = false,
  className = 'mb-5',
}: {
  anio: number
  mes: number
  /** La pantalla acepta `?mes=acumulado`: se pinta la salida al historico. */
  conAcumulado?: boolean
  /** El periodo activo ES el acumulado; `anio`/`mes` quedan como mes de referencia. */
  enAcumulado?: boolean
  /**
   * Separacion del bloque. En `/equipo` el selector va suelto arriba de las pestanas y
   * necesita su margen; en la cabecera del perfil comparte fila con el nombre, y ese
   * margen lo dejaria desalineado del titulo.
   */
  className?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pendiente, startTransition] = useTransition()

  function irAPeriodo(valor: string) {
    // Los demas filtros de la URL se conservan: cambiar de mes no es reiniciar la vista.
    const params = new URLSearchParams(searchParams.toString())
    params.set('mes', valor)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  function cambiarMes(delta: number) {
    const destino = mesConDelta(anio, mes, delta)
    irAPeriodo(paramMes(destino.anio, destino.mes))
  }

  const flechaClase = enAcumulado
    ? 'flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-300'
    : 'flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={() => cambiarMes(-1)}
        disabled={enAcumulado}
        className={flechaClase}
        aria-label="Mes anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[9rem] text-center text-sm font-bold text-gray-900">
        {enAcumulado ? 'Acumulado' : etiquetaMes(anio, mes)}
      </span>
      <button
        type="button"
        onClick={() => cambiarMes(1)}
        disabled={enAcumulado}
        className={flechaClase}
        aria-label="Mes siguiente"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {/* El boton dice a DONDE lleva, no donde se esta: un boton rotulado con el estado
          actual obliga a adivinar si al pulsarlo se entra o se sale de el. */}
      {conAcumulado && (
        <button
          type="button"
          onClick={() => irAPeriodo(enAcumulado ? paramMes(anio, mes) : 'acumulado')}
          className="rounded-full border border-[#E5E7EB] px-3 py-1 text-xs font-medium text-tinta-suave hover:border-tinta/30 hover:text-tinta"
        >
          {enAcumulado ? `Ver ${etiquetaMes(anio, mes)}` : 'Ver acumulado'}
        </button>
      )}
      {pendiente && <span className="text-xs text-gray-400">Actualizando...</span>}
    </div>
  )
}
