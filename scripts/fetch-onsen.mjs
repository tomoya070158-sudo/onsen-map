// Builds data/onsen.json: every hot spring, onsen facility and public bath in Japan from OpenStreetMap.
// Usage: node scripts/fetch-onsen.mjs            (queries the Overpass API)
//        OVERPASS_FILE=resp.json node scripts/...  (uses a saved Overpass response instead)
import { readFile, writeFile, mkdir } from "node:fs/promises";

const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const PREFS_URL = "https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson";
const QUERY = `[out:json][timeout:600];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
(
  nwr["amenity"="public_bath"](area.jp);
  nwr["natural"="hot_spring"](area.jp);
  nwr["bath:type"="onsen"](area.jp);
);
out center tags;`;

function kindOf(t) {
  if (t["bath:type"] === "onsen" || /温泉/.test(t.name || "")) return "温泉施設";
  if (t.natural === "hot_spring") return "源泉・湯けむり";
  if (/銭湯/.test(t.name || "") || t["bath:type"] === "sento") return "銭湯";
  return "公衆浴場";
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function prefLookup(geo) {
  const prefs = geo.features.map(f => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let box = [180, 90, -180, -90];
    for (const p of polys) for (const [x, y] of p[0]) box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    return { name: f.properties.nam_ja, polys, box };
  });
  return (lng, lat) => {
    for (const p of prefs) {
      if (lng < p.box[0] || lng > p.box[2] || lat < p.box[1] || lat > p.box[3]) continue;
      if (p.polys.some(poly => inRing(lng, lat, poly[0]))) return p.name;
    }
    return "";
  };
}

async function overpass() {
  if (process.env.OVERPASS_FILE) return JSON.parse(await readFile(process.env.OVERPASS_FILE, "utf8"));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(OVERPASS, { method: "POST", body: new URLSearchParams({ data: QUERY }), headers: { "User-Agent": "yukemuri-map (GitHub Actions)" } });
    if (r.ok) return r.json();
    console.error(`Overpass returned ${r.status}, attempt ${attempt}`);
    await new Promise(res => setTimeout(res, 30000 * attempt));
  }
  throw new Error("Overpass API did not answer");
}

const [data, geo] = await Promise.all([overpass(), fetch(PREFS_URL).then(r => r.json())]);
const prefOf = prefLookup(geo);
const seen = new Set();
const items = [];
for (const el of data.elements) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if (lat == null) continue;
  const name = t["name:ja"] || t.name || (t.natural === "hot_spring" ? "源泉（名称なし）" : "温泉施設（名称なし）");
  const key = `${name}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const website = t.website || t["contact:website"] || "";
  items.push([name, +lat.toFixed(5), +lng.toFixed(5), kindOf(t), prefOf(lng, lat), website, `${el.type}/${el.id}`]);
}
const updated = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
await mkdir("data", { recursive: true });
await writeFile("data/onsen.json", JSON.stringify({ updated, source: "© OpenStreetMap contributors (ODbL)", items }));
console.log(`wrote ${items.length} places`);
