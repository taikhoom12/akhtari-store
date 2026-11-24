import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, runTransaction, serverTimestamp, writeBatch, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const auth = getAuth(initializeApp(firebaseConfig));
const db = getFirestore();
const EMAIL_DOMAIN = "akhtari.local";
const WORKBOOK = [
  ["Pepsi", "Soft Drink", "345 ml", 100, 78], ["Pond's Face Wash", "Cosmetics", "Face wash", 520, 410],
  ["Surf Excel", "Laundry Detergent", "1 kg", 620, 570], ["Basmati Rice", "Rice", "Best quality", 380, 330],
  ["Daal Chana", "Lentils (Daal)", "1 kg; best quality", 300, 260], ["Toothpicks", "Small Items", "100 pieces", 100, 60],
  ["Cotton Buds", "Small Items", "100 sticks", 130, 90], ["Locks", "Small Items", "Medium size", 300, 220],
  ["Tomato Sauce", "Sauces", "1 kg", 420, 370], ["Delite Room Spray", "Room Sprays", "300 ml", 260, 220],
  ["Bona Papa Diaper", "Baby Diapers", "Size XL", 1300, 1200], ["TUX Soft Pack", "Tissues", "550 sheets", 460, 360],
];

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }); // international grouping
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dmy = (s) => (s ? s.split("-").reverse().join("/") : "");

let me = null;                // signed-in staff profile
let products = [];            // active catalogue: id, name, category, pack, retail
let costs = {};               // productId -> cost (Reviewer and Admin only)
let draft = { lines: [], payment: "Cash" };
let recordsCache = [];

const isAdmin = () => me?.role === "admin";
const isReviewer = () => me?.role === "reviewer" || me?.role === "admin";

const ROUTES = {
  order:     { label: "New Sales Order", show: () => true,         render: renderOrder },
  dashboard: { label: "Dashboard",       show: () => isReviewer(), render: renderDashboard },
  records:   { label: "Sales Records",   show: () => true,         render: renderRecords },
  products:  { label: "Products",        show: () => isReviewer(), render: renderProducts },
  users:     { label: "User Management", show: () => isAdmin(),    render: renderUsers },
};
const defaultRoute = () => (isReviewer() ? "dashboard" : "order");
const currentRoute = () => { const r = location.hash.slice(1); return ROUTES[r]?.show() ? r : defaultRoute(); };

function render() {
  if (!me) return;
  const r = currentRoute();
  $("#nav").innerHTML = Object.entries(ROUTES).filter(([, v]) => v.show())
    .map(([k, v]) => `<a href="#${k}" class="${k === r ? "on" : ""}">${v.label}</a>`).join("");
  ROUTES[r].render();
}
window.addEventListener("hashchange", render);

// ---------- Login ----------
function showLogin(msg = "") {
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
  $("#loginMsg").textContent = msg;
}
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = $("#username").value.trim().toLowerCase();
  try { await signInWithEmailAndPassword(auth, `${user}@${EMAIL_DOMAIN}`, $("#password").value); }
  catch { $("#loginMsg").textContent = "Username or password is wrong."; }
});
$("#logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (!user) return showLogin();
  const snap = await getDoc(doc(db, "users", user.uid));
  const p = snap.exists() ? snap.data() : null;
  const until = p?.blockedUntil?.toDate();
  if (!p || p.active !== true) { await signOut(auth); return showLogin("This account is not set up or was removed. Ask the admin."); }
  if (until && until > new Date()) { await signOut(auth); return showLogin(`This account is blocked until ${until.toLocaleDateString("en-GB")}.`); }
  me = { uid: user.uid, ...p };
  $("#who").textContent = `${me.name} (${me.initial}), ${me.role}`;
  await loadCatalogue();
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  if (!location.hash) location.hash = defaultRoute();
  render();
});

