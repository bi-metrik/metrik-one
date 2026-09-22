'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { AlertTriangle, Loader2, Lock, Percent, Save, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getMargenPorLinea,
  guardarRecargo,
  guardarUmbralesMargen,
  type CambioRegistrado,
  type LineaConMargen,
} from './margen-actions'
import { nombreDelMargen } from '@/lib/cotizaciones/convencion-margen'
import { ETIQUETA, motivoUmbralesInvalidos, vuelosEnPalabras } from '@/lib/cotizaciones/politica-de-linea'
import type { VuelosDelRecargo } from '@/lib/cotizaciones/recargo-linea'
import { formatBogotaFechaHora } from '@/lib/dates/bogota'

/**
 * Margen y recargo de cada línea, editables por el dueño sin pasar por SQL.
 *
 * Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-margen-y-recargo-configurables.md`.
 * Tres valores: el margen mínimo para aprobar una cotización, el aviso de margen bajo y
 * el recargo por vuelo (cuánto y a qué vuelos). Se configuran POR LÍNEA porque la
 * pregunta —«¿a partir de qué margen este trabajo deja de valer la pena?»— es de la
 * línea, no de la empresa.
 *
 * Los textos son los del dueño del negocio, no los del sistema: «margen mínimo», no
 * «piso»; «vuelos internacionales», no «vuelo_detalle». Viven en `ETIQUETA` porque son
 * las mismas palabras que quedan escritas en el historial de cambios.
 *
 * La convención del margen y el margen con que nace cada ítem se MUESTRAN pero no se
 * editan aquí: cambiarlos mueve el PRECIO de lo que se cotice después, y esa es otra
 * decisión con otras consecuencias.
 */
export default function MargenSection() {
  const [cargando, setCargando] = useState(true)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [lineas, setLineas] = useState<LineaConMargen[]>([])
  const [historial, setHistorial] = useState<CambioRegistrado[]>([])

  const aplicar = useCallback((res: Awaited<ReturnType<typeof getMargenPorLinea>>) => {
    setCargando(false)
    if ('error' in res) { toast.error(res.error); return }
    setPuedeEditar(res.puedeEditar)
    setLineas(res.lineas)
    setHistorial(res.historial)
  }, [])

  useEffect(() => { getMargenPorLinea().then(aplicar) }, [aplicar])

  // Después de guardar se relee todo: el historial nuevo sale de la base, no se inventa
  // en el navegador, y así la pantalla muestra lo que de verdad quedó escrito.
  const recargar = useCallback(async () => { aplicar(await getMargenPorLinea()) }, [aplicar])

  if (cargando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )
  }

  if (lineas.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Ninguna línea de este negocio usa margen mínimo ni recargo.
      </p>
    )
  }

  return (
    <div className="space-y-4 p-1">
      <p className="text-xs text-muted-foreground">
        Mientras se arma una cotización, cada línea y el total muestran su margen real. Estos
        valores deciden cuándo esa cifra se marca y cuándo un vuelo lleva recargo.{' '}
        <strong>Aplican a las cotizaciones que se creen desde ahora:</strong> una cotización ya
        creada conserva su margen mínimo y su aviso, y una que ya lleva el recargo conserva su
        valor.
      </p>

      {lineas.map((linea) => (
        <FilaLinea
          key={linea.id}
          linea={linea}
          puedeEditar={puedeEditar}
          historial={historial.filter(h => h.lineaId === linea.id)}
          onGuardado={recargar}
        />
      ))}

      {!puedeEditar && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" />
          Solo el dueño o un administrador pueden cambiar estos valores.
        </p>
      )}
    </div>
  )
}

function FilaLinea({
  linea,
  puedeEditar,
  historial,
  onGuardado,
}: {
  linea: LineaConMargen
  puedeEditar: boolean
  historial: CambioRegistrado[]
  onGuardado: () => Promise<void>
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{linea.nombre}</span>
        {/* La convención se muestra porque cambia lo que SIGNIFICA el margen que se
            escribe en la cotización, y sin ella estos números se leen contra la cifra
            equivocada. No se edita aquí: eso mueve precios. */}
        <span className="text-[10px] text-muted-foreground">
          {linea.convencion === 'sobre_venta' ? 'Margen sobre la venta' : `${nombreDelMargen(linea.convencion)} sobre el costo`}
          {' '}· cada ítem nace en {linea.defaultPct}%
        </span>
      </div>

      <BloqueMargen linea={linea} puedeEditar={puedeEditar} onGuardado={onGuardado} />
      <BloqueRecargo linea={linea} puedeEditar={puedeEditar} onGuardado={onGuardado} />
      <Historial cambios={historial} />
    </div>
  )
}

