'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CircleCheck, ExternalLink, FileText, FolderCheck, Grid3x3, SearchCheck, ShieldCheck, UserCheck, X } from 'lucide-react'
import MetrikLockup from '@/components/metrik-lockup'
import { textoConfirmacion } from '@/lib/seccion-suscripcion/sugerencias'
import { descartarSustenta, pedirContactoDeSustenta, registrarEventoSustenta } from './acciones'

/**
 * Sustenta en el Resumen de `/suscripcion` (Mateo y Ren, 2026-09-23): una tarjeta con marca, dos
 * CTAs y un panel «Ver cómo funciona»; al pedir la demostración la tarjeta se reemplaza por una
 * confirmación que se queda.
 *
 * - Solo tokens de ONE: el acento (y su versión clara sobre oscuro) a distintas opacidades. Nada de
 *   colores nuevos.
 * - Lo único que se mueve son las celdas de la matriz al entrar en pantalla, y solo con
 *   `motion-safe:`: con «reducir movimiento» aparecen quietas.
 * - Las vistas del panel son ilustraciones hechas con componentes y datos de ejemplo, nunca capturas
 *   ni datos de un cliente.
 * - La medición (vista, panel, clic, descarte) la escribe el servidor con el espacio y la persona de
 *   la sesión; si falla, la pantalla no se entera.
 */

export type EstadoSustenta = 'oferta' | 'solicitada'

type Estado =
  | { tipo: 'oferta' }
  | { tipo: 'confirmada'; recien: boolean; nombre: string | null }
  | { tipo: 'oculta' }

// ── Piezas de marca ───────────────────────────────────────────────────────────────────────

/**
 * El lockup de producto «MéTRIK sustenta», el mismo patrón de «MéTRIK one»: sale de la fuente única
 * (`metrik-lockup.tsx`), nunca de un wordmark hecho aquí.
 */
export function LockupSustenta({ tamano = 'md' }: { tamano?: 'sm' | 'md' }) {
  return <MetrikLockup size={tamano} producto="sustenta" />
}

/** El distintivo que dice qué es la tarjeta: una recomendación, no una promoción. */
export const DISTINTIVO = 'Recomendado para tu CDA'

function Distintivo() {
  return (
    <span
      data-distintivo-sustenta
      className="inline-flex w-fit items-center rounded-full border border-acento/25 bg-acento/5 px-2.5 py-0.5 text-xs font-medium text-acento dark:border-acento-claro/30 dark:bg-acento-claro/10 dark:text-acento-claro"
    >
      {DISTINTIVO}
    </span>
  )
}

/**
 * Las nueve celdas, de la esquina de menor riesgo (abajo a la izquierda) a la de mayor. Las clases
 * van escritas enteras para que Tailwind las encuentre.
 */
const CELDAS: { clase: string; escudo?: true }[] = [
  { clase: 'bg-acento/35 dark:bg-acento-claro/35' },
  { clase: 'bg-acento/60 dark:bg-acento-claro/60' },
  { clase: 'bg-acento/60 dark:bg-acento-claro/60', escudo: true },
  { clase: 'bg-acento/15 dark:bg-acento-claro/15' },
  { clase: 'bg-acento/35 dark:bg-acento-claro/35' },
  { clase: 'bg-acento/60 dark:bg-acento-claro/60' },
  { clase: 'bg-acento/15 dark:bg-acento-claro/15' },
  { clase: 'bg-acento/15 dark:bg-acento-claro/15' },
  { clase: 'bg-acento/35 dark:bg-acento-claro/35' },
]

/** Orden de aparición: desde la esquina baja hacia la del escudo. 9 × 45 ms + 200 ms < 600 ms. */
const ORDEN_APARICION = [6, 7, 3, 8, 4, 0, 5, 1, 2]
const PASO_MS = 45

function claseAnimacion(visible: boolean): string {
  // Antes de entrar en pantalla la celda espera invisible; con «reducir movimiento» nunca se oculta.
  return visible
    ? 'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:duration-200'
    : 'motion-safe:opacity-0'
}

