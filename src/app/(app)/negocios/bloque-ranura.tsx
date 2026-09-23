'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, BedDouble, Car, Check, Info, MoreHorizontal, Package, Plane, Plus, Ticket, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { agregarOpcionARanura } from '@/app/(app)/negocios/ranura-actions'
import { renombrarRanura } from '@/app/(app)/negocios/itinerario-actions'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { resolverRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import { NOMBRE_TIPO_BLOQUE } from '@/lib/cotizaciones/opcion-viaje'
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
 * ## Cada bloque dice su TIPO (P6 del caso Providencia)
 *
 * *«No hay una diferencia visible entre bloques»* (Mauricio). Cada bloque lleva tres cosas:
 * la franja de color a la izquierda (`--tipo-*` en `globals.css`), el ícono y el nombre del
 * tipo. El color nunca va solo: en el celular y para alguien con daltonismo no alcanza. Los
 * vuelos van numerados por el orden del viaje, con su ruta en códigos («Vuelo 1 · BOG →
 * ADZ»), y el nombre largo queda como subtítulo.
 *
 * ## «+ Opción» arriba
 *
 * Con tres opciones abiertas el botón de abajo quedaba lejos o fuera de la pantalla, y la
 * ayuda pegada al borde inferior parecía del bloque siguiente. Sube al encabezado, a la
 * derecha del título; la ayuda pasa a un (i) junto a «3 opciones. En cada tarifa entra una
 * sola.».
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
  titulo,
  estado,
  id,
  onEliminar,
  children,
}: {
  bloque: Pick<BloqueDeLineas<unknown>, 'grupo' | 'etiqueta' | 'tipo'> & { opciones: number }
  cotizacionId: string
  editable: boolean
  /** El destino del negocio: sugiere el nombre de una ranura que todavía no tiene. */
  destinoViaje?: string | null
  /** La opción recién creada, para abrirla y que se vea dónde pegar su pantallazo. */
  onOpcionCreada?: (itemId: string) => void
  /** «Vuelo 1 · BOG → ADZ». Ausente = el nombre de la ranura. */
  titulo?: string | null
  /** P7 · completo, o qué le falta. Ausente = no se pinta. */
  estado?: { completo: boolean; motivo: string | null } | null
  /** Para saltar al bloque desde el resumen del paso Componentes. */
  id?: string
  /**
   * P12 · borra la ranura entera con sus opciones. Lo decide y lo avisa el editor (cuántas
   * opciones, cuántas con costo, «Deshacer»). Ausente = el menú no se pinta.
   */
  onEliminar?: () => void
  children: ReactNode
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const inst = resolverRanura(bloque.grupo)
  const nombreGuardado = inst?.nombre ?? ''
  const [nombre, setNombre] = useState(nombreGuardado)
  const [nombreVisto, setNombreVisto] = useState(nombreGuardado)
  const [menuAbierto, setMenuAbierto] = useState(false)
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
  const clave = tipo ?? 'otro'
  const Icono = ICONO[clave]
  const ayuda =
    'Solo una opción entra al precio final. Las demás quedan para comparar. ' +
    'Un tramo adicional del mismo viaje no es una opción: va como componente aparte.'

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
      id={id}
      aria-label={`Ranura ${bloque.etiqueta}`}
      data-tipo-bloque={clave}
      className="rounded-xl border border-[#E5E7EB] bg-[#F5F4F2]/60 p-2.5"
      style={{ borderLeftWidth: 4, borderLeftColor: `var(--tipo-${clave})` }}
    >
      <header className="mb-2 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
              style={{ backgroundColor: `var(--tipo-${clave})` }}
            >
              <Icono className="h-3 w-3" aria-hidden />
              {NOMBRE_TIPO_BLOQUE[clave]}
            </span>
            <h3 className="truncate text-sm font-semibold text-[#1A1A1A]">{titulo || bloque.etiqueta}</h3>
            {estado && (estado.completo ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-[#10B981]">
                <Check className="h-3 w-3" aria-hidden /> Completo
              </span>
            ) : (
              <span
                className="inline-flex min-w-0 items-center gap-0.5 truncate rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                title={estado.motivo ?? undefined}
              >
                <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">Requiere atención{estado.motivo ? `: ${estado.motivo}` : ''}</span>
              </span>
            ))}
          </div>
          {/* El nombre largo, como subtítulo. Editarlo renombra la ranura entera. */}
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
              className="mt-0.5 w-full max-w-sm rounded border-0 bg-transparent px-1 py-0 text-[11px] text-[#6B7280] placeholder:text-[#9CA3AF] focus:bg-background focus:ring-1"
            />
          ) : (
            titulo && bloque.etiqueta && titulo !== bloque.etiqueta && (
              <p className="px-1 text-[11px] text-[#6B7280]">{bloque.etiqueta}</p>
            )
          )}
          <p className="flex items-center gap-1 px-1 text-[10px] text-[#6B7280]">
            {bloque.opciones === 1
              ? 'Una opción. Agrega otra para que las tarifas puedan escoger entre ellas.'
              : `${bloque.opciones} opciones. En cada tarifa entra una sola.`}
            <InfoTooltip text={ayuda}>
              <button type="button" aria-label={ayuda} className="inline-flex text-[#6B7280] hover:text-[#1A1A1A]">
                <Info className="h-3 w-3" />
              </button>
            </InfoTooltip>
          </p>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={agregarOpcion}
              disabled={isPending}
              title={`Agregar otra opción de ${etiquetaTipo}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium text-[#1A1A1A] hover:bg-accent disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              Opción
            </button>
            {onEliminar && (
              <div className="relative">
                <button
                  type="button"
                  aria-label={`Más acciones del bloque ${bloque.etiqueta}`}
                  aria-haspopup="menu"
                  aria-expanded={menuAbierto}
                  onClick={() => setMenuAbierto(m => !m)}
                  className="rounded p-1 text-[#6B7280] hover:bg-accent hover:text-[#1A1A1A]"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuAbierto && (
                  <div role="menu" className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-background p-1 text-xs shadow-md">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={isPending}
                      onClick={() => { setMenuAbierto(false); onEliminar() }}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Eliminar bloque
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      <div className="space-y-2 pl-1">{children}</div>
    </section>
  )
}

const ICONO: Record<TipoRanura | 'otro', typeof Plane> = {
  vuelo: Plane,
  hotel: BedDouble,
  traslado: Car,
  actividad: Ticket,
  otro: Package,
}
