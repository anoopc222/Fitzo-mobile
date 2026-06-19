import { supabase } from './supabase';

// ─── Health Log marker key → DB column mapping (kept in sync with HealthLogScreen.js) ──
const HL_DB_COL = {
  sugar: 'sugar', hba1c: 'hba1c', avgGlucose: 'avg_glucose',
  chol: 'total_cholesterol', trig: 'triglycerides', hdl: 'hdl', ldl: 'ldl', vldl: 'vldl',
  urea: 'urea', creatinine: 'creatinine', uric: 'uric',
  thyroid: 'tsh', t3: 't3', t4: 't4',
  vitd: 'vitamin_d', vitb12: 'vitamin_b12', hb: 'hemoglobin',
};

function toISO(dateStr) {
  if (!dateStr) return new Date().toISOString();
  // date-only strings get a fixed noon-UTC time so the calendar date never drifts across timezones
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T12:00:00.000Z` : dateStr;
}

function ageToDob(age) {
  const n = parseInt(age, 10);
  if (!n) return null;
  const year = new Date().getFullYear() - n;
  return `${year}-01-01`;
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────
export async function exportBackup(userId) {
  const [
    sessionsRes, weightRes, stepsRes, sleepRes, foodRes,
    measureRes, healthRes, dietRes, profileRes,
  ] = await Promise.all([
    supabase.from('workout_sessions').select('id, date, notes, total_volume, duration_min, calories_burned').eq('user_id', userId).order('date'),
    supabase.from('weight_logs').select('weight, logged_at').eq('user_id', userId).order('logged_at'),
    supabase.from('step_logs').select('steps, activity_type, distance_km, calories_burned, logged_at').eq('user_id', userId).order('logged_at'),
    supabase.from('sleep_logs').select('hours, quality, notes, logged_at').eq('user_id', userId).order('logged_at'),
    supabase.from('food_logs').select('food_name, calories, protein, carbs, fats, serving_size, meal_type, logged_at').eq('user_id', userId).order('logged_at'),
    supabase.from('body_measurements').select('chest, waist, hips, left_arm, right_arm, left_thigh, right_thigh, neck, calf_left, calf_right, logged_at').eq('user_id', userId).order('logged_at'),
    supabase.from('health_logs').select('*').eq('user_id', userId).order('logged_at'),
    supabase.from('diet_plans').select('*').eq('user_id', userId).order('week_number'),
    supabase.from('profiles').select('*').eq('id', userId).single(),
  ]);

  const sessionIds = (sessionsRes.data ?? []).map(s => s.id);
  let exercisesByExId = {};
  let setsByExId = {};
  if (sessionIds.length) {
    const { data: exercises } = await supabase
      .from('workout_exercises')
      .select('id, session_id, exercise_name, order_index')
      .in('session_id', sessionIds);
    const exIds = (exercises ?? []).map(e => e.id);
    let sets = [];
    if (exIds.length) {
      const { data: setsData } = await supabase
        .from('sets')
        .select('exercise_id, set_number, weight_kg, reps')
        .in('exercise_id', exIds)
        .order('set_number');
      sets = setsData ?? [];
    }
    setsByExId = sets.reduce((acc, s) => {
      (acc[s.exercise_id] ??= []).push({ w: s.weight_kg, r: s.reps });
      return acc;
    }, {});
    exercisesByExId = (exercises ?? []).reduce((acc, e) => {
      (acc[e.session_id] ??= []).push({
        name: e.exercise_name,
        sortOrder: e.order_index,
        sets: setsByExId[e.id] ?? [],
      });
      return acc;
    }, {});
  }

  const sessions = (sessionsRes.data ?? []).map(s => ({
    id: s.id,
    date: (s.date ?? '').slice(0, 10),
    day: s.notes || 'Workout',
    notes: '',
    exercises: exercisesByExId[s.id] ?? [],
    sessionType: /rest/i.test(s.notes || '') ? 'rest' : 'lift',
  }));

  const weight = (weightRes.data ?? []).map(w => ({ date: w.logged_at.slice(0, 10), weight: w.weight }));
  const track = (stepsRes.data ?? []).map(t => ({ date: t.logged_at.slice(0, 10), steps: t.steps, actType: t.activity_type }));
  const sleep = (sleepRes.data ?? []).map(s => ({ date: s.logged_at.slice(0, 10), hrs: s.hours, bedtime: '', wake: '', quality: s.quality ? Number(s.quality) || 3 : 3 }));

  const food = {};
  for (const f of foodRes.data ?? []) {
    const date = f.logged_at.slice(0, 10);
    food[date] ??= {};
    food[date][f.meal_type] ??= [];
    food[date][f.meal_type].push({
      name: f.food_name, cal: f.calories, prot: f.protein, carbs: f.carbs, fats: f.fats, qty: f.serving_size || '',
    });
  }

  const measurements = (measureRes.data ?? []).map(m => ({
    date: m.logged_at.slice(0, 10),
    chest: m.chest, waist: m.waist, hips: m.hips,
    armL: m.left_arm, armR: m.right_arm, thighL: m.left_thigh, thighR: m.right_thigh,
    calfL: m.calf_left, calfR: m.calf_right, neck: m.neck,
  }));

  const healthLog = (healthRes.data ?? []).map(rec => {
    const out = { date: rec.logged_at.slice(0, 10) };
    for (const [key, col] of Object.entries(HL_DB_COL)) {
      if (rec[col] != null) out[key] = rec[col];
    }
    if (rec.custom?.length) out._custom = rec.custom;
    return out;
  });

  const diet = (dietRes.data ?? []).map(d => ({
    week: d.week_number, calories: d.calories, carbs: d.carbs, protein: d.protein, fats: d.fats,
    veggies: d.veggies, water: d.water, steps: d.steps_goal, cardio: d.cardio ?? [], sessions: d.sessions_note,
  }));

  const p = profileRes.data ?? {};
  const profile = {
    name: p.full_name ?? '', height: p.height_cm != null ? String(p.height_cm) : '',
    goalWt: p.weight_goal_kg != null ? String(p.weight_goal_kg) : '', goal: p.goal ?? '',
    photo: p.avatar_base64 ?? '',
  };

  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    data: {
      sessions, weight, track, stepGoals: {},
      sleep, sleepGoal: p.sleep_goal_hours ?? null,
      food, mealTemplates: [],
      diet, dietActiveWeek: diet.length ? Math.max(...diet.map(d => d.week)) : null,
      measurements, progressPhotos: [],
      profile, theme: 'classic',
      healthLog, healthLogDefs: [],
    },
  };
}

// ─── RESTORE ─────────────────────────────────────────────────────────────────
export async function restoreBackup(userId, backup) {
  if (!backup || !backup.data) throw new Error('Invalid backup file format');
  const { data } = backup;
  const counts = {};

  // ── Workouts (sessions → exercises → sets) ──
  if (Array.isArray(data.sessions)) {
    await supabase.from('workout_sessions').delete().eq('user_id', userId);
    let imported = 0;
    for (const s of data.sessions) {
      const notes = s.day || (s.sessionType === 'rest' ? 'Rest' : 'Workout');
      const { data: sessionRow, error: sErr } = await supabase
        .from('workout_sessions')
        .insert({ user_id: userId, date: s.date, notes })
        .select('id')
        .single();
      if (sErr) throw sErr;
      for (let i = 0; i < (s.exercises ?? []).length; i++) {
        const ex = s.exercises[i];
        const { data: exRow, error: exErr } = await supabase
          .from('workout_exercises')
          .insert({ session_id: sessionRow.id, exercise_name: ex.name, order_index: ex.sortOrder ?? i })
          .select('id')
          .single();
        if (exErr) throw exErr;
        const setRows = (ex.sets ?? []).map((set, idx) => ({
          exercise_id: exRow.id, set_number: idx + 1, weight_kg: set.w ?? null, reps: set.r ?? null,
        }));
        if (setRows.length) {
          const { error: setErr } = await supabase.from('sets').insert(setRows);
          if (setErr) throw setErr;
        }
      }
      imported++;
    }
    counts.sessions = imported;
  }

  // ── Weight ──
  if (Array.isArray(data.weight)) {
    await supabase.from('weight_logs').delete().eq('user_id', userId);
    const rows = data.weight.map(w => ({ user_id: userId, weight: w.weight, logged_at: toISO(w.date) }));
    if (rows.length) { const { error } = await supabase.from('weight_logs').insert(rows); if (error) throw error; }
    counts.weight = rows.length;
  }

  // ── Steps ──
  if (Array.isArray(data.track)) {
    await supabase.from('step_logs').delete().eq('user_id', userId);
    const rows = data.track.map(t => ({
      user_id: userId, steps: t.steps, activity_type: t.actType || 'walk', logged_at: toISO(t.date),
    }));
    if (rows.length) { const { error } = await supabase.from('step_logs').insert(rows); if (error) throw error; }
    counts.steps = rows.length;
  }

  // ── Sleep ──
  if (Array.isArray(data.sleep)) {
    await supabase.from('sleep_logs').delete().eq('user_id', userId);
    const rows = data.sleep.map(s => ({
      user_id: userId, hours: s.hrs, quality: String(s.quality ?? 3), logged_at: toISO(s.date),
    }));
    if (rows.length) { const { error } = await supabase.from('sleep_logs').insert(rows); if (error) throw error; }
    counts.sleep = rows.length;
  }
  if (data.sleepGoal != null) {
    const { error } = await supabase.from('profiles').update({ sleep_goal_hours: data.sleepGoal }).eq('id', userId);
    if (error) throw error;
  }

  // ── Food log ──
  if (data.food && typeof data.food === 'object') {
    await supabase.from('food_logs').delete().eq('user_id', userId);
    const rows = [];
    for (const [date, meals] of Object.entries(data.food)) {
      for (const [mealType, items] of Object.entries(meals)) {
        for (const item of items ?? []) {
          rows.push({
            user_id: userId,
            food_name: item.emoji ? `${item.emoji} ${item.name}` : item.name,
            calories: item.cal ?? 0, protein: item.prot ?? 0, carbs: item.carbs ?? 0, fats: item.fats ?? 0,
            serving_size: item.qty || null, meal_type: mealType, logged_at: toISO(date),
          });
        }
      }
    }
    if (rows.length) { const { error } = await supabase.from('food_logs').insert(rows); if (error) throw error; }
    counts.food = rows.length;
  }

  // ── Diet plans ──
  if (Array.isArray(data.diet)) {
    await supabase.from('diet_plans').delete().eq('user_id', userId);
    const rows = data.diet.map(d => ({
      user_id: userId, week_number: d.week, calories: d.calories ?? 0, protein: d.protein ?? 0,
      carbs: d.carbs ?? 0, fats: d.fats ?? 0, veggies: d.veggies ?? '', water: d.water ?? '3L',
      steps_goal: d.steps ?? '12,000', cardio: d.cardio ?? [], sessions_note: d.sessions ?? '',
    }));
    if (rows.length) { const { error } = await supabase.from('diet_plans').insert(rows); if (error) throw error; }
    counts.diet = rows.length;
  }

  // ── Body measurements ──
  if (Array.isArray(data.measurements)) {
    await supabase.from('body_measurements').delete().eq('user_id', userId);
    const rows = data.measurements.map(m => ({
      user_id: userId, chest: m.chest ?? null, waist: m.waist ?? null, hips: m.hips ?? null,
      left_arm: m.armL ?? null, right_arm: m.armR ?? null,
      left_thigh: m.thighL ?? null, right_thigh: m.thighR ?? null,
      neck: m.neck ?? null, calf_left: m.calfL ?? null, calf_right: m.calfR ?? null,
      logged_at: toISO(m.date),
    }));
    if (rows.length) { const { error } = await supabase.from('body_measurements').insert(rows); if (error) throw error; }
    counts.measurements = rows.length;
  }

  // ── Health log ──
  if (Array.isArray(data.healthLog)) {
    await supabase.from('health_logs').delete().eq('user_id', userId);
    const rows = data.healthLog.map(rec => {
      const fields = { user_id: userId, logged_at: toISO(rec.date), custom: rec._custom || [] };
      for (const [key, col] of Object.entries(HL_DB_COL)) {
        if (rec[key] != null) fields[col] = rec[key];
      }
      return fields;
    });
    if (rows.length) { const { error } = await supabase.from('health_logs').insert(rows); if (error) throw error; }
    counts.healthLog = rows.length;
  }

  // ── Profile ──
  if (data.profile) {
    const p = data.profile;
    const fields = {};
    if (p.name) fields.full_name = p.name;
    if (p.goal) fields.goal = p.goal;
    if (p.height) fields.height_cm = parseFloat(p.height);
    if (p.goalWt) fields.weight_goal_kg = parseFloat(p.goalWt);
    if (p.photo) fields.avatar_base64 = p.photo;
    if (p.age && !p.dob) fields.date_of_birth = ageToDob(p.age);
    if (Object.keys(fields).length) {
      const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
      if (error) throw error;
    }
  }

  return counts;
}
