'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import { agregarOpcionARanura } from '@/app/(app)/negocios/ranura-actions'
import { renombrarRanura } from '@/app/(app)/negocios/itinerario-actions'
import { resolverRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import { nombreAutomaticoDeRanura, type BloqueDeLineas, type TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'

/**
 * Una RANURA de la cotización, con sus opciones adentro (hallazgo 11 del ensayo del
 * 2026-09-23: «un bloque "Hotel en Cancún" y dentro sus alternativas»). Es lo que ya dibuja
 * la página 1 del documento del cliente, llevado a la pantalla donde se arma.
 *
 * Una línea SIN ranura (el recargo, «otro componente») no se envuelve: se pinta tal cual, en
 * su sitio. Por eso fuera del flujo de viaje —Termotech, Arca, WMC— esto es un fragmento y la
 * pantalla no cambia un nodo (R6).
 *
 * ## El nombre se edita aquí, y edita la ranura ENTERA
 *
 * Mismo camino que el encabezado de la columna en la tabla de tarifas (`renombrarRanura`):
 * mueve todas sus opciones a la vez. Renombrar una sola la partiría en dos ranuras y el total
 * las sumaría las dos.
 */
export default function BloqueRanura({
  bloque,
  cotizacionId,
  editable,
  destinoViaje,
  onOpcionCreada,
  children,
}: {
  bloque: Pick<BloqueDeLineas<unknown>, 'grupo' | 'etiqueta' | 'tipo'> & { opciones: number }
  cotizacionId: string
  editable: boolean
  /** El destino del negocio: sugiere el nombre de una ranura que todavía no tiene. */
  destinoViaje?: string | null
  /** La opción recién creada, para abrirla y que se vea dónde pegar su pantallazo. */
  onOpcionCreada?: (itemId: string) => void
  children: ReactNode
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const inst = resolverRanura(bloque.grupo)
  const nombreGuardado = inst?.nombre ?? ''
  const [nombre, setNombre] = useState(nombreGuardado)
  const [nombreVisto, setNombreVisto] = useState(nombreGuardado)
  // El nombre que llega del servidor manda cuando cambia (otro renombre, un refresco): se
  // ajusta al pintar, no en un efecto, para no pintar un cuadro con el dato viejo.
  if (nombreVisto !== nombreGuardado) {
    setNombreVisto(nombreGuardado)
    setNombre(nombreGuardado)
  }

  if (!bloque.grupo) return <>{children}</>

  const tipo = bloque.tipo as TipoRanura | null
  const etiquetaTipo = inst?.definicion.label.toLowerCase() ?? 'componente'
  const sugerido = tipo ? nombreAutomaticoDeRanura({ tipo, lugar: destinoViaje, destino: destinoViaje }) : ''

  function renombrar(valor: string) {
    if (valor.trim() === nombreGuardado) return
    startTransition(async () => {
      const r = await renombrarRanura(cotizacionId, bloque.grupo as string, valor)
      if (!r.success) {
        toast.error(r.error ?? 'No se pudo renombrar')
        setNombre(nombreGuardado)
        return
      }
      router.refresh()
    })
  }

  function agregarOpcion() {
    startTransition(async () => {
      const r = await agregarOpcionARanura(cotizacionId, bloque.grupo as string)
      if (!r.success) {
        toast.error(r.error)
        return
      }
      toast.success(`Otra opción en «${bloque.etiqueta}». Pégale su pantallazo: solo una entra en cada tarifa.`)
      onOpcionCreada?.(r.itemId)
      router.refresh()
    })
  }

  return (
    <section
      aria-label={`Ranura ${bloque.etiqueta}`}
      className="rounded-xl border border-[#E5E7EB] bg-[#F5F4F2]/60 p-2.5"
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0 flex-1">
          {editable && inst ? (
            <input
              value={nombre}
              placeholder={sugerido || `Nombre de este ${etiquetaTipo}`}
              aria-label={`Nombre de la ranura ${bloque.etiqueta}`}
              title="Renombra la ranura completa, con todas sus opciones"
              disabled={isPending}
              onChange={e => setNombre(e.target.value)}
              onBlur={e => renombrar(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className="w-full max-w-sm rounded border-0 bg-transparent px-1 py-0.5 text-sm font-semibold text-[#1A1A1A] placeholder:font-normal placeholder:text-[#6B7280] focus:bg-background focus:ring-1"
            />
          ) : (
            <h3 className="px-1 text-sm font-semibold text-[#1A1A1A]">{bloque.etiqueta}</h3>
          )}
          <p className="px-1 text-[10px] text-[#6B7280]">
            {bloque.opciones === 1
              ? `Una opción. Agrega otra para que las tarifas puedan escoger entre ellas.`
              : `${bloque.opciones} opciones. En cada tarifa entra una sola.`}
          </p>
        </div>
      </header>

      <div className="space-y-2 border-l-2 border-[#E5E7EB] pl-2">{children}</div>

      {editable && (
        <div className="mt-2 px-1">
          <button
            type="button"
            onClick={agregarOpcion}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs font-medium text-[#6B7280] hover:bg-accent disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            {`Agregar otra opción de ${etiquetaTipo}`}
          </button>
          {/* El apaño de la §6 del diseño, dicho donde se agrega la opción: el segundo tramo
              de un mismo viaje NO va aquí. Cargado como opción, la tarifa se queda con uno
              solo y el PDF sale sin el otro, con el precio incompleto y buen aspecto. */}
          <p className="mt-1 text-[10px] leading-relaxed text-[#6B7280]">
            Solo una opción entra al precio final. Las demás quedan para comparar.
            {' '}Un tramo adicional del mismo viaje no es una opción: va como componente aparte.
          </p>
        </div>
      )}
    </section>
  )
}
