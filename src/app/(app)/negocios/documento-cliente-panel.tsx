'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { guardarDocumentoCliente, redactarDocumentoCliente } from '@/app/(app)/negocios/documento-cliente-actions'
import {
  describirAlertaDeEstilo,
  estadoDelTexto,
  LIMITES_TEXTO,
  revisarEstilo,
  type PanelTextoCliente,
  type TextoCliente,
} from '@/lib/cotizaciones/documento-cliente'
import { LIMITE_TERMINOS, normalizarTerminos, terminosAlAbrir } from '@/lib/cotizaciones/terminos-cotizacion'
import { formatBogotaFechaHora } from '@/lib/dates/bogota'

/**
 * «Texto para el cliente» (Trappvel): lo que el documento dice del viaje con palabras, no
 * con líneas. ONE lo redacta, el equipo lo lee, lo corrige y lo guarda.
 *
 * La regla que esta pantalla no puede romper: **guardar es revisar**. Un borrador de ONE
 * se ve con su marca ámbar y el PDF no lo imprime; en cuanto alguien lo guarda, sale.
 * Por eso no hay un «aprobar» aparte: el único botón que publica es el que guarda.
 *
 * Desde el 2026-09-23 (brief C1 y C2, con Noor):
 * - cada campo dice, debajo del rótulo, dónde sale en el PDF y para qué, y una miniatura
 *   del documento ilumina esa zona (en celular se oculta y queda la línea);
 * - «Términos y condiciones» es la última sección del bloque y se guarda con el mismo
 *   botón. Un borrador sin términos propone las condiciones de siempre de la línea; ONE no
 *   los redacta.
 */

/** Las zonas del documento que el panel escribe. */
type Zona = 'titular' | 'intro' | 'incluye' | 'antes' | 'terminos'

/** Dónde sale cada campo en el PDF y para qué. Una línea: es lo único que se ve en celular. */
const DONDE_SALE: Record<Zona, { nombre: string; ayuda: string }> = {
  titular: { nombre: 'Titular', ayuda: 'Es el título de la portada. Si lo dejas vacío, sale el nombre del negocio.' },
  intro: { nombre: 'Presentación', ayuda: 'Sale debajo del título, en la primera página. Una o dos frases que presenten el viaje.' },
  incluye: { nombre: 'Incluido en el plan', ayuda: 'Sale al final, en la lista de lo que incluye el precio.' },
  antes: { nombre: 'Antes de viajar', ayuda: 'Sale al final. Consejos para el viajero: documentos, clima, qué llevar.' },
  terminos: { nombre: 'Términos y condiciones', ayuda: 'Sale al cierre del documento, antes de la firma. Las reglas de la reserva.' },
}

/** El ejemplo en gris del cuadro de términos cuando la línea no tiene texto base. */
const EJEMPLO_TERMINOS = [
  'Condiciones generales',
  '- Las tarifas están sujetas a cambios y a disponibilidad al momento de reservar.',
  '- Las cancelaciones pueden generar penalidades.',
  '',
  'Medios de pago',
  '- Transferencia o consignación a la cuenta de la agencia.',
].join('\n')

interface Borrador {
  titular: string
  intro: string
  incluye: string[]
  antes: string[]
  terminos: string
}

function textoDe(t: TextoCliente | null): Omit<Borrador, 'terminos'> {
  return {
    titular: t?.titular ?? '',
    intro: t?.intro ?? '',
    incluye: t?.incluye.length ? [...t.incluye] : [],
    antes: t?.antes_de_viajar.length ? [...t.antes_de_viajar] : [],
  }
}

const mismoTexto = (a: Borrador, b: Borrador) =>
  JSON.stringify([a.titular, a.intro, a.incluye, a.antes]) === JSON.stringify([b.titular, b.intro, b.incluye, b.antes])

/** Los términos se comparan como se guardan: un espacio al final de un renglón no es un cambio. */
const mismosTerminos = (a: Borrador, b: Borrador) => (normalizarTerminos(a.terminos) ?? '') === (normalizarTerminos(b.terminos) ?? '')

/**
 * La miniatura del documento: la primera página (portada) y el cierre, con la zona del
 * campo que tiene el foco iluminada. Decorativa: la línea de ayuda de cada campo dice lo
 * mismo con palabras, y es lo que queda en celular.
 */
