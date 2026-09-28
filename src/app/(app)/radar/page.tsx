import { Radar as RadarIcon } from 'lucide-react'
import EmptyState from '@/components/empty-state'
import { EntradaTerminos } from '@/components/terminos/entrada-terminos'
import { POLITICA_DATOS_VALIDA, textoAvisoPolitica } from '@/lib/valida-api/politica'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { estadoEntradaRadar } from '@/lib/radar/acciones'
import { accesoRadar } from '@/lib/radar/acceso-servidor'
import { contextoRadar } from '@/lib/radar/contexto'
import { bibliotecaParaPantalla, leerPerfilActivo, leerProcesosVigentes } from '@/lib/radar/datos-servidor'
import { RadarCliente } from './radar-cliente'
import { RadarCerrado } from './radar-cerrado'
import { BannerTrial } from './banner-trial'

export const dynamic = 'force-dynamic'

/**
 * `/radar`: el Radar SECOP. Convocatorias vigentes de SECOP II cruzadas contra los temas del
 * negocio del cliente.
 *
 * Spec: `proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md`, bloques B y E. La referencia
 * visual y funcional es `metrik-data/dashboard/index.html`, aprobada por Noor: columnas Vence en /
 * Fit / Entidad / Región / Área / Modalidad / RUP / Valor / Objeto, la fila entera abre el detalle,
 * flecha de orden y poda por importancia en pantalla angosta.
 *
 * ## El puntaje se calcula en el navegador, y no es un atajo
 *
 * El servidor manda el universo de procesos y la biblioteca; `puntuar.ts` corre en el cliente. Así
 * el usuario cambia el peso de un tema y ve el orden moverse sin esperar un round-trip, que es la
 * forma en que la biblioteca se calibra. Es la MISMA implementación que usaría el servidor: hay una
 * sola, y sus pruebas de caso la fijan.
 *
 * ## El trial y el cierre por pago
 *
 * Después del gate de términos hay un segundo gate: el PAGO (`lib/radar/acceso.ts`). El trial son 5
 * días contados desde la aceptación de los términos y, al vencer sin pago confirmado, esta página no
 * pinta ni una convocatoria: solo el enlace de pago. Es lo que decidió Mauricio el 2026-09-28, y en
 * `acceso.ts` está por qué a este módulo no le sirve el «solo lectura» con que Clarity y Valida
 * manejan la mora.
 *
 * ## Qué queda fuera de esta entrega, a propósito
 *
 * - **El botón «esto se persigue»** que crea el negocio en el pipeline. Es lo siguiente (bloque E
 *   de la spec lo deja anotado): ahí el Radar deja de ser una herramienta y se vuelve fuente de
 *   pipeline.
 * - **Las cinco gráficas** de la referencia (región, área, valor, RUP, cuándo cierran). La spec
 *   enumera lo que manda de la referencia y las gráficas no están en esa lista; las tarjetas de
 *   arriba dan las mismas cifras que ellas resumían.
 * - **El editor de la biblioteca de temas** (crear temas propios, cambiar pesos uno por uno). El
 *   esquema ya lo soporta (`radar_temas`, `radar_perfiles.pesos`) y la pantalla deja elegir el
 *   perfil de fábrica y ver lo que trae; afinar tema por tema es la entrega que sigue.
 */
export default async function RadarPage() {
  const ctx = await contextoRadar()

  if (ctx.tipo !== 'ok') {
    // El middleware ya saca de aquí a un workspace sin el módulo; esto cubre al platform_admin (que
    // pasa el gate por ruta) y al fallo de lectura.
    const descripcion =
      ctx.tipo === 'error_lectura'
        ? 'No se pudo leer la configuración de este espacio. Intenta de nuevo en un momento.'
        : ctx.tipo === 'sin_usuario'
          ? 'Tu sesión no tiene un usuario al que atribuir lo que marques como seguido.'
          : 'Este espacio no tiene el módulo Radar SECOP.'
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <EmptyState title="El Radar SECOP no está disponible aquí" description={descripcion} />
      </div>
    )
  }

  const entrada = await estadoEntradaRadar()

  const encabezado = (
    <div className="flex items-center gap-3">
      <RadarIcon className="h-6 w-6 text-acento" />
      <div>
        <h1 className="text-xl font-bold text-tinta">Radar SECOP</h1>
        <p className="text-sm text-tinta-suave">
          Convocatorias vigentes en SECOP&nbsp;II, cruzadas contra los temas de tu negocio.
        </p>
      </div>
    </div>
  )

  if (entrada.estado !== 'aprobada') {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        {encabezado}
        {entrada.estado === 'pendiente' ? (
          <EntradaTerminos
            entrada={entrada}
            aviso={textoAvisoPolitica('radar_secop')}
            politicaUrl={POLITICA_DATOS_VALIDA.url}
            politicaTitulo={`${POLITICA_DATOS_VALIDA.titulo} v${POLITICA_DATOS_VALIDA.version}`}
            producto="radar_secop"
          />
        ) : entrada.estado === 'sin_documentos' ? (
          <EmptyState
            title="Los términos de uso del Radar todavía no están registrados"
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

  // El segundo gate: el pago. Va DESPUÉS de los términos porque el trial se cuenta desde que se
  // aceptaron: sin aceptación no hay trial que medir.
  const { acceso, pago } = await accesoRadar()
  if (acceso.estado === 'cerrado') {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        {encabezado}
        <RadarCerrado acceso={acceso} pago={pago} />
      </div>
    )
  }

  const hoy = todayBogotaISO()
  // Las dos lecturas en paralelo, y cada una lanza si no puede garantizar el resultado completo:
  // media lista de procesos se leería como «esta semana hay menos convocatorias».
  const [procesos, perfil] = await Promise.all([leerProcesosVigentes(hoy), leerPerfilActivo(ctx.workspaceId)])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {encabezado}
      {/* El contador de la prueba lo calcula el servidor (`accesoRadar`); la pantalla recibe el
          número de días, nunca la fecha para restarla en el navegador. */}
      {acceso.estado === 'en_trial' && <BannerTrial diasRestantes={acceso.diasRestantes} pago={pago} />}
      <RadarCliente
        procesos={procesos}
        perfil={perfil}
        biblioteca={bibliotecaParaPantalla()}
        hoy={hoy}
        puedeEditar={ctx.role === 'owner' || ctx.role === 'admin' || ctx.role === 'supervisor'}
      />
    </div>
  )
}
