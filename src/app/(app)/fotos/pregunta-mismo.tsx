'use client'

import { Loader2 } from 'lucide-react'

import type { TipoFoto } from '@/lib/fotos/clave'
import type { DudaVista } from '@/lib/fotos/vista'
import { NOMBRE_TIPO } from './perfil-fotos'

/**
 * «¿Es el mismo hotel que …?» (Mauricio, 2026-10-16): el nombre de la cotización se parece a uno
 * que el espacio ya conoce. «Sí, es el mismo» guarda el nombre como alias y sus fotos entran solas
 * (la próxima vez se reconoce sin preguntar); «No, es otro» le abre su propio perfil.
 */
export default function PreguntaMismo({
  tipo,
  duda,
  editable,
  ocupado,
  onContestar,
  compacta = false,
}: {
  tipo: TipoFoto
  duda: DudaVista
  editable: boolean
  ocupado: boolean
  onContestar: (mismo: boolean) => void
  /** En la tarjeta: al lado de la hoja, en el lugar de la foto. */
  compacta?: boolean
}) {
  const lugar = duda.ciudad ? ` (${duda.ciudad})` : ''
  return (
    <div
      className={`flex gap-2 rounded-lg border border-[#F3C9DA] bg-[#FFF7FB] p-2 text-[11.5px] text-[#3A3F55] ${compacta ? 'flex-col' : 'items-center'}`}
      data-pregunta-mismo
    >
      {duda.url && (
        <span
          className={`shrink-0 rounded bg-cover bg-center ${compacta ? 'aspect-[3/2] w-full' : 'h-12 w-16'}`}
          style={{ backgroundImage: `url(${JSON.stringify(duda.url)})` }}
          role="img"
          aria-label={`Foto de ${duda.nombre}`}
        />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="m-0">
          ¿Es el mismo {NOMBRE_TIPO[tipo]} que <b>«{duda.nombre}»</b>
          {lugar}?
        </p>
        {editable ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onContestar(true)}
              className="inline-flex items-center gap-1 rounded-full bg-[#E63380] px-2.5 py-0.5 text-[11px] font-semibold text-white hover:bg-[#c92a6e] disabled:opacity-50"
              data-es-el-mismo
            >
              {ocupado && <Loader2 className="h-3 w-3 animate-spin" />} Sí, es el mismo
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onContestar(false)}
              className="rounded-full border border-[#C9C6D6] bg-white px-2.5 py-0.5 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
              data-es-otro
            >
              No, es otro
            </button>
          </div>
        ) : (
          <p className="m-0 text-[10.5px] text-muted-foreground">Quien arma la cotización lo confirma.</p>
        )}
      </div>
    </div>
  )
}
