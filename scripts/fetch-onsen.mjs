// Builds data/onsen.json: every hot spring, onsen facility and public bath in Japan from OpenStreetMap.
// Usage: node scripts/fetch-onsen.mjs            (queries the Overpass API)
//        OVERPASS_FILE=resp.json node scripts/...  (uses a saved Overpass response instead)
import { readFile, writeFile, mkdir } from "node:fs/promises";

const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const PREFS_URL = "https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson";
const QUERY = `[out:json][timeout:900];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
(
  nwr["amenity"="public_bath"](area.jp);
  nwr["natural"="hot_spring"](area.jp);
  nwr["bath:type"="onsen"](area.jp);
  nwr["amenity"="spa"](area.jp);
  nwr["leisure"~"^(spa|resort|water_park|sauna)$"]["name"~"温泉|の湯|湯$|スパ|SPA|Spa"](area.jp);
  nwr["tourism"~"^(hotel|guest_house|motel|hostel|resort)$"]["name"~"温泉"](area.jp);
  nwr["name"~"天然温泉|日帰り温泉|日帰り入浴|健康ランド|スーパー銭湯"](area.jp);
);
out center tags;`;

// Things that merely carry an onsen name (stations, roads, car parks, shops) are not places to bathe.
const NOT_A_BATH = ["highway", "railway", "public_transport", "shop", "place", "boundary", "landuse", "route", "office"];
const NOT_A_BATH_AMENITY = /^(parking|parking_entrance|bus_station|toilets|fuel|restaurant|cafe|fast_food|post_box|vending_machine|bicycle_parking|townhall|school)$/;

function kindOf(t) {
  if (t.tourism && t.amenity !== "public_bath") return "温泉宿";
  if (t["bath:type"] === "onsen" || /温泉|の湯|スパ|健康ランド/i.test(t.name || "") || t.leisure || t.amenity === "spa") return "温泉施設";
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
  if (NOT_A_BATH.some(k => t[k]) && t.amenity !== "public_bath" && t.natural !== "hot_spring") continue;
  if (NOT_A_BATH_AMENITY.test(t.amenity || "")) continue;
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if (lat == null) continue;
  const name = t["name:ja"] || t.name || (t.natural === "hot_spring" ? "源泉（名称なし）" : "温泉施設（名称なし）");
  const key = `${name}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const website = t.website || t["contact:website"] || "";
  items.push([name, +lat.toFixed(5), +lng.toFixed(5), kindOf(t), prefOf(lng, lat), website, `${el.type}/${el.id}`]);
}
// data/extra-places.json: places OpenStreetMap is missing, added by hand as name + address.
// Addresses are turned into coordinates with the GSI (国土地理院) address search.
async function geocode(address) {
  const r = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(address)}`);
  if (!r.ok) return null;
  const [hit] = await r.json();
  return hit ? { lng: hit.geometry.coordinates[0], lat: hit.geometry.coordinates[1] } : null;
}
let extras = [];
try { extras = JSON.parse(await readFile("data/extra-places.json", "utf8")); } catch {}
for (const p of extras) {
  const pos = p.lat != null ? { lat: p.lat, lng: p.lng } : await geocode(p.address);
  if (!pos) { console.error(`could not place ${p.name} (${p.address})`); continue; }
  items.push([p.name, +pos.lat.toFixed(5), +pos.lng.toFixed(5), p.kind || "温泉施設", prefOf(pos.lng, pos.lat), p.website || "", ""]);
}
console.log(`added ${extras.length} hand-listed places`);

const updated = new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });
await mkdir("data", { recursive: true });
await writeFile("data/onsen.json", JSON.stringify({ updated, source: "© OpenStreetMap contributors (ODbL)", items }));
console.log(`wrote ${items.length} places`);
