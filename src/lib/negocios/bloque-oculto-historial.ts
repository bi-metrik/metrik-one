/**
 * ¿Este bloque sale también del «Historial de etapas anteriores»?
 *
 * Retirar una pregunta de un proceso tiene dos caras y hasta hoy solo había una:
 * `config_extra.visible = false` la saca de la etapa donde vive, pero el historial pinta
 * todo bloque con instancia, así que la pregunta seguía a la vista en cuanto el caso
 * avanzaba. En SOENA, `numero_solicitantes` se retiró el 29-jul y siguió visible en el
 * historial: el 21-sep, en Anexos, una persona experta leyó un caso de copropiedad como
 * de un solo titular porque ahí decía «1». Dos respuestas para el mismo hecho, y la vieja
 * contradecía a la vigente en 28 casos abiertos.
 *
 * `oculto_en_historial: true` (opt-in por bloque) la saca también de ahí. El dato NO se
 * borra ni se toca: queda en `negocio_bloques.data` para quien lo necesite auditar. No se
 * usa `visible: false` para esto porque ese flag ya lo llevan bloques que SÍ deben verse
 * en el historial (el tipo de solicitante, que se corrige desde ahí), ni `desactivado`,
 * porque el historial muestra hoy documentos generados por bloques desactivados.
 */
export function bloqueOcultoEnHistorial(configExtra: Record<string, unknown> | null | undefined): boolean {
  return configExtra?.oculto_en_historial === true
}
