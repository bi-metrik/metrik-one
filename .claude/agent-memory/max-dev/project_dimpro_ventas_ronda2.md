---
name: project-dimpro-ventas-ronda2
description: Dimpro ventas ronda 2 (29-oct) — cortes 20/45 s solo en ventas; «Hola de nuevo» venía de la MISMA conversación de Chatwoot; SQL ronda2 SIN correr, después del deploy
metadata:
  type: project
---

Mauricio probó el asistente en Messenger (conv 3, 29-oct) tras #1360: «tiene muchos errores». Rama
`fix/dimpro-asistente-consultivo-ronda2`.

- **No hay memoria entre conversaciones**: `publico/memoria.ts` son los puertos de prueba. El «¡Hola de nuevo!» salió
  porque Chatwoot/Messenger reusa la misma conversación por semanas y la cola lee 30 días. Arreglo: línea del estado
  con la pausa (`horasDePausa` ≥ 1 h) + ficha `alc.saludo`. No se recortó el historial (los consentimientos lo leen).
- Aviso de demora: `corte_1` por defecto 5 s; turnos de ventas 7-13 s. `CORTES_VENTAS` = 20 s / 45 s por defecto solo
  si `dominio = 'ventas'` (dimpro no fija `corte_1_ms` en config_extra). Sabor intacto.
- Verificador del núcleo (`verificador.ts`, compartido con ONE/Trappvel): «2.800» se leía «800» → vuelta extra del
  modelo. Ahora un dígito seguido de miles cuenta entero.
- Relevancia: `ESPECIALIZADOS` (magnético) entra solo con estructura/viga/anular/grueso/magnético; `MATERIALES` saca lo
  que nombra otro material; producto sin material = uso general. Catálogo real: «metal, de cable» → solo MP-38.
- Fotos: `fotosDelTurno` acepta códigos leídos en cualquier turno de la conversación (antes solo el turno).
- Los archivos SQL viejos (`*-ENSAYO.sql`, `*-consultiva.sql`) se regeneran del código (sus tests exigen igualdad).

**Why:** la sesión que despliegue necesita el orden y saber qué cambió para todos los bots (verificador).
**How to apply:** deploy `chatwoot-agente` → `sql/dimpro/2026-10-29_reglamento-ventas-ronda2.sql` → probar en
Messenger «Hola», «taladro para metal de cable», «¿tienes foto?». Ver [[project-dimpro-venta-consultiva-fotos]].