// ---------- Data loading ----------
async function loadCatalogue() {
  const snap = await getDocs(collection(db, "products"));
  products = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
  await loadCosts();
}
async function loadCosts() {
  costs = {};
  if (!isReviewer()) return;                 // Entry users never read costs
  (await getDocs(collection(db, "productCosts"))).forEach((d) => (costs[d.id] = d.data().cost));
}

// ---------- New Sales Order ----------
function renderOrder() {
  $("#view").innerHTML = `
    <h1>New Sales Order</h1>
    <section class="card grid4">
      <label>Date<input value="${dmy(ymd())}" disabled></label>
      <label>Entered by<input value="${esc(me.initial)} (${esc(me.name)})" disabled></label>
      <label>Customer name (optional)<input id="cName"></label>
      <label>Customer phone (optional)<input id="cPhone"></label>
    </section>
    <section class="card">
      <h2>Add product</h2>
      <div class="addrow">
        <label class="grow">Product<select id="pSel"><option value="">Select product and pack</option>
          ${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.pack)})</option>`).join("")}
        </select></label>
        <label>Quantity<input id="pQty" type="number" min="1" step="1" value="1"></label>
        <div class="fixed"><span class="muted">Fixed price (PKR)</span><strong id="pPrice">0</strong></div>
        <button id="addLine" class="btn primary">+ Add</button>
      </div>
    </section>
    <section class="card"><h2>Order lines</h2><div class="tablewrap" id="lines"></div></section>
    <section class="card grid3">
      <div><h2>Payment</h2>
        <label class="inline"><input type="radio" name="pay" value="Cash" checked> Cash</label>
        <label class="inline"><input type="radio" name="pay" value="Bank"> Bank</label>
      </div>
      <div><h2>Charges / tax (optional)</h2>
        <label class="inline"><input type="checkbox" id="chkCharge"> Add charge or tax</label>
        <div id="chargeBox" class="hidden">
          <label>Label<input id="chLabel" placeholder="e.g. GST, Delivery"></label>
          <label>Amount (PKR)<input id="chAmount" type="number" min="0" step="0.01"></label>
        </div>
      </div>
      <div><h2>Totals</h2><div id="totals"></div></div>
    </section>
    <div class="actions">
      <button id="clearOrder" class="btn">Clear form</button>
      <button id="saveOrder" class="btn primary">Save SO</button>
      <button id="savePrint" class="btn">Save and print</button>
    </div>`;

  $("#pSel").onchange = () => ($("#pPrice").textContent = money(products.find((p) => p.id === $("#pSel").value)?.retail));
  $("#addLine").onclick = addLine;
  $("#chkCharge").onchange = (e) => { $("#chargeBox").classList.toggle("hidden", !e.target.checked); paint(); };
  $("#chLabel").oninput = paint;
  $("#chAmount").oninput = paint;
  document.querySelectorAll('input[name="pay"]').forEach((r) => (r.onchange = () => (draft.payment = r.value)));
  $("#clearOrder").onclick = () => { draft = { lines: [], payment: "Cash" }; renderOrder(); };
  $("#saveOrder").onclick = () => saveOrder(false);
  $("#savePrint").onclick = () => saveOrder(true);
  $("#lines").onclick = (e) => { const i = e.target.dataset.rm; if (i !== undefined) { draft.lines.splice(Number(i), 1); paint(); } };
  paint();
}

function addLine() {
  const p = products.find((x) => x.id === $("#pSel").value);
  const qty = Math.floor(Number($("#pQty").value));
  if (!p) return alert("Select a product.");
  if (!(qty > 0)) return alert("Enter a quantity of 1 or more.");
  draft.lines.push({ productId: p.id, name: p.name, pack: p.pack, qty, unitPrice: p.retail, lineTotal: qty * p.retail });
  $("#pSel").value = ""; $("#pQty").value = 1; $("#pPrice").textContent = "0";
  paint();
}

function totals() {
  const subtotal = draft.lines.reduce((s, l) => s + l.lineTotal, 0);
  const qty = draft.lines.reduce((s, l) => s + l.qty, 0);
  const on = $("#chkCharge")?.checked;
  const chargeAmount = on ? Number($("#chAmount").value) || 0 : 0;
  const chargeLabel = on ? $("#chLabel").value.trim() : "";
  return { subtotal, qty, chargeAmount, chargeLabel, grandTotal: subtotal + chargeAmount };
}

function paint() {
  const t = totals();
  $("#lines").innerHTML = draft.lines.length
    ? `<table><thead><tr><th>#</th><th>Product</th><th>Pack</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Subtotal</th><th></th></tr></thead><tbody>
       ${draft.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td>${esc(l.pack)}</td><td class="r">${l.qty}</td><td class="r">${money(l.unitPrice)}</td><td class="r">${money(l.lineTotal)}</td><td><button class="btn small danger" data-rm="${i}">Remove</button></td></tr>`).join("")}
       </tbody></table>`
    : `<p class="muted">No products added yet.</p>`;
  $("#totals").innerHTML = `<table>
    <tr><td>Total quantity</td><td class="r">${t.qty}</td></tr>
    <tr><td>Subtotal</td><td class="r">${money(t.subtotal)}</td></tr>
    ${t.chargeAmount ? `<tr><td>${esc(t.chargeLabel || "Charge / tax")}</td><td class="r">${money(t.chargeAmount)}</td></tr>` : ""}
    <tr class="grand"><td>Grand total (PKR)</td><td class="r">${money(t.grandTotal)}</td></tr></table>`;
}

