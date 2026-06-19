// Tokens mirror the ActivityTracker web app's "Classic" theme (--bg, --accent, etc.)
// so native screens render with an exact visual match.

export const darkColors = {
  bg:          '#0c0c0f',
  surface:     '#131318',
  card:        '#1a1a22',
  dim:         'rgba(255,255,255,0.05)',
  border:      'rgba(255,255,255,0.07)',
  border2:     'rgba(245,158,11,0.2)',

  accent:      '#f59e0b',
  accent2:     '#fb7185',
  accentText:  '#0c0c0f', // text color drawn on top of accent-filled surfaces

  text:        '#f5f0e8',
  textMuted:   'rgba(245,240,232,0.6)',
  textDim:     'rgba(245,240,232,0.3)',

  good:        '#34d399',
  danger:      '#f87171',
  warn:        '#fbbf24',
  pink:        '#e879f9',

  success:     '#34d399',
  warning:     '#fbbf24',

  // legacy aliases kept for screens not yet migrated
  bgCard:      '#1a1a22',
  bgElevated:  '#131318',
  accentDim:   '#d97706',
  purple:      '#e879f9',
  blue:        '#818cf8',
};

export const lightColors = {
  bg:          '#f7f5f0',
  surface:     '#edeae3',
  card:        '#ffffff',
  dim:         'rgba(0,0,0,0.06)',
  border:      'rgba(0,0,0,0.08)',
  border2:     'rgba(217,119,6,0.25)',

  accent:      '#d97706',
  accent2:     '#e11d48',
  accentText:  '#ffffff',

  text:        '#1c1917',
  textMuted:   'rgba(28,25,23,0.65)',
  textDim:     'rgba(28,25,23,0.38)',

  good:        '#059669',
  danger:      '#dc2626',
  warn:        '#d97706',
  pink:        '#a21caf',

  success:     '#059669',
  warning:     '#d97706',

  bgCard:      '#ffffff',
  bgElevated:  '#edeae3',
  accentDim:   '#b45309',
  purple:      '#a21caf',
  blue:        '#4f46e5',
};

export const radius = { lg: 16, md: 12, sm: 8, pill: 20 };

// backward-compat default export (dark) — screens not yet themed use this
export const colors = darkColors;
