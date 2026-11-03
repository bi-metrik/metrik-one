'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Download, HardHat, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'

import type { PanelObra as DatosPanelObra } from '@/lib/obras/servidor'
import type { ResumenCierre } from '@/lib/obras/cierre'
import { MAX_NOMBRE_CORTO, type CondicionesObra } from '@/lib/obras/condiciones'
import { pesos, porcentaje, textoJornadas } from '@/lib/obras/formato'
import { MENSAJE_SIN_MIGRACION_OBRAS } from '@/lib/obras/modulo'
import { generarCierreObraPDF, guardarCondicionesObra } from '../../obra-actions'
import { FacturasObra } from './facturas-obra'
import { LlegadasObra } from './llegadas-obra'
import { botonPrimario, botonSecundario, cabecera, campo, etiqueta, tarjeta } from './ui'

/**
 * La obra dentro de la ficha del negocio (solo con `modules.obras`): datos de la obra y
 * condiciones del contrato (C18, C21), el cierre (C11) con su PDF (C12), las facturas (C9, C10)
 * y las llegadas (C7). Lo que se ve sale de las vistas en cada carga; lo que cambia se guarda con
 * una acción y la ficha se vuelve a leer.
 */
export default function PanelObra({
  negocioId,
  panel,
  puedeEditar,
}: {
  negocioId: string
  panel: DatosPanelObra
  puedeEditar: boolean
}) {
  if (panel.estado !== 'ok') {
    return (
      <section className={`${tarjeta} p-4`} data-panel-obra={panel.estado}>
        <div className="flex items-center gap-1.5">
          <HardHat className="h-4 w-4 text-tinta-suave" />
          <h3 className="text-sm font-semibold text-foreground">Obra</h3>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {panel.estado === 'sin_migracion' ? MENSAJE_SIN_MIGRACION_OBRAS : 'No se pudo leer la obra en este momento. Recarga la página.'}
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-3" data-panel-obra="ok">
      <DatosObra negocioId={negocioId} condiciones={panel.condiciones} puedeEditar={puedeEditar} />
      {panel.cierre && <CierreObra negocioId={negocioId} cierre={panel.cierre} />}
      <FacturasObra negocioId={negocioId} facturas={panel.facturas} cobros={panel.cobros} puedeEditar={puedeEditar} />
      <LlegadasObra
        negocioId={negocioId}
        jornadas={panel.jornadas}
        colaboradores={panel.colaboradores}
        obras={panel.obras}
        puedeEditar={puedeEditar}
      />
    </div>
  )
}

// ── Datos de la obra: nombre corto y condiciones del contrato ───────────────────

function DatosObra({ negocioId, condiciones, puedeEditar }: { negocioId: string; condiciones: CondicionesObra; puedeEditar: boolean }) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [pendiente, startTransition] = useTransition()
  const [form, setForm] = useState({
    nombre_corto: condiciones.nombre_corto ?? '',
    anticipo_pct: condiciones.anticipo_pct === null ? '' : String(condiciones.anticipo_pct),
    forma_pago: condiciones.forma_pago ?? '',
    plazo_pago_dias: condiciones.plazo_pago_dias === null ? '' : String(condiciones.plazo_pago_dias),
  })
  const largo = form.nombre_corto.trim().length

  const guardar = () =>
    startTransition(async () => {
      const r = await guardarCondicionesObra(negocioId, form)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Datos de la obra guardados')
      setEditando(false)
      router.refresh()
    })

  return (
    <section className={tarjeta} data-datos-obra>
      <div className={cabecera}>
        <div className="flex items-center gap-1.5">
          <HardHat className="h-4 w-4 text-tinta-suave" />
          <h3 className="text-sm font-semibold text-foreground">Datos de la obra</h3>
        </div>
        {puedeEditar && !editando && (
          <button type="button" className={botonSecundario} onClick={() => setEditando(true)}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
        )}
      </div>
      {editando ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <label className={etiqueta}>
            Nombre corto (va en los botones de WhatsApp)
            <input
              className={campo}
              value={form.nombre_corto}
              maxLength={MAX_NOMBRE_CORTO}
              onChange={(e) => setForm({ ...form, nombre_corto: e.target.value })}
              placeholder="Calle 93"
            />
            <span className={`block text-right tabular-nums ${largo > MAX_NOMBRE_CORTO ? 'text-red-600' : ''}`} data-contador-nombre-corto>
              {largo}/{MAX_NOMBRE_CORTO}
            </span>
          </label>
          <label className={etiqueta}>
            Anticipo (%)
            <input
              className={campo}
              inputMode="decimal"
              type="number"
              min={0}
              max={100}
              value={form.anticipo_pct}
              onChange={(e) => setForm({ ...form, anticipo_pct: e.target.value })}
              placeholder="50"
            />
          </label>
          <label className={`${etiqueta} sm:col-span-2`}>
            Forma de pago
            <textarea
              className={`${campo} h-16 py-1.5`}
              maxLength={300}
              value={form.forma_pago}
              onChange={(e) => setForm({ ...form, forma_pago: e.target.value })}
              placeholder="50 % de anticipo y el saldo contra acta de entrega"
            />
          </label>
          <label className={etiqueta}>
            Plazo de pago (días)
            <input
              className={campo}
              inputMode="numeric"
              type="number"
              min={0}
              max={365}
              value={form.plazo_pago_dias}
              onChange={(e) => setForm({ ...form, plazo_pago_dias: e.target.value })}
              placeholder="30"
            />
          </label>
          <div className="flex items-end gap-2">
            <button type="button" className={botonPrimario} disabled={pendiente} onClick={guardar}>
              {pendiente && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
            </button>
            <button type="button" className="h-9 px-2 text-xs text-muted-foreground" onClick={() => setEditando(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-xs">
          <Dato titulo="Nombre corto" valor={condiciones.nombre_corto} />
          <Dato titulo="Anticipo" valor={condiciones.anticipo_pct === null ? null : `${String(condiciones.anticipo_pct).replace('.', ',')} %`} />
          <Dato titulo="Plazo de pago" valor={condiciones.plazo_pago_dias === null ? null : `${condiciones.plazo_pago_dias} días`} />
          <Dato titulo="Forma de pago" valor={condiciones.forma_pago} ancho />
        </dl>
      )}
    </section>
  )
}

function Dato({ titulo, valor, ancho }: { titulo: string; valor: string | null; ancho?: boolean }) {
  return (
    <div className={ancho ? 'col-span-2' : ''}>
      <dt className="text-muted-foreground">{titulo}</dt>
      <dd className="mt-0.5 text-foreground">{valor ?? <span className="text-muted-foreground">Sin definir</span>}</dd>
    </div>
  )
}

// ── C11: cierre de obra ──────────────────────────────────────────────────────────

function Linea({ etiqueta: e, valor, fuerte, sangria, alerta }: { etiqueta: string; valor: string; fuerte?: boolean; sangria?: boolean; alerta?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 text-xs ${fuerte ? 'font-semibold' : ''}`}>
      <span className={sangria ? 'pl-3 text-muted-foreground' : 'text-foreground'}>{e}</span>
      <span className={`tabular-nums ${alerta ? 'text-red-700' : 'text-foreground'}`}>{valor}</span>
    </div>
  )
}

function CierreObra({ negocioId, cierre }: { negocioId: string; cierre: ResumenCierre }) {
  const [descargando, startDescarga] = useTransition()
  const negativa = cierre.utilidad < 0

  const descargar = () =>
    startDescarga(async () => {
      const r = await generarCierreObraPDF(negocioId)
      if (!r.pdf) return void toast.error(r.error ?? 'No se pudo generar el PDF')
      const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = r.filename ?? 'Cierre de obra.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    })

  return (
    <section className={tarjeta} data-cierre-obra>
      <div className={cabecera}>
        <h3 className="text-sm font-semibold text-foreground">Cierre de obra</h3>
        <button type="button" className={botonSecundario} onClick={descargar} disabled={descargando} data-pdf-cierre>
          {descargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Descargar PDF del cierre
        </button>
      </div>
      <div className="p-4">
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{cierre.tituloUtilidad}</p>
          <p className={`mt-0.5 text-lg font-bold tabular-nums ${negativa ? 'text-red-700' : 'text-foreground'}`} data-utilidad>
            {pesos(cierre.utilidad)}
            {cierre.utilidadPct !== null && <span className="ml-1.5 text-sm font-semibold">({porcentaje(cierre.utilidadPct)})</span>}
          </p>
        </div>

        <div className="mt-3 divide-y divide-border/60">
          <Linea etiqueta="Vendido" valor={pesos(cierre.vendido)} fuerte />
          {cierre.rubros.map((r) => (
            <Linea key={r.rubro} etiqueta={r.rubro} valor={pesos(r.total)} sangria />
          ))}
          <Linea etiqueta={`Mano de obra (${textoJornadas(cierre.jornadas)})`} valor={pesos(cierre.manoObra)} sangria />
          <Linea etiqueta={cierre.tituloUtilidad} valor={pesos(cierre.utilidad)} fuerte alerta={negativa} />
        </div>

        <div className="mt-3 divide-y divide-border/60 border-t pt-2">
          <Linea etiqueta="Facturado" valor={pesos(cierre.facturado)} />
          <Linea etiqueta="Cobrado" valor={pesos(cierre.cobrado)} />
          <Linea etiqueta="Retenido (facturas pagadas)" valor={pesos(cierre.retenido)} />
          <Linea etiqueta="Por cobrar" valor={pesos(cierre.porCobrar)} fuerte />
        </div>

        {cierre.avisos.length > 0 && (
          <ul className="mt-3 space-y-1">
            {cierre.avisos.map((a) => (
              <li key={a} className="flex items-start gap-1.5 text-[11px] text-[#9A5F0C]">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {a}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Retenido = diferencia entre lo facturado y lo recibido en las facturas marcadas como pagadas. ONE no la liquida ni la certifica.
        </p>
      </div>
    </section>
  )
}
