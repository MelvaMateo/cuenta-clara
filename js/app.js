/* Cuenta Clara — cajas, stock, fiados y resumen.
   Los datos viven en Supabase (ver datos.js); esta capa es solo la pantalla. */

/* ===== Sesión (ver sesion.js) ===== */
let sesion = null;

async function salir() {
  await Sesion.cerrar();
  location.replace('login.html');
}

const fmt = n => 'L ' + Number(n).toFixed(2);
const usd = n => '$' + Number(n).toFixed(2);
const pct = n => Math.round(Number(n) * 100) + '%';
const pct1 = n => (Math.round(Number(n) * 1000) / 10) + '%';     // 0.025 → "2.5%"
const monto = (v, moneda) => (moneda === 'USD' ? usd(v) : fmt(v));

/* Copia en memoria de lo último que devolvió la base. */
let cajas = [];
let productos = [];
let fiados = [];
let fotoPendiente = null;                       // ruta en Storage de la foto ya subida

/* Traduce los errores de Supabase a algo que diga qué hacer. Un mensaje como
   "relation public.productos does not exist" no le sirve a nadie. */
function mensajeDe(error) {
  const codigo = error.code || '';
  /* Va primero: su mensaje también dice "schema cache" y se confundiría con
     que faltan las tablas, cuando lo que falta es correr la migración. */
  if (codigo === 'PGRST204' || /column .* does not exist/i.test(error.message)) {
    return 'La base tiene el esquema anterior: corré sql/03_monedas_y_colchon.sql y después sql/01_esquema.sql.';
  }
  if (codigo === '42P01' || codigo === 'PGRST205' || /schema cache|does not exist/i.test(error.message)) {
    return 'Faltan las tablas en Supabase: corré sql/01_esquema.sql en el SQL Editor.';
  }
  if (codigo === '42883' || codigo === 'PGRST202') {
    return 'Falta la función vender_producto: corré sql/01_esquema.sql en el SQL Editor.';
  }
  if (codigo === '42501') return 'La base rechazó la operación por permisos (RLS).';
  if (/bucket not found/i.test(error.message)) {
    return 'Falta el bucket de fotos: corré sql/01_esquema.sql en el SQL Editor.';
  }
  if (/failed to fetch|networkerror/i.test(error.message)) return 'Sin conexión con Supabase.';
  return error.message;
}

function avisar(msg) {
  const caja = document.getElementById('aviso');
  caja.textContent = msg;
  caja.classList.add('visible');
  clearTimeout(avisar._t);
  avisar._t = setTimeout(() => caja.classList.remove('visible'), 7000);
}

/* ===== Navegación por pestañas ===== */
function showTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tabbtn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelector(`[data-tab="${id}"]`).classList.add('active');
  if (id === 'resumen') renderResumen();
}

/* ============================ Cajas ============================ */

async function addCaja(e) {
  e.preventDefault();
  const f = e.target;
  const descripcion = f.descripcion.value.trim();
  const tipoCambio = parseFloat(f.tipoCambio.value);
  if (!descripcion || !(tipoCambio > 0)) {
    avisar('Falta el nombre de la caja o el tipo de cambio.');
    return;
  }
  const colchon = parseFloat(f.colchon.value) || 0;
  if (colchon < 0 || colchon > 50) {
    avisar('El colchón tiene que estar entre 0 y 50%.');
    return;
  }
  const boton = f.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    await Datos.agregarCaja({
      descripcion,
      fecha: f.fecha.value || null,
      lote: parseFloat(f.lote.value) || 0,
      loteMoneda: f.loteMoneda.value,
      flete: parseFloat(f.flete.value) || 0,
      fleteMoneda: f.fleteMoneda.value,
      aduana: parseFloat(f.aduana.value) || 0,
      aduanaMoneda: f.aduanaMoneda.value,
      otros: parseFloat(f.otros.value) || 0,
      otrosMoneda: f.otrosMoneda.value,
      tipoCambio,
      margen: (parseFloat(f.margen.value) || 0) / 100,
      colchon: colchon / 100,
    });
    f.reset();                                   // vuelve a 40% de ganancia y 3% de colchón
    await cargarCajas();
  } catch (error) {
    avisar('No se pudo guardar la caja: ' + mensajeDe(error));
  } finally {
    boton.disabled = false;
  }
}

