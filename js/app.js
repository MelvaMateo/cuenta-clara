/* Cuenta Clara — inventario, fiados y resumen.
   Los datos viven en Supabase (ver datos.js); esta capa es solo la pantalla. */

/* ===== Sesión (ver sesion.js) ===== */
/* La sesión la resuelve Supabase, así que se conoce hasta que responde:
   se guarda acá y la app arranca recién cuando llega. */
let sesion = null;

async function salir() {
  await Sesion.cerrar();
  location.replace('login.html');
}

const fmt = n => 'L ' + Number(n).toFixed(2);            // lempiras con 2 decimales

/* Copia en memoria de lo último que devolvió la base. Buscar y calcular el
   resumen no vuelven a pedir nada a la red. */
let productos = [];
let fiados = [];

/* Los errores de red o de permisos se muestran; antes de Supabase no había
   forma de que una operación fallara, ahora sí. */
function avisar(msg) {
  const caja = document.getElementById('aviso');
  caja.textContent = msg;
  caja.classList.add('visible');
  clearTimeout(avisar._t);
  avisar._t = setTimeout(() => caja.classList.remove('visible'), 6000);
}

/* ===== Navegación por pestañas ===== */
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tabbtn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelector(`[data-tab="${id}"]`).classList.add('active');
  if (id === 'resumen') renderResumen();
}

/* ===== Inventario (US1, US2, US3) ===== */
async function addProducto(e) {
  e.preventDefault();
  const f = e.target;
  const nombre = f.nombre.value.trim();
  const precio = parseFloat(f.precio.value);
  if (!nombre || isNaN(precio)) {            // validación (US1)
    avisar('Falta el nombre o el precio.');
    return;
  }
  const boton = f.querySelector('button[type="submit"]');
  boton.disabled = true;                     // evita el doble registro por doble toque
  try {
    await Datos.agregarProducto({
      nombre,
      costo: parseFloat(f.costo.value) || 0,
      precio,
      stock: parseInt(f.stock.value) || 0,
      stockMinimo: parseInt(f.stockMinimo.value) || 0,
    });
    f.reset();
    await cargarProductos();
  } catch (error) {
    avisar('No se pudo guardar el producto: ' + error.message);
  } finally {
    boton.disabled = false;
  }
}

async function venderProducto(id) {
  const p = productos.find(x => x.id === id);
  if (!p) return;
  const cant = parseInt(prompt(`¿Cuántas unidades de "${p.nombre}" vendiste?`, '1'));
  if (!cant || cant <= 0) return;
  try {
    await Datos.venderProducto(id, cant);    // descuenta en la base (US2)
    await cargarProductos();
  } catch (error) {
    avisar(error.message);                   // "No hay suficiente stock"
  }
}

async function cargarProductos() {
  try {
    productos = await Datos.productos();
  } catch (error) {
    avisar('No se pudo leer el inventario: ' + error.message);
    return;
  }
  renderProductos();
}

function renderProductos() {
  const q = (document.getElementById('buscarProd').value || '').toLowerCase();
  const lista = productos.filter(p => p.nombre.toLowerCase().includes(q));
  const cont = document.getElementById('listaProductos');
  if (lista.length === 0) {
    cont.innerHTML = '<p class="vacio">Sin productos todavía.</p>';
    return;
  }
  cont.innerHTML = lista.map(p => {
    const bajo = p.stock <= p.stock_minimo;    // alerta de bajo stock (US3)
    const margen = p.precio - p.costo;
    return `<div class="card ${bajo ? 'bajo' : ''}">
      <div class="card-top">
        <strong>${p.nombre}</strong>
        <span class="pill ${bajo ? 'pill-rojo' : ''}">stock: ${p.stock}${bajo ? ' !' : ''}</span>
      </div>
      <div class="muted">Precio ${fmt(p.precio)} · Costo ${fmt(p.costo)} · Margen ${fmt(margen)}</div>
      <button class="mini" onclick="venderProducto('${p.id}')">Vender</button>
    </div>`;
  }).join('');
}

