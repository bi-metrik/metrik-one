---
name: project-paso-a-persona
description: Paso a una persona §4.2 (comun.persona, rol.escalamiento, botón cta_url a wa.me de MeTRIK, fila asistente_escalamientos); PR apilado sobre #1285, sin deploy; decisiones no obvias
metadata:
  type: project
---

Rama `feat/asistentes-persona`, apilada sobre el componedor (#1285), sin migración (la tabla `asistente_escalamientos` ya
está en prod por #1282). Sin desplegar: `wa-webhook` (vía `_shared/wa-agente.ts`) y `chatwoot-agente`.

**Lo que no se ve en el código a primera vista:**
- En WhatsApp `comun.persona` es un MOTOR aparte (`persona`, `agente/persona.ts`, `dominioPersona`) compuesto junto al
  `one`. Copia del motor ONE `bot`, `reenvios`, `propuestaVenceConRespuesta` y `ventanaAdjuntosMs`: sin eso, un cargo
  desconocido (que solo tiene la común) dejaba al motor persona de principal y los reenvíos pasaban a `tanda`.
- Al desplegar `wa-webhook`, TODO workspace con el modo agente ONE ve `pasar_a_persona` y su botón abre el WhatsApp de
  Mauricio (573159509103) con el mensaje ya escrito. Es cambio de comportamiento en todos, no solo con roles.
- La fila de `asistente_escalamientos` en ONE se escribe DENTRO de `enviarYCerrar` (lee `traza.escalamiento`), no en
  `unTurno`: así no choca con la línea de `despuesDelTurno` que tocó #1286.
- En Chatwoot las señales del código (dos «no pude», tres correcciones) solo corren con rol; sin rol, Sabor es igual
  byte a byte (comprobado: volcado del arnés seco de 87 casos en la base y en la rama, `git checkout <base> -- supabase/functions`, volcar, `git checkout HEAD -- supabase/functions`).
- La nota de Chatwoot = `notaComun` (cabecera) + bloques del gancho `Funcion.notaPersona`; si ninguna función del rol lo
  declara, va `bloqueNotaPublico` (lo de Sabor). La sesión de Sabor lo mueve al partir `publico/dominio.ts`.
- Botón > 20 caracteres en la ficha NO se corta (quedaba «Escribir a la»): va «Abrir WhatsApp».
- Doc de Meta leída el 26-oct: `cta_url`, cuerpo ≤ 1024, botón ≤ 20, «cualquier URL» al navegador. Que `wa.me?text=`
  precargue el texto dentro del cta_url NO se probó con un envío real.
- La bandeja de Trappvel NO tiene el botón (no está compuesta; sería un merge a mano de cierres): queda como siguiente paso.

**Why:** Sabor sale el 29-oct con persona en Chatwoot como respaldo; en ONE Mauricio pidió el botón directo a su WhatsApp.
**How to apply:** antes de desplegar `wa-webhook`, avisar que el botón llega a todos; para Imperviun/Laura, la ficha
`rol.escalamiento` con `atiende: "la oficina"` y su número (nunca un nombre). Ver [[project-spec-asistentes-roles]] y
[[project-correo-caida-modelos]].
