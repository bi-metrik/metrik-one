'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, ChevronRight, Copy, FolderOpen, Link2, Loader2, RefreshCw, Search, UserPlus, X } from 'lucide-react';
import {
  invitarContraparte,
  listarVinculaciones,
  rotarEnlaceDeSolicitud,
  type BandejaVinculacion,
  type EnlaceSolicitud,
} from '@/lib/actions/compliance-vinculacion';
import {
  DOCUMENTOS_POR_SUJETO,
  ETIQUETA_DOCUMENTO,
  ETIQUETA_SUJETO,
  documentoPorDefecto,
  mensajeParaCompartir,
  type TipoSujeto,
} from '@/lib/compliance/solicitud-vinculacion';
import {
  DATOS_INVITACION_VACIOS,
  faltaEnInvitacion,
  puedeInvitar as datosCompletos,
  resumirInvitacion,
  type DatosInvitacion,
  type DesenlaceInvitacion,
} from '@/lib/compliance/invitacion-vinculacion';
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
  pendiente_revision: 'bg-advertencia/10 text-[#B45309] border-advertencia/30',
  aprobado: 'bg-[var(--acento-tinte)] text-acento border-acento/30',
  rechazado: 'bg-alerta/10 text-[#B91C1C] border-alerta/30',
  devuelto: 'bg-advertencia/10 text-[#B45309] border-advertencia/30',
  vencido: 'bg-alerta/10 text-[#B91C1C] border-alerta/30',
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
  puedeGestionar,
  empresa,
}: {
  enlace: EnlaceSolicitud | null;
  error: string | null;
  puedeGestionar: boolean;
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
        <p className="text-sm font-semibold text-tinta">Enlace para que se registren</p>
        <p className="text-xs text-tinta-suave mt-1">
          No se pudo traer el enlace en este momento. {error ?? ''}
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-lg border border-[#E5E7EB] p-4">
      <div className="flex items-start gap-2 mb-2">
        <Link2 className="w-4 h-4 text-tinta-suave mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-tinta">Enlace para que se registren</p>
          <p className="text-xs text-tinta-suave mt-0.5">
            Compártelo con tus proveedores. Ellos dejan sus datos básicos y les llega por correo su
            enlace personal para subir documentos y firmar. Los documentos nunca se suben por acá.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md bg-[#F3F4F6] px-3 py-2 text-xs text-tinta">
          {actual.url}
        </code>
        <button
          type="button"
          onClick={() => copiar('url')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-2 text-xs font-semibold text-tinta hover:bg-[#F9FAFB] transition"
        >
          {copiado === 'url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copiado === 'url' ? 'Copiado' : 'Copiar enlace'}
        </button>
        <button
          type="button"
          onClick={() => copiar('mensaje')}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-3 py-2 text-xs font-semibold text-tinta hover:bg-[#F9FAFB] transition"
        >
          {copiado === 'mensaje' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copiado === 'mensaje' ? 'Copiado' : 'Copiar mensaje'}
        </button>
      </div>

      {puedeGestionar && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={rotar}
            disabled={rotando}
            className="inline-flex items-center gap-1.5 text-xs text-tinta-suave hover:text-tinta transition disabled:opacity-50"
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

/**
 * Invitar a una contraparte: el oficial abre el expediente de alguien que él
 * eligió, sin esperar a que se presente por el mostrador.
 *
 * Convive con el enlace público a propósito, porque son dos momentos distintos:
 * el enlace sirve para el proveedor que llega solo; esto sirve para el que la
 * empresa ya decidió contratar y todavía no ha hecho nada. Sin esta vía, abrir
 * un expediente solo se podía por fuera de la plataforma, que es lo contrario
 * de que una auditoría lo encuentre todo adentro.
 *
 * El aviso de tratamiento NO se marca acá. Lo escribe el oficial, no la
 * contraparte: una casilla firmada por quien no estuvo presente no es una
 * autorización. La autorización completa se pide dentro del enlace personal.
 */
function PanelInvitar({ onListo }: { onListo: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<DatosInvitacion>(DATOS_INVITACION_VACIOS);
  const [enviando, startEnviar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [desenlace, setDesenlace] = useState<{ resumen: DesenlaceInvitacion; url: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [tocado, setTocado] = useState(false);

  const falta = faltaEnInvitacion(datos);

  function cambiarSujeto(tipo: TipoSujeto) {
    // Pasar de empresa a persona deja el tipo de documento en uno imposible.
    setDatos({ ...datos, tipoSujeto: tipo, tipoDocumento: documentoPorDefecto(tipo) });
  }

  function cerrar() {
    setAbierto(false);
    setDatos(DATOS_INVITACION_VACIOS);
    setDesenlace(null);
    setError(null);
    setTocado(false);
  }

  function enviar() {
    setTocado(true);
    if (!datosCompletos(datos)) return;
    setError(null);
    startEnviar(async () => {
      const r = await invitarContraparte(datos);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDesenlace({ resumen: resumirInvitacion(r.data, datos.correo), url: r.data.url });
      setDatos(DATOS_INVITACION_VACIOS);
      setTocado(false);
      // La bandeja tiene que mostrar el expediente nuevo sin que el oficial
      // tenga que adivinar que hay que recargar.
      onListo();
    });
  }

  async function copiarEnlace(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError('No se pudo copiar. Selecciona el enlace y cópialo a mano.');
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mb-5 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-tinta text-white text-sm font-semibold hover:bg-[#333] transition"
      >
        <UserPlus className="w-4 h-4" />
        Invitar contraparte
      </button>
    );
  }

  const marcar = (campo: string) =>
    tocado && falta.includes(campo) ? 'border-alerta' : 'border-[#E5E7EB]';

  return (
    <div className="mb-5 rounded-lg border border-[#E5E7EB] p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="text-sm font-semibold text-tinta">Invitar a una contraparte</p>
          <p className="text-xs text-tinta-suave mt-0.5">
            Le llega a su correo un enlace personal para subir documentos y firmar. El correo lo
            eliges tú: es lo que después hace que el código de firma llegue a un canal que ya
            conocías.
          </p>
        </div>
        <button type="button" onClick={cerrar} className="text-[#9CA3AF] hover:text-tinta transition">
          <X className="w-4 h-4" />
        </button>
      </div>

      {desenlace ? (
        <div
          className={`rounded-lg border p-3 ${
            desenlace.resumen.tono === 'ok'
              ? 'border-acento/30 bg-[var(--acento-tinte)]'
              : 'border-advertencia/30 bg-advertencia/5'
          }`}
        >
          <p className="text-sm font-semibold text-tinta">{desenlace.resumen.titulo}</p>
          <p className="text-xs text-[#4B5563] mt-1">{desenlace.resumen.detalle}</p>
          {desenlace.resumen.ofreceEnlace && (
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate text-[11px] text-[#4B5563] bg-white border border-[#E5E7EB] rounded px-2 py-1.5">
                {desenlace.url}
              </code>
              <button
                type="button"
                onClick={() => copiarEnlace(desenlace.url)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#E5E7EB] bg-white text-xs font-semibold hover:bg-[#F9FAFB] transition shrink-0"
              >
                {copiado ? <Check className="w-3.5 h-3.5 text-acento" /> : <Copy className="w-3.5 h-3.5" />}
                {copiado ? 'Copiado' : 'Copiar enlace'}
              </button>
            </div>
          )}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => setDesenlace(null)}
              className="text-xs font-semibold underline underline-offset-2 text-tinta"
            >
              Invitar a otra
            </button>
            <button type="button" onClick={cerrar} className="text-xs text-tinta-suave">
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            {(Object.keys(ETIQUETA_SUJETO) as TipoSujeto[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => cambiarSujeto(t)}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${
                  datos.tipoSujeto === t
                    ? 'bg-tinta text-white border-tinta'
                    : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                }`}
              >
                {ETIQUETA_SUJETO[t]}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#4B5563] mb-1">
                {datos.tipoSujeto === 'juridica' ? 'Razón social' : 'Nombre completo'}
              </label>
              <input
                value={datos.denominacion}
                onChange={(ev) => setDatos({ ...datos, denominacion: ev.target.value })}
                className={`w-full px-3 py-2 rounded-lg border text-sm ${marcar(
                  datos.tipoSujeto === 'juridica' ? 'razon_social' : 'nombre',
                )}`}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4B5563] mb-1">Documento</label>
              <div className="flex gap-2">
                <select
                  value={datos.tipoDocumento}
                  onChange={(ev) =>
                    setDatos({ ...datos, tipoDocumento: ev.target.value as DatosInvitacion['tipoDocumento'] })
                  }
                  className="px-2 py-2 rounded-lg border border-[#E5E7EB] text-sm bg-white"
                >
                  {DOCUMENTOS_POR_SUJETO[datos.tipoSujeto].map((d) => (
                    <option key={d} value={d}>
                      {ETIQUETA_DOCUMENTO[d]}
                    </option>
                  ))}
                </select>
                <input
                  value={datos.documento}
                  onChange={(ev) => setDatos({ ...datos, documento: ev.target.value })}
                  className={`min-w-0 flex-1 px-3 py-2 rounded-lg border text-sm ${marcar('documento')}`}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4B5563] mb-1">
                Correo de la contraparte
              </label>
              <input
                value={datos.correo}
                onChange={(ev) => setDatos({ ...datos, correo: ev.target.value })}
                inputMode="email"
                className={`w-full px-3 py-2 rounded-lg border text-sm ${marcar('correo')}`}
              />
            </div>
          </div>

          {tocado && falta.length > 0 && (
            <p className="mt-2 text-xs text-[#B91C1C]">
              Falta completar lo que quedó en rojo.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-[#B91C1C]">{error}</p>}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={enviar}
              disabled={enviando}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-tinta text-white text-sm font-semibold hover:bg-[#333] transition disabled:opacity-50"
            >
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Enviar invitación
            </button>
            <button type="button" onClick={cerrar} className="text-xs text-tinta-suave">
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function VinculacionClient({
  inicial,
  error: errorInicial,
  enlace: enlaceInicial,
  errorEnlace,
  puedeGestionar,
  empresa,
}: {
  inicial: BandejaVinculacion | null;
  error: string | null;
  enlace: EnlaceSolicitud | null;
  errorEnlace: string | null;
  puedeGestionar: boolean;
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
        <h1 className="text-xl font-bold text-tinta">Vinculación de contrapartes</h1>
        {pending && <Loader2 className="w-4 h-4 animate-spin text-tinta-suave mt-1" />}
      </div>
      <p className="text-sm text-tinta-suave mb-6">
        La contraparte sube sus documentos por un enlace propio y el sistema los lee. Acá revisas lo
        que quedó y decides si la vinculas.
      </p>

      {puedeGestionar && <PanelInvitar onListo={recargar} />}

      <TarjetaEnlace
        enlace={enlaceInicial}
        error={errorEnlace}
        puedeGestionar={puedeGestionar}
        empresa={empresa}
      />

      {error && (
        <div className="mb-5 rounded-lg border border-alerta/30 bg-alerta/5 p-4">
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
                  filtro === e ? 'ring-2 ring-offset-1 ring-tinta/20' : ''
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
              <p className="text-sm font-semibold text-tinta">Todavía no hay vinculaciones.</p>
              <p className="text-xs text-tinta-suave mt-1">
                Cuando invites a una contraparte, su expediente aparece acá y va cambiando de estado
                a medida que ella avanza.
              </p>
            </div>
          ) : visibles.length === 0 ? (
            <p className="text-sm text-tinta-suave py-6">Nada coincide con ese filtro.</p>
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
                    <p className="text-sm font-semibold text-tinta truncate">
                      {nombreContraparte(f)}
                    </p>
                    <p className="text-xs text-tinta-suave truncate">
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
