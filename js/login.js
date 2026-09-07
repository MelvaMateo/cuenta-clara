/* Login con Google a través de Supabase Auth (ver sesion.js).
   Ya no hay usuario ni contraseña en el cliente: la identidad la da Google
   y Supabase emite la sesión. */

function avisar(msg) {
  const caja = document.getElementById('aviso');
  caja.textContent = msg;
  caja.classList.add('visible');
}

document.addEventListener('DOMContentLoaded', async () => {
  const boton = document.getElementById('btnGoogle');

  if (!CONFIG_LISTA) {
    boton.disabled = true;
    avisar('Falta completar js/config.js con la URL y la anon key del proyecto de Supabase.');
    return;
  }

  /* Al volver de Google la sesión ya viene abierta: entra directo. */
  if (await Sesion.actual()) {
    location.replace('app.html');
    return;
  }

  boton.addEventListener('click', async () => {
    boton.disabled = true;
    const { error } = await Sesion.entrarConGoogle();
    if (error) {                                  // si sale bien, el navegador ya se fue a Google
      boton.disabled = false;
      avisar('No se pudo iniciar sesión: ' + error.message);
    }
  });
});
