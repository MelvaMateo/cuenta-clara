# ADR-3: Portal administrativo con funciones de la base, sin la clave de servicio

- **Estado:** Aceptada
- **Fecha:** 2026-09-15

## Contexto

La app necesitaba, además del portal de cada negocio, un **portal administrativo**: ver todas las cuentas, dar o quitar el rol de administrador y desactivar cuentas. Lo usan la autora y otra persona de su confianza, las dos con su cuenta de Google.

Hasta ahora cada cuenta veía solo lo suyo gracias al RLS ([ADR-1](0001-supabase-como-backend-con-rls.md)), y nadie podía ver las demás. Para administrar hace falta, a propósito, saltarse ese aislamiento. Pero solo para quien tenga el rol, y sin abrirle la puerta a nadie más.

Opciones consideradas:

| Opción | Por qué no, o por qué sí |
|---|---|
| La API de administración de usuarios de Supabase, desde una función de Vercel | Necesita la clave de servicio de Supabase, la que se salta todo el RLS. Habría que guardarla en Vercel y, si se filtrara, daría acceso a todos los datos. A cambio, permite bloquear el inicio de sesión mismo |
| Manejar los roles a mano en el SQL Editor | No hace falta programar nada, pero no es un portal: depende de entrar a Supabase para cada cambio |
| **Funciones de la base que primero verifican el rol** | Todo queda dentro de PostgreSQL, sin ninguna clave secreta fuera de Supabase, y las reglas se pueden probar |

## Decisión

El portal administrativo se construye con **funciones de la base** y sin la clave de servicio:

1. Una tabla `estado_cuentas` guarda el rol (`es_admin`) y el estado (`activa`) de cada cuenta que tenga algo especial. **Nadie la escribe directo**, ni un administrador: solo las funciones del portal, que dejan registrado quién hizo el cambio y cuándo.
2. `es_admin()` y `cuenta_activa()` responden sí o no sobre la propia cuenta. La política "solo lo propio" de las seis tablas exige además que la cuenta esté activa: a una cuenta desactivada **el RLS deja de entregarle sus datos**.
3. `admin_cuentas()`, `admin_cambiar_rol()` y `admin_cambiar_estado()` corren con los permisos de su dueño (`security definer`), porque tienen que ver todas las cuentas. **Lo primero que hacen es verificar que quien llama sea administrador.** Además, tienen el `search_path` fijo y no se pueden usar sin sesión. El portal ve solo totales por cuenta (cajas, productos, ventas, lo que tiene por cobrar), no el contenido de ningún negocio.
4. Las reglas viven en la base:
   - nadie se quita su propio rol, así que siempre queda al menos un administrador;
   - nadie desactiva su propia cuenta;
   - a un administrador primero hay que quitarle el rol;
   - una cuenta desactivada no puede ser administradora.

   Los cambios mandan el valor final, así repetirlos deja lo mismo.
5. `admin.html` tiene la misma protección que la app: sin la marca de sesión, Vercel redirige al login; sin sesión, no muestra nada; y a una cuenta común le dice que el portal es solo para administradores.
6. El primer administrador se nombra con `sql/10_primer_administrador.sql`, cambiando el correo en el SQL Editor. En el repo, que es público, el archivo queda con un correo de ejemplo. Los demás administradores se nombran desde el portal.

## Consecuencias

**Positivas**

- Ninguna clave secreta sale de Supabase: no hay nada en Vercel que, si se filtra, abra todos los datos.
- Las reglas del rol las garantiza la base y las prueba el CI (en PGlite, con el rol `authenticated` y el RLS activo).
- Cada cambio de rol o de estado queda registrado con quién y cuándo.
- Quien administra no ve el contenido de los negocios, solo cuántos datos tiene cada cuenta.

**Negativas y cómo se mitigan**

- **Desactivar una cuenta no le impide iniciar sesión.** Eso sí necesitaría la API de administración con la clave de servicio. La cuenta entra, pero la base no le entrega ningún dato y la app le explica que está desactivada. Si hiciera falta bloquear también el inicio de sesión, se agregaría una función en el servidor con esa clave.
- **Las funciones `security definer` se saltan el RLS.** Un error en una de ellas expondría datos. Se mitiga así:
  - cada una verifica el rol antes que nada;
  - tienen el `search_path` fijo;
  - no se pueden usar sin sesión;
  - devuelven solo totales;
  - las pruebas cubren que una cuenta común no pueda usarlas.
- **El primer administrador se nombra a mano**, con SQL, una sola vez.
