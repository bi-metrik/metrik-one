'use client'

import { useState, type ReactNode } from 'react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { AlertTriangle, CheckCircle2, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { actualizarParrafoConOne, guardarDocumentoCliente, redactarDocumentoCliente } from '@/app/(app)/negocios/documento-cliente-actions'
import { textoDeParrafoViejo, type ZonaDeParrafo } from '@/lib/cotizaciones/parrafo-viejo'
import {
  describirAlertaDeEstilo,
  estadoDelTexto,
  LIMITES_TEXTO,
  revisarEstilo,
  type PanelTextoCliente,
  type TextoCliente,
} from '@/lib/cotizaciones/documento-cliente'
import { LIMITE_TERMINOS, normalizarTerminos, terminosAlAbrir } from '@/lib/cotizaciones/terminos-cotizacion'
import { lineasPropias } from '@/lib/cotizaciones/incluye-por-one'
import { formatBogotaFechaHora } from '@/lib/dates/bogota'
import AnticipoPropuestaPanel from './anticipo-propuesta-panel'
import FotosPropuestaPanel from './fotos-propuesta-panel'

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

/**
 * C6 · con «Incluye» armado por ONE, el formulario solo edita las líneas PROPIAS de la asesora:
 * las del documento marcado, o las que escribió una persona y no repiten un renglón de ONE. Lo que
 * redactó el modelo no es propio de nadie: lo reemplaza lo de ONE.
 */
