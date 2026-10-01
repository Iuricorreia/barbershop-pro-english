const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const PUBLIC = path.join(ROOT, "public");
const sessions = new Map();

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
  const adminPath = path.join(DATA, "admin.json");
  if (!fs.existsSync(adminPath)) {
    const username = process.env.ADMIN_USER || "admin";
    const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
    const pw = hashPassword(password);
    writeJson("admin.json", { username, ...pw, updatedAt: new Date().toISOString() });
    console.log(`Admin created: ${username}`);
  }
}
ensureSeed();

app.get("/api/public", (req, res) => {
  const c = readJson("config.json", defaultConfig);
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

app.post("/api/bookings", (req, res) => {
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

  const config = readJson("config.json", defaultConfig);
  const service = (config.services || []).find(x => x.id === serviceId && x.active);
  const barber = barberId ? (config.team || []).find(x => x.id === barberId && x.active) : null;
  if (!service) return res.status(400).json({ error: "Service is not available." });

  const day = new Date(`${date}T12:00:00`).getDay();
  const range = config.hours?.[String(day)];
  if (!range) return res.status(400).json({ error: "The barbershop is closed on that day." });
  if (time < range[0] || time >= range[1]) return res.status(400).json({ error: "That time is outside opening hours." });

  const bookings = readJson("bookings.json", defaultBookings);
  const booking = {
    id: id("bk"),
    createdAt: new Date().toISOString(),
    status: "pending",
    name, phone,
    serviceId: service.id, serviceName: service.name,
    barberId: barber ? barber.id : "", barberName: barber ? barber.name : "No preference",
    date, time, notes
  };
  bookings.unshift(booking);
  writeJson("bookings.json", bookings);

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
});

app.post("/api/admin/login", (req, res) => {
  const username = cleanText(req.body?.username, 80);
  const password = String(req.body?.password || "");
  const admin = readJson("admin.json", {});
  if (username !== admin.username || !verifyPassword(password, admin)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  makeSession(res, username);
  res.json({ ok:true, username });
});

app.post("/api/admin/logout", auth, (req, res) => {
  sessions.delete(req.sessionToken);
  res.setHeader("Set-Cookie", "barber_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok:true });
});

app.get("/api/admin/me", auth, (req, res) => {
  res.json({ username: req.user.username });
});

app.get("/api/admin/data", auth, (req, res) => {
  res.json({
    config: readJson("config.json", defaultConfig),
    bookings: readJson("bookings.json", defaultBookings)
  });
});

app.put("/api/admin/business", auth, (req, res) => {
  const c = readJson("config.json", defaultConfig);
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
  writeJson("config.json", c);
  res.json({ ok:true, config:c });
});

app.post("/api/admin/services", auth, (req, res) => {
  const c = readJson("config.json", defaultConfig);
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
  c.services.push(service); writeJson("config.json", c);
  res.status(201).json({ ok:true, service });
});

app.put("/api/admin/services/:id", auth, (req, res) => {
  const c = readJson("config.json", defaultConfig);
  const s = c.services.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error:"Service not found." });
  const b=req.body||{};
  if ("name" in b) s.name=cleanText(b.name,100);
  if ("desc" in b) s.desc=cleanText(b.desc,250);
  if ("price" in b) s.price=cleanText(b.price,30);
  if ("minutes" in b) s.minutes=int(b.minutes,5,240,s.minutes);
  if ("category" in b) s.category=cleanText(b.category,50);
  if ("active" in b) s.active=!!b.active;
  writeJson("config.json", c); res.json({ ok:true, service:s });
});

app.delete("/api/admin/services/:id", auth, (req, res) => {
  const c = readJson("config.json", defaultConfig);
  const before = c.services.length;
  c.services = c.services.filter(x => x.id !== req.params.id);
  if (c.services.length === before) return res.status(404).json({ error:"Service not found." });
  writeJson("config.json", c); res.json({ ok:true });
});

app.post("/api/admin/team", auth, (req, res) => {
  const c = readJson("config.json", defaultConfig);
  const b=req.body||{};
  const name=cleanText(b.name,100);
  if(!name) return res.status(400).json({error:"Name is required."});
  const person={id:id("barber"),name,initials:cleanText(b.initials,5)||name.slice(0,1).toUpperCase(),role:cleanText(b.role,80)||"Barber",bio:cleanText(b.bio,250),active:b.active!==false};
  c.team.push(person); writeJson("config.json", c);
  res.status(201).json({ok:true,person});
});

app.put("/api/admin/team/:id", auth, (req, res) => {
  const c = readJson("config.json", defaultConfig);
  const p = c.team.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({error:"Barber not found."});
  const b=req.body||{};
  if("name" in b) p.name=cleanText(b.name,100);
  if("initials" in b) p.initials=cleanText(b.initials,5);
  if("role" in b) p.role=cleanText(b.role,80);
  if("bio" in b) p.bio=cleanText(b.bio,250);
  if("active" in b) p.active=!!b.active;
  writeJson("config.json", c); res.json({ok:true,person:p});
});

app.delete("/api/admin/team/:id", auth, (req,res)=>{
  const c=readJson("config.json", defaultConfig);
  const before=c.team.length;
  c.team=c.team.filter(x=>x.id!==req.params.id);
  if(c.team.length===before) return res.status(404).json({error:"Barber not found."});
  writeJson("config.json",c); res.json({ok:true});
});

app.put("/api/admin/bookings/:id/status", auth, (req,res)=>{
  const bookings=readJson("bookings.json", defaultBookings);
  const b=bookings.find(x=>x.id===req.params.id);
  if(!b) return res.status(404).json({error:"Booking not found."});
  const status=cleanText(req.body?.status,20);
  if(!["pending","confirmed","cancelled","completed"].includes(status)) return res.status(400).json({error:"Invalid status."});
  b.status=status; b.updatedAt=new Date().toISOString();
  writeJson("bookings.json",bookings); res.json({ok:true,booking:b});
});

app.delete("/api/admin/bookings/:id", auth, (req,res)=>{
  const bookings=readJson("bookings.json", defaultBookings);
  const next=bookings.filter(x=>x.id!==req.params.id);
  if(next.length===bookings.length) return res.status(404).json({error:"Booking not found."});
  writeJson("bookings.json",next); res.json({ok:true});
});

app.post("/api/admin/password", auth, (req,res)=>{
  const current=String(req.body?.currentPassword||"");
  const next=String(req.body?.newPassword||"");
  const admin=readJson("admin.json",{});
  if(!verifyPassword(current,admin)) return res.status(400).json({error:"Current password is incorrect."});
  if(next.length<10) return res.status(400).json({error:"New password must be at least 10 characters."});
  const pw=hashPassword(next);
  writeJson("admin.json",{username:admin.username,...pw,updatedAt:new Date().toISOString()});
  sessions.clear();
  res.setHeader("Set-Cookie","barber_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ok:true});
});

app.get("/admin", (req,res)=>res.sendFile(path.join(PUBLIC,"admin.html")));

app.use((req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Not found."});
  res.status(404).sendFile(path.join(PUBLIC,"index.html"));
});

app.listen(PORT, ()=>{
  console.log(`Barbershop Pro running at http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
