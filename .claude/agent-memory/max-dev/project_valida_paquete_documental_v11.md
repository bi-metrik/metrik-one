---
name: valida-paquete-documental-v11
description: PR #18 de metrik-valida (paquete documental v1.1, sin mergear al 2026-09-08) — la contradicción del grep de INTERPOL en el doc de Lucía, lo que quedó fuera a propósito (pie AFI del lote y de /v/[hash], migración de retención a 10 años), el solapamiento con PR #15 en pdf.tsx y cómo se verificaron los PDFs
metadata:
  type: project
---

**PR #18 `fix/paquete-documental-v1.1` (bi-metrik/metrik-valida) aplica el doc de Lucía
`proyectos/metrik/valida/docs/entrega/correcciones-paquete-documental-v1.1.md` en 7 archivos:
`lib/recursos/pdf-{listas,privacidad,manual}.tsx`, sus `app/recursos/*/page.tsx` y
`lib/reporte/pdf.tsx`. Sin mergear al 2026-09-08 (Mauricio pidió no mergear).**

**Why:** tres documentos públicos contradecían decisiones ya tomadas (INTERPOL fuera desde
2026-06-30; conservación 10 años desde 2026-09-08; periodicidad PEP la fija el obligado).
Lucía es owner del contenido SARLAFT: los textos van literales, Max no los adapta.

**How to apply / lo que no es obvio del diff:**

- **El grep de Lucía se contradice con su propio texto.** L14/W7 dictan la frase «Tampoco forma
  parte del Servicio la lista INTERPOL Red Notices…» y a la vez su verificación pide
  `grep -i interpol` = 0. Se aplicó el texto (2 menciones deliberadas, ambas de exclusión). Si
  alguien "limpia" esas dos líneas para dejar el grep en cero, está borrando contenido de Lucía.
- **Visto de Emilio pendiente por decisión de Mauricio**: las marcas `[VISTO EMILIO PENDIENTE]`
  son comentarios de código sobre cada bloque de la Política (doc 6), no texto publicado. Lo
  visible es solo la nota de § 14. Cuando Emilio revise, sale v1.2 y se quitan los comentarios.
- **Quedó fuera a propósito y sigue diciendo "Distribuido por AFI"**: `lib/reporte/pdf-lote.tsx:425`
  y `app/v/[hash]/page.tsx:386,747`. El reporte individual ya dice "Emitido por MeTRIK Valida";
  AFI vería dos criterios. Es un PR chico pendiente, no un olvido.
- **La migración de `consultas.data_retention_until` (5 → 10 años, migr. 0001) NO está**: se
  publica "10 años" sin tocar la base porque no existe job de borrado (ninguna consulta se
  pierde). Lucía la pide "en el mismo PR o el siguiente"; Mauricio decide.
- **PR #15 (feat/api-terceros) también toca `lib/reporte/pdf.tsx`** (`ClienteBand`,
  `RunningHeader`, nota de fuentes, tipo `sujeto_obligado`). Este PR toca disclaimer, pie y el
  bloque tras `consulta_parcial`: sin solapamiento textual, pero el que mergee segundo debe
  rebasar. El pie condicional «Consulta gestionada por <canal> en nombre de <sujeto obligado>»
  espera a que exista `sujeto_obligado` (PR #15); nunca un agregador fijo en el código.
- **El hash del reporte es sobre `{cliente, payload, matches}`** (`app/api/v1/validate/route.ts`),
  no sobre el PDF: cambiar leyendas no altera hashes de reportes re-renderizados.
- **`react/no-unescaped-entities` está activo** en metrik-valida y el baseline de
  `pdf-manual.tsx` ya tenía 6 errores por comillas rectas en texto JSX. Comillas nuevas en los
  PDF van como `&quot;` (JSX las decodifica, render idéntico, verificado en el texto extraído);
  en las páginas web van «». Fuera de eso quedan 2 warnings preexistentes (`Users`, `tier`).
- **Con el texto nuevo, el disclaimer del reporte se partía** (título huérfano al pie de la
  página 1): disclaimer y leyenda ALTO llevan `wrap={false}`. Con un match el reporte pasa de
  1 a 2 páginas; sin hallazgos ya eran 2. Listas/manual/política siguen en 7/15/8 páginas.
- Lucía no incluyó en sus tablas la fila "Bloqueo + ROS UIAF" de la tabla de tiers ni
  `TIER_CONFIG[1].descripcion`: quedaron como estaban. INTERPOL también sigue en ANS (no se
  toca sin Emilio), seguridad y diccionario (el diccionario lo toca PR #15).
- Registrar v1.1 y la decisión "Valida Diligencia arranca con SIRI + SECOP II" en el cerebro es
  de Kaori; notificar a los 4 CDAs y a AFI es de Sofía (§ 6.2 del doc de Lucía).

Relacionado: [[worktree-git-bloqueado]] (cómo se hizo el PR sin git local), [[mirar-pdf-renderizado]].
