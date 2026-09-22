'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { guardarDocumentoCliente, redactarDocumentoCliente } from '@/app/(app)/negocios/documento-cliente-actions'
import {
  estadoDelTexto,
  LIMITES_TEXTO,
  type PanelTextoCliente,
  type TextoCliente,
} from '@/lib/cotizaciones/documento-cliente'
import { formatBogotaFechaHora } from '@/lib/dates/bogota'

/**
 * «Texto para el cliente» (Trappvel): lo que el documento dice del viaje con palabras, no
 * con líneas. ONE lo redacta, el equipo lo lee, lo corrige y lo guarda.
 *
 * La regla que esta pantalla no puede romper: **guardar es revisar**. Un borrador de ONE
 * se ve con su marca ámbar y el PDF no lo imprime; en cuanto alguien lo guarda, sale.
 * Por eso no hay un «aprobar» aparte: el único botón que publica es el que guarda.
 */

interface Borrador {
  titular: string
  intro: string
  incluye: string[]
  antes: string[]
}

function borradorDe(t: TextoCliente | null): Borrador {
  return {
    titular: t?.titular ?? '',
    intro: t?.intro ?? '',
    incluye: t?.incluye.length ? [...t.incluye] : [],
    antes: t?.antes_de_viajar.length ? [...t.antes_de_viajar] : [],
  }
}

const mismo = (a: Borrador, b: Borrador) => JSON.stringify(a) === JSON.stringify(b)