function retardo(indice: number): React.CSSProperties {
  return { animationDelay: `${ORDEN_APARICION.indexOf(indice) * PASO_MS}ms`, animationFillMode: 'backwards' }
}

/** La matriz 3×3 de escritorio. Decorativa. */
export function MatrizDecorativa({ visible }: { visible: boolean }) {
  return (
    <div aria-hidden data-matriz-sustenta className="grid w-full max-w-[13rem] grid-cols-3 gap-2">
      {CELDAS.map((c, i) => (
        <span
          key={i}
          data-celda
          style={retardo(i)}
          className={`grid aspect-square place-items-center rounded-lg ${c.clase} ${claseAnimacion(visible)}`}
        >
          {c.escudo && <ShieldCheck className="size-7 text-white dark:text-tinta" strokeWidth={2.25} />}
        </span>
      ))}
    </div>
  )
}

/** La franja de tres celdas del teléfono, encima del titular. Decorativa. */
function FranjaDecorativa({ visible }: { visible: boolean }) {
  const franja = [CELDAS[6], CELDAS[4], CELDAS[2]]
  return (
    <div aria-hidden data-franja-sustenta className="flex gap-1.5">
      {franja.map((c, i) => (
        <span
          key={i}
          style={{ animationDelay: `${i * 90}ms`, animationFillMode: 'backwards' }}
          className={`grid h-7 flex-1 place-items-center rounded-md ${c.clase} ${claseAnimacion(visible)}`}
        >
          {c.escudo && <ShieldCheck className="size-4 text-white dark:text-tinta" strokeWidth={2.25} />}
        </span>
      ))}
    </div>
  )
}

// ── Copy ─────────────────────────────────────────────────────────────────────────────────

export const GANCHO = '¿Tu SARLAFT está listo para la próxima auditoría?'
export const TITULAR = 'Valida revisa las listas. Sustenta sostiene todo tu SARLAFT.'
export const BAJADA =
  'Matriz de riesgos, segmentación, vinculación de contrapartes y soportes en un solo lugar, conectados a las consultas que tu equipo ya hace en Valida.'
const BENEFICIOS = [
  { icono: Grid3x3, texto: 'Matriz de riesgos y controles al día, sin hojas de cálculo sueltas.' },
  { icono: UserCheck, texto: 'Cada contraparte vinculada con su consulta de listas y su soporte.' },
  { icono: FolderCheck, texto: 'Llega a la auditoría con cada soporte en su lugar y sin buscar a última hora.' },
] as const
export const CTA_PRIMARIO = 'Quiero una demostración'
export const CTA_SECUNDARIO = 'Ver cómo funciona'

/** La página pública de Sustenta, con UTM para distinguir el tráfico que sale de ONE. */
export const URL_SUSTENTA =
  'https://sustenta.metrik.com.co/?utm_source=one&utm_medium=suscripcion&utm_campaign=sustenta_cda'
export const TEXTO_ENLACE_SUSTENTA = 'Conoce más en sustenta.metrik.com.co'

const BOTON_PRIMARIO =
  'inline-flex w-full items-center justify-center rounded-md bg-acento px-4 py-2.5 text-sm font-semibold text-white hover:bg-acento-hover disabled:opacity-60 dark:bg-acento-claro dark:text-tinta dark:hover:bg-acento-claro/90 sm:w-auto'
const BOTON_SECUNDARIO =
  'inline-flex w-full items-center justify-center rounded-md border border-acento/40 bg-transparent px-4 py-2.5 text-sm font-semibold text-acento hover:bg-acento/5 dark:border-acento-claro/50 dark:text-acento-claro dark:hover:bg-acento-claro/10 sm:w-auto'

// ── La sección completa ──────────────────────────────────────────────────────────────────