async function cargarCajas() {
  try {
    cajas = await Datos.cajas();
  } catch (error) {
    avisar('No se pudieron leer las cajas: ' + mensajeDe(error));
    return;
  }
  renderCajas();
  llenarSelectCajas();
}

function renderCajas() {
  const cont = document.getElementById('listaCajas');
  if (cajas.length === 0) {
    cont.innerHTML = '<p class="vacio">Todavía no registraste ninguna caja.</p>';
    return;
  }
  cont.innerHTML = cajas.map(c => {
    const invertido = Number(c.invertido);
    const vendido = Number(c.vendido);
    const recuperado = invertido > 0 ? Math.min(vendido / invertido, 1) : 0;
    const ganancia = Number(c.ganancia_proyectada);
    const listo = vendido >= invertido;
    const encarece = Math.round((Number(c.factor) - 1) * 100);

    return `<div class="caja-card ${listo ? 'recuperada' : ''}">
      <div class="card-top">
        <strong>${c.descripcion}</strong>
        <span class="muted">${new Date(c.fecha + 'T12:00:00').toLocaleDateString('es-HN')}</span>
      </div>

      <div class="costos">
        <div><span>Lote</span><b>${monto(c.lote, c.lote_moneda)}</b></div>
        <div><span>Tiendas</span><b>${usd(c.tienda_usd)}</b></div>
        ${[['Flete', c.flete, c.flete_moneda], ['Aduana', c.aduana, c.aduana_moneda], ['Otros', c.otros, c.otros_moneda]]
          .filter(([, valor]) => Number(valor) > 0)
          .map(([nombre, valor, moneda]) => `<div><span>${nombre}</span><b>${monto(valor, moneda)}</b></div>`)
          .join('')}
        <div class="total"><span>Invertiste</span><b>${fmt(invertido)}</b></div>
      </div>
      <p class="muted tc">Dólar a ${Number(c.tipo_cambio).toFixed(2)}, guardado con esta caja</p>

      <p class="factor">Traerla te encarece la mercadería un <b>${encarece}%</b>
         — cada $1 de producto te llega costando ${usd(c.factor)}</p>

      <div class="colchon">
        <span>Colchón por el dólar: <b>${pct1(c.colchon)}</b></span>
        <button class="mini secundario" onclick="cambiarColchon('${c.id}')">Cambiar</button>
      </div>

      <div class="barra"><i style="width:${(recuperado * 100).toFixed(0)}%"></i></div>
      <p class="muted">${pct(recuperado)} recuperado · vendido ${fmt(vendido)} de ${fmt(invertido)}</p>

      ${listo
        ? `<p class="ok-msg">Ya recuperaste esta caja. Todo lo que vendas de acá en
             adelante es ganancia.</p>`
        : `<p class="pendiente">Te faltan <b>${fmt(c.falta_recuperar)}</b> para recuperar lo que invertiste.</p>`}

      <div class="proyeccion ${ganancia >= 0 ? '' : 'mala'}">
        Si vendés todo a los precios que pusiste:
        <b>${ganancia >= 0 ? 'ganás ' : 'perdés '}${fmt(Math.abs(ganancia))}</b>
        ${invertido > 0 ? `(${Math.round(ganancia / invertido * 100)}%)` : ''}
      </div>

      <div class="muted">${c.productos} productos · ${c.unidades} unidades · quedan ${c.en_stock}</div>
    </div>`;
  }).join('');
}

/* El colchón sube los precios sugeridos de lo pagado en dólares, por si el
   dólar está más caro cuando toque reponer. No toca el costo ni los precios
   que ya puso: esos los cambia ella, producto por producto. */
async function cambiarColchon(id) {
  const c = cajas.find(x => x.id === id);
  if (!c) return;
  const texto = prompt(
    `${c.descripcion}\n\nColchón por el dólar, en %.\n` +
    `Sube los precios sugeridos por si el dólar está más caro cuando vuelvas a comprar.\n` +
    `No cambia lo que te costó la caja ni los precios que ya pusiste.`,
    String(Math.round(Number(c.colchon) * 1000) / 10));
  if (texto === null) return;
  const valor = parseFloat(texto.replace(',', '.'));
  if (!(valor >= 0 && valor <= 50)) { avisar('El colchón tiene que estar entre 0 y 50%.'); return; }
  try {
    await Datos.cambiarColchon(id, valor / 100);
    await Promise.all([cargarCajas(), cargarProductos()]);
  } catch (error) {
    avisar('No se pudo cambiar el colchón: ' + mensajeDe(error));
  }
}

