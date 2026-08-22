'use client'

/**
 * Panel lateral con los casos detrás de una cifra del tablero comercial.
 *
 * El tablero decía "30 ventas en agosto" y para saber cuáles eran había que ir a
 * buscarlas a mano. Al hacer clic en cualquier cifra mayor que cero se abre esta lista,
 * ya filtrada por el mismo mes, el mismo vendedor y el mismo criterio de la celda.
 *
 * Hermano de `CasosDrawer` (que abre los casos de una ETAPA del proceso): misma forma en
 * pantalla, otra pregunta. Este responde "qué se vendió", aquel "qué está atascado".
 *
 * Trae las cuatro fechas que el equipo comercial viene pidiendo desde julio: cuándo se
 * vendió, cuándo quedó cubierto el honorario, cuándo entró el lead y cuándo fue su
 * última conversión.
 */

import { useEffect, useState } from 'react'
import { X, ExternalLink, AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { getComercialVentasMes } from '../../equipo/comercial-actions'
import type { ComercialVentaCaso } from '../../equipo/comercial-types'
import { origenNegocioLabel } from '@/lib/catalogos/constants'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const VERDE = '#059669'
const OCRE = '#92400E'

export interface CifraSeleccionada {
  anio: number
  mes: number
  /** Qué cifra se abrió, para titular el panel con las palabras de la pantalla. */
  titulo: string
  responsableId?: string | null
  sinResponsable?: boolean
  soloCompletos?: boolean | null
  /**
   * `true` abre solo las ventas BONIFICABLES (#13), `false` solo las que no lo son,
   * `null`/ausente las abre todas. Es una pregunta distinta de `soloCompletos`: una
   * mide si paso el umbral del proceso y la otra si el honorario quedo cubierto.
   */
  soloBonificables?: boolean | null
  /**
   * Casos explícitos a mostrar. Lo usa el corte por seccional: el conjunto lo calculó
   * quien pintó la cifra, así que la lista es la que sumó, no una consulta paralela.
   */
  negocioIds?: string[] | null
  /** 'YYYY-MM-DD': abre las ventas de un solo día. */
  dia?: string | null
  /**
   * Abre las ventas de una campaña. La cadena vacía abre el bucket de las que
   * vinieron de Meta sin campaña atribuida — distinto de `null`, que es "todas".
   */
  campana?: string | null
  /** Nombre del vendedor, cuando la cifra es de una fila y no del total. */
  alcance?: string | null
}

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

/** '2026-08-05' → '05/08'. Se arma desde las partes: `new Date('YYYY-MM-DD')` se
 *  interpreta como UTC y en Colombia cae un día antes. */
function fmtDia(iso: string | null): string | null {
  if (!iso) return null
  const [, m, d] = iso.split('-')
  return d && m ? `${d}/${m}` : null
}

export function VentasDrawer({
  cifra,
  onClose,
}: {
  cifra: CifraSeleccionada
  onClose: () => void
}) {
  const [casos, setCasos] = useState<ComercialVentaCaso[] | null>(null)

  // El conjunto explícito entra a las dependencias por su CONTENIDO, no por la
  // identidad del arreglo: el padre lo reconstruye en cada render y comparar
  // referencias dispararía la consulta en bucle.
  const clavePorIds = cifra.negocioIds?.join(',') ?? null

  // El padre monta el panel con `key` por cifra, así que al cambiar de celda el
  // componente se remonta y el estado arranca vacío solo.
  useEffect(() => {
    let vivo = true
    void getComercialVentasMes({
      anio: cifra.anio,
      mes: cifra.mes,
      responsableId: cifra.responsableId ?? null,
      soloCompletos: cifra.soloCompletos ?? null,
      sinResponsable: cifra.sinResponsable ?? false,
      dia: cifra.dia ?? null,
      campana: cifra.campana ?? null,
      soloBonificables: cifra.soloBonificables ?? null,
      negocioIds: cifra.negocioIds ?? null,
    }).then(r => {
      if (vivo) setCasos(r)
    })
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cifra.anio, cifra.mes, cifra.responsableId, cifra.soloCompletos,
    cifra.sinResponsable, cifra.dia, cifra.campana, cifra.soloBonificables,
    clavePorIds,
  ])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden />

      <div className="fixed inset-y-0 right-0 z-[60] w-full max-w-md animate-in slide-in-from-right duration-200">
        <div className="flex h-full flex-col bg-white shadow-2xl">
          <div
            className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3"
            style={{ borderColor: BORDE }}
          >
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold" style={{ color: CARBON }}>
                {cifra.titulo}
              </h2>
              {cifra.alcance && (
                <p className="mt-0.5 truncate text-[11px]" style={{ color: GRIS }}>
                  {cifra.alcance}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 hover:bg-[#F5F4F2]"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" style={{ color: GRIS }} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {casos === null ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>
                Cargando…
              </p>
            ) : casos.length === 0 ? (
              <p className="py-8 text-center text-xs" style={{ color: GRIS }}>
                No hay casos aquí.
              </p>
            ) : (
              <ul className="space-y-2">
                {casos.map(c => (
                  <li key={c.negocio_id}>
                    <Link
                      href={`/negocios/${c.negocio_id}`}
                      className="block rounded-lg border p-3 transition-colors hover:bg-[#F9FAFB]"
                      style={{ borderColor: BORDE }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold" style={{ color: CARBON }}>
                            {c.codigo && (
                              <span className="mr-1.5 font-mono" style={{ color: GRIS }}>
                                {c.codigo}
                              </span>
                            )}
                            {c.nombre}
                          </p>
                          <p className="mt-0.5 truncate text-[11px]" style={{ color: GRIS }}>
                            {c.responsable ?? 'Sin comercial'}
                          </p>
                        </div>
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: BORDE }} />
                      </div>

                      {/* Las cuatro fechas del caso. La de completado solo aparece cuando
                          el honorario quedó cubierto: una fecha ahí sobre un caso que
                          sigue debiendo diría que se cerró algo que está abierto. */}
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <Fecha label="Venta" valor={fmtDia(c.fecha_venta)} />
                        <Fecha label="Completado" valor={fmtDia(c.fecha_completado)} />
                        <Fecha label="Creado" valor={fmtDia(c.fecha_creacion)} />
                        <Fecha
                          label="Últ. conversión"
                          valor={fmtDia(c.ultima_conversion)}
                          extra={c.n_conversiones > 1 ? `${c.n_conversiones} veces` : null}
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                          style={{ backgroundColor: '#F5F4F2', color: GRIS }}
                          title="Valor del honorario sin IVA"
                        >
                          {fmtCOP(c.valor_sin_iva)}
                        </span>
                        {c.caso_completo ? (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: '#ECFDF5', color: VERDE }}
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" /> Honorario cubierto
                          </span>
                        ) : (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                            style={{ backgroundColor: '#F5F4F2', color: GRIS }}
                            title="Recaudado del honorario"
                          >
                            {fmtCOP(c.recaudado)} recaudado
                          </span>
                        )}
                        {/* La tercera medida, al lado de las otras dos y con su propio
                            nombre. `null` no se pinta como "no bonifica": se dice que
                            no se pudo medir, que es lo único que se sabe. */}
                        {c.bonificable === true ? (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8' }}
                            title="Pasó el umbral que declara la línea: es una venta bonificable"
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" /> Bonificable
                          </span>
                        ) : c.bonificable === false ? (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: '#F5F4F2', color: GRIS }}
                            title="Todavía no pasó el umbral que declara la línea"
                          >
                            No bonifica aún
                          </span>
                        ) : (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: '#F5F4F2', color: '#9CA3AF' }}
                            title="La línea de este negocio no declaró desde qué etapa una venta bonifica, así que no se pudo medir. No significa que no bonifique."
                          >
                            Bonificable —
                          </span>
                        )}
                        {c.sin_honorario_aprobado && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: '#FEF3C7', color: OCRE }}
                            title="Este caso no tiene honorario aprobado, así que el sistema compara su recaudo contra cero y lo cuenta como completo"
                          >
                            <AlertTriangle className="h-2.5 w-2.5" /> Sin honorario aprobado
                          </span>
                        )}
                        {c.n_conversiones > 1 && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: '#F5F4F2', color: GRIS }}
                            title="El contacto volvió a dejar sus datos después de la primera vez"
                          >
                            <RotateCcw className="h-2.5 w-2.5" /> Reconvertido
                          </span>
                        )}
                      </div>

                      {/* De dónde vino. Decide la comisión, así que se muestra en cada
                          caso y no solo en el agregado. */}
                      <div className="mt-2 border-t pt-2" style={{ borderColor: BORDE }}>
                        <Origen caso={c} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {casos !== null && casos.length > 0 && (
            <div className="shrink-0 border-t px-4 py-2 text-[11px]" style={{ borderColor: BORDE, color: GRIS }}>
              {casos.length} caso{casos.length === 1 ? '' : 's'} · más reciente primero
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * De dónde vino el caso, en los tres estados que NO se pueden confundir.
 *
 * `sin rastro de Meta` no dice "vino directo": dice que no dejó huella. Afirmar el
 * origen sobre una ausencia es justo lo que decide mal una comisión.
 */
export function Origen({ caso }: {
  caso: Pick<ComercialVentaCaso, 'origen_declarado' | 'tiene_rastro_meta' | 'campana' | 'atribucion_en_conflicto'>
    & Partial<Pick<ComercialVentaCaso, 'comision_retenida'>>
}) {
  const declarado = origenNegocioLabel(caso.origen_declarado)
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span style={{ color: '#9CA3AF' }}>Origen</span>
      <span className="font-medium" style={{ color: declarado ? CARBON : '#9CA3AF' }}>
        {declarado ?? 'sin declarar'}
      </span>

      {caso.tiene_rastro_meta ? (
        caso.campana ? (
          <span
            className="truncate rounded px-1.5 py-0.5 font-medium"
            style={{ backgroundColor: '#1877F2' + '1A', color: '#1877F2', maxWidth: '14rem' }}
            title={`Campaña de Meta: ${caso.campana}`}
          >
            {caso.campana}
          </span>
        ) : (
          <span
            className="rounded px-1.5 py-0.5 font-medium"
            style={{ backgroundColor: '#FEF3C7', color: OCRE }}
            title="El contacto llegó por Meta, pero la interacción no trae campaña: no se pudo atribuir"
          >
            Meta sin campaña
          </span>
        )
      ) : (
        <span style={{ color: '#9CA3AF' }} title="El contacto no tiene ninguna interacción de Meta registrada. No significa que no haya venido de Meta: significa que no dejó rastro.">
          — sin rastro de Meta
        </span>
      )}

      {/* Dos avisos de gravedad distinta, y por eso no comparten insignia. El de
          arriba es un desacuerdo de atribución interna; este es un pago a un tercero
          (20% promotor contra 16% marketing) sobre un lead que entró por Meta. */}
      {caso.comision_retenida ? (
        <span
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold"
          style={{ backgroundColor: '#FEE2E2', color: '#B91C1C' }}
          title="Se declaró promotor y el lead entró por Meta. La comisión NO se liquida hasta que alguien decida cuál de los dos orígenes vale."
        >
          <AlertTriangle className="h-2.5 w-2.5" /> Comisión retenida
        </span>
      ) : caso.atribucion_en_conflicto ? (
        <span
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-semibold"
          style={{ backgroundColor: '#FEF3C7', color: OCRE }}
          title="Lo declarado y el rastro no coinciden. Quién se lleva la comisión lo decide una persona, no el sistema."
        >
          <AlertTriangle className="h-2.5 w-2.5" /> Revisar atribución
        </span>
      ) : null}
    </div>
  )
}

/** Una fecha del caso. Sin dato se dice "—": dejarlo en blanco parece un error de carga. */
function Fecha({ label, valor, extra }: { label: string; valor: string | null; extra?: string | null }) {
  return (
    <span className="flex items-baseline gap-1">
      <span style={{ color: BORDE === '#E5E7EB' ? '#9CA3AF' : GRIS }}>{label}</span>
      <span className="font-medium tabular-nums" style={{ color: valor ? CARBON : '#9CA3AF' }}>
        {valor ?? '—'}
      </span>
      {extra && <span style={{ color: '#9CA3AF' }}>· {extra}</span>}
    </span>
  )
}