/* ===== Fiados (US6, US7, US8) ===== */
async function addFiado(e) {
  e.preventDefault();
  const f = e.target;
  const clienta = f.clienta.value.trim();
  const monto = parseFloat(f.monto.value);
  if (!clienta || isNaN(monto) || monto <= 0) {   // validación (US6)
    avisar('Falta la clienta o un monto válido.');
    return;
  }
  const boton = f.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    await Datos.agregarFiado({ clienta, descripcion: f.descripcion.value.trim(), monto });
    f.reset();
    await cargarFiados();
  } catch (error) {
    avisar('No se pudo guardar el fiado: ' + error.message);
  } finally {
    boton.disabled = false;
  }
}

async function abonar(id) {                        // registrar abono (US8)
  const fi = fiados.find(x => x.id === id);
  if (!fi) return;
  const m = parseFloat(prompt(`Saldo de ${fi.clienta}: ${fmt(fi.saldo)}\n¿Cuánto abona?`, ''));
  if (!m || m <= 0) return;
  if (m > fi.saldo) { avisar('El abono no puede ser mayor al saldo.'); return; }
  try {
    await Datos.abonar(id, m);
    await cargarFiados();
  } catch (error) {
    avisar('No se pudo registrar el abono: ' + error.message);
  }
}

async function cargarFiados() {
  try {
    fiados = await Datos.fiados();
  } catch (error) {
    avisar('No se pudieron leer los fiados: ' + error.message);
    return;
  }
  renderFiados();
}

function renderFiados() {
  const q = (document.getElementById('buscarFiado').value || '').toLowerCase();
  const lista = fiados.filter(f => (f.clienta || '').toLowerCase().includes(q));
  const cont = document.getElementById('listaFiados');
  const total = lista.reduce((a, f) => a + Number(f.saldo), 0);   // total por cobrar (US7)
  document.getElementById('totalPorCobrar').textContent = fmt(total);
  if (lista.length === 0) {
    cont.innerHTML = '<p class="vacio">Sin fiados.</p>';
    return;
  }
  cont.innerHTML = lista.map(f => {
    const pagado = Number(f.saldo) <= 0;             // se marca pagado (US8)
    const fecha = new Date(f.fecha).toLocaleDateString('es-HN');
    return `<div class="card ${pagado ? 'pagado' : ''}">
      <div class="card-top">
        <strong>${f.clienta}</strong>
        <span class="pill ${pagado ? 'pill-verde' : 'pill-rojo'}">${pagado ? 'PAGADO' : fmt(f.saldo)}</span>
      </div>
      <div class="muted">${f.descripcion || '—'} · ${fecha} · debía ${fmt(f.total)}</div>
      ${pagado ? '' : `<button class="mini" onclick="abonar('${f.id}')">Registrar abono</button>`}
    </div>`;
  }).join('');
}

/* ===== Resumen (US9) ===== */
function renderResumen() {
  const porCobrar = fiados.reduce((a, f) => a + Number(f.saldo), 0);
  const bajoStock = productos.filter(p => p.stock <= p.stock_minimo).length;
  const valorInv = productos.reduce((a, p) => a + p.stock * Number(p.costo), 0);
  document.getElementById('rPorCobrar').textContent = fmt(porCobrar);
  document.getElementById('rBajoStock').textContent = bajoStock;
  document.getElementById('rValorInv').textContent = fmt(valorInv);
  document.getElementById('rProductos').textContent = productos.length;
}

/* ===== Inicio ===== */
document.addEventListener('DOMContentLoaded', async () => {
  sesion = await exigirSesion();
  if (!sesion) return;                          // sin sesión ya se fue a login.html

  document.getElementById('saludo').textContent = `Hola, ${Sesion.nombreDe(sesion)} · YCC Beauty Studio`;
  document.getElementById('formProducto').addEventListener('submit', addProducto);
  document.getElementById('formFiado').addEventListener('submit', addFiado);
  document.getElementById('buscarProd').addEventListener('input', renderProductos);
  document.getElementById('buscarFiado').addEventListener('input', renderFiados);

  await Promise.all([cargarProductos(), cargarFiados()]);
});

/* PWA: registra el service worker solo cuando se sirve por http(s) */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
