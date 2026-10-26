'use client'

/**
 * La ficha de la experiencia (P11, §1.8): los textos de la oferta y de la bienvenida al grupo de WhatsApp, en palabras de
 * Sabor y TAL CUAL (con sus emojis). Salen de sus dos mensajes reales; no hay más campos. La edad mínima va en fichas:
 * «Sin menores», «Desde 6» u «Otra». La puerta cerrada al iniciar es una casilla (solo películas, 26-oct). Los datos del lugar (dirección, piso, parqueadero, firma) van aparte, una vez por
 * workspace (`/funciones/lugar`).
 */
import type { FichaExperienciaDatos } from '@/lib/funciones/datos'

export type ValoresFicha = FichaExperienciaDatos

export const fichaVacia = (): ValoresFicha => ({
  nombre: '', titulo_oferta: null, frase_gancho: null, intro: null, que_incluye: null, emojis_tema: null,
  saludo_grupo: null, relato_grupo: null, edad_minima: null, puerta_cerrada: false,
})

/** Los valores de una experiencia guardada, para editarla. */
export const fichaDe = (e: FichaExperienciaDatos): ValoresFicha => ({
  nombre: e.nombre, titulo_oferta: e.titulo_oferta, frase_gancho: e.frase_gancho, intro: e.intro, que_incluye: e.que_incluye,
  emojis_tema: e.emojis_tema, saludo_grupo: e.saludo_grupo, relato_grupo: e.relato_grupo, edad_minima: e.edad_minima,
  puerta_cerrada: e.puerta_cerrada === true,
})

export function FichaExperiencia({ valores, onCambio }: { valores: ValoresFicha; onCambio: (v: ValoresFicha) => void }) {
  const poner = <K extends keyof ValoresFicha>(k: K, v: ValoresFicha[K]) => onCambio({ ...valores, [k]: v })
  const texto = (k: 'titulo_oferta' | 'frase_gancho' | 'intro' | 'emojis_tema' | 'saludo_grupo' | 'relato_grupo') =>
    ({ value: valores[k] ?? '', onChange: (e: { target: { value: string } }) => poner(k, e.target.value || null) })
  const modoEdad = valores.edad_minima === 18 ? 'sin' : valores.edad_minima === 6 ? 'seis' : valores.edad_minima === null ? 'ninguna' : 'otra'
  const campo = 'mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-base'
  return (
    <div className="space-y-4 rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm">
      <label className="block">
        Nombre de la experiencia
        <input value={valores.nombre} onChange={(e) => poner('nombre', e.target.value)} className={`${campo} h-11`} placeholder="Cata de vinos del Valle de Uco" />
      </label>

      <fieldset className="space-y-3">
        <legend className="font-medium text-[#1A1A1A]">La oferta (post y mensaje directo)</legend>
        <label className="block">
          Título de la oferta
          <input {...texto('titulo_oferta')} className={`${campo} h-11`} placeholder="🍷🍇 CATA DE VINOS DEL VALLE DE UCO llega a BOGOTÁ ✨" />
        </label>
        <label className="block">
          Frase gancho
          <input {...texto('frase_gancho')} className={`${campo} h-11`} placeholder="¿Listo para recorrer Mendoza copa a copa? 🍷✨" />
        </label>
        <label className="block">
          Intro <span className="text-xs text-[#6B7280]">(solo en el post; el mensaje directo va sin ella)</span>
          <textarea {...texto('intro')} rows={4} className={campo} placeholder="Vive una experiencia guiada por…" />
        </label>
        <label className="block">
          Qué incluye <span className="text-xs text-[#6B7280]">(una línea por cosa)</span>
          <textarea
            value={(valores.que_incluye ?? []).join('\n')}
            onChange={(e) => poner('que_incluye', e.target.value ? e.target.value.split('\n') : null)}
            rows={3}
            className={campo}
            placeholder={'🍷 5 vinos del Valle de Uco\n🧀 Tabla de quesos y maridaje\n👩‍🍳 Guía de un sommelier'}
          />
        </label>
        <label className="block">
          Emojis del tema <span className="text-xs text-[#6B7280]">(cierran la oferta)</span>
          <input {...texto('emojis_tema')} className={`${campo} h-11 w-32`} placeholder="🍷🍇" />
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-medium text-[#1A1A1A]">La bienvenida al grupo de WhatsApp</legend>
        <label className="block">
          Saludo del grupo <span className="text-xs text-[#6B7280]">(va antes de la fecha y la hora; aquí van las frases con el tema de la experiencia, como «Las copas ya están servidas…»)</span>
          <textarea {...texto('saludo_grupo')} rows={6} className={campo} placeholder="🍷 ¡Hola, amantes del vino…" />
        </label>
        <label className="block">
          Relato de cierre <span className="text-xs text-[#6B7280]">(va antes de la firma)</span>
          <textarea {...texto('relato_grupo')} rows={6} className={campo} placeholder="🍇 ¡Preparen el paladar…" />
        </label>
        <p className="text-xs text-[#6B7280]">La fecha, la llegada (10 min antes), el inicio (10 min después) y los pagos los pone ONE.</p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={valores.puerta_cerrada}
            onChange={(e) => poner('puerta_cerrada', e.target.checked)}
            className="mt-0.5 h-5 w-5 accent-[#10B981]"
          />
          <span>
            Puerta cerrada al iniciar
            <span className="block text-xs text-[#6B7280]">Para películas: una vez empieza, no entra nadie</span>
          </span>
        </label>
      </fieldset>

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
    </div>
  )
}
