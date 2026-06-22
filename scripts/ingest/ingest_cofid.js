// Parses the UK government's CoFID (McCance & Widdowson's Composition of
// Foods Integrated Dataset) spreadsheet and upserts every row into
// public.foods via the Supabase RPC (anon key, see lib/push.js). Source
// data is Crown copyright, Open Government Licence v3.0 (free to reuse).
//
// Usage:
//   curl -L -o /tmp/fooddata/cofid.xlsx "<latest CoFID .xlsx URL from
//     https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid>"
//   node ingest_cofid.js

const xlsx = require('xlsx');
const { num } = require('./lib/util');
const { pushRows } = require('./lib/push');

const SRC_FILE = process.env.COFID_FILE || '/tmp/fooddata/cofid.xlsx';

const wb = xlsx.readFile(SRC_FILE);

const proximates = xlsx.utils.sheet_to_json(wb.Sheets['1.3 Proximates'], { header: 1, defval: '' }).slice(3);
const inorganics = xlsx.utils.sheet_to_json(wb.Sheets['1.4 Inorganics'], { header: 1, defval: '' }).slice(3);

const sodiumByCode = new Map();
for (const row of inorganics) {
  const code = row[0];
  if (!code) continue;
  sodiumByCode.set(code, num(row[7]));
}

const rows = [];
for (const row of proximates) {
  const code = row[0];
  const name = row[1];
  if (!code || !name) continue;
  rows.push({
    source_id: code,
    name,
    brand: null,
    category: row[3] || null,
    serving_qty: 100,
    serving_unit: 'g',
    calories: num(row[12]),
    protein: num(row[9]),
    carbs: num(row[11]),
    fats: num(row[10]),
    fiber: num(row[25]), // AOAC fibre (g)
    sugar: num(row[16]), // Total sugars (g)
    sodium_mg: sodiumByCode.get(code) ?? null,
  });
}

pushRows('CoFID', rows)
  .then(() => console.log(`Done: ${rows.length} CoFID foods upserted.`))
  .catch(e => { console.error(e); process.exit(1); });
