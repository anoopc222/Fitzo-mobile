import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Circle, Ellipse, G, Text as SvgText } from 'react-native-svg';

const MUSCLE_MAP = {
  chest:       ['bench press','push up','chest fly','incline','dips','cable fly','pec','chest press'],
  front_delt:  ['bench press','shoulder press','overhead press','ohp','front raise','incline'],
  side_delt:   ['shoulder press','overhead press','ohp','lateral raise','side raise'],
  rear_delt:   ['face pull','reverse fly','rear delt','row'],
  biceps:      ['curl','hammer','chin up','pull up','lat pulldown','preacher','row'],
  triceps:     ['tricep','skull crusher','close grip','dip','pushdown','overhead press','shoulder press','ohp','bench press','push up'],
  forearms:    ['wrist curl','forearm','farmer'],
  traps:       ['shrug','deadlift','face pull','upright row'],
  lats:        ['pull up','chin up','lat pulldown','row','pullover','deadlift'],
  lower_back:  ['deadlift','good morning','hyperextension','rdl','romanian'],
  abs:         ['crunch','plank','sit up','leg raise','ab','russian twist','cable crunch'],
  quads:       ['squat','leg press','lunge','leg extension','hack squat','step up','bulgarian'],
  hamstrings:  ['rdl','romanian','deadlift','leg curl','good morning','lunge','squat'],
  glutes:      ['hip thrust','glute','squat','deadlift','rdl','romanian','lunge','leg press'],
  calves:      ['calf','raise','jump rope'],
};

function getRecoveryColor(hoursAgo, bgElevated) {
  if (hoursAgo === null) return bgElevated;
  if (hoursAgo < 24)  return '#ef4444';
  if (hoursAgo < 48)  return '#f59e0b';
  if (hoursAgo < 72)  return '#4ade80';
  return bgElevated;
}

function computeMuscleColors(recentExercises, bgElevated) {
  // Build a map of muscle -> most recent hoursAgo
  const mostRecent = {};

  const nowMs = Date.now();

  for (const ex of recentExercises) {
    const nameLower = (ex.name || '').toLowerCase();
    // Parse sessionDate as start of that day (local midnight)
    const dateParts = (ex.sessionDate || '').split('-');
    if (dateParts.length !== 3) continue;
    const sessionMs = new Date(
      parseInt(dateParts[0], 10),
      parseInt(dateParts[1], 10) - 1,
      parseInt(dateParts[2], 10)
    ).getTime();
    const hoursAgo = (nowMs - sessionMs) / 3600000;

    for (const [muscle, keywords] of Object.entries(MUSCLE_MAP)) {
      const matched = keywords.some(kw => nameLower.includes(kw));
      if (matched) {
        if (mostRecent[muscle] === undefined || hoursAgo < mostRecent[muscle]) {
          mostRecent[muscle] = hoursAgo;
        }
      }
    }
  }

  const result = {};
  for (const muscle of Object.keys(MUSCLE_MAP)) {
    result[muscle] = getRecoveryColor(
      mostRecent[muscle] !== undefined ? mostRecent[muscle] : null,
      bgElevated
    );
  }
  return result;
}

function FrontBody({ mc, bgElevated }) {
  const dimFill = bgElevated;
  const dimOpacity = 0.35;

  return (
    <Svg width={140} height={280} viewBox="0 0 140 280">
      {/* Torso silhouette */}
      <Rect x={50} y={26} width={40} height={110} rx={10} fill="#ffffff" opacity={0.04} />

      {/* Head */}
      <Circle cx={70} cy={18} r={13} fill={dimFill} opacity={dimOpacity} />
      {/* Neck */}
      <Rect x={64} y={29} width={12} height={10} rx={4} fill={dimFill} opacity={dimOpacity} />

      {/* Front delts */}
      <Ellipse cx={45} cy={48} rx={14} ry={10} fill={mc.front_delt} opacity={0.9} />
      <Ellipse cx={95} cy={48} rx={14} ry={10} fill={mc.front_delt} opacity={0.9} />

      {/* Side delts */}
      <Ellipse cx={36} cy={52} rx={9} ry={8} fill={mc.side_delt} opacity={0.9} />
      <Ellipse cx={104} cy={52} rx={9} ry={8} fill={mc.side_delt} opacity={0.9} />

      {/* Chest */}
      <Rect x={52} y={40} width={36} height={30} rx={8} fill={mc.chest} opacity={0.9} />

      {/* Biceps */}
      <Rect x={26} y={56} width={16} height={34} rx={7} fill={mc.biceps} opacity={0.9} />
      <Rect x={98} y={56} width={16} height={34} rx={7} fill={mc.biceps} opacity={0.9} />

      {/* Forearms */}
      <Rect x={22} y={94} width={13} height={30} rx={5} fill={mc.forearms} opacity={0.9} />
      <Rect x={105} y={94} width={13} height={30} rx={5} fill={mc.forearms} opacity={0.9} />

      {/* Abs — 6 cells, 2 columns */}
      <Rect x={58} y={74}  width={16} height={10} rx={3} fill={mc.abs} opacity={0.9} />
      <Rect x={76} y={74}  width={16} height={10} rx={3} fill={mc.abs} opacity={0.9} />
      <Rect x={58} y={86}  width={16} height={10} rx={3} fill={mc.abs} opacity={0.9} />
      <Rect x={76} y={86}  width={16} height={10} rx={3} fill={mc.abs} opacity={0.9} />
      <Rect x={58} y={98}  width={16} height={10} rx={3} fill={mc.abs} opacity={0.9} />
      <Rect x={76} y={98}  width={16} height={10} rx={3} fill={mc.abs} opacity={0.9} />

      {/* Quads */}
      <Rect x={52} y={130} width={25} height={64} rx={10} fill={mc.quads} opacity={0.9} />
      <Rect x={81} y={130} width={25} height={64} rx={10} fill={mc.quads} opacity={0.9} />

      {/* Calves */}
      <Rect x={55} y={198} width={19} height={52} rx={8} fill={mc.calves} opacity={0.9} />
      <Rect x={78} y={198} width={19} height={52} rx={8} fill={mc.calves} opacity={0.9} />
    </Svg>
  );
}

