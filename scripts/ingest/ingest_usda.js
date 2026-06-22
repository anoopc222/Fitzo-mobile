// Parses USDA FoodData Central's SR Legacy + Foundation Foods bulk CSV
// exports and upserts every food into public.foods via the Supabase RPC
// (anon key, see lib/push.js). Source data is U.S. government public
// domain (CC0).
//
// Usage:
//   Download & unzip both datasets from
//     https://fdc.nal.usda.gov/download-datasets.html
//   into USDA_SR_DIR / USDA_FOUNDATION_DIR (each containing food.csv,
//   food_nutrient.csv, nutrient.csv, foundation_food.csv for Foundation).
//   node ingest_usda.js

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { num } = require('./lib/util');
const { pushRows } = require('./lib/push');

const SR_DIR = process.env.USDA_SR_DIR || '/tmp/fooddata/usda/sr_legacy/FoodData_Central_sr_legacy_food_csv_2018-04';
const FOUNDATION_DIR = process.env.USDA_FOUNDATION_DIR || '/tmp/fooddata/usda/foundation/FoodData_Central_foundation_food_csv_2025-12-18';

// nutrient.id values (see nutrient.csv), with fallbacks for foods missing the primary id.
const NUTRIENT = {
  calories: [1008],
  protein: [1003],
  fats: [1004],
  carbs: [1005, 1050],
  fiber: [1079],
  sugar: [2000, 1063],
  sodium_mg: [1093],
};

function readCsv(file) {
  return parse(fs.readFileSync(file), { columns: true, skip_empty_lines: true });
}

function buildRows(dir, { foundationOnly = false } = {}) {
  const foodFile = path.join(dir, 'food.csv');
  const nutrientFile = path.join(dir, 'food_nutrient.csv');
  let foods = readCsv(foodFile);

  if (foundationOnly) {
    const allowed = new Set(readCsv(path.join(dir, 'foundation_food.csv')).map(r => r.fdc_id));
    foods = foods.filter(f => allowed.has(f.fdc_id));
  }

  const nutrientsByFdc = new Map();
  for (const row of readCsv(nutrientFile)) {
    let entry = nutrientsByFdc.get(row.fdc_id);
    if (!entry) {
      entry = {};
      nutrientsByFdc.set(row.fdc_id, entry);
    }
    entry[row.nutrient_id] = num(row.amount);
  }

  function pick(entry, ids) {
    if (!entry) return null;
    for (const id of ids) {
      const v = entry[String(id)];
      if (v !== null && v !== undefined) return v;
    }
    return null;
  }

  return foods.map(f => {
    const n = nutrientsByFdc.get(f.fdc_id);
    return {
      source_id: f.fdc_id,
      name: f.description,
      brand: null,
      category: f.food_category_id || null,
      serving_qty: 100,
      serving_unit: 'g',
      calories: pick(n, NUTRIENT.calories),
      protein: pick(n, NUTRIENT.protein),
      carbs: pick(n, NUTRIENT.carbs),
      fats: pick(n, NUTRIENT.fats),
      fiber: pick(n, NUTRIENT.fiber),
      sugar: pick(n, NUTRIENT.sugar),
      sodium_mg: pick(n, NUTRIENT.sodium_mg),
    };
  });
}

const rows = [
  ...buildRows(SR_DIR),
  ...buildRows(FOUNDATION_DIR, { foundationOnly: true }),
];

pushRows('USDA', rows)
  .then(() => console.log(`Done: ${rows.length} USDA foods upserted.`))
  .catch(e => { console.error(e); process.exit(1); });
