# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start               # Start Expo dev server (scan QR with Expo Go)
npm run android         # Launch on Android emulator/device
npm run ios             # Launch on iOS simulator/device
npm run web             # Launch in browser
npx expo install <pkg>  # Always use this (not npm install) for RN/Expo packages
```

No test runner or linter is configured yet.

## Architecture

Expo managed workflow — no native `/ios` or `/android` folders. Supabase project: `xinxibghdusqxfudctnl`.

### Entry points
- `index.js` → registers `App`
- `App.js` → root: `QueryClientProvider` → `AuthProvider` → `AppNavigator`

### Source layout (`src/`)
```
lib/supabase.js          Supabase client (API-only, no local DB); credentials already set
context/AuthContext.js   Auth state via Supabase; exposes useAuth()
theme/colors.js          Design tokens: bg #080810, accent #d4ff00, purple #9d4edd
theme/typography.js      Font sizes (xs–xxxl) and weights (normal–black)
components/
  Sparkline.js           SVG polyline sparkline (react-native-svg); props: data, color, width, height, filled
  CircularGauge.js       SVG circular progress ring; props: percent, size, strokeWidth, color, value, label
  MonthHeatmap.js        Calendar grid heatmap; props: data ({YYYY-MM-DD: value}), color, month, year
navigation/
  AppNavigator.js        Root: auth gate (loading → Auth or Tab stack); NO drawer (removed: TurboModule crash)
  AuthNavigator.js       Login + Register screens
  TabNavigator.js        6 bottom tabs: Home | Workout | Log | Steps | Weight | Sleep
                         "Home" is a native-stack: HomeMain + More + Progress/Measurements/HealthLog/Calculators/Profile/Settings
                         Secondary screens accessed via "..." button on HomeScreen header → MoreScreen
screens/
  auth/LoginScreen.js
  auth/RegisterScreen.js
  HomeScreen.js           Dashboard: greeting, quick-nav, 4 sparkline stat cards, alert banners, week/month stats tabs + Cut Score
  WorkoutScreen.js        Session list (search + expand) + active session modal (add exercises, log sets with RPE)
  WeightScreen.js         KG/LBS toggle, goal ring, trend chart (30D/60D/90D/ALL), month heatmap, history
  StepsScreen.js          KM/MI toggle, streak, week comparison, month heatmap, goal presets
  SleepScreen.js          Recovery score gauge, sleep debt, consistency, trend chart, month heatmap
  FoodLogScreen.js        Date nav, calorie ring, macro bars, 4 meal types, add food modal
  ProgressScreen.js       Exercise cards: PR badge, trend badge (Improving/Plateau/Declining), last 10 sessions
  CalculatorsScreen.js    20 local calculators (accordion): BMI, TDEE, 1RM, Body Fat, Macros, HR Zones, Wilks, etc.
  MeasurementsScreen.js   7-site body measurements: NOW/PREV/DIFF comparison table + history
  HealthLogScreen.js      8 blood markers with ref ranges + traffic-light status; tabs: Latest/History/Reference
  ProfileScreen.js        Stats tiles, goal picker (10 options), body stats (height/DOB/sex), sign-out
  SettingsScreen.js       Daily goals modal, theme cards, notification toggles, danger zone
  MoreScreen.js           Grid of 8 links to secondary screens
```

### Key design decisions

**No local storage** — `gcTime: 0` + `staleTime: 0` in QueryClient means React Query never persists data. Every screen mounts fresh from Supabase. `expo-secure-store` is used only for the Supabase auth JWT.

**No drawer, no reanimated** — Removed `DrawerNavigator` and `react-native-reanimated` due to TurboModule crash in Expo Go SDK 54. Navigation uses only `@react-navigation/native-stack` + `@react-navigation/bottom-tabs`.

**Charts** — All charts use `react-native-svg` directly (no animation libs): Sparkline = SVG Polyline, CircularGauge = SVG Circle with strokeDasharray, trend charts = inline SVG Polyline + Line + Text components inside screens.

**Data flow** — Each screen owns `useQuery` + `useMutation`. On mutation success, `qc.invalidateQueries` triggers fresh Supabase fetch. Pull-to-refresh calls `refetch()`.

**Navigation from HomeScreen** — `nav()` helper: Weight/Steps/Log/Sleep/Workout are direct tabs; secondary screens (Progress/Measurements/etc.) → `navigation.navigate('More')` (HomeStack route showing MoreScreen). HomeScreen header "..." also goes to More.

### Supabase tables (all live, RLS enabled)
| Table | Key columns |
|---|---|
| `profiles` | `id`, `full_name`, `goal`, `height_cm`, `sex`, `date_of_birth`, `weight_goal_kg`, `step_goal`, `sleep_goal_hours`, `calorie_target`, `protein_target`, `carbs_target`, `fats_target`, `bio` |
| `weight_logs` | `user_id`, `weight`, `logged_at`, `notes` |
| `step_logs` | `user_id`, `steps`, `goal`, `distance_km`, `calories_burned`, `logged_at` |
| `workout_sessions` | `user_id`, `date`, `total_volume`, `duration_min`, `calories_burned`, `notes` |
| `workout_exercises` | `session_id`, `exercise_name`, `order_index` — RLS via join to `workout_sessions` |
| `sets` | `exercise_id`, `set_number`, `weight_kg`, `reps`, `rpe` — RLS via join through `workout_exercises` |
| `food_logs` | `user_id`, `food_name`, `calories`, `protein`, `carbs`, `fats`, `serving_size`, `meal_type`, `logged_at` |
| `sleep_logs` | `user_id`, `hours`, `quality`, `notes`, `logged_at` |
| `body_measurements` | `user_id`, `chest`, `waist`, `hips`, `left_arm`, `right_arm`, `left_thigh`, `right_thigh`, `logged_at` |
| `health_logs` | `user_id`, `glucose`, `total_cholesterol`, `hdl`, `ldl`, `triglycerides`, `vitamin_d`, `vitamin_b12`, `tsh`, `notes`, `logged_at` |

### Before publishing (EAS Build)
1. Run `npx eas build --platform android` / `--platform ios`
2. iOS requires Apple Developer account; Android can self-sign for Play Store