function llenarSelectCajas() {
  const sel = document.getElementById('selCaja');
  const elegida = sel.value;
  sel.innerHTML = cajas.length
    ? cajas.map(c => `<option value="${c.id}">${c.descripcion}</option>`).join('')
    : '<option value="">Registrá una caja primero</option>';
  if (elegida) sel.value = elegida;
  calcularSugerido();
}

/* ============================ Inventario ============================ */

/* Precio sugerido en vivo, mientras carga el producto: es el momento en que
   decide cuánto cobrar, y hoy lo hace sin saber lo que le costó traerlo.
   Para lo del lote es aproximado y se reacomoda al cargar más productos;
   para lo de tienda es exacto. */
function calcularSugerido() {
  const caja = cajas.find(c => c.id === document.getElementById('selCaja').value);
  const origen = document.getElementById('selOrigen').value;
  const valor = parseFloat(document.getElementById('inpValor').value);
  const precio = parseFloat(document.getElementById('inpPrecio').value);
  const cont = document.getElementById('sugerencia');

  if (!caja || !(valor > 0)) { cont.className = 'sugerencia'; cont.textContent = ''; return; }

  /* El mismo cálculo que la vista productos_costeados (sql/01_esquema.sql):
     k ya viene en lempiras por dólar estimado; lo de tienda se convierte con
     el dólar de la caja. El colchón solo pesa sobre la parte pagada en dólares. */
  const base = origen === 'lote' ? valor * Number(caja.k) : valor * Number(caja.tipo_cambio);
  const costo = base * Number(caja.factor);
  const sugerido = costo * (1 + Number(caja.colchon) * Number(caja.parte_usd))
                         * (1 + Number(caja.margen_deseado));

  if (origen === 'lote' && !(Number(caja.k) > 0)) {
    cont.className = 'sugerencia';
    cont.innerHTML = `Guardá este producto y la app repartirá el costo del lote.`;
    return;
  }

  const conColchon = Number(caja.colchon) > 0 ? ` con ${pct1(caja.colchon)} de colchón` : '';
  let clase = 'sugerencia visible', msg =
    `Te cuesta <b>${fmt(costo)}</b> · para ganar ${pct(caja.margen_deseado)}${conColchon} vendelo a <b>${fmt(sugerido)}</b>`;

  if (precio > 0 && precio < costo) {
    clase += ' perdida';
    msg += `<br>⚠ A ${fmt(precio)} estarías <b>perdiendo ${fmt(costo - precio)}</b> por unidad.`;
  } else if (precio > 0 && precio < sugerido) {
    clase += ' bajo';
    msg += `<br>A ${fmt(precio)} ganás, pero menos de lo que te propusiste.`;
  }
  cont.className = clase;
  cont.innerHTML = msg;
}

/* La etiqueta del valor cambia según el origen: no es lo mismo un costo real
   que una estimación, y confundirlos arruinaría el cálculo. */
function ajustarOrigen() {
  const esLote = document.getElementById('selOrigen').value === 'lote';
  document.getElementById('lblValor').firstChild.textContent =
    esLote ? 'Valor estimado en US$ ' : 'Lo que pagaste en US$ ';
  document.getElementById('notaOrigen').textContent = esLote
    ? 'Si no sabés cuánto costó, poné lo que creés que vale. Solo importa que esté bien en proporción a los demás: el total siempre queda anclado a lo que pagaste por el lote.'
    : 'Poné el costo exacto del recibo, sin flete ni aduana: eso lo suma la app.';
  calcularSugerido();
}

async function elegirFoto(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const vista = document.getElementById('vistaFoto');
  try {
    fotoPendiente = await Datos.subirFoto(file, sesion.user.id);
    vista.src = Datos.urlFoto(fotoPendiente);
    vista.classList.add('visible');
  } catch (error) {
    fotoPendiente = null;
    avisar('No se pudo subir la foto: ' + mensajeDe(error));
  }
}

