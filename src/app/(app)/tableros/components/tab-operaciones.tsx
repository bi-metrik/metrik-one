'use client'

/**
 * Operaciones: una pestana, dos preguntas del area.
 *
 * "Casos" es donde esta atascado el trabajo (foto de hoy, por etapa y seccional).
 * "Personas" es como le fue a cada quien (bono del mes, con navegador de mes).
 *
 * NO se apilan en scroll vertical, y eso es decision de diseno, no de espacio:
 * una es una foto de HOY y la otra un cierre MENSUAL. Una debajo de la otra
 * serian dos relojes distintos en la misma pantalla, y el numero de arriba
 * invitaria a leerse contra el de abajo. Con el selector, cada vista conserva su
 * propio control de tiempo y nadie los cruza sin querer.
 *
 * Con una sola vista disponible se muestra esa vista y no se dibuja selector: un
 * selector de un solo boton promete una alternativa que no existe.
 */

import { useState } from 'react'
import type { ProcesoSeccionalData } from '../types'
import type { OperacionesBonoData } from '../operaciones-types'
import type { VistaOperaciones } from '@/lib/tableros/pestanas'
import { TabProceso } from './tab-proceso'
import { TabOperacionesPersonas } from './tab-operaciones-personas'

// Paleta MeTRIK (tokens del manual de marca, no Tailwind generico).
const CARBON = '#1A1A1A'
const GRIS = '#6B7280'

const ETIQUETAS: Record<VistaOperaciones, string> = {
  casos: 'Casos',
  personas: 'Personas',
}

interface Props {
  /** Foto del proceso. Null cuando el workspace no tiene el modulo. */
  proceso: ProcesoSeccionalData | null
  /** Bono del mes. Null cuando el workspace no tiene el modulo. */
  personas: OperacionesBonoData | null
}

export function TabOperaciones({ proceso, personas }: Props) {
  // Las vistas se derivan de los datos que llegaron, la misma regla con la que
  // `pestanasDeTableros` decidio mostrar esta pestana.
  const vistas: VistaOperaciones[] = []
  if (proceso) vistas.push('casos')
  if (personas) vistas.push('personas')

  const [vista, setVista] = useState<VistaOperaciones>(vistas[0] ?? 'casos')
  const activa = vistas.includes(vista) ? vista : vistas[0]

  if (vistas.length === 0) return null

  return (
    <div>
      {vistas.length > 1 && (
        <div
          className="mb-5 flex gap-1 rounded-lg bg-gray-100 p-0.5"
          style={{ width: 'fit-content' }}
          role="tablist"
          aria-label="Vista de operaciones"
        >
          {vistas.map(v => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={activa === v}
              onClick={() => setVista(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                activa === v ? 'bg-white shadow-sm' : ''
              }`}
              style={{ color: activa === v ? CARBON : GRIS }}
            >
              {ETIQUETAS[v]}
            </button>
          ))}
        </div>
      )}

      {activa === 'casos' && proceso && <TabProceso data={proceso} />}
      {activa === 'personas' && personas && <TabOperacionesPersonas data={personas} />}
    </div>
  )
}
