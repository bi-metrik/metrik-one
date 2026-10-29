---
name: project-valida-terminos-v15
description: Términos Plan CDA v1.5 por aviso (1-nov-2026) — transición 11.7 de la mora, pantalla anexo A, publicación programada, correo programado; qué falta (16.4) y orden de producción
metadata:
  type: project
---

Rama `feat/valida-cda-terminos-v1.5` (29-oct-2026). La v1.5 se publica por aviso el dom 1-nov-2026 y rige el
1-dic en los 4 CDA (cda-caqueta, cda-elcarmen, cda-puertotest, maxitec). Nada de producción corrido por Max.

- **Transición 11.7 (bloqueante de Vera)**: con una v1.5 registrada y publicada, la cuota impaga más vieja de un
  período que empezó antes de la vigencia se mide con D = vigencia − 1 → restringe 6-dic, pausa 31-dic. Vive en
  `plazos.ts` (`vencimientoConTransicion`); los períodos desde el 1-dic siguen la regla v1.4 (más tarde que la 11.2
  de la v1.5). Suspendido/Cancelado completos NO están.
- **16.4 sin construir**: desde el 22-dic (Maxitec) / 16-ene (los otros) sin aceptar no se consulta. Nada lo hace hoy;
  la pantalla siempre ofrece «Ahora no». Hay que construirlo antes del 22-dic-2026.
- **Publicación programada**: la guarda `documentos_versiones_por_aviso()` exigía `publicada_at <= now()`. La
  migración 20261029190000 (opcional, DDL) admite hasta 7 días antes; la app filtra con `sinAvisosFuturos` en
  `documentosDelCliente`. Esa función ya estaba parchada por texto por 20261016100100: NUNCA reescribirla entera.
- **Orden**: (migración si se registra el viernes) → merge+deploy → subir PDFs (sha256) → ensayo → publicar →
  script del correo `--enviar` (Resend `scheduled_at` dom 08:00, acuse en `avisos_cliente`).
- Los 4 CDA tienen el mismo correo como email_fiscal y persona designada: un correo por CDA.

**Why:** promesa contractual de no restringir antes del 6-dic; publicar sin la transición cortaba a 3 de 4 clientes.
**How to apply:** antes de tocar mora de CDA o la pantalla de Términos, leer `plazos.ts` sección 3 y
`terminos-v1-5.ts`; para la 16.4 reusar `fechaExigeAceptacion` + `finUltimoPeriodoPagado`. Ver [[project-valida-reverso-corta-plan]].