async function addProducto(e) {
  e.preventDefault();
  const f = e.target;
  const nombre = f.nombre.value.trim();
  const valorUsd = parseFloat(f.valorUsd.value);
  const cantidad = parseInt(f.cantidad.value);
  if (!f.cajaId.value) { avisar('Elegí de qué caja salió el producto.'); return; }
  if (!nombre || !(valorUsd >= 0) || !(cantidad > 0)) {
    avisar('Falta el nombre, el valor o la cantidad.');
    return;
  }
  const boton = f.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    await Datos.agregarProducto({
      cajaId: f.cajaId.value,
      nombre,
      origen: f.origen.value,
      valorUsd,
      cantidad,
      stockMinimo: parseInt(f.stockMinimo.value) || 0,
      precio: parseFloat(f.precio.value) || 0,
      fotoPath: fotoPendiente,
    });
    f.reset();
    fotoPendiente = null;
    document.getElementById('vistaFoto').classList.remove('visible');
    document.getElementById('sugerencia').className = 'sugerencia';
    await Promise.all([cargarProductos(), cargarCajas()]);   // la caja cambia al sumar producto
  } catch (error) {
    avisar('No se pudo guardar el producto: ' + mensajeDe(error));
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
    await Datos.venderProducto(id, cant);
    await Promise.all([cargarProductos(), cargarCajas()]);
  } catch (error) {
    avisar(mensajeDe(error));                   // "No hay suficiente stock"
  }
}

async function cambiarPrecio(id) {
  const p = productos.find(x => x.id === id);
  if (!p) return;
  const nuevo = parseFloat(prompt(
    `${p.nombre}\nTe cuesta ${fmt(p.costo_unitario)}\nSugerido: ${fmt(p.precio_sugerido)}\n\nNuevo precio:`,
    p.precio));
  if (!(nuevo >= 0)) return;
  try {
    await Datos.cambiarPrecio(id, nuevo);
    await Promise.all([cargarProductos(), cargarCajas()]);
  } catch (error) {
    avisar('No se pudo cambiar el precio: ' + mensajeDe(error));
  }
}

async function cargarProductos() {
  try {
    productos = await Datos.productos();
  } catch (error) {
    avisar('No se pudo leer el inventario: ' + mensajeDe(error));
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
    const bajo = p.stock <= p.stock_minimo;
    const perdida = Number(p.precio) > 0 && Number(p.precio) < Number(p.costo_unitario);
    const foto = Datos.urlFoto(p.foto_path);
    return `<div class="card ${perdida ? 'perdida' : bajo ? 'bajo' : ''}">
      <div class="card-cuerpo">
        ${foto ? `<img class="miniatura" src="${foto}" alt="">` : '<div class="miniatura vacia">📦</div>'}
        <div class="card-datos">
          <div class="card-top">
            <strong>${p.nombre}</strong>
            <span class="pill ${bajo ? 'pill-rojo' : ''}">quedan ${p.stock}${bajo ? ' !' : ''}</span>
          </div>
          <div class="muted">${p.caja} · ${p.origen === 'lote' ? 'del lote' : 'de tienda'}</div>
          <div class="precios">
            <span>Te cuesta <b>${fmt(p.costo_unitario)}</b></span>
            <span>Lo vendés a <b>${fmt(p.precio)}</b></span>
          </div>
          ${perdida
            ? `<div class="marca-perdida">⚠ Estás perdiendo ${fmt(p.costo_unitario - p.precio)} en cada uno.
                 Sugerido: ${fmt(p.precio_sugerido)}</div>`
            : `<div class="muted">Sugerido ${fmt(p.precio_sugerido)}</div>`}
        </div>
      </div>
      <div class="acciones-card">
        <button class="mini" onclick="venderProducto('${p.id}')">Vender</button>
        <button class="mini secundario" onclick="cambiarPrecio('${p.id}')">Cambiar precio</button>
      </div>
    </div>`;
  }).join('');
}

/* ============================ Fiados ============================ */