function BloqueMargen({
  linea,
  puedeEditar,
  onGuardado,
}: {
  linea: LineaConMargen
  puedeEditar: boolean
  onGuardado: () => Promise<void>
}) {
  const [piso, setPiso] = useState(String(linea.pisoPct))
  const [aviso, setAviso] = useState(String(linea.avisoPct))
  const [guardando, startGuardar] = useTransition()

  const valores = { pisoPct: Number(piso), avisoPct: Number(aviso) }
  const sucio = valores.pisoPct !== linea.pisoPct || valores.avisoPct !== linea.avisoPct
  // La misma regla que valida el servidor, para decirlo antes de apretar el botón.
  const motivo = piso.trim() === '' || aviso.trim() === ''
    ? 'Escribe los dos porcentajes.'
    : motivoUmbralesInvalidos(valores)

  const guardar = () =>
    startGuardar(async () => {
      const res = await guardarUmbralesMargen(linea.id, valores)
      if ('error' in res) { toast.error(res.error); return }
      toast.success(sucio ? `Margen de "${linea.nombre}" guardado` : `Margen de "${linea.nombre}" confirmado`)
      await onGuardado()
    })

  const ayudaMinimo = linea.frenaAvance === true
    ? 'Por debajo de este margen, la cotización no puede pasar a la siguiente etapa.'
    : linea.frenaAvance === false
      ? 'Por debajo de este margen, la cotización se marca en rojo.'
      : 'Por debajo de este margen, la cotización se marca en rojo y, donde el control está encendido, no avanza.'

  return (
    <div>
      <EncabezadoBloque titulo="Margen" provisional={linea.margenProvisional} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CampoPct
          etiqueta={ETIQUETA.piso}
          ayuda={ayudaMinimo}
          valor={piso}
          onChange={setPiso}
          disabled={!puedeEditar || guardando}
        />
        <CampoPct
          etiqueta={ETIQUETA.aviso}
          ayuda="Por debajo de este margen se avisa, pero la cotización sigue."
          valor={aviso}
          onChange={setAviso}
          disabled={!puedeEditar || guardando}
        />
      </div>

      {puedeEditar && motivo && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-red-600">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          {motivo}
        </p>
      )}

      {puedeEditar && (sucio || linea.margenProvisional) && (
        <BotonGuardar
          onClick={guardar}
          guardando={guardando}
          deshabilitado={motivo !== null}
          texto={sucio ? 'Guardar margen' : 'Confirmar estos valores'}
        />
      )}
    </div>
  )
}

/**
 * El recargo por vuelo: si se ofrece, cuánto, cómo se llama y a qué vuelos aplica.
 *
 * Se OFRECE con un botón en la cotización, nunca se agrega solo: una línea de precio
 * que aparece sin que nadie la pida sale impresa al cliente.
 */
