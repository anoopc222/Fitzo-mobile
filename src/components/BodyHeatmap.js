import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Rect, Polygon, Circle } from 'react-native-svg';

// region key -> shape def relative to a 160x260 viewbox, simplified front-view silhouette
const REGIONS = {
  Shoulders:    { type: 'rect', x: 40, y: 28, w: 80, h: 16, rx: 8 },
  Chest:        { type: 'rect', x: 50, y: 46, w: 60, h: 30, rx: 8 },
  'Upper Chest': { type: 'rect', x: 50, y: 46, w: 60, h: 30, rx: 8 },
  Core:         { type: 'rect', x: 56, y: 78, w: 48, h: 38, rx: 6 },
  Biceps:       { type: 'rect', x: 24, y: 46, w: 14, h: 40, rx: 6 },
  Triceps:      { type: 'rect', x: 122, y: 46, w: 14, h: 40, rx: 6 },
  Lats:         { type: 'rect', x: 36, y: 60, w: 14, h: 36, rx: 6 },
  'Mid Back':   { type: 'rect', x: 36, y: 60, w: 14, h: 36, rx: 6 },
  'Side Delts': { type: 'rect', x: 40, y: 28, w: 80, h: 16, rx: 8 },
  'Front Delts': { type: 'rect', x: 40, y: 28, w: 80, h: 16, rx: 8 },
  Quads:        { type: 'rect', x: 50, y: 118, w: 26, h: 56, rx: 8 },
  Hamstrings:   { type: 'rect', x: 84, y: 118, w: 26, h: 56, rx: 8 },
  Glutes:       { type: 'rect', x: 50, y: 110, w: 60, h: 16, rx: 8 },
  Calves:       { type: 'rect', x: 52, y: 176, w: 22, h: 40, rx: 8 },
  Cardiovascular: { type: 'circle', cx: 80, cy: 60, r: 14 },
};

function intensityColor(pct, baseColor) {
  if (pct <= 0) return '#2a2a35';
  const alpha = Math.round(20 + pct * 75).toString(16).padStart(2, '0');
  return `${baseColor}${alpha}`;
}

export default function BodyHeatmap({ data = [], color = '#d4ff00', width = 200, height = 320 }) {
  const max = Math.max(...data.map(d => d.vol), 1);
  const volByMuscle = {};
  data.forEach(d => { volByMuscle[d.muscle] = d.vol; });

  const vbW = 160, vbH = 260;
  const scale = Math.min(width / vbW, height / vbH);

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={vbW * scale} height={vbH * scale} viewBox={`0 0 ${vbW} ${vbH}`}>
        {/* head + neck guide, unfilled — purely structural */}
        <Circle cx={80} cy={14} r={12} fill="none" stroke="#3a3a45" strokeWidth={1.5} />
        {Object.entries(REGIONS).map(([muscle, shape]) => {
          const vol = volByMuscle[muscle] ?? 0;
          const pct = vol / max;
          const fill = intensityColor(pct, color);
          if (shape.type === 'circle') {
            return <Circle key={muscle} cx={shape.cx} cy={shape.cy} r={shape.r} fill={fill} stroke="#3a3a45" strokeWidth={1} />;
          }
          return (
            <Rect key={muscle} x={shape.x} y={shape.y} width={shape.w} height={shape.h}
              rx={shape.rx} fill={fill} stroke="#3a3a45" strokeWidth={1} />
          );
        })}
      </Svg>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 10 }}>
        {data.slice(0, 6).map(d => (
          <View key={d.muscle} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: intensityColor((d.vol / max) || 0, color) }} />
            <Text style={{ fontSize: 10, color: '#888' }}>{d.muscle}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
