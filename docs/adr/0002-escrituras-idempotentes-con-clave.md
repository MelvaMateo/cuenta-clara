# ADR-2: Escrituras idempotentes con una clave generada por la app

- **Estado:** Aceptada
- **Fecha:** 2026-09-13
- **Commits:** de `d2400ad` a `07dc5b8` (ver `git log`)

## Contexto

La app se usa desde el celular, muchas veces con la conexión inestable. Cada escritura se mandaba sin ninguna forma de reconocerla. Si la base guardaba pero la respuesta no llegaba, la app mostraba "Sin conexión" y la usuaria volvía a intentarlo:

- **Vender:** el stock se descontaba dos veces y la caja sumaba una venta que no existió.
- **Abonar:** el abono se sumaba dos veces. Además, que no superara el saldo solo lo revisaba el celular, así que dos abonos a la vez podían dejar la deuda en negativo.
- **Anotar un fiado:** eran dos llamadas (buscar o crear la clienta, y crear el fiado). Si fallaba la segunda, quedaba a medias.
- **Crear una caja o un producto:** el id lo ponía la base, así que un reintento creaba otra fila.

Opciones consideradas:

| Opción | Por qué no, o por qué sí |
|---|---|
| Deshabilitar el botón mientras se guarda | Evita el doble toque, pero no el reintento después de un corte |
| Detectar duplicados por contenido ("la misma venta en menos de un minuto") | Da falsos positivos: vender dos veces lo mismo seguido es legítimo |
| **Una clave de idempotencia por operación, y las operaciones de varias filas en funciones de la base** | Reintentar lo mismo manda la misma clave, y la base reconoce que ya lo hizo |

## Decisión

Cada escritura es **idempotente** y lleva una **clave generada por la app**:

1. **La clave es un UUID** que la app genera una sola vez por operación y usa como id de la fila que crea. Sale de la *firma* de la operación: qué se hace, con qué datos y sobre qué estado (por ejemplo, el stock que se veía al vender). Reintentar lo mismo reusa la clave; vender otra unidad después es otra firma y lleva otra. La clave se suelta cuando la base confirma.
2. **Lo que toca varias filas o acumula es una función de la base**, en una sola transacción: `vender_producto`, `registrar_fiado` y `registrar_abono`. Bloquean el producto o el fiado mientras trabajan; si la clave ya existe, devuelven el mismo resultado sin repetir nada, y si la clave llega con otros datos, lo rechazan. No vender de más y no abonar más de lo que se debe se controla ahí, no en el celular.
3. **Crear una caja o un producto** es un `insert ... on conflict (id) do nothing` con la clave como id.
4. **Cambiar un precio o el colchón** manda el valor final, no una diferencia, y avisa si la fila no existe.
5. **Las fotos** se guardan con un nombre que sale de su contenido (SHA-256): la misma foto va siempre al mismo lugar.

Junto con esto, los datos se guardan en una sola forma canónica: los textos, con un trigger que quita los espacios de más; los montos, con dos decimales.

## Consecuencias

**Positivas**

- Reintentar nunca duplica una venta, un fiado ni un abono: el stock y los saldos se pueden creer.
- Las reglas del negocio que antes cuidaba el celular ahora las garantiza la base, también frente a dos operaciones a la vez.
- Está probado en el CI: en PGlite, cada operación llamada dos veces con la misma clave deja una sola fila, y con otros datos se rechaza; en Chrome, con un Supabase simulado que corta la respuesta después de guardar, el reintento manda la misma clave.

**Negativas y cómo se mitigan**

- **Más complejidad:** tres funciones SQL y un registro de claves en la app. Está documentado en `sql/README.md` y cubierto por pruebas.
- **Las claves viven en memoria.** Si se recarga la página justo después de un corte, el reintento lleva otra clave. Se mitiga porque la firma incluye el estado: después de recargar se ve si la operación entró (por ejemplo, el stock ya bajó).
- **Cambió la firma de `vender_producto`.** La base y la app tuvieron que actualizarse juntas, con unos minutos de corte, y la versión sin clave se eliminó.
- **El bloqueo entre operaciones simultáneas no tiene prueba automática.** Las pruebas usan una sola conexión; el bloqueo se apoya en `select ... for update`, un mecanismo estándar de PostgreSQL.