async function nextSoNumber() {
  const ref = doc(db, "counters", "salesOrder");
  const n = await runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    const next = (s.exists() ? s.data().last : 0) + 1;
    tx.set(ref, { last: next });
    return next;
  });
  return `SO-${String(n).padStart(4, "0")}`;
}

async function saveOrder(print) {
  if (!draft.lines.length) return alert("Add at least one product before saving.");
  const t = totals();
  const day = ymd();
  const order = {
    soNo: await nextSoNumber(), day, month: day.slice(0, 7), year: day.slice(0, 4),
    createdBy: me.uid, createdByInitial: me.initial, createdByName: me.name,
    customerName: $("#cName").value.trim(), customerPhone: $("#cPhone").value.trim(),
    payment: draft.payment, lines: draft.lines, totalQty: t.qty, subtotal: t.subtotal,
    chargeLabel: t.chargeLabel, chargeAmount: t.chargeAmount, grandTotal: t.grandTotal,
    createdAt: serverTimestamp(),
  };
  try { await setDoc(doc(db, "orders", order.soNo), order); }
  catch (err) { return alert("Could not save the order: " + err.message); }
  const saved = { ...order, createdAt: new Date() };
  alert(`Saved ${order.soNo}.`);
  renderOrder();
  if (print) printOrder(saved);
}

