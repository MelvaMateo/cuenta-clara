/* Portal administrativo (admin.html): las cuentas, su rol y su estado.

   Esconder este portal a quien no es administrador es comodidad, no
   seguridad: cada función de la base verifica de nuevo el rol
   (sql/05_calculos.sql), así que una cuenta común que abra esta página no
   puede ver ni cambiar nada. */

let yo = null;                                   // el id de quien administra
let cuentas = [];

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lempiras = n => 'L ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = f => (f ? new Date(f).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'nunca');

function avisar(msg, tipo = 'error') {
  const t = document.getElementById('aviso');
  t.textContent = msg;
  t.className = `toast ${tipo} visible`;
  clearTimeout(avisar.espera);
  avisar.espera = setTimeout(() => t.classList.remove('visible'), 4000);
}

function mensaje(error) {
  if (error.code === 'PGRST202' || error.code === '42883') {
    return 'Falta el portal en la base: corré en orden los scripts de sql/, del 01 al 06.';
  }
  if (/failed to fetch|networkerror/i.test(error.message)) return 'Sin conexión con Supabase.';
  return error.message;                          // los de la base ya vienen en castellano
}

/* Lo que pregunta cada botón antes de actuar, y lo que avisa después. */
const ACCIONES = {
  'rol:true': {
    pregunta: c => `¿Darle el rol de administrador a ${c.correo}?`,
    hecho: c => `${c.correo} ahora es administrador`,
  },
  'rol:false': {
    pregunta: c => `¿Quitarle el rol de administrador a ${c.correo}?`,
    hecho: c => `${c.correo} ya no es administrador`,
  },
  'estado:false': {
    pregunta: c => `¿Desactivar la cuenta de ${c.correo}? No va a poder ver ni cargar datos hasta que la reactives.`,
    hecho: c => `Cuenta de ${c.correo} desactivada`,
  },
  'estado:true': {
    pregunta: c => `¿Reactivar la cuenta de ${c.correo}?`,
    hecho: c => `Cuenta de ${c.correo} reactivada`,
  },
};

/* Todas las formas de entrar de la cuenta: una creada con correo a la que
   después se le sumó Google tiene las dos. Si la base todavía devuelve solo
   la primera (antes de correr el 05 nuevo), se muestra esa. */
const NOMBRES_ACCESO = { email: 'correo', google: 'Google' };
function formasDeEntrar(c) {
  const lista = c.proveedores || [c.proveedor || 'email'];
  return lista.map(p => NOMBRES_ACCESO[p] || p).join(' y ');
}

function botonRol(c, soyYo) {
  if (c.es_admin) {
    const bloqueo = soyYo ? ' disabled title="No podés quitarte tu propio rol"' : '';
    return `<button type="button" class="mini secundario" data-accion="rol" data-id="${c.user_id}" data-valor="false"${bloqueo}>Quitar administrador</button>`;
  }
  const bloqueo = c.activa ? '' : ' disabled title="Primero reactivá la cuenta"';
  return `<button type="button" class="mini" data-accion="rol" data-id="${c.user_id}" data-valor="true"${bloqueo}>Hacer administrador</button>`;
}

function botonEstado(c, soyYo) {
  if (!c.activa) {
    return `<button type="button" class="mini" data-accion="estado" data-id="${c.user_id}" data-valor="true">Reactivar</button>`;
  }
  const bloqueo = (soyYo || c.es_admin) ? ' disabled title="No se puede desactivar a un administrador"' : '';
  return `<button type="button" class="mini peligro" data-accion="estado" data-id="${c.user_id}" data-valor="false"${bloqueo}>Desactivar</button>`;
}

function tarjeta(c) {
  const soyYo = c.user_id === yo;
  const insignias = [
    c.es_admin ? '<span class="insignia admin">Administrador</span>' : '',
    c.activa ? '' : '<span class="insignia apagada">Desactivada</span>',
    soyYo ? '<span class="insignia yo">Vos</span>' : '',
  ].join('');
  return `<article class="tarjeta cuenta${c.activa ? '' : ' apagada'}">
    <div class="cuenta-cab"><strong>${escHtml(c.correo)}</strong>${insignias ? `<div class="insignias">${insignias}</div>` : ''}</div>
    <p class="cuenta-sub">Entra con ${formasDeEntrar(c)} · alta ${fecha(c.creada_en)} · último acceso ${fecha(c.ultimo_acceso)}</p>
    <dl class="cuenta-totales">
      <div><dt>Cajas</dt><dd>${c.cajas}</dd></div>
      <div><dt>Productos</dt><dd>${c.productos}</dd></div>
      <div><dt>Ventas</dt><dd>${c.ventas}</dd></div>
      <div><dt>Por cobrar</dt><dd>${lempiras(c.por_cobrar)}</dd></div>
    </dl>
    <div class="acciones-card">${botonRol(c, soyYo)}${botonEstado(c, soyYo)}</div>
  </article>`;
}

function render() {
  const resumen = [
    ['Cuentas', cuentas.length],
    ['Administradores', cuentas.filter(c => c.es_admin).length],
    ['Desactivadas', cuentas.filter(c => !c.activa).length],
  ];
  document.getElementById('resumenAdmin').innerHTML =
    resumen.map(([nombre, valor]) => `<div class="stat-admin"><b>${valor}</b><span>${nombre}</span></div>`).join('');
  document.getElementById('listaCuentas').innerHTML = cuentas.map(c => tarjeta(c)).join('');
}

async function cargar() {
  try {
    cuentas = await Datos.adminCuentas();
    render();
  } catch (error) {
    avisar('No se pudieron leer las cuentas: ' + mensaje(error));
  }
}

/* Cada botón manda el valor final (sí o no): repetir la acción deja lo mismo. */
async function actuar(boton) {
  const c = cuentas.find(x => x.user_id === boton.dataset.id);
  const accion = ACCIONES[`${boton.dataset.accion}:${boton.dataset.valor}`];
  if (!c || !accion || !confirm(accion.pregunta(c))) return;
  const valor = boton.dataset.valor === 'true';
  boton.disabled = true;
  try {
    if (boton.dataset.accion === 'rol') await Datos.adminCambiarRol(c.user_id, valor);
    else await Datos.adminCambiarEstado(c.user_id, valor);
    avisar(accion.hecho(c), 'ok');
    await cargar();
  } catch (error) {
    avisar(mensaje(error));
    boton.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const sesion = await exigirSesion();
  if (!sesion) return;
  yo = sesion.user.id;
  document.body.classList.remove('bloqueada');
  document.getElementById('btnSalir').addEventListener('click', async () => {
    await Sesion.cerrar();
    location.replace('login.html');
  });

  if (!(await Datos.esAdmin())) {
    document.getElementById('soloAdmin').hidden = false;
    return;
  }
  document.getElementById('panelAdmin').hidden = false;
  document.getElementById('listaCuentas').addEventListener('click', e => {
    const boton = e.target.closest('button[data-accion]');
    if (boton && !boton.disabled) actuar(boton);
  });
  await cargar();
});
