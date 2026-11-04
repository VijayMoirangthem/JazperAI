import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { MASCOT_BODIES, MascotBodyId } from '@/mascot/bodies';
import { MASCOT_PALETTE, theme } from '@/theme/tokens';
import { MASCOT_PALETTE_KEYS, MascotPaletteName, PICKER_BODIES } from '@/utils/mascot';

export function ShapeIcon({ body, color, size }: { body: MascotBodyId; color: string; size: number }) {
  const shape = MASCOT_BODIES[body];
  return (
    <Svg width={size} height={size} viewBox="0 0 228.54 228.54">
      <G transform={shape.fit}>
        <Path d={shape.d} fill={color} />
      </G>
    </Svg>
  );
}

interface LookPickerProps {
  body: MascotBodyId;
  colorKey: MascotPaletteName;
  onChange: (next: { body: MascotBodyId; colorKey: MascotPaletteName }) => void;
}

const ROWS = [MASCOT_PALETTE_KEYS.slice(0, 6), MASCOT_PALETTE_KEYS.slice(6)];

/** The shape grid (2 rows of 4) and the colour palette (2 rows of 6) used when creating or restyling a bot. */
export function LookPicker({ body, colorKey, onChange }: LookPickerProps) {
  const hex = MASCOT_PALETTE[colorKey];
  return (
    <View style={{ alignItems: 'center', gap: 18 }}>
      <View style={styles.shapeGrid} accessibilityLabel="Shape">
        {PICKER_BODIES.map((id) => (
          <Pressable
            key={id}
            onPress={() => onChange({ body: id, colorKey })}
            accessibilityRole="button"
            accessibilityLabel={`${MASCOT_BODIES[id].name} shape`}
            accessibilityState={{ selected: body === id }}
            style={[styles.shapeCell, body === id && styles.ring]}
          >
            <ShapeIcon body={id} color={hex} size={38} />
          </Pressable>
        ))}
      </View>
      <View style={{ gap: 8 }} accessibilityLabel="Colour">
        {ROWS.map((row, i) => (
          <View key={i} style={styles.colorRow}>
            {row.map((key) => (
              <Pressable
                key={key}
                onPress={() => onChange({ body, colorKey: key })}
                accessibilityRole="button"
                accessibilityLabel={`${key} colour`}
                accessibilityState={{ selected: colorKey === key }}
                style={[styles.swatchWrap, colorKey === key && styles.ring]}
              >
                <View style={[styles.swatch, { backgroundColor: MASCOT_PALETTE[key] }, key === 'white' && { borderWidth: 1, borderColor: theme.colors.border }]} />
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shapeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, width: 4 * 64 + 3 * 10 },
  shapeCell: { width: 64, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  ring: { backgroundColor: theme.colors.chipBg, borderWidth: 2, borderColor: theme.colors.border },
  colorRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  swatchWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 30, height: 30, borderRadius: 15 },
});
