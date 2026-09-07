/* Sesión con Supabase Auth (Google), compartida por el login y la app.

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

  /* Google manda el nombre en user_metadata; si no viene, queda el correo. */
  nombreDe(sesion) {
    const meta = (sesion && sesion.user && sesion.user.user_metadata) || {};
    return meta.full_name || meta.name || (sesion && sesion.user && sesion.user.email) || 'Usuaria';
  },
};

/* Solo se entra con sesión abierta; si no, se vuelve a la pantalla de acceso. */
async function exigirSesion() {
  const sesion = await Sesion.actual();
  if (!sesion) location.replace('login.html');
  return sesion;
}
