const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const PUBLIC = path.join(ROOT, "public");
const sessions = new Map();

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.static(PUBLIC, { extensions: ["html"] }));

function ensureDir() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
}
function readJson(name, fallback) {
  ensureDir();
  const p = path.join(DATA, name);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(fallback, null, 2), "utf8");
    return structuredClone(fallback);
  }
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return structuredClone(fallback); }
}
function writeJson(name, value) {
  ensureDir();
  const p = path.join(DATA, name);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, p);
}
function id(prefix="id") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}
function cleanText(v, max=500) {
  if (typeof v !== "string") return "";
  return v.trim().replace(/[<>]/g, "").slice(0, max);
}
function int(v, min, max, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const candidate = crypto.scryptSync(password, record.salt, 64);
  const stored = Buffer.from(record.hash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0,idx).trim()] = decodeURIComponent(part.slice(idx+1).trim());
  }
  return out;
}
function makeSession(res, username) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { username, createdAt: Date.now() });
  res.setHeader("Set-Cookie", `barber_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
}
function auth(req, res, next) {
  const token = parseCookies(req).barber_session;
  const session = token && sessions.get(token);
  if (!session) return res.status(401).json({ error: "Unauthorized" });
  req.sessionToken = token;
  req.user = session;
  next();
}
function validWhatsapp(v) { return /^\d{6,15}$/.test(String(v || "")); }

const defaultConfig = {
  businessName: "Barbershop Razor",
  heroText: "Classic cuts, hot-towel shaves and precise finishing — always by appointment.",
  since: 2012,
  phoneDisplay: "+00 000 000 000",
  phoneHref: "+000000000",
  whatsapp: "000000000",
  email: "hello@barbershoprazor.example",
  address: "123 Example Street · Your City",
  mapsUrl: "https://maps.google.com/",
  hours: {
    "0": null, "1": null,
    "2": ["09:00","19:00"], "3": ["09:00","19:00"],
    "4": ["09:00","19:00"], "5": ["09:00","19:00"],
    "6": ["09:00","17:00"]
  },
  services: [
    { id:"svc_classic", name:"Classic haircut", desc:"Scissors and clippers with wash and styling.", price:"€20", minutes:30, category:"Hair", active:true },
    { id:"svc_fade", name:"Fade", desc:"Clean fade with razor finishing and styling.", price:"€22", minutes:40, category:"Hair", active:true },
    { id:"svc_kids", name:"Kids haircut", desc:"For children up to 12 years old.", price:"€14", minutes:25, category:"Hair", active:true },
    { id:"svc_shave", name:"Hot-towel shave", desc:"Hot towel, straight razor and beard oil.", price:"€15", minutes:25, category:"Beard", active:true },
    { id:"svc_combo", name:"Haircut + beard", desc:"The complete service in one appointment.", price:"€32", minutes:55, category:"Combo", active:true },
    { id:"svc_trim", name:"Beard trim", desc:"Clippers, contours and finishing.", price:"€10", minutes:15, category:"Beard", active:true }
  ],
  team: [
    { id:"barber_ricardo", name:"Ricardo", initials:"R", role:"Founder", bio:"Classic cuts and straight-razor shaves.", active:true },
    { id:"barber_miguel", name:"Miguel", initials:"M", role:"Barber", bio:"Fades, texture and modern styles.", active:true },
    { id:"barber_tiago", name:"Tiago", initials:"T", role:"Barber", bio:"Kids cuts and precision finishing.", active:true }
  ],
  testimonials: [
    { name:"Andrew M.", text:"On time, excellent cut and a great atmosphere. This is now my regular barbershop." },
    { name:"Ryan S.", text:"Booked from my phone in seconds. Smooth service and a very clean finish." },
    { name:"Luke F.", text:"The hot-towel shave was excellent. Professional from start to finish." }
  ]
};

const defaultBookings = [];

function ensureSeed() {
  readJson("config.json", defaultConfig);
  readJson("bookings.json", defaultBookings);

  if (!pool) {
    const adminPath = path.join(DATA, "admin.json");
    if (!fs.existsSync(adminPath)) {
      const username = process.env.ADMIN_USER || "admin";
      const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
      const pw = hashPassword(password);
      writeJson("admin.json", { username, ...pw, updatedAt: new Date().toISOString() });
      console.log(`Local admin created: ${username}`);
    }
  }
}
ensureSeed();

async function initDatabase() {
  if (!pool) {
    console.log("DATABASE_URL not set: bookings will use local JSON fallback.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      barber_id TEXT NOT NULL DEFAULT '',
      barber_name TEXT NOT NULL DEFAULT 'No preference',
      booking_date DATE NOT NULL,
      booking_time TIME NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    )
  `);

  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 30`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_date_time ON bookings (booking_date, booking_time)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status)`);

  const legacy = readJson("bookings.json", defaultBookings);
  for (const b of legacy) {
    if (!b?.id || !b?.name || !b?.serviceId || !b?.date || !b?.time) continue;
    await pool.query(`
      INSERT INTO bookings (
        id, created_at, updated_at, status, name, phone,
        service_id, service_name, barber_id, barber_name,
        booking_date, booking_time, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO NOTHING
    `, [
      b.id,
      b.createdAt || new Date().toISOString(),
      b.updatedAt || null,
      b.status || "pending",
      b.name,
      b.phone || "",
      b.serviceId,
      b.serviceName || "",
      b.barberId || "",
      b.barberName || "No preference",
      b.date,
      b.time,
      b.notes || ""
    ]);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_config (
      id SMALLINT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const localConfig = readJson("config.json", defaultConfig);
  await pool.query(
    `INSERT INTO site_config (id, data) VALUES (1, $1::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(localConfig)]
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SMALLINT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const existingAdmin = await pool.query(`SELECT id FROM admin_users WHERE id=1`);
  if (!existingAdmin.rows[0]) {
    const username = process.env.ADMIN_USER || "admin";
    const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
    const pw = hashPassword(password);
    await pool.query(
      `INSERT INTO admin_users (id, username, salt, hash, updated_at)
       VALUES (1, $1, $2, $3, NOW())`,
      [username, pw.salt, pw.hash]
    );
    console.log(`PostgreSQL admin created: ${username}`);
  }

  console.log("PostgreSQL admin ready.");
  console.log("PostgreSQL bookings table ready.");
  console.log("PostgreSQL site config ready.");
}

async function getConfig() {
  if (!pool) return readJson("config.json", defaultConfig);
  const { rows } = await pool.query(`SELECT data FROM site_config WHERE id=1`);
  if (!rows[0]) return structuredClone(defaultConfig);
  return rows[0].data;
}

async function saveConfig(config) {
  if (!pool) {
    writeJson("config.json", config);
    return config;
  }
  await pool.query(
    `INSERT INTO site_config (id, data, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`,
    [JSON.stringify(config)]
  );
  return config;
}

async function getAdmin() {
  if (!pool) return readJson("admin.json", {});

  const { rows } = await pool.query(`
    SELECT username, salt, hash, updated_at AS "updatedAt"
    FROM admin_users
    WHERE id=1
  `);

  return rows[0] || {};
}

async function saveAdmin(admin) {
  if (!pool) {
    writeJson("admin.json", admin);
    return admin;
  }

  await pool.query(
    `INSERT INTO admin_users (id, username, salt, hash, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id)
     DO UPDATE SET
       username=EXCLUDED.username,
       salt=EXCLUDED.salt,
       hash=EXCLUDED.hash,
       updated_at=NOW()`,
    [admin.username, admin.salt, admin.hash]
  );

  return admin;
}

async function getBookings() {
  if (!pool) return readJson("bookings.json", defaultBookings);

  const { rows } = await pool.query(`
    SELECT
      id,
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      status,
      name,
      phone,
      service_id AS "serviceId",
      service_name AS "serviceName",
      barber_id AS "barberId",
      barber_name AS "barberName",
      TO_CHAR(booking_date, 'YYYY-MM-DD') AS date,
      TO_CHAR(booking_time, 'HH24:MI') AS time,
      notes,
      duration_minutes AS "durationMinutes"
    FROM bookings
    ORDER BY created_at DESC
  `);
  return rows;
}

function timeToMinutes(value) {
  const [h, m] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  return h * 60 + m;
}

function bookingsOverlap(startA, durationA, startB, durationB) {
  const a = timeToMinutes(startA);
  const b = timeToMinutes(startB);
  return a < b + Number(durationB || 30) && b < a + Number(durationA || 30);
}

async function createBookingRecordIfAvailable(booking) {
  if (!pool) {
    const bookings = readJson("bookings.json", defaultBookings);
    const conflict = bookings.some(x =>
      x.barberId === booking.barberId &&
      x.date === booking.date &&
      ["pending","confirmed"].includes(x.status) &&
      bookingsOverlap(
        booking.time,
        booking.durationMinutes,
        x.time,
        x.durationMinutes || 30
      )
    );
    if (conflict) return false;

    bookings.unshift(booking);
    writeJson("bookings.json", bookings);
    return true;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Serializes bookings for the same barber/day so simultaneous requests
    // cannot both claim an overlapping slot.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      [`${booking.barberId}:${booking.date}`]
    );

    const startMinutes = timeToMinutes(booking.time);
    const endMinutes = startMinutes + Number(booking.durationMinutes || 30);

    const conflict = await client.query(`
      SELECT id
      FROM bookings
      WHERE barber_id = $1
        AND booking_date = $2
        AND status IN ('pending','confirmed')
        AND (
          (EXTRACT(HOUR FROM booking_time) * 60 + EXTRACT(MINUTE FROM booking_time)) < $4
        )
        AND (
          (EXTRACT(HOUR FROM booking_time) * 60 + EXTRACT(MINUTE FROM booking_time))
          + duration_minutes > $3
        )
      LIMIT 1
    `, [booking.barberId, booking.date, startMinutes, endMinutes]);

    if (conflict.rows.length) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(`
      INSERT INTO bookings (
        id, created_at, status, name, phone,
        service_id, service_name, barber_id, barber_name,
        booking_date, booking_time, notes, duration_minutes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      booking.id,
      booking.createdAt,
      booking.status,
      booking.name,
      booking.phone,
      booking.serviceId,
      booking.serviceName,
      booking.barberId,
      booking.barberName,
      booking.date,
      booking.time,
      booking.notes,
      booking.durationMinutes
    ]);

    await client.query("COMMIT");
    return true;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}
async function updateBookingStatus(idValue, status) {
  if (!pool) {
    const bookings = readJson("bookings.json", defaultBookings);
    const b = bookings.find(x => x.id === idValue);
    if (!b) return null;
    b.status = status;
    b.updatedAt = new Date().toISOString();
    writeJson("bookings.json", bookings);
    return b;
  }

  const { rows } = await pool.query(`
    UPDATE bookings
    SET status=$2, updated_at=NOW()
    WHERE id=$1
    RETURNING
      id,
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      status,
      name,
      phone,
      service_id AS "serviceId",
      service_name AS "serviceName",
      barber_id AS "barberId",
      barber_name AS "barberName",
      TO_CHAR(booking_date, 'YYYY-MM-DD') AS date,
      TO_CHAR(booking_time, 'HH24:MI') AS time,
      notes,
      duration_minutes AS "durationMinutes"
  `, [idValue, status]);

  return rows[0] || null;
}

async function deleteBookingRecord(idValue) {
  if (!pool) {
    const bookings = readJson("bookings.json", defaultBookings);
    const next = bookings.filter(x => x.id !== idValue);
    if (next.length === bookings.length) return false;
    writeJson("bookings.json", next);
    return true;
  }

  const result = await pool.query(`DELETE FROM bookings WHERE id=$1`, [idValue]);
  return result.rowCount > 0;
}

app.get("/api/public", async (req, res) => {
  const c = await getConfig();
  const safe = {
    businessName: c.businessName, heroText: c.heroText, since: c.since,
    phoneDisplay: c.phoneDisplay, phoneHref: c.phoneHref, whatsappEnabled: validWhatsapp(c.whatsapp) && c.whatsapp !== "000000000",
    email: c.email, address: c.address, mapsUrl: c.mapsUrl, hours: c.hours,
    services: (c.services || []).filter(x => x.active),
    team: (c.team || []).filter(x => x.active),
    testimonials: c.testimonials || []
  };
  res.json(safe);
});

app.post("/api/bookings", async (req, res) => {
  try {
    const body = req.body || {};
    const name = cleanText(body.name, 80);
    const phone = cleanText(body.phone, 40);
    const serviceId = cleanText(body.serviceId, 100);
    const barberId = cleanText(body.barberId, 100);
    const date = cleanText(body.date, 20);
    const time = cleanText(body.time, 10);
    const notes = cleanText(body.notes, 500);

    if (!name || !serviceId || !date || !time) {
      return res.status(400).json({ error: "Name, service, date and time are required." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ error: "Invalid date or time." });
    }

    const config = await getConfig();
    const service = (config.services || []).find(x => x.id === serviceId && x.active);
    const requestedBarber = barberId ? (config.team || []).find(x => x.id === barberId && x.active) : null;
    if (!service) return res.status(400).json({ error: "Service is not available." });
    if (barberId && !requestedBarber) return res.status(400).json({ error: "Barber is not available." });

    const day = new Date(`${date}T12:00:00`).getDay();
    const range = config.hours?.[String(day)];
    if (!range) return res.status(400).json({ error: "The barbershop is closed on that day." });

    const requestedStart = timeToMinutes(time);
    const openingStart = timeToMinutes(range[0]);
    const openingEnd = timeToMinutes(range[1]);
    const durationMinutes = Number(service.minutes || 30);

    if (
      requestedStart < openingStart ||
      requestedStart >= openingEnd ||
      requestedStart + durationMinutes > openingEnd
    ) {
      return res.status(400).json({ error: "That time is outside opening hours." });
    }

    const candidates = requestedBarber
      ? [requestedBarber]
      : (config.team || []).filter(x => x.active);

    if (!candidates.length) {
      return res.status(409).json({ error: "No barbers are available." });
    }

    let booking = null;

    for (const candidate of candidates) {
      const candidateBooking = {
        id: id("bk"),
        createdAt: new Date().toISOString(),
        status: "pending",
        name, phone,
        serviceId: service.id,
        serviceName: service.name,
        barberId: candidate.id,
        barberName: candidate.name,
        date,
        time,
        notes,
        durationMinutes
      };

      const saved = await createBookingRecordIfAvailable(candidateBooking);
      if (saved) {
        booking = candidateBooking;
        break;
      }
    }

    if (!booking) {
      return res.status(409).json({
        error: requestedBarber
          ? "That barber is already booked at this time. Please choose another time or barber."
          : "No barbers are available at this time. Please choose another time."
      });
    }

    let whatsappUrl = "";
    if (validWhatsapp(config.whatsapp) && config.whatsapp !== "000000000") {
      const msg = [
        `Hello! I would like to book at ${config.businessName}.`,
        "",
        `Name: ${name}`,
        `Service: ${service.name}`,
        `Barber: ${booking.barberName}`,
        `Date: ${date}`,
        `Time: ${time}`,
        phone ? `Phone: ${phone}` : "",
        notes ? `Notes: ${notes}` : "",
        "",
        `Booking reference: ${booking.id}`
      ].filter(Boolean).join("\n");
      whatsappUrl = `https://wa.me/${config.whatsapp}?text=${encodeURIComponent(msg)}`;
    }

    res.status(201).json({ ok:true, bookingId: booking.id, whatsappUrl });
  } catch (err) {
    console.error("Create booking failed:", err);
    res.status(500).json({ error: "Could not save the booking." });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const username = cleanText(req.body?.username, 80);
    const password = String(req.body?.password || "");
    const admin = await getAdmin();

    if (username !== admin.username || !verifyPassword(password, admin)) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    makeSession(res, username);
    res.json({ ok:true, username });
  } catch (err) {
    console.error("Admin login failed:", err);
    res.status(500).json({ error: "Could not sign in." });
  }
});

app.post("/api/admin/logout", auth, (req, res) => {
  sessions.delete(req.sessionToken);
  res.setHeader("Set-Cookie", "barber_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok:true });
});

app.get("/api/admin/me", auth, (req, res) => {
  res.json({ username: req.user.username });
});

app.get("/api/admin/data", auth, async (req, res) => {
  try {
    const [config, bookings] = await Promise.all([getConfig(), getBookings()]);
    res.json({ config, bookings });
  } catch (err) {
    console.error("Load admin data failed:", err);
    res.status(500).json({ error: "Could not load admin data." });
  }
});

app.put("/api/admin/business", auth, async (req, res) => {
  const c = await getConfig();
  const b = req.body || {};
  c.businessName = cleanText(b.businessName, 120) || c.businessName;
  c.heroText = cleanText(b.heroText, 300) || c.heroText;
  c.phoneDisplay = cleanText(b.phoneDisplay, 50);
  c.phoneHref = cleanText(b.phoneHref, 50);
  c.whatsapp = cleanText(b.whatsapp, 20);
  c.email = cleanText(b.email, 120);
  c.address = cleanText(b.address, 220);
  c.mapsUrl = cleanText(b.mapsUrl, 500);
  c.since = int(b.since, 1900, 2100, c.since);

  if (b.hours && typeof b.hours === "object") {
    const next = {};
    for (let day=0; day<=6; day++) {
      const raw = b.hours[String(day)];
      if (raw === null) { next[String(day)] = null; continue; }
      if (Array.isArray(raw) && raw.length === 2 && /^\d{2}:\d{2}$/.test(raw[0]) && /^\d{2}:\d{2}$/.test(raw[1]) && raw[0] < raw[1]) {
        next[String(day)] = [raw[0], raw[1]];
      } else {
        next[String(day)] = c.hours[String(day)] ?? null;
      }
    }
    c.hours = next;
  }
  await saveConfig(c);
  res.json({ ok:true, config:c });
});

app.post("/api/admin/services", auth, async (req, res) => {
  const c = await getConfig();
  const b = req.body || {};
  const service = {
    id:id("svc"),
    name:cleanText(b.name,100),
    desc:cleanText(b.desc,250),
    price:cleanText(b.price,30),
    minutes:int(b.minutes,5,240,30),
    category:cleanText(b.category,50) || "Service",
    active:b.active !== false
  };
  if (!service.name || !service.price) return res.status(400).json({ error:"Name and price are required." });
  c.services.push(service); await saveConfig(c);
  res.status(201).json({ ok:true, service });
});

app.put("/api/admin/services/:id", auth, async (req, res) => {
  const c = await getConfig();
  const s = c.services.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error:"Service not found." });
  const b=req.body||{};
  if ("name" in b) s.name=cleanText(b.name,100);
  if ("desc" in b) s.desc=cleanText(b.desc,250);
  if ("price" in b) s.price=cleanText(b.price,30);
  if ("minutes" in b) s.minutes=int(b.minutes,5,240,s.minutes);
  if ("category" in b) s.category=cleanText(b.category,50);
  if ("active" in b) s.active=!!b.active;
  await saveConfig(c); res.json({ ok:true, service:s });
});

app.delete("/api/admin/services/:id", auth, async (req, res) => {
  const c = await getConfig();
  const before = c.services.length;
  c.services = c.services.filter(x => x.id !== req.params.id);
  if (c.services.length === before) return res.status(404).json({ error:"Service not found." });
  await saveConfig(c); res.json({ ok:true });
});

app.post("/api/admin/team", auth, async (req, res) => {
  const c = await getConfig();
  const b=req.body||{};
  const name=cleanText(b.name,100);
  if(!name) return res.status(400).json({error:"Name is required."});
  const person={id:id("barber"),name,initials:cleanText(b.initials,5)||name.slice(0,1).toUpperCase(),role:cleanText(b.role,80)||"Barber",bio:cleanText(b.bio,250),active:b.active!==false};
  c.team.push(person); await saveConfig(c);
  res.status(201).json({ok:true,person});
});

app.put("/api/admin/team/:id", auth, async (req, res) => {
  const c = await getConfig();
  const p = c.team.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({error:"Barber not found."});
  const b=req.body||{};
  if("name" in b) p.name=cleanText(b.name,100);
  if("initials" in b) p.initials=cleanText(b.initials,5);
  if("role" in b) p.role=cleanText(b.role,80);
  if("bio" in b) p.bio=cleanText(b.bio,250);
  if("active" in b) p.active=!!b.active;
  await saveConfig(c); res.json({ok:true,person:p});
});

app.delete("/api/admin/team/:id", auth, async (req,res)=>{
  const c=await getConfig();
  const before=c.team.length;
  c.team=c.team.filter(x=>x.id!==req.params.id);
  if(c.team.length===before) return res.status(404).json({error:"Barber not found."});
  await saveConfig(c); res.json({ok:true});
});

app.put("/api/admin/bookings/:id/status", auth, async (req,res)=>{
  try {
    const status=cleanText(req.body?.status,20);
    if(!["pending","confirmed","cancelled","completed"].includes(status)) {
      return res.status(400).json({error:"Invalid status."});
    }
    const booking = await updateBookingStatus(req.params.id, status);
    if(!booking) return res.status(404).json({error:"Booking not found."});
    res.json({ok:true,booking});
  } catch (err) {
    console.error("Update booking failed:", err);
    res.status(500).json({error:"Could not update booking."});
  }
});

app.delete("/api/admin/bookings/:id", auth, async (req,res)=>{
  try {
    const deleted = await deleteBookingRecord(req.params.id);
    if(!deleted) return res.status(404).json({error:"Booking not found."});
    res.json({ok:true});
  } catch (err) {
    console.error("Delete booking failed:", err);
    res.status(500).json({error:"Could not delete booking."});
  }
});

app.post("/api/admin/password", auth, async (req,res)=>{
  try {
    const current=String(req.body?.currentPassword||"");
    const next=String(req.body?.newPassword||"");
    const admin=await getAdmin();

    if(!verifyPassword(current,admin)) {
      return res.status(400).json({error:"Current password is incorrect."});
    }
    if(next.length<10) {
      return res.status(400).json({error:"New password must be at least 10 characters."});
    }

    const pw=hashPassword(next);
    await saveAdmin({
      username:admin.username,
      ...pw,
      updatedAt:new Date().toISOString()
    });

    sessions.clear();
    res.setHeader("Set-Cookie","barber_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ok:true});
  } catch (err) {
    console.error("Password update failed:", err);
    res.status(500).json({error:"Could not update password."});
  }
});

app.get("/admin", (req,res)=>res.sendFile(path.join(PUBLIC,"admin.html")));

app.use((req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Not found."});
  res.status(404).sendFile(path.join(PUBLIC,"index.html"));
});

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, ()=>{
      console.log(`Barbershop Pro running at http://localhost:${PORT}`);
      console.log(`Admin panel: http://localhost:${PORT}/admin`);
    });
  } catch (err) {
    console.error("Startup failed:", err);
    process.exit(1);
  }
}

start();