// ---------- Printable Sales Order (no cost or profit) ----------
function orderDocHtml(o) {
  return `<div class="doc">
    <div class="doc-head"><strong>AL AKHTARI GENERAL STORE</strong><div>SALES ORDER</div></div>
    <div class="doc-meta">
      <span><b>SO no.:</b> ${esc(o.soNo)}</span><span><b>Date:</b> ${dmy(o.day)}</span>
      <span><b>Entered by:</b> ${esc(o.createdByInitial)} (${esc(o.createdByName)})</span>
      <span><b>Customer:</b> ${esc(o.customerName) || "-"}</span><span><b>Phone:</b> ${esc(o.customerPhone) || "-"}</span>
      <span><b>Payment:</b> ${esc(o.payment)}</span></div>
    <table><thead><tr><th>#</th><th>Product</th><th>Pack / variant</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Line total</th></tr></thead>
    <tbody>${o.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td>${esc(l.pack)}</td><td class="r">${l.qty}</td><td class="r">${money(l.unitPrice)}</td><td class="r">${money(l.lineTotal)}</td></tr>`).join("")}</tbody></table>
    <table class="totals" style="margin-top:10px">
      <tr><td>Total quantity</td><td class="r">${o.totalQty}</td></tr>
      <tr><td>Subtotal</td><td class="r">${money(o.subtotal)}</td></tr>
      ${o.chargeAmount ? `<tr><td>${esc(o.chargeLabel) || "Charge / tax"}</td><td class="r">${money(o.chargeAmount)}</td></tr>` : ""}
      <tr class="grand"><td>Grand total (PKR)</td><td class="r">${money(o.grandTotal)}</td></tr></table></div>`;
}
function printOrder(o) { $("#print").innerHTML = orderDocHtml(o); window.print(); }

// ---------- Sales Records ----------
async function renderRecords() {
  $("#view").innerHTML = `
    <h1>Sales Records</h1>
    <section class="card filters">
      <label>Date<input type="date" id="rDate" value="${ymd()}"></label>
      <label>Search SO number<input id="rSearch" placeholder="e.g. SO-0003"></label>
    </section>
    <section class="card tablewrap" id="rList"><p class="muted">Loading...</p></section>
    <section class="card" id="rDetail"><p class="muted">Select an order to see its details.</p></section>`;
  $("#rDate").onchange = loadRecords;
  $("#rSearch").oninput = showRecords;
  await loadRecords();
}

async function loadRecords() {
  const cons = [where("day", "==", $("#rDate").value)];
  if (!isReviewer()) cons.push(where("createdBy", "==", me.uid));   // Entry: own orders only
  recordsCache = (await getDocs(query(collection(db, "orders"), ...cons))).docs.map((d) => d.data())
    .sort((a, b) => a.soNo.localeCompare(b.soNo));
  showRecords();
}

function showRecords() {
  const q = $("#rSearch").value.trim().toUpperCase();
  const rows = recordsCache.filter((o) => !q || o.soNo.includes(q));
  $("#rList").innerHTML = rows.length
    ? `<table><thead><tr><th>SO no.</th><th>Customer</th><th>By</th><th>Payment</th><th class="r">Total (PKR)</th><th></th></tr></thead><tbody>
       ${rows.map((o) => `<tr><td>${esc(o.soNo)}</td><td>${esc(o.customerName) || "-"}</td><td>${esc(o.createdByInitial)}</td><td>${esc(o.payment)}</td><td class="r">${money(o.grandTotal)}</td><td><button class="btn small" data-so="${esc(o.soNo)}">View</button></td></tr>`).join("")}
       </tbody></table>
       <p class="muted">${rows.length} order(s). Total: PKR ${money(rows.reduce((s, o) => s + o.grandTotal, 0))}</p>`
    : `<p class="muted">No orders for this date.</p>`;
  $("#rList").onclick = (e) => {
    const so = e.target.dataset.so;
    if (so) { const o = recordsCache.find((x) => x.soNo === so); $("#rDetail").innerHTML = orderDocHtml(o) + `<div class="actions"><button id="printSo" class="btn primary">Print SO</button></div>`; $("#printSo").onclick = () => printOrder(o); }
  };
}

// ---------- Dashboard (Reviewer and Admin) ----------
async function renderDashboard() {
  $("#view").innerHTML = `<h1>Dashboard</h1><div class="cards" id="cards"><p class="muted">Loading...</p></div>
    <section class="card"><h2>Top-selling products (this month)</h2><div id="top"></div></section>`;
  const day = ymd(), month = day.slice(0, 7), year = day.slice(0, 4);
  const load = async (name, field, value) => (await getDocs(query(collection(db, name), where(field, "==", value)))).docs.map((d) => d.data());
  const [dO, mO, yO, dP, mP, yP] = await Promise.all([
    load("orders", "day", day), load("orders", "month", month), load("orders", "year", year),
    load("orderProfit", "day", day), load("orderProfit", "month", month), load("orderProfit", "year", year),
  ]);
  const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const stats = [
    ["Today's sales", `PKR ${money(sum(dO, "grandTotal"))}`], ["Orders today", dO.length],
    ["Today's profit", `PKR ${money(sum(dP, "totalProfit"))}`],
    ["Monthly sales", `PKR ${money(sum(mO, "grandTotal"))}`], ["Monthly profit", `PKR ${money(sum(mP, "totalProfit"))}`],
    ["Yearly sales", `PKR ${money(sum(yO, "grandTotal"))}`], ["Yearly profit", `PKR ${money(sum(yP, "totalProfit"))}`],
  ];
  $("#cards").innerHTML = stats.map(([l, v]) => `<div class="stat"><span class="label">${l}</span><strong>${v}</strong></div>`).join("");

  const qty = {};
  mO.forEach((o) => o.lines.forEach((l) => { const k = `${l.name} (${l.pack})`; qty[k] = (qty[k] || 0) + l.qty; }));
  const top = Object.entries(qty).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("#top").innerHTML = top.length
    ? `<table><thead><tr><th>Product</th><th class="r">Qty sold</th></tr></thead><tbody>${top.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${v}</td></tr>`).join("")}</tbody></table>`
    : `<p class="muted">No sales this month yet.</p>`;
}

