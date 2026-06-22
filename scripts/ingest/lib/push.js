// Pushes rows to Supabase via the temporary _temp_bulk_upsert_foods RPC
// (security definer, bypasses RLS) so ingest scripts can run unattended
// without a service-role key. Drop the RPC after all sources are loaded.
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://xinxibghdusqxfudctnl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpbnhpYmdoZHVzcXhmdWRjdG5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzE5ODcsImV4cCI6MjA5NzI0Nzk4N30.a2XdJJjhZs1hGeKlAwabcQZ7L7axq4nMSR3KFfyBng8';

async function pushRows(source, rows, batchSize = 500) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let pushed = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map(r => ({ source, ...r }));
    const { error } = await supabase.rpc('_temp_bulk_upsert_foods', { rows: batch });
    if (error) throw new Error(`Batch ${i}-${i + batch.length} failed: ${error.message}`);
    pushed += batch.length;
    console.log(`${source}: pushed ${pushed}/${rows.length}`);
  }
}

module.exports = { pushRows };