function BackBody({ mc, bgElevated }) {
  const dimFill = bgElevated;
  const dimOpacity = 0.35;

  return (
    <Svg width={140} height={280} viewBox="0 0 140 280">
      {/* Torso silhouette */}
      <Rect x={50} y={26} width={40} height={110} rx={10} fill="#ffffff" opacity={0.04} />

      {/* Head */}
      <Circle cx={70} cy={18} r={13} fill={dimFill} opacity={dimOpacity} />
      {/* Neck */}
      <Rect x={64} y={29} width={12} height={10} rx={4} fill={dimFill} opacity={dimOpacity} />

      {/* Traps */}
      <Rect x={52} y={38} width={18} height={22} rx={6} fill={mc.traps} opacity={0.9} />
      <Rect x={70} y={38} width={18} height={22} rx={6} fill={mc.traps} opacity={0.9} />

      {/* Rear delts */}
      <Ellipse cx={42} cy={52} rx={14} ry={9} fill={mc.rear_delt} opacity={0.9} />
      <Ellipse cx={98} cy={52} rx={14} ry={9} fill={mc.rear_delt} opacity={0.9} />

      {/* Lats */}
      <Rect x={46} y={50} width={24} height={60} rx={8} fill={mc.lats} opacity={0.9} />
      <Rect x={70} y={50} width={24} height={60} rx={8} fill={mc.lats} opacity={0.9} />

      {/* Triceps */}
      <Rect x={26} y={56} width={16} height={34} rx={7} fill={mc.triceps} opacity={0.9} />
      <Rect x={98} y={56} width={16} height={34} rx={7} fill={mc.triceps} opacity={0.9} />

      {/* Lower back */}
      <Rect x={52} y={112} width={36} height={24} rx={7} fill={mc.lower_back} opacity={0.9} />

      {/* Glutes */}
      <Rect x={52} y={136} width={24} height={30} rx={10} fill={mc.glutes} opacity={0.9} />
      <Rect x={76} y={136} width={24} height={30} rx={10} fill={mc.glutes} opacity={0.9} />

      {/* Hamstrings */}
      <Rect x={52} y={168} width={24} height={56} rx={10} fill={mc.hamstrings} opacity={0.9} />
      <Rect x={76} y={168} width={24} height={56} rx={10} fill={mc.hamstrings} opacity={0.9} />
    </Svg>
  );
}

const LEGEND = [
  { label: 'Fatigued',   color: '#ef4444' },
  { label: 'Recovering', color: '#f59e0b' },
  { label: 'Recovered',  color: '#4ade80' },
  { label: 'Ready',      color: null },       // bgElevated filled in at render
];

export default function MuscleRecoveryMap({ recentExercises = [], colors }) {
  const bgCard     = colors?.bgCard     || '#12121e';
  const bgElevated = colors?.bgElevated || '#1c1c2e';
  const border     = colors?.border     || '#2a2a3d';
  const textMuted  = colors?.textMuted  || '#6b7280';
  const textPrimary = colors?.text      || '#f1f5f9';

  const mc = useMemo(
    () => computeMuscleColors(recentExercises, bgElevated),
    [recentExercises, bgElevated]
  );

  return (
    <View style={[styles.card, { backgroundColor: bgCard, borderColor: border }]}>
      <Text style={[styles.title, { color: textPrimary }]}>MUSCLE RECOVERY</Text>

      <View style={styles.bodiesRow}>
        {/* FRONT */}
        <View style={styles.bodyCol}>
          <Text style={[styles.viewLabel, { color: textMuted }]}>FRONT</Text>
          <FrontBody mc={mc} bgElevated={bgElevated} />
        </View>

        {/* BACK */}
        <View style={styles.bodyCol}>
          <Text style={[styles.viewLabel, { color: textMuted }]}>BACK</Text>
          <BackBody mc={mc} bgElevated={bgElevated} />
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legendRow}>
        {LEGEND.map(({ label, color }) => (
          <View key={label} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: color ?? bgElevated, borderColor: border },
              ]}
            />
            <Text style={[styles.legendLabel, { color: textMuted }]}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  title: {
    fontSize: 11,
    fontVariant: ['small-caps'],
    letterSpacing: 1.4,
    fontWeight: '700',
    marginBottom: 12,
  },
  bodiesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  bodyCol: {
    alignItems: 'center',
  },
  viewLabel: {
    fontSize: 8,
    fontFamily: 'monospace',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 14,
    flexWrap: 'wrap',
    rowGap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
  },
  legendLabel: {
    fontSize: 10,
    letterSpacing: 0.3,
  },
});
