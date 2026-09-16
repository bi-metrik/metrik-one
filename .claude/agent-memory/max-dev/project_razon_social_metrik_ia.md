---
name: razon-social-metrik-ia
description: La razon social es METRIK IA S.A.S., NIT 902.079.601-9; el nombre sin IA es OTRA sociedad. Corregido el 2026-09-16 en Valida (#45, Politica v1.5) y ONE (#765), con guardas en CI en los dos repos; la version de la Politica con Wompi ya no puede ser la 1.5
metadata:
  type: project
---

La sociedad es **METRIK IA S.A.S., NIT 902.079.601-9** (cerebro:
`decisiones/2026-06-14_constitucion-metrik-ia-sas-gates.md`). El nombre sin «IA» pertenece a
otra sociedad, homónima, del mismo sector. La marca comercial sigue siendo MéTRIK, sin sufijo.

**Why:** hasta el 2026-09-16 la Política de Tratamiento de Datos v1.4 de Valida identificaba
al Responsable con el nombre sin «IA» y el NIT «en proceso»: nombraba a un tercero. Lo mismo
el ANS, Seguridad, Soporte, portadas de PDF, pies, OpenAPI, Postman, y en ONE el aviso que
acepta cada usuario del módulo Valida API. Pedido urgente de Mauricio.

**Estado (2026-09-16, mergeado y verificado en producción, los dos hosts de Valida):**
- metrik-valida #45 (`3008387`): Política 1.4 → **1.5**, Seguridad 1.1 → 1.2, ANS 1.0 → 1.1,
  Soporte 1.0 → 1.1, Manual 1.2 → 1.3, Listas 1.4 → 1.5. Guarda
  `lib/docs/razon-social-publicada.test.ts`.
- metrik-one #765 (`ea308ff`): aviso y `POLITICA_DATOS_VALIDA.version = '1.5'` (vuelve a pedir
  aceptación a todos). Guarda `src/lib/compliance/razon-social-publicada.test.ts`, con UNA
  excepción: el comentario de la migración aplicada `20260825000001`.
- metrik-landing ya estaba bien (main y producción en 0).

**How to apply:**
- ⚠️⚠️ **La Política con Wompi (entrega B5) ya NO puede ser la 1.5.** La spec
  `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md` (gate «versión mínima 1.5»)
  y el catálogo `docs/catalogo-servicios/.../valida-api-bolsa.md` y `valida-cda-licencia.md`
  (`politica-datos-valida@1.5`) siguen diciendo 1.5: renumerar antes de construir ese gate, o
  el widget se habilita con una política que no nombra a Wompi.
- **Abierto para Emilio:** el numeral 14.1 dice que un cambio sobre la identidad del
  Responsable se comunica al Titular antes. Es corrección de identificación, no cambio de
  Responsable, pero nadie lo comunicó.
- **No tocado a propósito:** `ENCARGADO.nombre = 'MéTRIK IA SAS'` en `vinculacion-publica.ts`
  (sociedad correcta, sin NIT ni puntos). Normalizarlo cambia el texto firmado y obliga a v3.
- Las dos guardas detectan tres formas y las tres hacían falta: la marca con sufijo (con la «é»
  como `{'é'}` o partida en dos líneas), el sufijo como **etiqueta suelta** (las portadas
  de PDF pintan `MéTRIK` y `SAS` en dos `<Text>`, invisible para un grep de la frase) y el NIT
  «en proceso». Al escribir texto legal nuevo que nombre la forma prohibida (p. ej. explicando
  la homonimia), armarla por partes o la guarda cae — pasó con `AGENTS.md`.
- ⚠️ Al mutar para probar, **restaurar desde el contenido guardado, no con `git checkout --`**:
  el checkout devolvió el archivo a `main` y borró la corrección propia sin commitear; lo
  delató el `git diff --stat` con un archivo de menos.

Relacionado: [[pruebas-por-mutacion]], [[retencion-control-en-ci]],
[[publicar-otro-repo-desde-worktree-aislado]], [[arbol-limpio-por-tarball]].
