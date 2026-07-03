import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

// AnimatedCircle lets us drive SVG strokeDashoffset from Animated.Value
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

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

  const animPct = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animPct, {
      toValue: progress,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const dashOffset = animPct.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, circumference - (progress / 100) * circumference],
  });

  // Count-up for the value text
  const countAnim = useRef(new Animated.Value(0)).current;
  const numericValue = typeof value === 'number' ? value : parseFloat(value);
  const hasNumeric = !isNaN(numericValue);
  const [displayVal, setDisplayVal] = useState('0');

  useEffect(() => {
    if (!hasNumeric) return;
    // Use a listener to format the animated number safely — avoids the
    // string outputRange interpolation bug where comma-formatted values
    // (e.g. "8,432") are parsed as multiple numeric components.
    const id = countAnim.addListener(({ value: v }) => {
      setDisplayVal(Number.isInteger(numericValue) ? String(Math.round(v)) : v.toFixed(1));
    });
    Animated.timing(countAnim, {
      toValue: numericValue,
      duration: 900,
      useNativeDriver: false,
    }).start();
    return () => countAnim.removeListener(id);
  }, [numericValue]);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke={bgColor} strokeWidth={strokeWidth} />
        <AnimatedCircle
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
          hasNumeric ? (
            <Text
              style={[
                { color: '#ffffff', fontWeight: '800', fontSize: Math.round(size * 0.2) },
                valueStyle,
              ]}
            >
              {displayVal}
            </Text>
          ) : (
            <Text
              style={[
                { color: '#ffffff', fontWeight: '800', fontSize: Math.round(size * 0.2) },
                valueStyle,
              ]}
            >
              {value}
            </Text>
          )
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