function MapaDelDocumento({ foco }: { foco: Zona | null }) {
  const zona = (z: Zona, clase: string) => (
    <div className={`rounded-[2px] transition-colors ${foco === z ? 'bg-primary' : 'bg-muted-foreground/25'} ${clase}`} />
  )
  const relleno = (clase: string) => <div className={`rounded-[2px] bg-muted-foreground/10 ${clase}`} />
  return (
    <div className="hidden items-end gap-3 sm:flex" aria-hidden="true">
      <div className="text-center">
        <div className="flex h-[104px] w-[76px] flex-col gap-1 rounded border bg-background p-1.5 shadow-sm">
          {relleno('ml-auto h-1 w-4')}
          {zona('titular', 'h-2.5 w-full')}
          {relleno('h-1 w-8')}
          {zona('intro', 'h-3 w-full')}
          {relleno('h-6 w-full')}
          {relleno('h-1 w-full')}
          {relleno('h-1 w-3/4')}
        </div>
        <p className="mt-1 text-[9px] text-muted-foreground">Portada · página 1</p>
      </div>
      <div className="text-center">
        <div className="flex h-[104px] w-[76px] flex-col gap-1 rounded border bg-background p-1.5 shadow-sm">
          {relleno('h-1 w-full')}
          {relleno('h-1.5 w-full')}
          <div className="flex gap-1">
            {zona('incluye', 'h-5 flex-1')}
            {zona('antes', 'h-5 flex-1')}
          </div>
          {zona('terminos', 'h-5 w-full')}
          <div className="mt-auto flex justify-center">{relleno('h-1 w-6')}</div>
        </div>
        <p className="mt-1 text-[9px] text-muted-foreground">Cierre</p>
      </div>
      <p className="max-w-[9rem] pb-4 text-[10px] leading-snug text-muted-foreground">
        {foco ? <><span className="font-medium text-foreground">{DONDE_SALE[foco].nombre}</span> sale en la zona marcada.</> : 'Entra a un campo para ver dónde sale en el PDF.'}
      </p>
    </div>
  )
}

function Rotulo({ zona, htmlFor }: { zona: Zona; htmlFor?: string }) {
  return (
    <div>
      {htmlFor ? (
        <label className="text-xs font-semibold" htmlFor={htmlFor}>{DONDE_SALE[zona].nombre}</label>
      ) : (
        <p className="text-xs font-semibold">{DONDE_SALE[zona].nombre}</p>
      )}
      <p className="text-[11px] text-muted-foreground">{DONDE_SALE[zona].ayuda}</p>
    </div>
  )
}

