/**
 * Arma el Excel de la tabla de negocios: lee todo lo que la fila necesita y devuelve el
 * buffer .xlsx listo para entregar.
 *
 * ── Por que vive aqui y no dentro de la ruta ──
 *
 * Tiene DOS consumidores: la descarga (`POST /api/negocios/export`, que lo manda al
 * navegador) y la subida a Drive (`subirExportNegociosADrive`, que lo manda a una hoja
 * de Google). Los dos tienen que entregar **el mismo archivo**: si el que se sube a
 * Drive se generara por una segunda via, bastaria con que alguien arreglara una columna
 * en una de las dos para que el equipo estuviera mirando dos verdades del mismo dia sin
 * forma de saber cual. Aqui no pueden divergir porque son la misma funcion.
 *
 * Solo lectura. No escribe nada.
 *
 * Server-only — arrastra `createServiceClient`.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginar'
import { getNegociosV2 } from '@/app/(app)/negocios/negocio-v2-actions'
import { construirLibroNegocios } from '@/lib/negocios/export-excel-libro'
import {
  armarFilasExcel,
  type BonificableNegocio,
  type CobroExportable,
  type ComercialNegocio,
  type ResponsableOperaciones,
  type StaffNombre,
  type TramoCobro,
  type ValorNegocio,
  type VentaNegocio,
} from '@/lib/negocios/export-excel'

const PREFIJO = '[negocios-export]'

// Las vistas del dinero no estan en `database.ts` y algunas son server-only:
// se leen sin tipar, como hace el resto del modulo de negocios.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (c: unknown): any => c

/** `.in()` viaja en la URL: con miles de ids se pasa del largo permitido. */
const TAMANO_LOTE_IDS = 200

function lotes<T>(xs: T[], tamano: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += tamano) out.push(xs.slice(i, i + tamano))
  return out
}

export interface ExportNegocios {
  buffer: Buffer<ArrayBuffer>
  /** Slug del workspace, para nombrar el archivo. */
  slug: string
  /** Cuantos de los ids pedidos llegaron de verdad al archivo. */
  filas: number
}

/**
 * Lee y serializa el Excel de los negocios pedidos, en el orden en que llegan los ids.
 *
 * @param supabase  cliente de la SESION (para lo que si esta concedido a `authenticated`)
 * @param workspaceId  workspace de la sesion
 * @param ids  ids de los negocios, en el orden en que se quieren las filas
 *
 * Lanza si cualquier lectura falla. Nunca devuelve un archivo a medias con cara de
 * completo: ese es el modo de fallo que `traerTodo` existe para hacer imposible.
 */
