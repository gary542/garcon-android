if (!Object.fromEntries) Object.fromEntries = (entries) => {
  const obj = {};
  for (const [k, v] of entries) obj[k] = v;
  return obj;
};
if (!Array.prototype.at) Array.prototype.at = function(i) {
  return this[i < 0 ? this.length + i : i];
};
if (!window.structuredClone) window.structuredClone = (value) => JSON.parse(JSON.stringify(value));
const onHost = Mobile.hosting();
let needsSetup = false;
let nextRequest = 0;
const waiting = /* @__PURE__ */ new Map();
window.cafeResult = (id, envelope) => {
  const callback = waiting.get(id);
  if (callback) {
    waiting.delete(id);
    callback(envelope);
  }
};
function callCafe(path, data) {
  return new Promise((resolve, reject) => {
    const id = ++nextRequest;
    const timeout = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("Host timeout"));
    }, 1e5);
    waiting.set(id, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    Mobile.request(id, path, JSON.stringify(data));
  });
}
const $ = (s) => document.querySelector(s), app = $("#app"), modal = $("#modal");
const esc = (v) => String(v != null ? v : "").replace(
  /[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
);
const money = (n) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
  n / 100
);
let focusTable = false;
let state, actor, today, page = "orders", table = null, menuFilter = "all", search = "", setupTab = "team", authTab = "owner", paired = { team: false, slots: null }, events, connected = false, busy = false, drafts = {}, pending = null, selectedImage = "", storageOK = true;
let toastTimer, renderTimer, authGeneration = 0, deferredRender = false;
const LOCK_KEY = "garcon:locked";
let locallyLocked = false;
try {
  locallyLocked = localStorage.getItem(LOCK_KEY) === "true" || sessionStorage.getItem(LOCK_KEY) === "true";
  localStorage.setItem("garcon:storage-probe", "1");
  localStorage.removeItem("garcon:storage-probe");
} catch {
  storageOK = false;
  locallyLocked = true;
}
function lockLocal() {
  locallyLocked = true;
  authGeneration++;
  try {
    localStorage.setItem(LOCK_KEY, "true");
  } catch {
  }
  try {
    sessionStorage.setItem(LOCK_KEY, "true");
  } catch {
  }
  events == null ? void 0 : events.close();
  actor = null;
  state = null;
  drafts = {};
  pending = null;
  busy = false;
  paired = { team: false, slots: null };
  modal.close();
  auth();
}
async function finishLogout() {
  await api("logout", {});
  locallyLocked = false;
  try {
    localStorage.removeItem(LOCK_KEY);
  } catch {
  }
  try {
    sessionStorage.removeItem(LOCK_KEY);
  } catch {
  }
}
const uid = () => Mobile.uuid();
const key = () => `garcon:${actor.cafe}:${actor.id}`;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").className = "show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").className = "", 5500);
}
function save() {
  try {
    localStorage.setItem(key(), JSON.stringify({ drafts, pending }));
    storageOK = true;
  } catch {
    storageOK = false;
    toast(
      "Device storage is full or unavailable. Do not close this page with an unsent order."
    );
  }
}
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(key()) || "{}");
    drafts = saved.drafts || {};
    pending = saved.pending || null;
    for (const draft of Object.values(drafts)) draft.id || (draft.id = uid());
  } catch {
    drafts = {};
    pending = null;
    storageOK = false;
  }
}
async function api(path, data) {
  let envelope;
  const form = ["setup", "login", "team-login"].includes(path) ? document.querySelector("form[data-form='" + path + "']") : null;
  const submit = form && form.querySelector("button:not([type=button])");
  const original = submit && submit.textContent;
  if (submit) {
    submit.disabled = true;
    submit.textContent = path === "setup" ? "Creating caf\xE9\u2026" : "Signing in\u2026";
  }
  try {
    envelope = await callCafe(path, data || null);
  } catch (_) {
    connected = false;
    connection();
    throw new Error("Caf\xE9 host unavailable. Reconnect to its Wi-Fi and retry.");
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = original;
    }
  }
  if (envelope.status >= 400) {
    if (envelope.status === 503) {
      connected = false;
      connection();
    }
    const error = new Error(envelope.data.error || "Request failed.");
    error.status = envelope.status;
    throw error;
  }
  return envelope.data;
}
function connection() {
  const el = $("#connection");
  if (el) {
    el.textContent = connected ? "\u25CF Connected" : "\u25CF Reconnecting \xB7 orders need confirmation";
    el.className = "connection" + (connected ? "" : " offline");
  }
}
function allowed() {
  return (actor == null ? void 0 : actor.role) === "Owner";
}
function orderAllowed() {
  return actor && ["Owner", "Waiter"].includes(actor.role);
}
const waiterPays = () => {
  var _a;
  return ((_a = state == null ? void 0 : state.slots) == null ? void 0 : _a.Cashier) === 0;
};
function tillAllowed() {
  return actor && (["Owner", "Cashier"].includes(actor.role) || actor.role === "Waiter" && waiterPays());
}
const roleNames = {
  Waiter: "Waitress / Waiter",
  Chef: "Kitchen",
  Cashier: "Cashier",
  Owner: "Owner"
};
const roleName = (role) => roleNames[role] || role;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const btn = (label, action, attrs = "", className = "") => `<button type="button" data-action="${action}" ${attrs} class="${className}">${label}</button>`;
const brand = () => '<div class="brand"><img src="/assets/garcon-logo.png?v=agentengines-03" alt="Gar\xE7on, By AgentEngines \u2014 robot chef with tray and roller skates"></div>';
const field = (label, name, value = "", type = "text", extra = "") => `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const empty = (message) => `<div class="empty"><div class="mascot" role="img" aria-label="Gar\xE7on robot chef on roller skates"></div>${message}</div>`;
function header(title, subtitle, extra = "") {
  return `<div class="pagehead"><div><div class="eyebrow">A little less rush. A little more service.</div><h1>${title}</h1><p>${subtitle}</p></div>${extra}</div>`;
}
function showDialog(html) {
  modal.innerHTML = html;
  modal.showModal();
}
function formDialog(title, form, fields, submit = "Save") {
  showDialog(
    `<h2>${title}</h2><form data-form="${form}">${fields}<div class="form-error" role="alert"></div><div class="row">${btn("Cancel", "close")}<button class="primary" type="submit">${submit}</button></div></form>`
  );
}
function auth() {
  const byRole = ["Waiter", "Chef", "Cashier"].map((role) => {
    var _a;
    const count = ((_a = paired.slots) == null ? void 0 : _a[role]) || 0;
    if (!count) return "";
    return `<p class="eyebrow gap">${roleName(role)}</p><div class="slot-grid">${Array.from(
      { length: count },
      (_, i) => btn(
        `<strong>${i + 1}</strong>`,
        "pick-profile",
        `data-id="${role}-${i + 1}" aria-label="${roleName(role)} ${i + 1}"`,
        "slot-tile"
      )
    ).join("")}</div>`;
  }).join("");
  const teamPanel = paired.team ? `<h2 class="gap">Which role are you on?</h2><p class="muted"><small>Tap your role and a number. Numbers are not linked to a person, and two devices can share one.</small></p>${byRole}<div class="row gap">${btn("Sign out team login", "team-signout", "", "small")}</div>` : `<form data-form="team-login">${field("Business email", "email", "", "email", 'required autocomplete="username"')}${field("Team password", "password", "", "password", 'required minlength="10" maxlength="128" autocomplete="current-password"')}<button class="primary">Sign in for the team</button><div class="form-error" role="alert"></div></form><p class="muted gap"><small>The owner sets the team password in Settings \u2192 Team login.</small></p>`;
  const ownerForm = `<form data-form="${authTab === "setup" ? "setup" : "login"}">${authTab === "setup" ? field("Caf\xE9 name", "name", "", "text", 'required maxlength="100"') : ""}${field("Owner email", "email", "", "email", 'required autocomplete="username"')}${field("Password", "password", "", "password", `required minlength="12" maxlength="128" autocomplete="${authTab === "setup" ? "new-password" : "current-password"}"`)}<button class="primary">${authTab === "setup" ? "Create caf\xE9" : "Open your caf\xE9"}</button><div class="form-error" role="alert"></div></form>`;
  app.innerHTML = `<main class="auth"><section class="auth-art">${brand()}<div class="mascot" role="img" aria-label="Gar\xE7on robot with a chef hat, tray and roller skates"></div><h1>A smoother service.<br>A happier caf\xE9.</h1><p>From the first coffee to the last table.<br>Let\u2019s make the busy bits feel easy.</p></section><section class="auth-form"><div class="eyebrow">Welcome to your caf\xE9</div><h1>Ready for service?</h1><div class="tabs">${btn("Owner sign in", "auth", 'data-tab="owner"', authTab === "owner" ? "active" : "")}${btn("Team", "auth", 'data-tab="team"', authTab === "team" ? "active" : "")}${!onHost || !needsSetup ? "" : btn("Set up caf\xE9", "auth", 'data-tab="setup"', authTab === "setup" ? "active" : "")}</div>${authTab === "team" ? teamPanel : ownerForm}<p class="install-note gap">Keep all service phones on the same caf\xE9 Wi-Fi. Use the connection button above to share or change the caf\xE9 host.</p></section></main>`;
}
function render() {
  var _a;
  deferredRender = false;
  if (!actor) return auth();
  const views = [
    ["menus", "Menus"],
    ["orders", "Take Orders"],
    ["kitchen", "Kitchen"],
    ["billing", "Till"],
    ["setup", "Settings"]
  ].filter(
    ([view]) => allowed() || view === "orders" && orderAllowed() || view === "billing" && tillAllowed() || view === "kitchen" && actor.role === "Chef"
  );
  app.innerHTML = `<div class="shell"><aside class="sidebar">${brand()}<nav class="nav" aria-label="Main sections">${views.map(([v, label], i) => btn(`<span class="number" aria-hidden="true">${i + 1}</span>${label}`, "page", `data-page="${v}"`, page === v ? "active" : "")).join("")}</nav><div class="sidebar-bottom"><div class="mascot"></div><p>Take orders. Serve faster.<br>Happier customers.</p><p class="muted gap">A little help from Gar\xE7on.</p></div></aside><div><header class="topbar"><div><span class="mobile-brand"><img src="/assets/garcon-logo.png?v=agentengines-03" alt="Gar\xE7on, By AgentEngines"></span><span class="cafe-title">${esc(state.name)}</span><div id="connection" class="connection"></div></div><div class="row"><small>${esc(actor.name)}</small>${btn("Lock / switch", "logout", "", "small")}</div></header><main class="content">${!storageOK ? '<div class="notice">Local draft storage is unavailable. Keep this page open until all submissions are confirmed.</div>' : ""}${pending ? `<div class="notice"><strong>Submission awaiting confirmation.</strong> Retry safely with the same reference. ${btn("Retry submission", "retry", "", "small")}</div>` : ""}${page === "orders" ? orders() : page === "kitchen" ? kitchen() : page === "billing" ? billing() : page === "menus" ? menusView() : setup()}</main></div></div>`;
  connection();
  if (focusTable && page === "orders" && !table) (_a = $("#table-number")) == null ? void 0 : _a.focus();
  focusTable = false;
}
function activeBill(t = table) {
  return state.bills.find((b) => b.table === t && !b.closed);
}
function getDraft() {
  var _a;
  const bill = ((_a = activeBill()) == null ? void 0 : _a.id) || null;
  if (!drafts[table] || !drafts[table].lines.length && drafts[table].bill !== bill) {
    drafts[table] = { id: uid(), bill, lines: [] };
    save();
  }
  return drafts[table];
}
function orders() {
  if (!table || !state.tables.some((t2) => t2.id === table)) {
    table = null;
    return tablePicker();
  }
  const t = state.tables.find((t2) => t2.id === table), draft = getDraft(), bill = activeBill(), total = draft.lines.reduce((n, l) => n + l.price * l.quantity, 0), items = state.products.filter(
    (i) => (menuFilter === "all" || i.menu === menuFilter) && i.name.toLowerCase().includes(search.toLowerCase())
  );
  return header(
    `Table ${esc(t.label)}`,
    "Tap a favourite. Add a note. Send it to the kitchen.",
    btn("All tables", "tables", "", "small")
  ) + `<div class="order-layout"><section><div class="row between"><h2>What looks good?</h2><input class="search" id="search" type="search" placeholder="Find food or drinks\u2026" value="${esc(search)}" aria-label="Search menu"></div><div class="tabs">${btn("All menus", "menu-filter", 'data-id="all"', menuFilter === "all" ? "active" : "")}${state.menus.map((c) => btn(esc(c.name), "menu-filter", `data-id="${c.id}"`, menuFilter === c.id ? "active" : "")).join("")}</div><div class="food-grid">${items.map((i) => `<button class="food" data-action="add" data-id="${i.id}" ${!i.available || pending ? "disabled" : ""} aria-label="Add ${esc(i.name)}, ${money(i.price)}">${art(i)}<div class="food-info"><h3>${esc(i.name)}</h3><p>${esc(i.description)}</p><footer><span>${money(i.price)}</span><span class="plus">${i.available ? "+" : "\u2212"}</span></footer></div></button>`).join("") || empty(state.products.length ? "Nothing found. Try another menu." : "No products yet. The owner adds them under Menus.")}</div></section><aside class="panel bill-panel"><div class="row between"><h2>Your order</h2><span class="pill">Table ${esc(t.label)}</span></div><p class="muted gap"><small>New items \xB7 not yet sent</small></p>${draft.lines.map((l, n) => `<div class="bill-line"><div class="row between"><strong>${esc(l.name)}</strong><span>${money(l.price * l.quantity)}</span></div><div class="row between gap"><div class="qty">${btn("\u2212", "qty", `data-index="${n}" data-delta="-1" aria-label="Remove one ${esc(l.name)}" ${pending ? "disabled" : ""}`)}<span>${l.quantity}</span>${btn("+", "qty", `data-index="${n}" data-delta="1" aria-label="Add one ${esc(l.name)}" ${pending ? "disabled" : ""}`)}</div>${btn("Remove", "remove-line", `data-index="${n}" ${pending ? "disabled" : ""}`, "small danger")}</div><input data-note="${n}" value="${esc(l.note)}" maxlength="300" placeholder="Special instructions\u2026" aria-label="Instructions for ${esc(l.name)}" ${pending ? "disabled" : ""}></div>`).join("") || empty("Your next great breakfast<br>starts with a tap.")}<div class="total"><span>New items</span><strong>${money(total)}</strong></div><button class="primary wide" data-action="send" ${!draft.lines.length || pending || busy ? "disabled" : ""}>Send to kitchen \u2192</button><div class="row between gap"><small>Already sent</small><strong>${money((bill == null ? void 0 : bill.total) || 0)}</strong></div><div class="row between gap"><small>Table total with draft</small><strong>${money(total + ((bill == null ? void 0 : bill.total) || 0))}</strong></div>${bill ? btn("View running bill", "view-bill", `data-id="${bill.id}"`, "wide gap") : ""}${draft.lines.length ? btn("Discard unsent draft", "discard", pending ? "disabled" : "", "wide small gap") : ""}<p class="install-note gap">For allergy requests, speak to the kitchen directly as well as adding a note. Prices are kept only until the table is marked as paid.</p></aside></div>`;
}
const collator = new Intl.Collator("en-GB", { numeric: true });
function sortedTables() {
  return [...state.tables].sort((x, y) => collator.compare(x.label, y.label));
}
const findTable = (label) => state.tables.find(
  (t) => t.label.toLowerCase() === String(label).trim().toLowerCase()
);
function tablePicker() {
  const busy2 = sortedTables().filter(
    (t) => {
      var _a;
      return activeBill(t.id) || ((_a = drafts[t.id]) == null ? void 0 : _a.lines.length);
    }
  );
  return header(
    "Which table?",
    "Type the table number, then Open.",
    `<span class="pill">${plural(state.bills.length, "open table")}</span>`
  ) + (state.tables.length ? `<section class="panel table-entry"><form data-form="table-open" autocomplete="off"><label for="table-number">Table number</label><div class="row"><input id="table-number" name="table" type="text" inputmode="numeric" enterkeyhint="go" maxlength="24" required autofocus aria-describedby="table-error"><button type="submit" class="primary">Open</button></div><div class="form-error" id="table-error" role="alert"></div></form>${busy2.length ? `<p class="eyebrow gap">Open tables</p><div class="open-chips">${busy2.map((t) => {
    const bill = activeBill(t.id);
    return btn(
      `<strong>${esc(t.label)}</strong> ${bill ? money(bill.total) : "draft"}`,
      "table",
      `data-id="${t.id}" aria-label="Table ${esc(t.label)}, ${bill ? "open bill " + money(bill.total) : "unsent draft"}"`,
      "chip"
    );
  }).join("")}</div>` : ""}</section>` : empty("Add your caf\xE9\u2019s tables in Settings to begin."));
}
function openTable(id) {
  table = id;
  menuFilter = "all";
  search = "";
  render();
}
function art(i) {
  var _a, _b;
  if (((_a = i.image) == null ? void 0 : _a.startsWith("data:")) || ((_b = i.image) == null ? void 0 : _b.startsWith("/api/image/")))
    return `<img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy">`;
  const names = [
    "breakfast",
    "avocado",
    "pancakes",
    "bap",
    "soup",
    "coffee",
    "tea",
    "cake"
  ];
  return names.includes(i.image) ? `<div class="food-art ${i.image}" role="img" aria-label="${esc(i.name)} \u2014 sample image"></div>` : '<div class="empty">Made with care</div>';
}
function kitchen() {
  const statuses = ["New", "Preparing", "Voided"];
  return header(
    "A good service, together.",
    "Prepare the order. Once served, send it to the till.",
    `<span class="pill">${state.tickets.filter((t) => !["AtTill", "Voided"].includes(t.status)).length} outstanding</span>`
  ) + `<div class="board">${statuses.map((status) => {
    const tickets = state.tickets.filter((t) => t.status === status);
    return `<section class="board-column"><div class="board-heading"><h2>${status}</h2><span class="pill">${tickets.length}</span></div>${tickets.map((t) => {
      var _a;
      const next = { New: "Preparing", Preparing: "AtTill" }[status], can = allowed() || actor.role === "Chef";
      return `<article class="ticket ${status}"><div class="row between"><h3>Table ${esc(t.tableLabel)}</h3><small>${new Date(t.created).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</small></div><ul>${t.lines.map((l) => `<li><strong>${l.quantity - (l.voided || 0)} \xD7</strong> ${esc(l.name)}${l.voided ? `<small>${l.voided} cancelled</small>` : ""}${l.note ? `<small>${esc(l.note)}</small>` : ""}</li>`).join("")}</ul><footer>${esc(t.by)} \xB7 #${t.id.slice(0, 6)} \xB7 ${Math.max(0, Math.floor((Date.now() - new Date(t.created)) / 6e4))} min</footer>${((_a = t.corrections) == null ? void 0 : _a.length) ? `<p class="notice">Correction: ${esc(t.corrections.at(-1).reason)}</p>` : ""}${next ? btn({ Preparing: "Start preparing", AtTill: "Send to Till" }[next], "status", `data-id="${t.id}" data-status="${next}" ${!can || pending ? "disabled" : ""}`, "primary wide") : '<p class="notice">Cancelled \u2014 do not prepare or serve.</p>'}</article>`;
    }).join("") || '<p class="empty">All clear here.</p>'}</section>`;
  }).join("")}</div>`;
}
function billing() {
  const bills = state.bills;
  const paid = [...state.paid || []].reverse();
  const time = (iso) => new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });
  return header(
    "Ready at the till.",
    "See every item and the table total. Mark the table as paid once the customer has paid at your usual till."
  ) + `
 <div class="tables gap">${bills.map((b) => {
    const tickets = state.tickets.filter((t) => t.bill === b.id), ready = tickets.every((t) => ["AtTill", "Voided"].includes(t.status)), sent = tickets.some((t) => t.status === "AtTill");
    return btn(
      `<strong>Table ${esc(b.tableLabel)}</strong><span>${money(b.total)}</span><small>${ready ? waiterPays() ? "Ready to pay" : "Ready for cashier" : sent ? "More items in kitchen" : "Waiting for kitchen"}</small>`,
      "view-bill",
      `data-id="${b.id}"`,
      "table-card" + (ready ? " busy" : "")
    );
  }).join("") || empty("No tables waiting at the till.")}</div>
 <section class="panel gap"><div class="row between"><h2>Paid today</h2><span class="pill">${plural(paid.length, "table")}</span></div><p class="muted gap"><small>Gar\xE7on forgets prices and totals as soon as a table is marked as paid. This list clears at the end of the day.</small></p>${paid.map((p) => `<div class="list-row"><div><strong>Table ${esc(p.tableLabel)}</strong><small>Paid ${time(p.paidAt)} \xB7 marked by ${esc(p.paidBy)}</small></div></div>`).join("") || '<p class="muted gap">No tables paid yet today.</p>'}</section>
 <p class="install-note gap">Gar\xE7on does not take payments or keep takings. Take payment using your usual till or terminal.</p>`;
}
function billDialog(billId) {
  const bill = state.bills.find((b) => b.id === billId);
  if (!bill) throw new Error("This table has already been marked as paid.");
  const tickets = state.tickets.filter((t) => t.bill === billId);
  const ready = tickets.every((t) => ["AtTill", "Voided"].includes(t.status));
  showDialog(
    `<h2>Table ${esc(bill.tableLabel)} \xB7 running bill</h2>${tickets.map((t) => {
      var _a;
      return `<p class="eyebrow gap">${t.status === "AtTill" ? "Sent to till" : t.status} \xB7 ticket ${t.id.slice(0, 6)}</p>${t.lines.map((l) => `<div class="list-row"><span>${l.quantity - (l.voided || 0)} \xD7 ${esc(l.name)}${l.voided ? `<small>${l.voided} cancelled</small>` : ""}</span><strong>${money((l.quantity - (l.voided || 0)) * l.price)}</strong></div>`).join("")}${((_a = t.corrections) == null ? void 0 : _a.map((c) => `<p class="notice">${esc(c.by)}: ${esc(c.reason)}</p>`).join("")) || ""}${allowed() && t.status !== "Voided" ? btn("Correct items", "correct-ticket", `data-id="${t.id}"`, "small gap") : ""}`;
    }).join("")}<div class="total"><span>Total</span><strong>${money(bill.total)}</strong></div>${!ready ? '<div class="notice">The kitchen needs to send all orders to the till before this table can be marked as paid.</div>' : ""}<p class="install-note">Take payment at your usual till. Marking the table as paid deletes its items, prices and total from Gar\xE7on.</p><div class="row gap">${btn("Close", "close")}${tillAllowed() ? btn("Mark as paid", "mark-paid", `data-id="${bill.id}" data-revision="${bill.revision}" data-amount="${bill.total}" ${!ready || pending ? "disabled" : ""}`, "primary") : ""}</div>`
  );
}
function correctionDialog(ticketId) {
  const ticket = state.tickets.find((t) => t.id === ticketId), bill = state.bills.find((b) => b.id === ticket.bill);
  formDialog(
    "Correct sent items",
    "correct-ticket",
    `<input type="hidden" name="id" value="${ticket.id}"><input type="hidden" name="revision" value="${bill.revision}"><p>Reduce quantities to remove mistaken items. Use zero to cancel a line. Send any replacement items as a new order.</p>${ticket.lines.map((l) => field("Keep quantity: " + esc(l.name), "quantity:" + l.id, l.quantity - (l.voided || 0), "number", `min="0" max="${l.quantity - (l.voided || 0)}" step="1" required`)).join("")}${field("Reason for correction", "reason", "", "text", 'required maxlength="300"')}`,
    "Apply correction"
  );
}
function productDialog(menuId, productId) {
  const item = state.products.find((i) => i.id === productId);
  const menu = (item == null ? void 0 : item.menu) || menuId;
  selectedImage = (item == null ? void 0 : item.image) || "";
  formDialog(
    item ? "Edit product" : "Add product",
    "product",
    `<input type="hidden" name="id" value="${(item == null ? void 0 : item.id) || ""}">${field("Product name", "name", (item == null ? void 0 : item.name) || "", "text", 'required maxlength="100"')}<label>Menu<select name="menu" required>${state.menus.map((c) => `<option value="${c.id}" ${menu === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>${field("Price (\xA3)", "price", item ? (item.price / 100).toFixed(2) : "", "text", 'inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" required')}<label>Description (optional)<textarea name="description" maxlength="500" rows="2">${esc((item == null ? void 0 : item.description) || "")}</textarea></label><label>Photo (optional)<input type="file" id="food-photo" accept="image/png,image/jpeg,image/webp"></label><small id="photo-status">Images are resized on this device before saving.</small><label class="check"><input type="checkbox" name="available" ${!item || item.available ? "checked" : ""}> Available to order</label>`,
    item ? "Save product" : "Add product"
  );
}
function menusView() {
  return header(
    "Your menus, your way.",
    "Add a menu, then add the products and prices that belong in it.",
    btn("+ Add menu", "menu-edit", "", "primary")
  ) + (state.menus.map((m, n) => {
    const products = state.products.filter((p) => p.menu === m.id);
    return `<section class="panel menu-block gap"><div class="row between"><h2>${esc(m.name)}</h2><div class="row">${btn("\u2191", "menu-move", `data-id="${m.id}" data-direction="-1" aria-label="Move ${esc(m.name)} up" ${n === 0 ? "disabled" : ""}`, "small")}${btn("\u2193", "menu-move", `data-id="${m.id}" data-direction="1" aria-label="Move ${esc(m.name)} down" ${n === state.menus.length - 1 ? "disabled" : ""}`, "small")}${btn("Rename", "menu-edit", `data-id="${m.id}"`, "small")}${btn("Delete", "menu-delete", `data-id="${m.id}"`, "small danger")}</div></div>${products.map((i) => `<div class="list-row"><div><strong>${esc(i.name)}</strong><small>${money(i.price)} \xB7 ${i.available ? "Available" : "Sold out"}</small></div><div class="row">${btn(i.available ? "Mark sold out" : "Make available", "availability", `data-id="${i.id}"`, "small")}${btn("Edit", "product-edit", `data-id="${i.id}"`, "small")}${btn("Delete", "product-delete", `data-id="${i.id}"`, "small danger")}</div></div>`).join("") || '<p class="muted gap">No products in this menu yet.</p>'}${btn("+ Add product", "product-add", `data-menu="${m.id}" aria-label="Add product to ${esc(m.name)}"`, "gap")}</section>`;
  }).join("") || `<section class="panel">${empty("Start with \u201CAdd menu\u201D, for example Breakfast or Hot drinks.")}</section>`);
}
function slotsPanel() {
  return `<section class="panel"><h2>Role slots</h2><p class="muted gap"><small>Your team signs in with the shared team login, then picks a numbered slot such as Waitress / Waiter 2. Slots are not linked to a person and Gar\xE7on stores no staff names.</small></p>${[
    "Waiter",
    "Chef",
    "Cashier"
  ].map((role) => {
    var _a;
    const n = ((_a = state.slots) == null ? void 0 : _a[role]) || 0;
    const min = role === "Cashier" ? 0 : 1;
    return `<div class="list-row slot-row"><div><strong>${roleName(role)}</strong><small>${n ? `${roleName(role)} 1${n > 1 ? "\u2013" + n : ""}` : "Off \xB7 waiting staff mark tables as paid"}</small></div><div class="qty stepper">${btn("\u2212", "slot-step", `data-role="${role}" data-delta="-1" aria-label="Fewer ${roleName(role)} slots" ${n <= min ? "disabled" : ""}`)}<span aria-label="${roleName(role)} slots">${n}</span>${btn("+", "slot-step", `data-role="${role}" data-delta="1" aria-label="More ${roleName(role)} slots" ${n >= 20 ? "disabled" : ""}`)}</div></div>`;
  }).join(
    ""
  )}<p class="install-note gap">Removing a slot signs out anyone using it. Set Cashier to 0 if waitresses / waiters take payment themselves: they then see the Till and mark tables as paid.</p></section>`;
}
function setup() {
  var _a, _b;
  return header(
    "Your caf\xE9, your way.",
    "A little setup now. A much smoother service later."
  ) + `<div class="tabs wrap">${[
    ["team", "Team slots"],
    ["tables", "Tables"],
    ["device", "Team login"],
    ["business", "Business profile"]
  ].map(
    ([id, name]) => btn(
      name,
      "setup-tab",
      `data-id="${id}"`,
      setupTab === id ? "active" : ""
    )
  ).join("")}</div>` + (setupTab === "business" ? `<section class="panel"><form data-form="business"><h2>Business profile</h2>${field("Business name", "name", state.name, "text", 'required maxlength="100"')}${field("Address (optional)", "address", ((_a = state.business) == null ? void 0 : _a.address) || "", "text", 'maxlength="300"')}${field("Phone (optional)", "phone", ((_b = state.business) == null ? void 0 : _b.phone) || "", "tel", 'maxlength="40"')}<p class="muted">One business, your own menus and team slots. Prices use GBP.</p><div class="form-error" role="alert"></div><button type="submit" class="primary">Save business profile</button></form></section>` : setupTab === "tables" ? `<section class="panel"><div class="row between"><h2>Tables</h2>${btn("+ Add table", "table-edit", "", "small")}</div><form data-form="table-range" class="range-form"><p class="muted"><small>Add numbered tables in one go. Existing numbers are skipped.</small></p><div class="row">${field("First table", "from", "1", "number", 'min="1" max="999" required inputmode="numeric"')}${field("Last table", "to", "", "number", 'min="1" max="999" required inputmode="numeric"')}<button type="submit" class="primary">Add tables</button></div><div class="form-error" role="alert"></div></form>${sortedTables().map(
    (t) => `<div class="list-row"><strong>Table ${esc(t.label)}</strong><div class="row">${btn("Rename", "table-edit", `data-id="${t.id}"`, "small")}${btn("Remove", "table-delete", `data-id="${t.id}"`, "small danger")}</div></div>`
  ).join("") || empty("Add your first table.")}</section>` : setupTab === "team" ? `<div class="columns">${slotsPanel()}</div>` : `<div class="columns"><section class="panel stack"><h2>Team login</h2><p class="muted">Your team signs in on caf\xE9 devices with your business email and this team password. It is separate from your owner password. Changing it signs out every team device.</p><p><strong>${state.teamLogin ? "Team password is set." : "No team password yet."}</strong></p><form data-form="team-password">${field(state.teamLogin ? "New team password" : "Team password", "password", "", "password", 'required minlength="10" maxlength="128" autocomplete="new-password"')}${field("Repeat team password", "confirm", "", "password", 'required minlength="10" maxlength="128" autocomplete="new-password"')}<div class="form-error" role="alert"></div><button type="submit" class="primary">${state.teamLogin ? "Change team password" : "Set team password"}</button></form></section><section class="panel stack"><h2>Signed-in team devices</h2>${(state.devices || []).map((device) => `<div class="list-row"><div><strong>${esc(device.label)}</strong><small>Expires ${new Date(device.expires).toLocaleDateString("en-GB")}</small></div>${btn("Sign out", "device-revoke", `data-id="${device.id}"`, "small danger")}</div>`).join("") || '<p class="muted">No team devices signed in.</p>'}${(state.devices || []).length ? btn("Sign out all team devices", "unpair", "", "danger") : ""}<p class="install-note">Team logins last 30 days. Owner sessions expire after 12 hours. Use \u201CLock / switch\u201D when handing a device to someone else.</p></section></div>`);
}
async function refresh(force = false) {
  var _a;
  if (locallyLocked) return;
  const generation = authGeneration;
  try {
    const params = new URLSearchParams({
      clientDay: today || "",
      cafe: (actor == null ? void 0 : actor.cafe) || "",
      actor: (actor == null ? void 0 : actor.id) || ""
    });
    if (!force && state) params.set("version", state.version);
    const data = await api("state?" + params);
    if (locallyLocked || generation !== authGeneration) return;
    connected = true;
    if (data.unchanged) {
      connection();
      return;
    }
    if (actor && (actor.id !== data.actor.id || actor.cafe !== data.actor.cafe)) {
      await start();
      return;
    }
    const changed = !state || data.state.version !== state.version || data.actor.role !== (actor == null ? void 0 : actor.role) || today !== data.day;
    state = data.state;
    actor = data.actor;
    today = data.day;
    if (force || changed && !((_a = document.activeElement) == null ? void 0 : _a.matches(
      "[data-note],#search,#table-number,[name=from],[name=to]"
    )))
      render();
    else {
      if (changed) deferredRender = true;
      connection();
    }
  } catch (e) {
    if (locallyLocked || generation !== authGeneration) return;
    connected = false;
    connection();
    if (e.status === 401) {
      events == null ? void 0 : events.close();
      actor = null;
      state = null;
      modal.close();
      paired = await api("pair").catch(() => ({ team: false, slots: null }));
      authTab = paired.team ? "team" : "owner";
      auth();
    }
  }
}
async function start() {
  if (locallyLocked) throw new Error("Device is locked. Sign in to continue.");
  const generation = ++authGeneration;
  const data = await api("state");
  if (locallyLocked || generation !== authGeneration) return;
  state = data.state;
  actor = data.actor;
  today = data.day;
  connected = true;
  page = actor.role === "Chef" ? "kitchen" : actor.role === "Cashier" ? "billing" : "orders";
  table = null;
  load();
  render();
  events == null ? void 0 : events.close();
}
async function mutate(command, { durable = false, after = null, key: requestKey = null } = {}) {
  if (busy) throw new Error("Please wait for the current action.");
  if (pending) throw new Error("Confirm the pending submission first.");
  const request = { key: requestKey || uid(), command, after };
  if (durable) {
    pending = request;
    save();
    if (!storageOK) {
      pending = null;
      throw new Error(
        "Free some device storage before sending so retries can be kept safely."
      );
    }
  }
  return execute(request, durable);
}
async function execute(request, durable) {
  var _a, _b;
  if (busy || locallyLocked) return;
  const generation = authGeneration;
  busy = true;
  if (durable) render();
  try {
    const result = await api("command", {
      key: request.key,
      command: request.command
    });
    if (locallyLocked || generation !== authGeneration) return;
    if ((_a = request.after) == null ? void 0 : _a.clearTable) delete drafts[request.after.clearTable];
    if (durable) pending = null;
    save();
    modal.close();
    await refresh(true);
    toast("Saved and confirmed.");
    return result;
  } catch (e) {
    if (locallyLocked || generation !== authGeneration) return;
    if (durable && e.status && e.status < 500 && e.status !== 401) {
      pending = null;
      save();
    }
    if (durable) render();
    throw e;
  } finally {
    busy = false;
    const sendButton = document.querySelector("[data-action=send]");
    if (sendButton && !pending && actor)
      sendButton.disabled = !((_b = drafts[table]) == null ? void 0 : _b.lines.length);
  }
}
async function confirmAction(title, description, command, options = {}) {
  showDialog(
    `<h2>${esc(title)}</h2><p>${esc(description)}</p><div class="row gap">${btn("Cancel", "close")}${btn("Confirm", "confirm-action", "", "primary")}</div>`
  );
  $('#modal [data-action="confirm-action"]').onclick = async () => {
    try {
      await mutate(command, options);
    } catch (e) {
      toast(e.message);
    }
  };
}
app.addEventListener("input", (e) => {
  if (e.target.matches("[data-note]")) {
    getDraft().lines[Number(e.target.dataset.note)].note = e.target.value;
    save();
  }
  if (e.target.id === "search") {
    search = e.target.value;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      render();
      const input = $("#search");
      input == null ? void 0 : input.focus();
      input == null ? void 0 : input.setSelectionRange(search.length, search.length);
    }, 200);
  }
});
app.addEventListener(
  "focusout",
  () => setTimeout(() => {
    var _a;
    if (deferredRender && actor && !((_a = document.activeElement) == null ? void 0 : _a.matches(
      "[data-note],#search,#table-number,[name=from],[name=to]"
    )))
      render();
  }, 0)
);
document.addEventListener("change", async (e) => {
  if (e.target.id === "food-photo") {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1e7)
        throw new Error("Choose a PNG, JPEG or WebP photo smaller than 10 MB.");
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      selectedImage = canvas.toDataURL("image/jpeg", 0.78);
      bitmap.close();
      if (selectedImage.length > 5e5)
        throw new Error("Photo is too large. Choose a smaller image.");
      $("#photo-status").textContent = "Photo ready to save.";
    } catch (error) {
      selectedImage = "";
      toast(error.message);
    }
  }
});
document.addEventListener("click", async (e) => {
  var _a, _b, _c, _d;
  const button = e.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const d = button.dataset;
  try {
    switch (d.action) {
      case "close":
        modal.close();
        break;
      case "auth":
        authTab = d.tab;
        paired = await api("pair").catch(() => ({ team: false, slots: null }));
        auth();
        break;
      case "pick-profile":
        if (locallyLocked) await finishLogout();
        await api("staff-login", { slot: d.id });
        await start();
        break;
      case "team-signout":
        await api("team-logout", {});
        paired = { team: false, slots: null };
        auth();
        toast("Team login signed out on this device.");
        break;
      case "page":
        page = d.page;
        focusTable = true;
        render();
        break;
      case "table":
        openTable(d.id);
        break;
      case "tables":
        table = null;
        focusTable = true;
        render();
        break;
      case "menu-filter":
        menuFilter = d.id;
        render();
        break;
      case "add": {
        if (pending || busy) break;
        const item = state.products.find((i) => i.id === d.id), draft = getDraft();
        if (draft.bill !== (((_a = activeBill()) == null ? void 0 : _a.id) || null))
          throw new Error(
            "The table has changed. Discard this old draft and start again."
          );
        const line = draft.lines.find(
          (l) => l.item === item.id && l.price === item.price && !l.note
        );
        if (line) line.quantity = Math.min(99, line.quantity + 1);
        else
          draft.lines.push({
            item: item.id,
            name: item.name,
            price: item.price,
            quantity: 1,
            note: ""
          });
        save();
        render();
        break;
      }
      case "qty": {
        const lines = getDraft().lines;
        lines[d.index].quantity = Math.min(
          99,
          lines[d.index].quantity + Number(d.delta)
        );
        if (lines[d.index].quantity < 1) lines.splice(d.index, 1);
        save();
        render();
        break;
      }
      case "remove-line":
        getDraft().lines.splice(d.index, 1);
        save();
        render();
        break;
      case "discard":
        showDialog(
          `<h2>Discard this unsent draft?</h2><p>Kitchen tickets already sent will be kept.</p><div class="row gap">${btn("Keep draft", "close")}${btn("Discard draft", "discard-confirm", "", "danger")}</div>`
        );
        break;
      case "discard-confirm":
        delete drafts[table];
        save();
        modal.close();
        render();
        break;
      case "send": {
        const draft = getDraft();
        if (draft.bill !== (((_b = activeBill()) == null ? void 0 : _b.id) || null))
          throw new Error(
            "This table has changed. Discard the old draft and review the current table."
          );
        const changed = draft.lines.some(
          (l) => {
            var _a2;
            return ((_a2 = state.products.find((i) => i.id === l.item)) == null ? void 0 : _a2.price) !== l.price;
          }
        );
        if (changed) {
          for (const l of draft.lines) {
            const item = state.products.find((i) => i.id === l.item);
            if (item) {
              l.price = item.price;
              l.name = item.name;
            }
          }
          save();
          render();
          throw new Error(
            "Menu prices changed. Review the new total, then send again."
          );
        }
        await mutate(
          {
            type: "order.submit",
            table,
            bill: draft.bill,
            lines: structuredClone(draft.lines)
          },
          { durable: true, key: draft.id, after: { clearTable: table } }
        );
        break;
      }
      case "retry":
        if (pending) await execute(pending, true);
        break;
      case "status":
        await mutate(
          { type: "ticket.status", id: d.id, status: d.status },
          { durable: true }
        );
        break;
      case "view-bill":
        billDialog(d.id);
        break;
      case "correct-ticket":
        correctionDialog(d.id);
        break;
      case "mark-paid":
        await confirmAction(
          "Mark this table as paid?",
          `Only do this after the customer has paid ${money(Number(d.amount))} at your usual till. Gar\xE7on then deletes this table\u2019s items, prices and total, and frees the table.`,
          {
            type: "bill.paid",
            id: d.id,
            revision: Number(d.revision),
            amount: Number(d.amount)
          },
          { durable: true }
        );
        break;
      case "setup-tab":
        setupTab = d.id;
        render();
        break;
      case "menu-edit": {
        const c = state.menus.find((c2) => c2.id === d.id);
        formDialog(
          c ? "Rename menu" : "Add menu",
          "menu",
          `<input name="id" type="hidden" value="${(c == null ? void 0 : c.id) || ""}">${field("Menu name", "name", (c == null ? void 0 : c.name) || "", "text", 'required maxlength="60" placeholder="Breakfast"')}`,
          c ? "Save" : "Add menu"
        );
        break;
      }
      case "menu-move":
        await mutate({
          type: "menu.move",
          id: d.id,
          direction: Number(d.direction)
        });
        break;
      case "menu-delete":
        await confirmAction(
          "Delete this menu?",
          "Move or delete its products first.",
          { type: "menu.delete", id: d.id }
        );
        break;
      case "availability":
        await mutate({
          type: "product.availability",
          id: d.id,
          available: !state.products.find((i) => i.id === d.id).available
        });
        break;
      case "product-add":
        productDialog(d.menu);
        break;
      case "product-edit":
        productDialog(null, d.id);
        break;
      case "product-delete":
        await confirmAction(
          "Delete this product?",
          "Orders already sent keep their original details until paid.",
          { type: "product.delete", id: d.id }
        );
        break;
      case "table-edit": {
        const t = state.tables.find((t2) => t2.id === d.id);
        formDialog(
          t ? "Rename table" : "Add table",
          "table",
          `<input name="id" type="hidden" value="${(t == null ? void 0 : t.id) || ""}">${field("Table number or label", "label", (t == null ? void 0 : t.label) || "", "text", 'required maxlength="24"')}`
        );
        break;
      }
      case "table-delete":
        await confirmAction(
          "Remove table?",
          "A table with an open bill cannot be removed.",
          { type: "table.delete", id: d.id }
        );
        break;
      case "slot-step": {
        const count = (((_c = state.slots) == null ? void 0 : _c[d.role]) || 0) + Number(d.delta);
        if (count < (((_d = state.slots) == null ? void 0 : _d[d.role]) || 0))
          await confirmAction(
            `Remove ${roleName(d.role)} ${count + 1}?`,
            d.role === "Cashier" && count === 0 ? "The cashier slot is signed out. Waitresses / waiters will see the Till and mark tables as paid." : "Anyone using that slot is signed out straight away.",
            { type: "slots.set", role: d.role, count }
          );
        else await mutate({ type: "slots.set", role: d.role, count });
        break;
      }
      case "device-revoke":
        await confirmAction(
          "Sign out this device?",
          "The team login and any profile in use on this device end immediately.",
          { type: "device.revoke", id: d.id },
          { durable: true }
        );
        break;
      case "unpair":
        showDialog(
          `<h2>Sign out all team devices?</h2><p>Every caf\xE9 device will need the team password again, including lost devices.</p><div class="row gap">${btn("Cancel", "close")}${btn("Sign out all", "unpair-confirm", "", "danger")}</div>`
        );
        break;
      case "unpair-confirm":
        await api("unpair", {});
        await refresh(true);
        modal.close();
        toast("All team devices signed out.");
        break;
      case "logout":
        lockLocal();
        try {
          await finishLogout();
          paired = await api("pair");
          authTab = paired.team ? "team" : "owner";
          auth();
        } catch {
          toast("Device locked. Reconnect to sign in again.");
        }
        break;
    }
  } catch (error) {
    toast(error.message);
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form)), type = form.dataset.form, submit = form.querySelector('button[type="submit"],button.primary');
  if (submit) submit.disabled = true;
  try {
    if (type === "team-login") {
      if (locallyLocked) await finishLogout();
      await api("team-login", data);
      paired = await api("pair");
      authTab = "team";
      auth();
      return;
    }
    if (["login", "setup"].includes(type)) {
      if (locallyLocked) await finishLogout();
      await api(type, data);
      needsSetup = false;
      await start();
      return;
    }
    if (type === "team-password") {
      if (data.password !== data.confirm)
        throw new Error("The two team passwords do not match.");
      await mutate({ type: "team.password", password: data.password });
      toast("Team password saved. Team devices need to sign in again.");
    }
    if (type === "business")
      await mutate({
        type: "business.save",
        name: data.name,
        address: data.address,
        phone: data.phone
      });
    if (type === "correct-ticket")
      await mutate(
        {
          type: "ticket.correct",
          id: data.id,
          revision: Number(data.revision),
          reason: data.reason,
          lines: Object.entries(data).filter(([k]) => k.startsWith("quantity:")).map(([k, v]) => ({ id: k.slice(9), quantity: Number(v) }))
        },
        { durable: true }
      );
    if (type === "menu")
      await mutate({
        type: "menu.save",
        id: data.id || void 0,
        name: data.name
      });
    if (type === "table")
      await mutate({
        type: "table.save",
        id: data.id || void 0,
        label: data.label
      });
    if (type === "table-open") {
      const found = findTable(data.table);
      if (!found)
        throw new Error(
          `There is no table ${data.table.trim()}. Check the number or ask the owner to add it.`
        );
      openTable(found.id);
      return;
    }
    if (type === "table-range") {
      const result = await mutate({
        type: "table.range",
        from: Number(data.from),
        to: Number(data.to)
      });
      toast(`${plural((result == null ? void 0 : result.added) || 0, "table")} added.`);
    }
    if (type === "product") {
      if (!/^\d+(\.\d{1,2})?$/.test(data.price))
        throw new Error("Use a price with up to two decimal places.");
      await mutate({
        type: "product.save",
        id: data.id || void 0,
        name: data.name,
        price: Math.round(Number(data.price) * 100),
        menu: data.menu,
        description: data.description,
        image: selectedImage,
        available: data.available === "on"
      });
      selectedImage = "";
    }
  } catch (error) {
    const el = form.querySelector(".form-error");
    if (el && form.isConnected) el.textContent = error.message;
    else toast(error.message);
  } finally {
    if (submit) submit.disabled = false;
  }
});
window.addEventListener("online", async () => {
  if (locallyLocked) {
    try {
      await finishLogout();
      paired = await api("pair");
      authTab = paired.team ? "team" : "owner";
      auth();
    } catch {
    }
  } else refresh();
});
window.addEventListener("storage", (e) => {
  if (e.key === LOCK_KEY && e.newValue === "true") {
    lockLocal();
    return;
  }
  if (actor && e.key === key() && !busy) {
    load();
    render();
  }
});
window.addEventListener("offline", () => {
  connected = false;
  connection();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && actor) refresh();
});
let pollInFlight = false;
setInterval(() => {
  if (actor && !busy && !pollInFlight && document.visibilityState === "visible") {
    pollInFlight = true;
    refresh().finally(() => {
      pollInFlight = false;
    });
  }
}, 2500);
(async function launch() {
  try {
    const info = await api("info");
    needsSetup = info.empty;
    await start();
  } catch {
    paired = await api("pair").catch(() => ({ team: false, slots: null }));
    authTab = needsSetup && onHost ? "setup" : paired.team || !onHost ? "team" : "owner";
    auth();
  }
})();
