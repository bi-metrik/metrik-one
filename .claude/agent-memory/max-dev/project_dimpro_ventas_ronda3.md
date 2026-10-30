---
name: project-dimpro-ventas-ronda3
description: Dimpro ventas ronda 3 (30-oct) — en Messenger el botón llega como TEXTO (#1368); respuesta partida por producto con su foto; dirección como dirección; confirmar_compra; venta cruzada por mapa en el reglamento; SQL ronda3 SIN correr
metadata:
  type: project
---

Prueba de Mauricio en Messenger (conv 3, 30-oct). Dos PR: #1368 (`fix/dimpro-toque-como-texto-messenger`, chico, va
primero) y el grande #1370 (`feat/dimpro-ventas-intercalado`), apilado sobre él: retarget a main antes del merge. Carrito NO hecho (dos links). Mapa real: `sql/dimpro/2026-10-30_venta-cruzada-piloto.sql`.

- **Messenger por Chatwoot no trae el id del botón**: el `input_select` sale como respuesta rápida y el toque llega como
  texto con el título (clase escrito, toque_id null). `toquesPorTitulo` (cola.ts, solo canal `otro`) lo vuelve toque
  si el texto normalizado = título de la ÚLTIMA salida con opciones. La autorización «Sí» ya pasaba por `esSiSolo`.
- La respuesta con varios productos se publica partida (`ventas/partir-ventas.ts`): entrada → texto del producto → su
  foto SIN pie → … → pregunta. Ranuras `respuesta`, `parte_N`, `foto_N`; pausas `PAUSA_TRAS_FOTO_MS` 2,5 s y 0,8 s
  entre mensajes (SIN VERIFICAR que basten en Messenger). Si el texto mezcla productos, sale como antes (pie en la foto).
- Dirección: `direccion-ventas.ts` (relleno y abreviaturas); `dichoTras` de dominio.ts NO se tocó (Sabor igual).
- `datos` de proponer como string: el núcleo lo parsea o devuelve `datos_mal_formados` (cambia para TODOS los bots).
- Tope de llamados en ventas → persona `falla` con lo último propuesto en la nota (antes «¿me lo escribes de nuevo?»).
- `confirmar_compra` (cierre de ventas): el modelo interpreta la aceptación escrita; la cola corre `toqueDePropuesta`.
- Venta cruzada: ficha `ventas.complementos` (`valores.mapa`), herramienta `ver_complementos`, una vez por conversación.
  Sin carrito: el complemento es un SEGUNDO pedido/link. El mapa real lo arma otra sesión (xlsx en proyectos/dimpro);
  se carga con `semilla-sql-dimpro.ts --complementos <mapa.json>`; la ronda 3 NO incluye esa ficha (no la pisa).

**Why:** la sesión que despliegue necesita el orden y lo que cambió para todos los bots (núcleo: datos string).
**How to apply:** deploy `chatwoot-agente` → `sql/dimpro/2026-10-30_reglamento-ventas-ronda3.sql` → (mapa, cuando
exista). Probar en Messenger: «algo para la casa», tocar «Sí, enviar link», dirección en dos mensajes. Ver
[[project-dimpro-ventas-ronda2]].
