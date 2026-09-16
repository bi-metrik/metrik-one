import { redirect } from 'next/navigation'
import { AlertTriangle, Package } from 'lucide-react'
import EmptyState from '@/components/empty-state'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getPlatformAdminState } from '@/lib/actions/platform-admin'
import { catalogoDeWorkspace, type ServicioDelCatalogo } from '@/lib/catalogo/servicios-de-workspace'

export const dynamic = 'force-dynamic'

/**
 * `/servicios`: los módulos del workspace y el tipo de servicio que cubre cada uno.
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §2.4 (entregas A1 y A2).
 *
 * ## Qué muestra hoy, y qué NO afirma
 *
 * A1 dejó la ruta vacía. A2 trae el catálogo, así que ya se puede decir **qué se tiene y bajo
 * qué condiciones se vende**. Lo que todavía no existe son los servicios contratados
 * (`servicios_contratados` nace vacía; los contratos de hoy se cargan en A3), así que esta
 * pantalla **no dice «al día» ni «próxima renovación»**: lo declara pendiente. Un estado
 * inventado sobre una tabla vacía sería una pantalla sana que miente, que es peor que una vacía.
 *
 * Es ruta COMÚN (`RUTAS_COMUNES`): abre con cualquier módulo y también en modo vitrina, porque
 * un cliente tiene que poder ver qué paga sin depender de lo que paga.
 */
export default async function ServiciosPage() {
  const { workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) redirect('/login')
  // Solo owner y admin: aquí va a vivir el precio, el medio de pago y la cancelación.
  if (role !== 'owner' && role !== 'admin') redirect('/')

  // La vista de operador (el catálogo completo) es de MéTRIK, no del cliente. `getPlatformAdminState`
  // devuelve null para todo el que no lo sea, así que el gate es la ausencia, no un flag.
  const admin = await getPlatformAdminState()
  const vistaOperador = admin?.platformAdmin === true
  const { modulos, catalogo, contratos, error: errorDatos } = await catalogoDeWorkspace(workspaceId, {
    vistaOperador,
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Package className="h-6 w-6 text-acento" />
        <div>
          <h1 className="text-xl font-bold text-tinta">Servicios</h1>
          <p className="text-sm text-tinta-suave">
            Los módulos de tu espacio y el servicio que cubre cada uno.
          </p>
        </div>
      </div>

      {errorDatos ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">No se pudo leer el catálogo</p>
            {/* Decirlo, y no pintar una lista vacía: «falló» y «no hay nada» no son lo mismo. */}
            <p className="mt-1">{errorDatos}</p>
          </div>
        </div>
      ) : modulos.length === 0 ? (
        <EmptyState
          title="Este espacio no tiene módulos encendidos"
          description="Cuando se active un módulo vas a verlo aquí con el servicio que lo cubre."
        />
      ) : (
        <ul className="space-y-3">
          {modulos.map((m) => (
            <li key={m.id} className="rounded-lg border border-border bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-tinta">{m.nombre}</h2>
                {m.servicio ? (
                  <span className="text-xs text-tinta-suave">
                    {m.servicio.nombre} · v{m.servicio.versionVigente}
                  </span>
                ) : (
                  <span className="text-xs text-tinta-suave">Sin servicio en el catálogo todavía</span>
                )}
              </div>

              {m.servicio?.descripcion && (
                <p className="mt-2 text-sm text-tinta-suave">{m.servicio.descripcion}</p>
              )}

              {m.servicio && (
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-tinta-suave">
                  <div>
                    <dt className="inline font-medium">Se cobra: </dt>
                    <dd className="inline">{etiquetaDisparador(m.servicio.disparadorCobro)}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">IVA: </dt>
                    <dd className="inline">{etiquetaIva(m.servicio.tratamientoIva)}</dd>
                  </div>
                </dl>
              )}

              <p className="mt-3 text-xs text-tinta-suave">
                {/* Lo que falta se nombra. Es lo único honesto mientras no haya contratos. */}
                Todavía no hay un contrato registrado para este módulo, así que aquí no aparece
                su precio ni su próxima renovación.
              </p>
            </li>
          ))}
        </ul>
      )}

      {contratos > 0 && (
        <p className="text-xs text-tinta-suave">
          Este espacio tiene {contratos} servicio(s) contratado(s). El detalle llega con la
          siguiente entrega.
        </p>
      )}

      {vistaOperador && <Catalogo servicios={catalogo} />}
    </div>
  )
}

function etiquetaDisparador(d: ServicioDelCatalogo['disparadorCobro']): string {
  if (d === 'ciclo') return 'cada periodo'
  if (d === 'consumo') return 'al consumir el paquete'
  return 'una sola vez'
}

function etiquetaIva(t: string | null): string {
  if (t === 'excluido') return 'excluido'
  if (t === 'exento') return 'exento'
  if (t === 'gravado') return 'gravado'
  return 'sin declarar'
}

/**
 * El catálogo completo, en solo lectura. **No se edita desde ONE a propósito**: el tipo de
 * servicio nace en el cerebro, y dos lugares donde se cambia el precio de lista terminan con
 * dos precios. Por eso cada fila cita su archivo fuente (§3.2).
 */
function Catalogo({ servicios }: { servicios: ServicioDelCatalogo[] }) {
  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div>
        <h2 className="text-base font-semibold text-tinta">Catálogo de servicios</h2>
        <p className="text-xs text-tinta-suave">
          Solo lectura. El catálogo se escribe en el cerebro y llega aquí publicado; cambiar un
          precio de lista exige subir la versión, para que ningún contrato firmado cambie por
          debajo.
        </p>
      </div>

      {servicios.length === 0 ? (
        <EmptyState
          title="El catálogo todavía no tiene servicios"
          description="Llegan cuando la Action del cerebro publique los archivos de cerebro/catalogo/servicios."
        />
      ) : (
        <ul className="space-y-2">
          {servicios.map((s) => (
            <li key={s.slug} className="rounded-lg border border-border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-tinta">{s.nombre}</span>
                <span className="text-xs text-tinta-suave">
                  {s.slug} · v{s.versionVigente}
                  {!s.activo && ' · inactivo'}
                </span>
              </div>
              <p className="mt-1 text-xs text-tinta-suave">
                Módulo {s.modulo} · se cobra {etiquetaDisparador(s.disparadorCobro)} · IVA{' '}
                {etiquetaIva(s.tratamientoIva)}
              </p>
              {s.fuenteRuta && (
                <p className="mt-1 text-[11px] text-tinta-suave">
                  Fuente: {s.fuenteRuta}, versión {s.versionVigente}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
