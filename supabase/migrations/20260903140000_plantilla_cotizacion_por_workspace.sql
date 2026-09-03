-- ============================================================
-- La plantilla de cotización de un workspace puede vivir DENTRO de la aplicación
-- ============================================================
--
-- QUÉ CAMBIA
-- Nada del esquema: solo el COMENTARIO de `workspaces.cotizacion_template_slug`.
-- No toca datos, no crea objetos, no concede privilegios. Es idempotente.
--
-- POR QUÉ
-- Esa columna nació (migración 20260515000001) apuntando exclusivamente a las
-- plantillas HTML del servicio externo `metrik-pdf-render` (WeasyPrint, Cloud Run):
-- su comentario dice «Debe existir en metrik-pdf-render/templates/{slug}/cotizacion.html».
--
-- Desde este PR un slug también puede resolverse ADENTRO, con @react-pdf, sin depender
-- de que el servicio externo esté configurado ni desplegado. El registro está en
-- `src/lib/pdf/plantillas-cotizacion.ts` y es el que decide qué motor atiende cada slug.
--
-- Se amplía ESTA columna en vez de abrir una segunda porque las dos responderían la
-- misma pregunta («qué formato tiene la cotización de este cliente»), y dos fuentes
-- para una sola pregunta se desincronizan con un síntoma mudo: el PDF sale con el
-- formato de otro workspace y nadie ve un error.
--
-- QUÉ NO CAMBIA
-- El default sigue siendo 'metrik'. Los 17 workspaces de producción (medido el
-- 2026-09-03) están en 'metrik' salvo `wmc-sm`, que está en 'wmc' y sigue yendo al
-- servicio externo exactamente igual que antes.
-- ============================================================

comment on column workspaces.cotizacion_template_slug is
  'Plantilla visual de la cotización de este workspace. El registro de '
  '`src/lib/pdf/plantillas-cotizacion.ts` decide qué motor la atiende: si el slug está '
  'ahí se renderiza dentro de la app con @react-pdf; si no, y el slug no es "metrik", '
  'se pide al servicio metrik-pdf-render, donde debe existir '
  'templates/{slug}/cotizacion.html. Default "metrik" = plantilla genérica.';