// ---------- Products (Reviewer sees cost and profit; Admin manages) ----------
async function renderProducts() {
  await loadCosts();
  const all = (await getDocs(collection(db, "products"))).docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rows = all.map((p) => {
    const cost = costs[p.id] ?? 0;
    return `<tr class="${p.active === false ? "inactive" : ""}"><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${esc(p.pack)}</td>
      <td class="r">${money(p.retail)}</td><td class="r">${money(cost)}</td><td class="r">${money(p.retail - cost)}</td>
      <td>${p.active === false ? "Inactive" : "Active"}</td>
      ${isAdmin() ? `<td><button class="btn small" data-toggle="${esc(p.id)}">${p.active === false ? "Activate" : "Deactivate"}</button></td>` : ""}</tr>`;
  }).join("");
  $("#view").innerHTML = `
    <h1>Products</h1>
    ${isAdmin() ? `<section class="card"><h2>Add product</h2>
      <div class="addrow">
        <label class="grow">Product name<input id="nName"></label>
        <label>Category<input id="nCat"></label>
        <label>Pack / variant<input id="nPack"></label>
        <label>Retail price (PKR)<input id="nRetail" type="number" min="0"></label>
        <label>Cost price (PKR)<input id="nCost" type="number" min="0"></label>
        <button id="addProduct" class="btn primary">Add product</button>
      </div>
      ${all.length ? "" : `<button id="seed" class="btn">Load the 12 products from the workbook</button>`}
    </section>` : ""}
    <section class="card tablewrap" id="pList"><table>
      <thead><tr><th>Product</th><th>Category</th><th>Pack / variant</th><th class="r">Retail (PKR)</th><th class="r">Cost (PKR)</th><th class="r">Profit (PKR)</th><th>Status</th>${isAdmin() ? "<th></th>" : ""}</tr></thead>
      <tbody>${rows}</tbody></table></section>`;

  if (isAdmin()) {
    $("#addProduct").onclick = addProduct;
    $("#seed")?.addEventListener("click", seedCatalogue);
    $("#pList").onclick = async (e) => {
      const id = e.target.dataset.toggle;
      if (!id) return;
      const p = all.find((x) => x.id === id);
      await updateDoc(doc(db, "products", id), { active: p.active === false });
      await loadCatalogue();
      renderProducts();
    };
  }
}

async function addProduct() {
  const name = $("#nName").value.trim(), category = $("#nCat").value.trim(), pack = $("#nPack").value.trim();
  const retail = Number($("#nRetail").value), cost = Number($("#nCost").value);
  if (!name || !(retail >= 0) || !(cost >= 0)) return alert("Enter a product name, retail price and cost price.");
  const id = `P${Date.now()}`;
  const batch = writeBatch(db);
  batch.set(doc(db, "products", id), { name, category, pack, retail, active: true });
  batch.set(doc(db, "productCosts", id), { cost });
  await batch.commit();
  await loadCatalogue();
  renderProducts();
}