export function SeccionSustenta({ inicial }: { inicial: EstadoSustenta }) {
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>(
    inicial === 'solicitada' ? { tipo: 'confirmada', recien: false, nombre: null } : { tipo: 'oferta' },
  )
  const [panel, setPanel] = useState(false)
  const [pendiente, iniciar] = useTransition()

  function pedirDemostracion(origen: 'tarjeta' | 'panel') {
    if (pendiente || estado.tipo !== 'oferta') return
    iniciar(async () => {
      const r = await pedirContactoDeSustenta({ origen })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setEstado({ tipo: 'confirmada', recien: !r.yaExistia, nombre: r.nombre })
    })
  }

  function ahoraNo() {
    iniciar(async () => {
      const r = await descartarSustenta()
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setEstado({ tipo: 'oculta' })
      router.refresh()
    })
  }

  function abrirPanel() {
    setPanel(true)
    void registrarEventoSustenta('panel').catch(() => {})
  }

  if (estado.tipo === 'oculta') return null

  return (
    <>
      {estado.tipo === 'confirmada' ? (
        <ConfirmacionSustenta recien={estado.recien} nombre={estado.nombre} />
      ) : (
        <TarjetaSustenta
          pendiente={pendiente}
          onDemostracion={() => pedirDemostracion('tarjeta')}
          onVerComoFunciona={abrirPanel}
          onAhoraNo={ahoraNo}
        />
      )}

      {panel &&
        createPortal(
          <PanelSustenta
            onCerrar={() => setPanel(false)}
            pie={
              estado.tipo === 'confirmada' ? (
                <MensajeConfirmacion recien={estado.recien} nombre={estado.nombre} />
              ) : (
                <button
                  type="button"
                  onClick={() => pedirDemostracion('panel')}
                  disabled={pendiente}
                  className={`${BOTON_PRIMARIO} sm:w-full`}
                >
                  {CTA_PRIMARIO}
                </button>
              )
            }
          />,
          document.body,
        )}
    </>
  )
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────────────────

export function TarjetaSustenta(p: {
  pendiente: boolean
  onDemostracion: () => void
  onVerComoFunciona: () => void
  onAhoraNo: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  const vistaRegistrada = useRef(false)

  useEffect(() => {
    const nodo = ref.current
    if (!nodo) return
    const entrar = () => {
      setVisible(true)
      if (!vistaRegistrada.current) {
        vistaRegistrada.current = true
        void registrarEventoSustenta('vista').catch(() => {})
      }
    }
    if (typeof IntersectionObserver === 'undefined') {
      entrar()
      return
    }
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          entrar()
          obs.disconnect()
        }
      },
      { threshold: 0.4 },
    )
    obs.observe(nodo)
    return () => obs.disconnect()
  }, [])

  return (
    <section
      ref={ref}
      data-tarjeta-sustenta
      aria-labelledby="sustenta-titular"
      className="overflow-hidden rounded-xl border border-acento/20 bg-card bg-linear-to-br from-card via-card to-acento/5 text-card-foreground dark:border-acento-claro/20 dark:to-acento-claro/5"
    >
      <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[3fr_2fr] md:items-center">
        <div className="min-w-0 space-y-4">
          <div className="md:hidden">
            <FranjaDecorativa visible={visible} />
          </div>
          <div className="space-y-3">
            <div className="flex flex-col items-start gap-2.5">
              <Distintivo />
              <LockupSustenta />
            </div>
            <div className="space-y-1 pt-1">
              <p data-gancho-sustenta className="text-sm font-medium text-muted-foreground">
                {GANCHO}
              </p>
              <h2 id="sustenta-titular" className="text-lg font-bold leading-snug text-card-foreground sm:text-xl">
                {TITULAR}
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{BAJADA}</p>
          </div>
          <ul className="space-y-2.5">
            {BENEFICIOS.map(({ icono: Icono, texto }) => (
              <li key={texto} className="flex items-start gap-2.5 text-sm text-card-foreground">
                <Icono aria-hidden className="mt-0.5 size-4 shrink-0 text-acento dark:text-acento-claro" />
                <span>{texto}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <button type="button" onClick={p.onDemostracion} disabled={p.pendiente} className={BOTON_PRIMARIO}>
              {CTA_PRIMARIO}
            </button>
            <button type="button" onClick={p.onVerComoFunciona} className={BOTON_SECUNDARIO}>
              {CTA_SECUNDARIO}
            </button>
            <button
              type="button"
              onClick={p.onAhoraNo}
              disabled={p.pendiente}
              className="self-center px-2 py-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline sm:ml-auto"
            >
              Ahora no
            </button>
          </div>
        </div>
        <div className="hidden justify-center md:flex">
          <MatrizDecorativa visible={visible} />
        </div>
      </div>
    </section>
  )
}

// ── Confirmación ─────────────────────────────────────────────────────────────────────────

function MensajeConfirmacion({ recien, nombre }: { recien: boolean; nombre: string | null }) {
  return (
    <p role="status" data-sustenta-confirmacion className="flex items-start gap-2.5 text-sm text-card-foreground">
      <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-acento dark:text-acento-claro" />
      <span>{recien ? textoConfirmacion({ tipo: 'recien', nombre }) : textoConfirmacion({ tipo: 'previa' })}</span>
    </p>
  )
}

export function ConfirmacionSustenta({ recien, nombre }: { recien: boolean; nombre: string | null }) {
  return (
    <section
      data-sustenta-solicitada
      aria-label="Sustenta"
      className="space-y-3 rounded-xl border border-acento/20 bg-card p-5 text-card-foreground dark:border-acento-claro/20"
    >
      <LockupSustenta tamano="sm" />
      <MensajeConfirmacion recien={recien} nombre={nombre} />
    </section>
  )
}

// ── Panel «Ver cómo funciona» ────────────────────────────────────────────────────────────

export function PanelSustenta({ onCerrar, pie }: { onCerrar: () => void; pie: React.ReactNode }) {
  const cerrarRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cerrarRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onCerrar])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onCerrar}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="sustenta-panel-titular"
        data-panel-sustenta
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-card text-card-foreground shadow-xl sm:max-w-lg"
      >
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <LockupSustenta />
            <button
              ref={cerrarRef}
              type="button"
              aria-label="Cerrar"
              onClick={onCerrar}
              className="rounded-md p-1 text-muted-foreground hover:text-card-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
          <PanelContenido />
        </div>
        <div className="space-y-3 border-t border-border bg-card p-4 sm:p-5">
          {pie}
          <EnlaceSustenta />
        </div>
      </aside>
    </div>
  )
}

