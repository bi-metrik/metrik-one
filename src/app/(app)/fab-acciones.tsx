import { Flame, Receipt, Clock, Landmark, Banknote, Wallet } from 'lucide-react'
import { FEATURES } from '@/lib/feature-flags'

/**
 * Catálogo de acciones del FAB, las dos reglas que deciden cuáles se ven y cuáles
 * quedan apagadas, y el menú que las pinta.
 *
 * Vive fuera de `fab.tsx` para poder probarse: el menú solo existe cuando el usuario
 * abre el botón (`{open && …}`), así que renderizar el FAB entero no muestra nada, y
 * el estado que lo abre depende de un `useEffect` que en el servidor no corre.
 */

export interface AccionFab {
  label: string
  icon: typeof Flame
  roles: string[]
  href?: string
  action?: string
  feature?: keyof typeof FEATURES
  /**
   * Flag de `workspaces.modules` que enciende esta acción. Sin el flag no se pinta:
   * el FAB es la puerta más visible del producto y un botón que el cliente no usa
   * no es neutro, ocupa el lugar de los que sí.
   */
  modulo?: string
  contextAware?: boolean
  /** Solo visible parado sobre un negocio. */
  contextOnly?: boolean
  /**
   * Le carga información AL negocio del contexto, así que se apaga cuando ese
   * negocio está cerrado. Las que NO la traen no dependen del contexto y se quedan:
   * "Nuevo negocio" crea otro caso y "Actualizar saldo" es del banco, no del negocio.
   */
  alimentaElNegocio?: boolean
}

export const FAB_ACTIONS: AccionFab[] = [
  {
    label: 'Registrar cobro',
    icon: Banknote,
    href: '/nuevo/cobro',
    roles: ['owner', 'admin'],
    modulo: 'fab_registrar_cobro',
  },
  {
    label: 'Registrar horas',
    icon: Clock,
    href: '/nuevo/horas',
    roles: ['owner', 'admin', 'operator', 'supervisor'],
    modulo: 'fab_registrar_horas',
    contextAware: true,
    alimentaElNegocio: true,
  },
  {
    label: 'Registrar gasto',
    icon: Receipt,
    href: '/nuevo/gasto',
    roles: ['owner', 'admin', 'operator', 'supervisor'],
    contextAware: true,
    alimentaElNegocio: true,
  },
  {
    label: 'Nuevo negocio',
    icon: Flame,
    href: '/negocios/nuevo',
    roles: ['owner', 'admin', 'supervisor', 'operator'],
  },
  {
    label: 'Actualizar saldo',
    icon: Landmark,
    roles: ['owner', 'admin'],
    action: 'saldo',
    feature: 'CONCILIACION',
  },
]

/**
 * "Registrar pago" es opt-in por workspace (`modules.fab_registrar_pago`) y por eso
 * se inyecta aparte. Su modal elige el negocio de una lista que ya excluye cerrados
 * (`getNegociosParaPagoFab` pide `estado = 'abierto'`): parado sobre uno cerrado, lo
 * único que ofrece es un callejón sin salida, así que también se apaga.
 */
export const ACCION_REGISTRAR_PAGO: AccionFab = {
  label: 'Registrar pago',
  icon: Wallet,
  action: 'pago',
  roles: ['owner', 'admin', 'supervisor', 'operator'],
  alimentaElNegocio: true,
}

/** Las que este rol puede ver ahora mismo. El gate real vive en el servidor. */
export function accionesVisiblesFab(opts: {
  role: string
  registrarPagoEnabled?: boolean
  hayContexto: boolean
  /** `workspaces.modules`. Lo que no venga aquí se lee como apagado. */
  modules?: Record<string, boolean | undefined>
}): AccionFab[] {
  const modules = opts.modules ?? {}
  const todas = opts.registrarPagoEnabled
    ? [...FAB_ACTIONS, ACCION_REGISTRAR_PAGO]
    : FAB_ACTIONS
  return todas.filter((a) =>
    a.roles.includes(opts.role) &&
    (a.feature === undefined || FEATURES[a.feature]) &&
    (a.modulo === undefined || modules[a.modulo] === true) &&
    (!a.contextOnly || opts.hayContexto),
  )
}

/** ¿Se apaga por estar parado sobre un negocio cerrado? */
export function accionBloqueadaPorCierre(a: AccionFab, contextoCerrado: boolean): boolean {
  return contextoCerrado && a.alimentaElNegocio === true
}

/**
 * La lista de acciones del menú abierto.
 *
 * Se apagan, NO desaparecen: un botón que se va sin explicación manda a buscar el
 * problema donde no está. Por eso la nota del final es parte del componente y no un
 * extra — la decisión y su motivo se pintan juntos o no se pintan.
 */
export function MenuAccionesFab({
  acciones,
  contextoCerrado,
  onAccion,
}: {
  acciones: AccionFab[]
  contextoCerrado: boolean
  onAccion: (a: AccionFab) => void
}) {
  return (
    <>
      {acciones.map((action, i) => {
        const Icon = action.icon
        const bloqueada = accionBloqueadaPorCierre(action, contextoCerrado)
        return (
          <button
            key={action.href ?? action.action}
            onClick={() => onAccion(action)}
            disabled={bloqueada}
            className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
              bloqueada
                ? 'cursor-not-allowed text-muted-foreground/50'
                : 'text-foreground hover:bg-accent'
            } ${i < acciones.length - 1 ? 'border-b' : ''}`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${bloqueada ? 'text-muted-foreground/40' : 'text-muted-foreground'}`} />
            {action.label}
          </button>
        )
      })}
      {contextoCerrado && (
        <p className="border-t px-4 py-2.5 text-[11px] leading-snug text-muted-foreground">
          Este negocio está cerrado: no recibe horas, gastos ni pagos.
        </p>
      )}
    </>
  )
}
