'use client'

import { useState } from 'react'

import { gruposCanonicos, ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'

/**
 * El grupo de una línea, elegido de una lista en vez de tecleado a ciegas.
 *
 * ## El defecto que corrige
 *
 * El campo era un `<input type="text">` con un `datalist` construido con **los grupos
 * que ya se usaron en esta cotización**. En una cotización nueva ningún ítem tiene
 * grupo, así que el desplegable salía con **cero opciones** (medido: 0 `<option>`) y
 * quien cotiza veía una casilla de texto sin nada que elegir ni pista de que la
 * palabra exacta importa. Escribir «Hotel Occidental» o «hoteles» deja la línea sin
 * ranura de captura y no falla en ninguna parte.
 *
 * ## Por qué la lista sale del registro y no de la pantalla
 *
 * Los cuatro componentes canónicos vienen de `ranuras-pantallazo.ts`, que es el mismo
 * archivo que decide qué contrato aplica al pantallazo. Una lista propia aquí sería
 * una segunda fuente para la misma decisión, y el día que se separen el grupo quedaría
 * escrito, la tabla de combinaciones lo respetaría, y el pantallazo no encontraría
 * contrato — sin un solo error.
 *
 * ## El texto libre NO desaparece
 *
 * El método día a día (`dia-1`, `dia-2`, §2.5) y los componentes propios («seguro»,
 * «propina») son grupos legítimos sin ranura de captura. Por eso queda «Otro», y por
 * eso los grupos ya usados en la cotización siguen ofreciéndose: quitarlos volvería
 * imposible una de las dos metodologías que el motor soporta.
 */
export default function SelectorRanura({
  valor,
  gruposEnUso,
  disabled,
  onCambio,
}: {
  valor: string | null
  /** Grupos que ya existen en esta cotización (incluye los libres, tipo `dia-1`). */
  gruposEnUso: string[]
  disabled?: boolean
  onCambio: (grupo: string) => void
}) {
  const canonicos = gruposCanonicos()
  const esCanonico = (g: string) => canonicos.some(c => c.grupo === g)
  const actual = (valor ?? '').trim()

  // Los grupos libres de la cotización, sin repetir los canónicos ni el actual.
  const libres = [...new Set(gruposEnUso.map(g => g.trim()).filter(Boolean))]
    .filter(g => !esCanonico(g))

  const actualEsLibre = actual !== '' && !esCanonico(actual)
  const [modoLibre, setModoLibre] = useState(false)

  const ranura = ranuraDeGrupo(actual)

  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
        Grupo (alternativas)
      </label>

      <select
        value={modoLibre ? '__otro__' : actualEsLibre ? actual : actual}
        disabled={disabled}
        aria-label="Grupo de la línea"
        className="w-full rounded border bg-background px-2 py-1.5 text-sm"
        onChange={e => {
          const v = e.target.value
          if (v === '__otro__') { setModoLibre(true); return }
          setModoLibre(false)
          if (v !== actual) onCambio(v)
        }}
      >
        <option value="">Sin grupo · entra en todos</option>
        <optgroup label="Componentes del viaje">
          {canonicos.map(c => (
            <option key={c.grupo} value={c.grupo}>{c.label}</option>
          ))}
        </optgroup>
        {libres.length > 0 && (
          <optgroup label="Ya en esta cotización">
            {libres.map(g => <option key={g} value={g}>{g}</option>)}
          </optgroup>
        )}
        <option value="__otro__">Otro…</option>
      </select>

      {modoLibre && (
        <input
          type="text"
          autoFocus
          defaultValue={actualEsLibre ? actual : ''}
          placeholder="día-1, seguro, propina…"
          aria-label="Grupo propio"
          className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm"
          onBlur={e => {
            const v = e.target.value.trim()
            setModoLibre(false)
            if (v !== actual) onCambio(v)
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        />
      )}

      {/* Lo que el grupo HABILITA, dicho donde se elige. Sin esta línea, que «vuelo»
          abra el cargue de pantallazo y «día-1» no es una regla invisible. */}
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {ranura
          ? `Permite pegar el pantallazo de ${ranura.label.toLowerCase()}`
          : actual === ''
            ? 'Vacío: entra en todos los itinerarios'
            : 'Grupo propio: el costo se carga a mano'}
      </p>
    </div>
  )
}
