import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

export default function CircularGauge({
  percent = 0,
  size = 120,
  strokeWidth = 10,
  color = '#d4ff00',
  bgColor = '#1e1e33',
  value,
  label,
  sublabel,
  valueStyle,
  labelStyle,
}) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const progress = Math.min(100, Math.max(0, percent));
  const dashOffset = circumference - (progress / 100) * circumference;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke={bgColor} strokeWidth={strokeWidth} />
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {value !== undefined && (
          <Text
            style={[
              { color: '#ffffff', fontWeight: '800', fontSize: Math.round(size * 0.2) },
              valueStyle,
            ]}
          >
            {value}
          </Text>
        )}
        {label && (
          <Text
            style={[
              { color: '#8888aa', fontSize: Math.round(size * 0.1), marginTop: 1 },
              labelStyle,
            ]}
          >
            {label}
          </Text>
        )}
        {sublabel && (
          <Text style={{ color, fontSize: Math.round(size * 0.09), marginTop: 2 }}>
            {sublabel}
          </Text>
        )}
      </View>
    </View>
  );
}
