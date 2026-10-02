'use client'

/**
 * La tarjeta «Solicitud» de un negocio de viaje (Noor, §2.1): reemplaza al formulario de 22
 * campos arriba de la etapa «Solicitud», con las tres piezas en orden: la caja (pegar o escribir),
 * lo que falta para cotizar y la solicitud para revisar. Los bloques de contacto y los de la
 * agencia siguen debajo, sin cambios.
 *
 * Guarda como el bloque de siempre: completo → `marcarBloqueCompleto`, si no →
 * `actualizarBloqueData` (mismo guard, misma limpieza de marcas al cambiar un valor).
 */

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { actualizarBloqueData, confirmarSugerido, descartarConflicto, marcarBloqueCompleto } from '@/app/(app)/negocios/negocio-v2-actions'
import { confirmarSugeridos } from '@/app/(app)/negocios/solicitud-texto-actions'
import { camposRequeridosFaltantes, type CampoConfig } from '@/lib/negocios/campo-completo'
import { aplicarSumas } from '@/lib/negocios/campo-suma'
import { conflictosDe, sugeridosDe } from '@/lib/negocios/sugeridos'
import type { PreguntaGuardian } from '@/lib/negocios/solicitud-texto'
import CajaSolicitud from './caja-solicitud'
import FaltaParaCotizar from './falta-para-cotizar'
import RevisionSolicitud, { type HistoriaCliente } from './revision-solicitud'
import { vacio, type CampoSolicitud } from './solicitud-campo'

function valoresDe(fields: CampoSolicitud[], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = data[f.slug]
    out[f.slug] = vacio(v) && f.default !== undefined ? f.default : v ?? ''
  }
  return out
}

export default function TarjetaSolicitud({
  negocioBloqueId,
  fields,
  data,
  requireConfirm = false,
  historias,
  editable,
}: {
  negocioBloqueId: string
  fields: CampoSolicitud[]
  /** `negocio_bloques.data` tal como está guardado (con `_sugeridos` y `_conflictos`). */
  data: Record<string, unknown>
  requireConfirm?: boolean
  historias: HistoriaCliente[]
  /** El mismo `modo` que tendría el bloque: sin él, todo es de lectura. */
  editable: boolean
}) {
  const router = useRouter()
  const [valores, setValores] = useState(() => valoresDe(fields, data))
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [preguntas, setPreguntas] = useState<PreguntaGuardian[]>([])
  const [confirmados, setConfirmados] = useState<Set<string>>(() => new Set())
  const [dejados, setDejados] = useState<Set<string>>(() => new Set())
  const guardando = useRef(Promise.resolve())

  // Lo que trae el servidor después de guardar o cargar manda sobre lo local (se ajusta al
  // render, no en un efecto: https://react.dev/learn/you-might-not-need-an-effect).
  const [dataVista, setDataVista] = useState(data)
  if (dataVista !== data) {
    setDataVista(data)
    setValores(valoresDe(fields, data))
    setConfirmados(new Set())
    setDejados(new Set())
  }

  const sugeridos = useMemo(() => {
    const m = sugeridosDe(data)
    return Object.fromEntries(Object.entries(m).filter(([s]) => !confirmados.has(s) && String(valores[s] ?? '') === String(data[s] ?? '')))
  }, [data, confirmados, valores])
  const conflictos = useMemo(() => {
    const m = conflictosDe(data)
    return Object.fromEntries(Object.entries(m).filter(([s]) => !dejados.has(s) && String(valores[s] ?? '') === String(data[s] ?? '')))
  }, [data, dejados, valores])

  const tieneDatos = fields.some(f => !vacio(data[f.slug]))

  function guardar(slug: string, v: unknown) {
    const next = aplicarSumas(fields, { ...valores, [slug]: v })
    setValores(next)
    // En fila: dos toques seguidos no se pisan.
    guardando.current = guardando.current.then(async () => {
      const completo = camposRequeridosFaltantes(fields as CampoConfig[], next).length === 0
      const r = completo && !requireConfirm
        ? await marcarBloqueCompleto(negocioBloqueId, next)
        : await actualizarBloqueData(negocioBloqueId, next, undefined, { revalidate: true })
      if (r.error) toast.error(r.error)
    })
  }

  async function confirmar(slug: string) {
    const r = await confirmarSugerido(negocioBloqueId, slug)
    if (r.error) toast.error(r.error)
    else setConfirmados(prev => new Set(prev).add(slug))
  }

  async function confirmarTodos(slugs: string[]) {
    const r = await confirmarSugeridos(negocioBloqueId, slugs)
    if (r.error) toast.error(r.error)
    else setConfirmados(prev => new Set([...prev, ...slugs]))
  }

  async function dejar(slug: string) {
    const r = await descartarConflicto(negocioBloqueId, slug)
    if (r.error) toast.error(r.error)
    else setDejados(prev => new Set(prev).add(slug))
  }

  return (
    <section className="space-y-4 rounded-xl border border-[#E2DED5] bg-[#F3F1EC] p-3 sm:p-4" data-tarjeta-solicitud>
      <h3 className="text-sm font-semibold text-[#191713]">Solicitud</h3>
      {mensaje && <p className="text-[13px] font-semibold text-[#0E5C43]" role="status">{mensaje}</p>}

      {editable && (
        <CajaSolicitud
          negocioBloqueId={negocioBloqueId}
          compacta={tieneDatos}
          onPreguntas={setPreguntas}
          onCargado={r => {
            setMensaje(r.mensaje)
            router.refresh()
          }}
        />
      )}

      <FaltaParaCotizar fields={fields} valores={valores} preguntasGuardian={preguntas} onGuardar={guardar} puedeAvanzar={editable} />

      <RevisionSolicitud
        fields={fields}
        valores={valores}
        sugeridos={sugeridos}
        conflictos={conflictos}
        historias={historias}
        editable={editable}
        onGuardar={guardar}
        onConfirmar={confirmar}
        onConfirmarTodos={confirmarTodos}
        onDejar={dejar}
      />
    </section>
  )
}
