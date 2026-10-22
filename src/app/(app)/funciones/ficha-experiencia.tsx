'use client'

/**
 * La ficha de la película con los campos que YA tiene la experiencia: nombre, intro (historia), qué incluye, edad
 * mínima e información general. La ficha nueva (menú, parqueadero, dirección, cómo reservar…) espera la aprobación de
 * Mauricio (P11): no se agregan campos aquí. La edad mínima va en fichas: «Sin menores», «Desde 6» u «Otra».
 */
export interface ValoresFicha {
  nombre: string
  historia: string | null
  que_incluye: string | null
  edad_minima: number | null
  info_general: string | null
}

/** Una ficha vacía; la información general se trae de la última experiencia (§4.3). */
export const fichaVacia = (infoGeneral: string | null): ValoresFicha => ({ nombre: '', historia: null, que_incluye: null, edad_minima: null, info_general: infoGeneral })

export function FichaExperiencia({ valores, onCambio }: { valores: ValoresFicha; onCambio: (v: ValoresFicha) => void }) {
  const poner = (k: keyof ValoresFicha, v: string | number | null) => onCambio({ ...valores, [k]: v })
  const modoEdad = valores.edad_minima === 18 ? 'sin' : valores.edad_minima === 6 ? 'seis' : valores.edad_minima === null ? 'ninguna' : 'otra'
  const campo = 'mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-base'
  return (
    <div className="space-y-3 rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm">
      <label className="block">
        Película o experiencia
        <input value={valores.nombre} onChange={(e) => poner('nombre', e.target.value)} className={`${campo} h-11`} placeholder="Harry Potter" />
      </label>
      <label className="block">
        Intro
        <textarea value={valores.historia ?? ''} onChange={(e) => poner('historia', e.target.value || null)} rows={3} className={campo} placeholder="3 a 5 frases de Sabor" />
      </label>
      <label className="block">
        Qué incluye
        <textarea value={valores.que_incluye ?? ''} onChange={(e) => poner('que_incluye', e.target.value || null)} rows={2} className={campo} />
      </label>
      <div>
        <span>Edad mínima</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {([
            ['sin', 'Sin menores', 18],
            ['seis', 'Desde 6', 6],
            ['otra', 'Otra', valores.edad_minima ?? 10],
          ] as const).map(([k, t, v]) => (
            <button
              key={k}
              type="button"
              onClick={() => poner('edad_minima', modoEdad === k ? null : v)}
              className={`h-9 rounded-full border px-3 ${modoEdad === k ? 'border-[#10B981] bg-emerald-50 text-[#059669]' : 'border-[#E5E7EB]'}`}
            >
              {t}
            </button>
          ))}
          {modoEdad === 'otra' && (
            <input
              inputMode="numeric"
              aria-label="Edad mínima"
              value={valores.edad_minima ?? ''}
              onChange={(e) => poner('edad_minima', e.target.value ? Math.min(99, Math.max(0, Number(e.target.value) || 0)) : null)}
              className="h-9 w-20 rounded-md border border-[#E5E7EB] px-2"
            />
          )}
        </div>
      </div>
      <label className="block">
        Información general
        <textarea value={valores.info_general ?? ''} onChange={(e) => poner('info_general', e.target.value || null)} rows={2} className={campo} />
      </label>
    </div>
  )
}