function ListaEditable({
  zona,
  filas,
  onChange,
  onFocus,
  editable,
  placeholder,
}: {
  zona: Zona
  filas: string[]
  onChange: (filas: string[]) => void
  onFocus: () => void
  editable: boolean
  placeholder: string
}) {
  const titulo = DONDE_SALE[zona].nombre
  return (
    <div className="space-y-1.5" onFocus={onFocus}>
      <Rotulo zona={zona} />
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
  // Los términos al abrir: los guardados, o la propuesta de la línea en un borrador sin términos.
  const [apertura] = useState(() =>
    terminosAlAbrir({ terminos: inicial.terminos, terminosBase: inicial.terminosBase, editable: inicial.editable && inicial.columnaPresente }),
  )
  const [guardado, setGuardado] = useState<Borrador>(() => ({ ...textoDe(inicial.documento), terminos: inicial.terminos ?? '' }))
  const [form, setForm] = useState<Borrador>(() => ({ ...textoDe(inicial.documento), terminos: apertura.valor }))
  const [foco, setFoco] = useState<Zona | null>(null)
  const [redactando, startRedactar] = useTransition()
  const [guardando, startGuardar] = useTransition()

  const doc = panel.documento
  const estado = estadoDelTexto(doc)
  const cambiosTexto = !mismoTexto(form, guardado)
  const cambios = cambiosTexto || !mismosTerminos(form, guardado)
  const editable = panel.editable && panel.columnaPresente
  const ocupado = redactando || guardando
  // La propuesta no está guardada: el PDF sale sin términos hasta que alguien guarde.
  const terminosPropuestosSinGuardar = apertura.propuesto && guardado.terminos === '' && form.terminos.trim() !== ''
  const alertas = editable
    ? revisarEstilo({ titular: form.titular, intro: form.intro, incluye: form.incluye, antes_de_viajar: form.antes })
    : []

  if (!panel.columnaPresente) {
    return (
      <section className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Texto para el cliente</p>
        <p className="mt-1">Todavía no está disponible: falta aplicar la migración de la base.</p>
      </section>
    )
  }

  /**
   * El panel que devolvió el servidor pasa a ser lo guardado. Tras redactar, los términos
   * del formulario se conservan: ONE no los toca, y lo que alguien escribió ahí sin guardar
   * no se pierde por pedir un borrador.
   */
  const aplicar = (nuevo: PanelTextoCliente, opciones?: { conservarTerminos?: boolean }) => {
    setPanel(nuevo)
    const texto = textoDe(nuevo.documento)
    const terminosGuardados = nuevo.terminos ?? ''
    setGuardado({ ...texto, terminos: terminosGuardados })
    setForm(f => ({ ...texto, terminos: opciones?.conservarTerminos ? f.terminos : terminosGuardados }))
  }

  const redactar = () => {
    let reemplazarRevisado = false
    if (estado === 'revisado') {
      if (!confirm('Ya hay un texto revisado. ONE lo reemplaza por un borrador nuevo que habrá que volver a revisar. ¿Seguir?')) return
      reemplazarRevisado = true
    } else if (cambiosTexto && !confirm('Tienes cambios sin guardar en el texto. El borrador de ONE los reemplaza (los términos no). ¿Seguir?')) {
      return
    }
    startRedactar(async () => {
      const res = await redactarDocumentoCliente(cotizacionId, { reemplazarRevisado })
      if (res.success) {
        aplicar(res.panel, { conservarTerminos: true })
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
      const res = await guardarDocumentoCliente(cotizacionId, texto, form.terminos)
      if (res.success) {
        aplicar(res.panel)
        toast.success(
          res.panel.documento || res.panel.terminos
            ? 'Guardado: el PDF ya lo imprime.'
            : 'Texto borrado: el PDF sale sin él.',
        )
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

      <MapaDelDocumento foco={foco} />

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

      {/* Lo que suena a folleto o a IA (brief C4). Marca, no corrige: decide quien revisa. */}
      {alertas.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Revisa el estilo antes de guardar
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {alertas.map(a => <li key={`${a.motivo}-${a.campo ?? ''}-${a.texto}`}>{describirAlertaDeEstilo(a)}</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-1" onFocus={() => setFoco('titular')}>
        <Rotulo zona="titular" htmlFor={`titular-${cotizacionId}`} />
        {editable ? (
          <input
            id={`titular-${cotizacionId}`}
            type="text"
            value={form.titular}
            maxLength={LIMITES_TEXTO.titular}
            onChange={e => setForm({ ...form, titular: e.target.value })}
            placeholder="Ej.: Cinco noches en Cancún, frente al mar"
            className="w-full rounded-md border px-2 py-1.5 text-sm"
          />
        ) : (
          <p className="text-sm">{form.titular || '—'}</p>
        )}
      </div>

      <div className="space-y-1" onFocus={() => setFoco('intro')}>
        <Rotulo zona="intro" htmlFor={`intro-${cotizacionId}`} />
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
        zona="incluye"
        filas={form.incluye}
        onChange={incluye => setForm({ ...form, incluye })}
        onFocus={() => setFoco('incluye')}
        editable={editable}
        placeholder="Agregar renglón"
      />
      <ListaEditable
        zona="antes"
        filas={form.antes}
        onChange={antes => setForm({ ...form, antes })}
        onFocus={() => setFoco('antes')}
        editable={editable}
        placeholder="Agregar consejo"
      />

      {/* Términos: la última sección, con el mismo guardar. ONE no los redacta. */}
      <div className="space-y-1 border-t pt-3" onFocus={() => setFoco('terminos')}>
        <Rotulo zona="terminos" htmlFor={`terminos-${cotizacionId}`} />
        {terminosPropuestosSinGuardar && (
          <p className="text-[11px] text-amber-800">
            Propuestos con las condiciones de siempre de la línea. Cámbialos o agrega lo que haga falta: salen en el PDF al guardar.
          </p>
        )}
        {editable ? (
          <textarea
            id={`terminos-${cotizacionId}`}
            value={form.terminos}
            maxLength={LIMITE_TERMINOS}
            rows={12}
            onChange={e => setForm({ ...form, terminos: e.target.value })}
            placeholder={EJEMPLO_TERMINOS}
            className="w-full resize-y rounded-md border px-2 py-1.5 text-xs leading-relaxed"
          />
        ) : (
          <p className="whitespace-pre-wrap text-xs">{form.terminos || '—'}</p>
        )}
      </div>

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
