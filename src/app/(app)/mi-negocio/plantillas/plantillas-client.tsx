'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  AlignCenter, AlignJustify, ArrowLeft, Bold, CheckCircle2, Eye, FileText, Heading1, Heading2,
  History, Loader2, Minus, PenLine, RotateCcw, Save, Search, Table2, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { defDe, type Datos, type TipoPlantilla } from '@/lib/plantillas-documento/catalogo'
import { htmlDelDocumento } from '@/lib/plantillas-documento/html'
import { validarPlantilla } from '@/lib/plantillas-documento/validar'
import type { Bloque, Inline } from '@/lib/plantillas-documento/sintaxis'
import type { VersionPlantilla } from '@/lib/plantillas-documento/servidor'
import { PLANTILLAS_V1 } from '@/lib/plantillas-documento/v1'
import { fetchPropio } from '@/lib/version/fetch-propio'
import {
  activarVersionPlantilla,
  buscarNegociosParaVista,
  datosParaVistaPrevia,
  guardarVersionPlantilla,
  leerPlantilla,
  restaurarVersionPlantilla,
  type PantallaPlantilla,
} from './actions'

type Vista = 'editar' | 'previa' | 'historial'

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })

/** El texto con el que abre el editor: la activa, si no la última, si no la de fábrica. */
function textoInicial(p: PantallaPlantilla): string {
  const activa = p.versiones.find((v) => v.id === p.activaId)
  return activa?.contenido ?? p.versiones[0]?.contenido ?? PLANTILLAS_V1[p.tipo]
}

