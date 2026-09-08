'use client';

import { useState, useTransition } from 'react';
import { Check, ChevronDown, Loader2, Send } from 'lucide-react';
import {
  enviarSolicitud,
  traducirErrorSolicitud,
  type MarcaInvitante,
} from '@/lib/actions/vinculacion-publica';
import {
  CASILLA_AVISO,
  DATOS_VACIOS,
  DOCUMENTOS_POR_SUJETO,
  ETIQUETA_DOCUMENTO,
  ETIQUETA_SUJETO,
  MENSAJE_SOLICITUD_ENVIADA,
  documentoPorDefecto,
  faltaEnSolicitud,
  puedeEnviarSolicitud,
  textoAvisoSolicitud,
  type DatosSolicitud,
  type TipoSujeto,
} from '@/lib/compliance/solicitud-vinculacion';

const CAMPO = 'w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm';

export default function SolicitudClient({
  token,
  marca,
}: {
  token: string;
  marca: MarcaInvitante;
}) {
  const [datos, setDatos] = useState<DatosSolicitud>(DATOS_VACIOS);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Los faltantes solo se pintan después del primer intento. Marcar en rojo un
  // formulario que la persona todavía no ha tocado es regañarla por no haber
  // empezado.
  const [intento, setIntento] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [pending, startTransition] = useTransition();

  const acento = marca.colorPrimario ?? '#1A1A1A';
  const falta = faltaEnSolicitud(datos);
  const avisos = textoAvisoSolicitud(marca.nombre);

  function set<K extends keyof DatosSolicitud>(k: K, v: DatosSolicitud[K]) {
    setDatos((d) => ({ ...d, [k]: v }));
  }

  /** Cambiar de empresa a persona dejaría el tipo de documento en uno imposible. */
  function cambiarSujeto(tipo: TipoSujeto) {
    setDatos((d) => ({ ...d, tipoSujeto: tipo, tipoDocumento: documentoPorDefecto(tipo) }));
  }

  function enviar() {
    setIntento(true);
    if (!puedeEnviarSolicitud(datos)) return;
    startTransition(async () => {
      setError(null);
      const r = await enviarSolicitud(token, datos);
      if (r.ok) {
        setEnviado(true);
        return;
      }
      setError(await traducirErrorSolicitud(r.error));
    });
  }

  const malo = (campo: string) => intento && falta.includes(campo);

  return (
    <main className="min-h-screen">
      {/* ── Quién te está pidiendo esto ── */}
      <header className="border-b border-[#E5E7EB] bg-white">
        <div className="max-w-xl mx-auto px-6 py-5 flex items-center gap-4">
          {marca.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- dinámico desde Supabase storage, tamaño variable
            <img
              src={marca.logoUrl}
              alt={marca.nombre}
              className="h-12 w-auto max-w-[200px] object-contain"
              // Un logo roto en la página que ve un desconocido se lee peor que
              // no tener logo: se esconde y queda el nombre solo.
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div
              className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold"
              style={{ background: acento }}
            >
              {marca.nombre.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#1A1A1A] truncate">{marca.nombre}</p>
            <p className="text-xs text-[#6B7280]">
              {[marca.nit ? `NIT ${marca.nit}` : null, marca.ciudad].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-6 py-8">
        {enviado ? (
          <div className="rounded-lg border border-[#10B981]/30 bg-[#ECFDF5] p-5">
            <div className="flex items-start gap-2">
              <Check className="w-5 h-5 text-[#059669] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-bold text-[#065F46]">Solicitud enviada</p>
                <p className="text-sm text-[#047857] mt-1">{MENSAJE_SOLICITUD_ENVIADA}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold text-[#1A1A1A]">
              Regístrate como contraparte de {marca.nombre}
            </h1>
            <p className="text-sm text-[#6B7280] mt-1.5">
              Déjanos tus datos básicos y te llega a tu correo un enlace personal para subir los
              documentos y firmar. Acá no subes nada todavía.
            </p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1A1A1A] mb-1.5">
                  ¿Quién se va a vincular?
                </label>
                <div className="flex gap-2">
                  {(['juridica', 'natural'] as TipoSujeto[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => cambiarSujeto(t)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                        datos.tipoSujeto === t
                          ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white'
                          : 'border-[#E5E7EB] text-[#1A1A1A] hover:bg-[#F9FAFB]'
                      }`}
                    >
                      {ETIQUETA_SUJETO[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1A1A] mb-1.5">
                  {datos.tipoSujeto === 'juridica' ? 'Razón social' : 'Nombre completo'}
                </label>
                <input
                  value={datos.denominacion}
                  onChange={(e) => set('denominacion', e.target.value)}
                  placeholder={
                    datos.tipoSujeto === 'juridica' ? 'Como aparece en el RUT' : 'Como aparece en tu documento'
                  }
                  className={`${CAMPO} ${malo('razon_social') || malo('nombre') ? 'border-[#EF4444]' : ''}`}
                />
              </div>

              <div className="flex gap-2">
                <div className="w-40">
                  <label className="block text-xs font-semibold text-[#1A1A1A] mb-1.5">
                    Documento
                  </label>
                  <select
                    value={datos.tipoDocumento}
                    onChange={(e) =>
                      set('tipoDocumento', e.target.value as DatosSolicitud['tipoDocumento'])
                    }
                    className={CAMPO}
                  >
                    {DOCUMENTOS_POR_SUJETO[datos.tipoSujeto].map((d) => (
                      <option key={d} value={d}>
                        {ETIQUETA_DOCUMENTO[d]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-[#1A1A1A] mb-1.5">Número</label>
                  <input
                    value={datos.documento}
                    onChange={(e) => set('documento', e.target.value)}
                    inputMode="numeric"
                    placeholder="Sin puntos ni guiones"
                    className={`${CAMPO} ${malo('documento') ? 'border-[#EF4444]' : ''}`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1A1A] mb-1.5">
                  Correo electrónico
                </label>
                <input
                  value={datos.correo}
                  onChange={(e) => set('correo', e.target.value)}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="A este correo llega tu enlace"
                  className={`${CAMPO} ${malo('correo') ? 'border-[#EF4444]' : ''}`}
                />
                <p className="text-xs text-[#6B7280] mt-1">
                  Escríbelo bien: el enlace y el código para firmar van a llegar ahí, y no se puede
                  cambiar después sin volver a empezar.
                </p>
              </div>

              {/* ── El aviso, antes de recoger nada ── */}
              <div
                className={`rounded-lg border p-3 ${
                  malo('aviso') ? 'border-[#EF4444]' : 'border-[#E5E7EB]'
                }`}
              >
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={datos.acepta}
                    onChange={(e) => set('acepta', e.target.checked)}
                    className="mt-0.5 w-4 h-4 shrink-0"
                  />
                  <span className="text-sm text-[#1A1A1A]">{CASILLA_AVISO}</span>
                </label>
                <button
                  type="button"
                  onClick={() => setAbierto((a) => !a)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#6B7280] hover:text-[#1A1A1A]"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition ${abierto ? 'rotate-180' : ''}`}
                  />
                  {abierto ? 'Ocultar' : 'Leer para qué se usan'}
                </button>
                {abierto && (
                  <div className="mt-2 space-y-2 border-t border-[#F3F4F6] pt-2">
                    {avisos.map((p, i) => (
                      <p key={i} className="text-xs text-[#6B7280] leading-relaxed">
                        {p}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <p className="text-sm text-[#B91C1C] rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/5 p-3">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={enviar}
                disabled={pending}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
                style={{ background: acento }}
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Enviarme mi enlace
              </button>
            </div>
          </>
        )}

        <p className="mt-8 pt-4 border-t border-[#F3F4F6] text-xs text-[#9CA3AF]">
          {marca.razonSocial ?? marca.nombre}
          {marca.nit ? ` · NIT ${marca.nit}` : ''}
          {marca.correo ? ` · ${marca.correo}` : ''}
        </p>
      </div>
    </main>
  );
}
