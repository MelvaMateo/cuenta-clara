/* Cuenta Clara — inventario, fiados y resumen.
   Datos guardados en localStorage del dispositivo (para la demostración).
   En producción esto se reemplaza por Supabase (ver PLAN.md). */

/* ===== Sesión (ver sesion.js) ===== */
const sesion = exigirSesion();

function salir() {
  Sesion.cerrar();
  location.replace('login.html');
}

const DB = {
  get(k) { return JSON.parse(localStorage.getItem(k) || '[]'); },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

const fmt = n => 'L ' + Number(n).toFixed(2);            // lempiras con 2 decimales
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ===== Navegación por pestañas ===== */
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tabbtn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelector(`[data-tab="${id}"]`).classList.add('active');
  if (id === 'resumen') renderResumen();
}

/* ===== Inventario (US1, US2, US3) ===== */
function addProducto(e) {
  e.preventDefault();
  const f = e.target;
  const nombre = f.nombre.value.trim();
  const precio = parseFloat(f.precio.value);
  if (!nombre || isNaN(precio)) {            // validación (US1)
    alert('Falta el nombre o el precio.');
    return;
  }
  const productos = DB.get('productos');
  productos.push({
    id: uid(),
    nombre,
    costo: parseFloat(f.costo.value) || 0,
    precio,
    stock: parseInt(f.stock.value) || 0,
    stockMinimo: parseInt(f.stockMinimo.value) || 0,
  });
  DB.set('productos', productos);
  f.reset();
  renderProductos();
}

function venderProducto(id) {
  const productos = DB.get('productos');
  const p = productos.find(x => x.id === id);
  if (!p) return;
  const cant = parseInt(prompt(`¿Cuántas unidades de "${p.nombre}" vendiste?`, '1'));
  if (!cant || cant <= 0) return;
  if (cant > p.stock) { alert('No hay suficiente stock.'); return; }
  p.stock -= cant;                            // descuenta del stock (US2)
  DB.set('productos', productos);
  renderProductos();
}

function renderProductos() {
  const q = (document.getElementById('buscarProd').value || '').toLowerCase();
  const productos = DB.get('productos').filter(p => p.nombre.toLowerCase().includes(q));
  const cont = document.getElementById('listaProductos');
  if (productos.length === 0) {
    cont.innerHTML = '<p class="vacio">Sin productos todavía.</p>';
    return;
  }
  cont.innerHTML = productos.map(p => {
    const bajo = p.stock <= p.stockMinimo;     // alerta de bajo stock (US3)
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
function addFiado(e) {
  e.preventDefault();
  const f = e.target;
  const clienta = f.clienta.value.trim();
  const monto = parseFloat(f.monto.value);
  if (!clienta || isNaN(monto) || monto <= 0) {   // validación (US6)
    alert('Falta la clienta o un monto válido.');
    return;
  }
  const fiados = DB.get('fiados');
  fiados.push({
    id: uid(),
    clienta,
    descripcion: f.descripcion.value.trim(),
    monto,
    fecha: new Date().toLocaleDateString(),
    abonos: [],
  });
  DB.set('fiados', fiados);
  f.reset();
  renderFiados();
}

function saldoDe(fi) {
  return fi.monto - fi.abonos.reduce((a, b) => a + b.monto, 0);
}

function abonar(id) {                              // registrar abono (US8)
  const fiados = DB.get('fiados');
  const fi = fiados.find(x => x.id === id);
  if (!fi) return;
  const saldo = saldoDe(fi);
  const m = parseFloat(prompt(`Saldo de ${fi.clienta}: ${fmt(saldo)}\n¿Cuánto abona?`, ''));
  if (!m || m <= 0) return;
  if (m > saldo) { alert('El abono no puede ser mayor al saldo.'); return; }
  fi.abonos.push({ monto: m, fecha: new Date().toLocaleDateString() });
  DB.set('fiados', fiados);
  renderFiados();
}

function renderFiados() {
  const q = (document.getElementById('buscarFiado').value || '').toLowerCase();
  const fiados = DB.get('fiados').filter(f => f.clienta.toLowerCase().includes(q));
  const cont = document.getElementById('listaFiados');
  const total = fiados.reduce((a, f) => a + saldoDe(f), 0);   // total por cobrar (US7)
  document.getElementById('totalPorCobrar').textContent = fmt(total);
  if (fiados.length === 0) {
    cont.innerHTML = '<p class="vacio">Sin fiados.</p>';
    return;
  }
  cont.innerHTML = fiados.map(f => {
    const saldo = saldoDe(f);
    const pagado = saldo <= 0;                       // se marca pagado (US8)
    return `<div class="card ${pagado ? 'pagado' : ''}">
      <div class="card-top">
        <strong>${f.clienta}</strong>
        <span class="pill ${pagado ? 'pill-verde' : 'pill-rojo'}">${pagado ? 'PAGADO' : fmt(saldo)}</span>
      </div>
      <div class="muted">${f.descripcion || '—'} · ${f.fecha} · debía ${fmt(f.monto)}</div>
      ${pagado ? '' : `<button class="mini" onclick="abonar('${f.id}')">Registrar abono</button>`}
    </div>`;
  }).join('');
}

/* ===== Resumen (US9) ===== */
function renderResumen() {
  const productos = DB.get('productos');
  const fiados = DB.get('fiados');
  const porCobrar = fiados.reduce((a, f) => a + saldoDe(f), 0);
  const bajoStock = productos.filter(p => p.stock <= p.stockMinimo).length;
  const valorInv = productos.reduce((a, p) => a + p.stock * p.costo, 0);
  document.getElementById('rPorCobrar').textContent = fmt(porCobrar);
  document.getElementById('rBajoStock').textContent = bajoStock;
  document.getElementById('rValorInv').textContent = fmt(valorInv);
  document.getElementById('rProductos').textContent = productos.length;
}

/* ===== Inicio ===== */
document.addEventListener('DOMContentLoaded', () => {
  if (sesion) document.getElementById('saludo').textContent = `Hola, ${sesion.nombre} · YCC Beauty Studio`;
  document.getElementById('formProducto').addEventListener('submit', addProducto);
  document.getElementById('formFiado').addEventListener('submit', addFiado);
  document.getElementById('buscarProd').addEventListener('input', renderProductos);
  document.getElementById('buscarFiado').addEventListener('input', renderFiados);
  renderProductos();
  renderFiados();
});

/* PWA: registra el service worker solo cuando se sirve por http(s) */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
