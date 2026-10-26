---
name: freno-titulares-antes-de-radicar
description: PR del 2026-10-01 SIN mergear — cruce `requeridos` (el dato que FALTA es la contradicción) + SOENA frena copropiedad sin RUT 2 y factura≠titularidad en 6 y 7; migración 20261001100000 SIN aplicar
metadata:
  type: project
---

Cruce de línea nuevo tipo `requeridos` (`src/lib/negocios/cruces.ts`): con `condition`
cumplida, los campos listados TIENEN que estar. Es la única excepción a «un lado ausente no
es contradicción». Sin `condition` se descarta (exigiría el dato a toda la línea). Un campo
cuyo bloque no le aplica al caso calla; una fila vacía o inexistente del bloque SÍ falta.

**Why:** 24 copropiedades abiertas con certificado UPME a una persona. En los 24 la
titularidad decía «único» al radicar y se corrigió DESPUÉS del certificado (19-ago a 30-sep):
21 radicados fuera de ONE (migrados), 3 desde ONE (V0076, V0298, V0465). El titular se pierde
en la TITULARIDAD, no al cargar en la UPME. ONE no tiene evidencia de lo radicado con personas
(solo número + pantallazo del panel).

**How to apply:**
- ⚠️ La radicación ocurre DENTRO de Cargue (7); frenar solo a la salida de 7 llega tarde.
  Por eso el freno va en [6, 7]: salir de Documentación (antes de radicar) y de Cargue (antes
  de pagar la tarifa).
- ⚠️ `numero_solicitantes` (Validación) NO sirve de señal: los migrados traen «2» con factura
  de 1 comprador y certificado de 1 (V0142, V0173, …). Se descartó cruzarlo.
- Migración `20261001100000_soena_freno_titular_2_antes_de_radicar.sql` sin aplicar; (2)
  extiende `factura_compradores_vs_titularidad` y `rut2_entre_compradores` a [6, 7] y frena
  en cuanto se aplica. Medido: hoy frena solo a V0508 (ya frenado en 6).
- El clasificador NIEGA bajar archivos del storage con la service role (pantallazos): no
  insistir; pedirlo a la sesión principal.

Relacionado: [[datos-clave-cruces-titularidad]].