function BloqueRecargo({
  linea,
  puedeEditar,
  onGuardado,
}: {
  linea: LineaConMargen
  puedeEditar: boolean
  onGuardado: () => Promise<void>
}) {
  const [activo, setActivo] = useState(linea.recargo.activo)
  const [etiqueta, setEtiqueta] = useState(linea.recargo.etiqueta)
  const [valor, setValor] = useState(String(linea.recargo.valor))
  const [vuelos, setVuelos] = useState<VuelosDelRecargo>(linea.recargo.vuelos)
  const [guardando, startGuardar] = useTransition()

  const sucio =
    activo !== linea.recargo.activo ||
    etiqueta.trim() !== linea.recargo.etiqueta ||
    Number(valor) !== linea.recargo.valor ||
    vuelos !== linea.recargo.vuelos

  const motivo = etiqueta.trim() === ''
    ? 'El recargo necesita un nombre: es el que sale impreso en la cotización.'
    : !Number.isFinite(Number(valor)) || Number(valor) < 0
      ? 'El valor no puede ser negativo.'
      : activo && Number(valor) <= 0
        ? 'Un recargo encendido en cero no suma nada: pon el valor o apágalo.'
        : null

  const guardar = () =>
    startGuardar(async () => {
      const res = await guardarRecargo(linea.id, { activo, etiqueta: etiqueta.trim(), valor: Number(valor), vuelos })
      if ('error' in res) { toast.error(res.error); return }
      toast.success(sucio ? `Recargo de "${linea.nombre}" guardado` : `Recargo de "${linea.nombre}" confirmado`)
      await onGuardado()
    })

  const bloqueado = !puedeEditar || guardando

  return (
    <div className="mt-4 border-t pt-3">
      <EncabezadoBloque titulo={ETIQUETA.recargoActivo} provisional={linea.recargoProvisional} />

      <label className="flex items-center gap-2 text-xs font-medium">
        <input
          type="checkbox"
          checked={activo}
          disabled={bloqueado}
          onChange={(e) => setActivo(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Ofrecer un recargo en las cotizaciones con vuelo
      </label>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        Cuando la cotización lleva un vuelo al que le corresponde, aparece un botón para
        agregarlo. Se suma una vez, como una línea más que <strong>se puede cambiar a mano</strong>,
        y suma al precio, no al costo.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
            {ETIQUETA.recargoValor} (COP)
          </label>
          <input
            type="number"
            min="0"
            step="1000"
            value={valor}
            disabled={bloqueado}
            onChange={(e) => setValor(e.target.value)}
            className="w-full rounded border bg-background px-2 py-1.5 text-sm tabular-nums disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
            {ETIQUETA.recargoEtiqueta}
          </label>
          <input
            type="text"
            maxLength={80}
            value={etiqueta}
            disabled={bloqueado}
            onChange={(e) => setEtiqueta(e.target.value)}
            className="w-full rounded border bg-background px-2 py-1.5 text-sm disabled:opacity-60"
          />
        </div>
      </div>

      <fieldset className="mt-3" disabled={bloqueado}>
        <legend className="mb-1 text-[10px] font-medium text-muted-foreground">{ETIQUETA.recargoVuelos}</legend>
        <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
          {(['todos', 'internacionales'] as const).map((op) => (
            <label key={op} className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name={`vuelos-${linea.id}`}
                value={op}
                checked={vuelos === op}
                onChange={() => setVuelos(op)}
                className="h-3.5 w-3.5"
              />
              {vuelosEnPalabras(op).replace(/^./, c => c.toUpperCase())}
            </label>
          ))}
        </div>
        {vuelos === 'internacionales' && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Un vuelo es internacional si sale de otro país o llega a otro país. Si el sistema
            no reconoce la ciudad o el código del aeropuerto, lo cuenta como internacional y
            lo avisa en la cotización para que alguien lo mire.
          </p>
        )}
      </fieldset>

      {puedeEditar && motivo && (
        <p className="mt-1.5 flex items-start gap-1 text-[11px] text-red-600">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          {motivo}
        </p>
      )}

      {puedeEditar && (sucio || linea.recargoProvisional) && (
        <BotonGuardar
          onClick={guardar}
          guardando={guardando}
          deshabilitado={motivo !== null}
          texto={sucio ? 'Guardar recargo' : 'Confirmar estos valores'}
        />
      )}
    </div>
  )
}

function EncabezadoBloque({ titulo, provisional }: { titulo: string; provisional: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold">{titulo}</span>
      {provisional ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
          Provisional: valores de arranque, falta que los revises
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Revisado
        </span>
      )}
    </div>
  )
}

function BotonGuardar({
  onClick,
  guardando,
  deshabilitado,
  texto,
}: {
  onClick: () => void
  guardando: boolean
  deshabilitado: boolean
  texto: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado || guardando}
      className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
    >
      {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
      {texto}
    </button>
  )
}

function Historial({ cambios }: { cambios: CambioRegistrado[] }) {
  if (cambios.length === 0) return null
  return (
    <div className="mt-4 border-t pt-3">
      <p className="mb-1 text-[10px] font-medium text-muted-foreground">Cambios recientes</p>
      <ul className="space-y-1">
        {cambios.slice(0, 8).map((c) => (
          <li key={c.id} className="text-[11px] leading-snug">
            <span className="text-muted-foreground">
              {formatBogotaFechaHora(c.fecha) ?? ''} · {c.autor ?? 'sin autor'}:
            </span>{' '}
            {c.contenido}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CampoPct({
  etiqueta,
  ayuda,
  valor,
  onChange,
  disabled,
}: {
  etiqueta: string
  ayuda: string
  valor: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">{etiqueta}</label>
      <div className="relative">
        <input
          type="number"
          min="0"
          max="99.99"
          step="0.1"
          value={valor}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border bg-background py-1.5 pl-2 pr-6 text-sm tabular-nums disabled:opacity-60"
        />
        <Percent className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{ayuda}</p>
    </div>
  )
}
