import { supabase } from './supabase';

// Fire-and-forget activity feed insert — failures are swallowed since posting
// to the feed should never block or surface errors on the primary action
// (finishing a workout, logging weight, etc.) that triggered it.
export function logActivity(userId, type, title, detail) {
  if (!userId) return;
  supabase.from('activity_feed').insert({ user_id: userId, type, title, detail }).then(({ error }) => {
    if (error) console.warn('logActivity failed:', error.message);
  });
}