export default function PlantillasClient({ pantallasIniciales }: { pantallasIniciales: PantallaPlantilla[] }) {
  const [pantallas, setPantallas] = useState(pantallasIniciales)
  const [tipo, setTipo] = useState<TipoPlantilla>(pantallasIniciales[0]?.tipo ?? 'declaracion-juramentada')
  const pantalla = pantallas.find((p) => p.tipo === tipo)
  const [borradores, setBorradores] = useState<Record<string, string>>(() =>
    Object.fromEntries(pantallasIniciales.map((p) => [p.tipo, textoInicial(p)])),
  )
  const [vista, setVista] = useState<Vista>('editar')

  if (!pantalla) {
    return <p className="p-6 text-sm text-muted-foreground">No se pudieron leer las plantillas.</p>
  }

  const def = defDe(tipo)
  const contenido = borradores[tipo] ?? ''
  const setContenido = (c: string) => setBorradores((b) => ({ ...b, [tipo]: c }))
  const activa = pantalla.versiones.find((v) => v.id === pantalla.activaId) ?? null

  const recargar = async () => {
    const r = await leerPlantilla(tipo)
    if (r.ok) setPantallas((ps) => ps.map((p) => (p.tipo === tipo ? r.pantalla : p)))
    else toast.error(r.error)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/mi-negocio" className="rounded-md p-1.5 hover:bg-muted" aria-label="Volver a Configuración">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-base font-bold">Plantillas de documentos</h1>
          <p className="text-xs text-muted-foreground">El texto de los documentos que ONE genera en tus negocios.</p>
        </div>
      </div>

      {/* Documento */}
      <div className="flex gap-2 overflow-x-auto">
        {pantallas.map((p) => (
          <button
            key={p.tipo}
            onClick={() => setTipo(p.tipo)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${p.tipo === tipo ? 'border-primary bg-primary/10 text-primary' : 'bg-card'}`}
          >
            {defDe(p.tipo).nombre}
          </button>
        ))}
      </div>

      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
        <p>
          {activa ? (
            <span className="flex items-center gap-1.5 text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              Activa: versión {activa.version_n}
              {pantalla.activadaAt ? `, desde el ${fecha(pantalla.activadaAt)}` : ''}.
            </span>
          ) : (
            <span>Sin versión activa: el documento sale con el formato de fábrica.</span>
          )}
        </p>
        <p>Solo los documentos que se generen o regeneren después de activar cambian; los ya generados quedan como están.</p>
        <p className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Pueden editar: {pantalla.editores.join(', ') || '—'}.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border bg-card p-1">
        {([
          ['editar', 'Editar', PenLine],
          ['previa', 'Vista previa', Eye],
          ['historial', 'Historial', History],
        ] as const).map(([k, etiqueta, Icono]) => (
          <button
            key={k}
            onClick={() => setVista(k)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${vista === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
          >
            <Icono className="h-3.5 w-3.5" /> {etiqueta}
          </button>
        ))}
      </div>

      {vista === 'editar' && (
        <Editor
          key={tipo}
          tipo={tipo}
          contenido={contenido}
          setContenido={setContenido}
          ultima={pantalla.versiones[0] ?? null}
          activaId={pantalla.activaId}
          onGuardado={recargar}
          onVerPrevia={() => setVista('previa')}
        />
      )}
      {vista === 'previa' && <VistaPrevia key={tipo} tipo={tipo} contenido={contenido} />}
      {vista === 'historial' && (
        <Historial
          pantalla={pantalla}
          onCambio={recargar}
          onUsar={(v) => {
            setContenido(v.contenido)
            setVista('editar')
            toast.success(`Cargaste la versión ${v.version_n} en el editor. Guárdala para crear una versión nueva.`)
          }}
        />
      )}

      <p className="text-[11px] text-muted-foreground">{def.descripcion}</p>
    </div>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────

function Editor({
  tipo, contenido, setContenido, ultima, activaId, onGuardado, onVerPrevia,
}: {
  tipo: TipoPlantilla
  contenido: string
  setContenido: (c: string) => void
  ultima: VersionPlantilla | null
  activaId: string | null
  onGuardado: () => Promise<void>
  onVerPrevia: () => void
}) {
  const def = defDe(tipo)
  const area = useRef<HTMLTextAreaElement>(null)
  const [nota, setNota] = useState('')
  const [guardando, startGuardar] = useTransition()
  const [recienGuardada, setRecienGuardada] = useState<VersionPlantilla | null>(null)
  const validacion = useMemo(() => validarPlantilla(tipo, contenido), [tipo, contenido])
  const sucio = contenido !== (ultima?.contenido ?? PLANTILLAS_V1[tipo])

  /** Envuelve la selección (o inserta en el cursor) y deja el cursor dentro. */
  const envolver = (antes: string, despues = '', relleno = '') => {
    const ta = area.current
    if (!ta) return
    const { selectionStart: i, selectionEnd: f } = ta
    const sel = contenido.slice(i, f) || relleno
    const nuevo = contenido.slice(0, i) + antes + sel + despues + contenido.slice(f)
    setContenido(nuevo)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(i + antes.length, i + antes.length + sel.length)
    })
  }
  /** Bloque: las etiquetas van solas en su renglón. */
  const bloque = (nombre: string, arg = '') => {
    const ta = area.current
    if (!ta) return
    const { selectionStart: i } = ta
    const alInicio = i === 0 || contenido[i - 1] === '\n'
    envolver(`${alInicio ? '' : '\n'}{{#${nombre}${arg ? ` ${arg}` : ''}}}\n`, `\n{{/${nombre}}}\n`, 'Texto')
  }
  const lineaSola = (texto: string) => {
    const ta = area.current
    if (!ta) return
    const alInicio = ta.selectionStart === 0 || contenido[ta.selectionStart - 1] === '\n'
    envolver(`${alInicio ? '' : '\n'}${texto}`, '\n')
  }

  const guardar = () =>
    startGuardar(async () => {
      const r = await guardarVersionPlantilla(tipo, contenido, nota)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setNota('')
      setRecienGuardada(r.version)
      if (r.faltantes.length > 0) toast.warning(`Guardada la versión ${r.version.version_n}. Para activarla le falta: ${r.faltantes.join(', ')}.`)
      else toast.success(`Guardada la versión ${r.version.version_n}. Revísala en la vista previa y actívala.`)
      await onGuardado()
    })

  const activar = (v: VersionPlantilla) =>
    startGuardar(async () => {
      const r = await activarVersionPlantilla(v.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`Versión ${v.version_n} activa. Los documentos que se generen desde ahora salen con este texto.`)
      setRecienGuardada(null)
      await onGuardado()
    })

  const btn = 'flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted'

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button className={btn} onClick={() => envolver('**', '**', 'negrita')} title="Negrita"><Bold className="h-3.5 w-3.5" /></button>
        <button className={btn} onClick={() => lineaSola('# ')} title="Título"><Heading1 className="h-3.5 w-3.5" /></button>
        <button className={btn} onClick={() => lineaSola('## ')} title="Subtítulo"><Heading2 className="h-3.5 w-3.5" /></button>
        <button className={btn} onClick={() => bloque('centrado')} title="Centrar"><AlignCenter className="h-3.5 w-3.5" /></button>
        <button className={btn} onClick={() => bloque('justificado')} title="Justificar"><AlignJustify className="h-3.5 w-3.5" /></button>
        <button className={btn} onClick={() => lineaSola('|! Etiqueta | Valor |')} title="Fila de tabla"><Table2 className="h-3.5 w-3.5" /> Tabla</button>
        <button className={btn} onClick={() => bloque('junto')} title="No partir entre hojas">Junto</button>
        <button className={btn} onClick={() => bloque('firmas')} title="Firma por titular">Firmas</button>
        <button className={btn} onClick={() => lineaSola('---')} title="Raya de firma"><Minus className="h-3.5 w-3.5" /> Raya</button>
        <button className={btn} onClick={() => envolver('{{#cada titular}}', '{{/cada}}')} title="Repetir por titular">Por titular</button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-xs"
          value=""
          onChange={(e) => { if (e.target.value) envolver(`{{${e.target.value}}}`) }}
          aria-label="Insertar dato"
        >
          <option value="">+ Insertar dato del expediente…</option>
          {Object.entries(agrupar([...def.variables, ...def.variablesTitular])).map(([grupo, vars]) => (
            <optgroup key={grupo} label={grupo === 'Por titular' ? 'Por titular (dentro de «Por titular» o «Firmas»)' : grupo}>
              {vars.map((v) => <option key={v.nombre} value={v.nombre}>{v.etiqueta}</option>)}
            </optgroup>
          ))}
        </select>
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-xs"
          value=""
          onChange={(e) => { if (e.target.value) envolver(`{{#si ${e.target.value}}}`, '{{sino}}{{/si}}') }}
          aria-label="Insertar condición"
        >
          <option value="">+ Insertar condición…</option>
          {[...def.condiciones, ...def.condicionesTitular].map((c) => <option key={c.nombre} value={c.nombre}>{c.etiqueta}</option>)}
        </select>
      </div>

      <textarea
        ref={area}
        value={contenido}
        onChange={(e) => setContenido(e.target.value)}
        spellCheck={false}
        rows={22}
        className="w-full rounded-lg border bg-background p-3 font-mono text-[12px] leading-relaxed"
        aria-label="Texto de la plantilla"
      />

      {/* Validación en vivo */}
      {validacion.errores.length > 0 ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-medium text-destructive">No se puede guardar todavía:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {validacion.errores.slice(0, 8).map((e, i) => <li key={i}>Renglón {e.linea}: {e.mensaje}</li>)}
          </ul>
        </div>
      ) : validacion.faltantes.length > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          Se puede guardar, pero no activar: falta {validacion.faltantes.join(', ')} (fuera de una condición).
        </div>
      ) : (
        <p className="text-xs text-primary">La plantilla está completa.</p>
      )}

      <details className="rounded-lg border bg-card p-3 text-xs">
        <summary className="cursor-pointer font-medium">Ver como bloques</summary>
        <div className="mt-2"><MapaDeBloques bloques={validacion.doc.bloques} tipo={tipo} /></div>
      </details>

      <details className="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Cómo se escribe</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li><code>**texto**</code> negrita. <code># Título</code> y <code>## Subtítulo</code> al empezar el renglón.</li>
          <li>Un renglón en blanco separa párrafos; un salto simple se respeta.</li>
          <li>Los datos del expediente se insertan con «Insertar dato»; quedan como <code>{'{{nombre}}'}</code>.</li>
          <li>Condición: <code>{'{{#si dos_titulares}}'}</code>…<code>{'{{sino}}'}</code>…<code>{'{{/si}}'}</code>. Sola en su renglón abarca párrafos enteros.</li>
          <li>Tabla: un renglón por fila, <code>|! Etiqueta | Valor |</code>; <code>|# Título</code> es la franja oscura.</li>
          <li><code>{'{{#firmas}}'}</code>…<code>{'{{/firmas}}'}</code> se repite por titular en columnas; <code>---</code> es la raya de firma.</li>
        </ul>
      </details>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={300}
          placeholder="Qué cambiaste (opcional)"
          className="flex-1 rounded-md border bg-background px-2 py-1.5 text-xs"
        />
        <button
          onClick={onVerPrevia}
          className="flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <Eye className="h-3.5 w-3.5" /> Vista previa
        </button>
        <button
          onClick={guardar}
          disabled={guardando || !sucio || validacion.errores.length > 0}
          className="flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Guardar versión
        </button>
      </div>

      {recienGuardada && recienGuardada.id !== activaId && (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span>La versión {recienGuardada.version_n} está guardada como borrador.</span>
          <button
            onClick={() => activar(recienGuardada)}
            disabled={guardando || validarPlantilla(tipo, recienGuardada.contenido).faltantes.length > 0}
            className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
          >
            Activar versión {recienGuardada.version_n}
          </button>
        </div>
      )}
    </div>
  )
}

function agrupar<T extends { grupo: string }>(xs: T[]): Record<string, T[]> {
  const r: Record<string, T[]> = {}
  for (const x of xs) (r[x.grupo] ??= []).push(x)
  return r
}

// ── Bloques (estructura) ────────────────────────────────────────────────────

function etiquetaDeVar(tipo: TipoPlantilla, nombre: string): string {
  const d = defDe(tipo)
  return [...d.variables, ...d.variablesTitular].find((v) => v.nombre === nombre)?.etiqueta ?? nombre
}
function etiquetaDeCond(tipo: TipoPlantilla, nombre: string): string {
  const d = defDe(tipo)
  return [...d.condiciones, ...d.condicionesTitular].find((c) => c.nombre === nombre)?.etiqueta ?? nombre
}

function Linea({ nodos, tipo }: { nodos: Inline[]; tipo: TipoPlantilla }) {
  return (
    <>
      {nodos.map((n, i) => {
        switch (n.t) {
          case 'texto': return <span key={i}>{n.v}</span>
          case 'salto': return <br key={i} />
          case 'var': return <span key={i} className="mx-0.5 rounded bg-primary/15 px-1 text-primary">{etiquetaDeVar(tipo, n.nombre)}</span>
          case 'negrita': return <strong key={i}><Linea nodos={n.hijos} tipo={tipo} /></strong>
          case 'si':
            return (
              <span key={i} className="mx-0.5 rounded border border-dashed border-amber-400 px-1">
                <span className="text-amber-700">{etiquetaDeCond(tipo, n.cond)}: </span>
                <Linea nodos={n.si} tipo={tipo} />
                {n.sino.length > 0 && <><span className="text-amber-700"> · si no: </span><Linea nodos={n.sino} tipo={tipo} /></>}
              </span>
            )
          case 'cada':
            return <span key={i} className="mx-0.5 rounded border border-dashed border-sky-400 px-1"><span className="text-sky-700">Por titular: </span><Linea nodos={n.hijos} tipo={tipo} /></span>
        }
      })}
    </>
  )
}

function MapaDeBloques({ bloques, tipo }: { bloques: Bloque[]; tipo: TipoPlantilla }) {
  const marco = (titulo: string, color: string, hijos: React.ReactNode, key: number) => (
    <div key={key} className={`rounded-md border-l-4 ${color} bg-muted/30 p-2`}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <div className="space-y-1.5">{hijos}</div>
    </div>
  )
  return (
    <div className="space-y-1.5">
      {bloques.map((b, i) => {
        switch (b.t) {
          case 'parrafo': return <p key={i} className="leading-relaxed"><Linea nodos={b.hijos} tipo={tipo} /></p>
          case 'titulo': return <p key={i} className={b.nivel === 1 ? 'text-sm font-bold' : 'font-bold'}><Linea nodos={b.hijos} tipo={tipo} /></p>
          case 'linea_firma': return <hr key={i} className="border-foreground/60" />
          case 'tabla':
            return (
              <table key={i} className="w-full border-collapse text-[11px]">
                <tbody>
                  {b.filas.map((f, j) => (
                    <tr key={j}>{f.map((c, k) => (
                      <td key={k} className={`border p-1 ${c.tipo === 'etiqueta' ? 'bg-muted font-semibold' : c.tipo === 'titulo' ? 'bg-slate-700 font-semibold text-white' : ''}`}>
                        <Linea nodos={c.hijos} tipo={tipo} />
                      </td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            )
          case 'alineado': return marco(b.alin, 'border-slate-300', <MapaDeBloques bloques={b.hijos} tipo={tipo} />, i)
          case 'junto': return marco('No se parte entre hojas', 'border-slate-400', <MapaDeBloques bloques={b.hijos} tipo={tipo} />, i)
          case 'firmas': return marco('Firmas (una por titular)', 'border-sky-400', <MapaDeBloques bloques={b.hijos} tipo={tipo} />, i)
          case 'cada': return marco('Por titular', 'border-sky-400', <MapaDeBloques bloques={b.hijos} tipo={tipo} />, i)
          case 'si':
            return marco(etiquetaDeCond(tipo, b.cond), 'border-amber-400', (
              <>
                <MapaDeBloques bloques={b.si} tipo={tipo} />
                {b.sino.length > 0 && <><p className="text-[10px] font-semibold uppercase text-amber-700">Si no</p><MapaDeBloques bloques={b.sino} tipo={tipo} /></>}
              </>
            ), i)
        }
      })}
    </div>
  )
}

// ── Vista previa ────────────────────────────────────────────────────────────

function VistaPrevia({ tipo, contenido }: { tipo: TipoPlantilla; contenido: string }) {
  const def = defDe(tipo)
  const [texto, setTexto] = useState('')
  const [negocios, setNegocios] = useState<Array<{ id: string; codigo: string | null; nombre: string }>>([])
  const [elegido, setElegido] = useState<{ id: string; etiqueta: string } | null>(null)
  const [datos, setDatos] = useState<Datos>(def.ejemplo)
  const [codigo, setCodigo] = useState('EJEMPLO')
  const [faltantes, setFaltantes] = useState<string[]>([])
  const [cargando, startCargar] = useTransition()
  const [imprimiendo, setImprimiendo] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const contenedor = useRef<HTMLDivElement>(null)
  const [escala, setEscala] = useState(1)

  const resultado = useMemo(
    () => htmlDelDocumento(tipo, contenido, datos, { fechaGeneracion: new Date().toISOString(), codigoNegocio: codigo }),
    [tipo, contenido, datos, codigo],
  )

  // La hoja mide 8,5 in (816 px): en el celular se escala al ancho disponible.
  useEffect(() => {
    const medir = () => setEscala(Math.min(1, (contenedor.current?.clientWidth ?? 816) / 816))
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [])
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  const buscar = () =>
    startCargar(async () => {
      const r = await buscarNegociosParaVista(tipo, texto)
      if (!r.ok) { toast.error(r.error); return }
      setNegocios(r.negocios)
      if (r.negocios.length === 0) toast.info('Ningún negocio con ese código o nombre genera este documento.')
    })

  const elegir = (n: { id: string; codigo: string | null; nombre: string }) =>
    startCargar(async () => {
      const r = await datosParaVistaPrevia(tipo, n.id)
      if (!r.ok) { toast.error(r.error); return }
      setElegido({ id: n.id, etiqueta: `${n.codigo ?? ''} ${n.nombre}`.trim() })
      setDatos(r.datos)
      setCodigo(r.codigo)
      setFaltantes(r.faltantes)
      setNegocios([])
      setPdfUrl(null)
    })

  const usarEjemplo = () => {
    setElegido(null)
    setDatos(def.ejemplo)
    setCodigo('EJEMPLO')
    setFaltantes([])
    setPdfUrl(null)
  }

  const verPdf = async () => {
    setImprimiendo(true)
    try {
      const res = await fetchPropio('/api/plantillas-documento/vista-previa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, contenido, negocioId: elegido?.id ?? null }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: 'No se pudo generar el PDF.' }))
        toast.error(e.error ?? 'No se pudo generar el PDF.')
        return
      }
      const url = URL.createObjectURL(await res.blob())
      setPdfUrl(url)
      window.open(url, '_blank', 'noopener')
    } finally {
      setImprimiendo(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <p className="text-xs font-medium">Con qué datos</p>
        <div className="flex gap-2">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') buscar() }}
            placeholder="Código o nombre del negocio"
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-xs"
          />
          <button onClick={buscar} disabled={cargando} className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs hover:bg-muted">
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Buscar
          </button>
        </div>
        {negocios.length > 0 && (
          <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
            {negocios.map((n) => (
              <li key={n.id}>
                <button onClick={() => elegir(n)} className="w-full px-2 py-1.5 text-left text-xs hover:bg-muted">
                  <span className="font-medium">{n.codigo}</span> {n.nombre}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          {elegido ? <>Datos de <span className="font-medium text-foreground">{elegido.etiqueta}</span>. <button className="underline" onClick={usarEjemplo}>Usar datos de ejemplo</button></> : 'Datos de ejemplo.'}
          {' '}Solo lectura: la vista previa no genera el documento del negocio ni sube nada a Drive.
        </p>
        {faltantes.length > 0 && (
          <p className="text-xs text-amber-700">Este negocio aún no se puede generar: faltan {faltantes.join(', ')}.</p>
        )}
      </div>

      {!resultado.ok ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {resultado.errores.slice(0, 5).map((e, i) => <p key={i}>{e}</p>)}
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              onClick={verPdf}
              disabled={imprimiendo}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {imprimiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Ver el PDF
            </button>
          </div>
          {pdfUrl && (
            <p className="text-right text-xs"><a href={pdfUrl} target="_blank" rel="noopener" className="underline">Abrir el PDF otra vez</a></p>
          )}
          <div ref={contenedor} className="overflow-hidden rounded-lg border bg-muted">
            <div style={{ height: 1056 * escala + 20 }}>
              {/* sandbox vacío: sin scripts, sin formularios, sin navegación. Es el mismo HTML del PDF. */}
              <iframe
                title="Vista previa del documento"
                sandbox=""
                srcDoc={resultado.html}
                style={{ width: 816, height: 1056 + 20, transform: `scale(${escala})`, transformOrigin: 'top left', border: 0 }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Historial ───────────────────────────────────────────────────────────────

function Historial({
  pantalla, onCambio, onUsar,
}: {
  pantalla: PantallaPlantilla
  onCambio: () => Promise<void>
  onUsar: (v: VersionPlantilla) => void
}) {
  const [trabajando, startTrabajo] = useTransition()
  const [viendo, setViendo] = useState<string | null>(null)
  const activa = pantalla.versiones.find((v) => v.id === pantalla.activaId) ?? null

  const activar = (v: VersionPlantilla) =>
    startTrabajo(async () => {
      const r = await activarVersionPlantilla(v.id)
      if (!r.ok) { toast.error(r.error); return }
      toast.success(`Versión ${v.version_n} activa.`)
      await onCambio()
    })
  const restaurar = (v: VersionPlantilla) =>
    startTrabajo(async () => {
      const r = await restaurarVersionPlantilla(v.id)
      if (!r.ok) { toast.error(r.error); return }
      toast.success(`Se creó la versión ${r.version.version_n}, igual a la ${v.version_n}, y quedó activa.`)
      await onCambio()
    })

  if (pantalla.versiones.length === 0) {
    return <p className="rounded-lg border bg-card p-4 text-xs text-muted-foreground">Todavía no hay versiones guardadas.</p>
  }

  return (
    <ul className="space-y-2">
      {pantalla.versiones.map((v) => {
        const esActiva = v.id === pantalla.activaId
        // Lo posterior a la activa (o todo, si no hay activa) se ACTIVA; lo anterior se RESTAURA.
        const posterior = !activa || v.version_n > activa.version_n
        return (
          <li key={v.id} className={`rounded-lg border bg-card p-3 text-xs ${esActiva ? 'border-primary' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  Versión {v.version_n}
                  {esActiva && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">Activa</span>}
                </p>
                <p className="text-muted-foreground">{v.creada_por_nombre ?? 'Sin autor'} · {fecha(v.created_at)}</p>
                {v.nota && <p className="mt-0.5">{v.nota}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setViendo(viendo === v.id ? null : v.id)} className="rounded-md border px-2 py-1 hover:bg-muted">
                  <Eye className="mr-1 inline h-3.5 w-3.5" />Ver
                </button>
                <button onClick={() => onUsar(v)} className="rounded-md border px-2 py-1 hover:bg-muted">
                  <PenLine className="mr-1 inline h-3.5 w-3.5" />Editar desde aquí
                </button>
                {!esActiva && posterior && (
                  <button onClick={() => activar(v)} disabled={trabajando} className="rounded-md bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50">
                    Activar
                  </button>
                )}
                {!esActiva && !posterior && (
                  <button onClick={() => restaurar(v)} disabled={trabajando} className="rounded-md border px-2 py-1 hover:bg-muted disabled:opacity-50">
                    <RotateCcw className="mr-1 inline h-3.5 w-3.5" />Restaurar
                  </button>
                )}
              </div>
            </div>
            {viendo === v.id && (
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-[11px]">{v.contenido}</pre>
            )}
          </li>
        )
      })}
    </ul>
  )
}
