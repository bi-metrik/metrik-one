import type { Metadata } from 'next';
import { abrirVinculacion } from '@/lib/actions/vinculacion-publica';
import { MENSAJE_ENLACE, esMotivoEnlaceCerrado } from '@/lib/compliance/vinculacion-publica';
import FormularioClient from './formulario-client';

export const metadata: Metadata = {
  title: 'Vinculación de contraparte',
  // Un enlace con token no se indexa nunca: la URL misma es la credencial.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function VinculacionPublicaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const r = await abrirVinculacion(token);

  if (!r.ok) {
    const motivo = esMotivoEnlaceCerrado(r.error) ? r.error : null;
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-bold text-tinta">
            {motivo === 'cerrado' ? 'Proceso cerrado' : 'Enlace no disponible'}
          </h1>
          <p className="text-sm text-tinta-suave mt-2">
            {motivo
              ? MENSAJE_ENLACE[motivo]
              : 'No pudimos abrir este enlace en este momento. Vuelve a intentar en unos minutos.'}
          </p>
        </div>
      </main>
    );
  }

  return <FormularioClient token={token} inicial={r.data} />;
}
