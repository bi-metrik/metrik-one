'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, ChevronRight, Copy, FolderOpen, Link2, Loader2, RefreshCw, Search } from 'lucide-react';
import {
  listarVinculaciones,
  rotarEnlaceDeSolicitud,
  type BandejaVinculacion,
  type EnlaceSolicitud,
} from '@/lib/actions/compliance-vinculacion';
import { mensajeParaCompartir } from '@/lib/compliance/solicitud-vinculacion';
import {
  ESTADOS_EXPEDIENTE,
  ESTADO_EXPEDIENTE_ACCION,
  ESTADO_EXPEDIENTE_LABEL,
  ETAPA_LABEL,
  nombreContraparte,
  type EstadoExpediente,
} from '@/lib/compliance/vinculacion';

/**
 * El color responde una sola pregunta: ¿esto espera algo de mí? Ámbar sí, gris
 * está en cancha de la contraparte, verde y rojo ya se cerraron.
 */
const CHIP: Record<EstadoExpediente, string> = {
  invitado: 'bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]',
  en_proceso: 'bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]',
  pendiente_revision: 'bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30',
  aprobado: 'bg-[#ECFDF5] text-[#059669] border-[#10B981]/30',
  rechazado: 'bg-[#EF4444]/10 text-[#B91C1C] border-[#EF4444]/30',
  devuelto: 'bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/30',
  vencido: 'bg-[#EF4444]/10 text-[#B91C1C] border-[#EF4444]/30',
  sin_respuesta: 'bg-[#F3F4F6] text-[#4B5563] border-[#D1D5DB]',
};

function fecha(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}


/**
 * El enlace que la empresa comparte para que un proveedor pida vincularse.
 *
 * Está arriba y siempre visible, no detrás de un botón "generar". La alternativa
 * a tenerlo a la mano es seguir creando expedientes uno por uno, que es justo
 * lo que este enlace viene a evitar.
 *
 * Se ofrecen dos copias: la URL pelada, para quien va a pegarla en un correo
 * que ya tiene contexto, y el mensaje completo. El mensaje existe porque un
 * enlace pelado por WhatsApp llega como un link sin remitente pidiendo la
 * cédula del representante legal, que es la forma exacta de una estafa.
 */
