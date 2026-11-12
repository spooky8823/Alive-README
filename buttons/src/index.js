import { renderButton, fromParams } from "./button-svg.js";
import { renderTable } from "./table-svg.js";
import { renderTree } from "./tree-svg.js";

const ROUTES = { "/btn.svg": renderButton, "/table.svg": renderTable, "/tree.svg": renderTree };
const SITE_ORIGIN = "https://spooky8823.github.io";

function json(data, status = 200, origin = "") {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "vary": "Origin" };
  if (origin === SITE_ORIGIN) headers["access-control-allow-origin"] = SITE_ORIGIN;
  return new Response(JSON.stringify(data), { status, headers });
}
function getSource(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return "Direct";
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "spooky8823.github.io") return "Direct";
    return host.slice(0, 253);
  } catch { return "Direct"; }
}
async function track(req, env, origin) {
  if (!env.VIEWS) return json({ error: "Analytics storage is not configured." }, 503, origin);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON." }, 400, origin); }
  const visitorId = body?.visitorId;
  if (typeof visitorId !== "string" || !/^[0-9a-f-]{36}$/i.test(visitorId)) return json({ error: "Invalid visitor ID." }, 400, origin);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(visitorId));
  const key = "visitor:" + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const existing = await env.VIEWS.get(key);
  if (!existing) {
    const country = /^[A-Z]{2}$/.test(req.cf?.country || "") ? req.cf.country : "XX";
    await env.VIEWS.put(key, JSON.stringify({ country, source: getSource(body.referrer), firstSeen: new Date().toISOString() }));
  }
  return json({ ok: true, counted: !existing }, 200, origin);
}
async function stats(env, origin) {
  if (!env.VIEWS) return json({ error: "Analytics storage is not configured." }, 503, origin);
  const countries = Object.create(null), sources = Object.create(null);
  let total = 0, cursor;
  do {
    const page = await env.VIEWS.list({ prefix: "visitor:", cursor, limit: 1000 });
    const records = await Promise.all(page.keys.map(key => env.VIEWS.get(key.name, "json")));
    for (const record of records) {
      if (!record) continue;
      total++;
      const country = record.country || "XX", source = record.source || "Direct";
      countries[country] = (countries[country] || 0) + 1;
      sources[source] = (sources[source] || 0) + 1;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const sortCounts = obj => Object.entries(obj).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return json({ total, countries: sortCounts(countries), sources: sortCounts(sources) }, 200, origin);
}
export default {
  async fetch(req, env) {
    const u = new URL(req.url), origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS" && (u.pathname === "/api/track" || u.pathname === "/api/stats")) {
      if (origin !== SITE_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": SITE_ORIGIN, "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "Content-Type", "access-control-max-age": "86400", "vary": "Origin"
      }});
    }
    if ((u.pathname === "/api/track" || u.pathname === "/api/stats") && origin !== SITE_ORIGIN) return json({ error: "Origin not allowed." }, 403);
    if (u.pathname === "/api/track" && req.method === "POST") return track(req, env, origin);
    if (u.pathname === "/api/stats" && req.method === "GET") return stats(env, origin);
    const render = ROUTES[u.pathname];
    if (render) {
      if (u.search.length > 8000) return new Response("URL too long", { status: 414 });
      const params = render === renderButton ? fromParams(u.searchParams) : Object.fromEntries(u.searchParams);
      return new Response(render(params), { headers: {
        "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400",
        "access-control-allow-origin": "*", "x-content-type-options": "nosniff"
      }});
    }
    return new Response("Alive Readme: /btn.svg  /table.svg  /tree.svg  /api/track  /api/stats\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
};
