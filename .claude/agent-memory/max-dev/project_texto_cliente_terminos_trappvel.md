---
name: texto-cliente-terminos-trappvel
description: "#841/#848 — términos del texto (config_extra.terminos_base; desde #848 se copian al CREAR la cotización), dónde sale cada campo, validador de estilo que marca sin reescribir, few-shot con iniciales en código, y Trappvel sin resumen fiscal; los datos de config los carga la sesión principal"
metadata:
  type: project
---

**PR [#841](https://github.com/bi-metrik/metrik-one/pull/841)** (2026-09-23), brief
`proyectos/trappvel/clarity/docs/diseno/brief-max-texto-cliente-2026-09-23.md` con el ajuste de
C4 de Mauricio del mismo día. Sin migración. Nada escrito en producción: el texto base y los
ejemplos los carga la sesión principal.

**Why:** ensayo de COT-2026-0009 (hallazgos 33-35): los términos del cuadro no salían en el PDF
de Trappvel, el panel no decía dónde sale cada campo y el texto sonaba a folleto.

**How to apply:**
- **Las dos claves, en la línea «Viaje a medida»** (`42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887`):
  `config_extra.terminos_base` (texto con saltos; renglón suelto antes de viñetas = subtítulo,
  `- ` = viñeta, dos espacios + `- ` = sub-viñeta) y `config_extra.ejemplos_texto` (lista de
  textos sueltos = presentación, u objetos con los cuatro campos). ⚠️ `ejemplos_texto` AUSENTE
  usa tres ejemplos iniciales que viven en código (`EJEMPLOS_TEXTO_INICIALES`); una lista vacía
  los apaga. No es lo mismo quitar la clave que dejarla en `[]`.
- **Desde #848 (C5, 2026-09-23, mergeado) la cotización NACE con los términos guardados**:
  `terminos-al-crear.ts` copia `terminos_base` al insert si la plantilla del workspace es
  `trappvel`, en la creación manual y en la auto-cotización. Duplicar hereda los de la
  original. El panel sigue proponiendo (punto ámbar) SOLO si `terminos_condiciones` está
  vacío: las cotizaciones anteriores a #848 (sin backfill) y la que el asesor dejó vacía.
  Si Edgar ve un PDF sin términos en una cotización nueva, mirar primero que la línea
  tenga `terminos_base` cargado.
- **El PDF nunca lee `terminos_base`**: imprime la copia de `terminos_condiciones`. Así un
  documento enviado no cambia si cambia el texto base.
- **El validador cuenta el entusiasmo por FRASE, no por palabra**: la apertura real
  «¡Prepárese para vivir una experiencia única en Chile!» trae dos expresiones permitidas y es
  UNA frase entusiasta. Contarlas por palabra marcaría los propios ejemplos de Trappvel.
- **Marca, no corrige**: `documento_cliente.estilo_por_revisar` solo existe si hay algo (la clave
  se omite en un texto limpio, para que los documentos viejos se lean igual).
- **Hallazgo 33 cuelga del registro de plantillas** (`plantillaMuestraResumenFiscal`), como el
  panel. Al ocultar el resumen se conserva suelto el aviso de IVA sin calcular: es lo único de
  ese bloque que cambia el PDF.
- Fixture del texto base: `src/lib/cotizaciones/__fixtures__/terminos-base-trappvel.ts` (idéntico
  byte a byte al .md del cliente, verificado con `diff`).

Relacionado: [[texto-cliente-trappvel]], [[pruebas-por-mutacion]], [[worktree-git-bloqueado]].
