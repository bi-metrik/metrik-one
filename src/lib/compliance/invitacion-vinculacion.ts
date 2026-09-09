/**
 * Invitar a una contraparte: el oficial abre el expediente de alguien que él
 * eligió, sin esperar a que se presente por el mostrador.
 *
 * ── Por qué no reusa `solicitud-vinculacion.ts` tal cual ──────────────────
 *
 * Los campos son casi los mismos, pero una regla cambia y esa regla importa:
 * el mostrador exige la casilla del aviso de tratamiento, porque ahí es la
 * propia persona la que está escribiendo sus datos. Acá los escribe el oficial.
 * Pedirle a él que marque "entiendo para qué se usan estos datos" en nombre de
 * un tercero produciría una declaración de una persona que no estuvo presente,
 * o sea evidencia fabricada. La autorización completa se sigue pidiendo dentro
 * del enlace personal, que es donde la contraparte sí está.
 *
 * Lo que sí se reusa son las reglas de forma (documento, correo, qué documento
 * aplica a qué sujeto): esas no cambian según quién escriba.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo exportan funciones
 * async, y porque estas reglas tienen que poder probarse sin red.
 */

import {
  correoValido,
  documentoPorDefecto,
  normalizarDocumento,
  LARGO_MIN_DENOMINACION,
  LARGO_MIN_DOCUMENTO,
  type TipoDocumento,
  type TipoSujeto,
} from './solicitud-vinculacion';

export type DatosInvitacion = {
  tipoSujeto: TipoSujeto;
  denominacion: string;
  tipoDocumento: TipoDocumento;
  documento: string;
  correo: string;
};

export const DATOS_INVITACION_VACIOS: DatosInvitacion = {
  tipoSujeto: 'juridica',
  denominacion: '',
  tipoDocumento: documentoPorDefecto('juridica'),
  documento: '',
  correo: '',
};

/** Devuelve qué falta, no un booleano: la pantalla tiene que señalar el campo. */
export function faltaEnInvitacion(datos: DatosInvitacion): string[] {
  const falta: string[] = [];
  if (datos.denominacion.trim().length < LARGO_MIN_DENOMINACION) {
    falta.push(datos.tipoSujeto === 'juridica' ? 'razon_social' : 'nombre');
  }
  if (normalizarDocumento(datos.documento).length < LARGO_MIN_DOCUMENTO) falta.push('documento');
  if (!correoValido(datos.correo)) falta.push('correo');
  return falta;
}

export function puedeInvitar(datos: DatosInvitacion): boolean {
  return faltaEnInvitacion(datos).length === 0;
}

// ─── Lo que pasó ──────────────────────────────────────────────────────────

export type ResultadoInvitacion = {
  /** `creado` abrió expediente nuevo; `reenviado` es uno que ya estaba abierto. */
  resultado: 'creado' | 'reenviado';
  expedienteId: string;
  /** El enlace personal de la contraparte. Se muestra para poder copiarlo. */
  url: string;
  /** Solo en `reenviado`: el enlace salió al correo del expediente, no al escrito. */
  correoDistinto: boolean;
  /** `false` cuando el expediente sí quedó abierto pero el correo no salió. */
  correoSalio: boolean;
};

export type DesenlaceInvitacion = {
  /** `ok` no pide nada; `alerta` pide que el oficial haga algo más. */
  tono: 'ok' | 'alerta';
  titulo: string;
  detalle: string;
  /** Si el oficial tiene que mandar el enlace él mismo, la pantalla lo muestra. */
  ofreceEnlace: boolean;
};

/**
 * Un solo lugar decide qué se le dice al oficial, y la regla es que nunca se
 * quede creyendo que el correo salió cuando no salió: un expediente abierto
 * cuyo enlace nadie recibió se queda en "invitado" para siempre y a los tres
 * meses nadie sabe por qué.
 */
export function resumirInvitacion(r: ResultadoInvitacion, correoEscrito: string): DesenlaceInvitacion {
  const correo = correoEscrito.trim();

  if (!r.correoSalio) {
    return {
      tono: 'alerta',
      titulo: 'El expediente quedó abierto, pero el correo no salió.',
      detalle:
        'No pudimos entregar el enlace. No vuelvas a invitar: el expediente ya existe. Copia el enlace de acá abajo y mándaselo tú por el canal que uses con esa contraparte.',
      ofreceEnlace: true,
    };
  }

  if (r.resultado === 'reenviado') {
    if (r.correoDistinto) {
      return {
        tono: 'alerta',
        titulo: 'Ya había un expediente abierto, y su correo es otro.',
        detalle:
          `No se creó un expediente nuevo. El enlace salió al correo que ya estaba registrado, no a ${correo}: cambiar el destino desde acá dejaría que cualquiera con el documento de un proveedor se lleve su expediente a otra dirección. Si el contacto de verdad cambió, copia el enlace y mándaselo tú.`,
        ofreceEnlace: true,
      };
    }
    return {
      tono: 'alerta',
      titulo: 'Esa contraparte ya tenía un expediente abierto.',
      detalle:
        'No se creó otro: dos expedientes del mismo documento parten el rastro en dos. Le reenviamos el enlace al mismo correo.',
      ofreceEnlace: false,
    };
  }

  return {
    tono: 'ok',
    titulo: 'Listo. La contraparte ya tiene su enlace.',
    detalle: `Le enviamos a ${correo} el enlace personal para subir documentos y firmar. El expediente aparece en la bandeja como invitado y va cambiando de estado a medida que ella avanza.`,
    ofreceEnlace: false,
  };
}
