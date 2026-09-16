import { KeyRound } from 'lucide-react'
import EmptyState from '@/components/empty-state'
import {
  estadoPoliticaValidaApi,
  estadoTerminosValidaApi,
  leerDocumentosValidaApi,
  leerLlavesValidaApi,
  leerPagosValidaApi,
  leerResumenValidaApi,
} from '@/lib/valida-api/acciones'
import { contextoValidaApi } from '@/lib/valida-api/contexto'
import { POLITICA_DATOS_VALIDA, textoAvisoPolitica } from '@/lib/valida-api/politica'
import { puedeOperarLlaves, puedeVerPagos } from '@/lib/valida-api/reglas'
import { llavesHabilitadas } from '@/lib/valida-api/terminos'
import { AceptarPolitica, TerminosPendientes, ValidaApiCliente } from './valida-api-cliente'

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
 * ## La entrada: primero la Política, después los términos
 *
 * La Política de Datos la acepta cada usuario. Los términos del contrato los acepta el dueño del
 * espacio una vez por versión (cláusula 3.1: sin términos aceptados no se entregan credenciales).
 * Mientras falten, la pestaña Llaves no aparece y sus acciones del servidor se niegan; el resto del
 * módulo carga igual, y Documentos deja leer el texto completo.
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

  const politica = await estadoPoliticaValidaApi()

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

      {politica.estado === 'pendiente' ? (
        <AceptarPolitica
          aviso={textoAvisoPolitica()}
          politicaUrl={POLITICA_DATOS_VALIDA.url}
          politicaTitulo={`${POLITICA_DATOS_VALIDA.titulo} v${POLITICA_DATOS_VALIDA.version}`}
        />
      ) : politica.estado === 'aceptada' ? (
        <ConTerminos role={ctx.role} />
      ) : (
        <EmptyState
          title="No se pudo verificar tu aceptación de la Política de Datos"
          description="Sin esa verificación el módulo no se abre. Intenta de nuevo en un momento."
        />
      )}
    </div>
  )
}

async function ConTerminos({ role }: { role: string }) {
  const terminos = await estadoTerminosValidaApi()
  return (
    <>
      {terminos.estado !== 'aceptados' && <TerminosPendientes estado={terminos} />}
      <PestanasCargadas role={role} operaLlaves={llavesHabilitadas(puedeOperarLlaves(role), terminos)} />
    </>
  )
}

async function PestanasCargadas({ role, operaLlaves }: { role: string; operaLlaves: boolean }) {
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
