import type { Metadata } from 'next';
import { abrirSolicitud } from '@/lib/actions/vinculacion-publica';
import {
  MENSAJE_ENLACE_SOLICITUD,
  esMotivoEnlaceSolicitud,
} from '@/lib/compliance/solicitud-vinculacion';
import SolicitudClient from './solicitud-client';

export const metadata: Metadata = {
  title: 'Solicitud de vinculación',
  // Este enlace sí se comparte a propósito, pero indexarlo lo pondría a recibir
  // tráfico de buscadores contra un endpoint que crea expedientes y manda
  // correos. Se comparte de mano en mano, no desde Google.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function SolicitudPublicaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const r = await abrirSolicitud(token);

  if (!r.ok) {
    const motivo = esMotivoEnlaceSolicitud(r.error) ? r.error : null;
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-bold text-tinta">
            {motivo === 'cerrado' ? 'Enlace cerrado' : 'Enlace no disponible'}
          </h1>
          <p className="text-sm text-tinta-suave mt-2">
            {motivo
              ? MENSAJE_ENLACE_SOLICITUD[motivo]
              : 'No pudimos abrir este enlace en este momento. Vuelve a intentar en unos minutos.'}
          </p>
        </div>
      </main>
    );
  }

  return <SolicitudClient token={token} marca={r.data.marca} />;
}