async function addFiado(e) {
  e.preventDefault();
  const f = e.target;
  const clienta = f.clienta.value.trim();
  const monto = parseFloat(f.monto.value);
  if (!clienta || isNaN(monto) || monto <= 0) {
    avisar('Falta el nombre o un monto válido.');
    return;
  }
  const boton = f.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    await Datos.agregarFiado({ clienta, descripcion: f.descripcion.value.trim(), monto });
    f.reset();
    await cargarFiados();
  } catch (error) {
    avisar('No se pudo guardar el fiado: ' + mensajeDe(error));
  } finally {
    boton.disabled = false;
  }
}

async function abonar(id) {
  const fi = fiados.find(x => x.id === id);
  if (!fi) return;
  const m = parseFloat(prompt(`Saldo de ${fi.clienta}: ${fmt(fi.saldo)}\n¿Cuánto abona?`, ''));
  if (!m || m <= 0) return;
  if (m > Number(fi.saldo)) { avisar('El abono no puede ser mayor al saldo.'); return; }
  try {
    await Datos.abonar(id, m);
    await cargarFiados();
  } catch (error) {
    avisar('No se pudo registrar el abono: ' + mensajeDe(error));
  }
}

async function cargarFiados() {
  try {
    fiados = await Datos.fiados();
  } catch (error) {
    avisar('No se pudieron leer los fiados: ' + mensajeDe(error));
    return;
  }
  renderFiados();
}

function renderFiados() {
  const q = (document.getElementById('buscarFiado').value || '').toLowerCase();
  const lista = fiados.filter(f => (f.clienta || '').toLowerCase().includes(q));
  const cont = document.getElementById('listaFiados');
  const total = lista.reduce((a, f) => a + Number(f.saldo), 0);
  document.getElementById('totalPorCobrar').textContent = fmt(total);
  if (lista.length === 0) {
    cont.innerHTML = '<p class="vacio">Sin fiados.</p>';
    return;
  }
  cont.innerHTML = lista.map(f => {
    const pagado = Number(f.saldo) <= 0;
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

/* ============================ Resumen ============================ */

function renderResumen() {
  const porCobrar = fiados.reduce((a, f) => a + Number(f.saldo), 0);
  const bajoStock = productos.filter(p => p.stock <= p.stock_minimo).length;
  /* Lo que queda por vender, a precio de venta: es lo que le importa cobrar,
     no un valor al costo. */
  const porVender = productos.reduce((a, p) => a + p.stock * Number(p.precio), 0);
  document.getElementById('rPorCobrar').textContent = fmt(porCobrar);
  document.getElementById('rBajoStock').textContent = bajoStock;
  document.getElementById('rPorVender').textContent = fmt(porVender);
  document.getElementById('rProductos').textContent = productos.length;

  const perdiendo = productos.filter(p => Number(p.precio) > 0
                                       && Number(p.precio) < Number(p.costo_unitario));
  const caja = document.getElementById('alertaPerdida');
  caja.className = perdiendo.length ? 'alerta-perdida visible' : 'alerta-perdida';
  caja.innerHTML = perdiendo.length
    ? `<b>⚠ ${perdiendo.length} producto${perdiendo.length > 1 ? 's se están' : ' se está'}
         vendiendo por debajo del costo:</b><br>${perdiendo.map(p => p.nombre).join(', ')}`
    : '';
}

/* ============================ Inicio ============================ */

document.addEventListener('DOMContentLoaded', async () => {
  sesion = await exigirSesion();
  if (!sesion) return;

  document.getElementById('saludo').textContent = `Hola, ${Sesion.nombreDe(sesion)}`;
  document.getElementById('formCaja').addEventListener('submit', addCaja);
  document.getElementById('formProducto').addEventListener('submit', addProducto);
  document.getElementById('formFiado').addEventListener('submit', addFiado);
  document.getElementById('buscarProd').addEventListener('input', renderProductos);
  document.getElementById('buscarFiado').addEventListener('input', renderFiados);
  document.getElementById('selOrigen').addEventListener('change', ajustarOrigen);
  document.getElementById('selCaja').addEventListener('change', calcularSugerido);
  document.getElementById('inpValor').addEventListener('input', calcularSugerido);
  document.getElementById('inpPrecio').addEventListener('input', calcularSugerido);
  document.getElementById('inpFoto').addEventListener('change', elegirFoto);

  await cargarCajas();
  await Promise.all([cargarProductos(), cargarFiados()]);
});

/* PWA: registra el service worker solo cuando se sirve por http(s) */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
