// Shared helpers for the food-database ingest scripts.

// CoFID/CNF/USDA source files mark missing/trace values as "Tr", "N", "" etc.
// Coerce anything that isn't a plain finite number to null so we never
// insert NaN/garbage into the foods table.
function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'tr' || s.toLowerCase() === 'n') return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function sqlStr(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlNum(v) {
  return v === null || v === undefined ? 'null' : String(v);
}

// Writes a foods table upsert as batched INSERT ... ON CONFLICT statements.
const NUTRIENT_COLS = ['calories', 'protein', 'carbs', 'fats', 'fiber', 'sugar', 'sodium_mg',
  'saturated_fat', 'cholesterol_mg', 'potassium_mg', 'calcium_mg', 'iron_mg', 'magnesium_mg', 'zinc_mg',
  'vitamin_a_mcg', 'vitamin_c_mg', 'vitamin_d_mcg', 'vitamin_e_mg', 'vitamin_k_mcg',
  'vitamin_b6_mg', 'vitamin_b12_mcg', 'thiamin_mg', 'riboflavin_mg', 'niacin_mg', 'folate_mcg'];

function writeInsertSql(stream, source, rows, batchSize = 500) {
  const cols = ['source', 'source_id', 'name', 'brand', 'category', 'serving_qty', 'serving_unit', ...NUTRIENT_COLS];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map(r => `(${sqlStr(source)}, ${sqlStr(r.source_id)}, ${sqlStr(r.name)}, ${sqlStr(r.brand)}, ${sqlStr(r.category)}, ${sqlNum(r.serving_qty)}, ${sqlStr(r.serving_unit)}, ${NUTRIENT_COLS.map(c => sqlNum(r[c])).join(', ')})`).join(',\n');
    const updateSet = NUTRIENT_COLS.map(c => `${c} = excluded.${c}`).join(', ');
    stream.write(`insert into public.foods (${cols.join(', ')})\nvalues\n${values}\non conflict (source, source_id) where source_id is not null\ndo update set name = excluded.name, brand = excluded.brand, category = excluded.category, ${updateSet};\n\n`);
  }
}

module.exports = { num, sqlStr, sqlNum, writeInsertSql };
