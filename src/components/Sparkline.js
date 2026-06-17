import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Path, Defs, LinearGradient, Stop } from 'react-native-svg';

export default function Sparkline({ data = [], color = '#d4ff00', width = 80, height = 32, filled = false }) {
  if (!data || data.length < 2) return <View style={{ width, height }} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y];
  });

  const pointsStr = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  if (filled) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    const pathD = [
      `M ${first[0].toFixed(1)},${(height - pad).toFixed(1)}`,
      ...pts.map(([x, y]) => `L ${x.toFixed(1)},${y.toFixed(1)}`),
      `L ${last[0].toFixed(1)},${(height - pad).toFixed(1)}`,
      'Z',
    ].join(' ');

    const gradId = `g${color.replace('#', '')}`;

    return (
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.25" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path d={pathD} fill={`url(#${gradId})`} />
        <Polyline
          points={pointsStr}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={pointsStr}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
    