function TarjetaEnlace({
  enlace,
  error,
  puedeRotar,
  empresa,
}: {
  enlace: EnlaceSolicitud | null;
  error: string | null;
  puedeRotar: boolean;
  empresa: string;
}) {
  const [actual, setActual] = useState(enlace);
  const [copiado, setCopiado] = useState<'url' | 'mensaje' | null>(null);
  const [rotando, startRotar] = useTransition();
  const [errorRotar, setErrorRotar] = useState<string | null>(null);

  async function copiar(que: 'url' | 'mensaje') {
    if (!actual) return;
    const texto = que === 'url' ? actual.url : mensajeParaCompartir(empresa, actual.url);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(que);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      // Sin permiso de portapapeles no se pierde el enlace: sigue seleccionable
      // en pantalla. Un error acá sería ruido por algo que la persona puede
      // hacer a mano.
    }
  }

  function rotar() {
    if (!confirm('El enlace actual deja de servir de inmediato. Quien lo tenga guardado ya no va a poder entrar. ¿Seguro?')) return;
    startRotar(async () => {
      const r = await rotarEnlaceDeSolicitud();
      if (r.ok) {
        setActual(r.data);
        setErrorRotar(null);
      } else {
        setErrorRotar(r.error);
      }
    });
  }

  if (error || !actual) {
    return (
      <div className="mb-6 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
        <p className="text-sm font-semibold text-[#1A1A1A]">Enlace para que se registren</p>
        <p className="text-xs text-[#6B7280] mt-1">
          No se pudo traer el enlace en este momento. {error ?? ''}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-[#E5E7EB] p-4">
      <div className="flex items-start gap-2 mb-2">
        <Link2 className="w-4 h-4 text-[#6B7280] mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1A1A1A]">Enlace para que se registren</p>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Compártelo con tus proveedores. Ellos dejan sus datos básicos y les llega por correo su
            enlace personal para subir documentos y firmar. Los documentos nunca se suben por acá.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md bg-[#F3F4F6] px-3 py-2 text-xs text-[#1A1A1A]">
          {actual.url}
        </code>
        <button
          type="button"
          onClick={() => copiar('url')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-2 text-xs font-semibold text-[#1A1A1A] hover:bg-[#F9FAFB] transition"
        >
          {copiado === 'url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copiado === 'url' ? 'Copiado' : 'Copiar enlace'}
        </button>
        <button
          type="button"
          onClick={() => copiar('mensaje')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-2 text-xs font-semibold text-[#1A1A1A] hover:bg-[#F9FAFB] transition"
        >
          {copiado === 'mensaje' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copiado === 'mensaje' ? 'Copiado' : 'Copiar mensaje'}
        </button>
      </div>

      {puedeRotar && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={rotar}
            disabled={rotando}
            className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#1A1A1A] transition disabled:opacity-50"
          >
            {rotando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Cambiar el enlace
          </button>
          <span className="text-[11px] text-[#9CA3AF]">
            Úsalo si el enlace se filtró. El anterior deja de servir.
          </span>
        </div>
      )}
      {errorRotar && <p className="mt-2 text-xs text-[#B91C1C]">{errorRotar}</p>}
    </div>
  );
}

export default function VinculacionClient({
  inicial,
  error: errorInicial,
  enlace: enlaceInicial,
  errorEnlace,
  puedeRotar,
  empresa,
}: {
  inicial: BandejaVinculacion | null;
  error: string | null;
  enlace: EnlaceSolicitud | null;
  errorEnlace: string | null;
  puedeRotar: boolean;
  empresa: string;
}) {
  const [bandeja, setBandeja] = useState(inicial);
  const [error, setError] = useState<string | null>(errorInicial);
  const [pending, startTransition] = useTransition();
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<EstadoExpediente | null>(null);

  function recargar() {
    startTransition(async () => {
      const r = await listarVinculaciones();
      if (r.ok) {
        setBandeja(r.data);
        setError(null);
      } else {
        setError(r.error);
      }
    });
  }

  const visibles = useMemo(() => {
    const filas = bandeja?.expedientes ?? [];
    const q = busqueda.trim().toLowerCase();
    return filas.filter((f) => {
      if (filtro && f.estado !== filtro) return false;
      if (!q) return true;
      const nombre = nombreContraparte(f).toLowerCase();
      const doc = (f.documento_numero ?? '').toLowerCase();
      const mail = (f.email_contraparte ?? '').toLowerCase();
      return nombre.includes(q) || doc.includes(q) || mail.includes(q);
    });
  }, [bandeja, busqueda, filtro]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-xl font-bold text-[#1A1A1A]">Vinculación de contrapartes</h1>
        {pending && <Loader2 className="w-4 h-4 animate-spin text-[#6B7280] mt-1" />}
      </div>
      <p className="text-sm text-[#6B7280] mb-6">
        La contraparte sube sus documentos por un enlace propio y el sistema los lee. Acá revisas lo
        que quedó y decides si la vinculas.
      </p>

      <TarjetaEnlace
        enlace={enlaceInicial}
        error={errorEnlace}
        puedeRotar={puedeRotar}
        empresa={empresa}
      />

      {error && (
        <div className="mb-5 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#B91C1C] mt-0.5 shrink-0" />
            <div className="text-sm text-[#B91C1C]">
              <p className="font-semibold">No se pudo cargar la bandeja.</p>
              <p className="mt-1">{error}</p>
              <button
                type="button"
                onClick={recargar}
                className="mt-2 text-xs font-semibold underline underline-offset-2"
              >
                Reintentar
              </button>
            </div>
          </div>
        </div>
      )}

      {bandeja && (
        <>
          <div className="flex flex-wrap gap-2 mb-5">
            {ESTADOS_EXPEDIENTE.filter((e) => bandeja.resumen[e] > 0).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setFiltro(filtro === e ? null : e)}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${CHIP[e]} ${
                  filtro === e ? 'ring-2 ring-offset-1 ring-[#1A1A1A]/20' : ''
                }`}
              >
                {ESTADO_EXPEDIENTE_LABEL[e]} · {bandeja.resumen[e]}
              </button>
            ))}
          </div>

          <div className="relative mb-4">
            <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={busqueda}
              onChange={(ev) => setBusqueda(ev.target.value)}
              placeholder="Buscar por nombre, documento o correo"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#E5E7EB] text-sm"
            />
          </div>

          {bandeja.expedientes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#E5E7EB] p-8 text-center">
              <FolderOpen className="w-6 h-6 text-[#9CA3AF] mx-auto mb-2" />
              <p className="text-sm font-semibold text-[#1A1A1A]">Todavía no hay vinculaciones.</p>
              <p className="text-xs text-[#6B7280] mt-1">
                Cuando invites a una contraparte, su expediente aparece acá y va cambiando de estado
                a medida que ella avanza.
              </p>
            </div>
          ) : visibles.length === 0 ? (
            <p className="text-sm text-[#6B7280] py-6">Nada coincide con ese filtro.</p>
          ) : (
            <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
              {visibles.map((f, i) => (
                <Link
                  key={f.expediente_id}
                  href={`/compliance/vinculacion/${f.expediente_id}`}
                  className={`flex items-center gap-4 px-4 py-3 hover:bg-[#F9FAFB] transition ${
                    i > 0 ? 'border-t border-[#F3F4F6]' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#1A1A1A] truncate">
                      {nombreContraparte(f)}
                    </p>
                    <p className="text-xs text-[#6B7280] truncate">
                      {f.documento_tipo && f.documento_numero
                        ? `${f.documento_tipo} ${f.documento_numero} · `
                        : ''}
                      {ETAPA_LABEL[f.etapa_actual] ?? f.etapa_actual}
                      {f.fecha_invitacion ? ` · invitada el ${fecha(f.fecha_invitacion)}` : ''}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold shrink-0 ${CHIP[f.estado]}`}
                    title={ESTADO_EXPEDIENTE_ACCION[f.estado]}
                  >
                    {ESTADO_EXPEDIENTE_LABEL[f.estado] ?? f.estado}
                  </span>
                  <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
