import { Plus, Users } from 'lucide-react'

/** Cuántos avatares se ven antes del «+N» (y cuántos círculos de licencia libre). */
export const MAX_VISIBLES = 4

export interface PersonaLicencia {
  id: string
  nombre: string
  correo: string | null
}

/** «Alba Rosas» → «AR»; sin nombre, la primera letra del correo; sin nada, «·». */
export function iniciales(nombre: string, correo: string | null = null): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length >= 2) return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (correo?.trim()[0] ?? '·').toUpperCase()
}

const CIRCULO = 'grid size-7 shrink-0 place-items-center rounded-full ring-2 ring-card'

/**
 * El bloque de licencias del Resumen de `/suscripcion`: una fila compacta con quién ocupa cada
 * licencia (avatares) y cuántas quedan libres (círculos punteados que llevan a Usuarios).
 *
 * Sin barra de progreso ni color de advertencia: estar lleno está bien. Las personas son las
 * mismas que lista la pestaña Usuarios (`usados` = esa lista), así que no hay consulta propia.
 */
export function ResumenLicencias({
  usados,
  total,
  personas,
  onVerUsuarios,
}: {
  usados: number
  total: number
  personas: PersonaLicencia[]
  onVerUsuarios: () => void
}) {
  const visibles = personas.slice(0, MAX_VISIBLES)
  const ocultas = personas.length - visibles.length
  const libres = Math.max(0, total - usados)
  const libresVisibles = Math.min(libres, MAX_VISIBLES)
  const libresOcultas = libres - libresVisibles

  const verUsuarios = (
    <button
      type="button"
      onClick={onVerUsuarios}
      className="shrink-0 text-sm font-semibold text-acento hover:text-acento-hover dark:text-acento-claro"
    >
      Ver usuarios
    </button>
  )

  return (
    <section
      data-resumen-licencias
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground sm:grid-cols-[minmax(0,1fr)_auto_auto]"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-acento dark:text-acento-claro" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-5">Usuarios</h2>
          <p className="text-sm leading-[18px] text-muted-foreground" data-licencias-texto>
            <span className="font-mono">{usados}</span> de <span className="font-mono">{total}</span> en uso
          </p>
        </div>
      </div>

      {/* Móvil: «Ver usuarios» a la derecha del título y la pila debajo; desde sm, todo en una fila. */}
      <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">{verUsuarios}</div>

      <div
        role="img"
        aria-label={`${usados} de ${total} usuarios en uso`}
        data-pila-licencias
        className="col-span-2 flex items-center -space-x-1 sm:col-span-1 sm:col-start-2 sm:row-start-1"
      >
        {visibles.map((p) => (
          <span
            key={p.id}
            data-avatar-licencia
            title={p.nombre || p.correo || undefined}
            className={`${CIRCULO} bg-acento/10 text-[10px] font-semibold tracking-tight text-acento dark:bg-acento-claro/15 dark:text-acento-claro`}
          >
            {iniciales(p.nombre, p.correo)}
          </span>
        ))}
        {ocultas > 0 && (
          <span
            data-avatar-mas
            className={`${CIRCULO} bg-muted font-mono text-[11px] font-semibold text-muted-foreground`}
          >
            +{ocultas}
          </span>
        )}
        {Array.from({ length: libresVisibles }, (_, i) => (
          // El mismo destino que «Ver usuarios» (que es el acceso por teclado): aquí es solo atajo del puntero.
          <button
            key={`libre-${i}`}
            type="button"
            tabIndex={-1}
            aria-hidden
            data-licencia-libre
            onClick={onVerUsuarios}
            className={`${CIRCULO} border border-dashed border-border bg-card text-muted-foreground hover:text-card-foreground`}
          >
            <Plus className="size-3.5" />
          </button>
        ))}
        {libresOcultas > 0 && (
          <span
            data-licencia-libre-mas
            className={`${CIRCULO} border border-dashed border-border bg-card font-mono text-[11px] text-muted-foreground`}
          >
            +{libresOcultas}
          </span>
        )}
      </div>
    </section>
  )
}
