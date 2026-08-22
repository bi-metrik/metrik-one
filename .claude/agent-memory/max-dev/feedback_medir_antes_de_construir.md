---
name: medir-antes-de-construir
description: Medir contra producción antes de escribir código, y verificar contra la fuente externa cuando el brief declara que un dato no existe
metadata:
  type: feedback
---

Antes de construir un indicador o un fix sobre datos de producción, **medir primero** y
reportar los números; y cuando el encargo afirma que un dato "no existe" o que algo "está
pendiente", **comprobarlo** en vez de heredarlo.

**Why:** en la ola 1 de tableros de SOENA (2026-08-22), tres de seis puntos del inventario
estaban desactualizados en la dirección peligrosa: dos ya estaban construidos y uno afirmaba
que el dato de asignación no existía cuando estaba poblado al 100%. Construir sobre esa
premisa habría dejado el indicador midiendo contra la referencia prestada un mes más. Es la
misma familia de los gotchas de verificación del `CLAUDE.md`: el síntoma de lo roto y el de
lo sano se parecen demasiado.

**How to apply:**
- La medición va **antes** de escribir, no después de desplegar, y el número medido entra al
  encabezado de la migración y al cuerpo del PR. Si el cambio mueve un veredicto (un bono,
  un gate, una comisión), decir **cuántos casos** cambian y **cuáles**.
- Cuando el resultado de un cambio se puede leer con más de un criterio (horas corridas vs
  hábiles, jornada de 8 h vs día completo), medir **las tres o cuatro variantes** y ponerlas
  en la tabla. Eso es lo que convierte una decisión de negocio en algo que el cliente puede
  tomar, en vez de una que el código toma por él.
- Lo que no está acordado va a **configuración con default declarado en pantalla como
  supuesto**, nunca a una constante en el código. Patrón ya establecido en
  `config_bono_operaciones` (piso de 95%, 36/48 h del envío).
- Verificar que un PR realmente entró: `git merge-base --is-ancestor <sha> origin/main`.
  GitHub marca "merged" PRs cuyo commit nunca llegó a la rama.