function ListaEditable({
  titulo,
  ayuda,
  filas,
  onChange,
  editable,
  placeholder,
}: {
  titulo: string
  ayuda: string
  filas: string[]
  onChange: (filas: string[]) => void
  editable: boolean
  placeholder: string
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-xs font-semibold">{titulo}</p>
        <p className="text-[11px] text-muted-foreground">{ayuda}</p>
      </div>
      {filas.length === 0 && !editable && <p className="text-xs text-muted-foreground">Sin renglones.</p>}
      {filas.map((fila, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
          {editable ? (
            <input
              type="text"
              value={fila}
              maxLength={LIMITES_TEXTO.renglon}
              aria-label={`${titulo}, renglón ${i + 1}`}
              onChange={e => onChange(filas.map((f, j) => (j === i ? e.target.value : f)))}
              className="flex-1 rounded-md border px-2 py-1 text-xs"
            />
          ) : (
            <p className="flex-1 py-1 text-xs">{fila}</p>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => onChange(filas.filter((_, j) => j !== i))}
              aria-label={`Quitar renglón ${i + 1}`}
              className="mt-0.5 rounded p-1 text-muted-foreground hover:bg-accent hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      {editable && filas.length < LIMITES_TEXTO.renglones && (
        <button
          type="button"
          onClick={() => onChange([...filas, ''])}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
          {placeholder}
        </button>
      )}
    </div>
  )
}

export default function DocumentoClientePanel({
  cotizacionId,
  inicial,
}: {
  cotizacionId: string
  inicial: PanelTextoCliente
}) {
  const [panel, setPanel] = useState(inicial)
  const [guardado, setGuardado] = useState<Borrador>(() => borradorDe(inicial.documento))
  const [form, setForm] = useState<Borrador>(() => borradorDe(inicial.documento))
  const [redactando, startRedactar] = useTransition()
  const [guardando, startGuardar] = useTransition()

  const doc = panel.documento
  const estado = estadoDelTexto(doc)
  const cambios = !mismo(form, guardado)
  const editable = panel.editable && panel.columnaPresente
  const ocupado = redactando || guardando

  if (!panel.columnaPresente) {
    return (
      <section className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Texto para el cliente</p>
        <p className="mt-1">Todavía no está disponible: falta aplicar la migración de la base.</p>
      </section>
    )
  }

  const aplicar = (nuevo: PanelTextoCliente) => {
    setPanel(nuevo)
    const b = borradorDe(nuevo.documento)
    setGuardado(b)
    setForm(b)
  }

  const redactar = () => {
    let reemplazarRevisado = false
    if (estado === 'revisado') {
      if (!confirm('Ya hay un texto revisado. ONE lo reemplaza por un borrador nuevo que habrá que volver a revisar. ¿Seguir?')) return
      reemplazarRevisado = true
    } else if (cambios && !confirm('Tienes cambios sin guardar. El borrador de ONE los reemplaza. ¿Seguir?')) {
      return
    }
    startRedactar(async () => {
      const res = await redactarDocumentoCliente(cotizacionId, { reemplazarRevisado })
      if (res.success) {
        aplicar(res.panel)
        toast.success('Borrador listo. Revísalo y guárdalo para que salga en el PDF.')
      } else {
        toast.error(res.error)
      }
    })
  }

  const guardar = () => {
    const texto: TextoCliente = {
      titular: form.titular,
      intro: form.intro,
      incluye: form.incluye,
      antes_de_viajar: form.antes,
    }
    startGuardar(async () => {
      const res = await guardarDocumentoCliente(cotizacionId, texto)
      if (res.success) {
        aplicar(res.panel)
        toast.success(res.panel.documento ? 'Texto guardado: el PDF ya lo imprime.' : 'Texto borrado: el PDF sale sin él.')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="Texto para el cliente">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Texto para el cliente</h2>
            {estado === 'borrador' && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                Borrador de ONE, revisar
              </span>
            )}
            {estado === 'revisado' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                <CheckCircle2 className="h-3 w-3" />
                Revisado{doc?.revisado_por_nombre ? ` por ${doc.revisado_por_nombre}` : ''}
                {doc?.revisado_en ? ` · ${formatBogotaFechaHora(doc.revisado_en) ?? ''}` : ''}
              </span>
            )}
            {cambios && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Cambios sin guardar
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            El PDF solo imprime el texto guardado. Un borrador de ONE no sale hasta que alguien lo lea y lo guarde.
          </p>
        </div>
        {editable && (
          <button
            type="button"
            onClick={redactar}
            disabled={ocupado || !panel.hayViaje}
            title={panel.hayViaje ? undefined : 'Faltan el destino o las líneas del viaje'}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {redactando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {redactando ? 'Redactando…' : 'Redactar con ONE'}
          </button>
        )}
      </div>

      {panel.desactualizado && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Las líneas de la cotización cambiaron después de escribir este texto. Revísalo, o redáctalo de nuevo, antes de enviar el PDF.
        </div>
      )}
      {editable && !panel.hayViaje && estado === 'sin_texto' && (
        <p className="text-[11px] text-muted-foreground">
          Para redactar hace falta el destino del viaje o alguna línea (vuelo, hotel, traslado).
        </p>
      )}
      {!panel.editable && (
        <p className="text-[11px] text-muted-foreground">Esta cotización ya no es un borrador: su texto no se cambia.</p>
      )}

      <div className="space-y-1">
        <label className="text-xs font-semibold" htmlFor={`titular-${cotizacionId}`}>Titular</label>
        {editable ? (
          <input
            id={`titular-${cotizacionId}`}
            type="text"
            value={form.titular}
            maxLength={LIMITES_TEXTO.titular}
            onChange={e => setForm({ ...form, titular: e.target.value })}
            placeholder="Reemplaza el nombre del negocio en la portada"
            className="w-full rounded-md border px-2 py-1.5 text-sm"
          />
        ) : (
          <p className="text-sm">{form.titular || '—'}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold" htmlFor={`intro-${cotizacionId}`}>Presentación</label>
        {editable ? (
          <textarea
            id={`intro-${cotizacionId}`}
            value={form.intro}
            maxLength={LIMITES_TEXTO.intro}
            rows={3}
            onChange={e => setForm({ ...form, intro: e.target.value })}
            placeholder="Una o dos frases bajo el título"
            className="w-full resize-y rounded-md border px-2 py-1.5 text-xs"
          />
        ) : (
          <p className="text-xs">{form.intro || '—'}</p>
        )}
      </div>

      <ListaEditable
        titulo="Incluido en el plan"
        ayuda="Lo que el cliente recibe, descrito como servicio."
        filas={form.incluye}
        onChange={incluye => setForm({ ...form, incluye })}
        editable={editable}
        placeholder="Agregar renglón"
      />
      <ListaEditable
        titulo="Antes de viajar"
        ayuda="Recomendaciones prácticas. Sale en el recuadro ámbar del documento."
        filas={form.antes}
        onChange={antes => setForm({ ...form, antes })}
        editable={editable}
        placeholder="Agregar recomendación"
      />

      {editable && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={guardar}
            disabled={ocupado || (!cambios && estado !== 'borrador')}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
            Guardar texto revisado
          </button>
        </div>
      )}
    </section>
  )
}
