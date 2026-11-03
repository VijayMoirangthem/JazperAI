import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { theme } from '@/theme/tokens';

interface PluginLogoProps {
  logoKey: string;
  name: string;
  size?: number;
}

const TINTS = ['#e8f0fe', '#fde8e8', '#e6f6ec', '#fff4e0', '#f0e8fe', '#e0f7f4'];

function tintFor(key: string): string {
  const sum = [...key].reduce((n, c) => n + c.charCodeAt(0), 0);
  return TINTS[sum % TINTS.length];
}

/** Simple self-drawn logos (no downloaded brand images). Unknown keys get a letter tile. */
export function PluginLogo({ logoKey, name, size = 44 }: PluginLogoProps) {
  const inner = size * 0.56;
  let glyph: React.ReactNode;
  switch (logoKey) {
    case 'gmail':
      glyph = (
        <Svg width={inner} height={inner} viewBox="0 0 24 24">
          <Rect x="2" y="5" width="20" height="14" rx="2.5" fill="#ffffff" stroke="#d93025" strokeWidth="2" />
          <Path d="M3 7l9 6.5L21 7" fill="none" stroke="#d93025" strokeWidth="2" strokeLinejoin="round" />
        </Svg>
      );
      break;
    case 'google-calendar':
      glyph = (
        <View style={[styles.calendar, { width: inner, height: inner }]}>
          <Text style={[styles.calendarText, { fontSize: inner * 0.5 }]}>31</Text>
        </View>
      );
      break;
    case 'google-drive':
      glyph = (
        <Svg width={inner} height={inner} viewBox="0 0 24 24">
          <Path d="M8 3h8l7 12h-8z" fill="#fbbc04" />
          <Path d="M8 3L1 15l4 6 7-12z" fill="#0f9d58" />
          <Path d="M5 21h14l4-6H9z" fill="#4285f4" />
        </Svg>
      );
      break;
    case 'slack':
      glyph = (
        <Svg width={inner} height={inner} viewBox="0 0 24 24">
          <Rect x="3" y="9" width="8" height="4" rx="2" fill="#36c5f0" />
          <Rect x="13" y="3" width="4" height="8" rx="2" fill="#2eb67d" />
          <Rect x="13" y="13" width="8" height="4" rx="2" fill="#ecb22e" />
          <Rect x="7" y="13" width="4" height="8" rx="2" fill="#e01e5a" />
        </Svg>
      );
      break;
    case 'notion':
      glyph = (
        <View style={[styles.letter, { width: inner, height: inner, backgroundColor: '#111111', borderRadius: 6 }]}>
          <Text style={[styles.letterText, { color: '#ffffff', fontSize: inner * 0.62 }]}>N</Text>
        </View>
      );
      break;
    case 'github':
      glyph = <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: '#24292f' }} />;
      break;
    case 'linear':
      glyph = <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: '#5e6ad2' }} />;
      break;
    case 'stripe':
      glyph = (
        <View style={[styles.letter, { width: inner, height: inner, backgroundColor: '#635bff', borderRadius: 6 }]}>
          <Text style={[styles.letterText, { color: '#ffffff', fontSize: inner * 0.62 }]}>S</Text>
        </View>
      );
      break;
    default:
      glyph = <Text style={[styles.letterText, { color: theme.colors.text, fontSize: inner * 0.7 }]}>{(name[0] ?? '?').toUpperCase()}</Text>;
  }
  const background = ['gmail', 'google-calendar', 'google-drive', 'slack', 'notion', 'github', 'linear', 'stripe'].includes(logoKey)
    ? theme.colors.background
    : tintFor(logoKey);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { width: size, height: size, borderRadius: size * 0.27, backgroundColor: background }]}
    >
      {glyph}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
  calendar: { borderRadius: 5, backgroundColor: '#4285f4', alignItems: 'center', justifyContent: 'center' },
  calendarText: { color: '#ffffff', fontWeight: '700' },
  letter: { alignItems: 'center', justifyContent: 'center' },
  letterText: { fontWeight: '700' },
});