/**
 * Enlace secundario a la página pública, debajo del CTA del pie. Va solo en el panel: en la tarjeta
 * sería un cuarto elemento junto a dos botones y «Ahora no», y en el teléfono se apilaría como uno
 * más. El clic no se mide: `sugerencias_eventos.evento` es una lista cerrada por CHECK y un tipo
 * nuevo exige migración.
 */
export function EnlaceSustenta() {
  return (
    <a
      href={URL_SUSTENTA}
      target="_blank"
      rel="noopener noreferrer"
      data-enlace-sustenta
      className="mx-auto flex w-fit max-w-full items-center gap-1.5 text-sm font-medium text-acento underline-offset-4 hover:underline dark:text-acento-claro"
    >
      <span className="min-w-0 break-words">{TEXTO_ENLACE_SUSTENTA}</span>
      <ExternalLink aria-hidden size={14} className="shrink-0" />
    </a>
  )
}

/** El cuerpo del panel, aparte para poder pintarlo en las pruebas sin portal. */
export function PanelContenido() {
  return (
    <div className="mt-4 space-y-6">
      <h2 id="sustenta-panel-titular" className="text-lg font-bold leading-snug">
        {TITULAR}
      </h2>

      <BloquePanel icono={Grid3x3} titulo={BENEFICIOS[0].texto}>
        <VistaMatriz />
      </BloquePanel>
      <BloquePanel icono={UserCheck} titulo={BENEFICIOS[1].texto}>
        <VistaContraparte />
      </BloquePanel>
      <BloquePanel icono={FolderCheck} titulo={BENEFICIOS[2].texto}>
        <VistaSoportes />
      </BloquePanel>

      <section data-como-empezamos className="space-y-3">
        <h3 className="text-sm font-semibold">Cómo empezamos</h3>
        <ol className="space-y-2.5">
          {[
            'Demostración con tu equipo.',
            'Configuramos tu matriz y tus segmentos con ustedes.',
            'Tu equipo opera Sustenta junto a Valida.',
          ].map((paso, i) => (
            <li key={paso} className="flex items-start gap-3 text-sm">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-acento/10 text-xs font-bold text-acento dark:bg-acento-claro/15 dark:text-acento-claro">
                {i + 1}
              </span>
              <span className="pt-0.5">{paso}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function BloquePanel({
  icono: Icono,
  titulo,
  children,
}: {
  icono: typeof Grid3x3
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section data-vista-panel className="space-y-3">
      <h3 className="flex items-start gap-2 text-sm font-semibold">
        <Icono aria-hidden className="mt-0.5 size-4 shrink-0 text-acento dark:text-acento-claro" />
        <span>{titulo}</span>
      </h3>
      <figure className="rounded-lg border border-border bg-background p-3.5">
        {children}
        <figcaption className="mt-3 text-[11px] text-muted-foreground">Vista de ejemplo, sin datos de clientes.</figcaption>
      </figure>
    </section>
  )
}

const NIVEL: Record<'bajo' | 'medio' | 'alto', string> = {
  bajo: 'bg-acento/15 dark:bg-acento-claro/15',
  medio: 'bg-acento/35 dark:bg-acento-claro/35',
  alto: 'bg-acento/60 dark:bg-acento-claro/60',
}

function VistaMatriz() {
  const filas: { riesgo: string; nivel: keyof typeof NIVEL; control: string }[] = [
    { riesgo: 'Contraparte sin consulta de listas', nivel: 'alto', control: 'Consulta antes de vincular' },
    { riesgo: 'Pagos en efectivo sobre el umbral', nivel: 'medio', control: 'Reporte al oficial' },
    { riesgo: 'Cambio de beneficiario final', nivel: 'bajo', control: 'Actualización anual' },
  ]
  return (
    <div className="space-y-2">
      {filas.map((f) => (
        <div key={f.riesgo} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
          <span aria-hidden className={`size-3 shrink-0 rounded-sm ${NIVEL[f.nivel]}`} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{f.riesgo}</p>
            <p className="truncate text-[11px] text-muted-foreground">Control: {f.control}</p>
          </div>
          <span className="shrink-0 text-[11px] font-medium text-acento dark:text-acento-claro">Al día</span>
        </div>
      ))}
    </div>
  )
}

function VistaContraparte() {
  return (
    <div className="space-y-2.5 rounded-md border border-border bg-card p-3">
      <div>
        <p className="text-xs font-semibold">Contraparte de ejemplo S.A.S.</p>
        <p className="text-[11px] text-muted-foreground">Proveedor · segmento de riesgo medio</p>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-acento/5 px-2.5 py-2 text-[11px] dark:bg-acento-claro/10">
        <SearchCheck aria-hidden className="size-3.5 shrink-0 text-acento dark:text-acento-claro" />
        <span>Consulta en Valida: sin coincidencias en listas</span>
      </div>
      <ul className="space-y-1 text-[11px]">
        {['RUT', 'Certificado de existencia', 'Formulario de vinculación'].map((s) => (
          <li key={s} className="flex items-center gap-2">
            <CircleCheck aria-hidden className="size-3.5 shrink-0 text-acento dark:text-acento-claro" />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function VistaSoportes() {
  const archivos = [
    { nombre: 'Matriz de riesgos vigente', quien: 'Oficial de cumplimiento' },
    { nombre: 'Consultas de listas del mes', quien: 'Generado desde Valida' },
    { nombre: 'Actas del comité', quien: 'Oficial de cumplimiento' },
  ]
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card">
      {archivos.map((a) => (
        <li key={a.nombre} className="flex items-center gap-2.5 px-3 py-2">
          <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{a.nombre}</p>
            <p className="truncate text-[11px] text-muted-foreground">{a.quien}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
