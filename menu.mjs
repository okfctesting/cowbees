import { getStore } from "@netlify/blobs";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

// constant-time string compare
function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const IMG_OK = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const ID = /^[a-z0-9_-]{1,24}$/i;
const okP = (v) => Number.isFinite(v) && v >= 0 && v < 1e6;
const okImg = (v) => typeof v === "string" && v.length <= 400000 && IMG_OK.test(v);

function validate(body) {
  if (!body || typeof body !== "object" || !body.items || typeof body.items !== "object") return "bad data";
  if (body.whatsapp !== undefined && !(typeof body.whatsapp === "string" && /^\d{10,15}$/.test(body.whatsapp))) return "bad whatsapp";
  if (body.delivery !== undefined && !okP(body.delivery)) return "bad delivery charge";
  if (body.topping !== undefined && !okP(body.topping)) return "bad topping price";
  if (body.pay !== undefined) {
    if (!body.pay || typeof body.pay !== "object") return "bad pay";
    for (const k of Object.keys(body.pay)) {
      if (k !== "jazzcash" && k !== "easypaisa") return "bad pay";
      const e = body.pay[k];
      if (!e || typeof e !== "object") return "bad pay";
      if (e.on !== undefined && typeof e.on !== "boolean") return "bad pay";
      if (e.number !== undefined && !(typeof e.number === "string" && /^\d{10,15}$/.test(e.number))) return "bad pay number";
      if (e.title !== undefined && (typeof e.title !== "string" || e.title.length > 60)) return "bad pay title";
      if (e.img !== undefined && !okImg(e.img)) return "bad pay logo";
    }
  }
  if (body.custom !== undefined) {
    const c = body.custom;
    if (!c || typeof c !== "object") return "bad custom";
    const secs = c.sections === undefined ? [] : c.sections;
    const its = c.items === undefined ? [] : c.items;
    if (!Array.isArray(secs) || !Array.isArray(its)) return "bad custom";
    if (secs.length > 30 || its.length > 300) return "too many new items";
    for (const s of secs) {
      if (!s || typeof s !== "object" || !ID.test(s.id || "")) return "bad section";
      if (typeof s.title !== "string" || !s.title.trim() || s.title.length > 40) return "bad section name";
      if (s.emoji !== undefined && (typeof s.emoji !== "string" || s.emoji.length > 8)) return "bad section emoji";
      if (s.on !== undefined && typeof s.on !== "boolean") return "bad section";
      if (s.first !== undefined && typeof s.first !== "boolean") return "bad section";
    }
    const seen = new Set();
    for (const e of its) {
      if (!e || typeof e !== "object" || !ID.test(e.id || "") || seen.has(e.id)) return "bad new item id";
      seen.add(e.id);
      if (!ID.test(e.sec || "")) return "bad new item section";
      if (typeof e.name !== "string" || !e.name.trim() || e.name.length > 120) return "bad new item name";
      if (e.desc !== undefined && (typeof e.desc !== "string" || e.desc.length > 200)) return "bad description";
      if (e.on !== undefined && typeof e.on !== "boolean") return "bad new item";
      if (e.isNew !== undefined && typeof e.isNew !== "boolean") return "bad new item";
      if (!okP(e.price)) return "bad new item price";
      if (e.img !== undefined && !okImg(e.img)) return "bad image";
    }
  }
  if (body.order !== undefined) {
    const o = body.order;
    if (!o || typeof o !== "object" || Array.isArray(o)) return "bad order";
    const okList = (a) => Array.isArray(a) && a.length <= 400 && a.every((x) => typeof x === "string" && ID.test(x));
    if (o.cats !== undefined && !okList(o.cats)) return "bad order";
    if (o.items !== undefined) {
      if (!o.items || typeof o.items !== "object" || Array.isArray(o.items)) return "bad order";
      const ks = Object.keys(o.items);
      if (ks.length > 100) return "bad order";
      for (const k of ks) if (!ID.test(k) || !okList(o.items[k])) return "bad order";
    }
  }
  const ids = Object.keys(body.items);
  if (ids.length > 300) return "too many items";
  for (const id of ids) {
    if (!ID.test(id)) return "bad item id";
    const e = body.items[id];
    if (!e || typeof e !== "object") return "bad item";
    if (e.name !== undefined && (typeof e.name !== "string" || e.name.length > 120)) return "bad name";
    if (e.price !== undefined && !okP(e.price)) return "bad price";
    if (e.off !== undefined && typeof e.off !== "boolean") return "bad item";
    if (e.img !== undefined && !okImg(e.img)) return "bad image";
  }
  return null;
}

export default async (req) => {
  const url = new URL(req.url);
  const password = process.env.ADMIN_PASSWORD || "";
  const given = req.headers.get("x-admin-key") || "";
  const authed = () => password.length > 0 && same(password, given);

  if (req.method === "GET") {
    if (url.searchParams.get("auth")) {
      if (!password) return json({ error: "ADMIN_PASSWORD is not set on Netlify" }, 500);
      if (!authed()) {
        await new Promise((r) => setTimeout(r, 800)); // slow down guessing
        return json({ error: "wrong password" }, 401);
      }
      return json({ ok: true }, 200, { "cache-control": "no-store" });
    }
    let data = null;
    try { data = await getStore("cowbees").get("menu", { type: "json" }); } catch (e) { data = null; }
    return json(data || { v: 1, items: {} }, 200, { "cache-control": "public, max-age=30" });
  }

  if (req.method === "PUT") {
    if (!authed()) {
      await new Promise((r) => setTimeout(r, 800));
      return json({ error: "wrong password" }, 401);
    }
    const text = await req.text();
    if (text.length > 5000000) return json({ error: "too large" }, 413);
    let body;
    try { body = JSON.parse(text); } catch (e) { return json({ error: "bad json" }, 400); }
    const bad = validate(body);
    if (bad) return json({ error: bad }, 400);
    body.v = 1;
    body.updated = new Date().toISOString();
    await getStore("cowbees").setJSON("menu", body);
    return json({ ok: true, updated: body.updated }, 200, { "cache-control": "no-store" });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/menu" };