async function seedCatalogue() {
  if (!confirm("Load the 12 products from the workbook?")) return;
  const batch = writeBatch(db);
  WORKBOOK.forEach(([name, category, pack, retail, cost], i) => {
    const id = `WB${String(i + 1).padStart(3, "0")}`;
    batch.set(doc(db, "products", id), { name, category, pack, retail, active: true });
    batch.set(doc(db, "productCosts", id), { cost });
  });
  await batch.commit();
  await loadCatalogue();
  renderProducts();
}

// ---------- User Management (Admin only) ----------
const userStatus = (u) => {
  const until = u.blockedUntil?.toDate();
  if (u.active !== true) return "Removed";
  if (until && until > new Date()) return `Blocked until ${until.toLocaleDateString("en-GB")}`;
  return "Active";
};

async function renderUsers() {
  const users = (await getDocs(collection(db, "users"))).docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rows = users.map((u) => `<tr>
      <td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc(u.initial)}</td>
      <td><select data-role="${esc(u.uid)}">${["entry", "reviewer", "admin"].map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
      <td>${userStatus(u)}</td>
      <td><input type="number" min="1" value="1" id="days-${esc(u.uid)}" style="width:70px;display:inline-block"> days
        <button class="btn small" data-block="${esc(u.uid)}">Block</button>
        <button class="btn small" data-unblock="${esc(u.uid)}">Unblock</button>
        <button class="btn small danger" data-remove="${esc(u.uid)}">Remove</button></td></tr>`).join("");
  $("#view").innerHTML = `
    <h1>User Management</h1>
    <section class="card"><h2>Add staff member</h2>
      <p class="muted">First create the login in Firebase Console > Authentication > Add user, using email username@${EMAIL_DOMAIN}. Then paste that user's UID here.</p>
      <div class="addrow">
        <label class="grow">User UID<input id="uUid"></label>
        <label>Username (login)<input id="uName"></label>
        <label>Full name<input id="uFull"></label>
        <label>Initial<input id="uInit" maxlength="2"></label>
        <label>Role<select id="uRole"><option value="entry">Entry</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select></label>
        <button id="addUser" class="btn primary">Save user</button>
      </div></section>
    <section class="card tablewrap" id="uList"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Initial</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody></table></section>`;

  $("#addUser").onclick = async () => {
    const uid = $("#uUid").value.trim(), username = $("#uName").value.trim().toLowerCase();
    const name = $("#uFull").value.trim(), initial = $("#uInit").value.trim().toUpperCase();
    if (!uid || !username || !name || !initial) return alert("Fill in UID, username, full name and initial.");
    await setDoc(doc(db, "users", uid), { username, name, initial, role: $("#uRole").value, active: true, blockedUntil: null });
    renderUsers();
  };
  $("#uList").onchange = async (e) => {
    const uid = e.target.dataset.role;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid), { role: e.target.value });
    renderUsers();
  };
  $("#uList").onclick = async (e) => {
    const t = e.target.dataset;
    if (t.block) {
      const days = Number($(`#days-${t.block}`).value);
      if (!(days > 0)) return alert("Enter the number of days.");
      await updateDoc(doc(db, "users", t.block), { blockedUntil: Timestamp.fromDate(new Date(Date.now() + days * 86400000)) });
    } else if (t.unblock) {
      await updateDoc(doc(db, "users", t.unblock), { blockedUntil: null });
    } else if (t.remove) {
      if (t.remove === me.uid) return alert("You cannot remove your own account.");
      if (!confirm("Remove this user's access? Their past orders are kept.")) return;
      await updateDoc(doc(db, "users", t.remove), { active: false });
    } else return;
    renderUsers();
  };
}
