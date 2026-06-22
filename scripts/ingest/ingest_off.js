// Loads a pre-filtered Open Food Facts export and upserts every row into
// public.foods via the Supabase RPC (anon key, see lib/push.js). Source
// data is Open Food Facts (ODbL), https://world.openfoodfacts.org.
//
// The full OFF dump is several GB (~3M products), so rather than shipping
// or parsing it directly, OFF_FILE is expected to already be filtered down
// to a relevant subset (e.g. India-tagged + globally popular products) —
// see the DuckDB query against the Hugging Face Parquet export used to
// produce off_filtered.csv.
//
// Usage:
//   node ingest_off.js

const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { num } = require('./lib/util');
const { pushRows } = require('./lib/push');

const SRC_FILE = process.env.OFF_FILE || '/tmp/fooddata/off/off_filtered.csv';

const records = parse(fs.readFileSync(SRC_FILE), { columns: true, skip_empty_lines: true });

const rows = [];
for (const r of records) {
  if (!r.code || !r.name) continue;
  rows.push({
    source_id: r.code,
    name: r.name,
    brand: r.brands || null,
    category: r.categories ? r.categories.split(',')[0].trim() : null,
    serving_qty: 100,
    serving_unit: 'g',
    calories: num(r.calories),
    protein: num(r.protein),
    carbs: num(r.carbs),
    fats: num(r.fats),
    fiber: num(r.fiber),
    sugar: num(r.sugar),
    sodium_mg: num(r.sodium_mg),
  });
}

pushRows('OFF', rows)
  .then(() => console.log(`Done: ${rows.length} Open Food Facts foods upserted.`))
  .catch(e => { console.error(e); process.exit(1); });
