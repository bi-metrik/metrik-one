import { KeyRound } from 'lucide-react'
import EmptyState from '@/components/empty-state'
import {
  estadoEntradaValidaApi,
  leerDocumentosValidaApi,
  leerLlavesValidaApi,
  leerPagosValidaApi,
  leerResumenValidaApi,
} from '@/lib/valida-api/acciones'
import { contextoValidaApi } from '@/lib/valida-api/contexto'
import { POLITICA_DATOS_VALIDA, textoAvisoPolitica } from '@/lib/valida-api/politica'
import { puedeOperarLlaves, puedeVerPagos } from '@/lib/valida-api/reglas'
import { EntradaValidaApi, ValidaApiCliente } from './valida-api-cliente'

export const dynamic = 'force-dynamic'

/**
 * `/valida-api`: el módulo de los clientes de API directa (4D SOFT es el primero).
 *
 * Spec: `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, §5.4 (entrega C2).
 *
 * ## Qué hace esta página, y qué NO
 *
 * - Las llaves y el consumo **viven en Valida**: ONE los opera por las rutas firmadas
 *   `/api/one/v1/*` y no guarda copia (§5.6).
 * - Documentos y pagos **viven en el workspace metrik** y se leen solo por RPC cerradas (§3.6).
 * - La suscripción es la entrega C4: su pestaña lo dice y no inventa datos.
 * - El portal v1 de Valida **sigue vivo en paralelo** mientras 4D SOFT aprueba (decisión de
 *   Mauricio, 2026-09-16): nada aquí lo apaga ni lo redirige. Eso es C3.
 *
 * ## La entrada: una sola pantalla y una sola aprobación
 *
 * Antes de cualquier pestaña, cada usuario lee ahí mismo los términos vigentes del contrato hasta
 * el final, ve el aviso de la Política de Datos y acepta todo con un solo clic (`entrada.ts`). Si
 * el contrato del espacio no tiene su aceptación contractual, la firma el dueño en esa misma
 * pantalla; los demás ven los términos y el aviso, pero no pueden aprobar. Mientras falte algo, no
 * hay pestañas, y las acciones del servidor y las descargas también se niegan.
 *
 * ## Cada pestaña carga sola
 *
 * Las cuatro lecturas salen en paralelo y cada una devuelve su propio estado. Si Valida no
 * responde, Llaves y Consumo dicen «no disponible» y Documentos, Pagos y Ayuda cargan igual
 * (§5.4). Un `Promise.all` que tumbara la página entera por una llamada caída sería justo lo que
 * la spec pide evitar.
 */
export default async function ValidaApiPage() {
  const ctx = await contextoValidaApi()

  if (ctx.tipo !== 'ok') {
    // El middleware ya saca de aquí a un workspace sin el módulo; esto cubre al platform_admin
    // (pasa el gate por ruta) y al workspace con el módulo pero sin cliente configurado.
    const descripcion =
      ctx.tipo === 'sin_actor'
        ? 'Tu usuario no tiene un correo registrado. Sin él, las operaciones sobre las llaves no se pueden atribuir.'
        : ctx.tipo === 'error_lectura'
          ? 'No se pudo leer la configuración de este espacio. Intenta de nuevo en un momento.'
          : 'Este espacio no tiene el módulo Valida API configurado.'
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState title="Valida API no está disponible aquí" description={descripcion} />
      </div>
    )
  }

  const entrada = await estadoEntradaValidaApi()

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-acento" />
        <div>
          <h1 className="text-xl font-bold text-tinta">Valida API</h1>
          <p className="text-sm text-tinta-suave">
            Las llaves de tu integración, el consumo de tu paquete y los documentos de tu contrato.
          </p>
        </div>
      </div>

      {entrada.estado === 'aprobada' ? (
        <PestanasCargadas role={ctx.role} />
      ) : entrada.estado === 'pendiente' ? (
        <EntradaValidaApi
          entrada={entrada}
          aviso={textoAvisoPolitica()}
          politicaUrl={POLITICA_DATOS_VALIDA.url}
          politicaTitulo={`${POLITICA_DATOS_VALIDA.titulo} v${POLITICA_DATOS_VALIDA.version}`}
        />
      ) : entrada.estado === 'sin_documentos' ? (
        <EmptyState
          title="Los términos de tu contrato todavía no están registrados"
          description="El módulo se abre cuando MeTRIK registre los términos de tu contrato y los aceptes aquí. Escríbenos si esperabas verlos."
        />
      ) : (
        <EmptyState
          title="No se pudo verificar tu aceptación de los términos"
          description="Sin esa verificación el módulo no se abre. Intenta de nuevo en un momento."
        />
      )}
    </div>
  )
}

async function PestanasCargadas({ role }: { role: string }) {
  const operaLlaves = puedeOperarLlaves(role)
  const vePagos = puedeVerPagos(role)

  const [resumen, llaves, documentos, pagos] = await Promise.all([
    leerResumenValidaApi(),
    operaLlaves ? leerLlavesValidaApi() : Promise.resolve(null),
    leerDocumentosValidaApi(),
    vePagos ? leerPagosValidaApi() : Promise.resolve(null),
  ])

  return (
    <ValidaApiCliente
      resumen={resumen}
      llaves={llaves}
      documentos={documentos}
      pagos={pagos}
      operaLlaves={operaLlaves}
      vePagos={vePagos}
    />
  )
}