function textoPorPasos(doc: PanelTextoCliente['documento'], deOne: readonly string[]): Omit<Borrador, 'terminos'> {
  const base = textoDe(doc)
  if (!doc) return base
  const propias = doc.incluye_origen === 'one' ? doc.incluye : doc.origen === 'persona' ? lineasPropias(doc.incluye, deOne) : []
  return { ...base, incluye: [...propias] }
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

function Rotulo({ zona, htmlFor, extra }: { zona: Zona; htmlFor?: string; extra?: ReactNode }) {
  const rotulo = (
    <div>
      {htmlFor ? (
        <label className="text-xs font-semibold" htmlFor={htmlFor}>{DONDE_SALE[zona].nombre}</label>
      ) : (
        <p className="text-xs font-semibold">{DONDE_SALE[zona].nombre}</p>
      )}
      <p className="text-[11px] text-muted-foreground">{DONDE_SALE[zona].ayuda}</p>
    </div>
  )
  if (!extra) return rotulo
  return <div className="flex flex-wrap items-start justify-between gap-2">{rotulo}{extra}</div>
}

/** D5 · la marca del párrafo viejo: qué servicio nombra que ya no va. */
function NotaDeParrafoViejo({ texto }: { texto: string }) {
  return (
    <p className="flex items-start gap-1 text-[11px] text-amber-900" data-parrafo-viejo>
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      {texto}
    </p>
  )
}

/** D5 · «Actualizar con ONE» de un párrafo: propone el texto nuevo en el formulario, sin guardar. */
function BotonActualizarParrafo({ onClick, cargando, disabled }: { onClick: () => void; cargando: boolean; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
      data-actualizar-parrafo
    >
      {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      {cargando ? 'Actualizando…' : 'Actualizar con ONE'}
    </button>
  )
}

function ListaEditable({
  zona,
  filas,
  onChange,
  onFocus,
  editable,
  placeholder,
  extra,
  marcas,
}: {
  zona: Zona
  filas: string[]
  onChange: (filas: string[]) => void
  onFocus: () => void
  editable: boolean
  placeholder: string
  /** Lo que va a la derecha del rótulo (D5: «Actualizar con ONE»). */
  extra?: ReactNode
  /** D5 · los renglones viejos, con lo que nombran que ya no va. */
  marcas?: ReadonlyMap<number, string>
}) {
  const titulo = DONDE_SALE[zona].nombre
  return (
    <div className="space-y-1.5" onFocus={onFocus}>
      <Rotulo zona={zona} extra={extra} />
      {filas.length === 0 && !editable && <p className="text-xs text-muted-foreground">Sin renglones.</p>}
      {filas.map((fila, i) => {
        const renglon = (
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
        )
        // D5 · el renglón viejo, marcado y con lo que nombra que ya no va. Sin marcas, el de siempre.
        const marca = marcas?.get(i)
        return marca ? (
          <div key={i} className="flex flex-col gap-0.5 rounded-md bg-amber-50 p-1 ring-1 ring-amber-300" data-parrafo-viejo-renglon={i}>
            <NotaDeParrafoViejo texto={marca} />
            {renglon}
          </div>
        ) : renglon
      })}
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
  incluyeDeOne = null,
}: {
  cotizacionId: string
  inicial: PanelTextoCliente
  /**
   * C6 · la forma por pasos con la pieza `incluye_por_one`: los renglones que arma ONE con lo que
   * se cobra. Con ellos «Incluido en el plan» se muestra armado y solo se editan las líneas
   * propias; guardar y redactar dejan la marca. `null` = el panel de siempre.
   */
  incluyeDeOne?: string[] | null
}) {
  const porPasos = incluyeDeOne !== null
  const textoInicial = (doc: PanelTextoCliente['documento']) => (porPasos ? textoPorPasos(doc, incluyeDeOne ?? []) : textoDe(doc))
  const [panel, setPanel] = useState(inicial)
  // Los términos al abrir: los guardados, o la propuesta de la línea en un borrador sin términos.
  const [apertura] = useState(() =>
    terminosAlAbrir({ terminos: inicial.terminos, terminosBase: inicial.terminosBase, editable: inicial.editable && inicial.columnaPresente }),
  )
  const [guardado, setGuardado] = useState<Borrador>(() => ({ ...textoInicial(inicial.documento), terminos: inicial.terminos ?? '' }))
  const [form, setForm] = useState<Borrador>(() => ({ ...textoInicial(inicial.documento), terminos: apertura.valor }))
  const [foco, setFoco] = useState<Zona | null>(null)
  const [redactando, startRedactar] = useTransitionTolerante()
  const [guardando, startGuardar] = useTransitionTolerante()
  // D5 · el párrafo que ONE está actualizando (uno a la vez).
  const [actualizando, setActualizando] = useState<ZonaDeParrafo | null>(null)

  const doc = panel.documento
  const estado = estadoDelTexto(doc)
  // C6 · un texto guardado sin la marca todavía imprime el «Incluye» viejo: hay que guardarlo.
  const sinMarca = porPasos && !!doc && doc.incluye_origen !== 'one'
  const cambiosTexto = !mismoTexto(form, guardado) || sinMarca
  const cambios = cambiosTexto || !mismosTerminos(form, guardado)
  const editable = panel.editable && panel.columnaPresente
  const ocupado = redactando || guardando
  // La propuesta no está guardada: el PDF sale sin términos hasta que alguien guarde.
  const terminosPropuestosSinGuardar = apertura.propuesto && guardado.terminos === '' && form.terminos.trim() !== ''
  const alertas = editable
    ? revisarEstilo({ titular: form.titular, intro: form.intro, incluye: form.incluye, antes_de_viajar: form.antes })
    : []
  // D5 (solo la forma por pasos) · qué párrafo quedó viejo, y «Actualizar con ONE» por párrafo
  // cuando el texto es de otras líneas.
  const viejos = porPasos ? (panel.parrafosViejos ?? []) : []
  const notaDe = (zona: ZonaDeParrafo) => {
    const p = viejos.find(v => v.zona === zona && v.indice === null)
    return p ? textoDeParrafoViejo(p) : null
  }
  const marcasAntes = new Map(viejos.filter(v => v.zona === 'antes' && v.indice !== null).map(v => [v.indice as number, textoDeParrafoViejo(v)]))
  const botonDe = (zona: ZonaDeParrafo) => (porPasos && editable && panel.desactualizado && panel.hayViaje ? (
    <BotonActualizarParrafo onClick={() => void actualizarParrafo(zona)} cargando={actualizando === zona} disabled={ocupado || actualizando !== null} />
  ) : null)

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
    const texto = textoInicial(nuevo.documento)
    const terminosGuardados = nuevo.terminos ?? ''
    setGuardado({ ...texto, terminos: terminosGuardados })
    setForm(f => ({ ...texto, terminos: opciones?.conservarTerminos ? f.terminos : terminosGuardados }))
  }

  const redactar = () => {
    // D3 · en la forma por pasos lo único que confirma es «Enviar al cliente»: Redactar no pregunta,
    // y lo que había se recupera con «Deshacer» en el aviso.
    if (porPasos) {
      redactarSinPreguntar()
      return
    }
    let reemplazarRevisado = false
    if (estado === 'revisado') {
      if (!confirm('Ya hay un texto revisado. ONE lo reemplaza por un borrador nuevo que habrá que volver a revisar. ¿Seguir?')) return
      reemplazarRevisado = true
    } else if (cambiosTexto && !confirm('Tienes cambios sin guardar en el texto. El borrador de ONE los reemplaza (los términos no). ¿Seguir?')) {
      return
    }
    startRedactar(async () => {
      const res = await redactarDocumentoCliente(cotizacionId, porPasos ? { reemplazarRevisado, porPasos: true } : { reemplazarRevisado })
      if (res.success) {
        aplicar(res.panel, { conservarTerminos: true })
        toast.success('Borrador listo. Revísalo y guárdalo para que salga en el PDF.')
      } else {
        toast.error(res.error)
      }
    })
  }

  /**
   * D3 · Redactar en la forma por pasos: sin `confirm()`. Lo de antes queda a un clic: un texto ya
   * revisado se vuelve a guardar tal cual; los cambios sin guardar vuelven al formulario.
   */
  const redactarSinPreguntar = () => {
    const formAntes = form
    const revisadoAntes = estado === 'revisado' ? { ...guardado } : null
    const conCambios = cambiosTexto
    startRedactar(async () => {
      const res = await redactarDocumentoCliente(cotizacionId, { reemplazarRevisado: estado === 'revisado', porPasos: true })
      if (!res.success) {
        toast.error(res.error)
        return
      }
      aplicar(res.panel, { conservarTerminos: true })
      const puedeDeshacer = revisadoAntes !== null || conCambios
      toast.success('Borrador listo. Revísalo y guárdalo para que salga en el PDF.', puedeDeshacer ? {
        action: {
          label: 'Deshacer',
          onClick: () => {
            if (revisadoAntes) {
              startGuardar(async () => {
                const texto: TextoCliente = { titular: revisadoAntes.titular, intro: revisadoAntes.intro, incluye: revisadoAntes.incluye, antes_de_viajar: revisadoAntes.antes }
                const r = await guardarDocumentoCliente(cotizacionId, texto, formAntes.terminos, { porPasos: true })
                if (r.success) {
                  aplicar(r.panel)
                  toast.success('Volvió el texto revisado de antes.')
                } else {
                  toast.error(r.error)
                }
              })
            } else {
              setForm(f => ({ ...formAntes, terminos: f.terminos }))
            }
          },
        },
      } : undefined)
    })
  }

  /** D5 · «Actualizar con ONE» de un párrafo: el texto nuevo va al formulario, sin guardar. */
  const actualizarParrafo = async (zona: ZonaDeParrafo) => {
    setActualizando(zona)
    try {
      const r = await actualizarParrafoConOne(cotizacionId, zona)
      if (!r.success) {
        toast.error(r.error)
        return
      }
      setForm(f => (zona === 'titular' ? { ...f, titular: String(r.texto) }
        : zona === 'intro' ? { ...f, intro: String(r.texto) }
        : { ...f, antes: Array.isArray(r.texto) ? [...r.texto] : f.antes }))
      toast.success('ONE propuso el párrafo. Léelo y guarda el texto para que salga en el PDF.')
    } catch {
      toast.error('No se pudo actualizar: revisa la conexión y vuelve a intentarlo.')
    } finally {
      setActualizando(null)
    }
  }

  const guardar = () => {
    const texto: TextoCliente = {
      titular: form.titular,
      intro: form.intro,
      incluye: form.incluye,
      antes_de_viajar: form.antes,
    }
    startGuardar(async () => {
      const res = porPasos
        ? await guardarDocumentoCliente(cotizacionId, texto, form.terminos, { porPasos: true })
        : await guardarDocumentoCliente(cotizacionId, texto, form.terminos)
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

      <div className={notaDe('titular') ? 'space-y-1 rounded-md bg-amber-50 p-1.5 ring-1 ring-amber-300' : 'space-y-1'} onFocus={() => setFoco('titular')} data-parrafo="titular">
        <Rotulo zona="titular" htmlFor={`titular-${cotizacionId}`} extra={botonDe('titular')} />
        {notaDe('titular') && <NotaDeParrafoViejo texto={notaDe('titular')!} />}
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

      <div className={notaDe('intro') ? 'space-y-1 rounded-md bg-amber-50 p-1.5 ring-1 ring-amber-300' : 'space-y-1'} onFocus={() => setFoco('intro')} data-parrafo="intro">
        <Rotulo zona="intro" htmlFor={`intro-${cotizacionId}`} extra={botonDe('intro')} />
        {notaDe('intro') && <NotaDeParrafoViejo texto={notaDe('intro')!} />}
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

      {porPasos ? (
        // C6 · «Incluye · Lo arma ONE con lo que se cobra»: lo de ONE no se edita (nunca queda
        // viejo); debajo, las líneas propias, que se conservan.
        <div className="space-y-1.5" onFocus={() => setFoco('incluye')} data-incluye-por-one>
          <div>
            <p className="text-xs font-semibold">Incluye · Lo arma ONE con lo que se cobra</p>
            <p className="text-[11px] text-muted-foreground">Sale al final. ONE lo rehace solo cuando cambia un servicio: no se edita aquí.</p>
          </div>
          {incluyeDeOne!.length === 0
            ? <p className="text-xs text-muted-foreground">Todavía no hay servicios que se cobren en la Recomendada.</p>
            : incluyeDeOne!.map(r => (
              <div key={r} className="flex items-start gap-1.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                <p className="flex-1 py-1 text-xs">{r}</p>
              </div>
            ))}
          <ListaEditable
            zona="incluye"
            filas={form.incluye}
            onChange={incluye => setForm({ ...form, incluye })}
            onFocus={() => setFoco('incluye')}
            editable={editable}
            placeholder="Agregar una línea tuya"
          />
          {sinMarca && editable && (
            <p className="text-[11px] text-amber-800" data-incluye-sin-guardar>
              Guarda el texto para que el PDF use la lista que arma ONE.
            </p>
          )}
        </div>
      ) : (
        <ListaEditable
          zona="incluye"
          filas={form.incluye}
          onChange={incluye => setForm({ ...form, incluye })}
          onFocus={() => setFoco('incluye')}
          editable={editable}
          placeholder="Agregar renglón"
        />
      )}
      <ListaEditable
        zona="antes"
        filas={form.antes}
        onChange={antes => setForm({ ...form, antes })}
        onFocus={() => setFoco('antes')}
        editable={editable}
        placeholder="Agregar consejo"
        extra={botonDe('antes')}
        marcas={marcasAntes.size > 0 ? marcasAntes : undefined}
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

      {/* Decisión del 2026-10-14 (3): el anticipo lo asigna la asesora; solo con la propuesta nueva. */}
      {panel.imprimeAnticipo && (
        <AnticipoPropuestaPanel cotizacionId={cotizacionId} inicial={panel.anticipo ?? null} editable={editable} />
      )}

      {/* PR 4: las fotos de la propuesta nueva (catálogo del espacio). */}
      {panel.imprimeAnticipo && <FotosPropuestaPanel cotizacionId={cotizacionId} editable={editable} />}
    </section>
  )
}
