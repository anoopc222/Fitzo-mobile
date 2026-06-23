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
const vitamins = xlsx.utils.sheet_to_json(wb.Sheets['1.5 Vitamins'], { header: 1, defval: '' }).slice(3);

const inorganicsByCode = new Map();
for (const row of inorganics) {
  const code = row[0];
  if (!code) continue;
  inorganicsByCode.set(code, {
    sodium_mg: num(row[7]),
    potassium_mg: num(row[8]),
    calcium_mg: num(row[9]),
    magnesium_mg: num(row[10]),
    iron_mg: num(row[12]),
    zinc_mg: num(row[14]),
  });
}

const vitaminsByCode = new Map();
for (const row of vitamins) {
  const code = row[0];
  if (!code) continue;
  vitaminsByCode.set(code, {
    vitamin_a_mcg: num(row[9]), // total retinol equivalent
    vitamin_d_mcg: num(row[10]),
    vitamin_e_mg: num(row[11]),
    vitamin_k_mcg: num(row[12]), // phylloquinone
    thiamin_mg: num(row[13]),
    riboflavin_mg: num(row[14]),
    niacin_mg: num(row[17]), // niacin equivalent
    vitamin_b6_mg: num(row[18]),
    vitamin_b12_mcg: num(row[19]),
    folate_mcg: num(row[20]),
    vitamin_c_mg: num(row[23]),
  });
}

const rows = [];
for (const row of proximates) {
  const code = row[0];
  const name = row[1];
  if (!code || !name) continue;
  const inorg = inorganicsByCode.get(code);
  const vit = vitaminsByCode.get(code);
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
    saturated_fat: num(row[27]), // per 100g food
    cholesterol_mg: num(row[46]),
    sodium_mg: inorg?.sodium_mg ?? null,
    potassium_mg: inorg?.potassium_mg ?? null,
    calcium_mg: inorg?.calcium_mg ?? null,
    magnesium_mg: inorg?.magnesium_mg ?? null,
    iron_mg: inorg?.iron_mg ?? null,
    zinc_mg: inorg?.zinc_mg ?? null,
    vitamin_a_mcg: vit?.vitamin_a_mcg ?? null,
    vitamin_c_mg: vit?.vitamin_c_mg ?? null,
    vitamin_d_mcg: vit?.vitamin_d_mcg ?? null,
    vitamin_e_mg: vit?.vitamin_e_mg ?? null,
    vitamin_k_mcg: vit?.vitamin_k_mcg ?? null,
    vitamin_b6_mg: vit?.vitamin_b6_mg ?? null,
    vitamin_b12_mcg: vit?.vitamin_b12_mcg ?? null,
    thiamin_mg: vit?.thiamin_mg ?? null,
    riboflavin_mg: vit?.riboflavin_mg ?? null,
    niacin_mg: vit?.niacin_mg ?? null,
    folate_mcg: vit?.folate_mcg ?? null,
  });
}

pushRows('CoFID', rows)
  .then(() => console.log(`Done: ${rows.length} CoFID foods upserted.`))
  .catch(e => { console.error(e); process.exit(1); });
