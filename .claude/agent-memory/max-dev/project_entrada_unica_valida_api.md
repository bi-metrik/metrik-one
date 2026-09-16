---
name: entrada-unica-valida-api
description: PR #771 (2026-09-16) mergeado sin migración — /valida-api tiene UNA entrada con los términos vivos y una sola aprobación por usuario; sin ella nada abre, ni revocar llaves; el UNIQUE sin huella pide migración con el segundo cliente
metadata:
  type: project
---

**PR #771** (squash `16540dfd`), mergeado el 2026-09-16 con los checks verdes. Sin migración.
Reemplaza la entrada de dos pasos del #769 ([[terminos-modulo-valida-api]]).

**Estado que no se ve en el código:**
- Al mergear, `documentos_aceptaciones_usuario` estaba **vacía** (medido por PostgREST): TODOS los
  usuarios de 4d-soft, incluido el soporte (Mauricio es owner + platform_admin allí), ven la
  entrada y tienen que aprobar antes de usar nada. El contrato ya estaba aceptado por WhatsApp,
  así que ninguno tiene que firmar: solo Política + lectura.
- **Revocar una llave también quedó detrás de la aprobación** (el #769 lo dejaba libre a
  propósito). Se siguió el pedido textual «sin eso no debería poderse hacer nada»; una llave
  comprometida de alguien sin aprobar la revoca el soporte desde Valida. Si Mauricio lo quiere
  al revés, es una línea en `revocarLlaveValidaApi`.
- La ruta `/api/valida-api/archivo/*` también responde 403 sin la aprobación.

**Why:** Mauricio: «los términos no pueden vivir en un documento, deben estar vivos, hay que
haber leído hasta el final para poder aprobar». Con dos pasos, 4D SOFT nunca veía los términos.

**How to apply:**
- ⚠️⚠️ **El UNIQUE `(usuario_id, documento_slug, documento_version)` no incluye la huella.**
  La aprobación se ata a `documento_sha256 = pdf_sha256`, así que cuando exista un segundo
  cliente con `terminos-uso-valida` `v1.0` (el slug es genérico), un usuario que entra a los dos
  espacios (el soporte) no podrá completar la del segundo: `evaluarEntrada` lo marca como
  `conflictos` y la pantalla lo dice. Antes de cargar el segundo contrato con ese slug y versión,
  migración que agregue la huella al UNIQUE (y el `onConflict` del upsert).
- La puerta es `entradaAprobada()` de `entrada-servidor.ts`; toda acción nueva del módulo la
  llama después de `contextoValidaApi()`. Las reglas puras están en `entrada.ts`.
- El texto de los términos lo pinta `texto-documento.ts` (lector propio, sin HTML crudo). Con el
  texto real a 390 px, correos y URL largos abrían scroll horizontal: `[overflow-wrap:anywhere]`.

Relacionado: [[terminos-modulo-valida-api]], [[modulo-valida-api-c2]], [[razon-social-metrik-ia]],
[[pruebas-por-mutacion]].
