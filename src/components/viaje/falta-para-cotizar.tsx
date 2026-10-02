'use client'

/**
 * Pieza 2 de la solicitud sin formulario (Noor, §2.2): solo el mínimo que falta, como las
 * preguntas de la config y en su orden, cada una con su respuesta de un toque. Lo deseable va
 * plegado. Al cerrarse el mínimo queda la franja «Lista para cotizar.» con «Pasar a cotización»,
 * que usa el avance de etapa de siempre (y su gate `solicitud_minimo`).
 *
 * La cuenta es `calcularNiveles`: la misma del gate y del bot (§4, regla 7).
 */

import { useState } from 'react'
import { calcularNiveles, type CampoConNivel, type Faltante } from '@/lib/negocios/niveles-solicitud'
import { BTN_PRIM, LINK } from './estilo'
import { RespuestaCampo, type CampoSolicitud } from './solicitud-campo'
import { TEXTOS, textoDeseable, textoFaltan, type PreguntaGuardian } from '@/lib/negocios/solicitud-texto'

/** El evento que escucha el selector de etapa del negocio para avanzar con su flujo de siempre. */
export const EVENTO_AVANZAR_ETAPA = 'negocio:avanzar-etapa'

function Pregunta({
  falta,
  texto,
  campo,
  valores,
  onGuardar,
}: {
  falta: Faltante
  texto: string
  campo: CampoSolicitud | undefined
  valores: Record<string, unknown>
  onGuardar: (slug: string, v: unknown) => void
}) {
  return (
    <li className="space-y-1.5 py-2" data-falta={falta.slug}>
      <p className="text-[13px] text-[#191713]">{texto}</p>
      {campo && <RespuestaCampo campo={campo} valor={valores[falta.slug]} valores={valores} onGuardar={v => onGuardar(falta.slug, v)} />}
    </li>
  )
}

export default function FaltaParaCotizar({
  fields,
  valores,
  preguntasGuardian,
  onGuardar,
  puedeAvanzar,
}: {
  fields: CampoSolicitud[]
  valores: Record<string, unknown>
  preguntasGuardian: PreguntaGuardian[]
  onGuardar: (slug: string, v: unknown) => void
  /** Sin él (solo lectura) no se ofrece «Pasar a cotización». */
  puedeAvanzar: boolean
}) {
  const [verDeseable, setVerDeseable] = useState(false)
  const n = calcularNiveles(fields as CampoConNivel[], valores)
  const porSlug = new Map(fields.map(f => [f.slug, f]))
  const guardian = new Map(preguntasGuardian.map(p => [p.slug, p.texto]))
  // Las preguntas de un guardián van primero (la fecha que se descartó).
  const minimo = [...n.minimo.faltan].sort((a, b) => Number(guardian.has(b.slug)) - Number(guardian.has(a.slug)))

  return (
    <div className="space-y-2" data-falta-para-cotizar>
      {minimo.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[#0E5C43] bg-[#EAF1EE] px-3 py-2.5">
          <span className="text-[13px] font-semibold text-[#0E5C43]">{TEXTOS.listaParaCotizar}</span>
          {puedeAvanzar && (
            <button type="button" className={BTN_PRIM} onClick={() => window.dispatchEvent(new CustomEvent(EVENTO_AVANZAR_ETAPA))}>
              {TEXTOS.pasarACotizacion}
            </button>
          )}
        </div>
      ) : (
        <div>
          <p className="text-[13px] font-semibold text-[#191713]">{textoFaltan(minimo.length)}</p>
          <ul className="divide-y divide-[#E2DED5]">
            {minimo.map(f => (
              <Pregunta key={f.slug} falta={f} texto={guardian.get(f.slug) ?? f.pregunta} campo={porSlug.get(f.slug)} valores={valores} onGuardar={onGuardar} />
            ))}
          </ul>
        </div>
      )}

      {n.deseable.total > 0 && (
        <div>
          <p className="text-[13px] text-[#6E6A62]">
            {textoDeseable(n.deseable.completos, n.deseable.total)}
            {n.deseable.faltan.length > 0 && (
              <>
                {' · '}
                <button type="button" className={LINK} onClick={() => setVerDeseable(v => !v)}>{verDeseable ? 'Ocultar' : 'Ver'}</button>
              </>
            )}
          </p>
          {verDeseable && (
            <ul className="divide-y divide-[#E2DED5]">
              {n.deseable.faltan.map(f => (
                <Pregunta key={f.slug} falta={f} texto={f.pregunta} campo={porSlug.get(f.slug)} valores={valores} onGuardar={onGuardar} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
