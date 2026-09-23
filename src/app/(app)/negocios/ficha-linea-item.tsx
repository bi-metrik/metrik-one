'use client'

import { useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Pencil, RotateCcw, X } from 'lucide-react'

import type { DefinicionRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import { CAMPOS_DE_COSTO, type Correcciones } from '@/lib/cotizaciones/correcciones'
import { cifrasPorRevisar, fichaDeLinea, valorLegible, type CampoDeFicha } from '@/lib/cotizaciones/ficha-linea'
import { busquedaDeCategoria } from '@/lib/cotizaciones/estrellas'
import { formatBogotaFechaCorta } from '@/lib/dates/bogota'

/**
 * La ficha de la línea: lo que leyó la IA, corregible campo por campo.
 *
 * Brief del 2026-09-22, punto 3: *«todos los campos extraídos con IA dentro de la cotización
 * deben poderse editar»*, en el mismo lugar donde se ven. Aquí es donde se ven: «Ver lo
 * leído» de la captura principal.
 *
 * Lo que decide qué se corrige, cómo se valida y qué se imprime vive en `ficha-linea.ts` y
 * `correcciones.ts`, el MISMO módulo que usa la server action: si la pantalla tuviera su
 * propia regla, lo que acepta y lo que guarda el servidor se separarían en silencio.
 *
 * ⚠️ Una corrección se ve SIEMPRE junto con lo que dijo la IA. Esconder la lectura original
 * haría pasar un dato corregido por uno leído, y es la única forma de notar que el pantallazo
 * nuevo ya dice otra cosa que la corrección vieja.
 */
export default function FichaDeLinea({
  ranura,
  campos,
  moneda = null,
  correcciones,
  deshabilitado,
  onGuardar,
}: {
  ranura: DefinicionRanura
  /** `LecturaCasilla.campos` de la captura principal. */
  campos: { label: string; valor: string }[]
  /** `LecturaCasilla.moneda`: la de los montos que no traen la suya. */
  moneda?: string | null
  correcciones: Correcciones | undefined
  deshabilitado: boolean
  /** `valor: null` vuelve a lo leído; un texto (incluso vacío) corrige. */
  onGuardar: (slug: string, valor: string | null) => Promise<boolean>
}) {
  const ficha = fichaDeLinea(ranura, campos, correcciones, moneda)
  const vigente = (slug: string) => ficha.find(c => c.slug === slug)?.vigente ?? null
  const deCosto = campos.filter(c => ranura.campos.some(d => d.label === c.label && CAMPOS_DE_COSTO.includes(d.slug)))
  // La marca de los montos de costo sale del MISMO criterio que la de la ficha: no se corrigen
  // aquí, pero la cifra se ve aquí, y es aquí donde tiene que decir que se revise.
  const porRevisar = cifrasPorRevisar(ranura, campos, correcciones, moneda)
  const slugDe = (label: string) => ranura.campos.find(d => d.label === label)?.slug ?? ''

  return (
    <div className="mt-1 space-y-2">
      <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
        {ficha.map(c => (
          <FilaDeFicha
            key={c.slug}
            campo={c}
            deshabilitado={deshabilitado}
            onGuardar={onGuardar}
            busqueda={c.slug === 'estrellas' && c.vigente === null ? busquedaDeCategoria(vigente('hotel'), vigente('ciudad')) : null}
          />
        ))}
      </div>
      {deCosto.length > 0 && (
        <div className="border-t pt-1.5">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
            Lo que entra al costo · se corrige en los rubros, los pasajeros o el margen de la línea
          </p>
          <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
            {deCosto.map(c => {
              const revisar = porRevisar.has(slugDe(c.label))
              return (
                <div key={c.label} className={`min-w-0 ${revisar ? 'rounded bg-amber-50 px-1' : ''}`}>
                  <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">{c.label}</span>
                  <span className="block truncate text-[11px]">{c.valor}</span>
                  {revisar && <AvisoRevisarCifra />}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function FilaDeFicha({
  campo,
  deshabilitado,
  onGuardar,
  busqueda,
}: {
  campo: CampoDeFicha
  deshabilitado: boolean
  onGuardar: (slug: string, valor: string | null) => Promise<boolean>
  /** Enlace a una búsqueda normal de Google, para la categoría que la captura no mostró. */
  busqueda: string | null
}) {
  const [editando, setEditando] = useState(false)
  const [borrador, setBorrador] = useState('')
  const [guardando, setGuardando] = useState(false)
  const corregido = campo.correccion !== null

  async function guardar(valor: string | null) {
    setGuardando(true)
    const ok = await onGuardar(campo.slug, valor)
    setGuardando(false)
    if (ok) setEditando(false)
  }

  function empezar() {
    setBorrador(valorInicialDelEditor(campo))
    setEditando(true)
  }

  return (
    <div className={`min-w-0 rounded px-1 py-0.5 ${campo.revisarCifra && !editando ? 'bg-amber-50' : 'hover:bg-muted/40'}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">{campo.label}</span>
        {!editando && (
          <button
            type="button"
            disabled={deshabilitado || guardando}
            onClick={empezar}
            aria-label={`Corregir ${campo.label}`}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
        )}
      </div>

      {editando ? (
        <div className="flex flex-wrap items-center gap-1">
          <Editor campo={campo} valor={borrador} onChange={setBorrador} />
          <button
            type="button"
            disabled={guardando}
            onClick={() => guardar(borrador)}
            aria-label="Guardar corrección"
            className="rounded bg-primary p-1 text-primary-foreground disabled:opacity-50"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={() => setEditando(false)}
            aria-label="Cancelar"
            className="rounded border p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <span className={`block truncate text-[11px] ${corregido ? 'font-medium text-foreground' : ''}`}>
          {valorLegible(campo.tipo, campo.vigente)}
          {campo.slug === 'estrellas' && campo.vigente && ' estrellas'}
        </span>
      )}

      {campo.revisarCifra && !editando && <AvisoRevisarCifra />}

      {corregido && !editando && (
        <div className="flex flex-wrap items-center gap-x-1.5 text-[9px] text-amber-800">
          <span>
            Corregido{campo.correccion?.por ? ` por ${campo.correccion.por}` : ''}
            {campo.correccion?.en ? ` · ${formatBogotaFechaCorta(campo.correccion.en)}` : ''}
          </span>
          <span className="text-muted-foreground">· la lectura decía {valorLegible(campo.tipo, campo.leido)}</span>
          <button
            type="button"
            disabled={deshabilitado || guardando}
            onClick={() => guardar(null)}
            className="inline-flex items-center gap-0.5 font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RotateCcw className="h-2.5 w-2.5" /> Volver a lo leído
          </button>
        </div>
      )}
      {!corregido && !editando && campo.slug === 'estrellas' && (
        <span className="block text-[9px] text-muted-foreground">
          {campo.vigente ? 'Leído del pantallazo' : 'El pantallazo no la mostraba'}
          {busqueda && (
            <>
              {' · '}
              <a href={busqueda} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline hover:text-foreground">
                Buscar su categoría <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * «Revisa esta cifra»: un monto en pesos por debajo de mil (`cifraInverosimil`).
 *
 * Persistente y al lado del dato, no un toast: la cifra ya está guardada y lo que se pide es
 * mirarla contra la captura. Casi siempre es un punto de miles leído como decimal («50.080» que
 * quedó en 50,08), y así llegaba al documento del cliente.
 */
function AvisoRevisarCifra() {
  return (
    <span className="mt-0.5 flex items-start gap-0.5 text-[9px] font-medium text-amber-800">
      <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0" />
      Revisa esta cifra: en pesos, menos de $1.000 casi nunca es real
    </span>
  )
}

/** Lo que el editor muestra al abrirse: lo vigente, en la forma que su control entiende. */
function valorInicialDelEditor(c: CampoDeFicha): string {
  const v = c.vigente ?? ''
  // Una fecha sin año («--10-23») no la entiende un control de fecha: se abre vacío y la
  // persona la escribe completa.
  if (c.tipo === 'fecha') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
  return v
}

function Editor({ campo, valor, onChange }: { campo: CampoDeFicha; valor: string; onChange: (v: string) => void }) {
  const clase = 'min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 text-[11px]'
  const etiqueta = `${campo.label}, valor corregido`
  if (campo.slug === 'estrellas') {
    return (
      <select value={valor} onChange={e => onChange(e.target.value)} aria-label={etiqueta} className={clase}>
        <option value="">Sin categoría</option>
        {[1, 2, 3, 4, 5].map(n => <option key={n} value={String(n)}>{n} {n === 1 ? 'estrella' : 'estrellas'}</option>)}
      </select>
    )
  }
  if (campo.tipo === 'boolean') {
    return (
      <select value={valor} onChange={e => onChange(e.target.value)} aria-label={etiqueta} className={clase}>
        <option value="">Sin dato</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
    )
  }
  if (campo.tipo === 'fecha') {
    return <input type="date" value={valor} onChange={e => onChange(e.target.value)} aria-label={etiqueta} className={clase} />
  }
  if (campo.slug.startsWith('hora_')) {
    return <input type="time" value={valor} onChange={e => onChange(e.target.value)} aria-label={etiqueta} className={clase} />
  }
  if (campo.tipo === 'numero') {
    return <input type="number" min={0} step={1} value={valor} onChange={e => onChange(e.target.value)} aria-label={etiqueta} className={clase} />
  }
  return (
    <input
      type="text"
      inputMode={campo.tipo === 'currency' ? 'decimal' : undefined}
      value={valor}
      onChange={e => onChange(e.target.value)}
      aria-label={etiqueta}
      className={clase}
    />
  )
}