export async function construirExportNegocios(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  ids: string[],
): Promise<ExportNegocios> {
  // ── 1. Los negocios, tal como los ve la lista (mismo origen que la pantalla) ──
  //
  // ⚠️ Los dos argumentos tienen que ser EXACTAMENTE los de `negocios/page.tsx`. Lo que
  // esta funcion no encuentre en su mapa se cae del archivo sin ruido (`porId.get(id)` +
  // `filter(Boolean)`): el usuario ve N filas en pantalla y baja menos, sin error.
  const [abiertos, cerrados, wsRes] = await Promise.all([
    getNegociosV2('abierto'),
    getNegociosV2('cerrado'),
    supabase.from('workspaces').select('slug').eq('id', workspaceId).single(),
  ])
  if (wsRes.error || !wsRes.data?.slug) {
    throw new Error(`workspace: ${wsRes.error?.message ?? 'sin slug'}`)
  }
  const slug = wsRes.data.slug as string

  const porId = new Map([...abiertos, ...cerrados].map((n) => [n.id, n]))
  // En el orden en que el cliente los mando, que es el orden de la pantalla.
  const negocios = ids.map((id) => porId.get(id)).filter((n): n is NonNullable<typeof n> => !!n)
  const idsValidos = negocios.map((n) => n.id)
  const enLista = new Set(idsValidos)

  // ── 2. Dinero, venta, comercial, bonificable: vistas server-only ──
  //
  // Van con el cliente de SERVICIO a proposito: `v_venta_mes_comercial`,
  // `v_negocio_bonificable` y `v_negocio_comercial` estan revocadas a
  // `authenticated`, y con el cliente de la sesion devuelven `42501`, que un `?? []`
  // convertiria en ceros sin que nadie lo note (mismo patron que `numeros/actions-v2`,
  // PR #518). El `.eq('workspace_id', …)` NO es adorno: el service client no pasa por
  // RLS y sin el la lectura mezclaria los quince workspaces.
  //
  // Se lee todo el workspace y se filtra en memoria por los ids pedidos: mandar los
  // ids por `.in()` romperia la URL con miles, y las vistas no tienen mas filas que
  // negocios. Todas pasan por `traerTodo` con orden estable: PostgREST corta en
  // 1.000 filas sin avisar.
  const svc = createServiceClient()
  const soloPedidos = <T extends { negocio_id: string | null }>(xs: T[]) =>
    xs.filter((x) => x.negocio_id && enLista.has(x.negocio_id))

  const [valores, ventas, bonificables, comerciales, tramos, cobros, staff] = await Promise.all([
    traerTodo<ValorNegocio>(
      (desde, hasta) =>
        db(svc)
          .from('v_negocio_valor')
          .select('negocio_id, valor_base, valor_iva, plan_pago, techo_tarifa')
          .eq('workspace_id', workspaceId)
          .order('negocio_id')
          .range(desde, hasta),
      { etiqueta: `${PREFIJO} v_negocio_valor` },
    ),
    traerTodo<VentaNegocio>(
      (desde, hasta) =>
        db(svc)
          .from('v_venta_mes_comercial')
          .select('negocio_id, fecha_venta, caso_completo')
          .eq('workspace_id', workspaceId)
          .order('negocio_id')
          .range(desde, hasta),
      { etiqueta: `${PREFIJO} v_venta_mes_comercial` },
    ),
    traerTodo<BonificableNegocio>(
      (desde, hasta) =>
        db(svc)
          .from('v_negocio_bonificable')
          .select('negocio_id, bonificable')
          .eq('workspace_id', workspaceId)
          .order('negocio_id')
          .range(desde, hasta),
      { etiqueta: `${PREFIJO} v_negocio_bonificable` },
    ),
    traerTodo<ComercialNegocio>(
      (desde, hasta) =>
        db(svc)
          .from('v_negocio_comercial')
          .select('negocio_id, comercial_staff_id')
          .eq('workspace_id', workspaceId)
          .order('negocio_id')
          .range(desde, hasta),
      { etiqueta: `${PREFIJO} v_negocio_comercial` },
    ),
    // Tramos BRUTOS (con IVA) de cada cobro: es el recaudado de honorario que se
    // resta del honorario con IVA. Ver la cabecera de `export-excel.ts`.
    traerTodo<TramoCobro>(
      (desde, hasta) =>
        db(svc)
          .from('v_cobro_valor')
          .select('negocio_id, a_tramo1, a_tramo2')
          .eq('workspace_id', workspaceId)
          .order('cobro_id')
          .range(desde, hasta),
      { etiqueta: `${PREFIJO} v_cobro_valor` },
    ),
    // Los pagos uno a uno (para primer/segundo/otros). Con la sesion: `cobros` si
    // esta concedida y la RLS acota por workspace; el filtro explicito lo refuerza.
    traerTodo<CobroExportable>(
      (desde, hasta) =>
        db(supabase)
          .from('cobros')
          .select('id, negocio_id, monto, fecha, created_at, external_ref, anulado_at')
          .eq('workspace_id', workspaceId)
          .is('anulado_at', null)
          .not('negocio_id', 'is', null)
          .order('fecha', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(desde, hasta),
      { etiqueta: `${PREFIJO} cobros` },
    ),
    traerTodo<StaffNombre>(
      (desde, hasta) =>
        db(supabase)
          .from('staff')
          .select('id, full_name')
          .eq('workspace_id', workspaceId)
          .order('id')
          .range(desde, hasta),
      { etiqueta: `${PREFIJO} staff` },
    ),
  ])

  // ── 3. Responsable de operaciones (`negocio_responsables.rol`) ──
  // No tiene `workspace_id`: se pide por ids, en lotes que quepan en la URL.
  const operaciones: ResponsableOperaciones[] = []
  for (const lote of lotes(idsValidos, TAMANO_LOTE_IDS)) {
    const filas = await traerTodo<ResponsableOperaciones>(
      (desde, hasta) =>
        db(supabase)
          .from('negocio_responsables')
          .select('negocio_id, staff_id')
          .in('negocio_id', lote)
          .eq('rol', 'operaciones')
          .order('negocio_id')
          .order('staff_id')
          .range(desde, hasta),
      { etiqueta: `${PREFIJO} negocio_responsables` },
    )
    operaciones.push(...filas)
  }

  // ── 4. Filas y hoja ──
  const filas = armarFilasExcel({
    negocios,
    valores: soloPedidos(valores),
    ventas: soloPedidos(ventas),
    bonificables: soloPedidos(bonificables),
    comerciales: soloPedidos(comerciales),
    tramos: soloPedidos(tramos),
    cobros: soloPedidos(cobros),
    operaciones,
    staff,
    baseUrl: baseUrlDelWorkspace(slug),
  })

  return { buffer: construirLibroNegocios(filas), slug, filas: filas.length }
}

export function baseUrlDelWorkspace(slug: string): string {
  const dominio = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  const protocolo = dominio.startsWith('localhost') ? 'http' : 'https'
  return `${protocolo}://${slug}.${dominio}`
}
