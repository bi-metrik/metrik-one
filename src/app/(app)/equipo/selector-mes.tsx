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
 */
export default function SelectorMesEquipo({ anio, mes }: { anio: number; mes: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pendiente, startTransition] = useTransition()

  function cambiarMes(delta: number) {
    const destino = mesConDelta(anio, mes, delta)
    // Los demas filtros de la URL se conservan: cambiar de mes no es reiniciar la vista.
    const params = new URLSearchParams(searchParams.toString())
    params.set('mes', paramMes(destino.anio, destino.mes))
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  return (
    <div className="mb-5 flex items-center gap-3">
      <button
        type="button"
        onClick={() => cambiarMes(-1)}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
        aria-label="Mes anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[9rem] text-center text-sm font-bold text-gray-900">
        {etiquetaMes(anio, mes)}
      </span>
      <button
        type="button"
        onClick={() => cambiarMes(1)}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
        aria-label="Mes siguiente"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {pendiente && <span className="text-xs text-gray-400">Actualizando...</span>}
    </div>
  )
}
