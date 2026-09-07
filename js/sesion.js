/* Sesión con Supabase Auth, compartida por el login y la app.

   Antes la sesión era una llave en localStorage que el propio navegador se
   escribía: se falsificaba desde la consola. Ahora la emite y la valida
   Supabase, y el token se renueva solo. */

/* `sb` es nuestro cliente; `window.supabase` es la librería del CDN. */
const sb = CONFIG_LISTA
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const Sesion = {
  async actual() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session;
  },

  async entrarConCorreo(correo, clave) {
    return sb.auth.signInWithPassword({ email: correo, password: clave });
  },

  /* Manda a Google y vuelve a app.html con la sesión ya abierta. */
  async entrarConGoogle() {
    return sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: new URL('app.html', location.href).href },
    });
  },

  async cerrar() {
    if (sb) await sb.auth.signOut();
  },

  /* Google manda el nombre en user_metadata; con correo no viene, y queda
     la parte del correo antes de la arroba. */
  nombreDe(sesion) {
    const usuario = (sesion && sesion.user) || {};
    const meta = usuario.user_metadata || {};
    if (meta.full_name || meta.name) return meta.full_name || meta.name;
    return usuario.email ? usuario.email.split('@')[0] : 'Usuaria';
  },

  /* Qué proveedores tiene activos el proyecto. Sirve para no mostrar el botón
     de Google mientras el proveedor esté apagado: cuando se active en el panel
     de Supabase, aparece solo, sin tocar este código. */
  async proveedores() {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: SUPABASE_ANON_KEY },
      });
      return (await r.json()).external || {};
    } catch (e) {
      return {};                                  // sin red: solo correo
    }
  },
};

/* Solo se entra con sesión abierta; si no, se vuelve a la pantalla de acceso. */
async function exigirSesion() {
  const sesion = await Sesion.actual();
  if (!sesion) location.replace('login.html');
  return sesion;
}
