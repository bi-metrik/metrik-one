import { redirect } from 'next/navigation';
import EmptyState from '@/components/empty-state';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { listarConsultasValida } from '@/lib/actions/valida-consultas';
import { getTutorialProgress } from '@/lib/actions/tutorial-progress';
import { armarEstadoEntradaPagina } from '@/lib/valida-api/entrada-aprobacion';
import { POLITICA_DATOS_VALIDA, textoAvisoPolitica } from '@/lib/valida-api/politica';
import { designacionDelEspacio } from '@/lib/valida-api/terminos-servidor';
import { entradaValidaCda, type EntradaValidaCda } from '@/lib/valida-cda/puerta';
import { leerProximoPagoCda, type LecturaPago } from '@/lib/valida-cda/pago-servidor';
import ValidaClient from './valida-client';
import { PagoPendienteCard } from './pago-pendiente-card';
import { TerminosCda } from './terminos-cda';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ negocio_id?: string }>;
}

export default async function ValidaPage({ searchParams }: Props) {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) redirect('/');

  // Validar flag activo
  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules, config_extra')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  if (!modules.valida_consulta) redirect('/');

  // Los términos de suscripción de los CDA (contrato directo con METRIK IA S.A.S.). Esta página se
  // renderiza en cada navegación, así que la puerta vive aquí y no en un layout, que en navegación
  // suave no vuelve a correr. Las acciones del módulo la vuelven a exigir en `accesoValida()`.
  // Un espacio sin contrato de Valida (AFI, metrik) queda `libre` y ve lo de siempre.
  const entrada = await entradaValidaCda();
  if (entrada.tipo === 'no_disponible' || (entrada.tipo === 'ok' && entrada.estado.estado === 'no_disponible')) {
    return (
      <EmptyState
        title="No se pudo verificar la aceptación de los términos de tu empresa"
        description="Sin esa verificación Valida no se abre. Intenta de nuevo en un momento."
      />
    );
  }
  if (entrada.tipo === 'ok' && entrada.estado.estado === 'sin_documentos') {
    return (
      <EmptyState
        title="Los términos de tu suscripción todavía no están registrados"
        description="Valida se abre cuando MeTRIK registre los términos de tu suscripción y la persona designada por tu empresa los acepte. Escríbenos si esperabas verlos."
      />
    );
  }
  if (entrada.tipo === 'ok' && entrada.estado.estado === 'pendiente') {
    const pagina = await armarEstadoEntradaPagina({ workspaceId: entrada.workspaceId }, entrada.estado);
    if (pagina.estado !== 'pendiente') {
      return (
        <EmptyState
          title="No se pudo verificar la aceptación de los términos de tu empresa"
          description="Sin esa verificación Valida no se abre. Intenta de nuevo en un momento."
        />
      );
    }
    return (
      <TerminosCda
        entrada={pagina}
        aviso={textoAvisoPolitica('valida_cda')}
        politicaUrl={POLITICA_DATOS_VALIDA.url}
        politicaTitulo={`${POLITICA_DATOS_VALIDA.titulo} v${POLITICA_DATOS_VALIDA.version}`}
      />
    );
  }

  // Modo vitrina (workspaces Valida-only): oculta la asociación a negocio en
  // consulta puntual / carga masiva / historial y quita la columna negocio_codigo
  // de la plantilla. Opt-in; sin el flag, comportamiento idéntico (AFI conserva
  // el picker — ellos atan consultas a negocios=CDAs).
  const modoVitrina =
    (wsRow?.config_extra as { modo_vitrina?: boolean } | null)?.modo_vitrina === true;

  const { negocio_id: negocioId } = await searchParams;

  // Resolver negocio si viene en query (para preset del filtro)
  let negocioInicial: { id: string; codigo: string; nombre: string; estado: string } | null = null;
  if (negocioId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neg } = await (svc.from('negocios') as any)
      .select('id, codigo, nombre, estado')
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .single();
    if (neg) negocioInicial = neg;
  }

  const [historial, tutorialProgress, pago] = await Promise.all([
    listarConsultasValida({
      limite: 100,
      ...(negocioInicial ? { negocio_id: negocioInicial.id } : {}),
    }),
    getTutorialProgress('valida_standalone'),
    pagoVisible(entrada),
  ]);

  return (
    <ValidaClient
      historialInicial={historial.ok ? historial.consultas : []}
      errorHistorial={historial.ok ? null : historial.error}
      tutorialNuncaVisto={tutorialProgress === null}
      negocioInicial={modoVitrina ? null : negocioInicial}
      modoVitrina={modoVitrina}
      encabezado={pago ? <PagoPendienteCard lectura={pago} /> : null}
    />
  );
}

/**
 * El próximo pago de la licencia, solo para un CDA que PAGA su contrato y solo a quienes manejan
 * la plata del espacio (dueño y administradores) o a la persona designada por la empresa. Los
 * demás no ven montos. Cualquier falla aquí oculta la tarjeta: el pago no bloquea el módulo.
 */
async function pagoVisible(entrada: EntradaValidaCda): Promise<LecturaPago | null> {
  if (entrada.tipo !== 'ok' || !entrada.servicioContratadoId) return null;
  let puedeVer = entrada.role === 'owner' || entrada.role === 'admin';
  if (!puedeVer) {
    const designacion = await designacionDelEspacio(entrada.workspaceId);
    puedeVer = designacion !== 'error' && designacion.designadoId === entrada.usuarioId;
  }
  if (!puedeVer) return null;
  return leerProximoPagoCda(entrada.servicioContratadoId, entrada.hoy);
}
