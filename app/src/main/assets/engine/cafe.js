const SCHEMA_VERSION = 5;
const ROLES = ["Waiter", "Chef", "Cashier"];
const SLOT_MAX = 20;
const DEFAULT_SLOTS = 3;
const slotMin = (role) => role === "Cashier" ? 0 : 1;
const ROLE_LABELS = {
  Waiter: "Waitress / Waiter",
  Chef: "Kitchen",
  Cashier: "Cashier",
  Owner: "Owner"
};
const slotId = (role, n) => `${role}-${n}`;
const slotLabel = (role, n) => `${ROLE_LABELS[role]} ${n}`;
const defaultSlots = () => Object.fromEntries(ROLES.map((role) => [role, DEFAULT_SLOTS]));
function slotsFrom(staff) {
  const counts = Object.fromEntries(ROLES.map((role) => [role, 0])), byId = /* @__PURE__ */ new Map(), byName = /* @__PURE__ */ new Map();
  for (const person of staff) {
    if (person.active === false) continue;
    const role = ROLES.includes(person.role) ? person.role : "Cashier";
    counts[role] = Math.min(SLOT_MAX, counts[role] + 1);
    const slot = {
      id: slotId(role, counts[role]),
      label: slotLabel(role, counts[role])
    };
    byId.set(person.id, slot);
    if (person.name && !byName.has(person.name)) byName.set(person.name, slot);
  }
  for (const role of ROLES) if (!counts[role]) counts[role] = DEFAULT_SLOTS;
  const who = (name, oldId) => {
    if (name === "Owner" || oldId === "owner")
      return { id: "owner", label: "Owner" };
    return byId.get(oldId) || byName.get(name) || { id: null, label: "Team" };
  };
  return { counts, who };
}
const validSlots = (slots) => slots && ROLES.every(
  (role) => Number.isInteger(slots[role]) && slots[role] >= slotMin(role) && slots[role] <= SLOT_MAX
);
function leanState(old) {
  const open = (old.bills || []).filter((bill) => !bill.closed);
  const openIds = new Set(open.map((bill) => bill.id));
  const { counts, who } = slotsFrom(old.staff || []);
  const scrub = (entry) => {
    const slot = who(entry.by, entry.byId);
    return { ...entry, by: slot.label, byId: slot.id };
  };
  return {
    name: old.name,
    ...old.business ? { business: old.business } : {},
    menus: (old.menus || old.categories || []).map(({ id: id2, name }) => ({
      id: id2,
      name
    })),
    products: (old.products || old.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      menu: item.menu || item.category,
      description: item.description || "",
      image: item.image || "",
      available: item.available !== false
    })),
    tables: old.tables || [],
    slots: validSlots(old.slots) ? { ...old.slots } : counts,
    bills: open,
    tickets: (old.tickets || []).filter((ticket) => openIds.has(ticket.bill)).map((ticket) => {
      var _a;
      return {
        ...scrub(ticket),
        corrections: (_a = ticket.corrections) == null ? void 0 : _a.map(scrub),
        status: ticket.status === "Served" ? "AtTill" : ticket.status === "Ready" ? "Preparing" : ticket.status
      };
    }),
    paid: (old.paid || []).map((p) => ({
      id: p.id,
      tableLabel: p.tableLabel,
      opened: p.opened,
      paidAt: p.paidAt,
      paidBy: old.slots ? p.paidBy : who(p.paidBy).label
    }))
  };
}
function migrate(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > SCHEMA_VERSION)
    throw new Error(
      "Database is newer than this release. Restore compatible code or a pre-upgrade backup."
    );
  if (version === SCHEMA_VERSION) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS provisioning (token TEXT PRIMARY KEY, used_at TEXT NOT NULL);"
    );
    const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    const sessions = columns("sessions");
    if (!sessions.includes("device"))
      db.exec("ALTER TABLE sessions ADD COLUMN device TEXT");
    if (!sessions.includes("label"))
      db.exec(
        "ALTER TABLE sessions ADD COLUMN label TEXT NOT NULL DEFAULT 'Team login'"
      );
    if (!columns("cafes").includes("team_password"))
      db.exec("ALTER TABLE cafes ADD COLUMN team_password TEXT");
    if (!columns("requests").includes("at"))
      db.exec("ALTER TABLE requests ADD COLUMN at INTEGER NOT NULL DEFAULT 0");
    for (const row of db.prepare("SELECT id,state FROM cafes").all())
      db.prepare("UPDATE cafes SET state=? WHERE id=?").run(
        JSON.stringify(leanState(JSON.parse(row.state))),
        row.id
      );
    db.exec(
      "DROP TABLE IF EXISTS history; DROP TABLE IF EXISTS ledger; DROP TABLE IF EXISTS rota;"
    );
    db.exec(
      "DELETE FROM sessions WHERE staff IS NOT NULL; DELETE FROM attempts WHERE key LIKE 'pin:%' OR key LIKE 'staff:%';"
    );
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
class Problem extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const id = () => Native.uuid();
const day = (date = /* @__PURE__ */ new Date()) => Native.londonDay(String(date.getTime()));
function hash(secret) {
  return Native.passwordHash(secret);
}
function verify(secret, encoded) {
  return typeof secret === "string" && secret.length <= 256 && !!encoded && Native.passwordMatches(secret, encoded);
}
const randomBytes = (n) => ({ toString: () => Native.randomHex(n) });
const createHash = () => ({ update: (input) => ({ digest: () => Native.sha256(input) }) });
const text = (v, max = 100) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    throw new Problem("Please enter valid text.");
  return v.trim();
};
const integer = (v, min, max) => {
  if (!Number.isSafeInteger(v) || v < min || v > max)
    throw new Problem(`Expected a whole number between ${min} and ${max}.`);
  return v;
};
const optional = (v, max = 500) => v == null || v === "" ? "" : text(v, max);
const roles = ROLES;
const TABLE_MAX = 200;
const allow = (actor, roles2) => {
  if (!roles2.includes(actor.role))
    throw new Problem("Your role cannot perform this action.", 403);
};
const owner = (a) => allow(a, ["Owner"]);
const find = (list, key) => {
  const result = list.find((x) => x.id === key);
  if (!result) throw new Problem("This record no longer exists.", 404);
  return result;
};
function initial(name) {
  return {
    name,
    menus: [],
    products: [],
    tables: [],
    slots: defaultSlots(),
    bills: [],
    tickets: [],
    paid: []
  };
}
const waiterPays = (s) => {
  var _a;
  return ((_a = s.slots) == null ? void 0 : _a.Cashier) === 0;
};
const parseSlot = (slots, value) => {
  const m = typeof value === "string" && /^(Waiter|Chef|Cashier)-(\d{1,2})$/.exec(value);
  const n = m ? Number(m[2]) : 0;
  if (!m || n < 1 || n > ((slots == null ? void 0 : slots[m[1]]) || 0)) return null;
  return { id: slotId(m[1], n), role: m[1], n, name: slotLabel(m[1], n) };
};
const dropOldPaid = (s) => {
  s.paid = (s.paid || []).filter((p) => day(new Date(p.paidAt)) === day());
};
class Store {
  constructor(path = "data/garcon.sqlite") {
    this.db = new AndroidDatabase();
    this.db.exec(`
   CREATE TABLE IF NOT EXISTS cafes(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,cafe TEXT NOT NULL REFERENCES cafes(id),staff TEXT,kind TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS requests(cafe TEXT NOT NULL,actor TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(cafe,actor,key));
   CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS images(id TEXT NOT NULL,cafe TEXT NOT NULL REFERENCES cafes(id),data TEXT NOT NULL,PRIMARY KEY(cafe,id));`);
    try {
      migrate(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  createCafe(name, email, password) {
    name = text(name);
    email = text(email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Problem("Enter a valid email address.");
    if (typeof password !== "string" || password.length < 12 || password.length > 128)
      throw new Problem("Use a password of 12\u2013128 characters.");
    const cafe = id();
    try {
      this.db.prepare(
        "INSERT INTO cafes(id,email,password,state,version) VALUES(?,?,?,?,0)"
      ).run(cafe, email, hash(password), JSON.stringify(initial(name)));
    } catch {
      throw new Problem("Account could not be created.");
    }
    return cafe;
  }
  provision(name, email, password, token) {
    const digest = this.token(token);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT token FROM provisioning WHERE token=?").get(digest))
        throw new Problem("This setup code has already been used.", 403);
      const cafe = this.createCafe(name, email, password);
      this.db.prepare("INSERT INTO provisioning VALUES(?,?)").run(digest, (/* @__PURE__ */ new Date()).toISOString());
      this.db.exec("COMMIT");
      return cafe;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  row(cafe) {
    const r = this.db.prepare("SELECT * FROM cafes WHERE id=?").get(cafe);
    if (!r) throw new Problem("Sign in again.", 401);
    return r;
  }
  activeState(cafe) {
    const r = this.row(cafe);
    return { ...JSON.parse(r.state), version: r.version };
  }
  // Complete current state for operator export. Paid bills have no amounts.
  state(cafe) {
    const s = this.activeState(cafe);
    dropOldPaid(s);
    return s;
  }
  publicState(cafe, actor) {
    const s = this.state(cafe);
    if (actor.role === "Chef") {
      s.bills = [];
      s.paid = [];
      s.tickets = s.tickets.filter((t) => t.status !== "AtTill");
    }
    if (actor.role === "Waiter" && !waiterPays(s)) s.paid = [];
    if (actor.role === "Owner") {
      s.devices = this.db.prepare(
        "SELECT token AS id,label,expires FROM sessions WHERE cafe=? AND kind='pair' AND expires>?"
      ).all(cafe, Date.now());
      s.teamLogin = Boolean(this.row(cafe).team_password);
    }
    return s;
  }
  // Removes stale retry receipts and paid notes from earlier days. Called on
  // every change and by the maintenance command.
  purgeExpired() {
    const receipts = Date.now() - 2 * 864e5;
    this.db.prepare("DELETE FROM requests WHERE at<?").run(receipts);
    for (const r of this.db.prepare("SELECT id,state FROM cafes").all()) {
      const s = JSON.parse(r.state), before = (s.paid || []).length;
      dropOldPaid(s);
      if (s.paid.length !== before)
        this.db.prepare("UPDATE cafes SET state=?,version=version+1 WHERE id=?").run(JSON.stringify(s), r.id);
    }
  }
  limit(key, max = 10) {
    const now = Date.now();
    const r = this.db.prepare("SELECT * FROM attempts WHERE key=?").get(key);
    if (r && r.reset > now && r.count >= max)
      throw new Problem("Too many attempts. Try again in 15 minutes.", 429);
    this.db.prepare("INSERT OR REPLACE INTO attempts VALUES(?,?,?)").run(
      key,
      r && r.reset > now ? r.count + 1 : 1,
      r && r.reset > now ? r.reset : now + 9e5
    );
  }
  session(cafe, staff = null, kind = "user", device = null, label = "Team login") {
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    this.db.prepare(
      "INSERT INTO sessions(token,cafe,staff,kind,expires,device,label) VALUES(?,?,?,?,?,?,?)"
    ).run(
      createHash("sha256").update(token).digest("hex"),
      cafe,
      staff,
      kind,
      Date.now() + (kind === "pair" ? 30 : 0.5) * 864e5,
      device,
      text(label, 80)
    );
    return token;
  }
  token(token) {
    return createHash("sha256").update(token || "").digest("hex");
  }
  getSession(token, kind = "user") {
    const s = this.db.prepare("SELECT * FROM sessions WHERE token=? AND kind=? AND expires>?").get(this.token(token), kind, Date.now());
    if (!s) throw new Problem("Please sign in.", 401);
    return s;
  }
  actor(token) {
    const session = this.getSession(token);
    if (!session.staff)
      return { cafe: session.cafe, id: "owner", role: "Owner", name: "Owner" };
    const slot = parseSlot(this.activeState(session.cafe).slots, session.staff);
    if (!slot) throw new Problem("This role slot is no longer available.", 401);
    return {
      cafe: session.cafe,
      id: slot.id,
      role: slot.role,
      name: slot.name
    };
  }
  logout(token) {
    this.db.prepare("DELETE FROM sessions WHERE token=?").run(this.token(token));
  }
  // Ends a team login on this device and every profile session opened from it.
  teamLogout(pair) {
    const digest = this.token(pair);
    this.db.prepare("DELETE FROM sessions WHERE token=? OR device=?").run(digest, digest);
  }
  checkAttempts(key, max) {
    const r = this.db.prepare("SELECT * FROM attempts WHERE key=?").get(key);
    if (r && r.reset > Date.now() && r.count >= max)
      throw new Problem(
        "Too many failed attempts. Try again in 15 minutes.",
        429
      );
  }
  clearAttempts(key) {
    this.db.prepare("DELETE FROM attempts WHERE key=?").run(key);
  }
  login(email, password, ip) {
    email = typeof email === "string" ? email.toLowerCase().trim().slice(0, 200) : "";
    const network = "login:" + ip, account = "email:" + email;
    this.checkAttempts(network, 30);
    this.checkAttempts(account, 10);
    const r = this.db.prepare("SELECT * FROM cafes WHERE email=?").get(email);
    if (!r || !verify(password, r.password)) {
      this.limit(network, 30);
      this.limit(account, 10);
      throw new Problem("Email or password is incorrect.", 401);
    }
    this.clearAttempts(account);
    return this.session(r.id);
  }
  // The shared business login used by the team on a café device.
  teamLogin(email, password, ip) {
    email = typeof email === "string" ? email.toLowerCase().trim().slice(0, 200) : "";
    const network = "team-ip:" + ip, account = "team:" + email;
    this.checkAttempts(network, 30);
    this.checkAttempts(account, 10);
    const r = this.db.prepare("SELECT * FROM cafes WHERE email=?").get(email);
    if (!r || !r.team_password || !verify(password, r.team_password)) {
      this.limit(network, 30);
      this.limit(account, 10);
      throw new Problem("Business email or team password is incorrect.", 401);
    }
    this.clearAttempts(account);
    return this.session(r.id, null, "pair");
  }
  // The numbered role slots a team device can pick from. No names are stored.
  teamProfiles(pair) {
    const p = this.getSession(pair, "pair"), s = this.activeState(p.cafe);
    return { name: s.name, team: true, slots: { ...s.slots } };
  }
  staffLogin(pair, slot) {
    const p = this.getSession(pair, "pair");
    const found = parseSlot(this.activeState(p.cafe).slots, slot);
    if (!found) throw new Problem("Choose one of the caf\xE9\u2019s role slots.", 401);
    return this.session(p.cafe, found.id, "user", p.token);
  }
  revokeStaff(cafe, staff) {
    this.db.prepare("DELETE FROM sessions WHERE cafe=? AND staff=?").run(cafe, staff);
  }
  revokeDevices(cafe) {
    this.db.prepare(
      "DELETE FROM sessions WHERE cafe=? AND (kind='pair' OR staff IS NOT NULL)"
    ).run(cafe);
  }
  command(actor, key, command) {
    if (!command || Array.isArray(command) || typeof command.type !== "string")
      throw new Problem("Invalid action.");
    text(key, 100);
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(key))
      throw new Problem("Missing submission reference.");
    const digest = createHash("sha256").update(JSON.stringify(command)).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.db.prepare("SELECT * FROM requests WHERE cafe=? AND actor=? AND key=?").get(actor.cafe, actor.id, key);
      if (previous) {
        if (previous.digest !== digest)
          throw new Problem(
            "Submission reference already used for different contents.",
            409
          );
        this.db.exec("COMMIT");
        return JSON.parse(previous.result);
      }
      const row = this.row(actor.cafe), s = JSON.parse(row.state);
      dropOldPaid(s);
      this.db.prepare("DELETE FROM requests WHERE cafe=? AND at<?").run(actor.cafe, Date.now() - 2 * 864e5);
      const result = this.apply(s, actor, command);
      this.db.prepare("UPDATE cafes SET state=?,version=version+1 WHERE id=?").run(JSON.stringify(s), actor.cafe);
      const output = { ok: true, ...result, version: row.version + 1 };
      this.db.prepare(
        "INSERT INTO requests(cafe,actor,key,digest,result,at) VALUES(?,?,?,?,?,?)"
      ).run(
        actor.cafe,
        actor.id,
        key,
        digest,
        JSON.stringify(output),
        Date.now()
      );
      this.db.exec("COMMIT");
      return output;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  apply(s, a, c) {
    if (!c || typeof c.type !== "string") throw new Problem("Invalid action.");
    switch (c.type) {
      case "business.save": {
        allow(a, ["Owner"]);
        s.name = text(c.name);
        s.business = {
          address: optional(c.address, 300),
          phone: optional(c.phone, 40)
        };
        return {};
      }
      case "team.password": {
        allow(a, ["Owner"]);
        if (typeof c.password !== "string" || c.password.length < 10 || c.password.length > 128)
          throw new Problem("Use a team password of 10\u2013128 characters.");
        if (verify(c.password, this.row(a.cafe).password))
          throw new Problem(
            "Use a different password from the owner password."
          );
        this.db.prepare("UPDATE cafes SET team_password=? WHERE id=?").run(hash(c.password), a.cafe);
        this.revokeDevices(a.cafe);
        return {};
      }
      case "device.revoke": {
        allow(a, ["Owner"]);
        const device = this.db.prepare(
          "SELECT token FROM sessions WHERE cafe=? AND token=? AND kind='pair'"
        ).get(a.cafe, c.id);
        if (!device) throw new Problem("Device not found.", 404);
        this.db.prepare(
          "DELETE FROM sessions WHERE cafe=? AND (token=? OR device=? OR (staff IS NOT NULL AND device IS NULL))"
        ).run(a.cafe, c.id, c.id);
        return { id: c.id };
      }
      case "menu.save": {
        owner(a);
        const name = text(c.name, 60);
        const menu = c.id ? find(s.menus, c.id) : { id: id() };
        menu.name = name;
        if (!c.id) s.menus.push(menu);
        return { id: menu.id };
      }
      case "menu.move": {
        owner(a);
        const current = s.menus.indexOf(find(s.menus, c.id)), next = current + integer(c.direction, -1, 1);
        if (next >= 0 && next < s.menus.length)
          [s.menus[current], s.menus[next]] = [s.menus[next], s.menus[current]];
        return {};
      }
      case "menu.delete": {
        owner(a);
        find(s.menus, c.id);
        if (s.products.some((x) => x.menu === c.id))
          throw new Problem("Move or delete the products in this menu first.");
        s.menus = s.menus.filter((x) => x.id !== c.id);
        return {};
      }
      case "product.save": {
        owner(a);
        find(s.menus, c.menu);
        const item = c.id ? find(s.products, c.id) : { id: id() };
        let image = optional(c.image, 5e5);
        if (image && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) && ![
          "breakfast",
          "avocado",
          "pancakes",
          "bap",
          "soup",
          "coffee",
          "tea",
          "cake"
        ].includes(image) && !/^\/api\/image\/[a-f0-9]{64}$/.test(image))
          throw new Problem("Use a PNG, JPEG or WebP image.");
        if (image.startsWith("data:")) {
          const imageId = createHash("sha256").update(image).digest("hex");
          this.db.prepare("INSERT OR IGNORE INTO images VALUES(?,?,?)").run(imageId, a.cafe, image);
          image = "/api/image/" + imageId;
        } else if (image.startsWith("/api/image/") && !this.db.prepare("SELECT id FROM images WHERE id=? AND cafe=?").get(image.split("/").pop(), a.cafe))
          throw new Problem("Photo is not available for this caf\xE9.", 404);
        Object.assign(item, {
          name: text(c.name, 100),
          price: integer(c.price, 0, 1e6),
          menu: c.menu,
          description: optional(c.description),
          image,
          available: c.available === true
        });
        if (!c.id) s.products.push(item);
        return { id: item.id };
      }
      case "product.availability": {
        owner(a);
        find(s.products, c.id).available = c.available === true;
        return {};
      }
      case "product.delete": {
        owner(a);
        find(s.products, c.id);
        s.products = s.products.filter((x) => x.id !== c.id);
        return {};
      }
      case "table.save": {
        owner(a);
        const label = text(c.label, 24);
        if (s.tables.some(
          (x) => x.label.toLowerCase() === label.toLowerCase() && x.id !== c.id
        ))
          throw new Problem("That table label is already in use.");
        if (!c.id && s.tables.length >= TABLE_MAX)
          throw new Problem(`Gar\xE7on supports up to ${TABLE_MAX} tables.`);
        const t = c.id ? find(s.tables, c.id) : { id: id() };
        t.label = label;
        if (!c.id) s.tables.push(t);
        return { id: t.id };
      }
      case "table.range": {
        owner(a);
        const from = integer(c.from, 1, 999), to = integer(c.to, from, 999);
        const used = new Set(s.tables.map((x) => x.label.toLowerCase()));
        let added = 0;
        for (let n = from; n <= to; n++) {
          if (used.has(String(n))) continue;
          if (s.tables.length >= TABLE_MAX)
            throw new Problem(`Gar\xE7on supports up to ${TABLE_MAX} tables.`);
          s.tables.push({ id: id(), label: String(n) });
          added++;
        }
        return { added };
      }
      case "table.delete": {
        owner(a);
        find(s.tables, c.id);
        if (s.bills.some((x) => x.table === c.id && !x.closed))
          throw new Problem("Settle this table before removing it.");
        s.tables = s.tables.filter((x) => x.id !== c.id);
        return {};
      }
      case "slots.set": {
        owner(a);
        if (!roles.includes(c.role))
          throw new Problem("Choose a valid team role.");
        const min = slotMin(c.role);
        if (!Number.isInteger(c.count) || c.count < min || c.count > SLOT_MAX)
          throw new Problem(`Choose between ${min} and ${SLOT_MAX} slots.`);
        const before = s.slots[c.role];
        s.slots[c.role] = c.count;
        for (let n = c.count + 1; n <= before; n++)
          this.revokeStaff(a.cafe, slotId(c.role, n));
        return { count: c.count };
      }
      case "order.submit": {
        allow(a, ["Owner", "Waiter"]);
        const table = find(s.tables, c.table);
        if (!Array.isArray(c.lines) || c.lines.length < 1 || c.lines.length > 60)
          throw new Problem("Add between 1 and 60 food lines.");
        let bill = s.bills.find((x) => x.table === table.id && !x.closed);
        if (((bill == null ? void 0 : bill.id) || null) !== c.bill)
          throw new Problem(
            "This table has changed. Review its current bill before sending.",
            409
          );
        const lines = c.lines.map((line) => {
          const item = find(s.products, line.item);
          if (!item.available)
            throw new Problem(`${item.name} is unavailable.`, 409);
          if (line.price !== item.price)
            throw new Problem(
              `${item.name} has a new price. Review the order.`,
              409
            );
          return {
            id: id(),
            item: item.id,
            name: item.name,
            price: item.price,
            quantity: integer(line.quantity, 1, 99),
            note: optional(line.note, 300)
          };
        });
        if (!bill) {
          bill = {
            id: id(),
            table: table.id,
            tableLabel: table.label,
            opened: (/* @__PURE__ */ new Date()).toISOString(),
            closed: null,
            revision: 0,
            total: 0
          };
          s.bills.push(bill);
        }
        const total = lines.reduce((n, l) => n + l.price * l.quantity, 0);
        if (bill.total + total > 1e8)
          throw new Problem("Table total exceeds the supported limit.");
        bill.total += total;
        bill.revision++;
        const ticket = {
          id: id(),
          bill: bill.id,
          table: table.id,
          tableLabel: table.label,
          lines,
          status: "New",
          created: (/* @__PURE__ */ new Date()).toISOString(),
          by: a.name,
          byId: a.id
        };
        s.tickets.push(ticket);
        return { id: ticket.id, bill: bill.id };
      }
      case "ticket.correct": {
        owner(a);
        const ticket = find(s.tickets, c.id), bill = find(s.bills, ticket.bill);
        if (bill.closed || bill.revision !== c.revision)
          throw new Problem(
            "This bill has changed. Review it before correcting the order.",
            409
          );
        const reason = text(c.reason, 300);
        if (!Array.isArray(c.lines) || !c.lines.length)
          throw new Problem("Choose at least one line to correct.");
        const seen = /* @__PURE__ */ new Set();
        let reduction = 0;
        const changes = [];
        for (const change of c.lines) {
          if (seen.has(change.id))
            throw new Problem("Duplicate line correction.");
          seen.add(change.id);
          const line = find(ticket.lines, change.id), remaining = line.quantity - (line.voided || 0), quantity = integer(change.quantity, 0, remaining);
          const removed = remaining - quantity;
          if (removed) {
            line.voided = (line.voided || 0) + removed;
            reduction += removed * line.price;
            changes.push({ line: line.id, removed });
          }
        }
        if (!changes.length) throw new Problem("No quantities changed.");
        ticket.corrections || (ticket.corrections = []);
        ticket.corrections.push({
          id: id(),
          at: (/* @__PURE__ */ new Date()).toISOString(),
          by: a.name,
          byId: a.id,
          reason,
          changes
        });
        ticket.updated = (/* @__PURE__ */ new Date()).toISOString();
        if (ticket.lines.every((l) => l.quantity === (l.voided || 0)))
          ticket.status = "Voided";
        bill.total -= reduction;
        bill.revision++;
        return { id: ticket.id };
      }
      case "ticket.status": {
        const ticket = find(s.tickets, c.id);
        const next = { New: "Preparing", Preparing: "AtTill" }[ticket.status];
        if (c.status !== next)
          throw new Problem(
            "Ticket already changed. Refresh and try again.",
            409
          );
        allow(a, ["Owner", "Chef"]);
        ticket.status = c.status;
        ticket.updated = (/* @__PURE__ */ new Date()).toISOString();
        return { id: ticket.id };
      }
      case "bill.paid": {
        allow(a, waiterPays(s) ? ["Owner", "Waiter"] : ["Owner", "Cashier"]);
        const bill = find(s.bills, c.id);
        if (bill.revision !== c.revision || bill.total !== c.amount)
          throw new Problem(
            "This table has changed. Review its current items and total.",
            409
          );
        if (s.tickets.some(
          (t) => t.bill === bill.id && !["AtTill", "Voided"].includes(t.status)
        ))
          throw new Problem(
            "The kitchen must send all orders to the till before this table is marked as paid."
          );
        const paidAt = (/* @__PURE__ */ new Date()).toISOString();
        s.paid.push({
          id: bill.id,
          tableLabel: bill.tableLabel,
          opened: bill.opened,
          paidAt,
          paidBy: a.name
        });
        s.bills = s.bills.filter((b) => b.id !== bill.id);
        s.tickets = s.tickets.filter((t) => t.bill !== bill.id);
        return { id: bill.id };
      }
      default:
        throw new Problem("Unknown action.");
    }
  }
}
class AndroidDatabase {
  exec(sql) {
    dbCall("exec", sql, []);
  }
  close() {
  }
  prepare(sql) {
    return {
      run: (...args) => dbCall("run", sql, args),
      all: (...args) => dbCall("query", sql, args),
      get: (...args) => dbCall("query", sql, args)[0]
    };
  }
}
function dbCall(op, sql, args) {
  const r = JSON.parse(Native.sql(op, sql, JSON.stringify(args)));
  if (r.error) throw new Error(r.error);
  return r.value;
}
const store = new Store();
store.purgeExpired();
let lastMaintenance = Date.now();
const localSetupToken = "single-device-owner-setup";
function route(payload, peer, local) {
  try {
    if (Date.now() - lastMaintenance > 6e4) {
      store.purgeExpired();
      lastMaintenance = Date.now();
    }
    const { path, data, session = "", pair = "" } = JSON.parse(payload);
    const [name, query = ""] = path.split("?");
    const ok = (data2, auth = {}) => JSON.stringify({ status: 200, data: data2, auth });
    if (name === "info") return ok({ empty: !store.db.prepare("SELECT id FROM cafes LIMIT 1").get() });
    if (name === "setup") {
      if (!local || store.db.prepare("SELECT id FROM cafes LIMIT 1").get()) throw new Problem("Set up the caf\xE9 on its host phone.", 403);
      const cafe = store.provision(data.name, data.email, data.password, localSetupToken);
      return ok({ ok: true }, { session: store.session(cafe) });
    }
    if (name === "login") return ok({ ok: true }, { session: store.login(data.email, data.password, peer) });
    if (name === "team-login") {
      const token = store.teamLogin(data.email, data.password, peer);
      if (pair) store.teamLogout(pair);
      if (session) store.logout(session);
      return ok({ ok: true }, { pair: token, session: "" });
    }
    if (name === "team-logout") {
      if (pair) store.teamLogout(pair);
      if (session) store.logout(session);
      return ok({ ok: true }, { pair: "", session: "" });
    }
    if (name === "staff-login") return ok({ ok: true }, { session: store.staffLogin(pair, data.slot) });
    if (name === "logout") {
      if (session) store.logout(session);
      return ok({ ok: true }, { session: "" });
    }
    if (name === "pair") {
      try {
        return ok(store.teamProfiles(pair));
      } catch (e) {
        return ok({ team: false, slots: null });
      }
    }
    const actor = store.actor(session);
    if (name === "state") {
      const parameters = Object.fromEntries(query.split("&").filter(Boolean).map((x) => x.split("=").map(decodeURIComponent)));
      const today = day();
      if (parameters.version === String(store.row(actor.cafe).version) && parameters.cafe === actor.cafe && parameters.actor === actor.id && parameters.clientDay === today)
        return ok({ unchanged: true, actor, day: today });
      return ok({ actor, day: today, state: store.publicState(actor.cafe, actor) });
    }
    if (name === "command") return ok(store.command(actor, data.key, data.command));
    if (name === "unpair") {
      if (actor.role !== "Owner") throw new Problem("Owner access required.", 403);
      store.revokeDevices(actor.cafe);
      return ok({ ok: true });
    }
    if (/^image\/[0-9a-f]{64}$/.test(name)) {
      const photo = store.db.prepare("SELECT data FROM images WHERE cafe=? AND id=?").get(actor.cafe, name.slice(6));
      if (!photo) throw new Problem("Photo unavailable.", 404);
      return ok({ image: photo.data });
    }
    throw new Problem("Unknown action.", 404);
  } catch (e) {
    return JSON.stringify({ status: e.status || 500, data: { error: e.status ? e.message : "Could not complete the action. Retry using the same submission reference." } });
  }
}
globalThis.Service = { handle: route };
