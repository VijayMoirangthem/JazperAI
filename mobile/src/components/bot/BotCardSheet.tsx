import { View, StyleSheet, ScrollView, Platform, TouchableOpacity } from 'react-native';
import React from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { BotCardResponse } from '@/api/types';
import { useBots } from '@/store/bots';
import { Mascot } from '@/components/Mascot';
import { MASCOT_BODY_IDS, MascotBodyId } from '@/mascot/bodies';
import { theme } from '@/theme/tokens';
import { useMascotLooks } from '@/store/mascot';
import { defaultMascotColor, defaultMascotBody } from '@/utils/mascot';
import {
  Screen,
  Text,
  Card,
  Divider,
  Badge,
  Chip,
} from '@/components/ui';

export default function BotCardSheet() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { groups } = useBots();

  const bot = React.useMemo(() => {
    for (const group of groups) {
      const found = group.bots.find((b: { slug: string }) => b.slug === slug);
      if (found) return found as BotCardResponse;
    }
    return null;
  }, [groups, slug]);

  const setLook = useMascotLooks((state) => state.setLook);
  const resetLook = useMascotLooks((state) => state.resetLook);
  const look = useMascotLooks(
    React.useCallback((state) => state.looks[slug], [slug])
  );
  const currentColor = look?.color ?? defaultMascotColor(slug);
  const currentBody = (look?.body ?? defaultMascotBody(slug)) as MascotBodyId;

  if (!bot) {
    return (
      <Screen style={styles.container}>
        <Text variant="body" style={styles.loading}>
          Loading...
        </Text>
      </Screen>
    );
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.handle} />
      <Text variant="title" style={styles.title}>
        {bot.display_name}
      </Text>
      <Text variant="caption" style={styles.position}>
        {bot.position}
      </Text>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={styles.card}>
          <Text variant="caption" style={styles.sectionLabel}>
            Overview
          </Text>
          <Divider />
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Status
            </Text>
            <Chip selected={bot.enabled}>{bot.enabled ? 'Active' : 'Inactive'}</Chip>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Score
            </Text>
            <Badge score={bot.score} />
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Grade
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.grade}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Tier
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.tier}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Group
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.group_label}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Department
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.department}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Reports To
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.reports_to || '—'}
            </Text>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text variant="caption" style={styles.sectionLabel}>
            Timeline
          </Text>
          <Divider />
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Created
            </Text>
            <Text variant="body" style={styles.value}>
              {formatDate(bot.created_at)}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Started
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.started_at ? formatDate(bot.started_at) : '—'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Lifecycle
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.lifecycle}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Last Active
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.last_active_at ? formatDate(bot.last_active_at) : '—'}
            </Text>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text variant="caption" style={styles.sectionLabel}>
            Statistics
          </Text>
          <Divider />
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text variant="caption" style={styles.statLabel}>
                Calls
              </Text>
              <Text variant="title" style={styles.statValue}>
                {bot.calls}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="caption" style={styles.statLabel}>
                Errors
              </Text>
              <Text variant="title" style={styles.statValue}>
                {bot.errors}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="caption" style={styles.statLabel}>
                Thumbs Up
              </Text>
              <Text variant="title" style={styles.statValue}>
                {bot.thumbs_up}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="caption" style={styles.statLabel}>
                Thumbs Down
              </Text>
              <Text variant="title" style={styles.statValue}>
                {bot.thumbs_down}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text variant="caption" style={styles.statLabel}>
                Avg Latency
              </Text>
              <Text variant="title" style={styles.statValue}>
                {bot.avg_latency_ms}ms
              </Text>
            </View>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text variant="caption" style={styles.sectionLabel}>
            Tools
          </Text>
          <Divider />
          {bot.tools.length > 0 ? (
            <View style={styles.toolsList}>
              {bot.tools.map((tool: string) => (
                <Chip key={tool}>{tool}</Chip>
              ))}
            </View>
          ) : (
            <Text variant="muted" style={styles.emptyTools}>
              No tools configured
            </Text>
          )}
        </Card>

        <Card style={styles.card}>
          <Text variant="caption" style={styles.sectionLabel}>
            Advanced
          </Text>
          <Divider />
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Source
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.source}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Memory Namespace
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.memory_namespace}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Role Title
            </Text>
            <Text variant="body" style={styles.value}>
              {bot.role_title}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Slug
            </Text>
            <Text variant="caption" style={styles.value} numberOfLines={1}>
              {bot.slug}
            </Text>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text variant="caption" style={styles.sectionLabel}>
            Appearance
          </Text>
          <Divider />
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Mascot
            </Text>
            <Mascot slug={slug} size={36} animated={false} />
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Colour
            </Text>
            <View style={styles.colorGrid}>
              {Object.entries(theme.mascotColors).map(([key, color]) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.colorSwatch,
                    color === currentColor && styles.colorSwatchSelected,
                  ]}
                  onPress={() => setLook(slug, { color })}
                  accessibilityLabel={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: color === currentColor }}
                >
                  <View style={[styles.colorSwatchInner, { backgroundColor: color }]} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Shape
            </Text>
            <View style={styles.bodyGrid}>
              {MASCOT_BODY_IDS.map((bodyId) => (
                <TouchableOpacity
                  key={bodyId}
                  style={[
                    styles.bodySwatch,
                    bodyId === currentBody && styles.bodySwatchSelected,
                  ]}
                  onPress={() => setLook(slug, { body: bodyId })}
                  accessibilityLabel={bodyId}
                  accessibilityRole="button"
                  accessibilityState={{ selected: bodyId === currentBody }}
                >
                  <Mascot slug={slug} size={28} body={bodyId} animated={false} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Defaults
            </Text>
            {look ? (
              <Chip onPress={() => resetLook(slug)} style={styles.resetChip}>
                Reset to defaults
              </Chip>
            ) : (
              <Text variant="caption" style={styles.resetChip}>
                No custom look to reset
              </Text>
            )}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0b',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
    marginBottom: 4,
  },
  position: {
    textAlign: 'center',
    marginBottom: 24,
    opacity: 0.7,
  },
  loading: {
    textAlign: 'center',
    marginTop: 40,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    marginBottom: 16,
  },
  sectionLabel: {
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  label: {
    opacity: 0.6,
  },
  value: {
    textAlign: 'right',
    maxWidth: '65%',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statItem: {
    width: '30%',
    marginBottom: 12,
    alignItems: 'center',
  },
  statLabel: {
    textAlign: 'center',
    marginBottom: 4,
  },
  statValue: {
    textAlign: 'center',
    fontSize: 18,
  },
  toolsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emptyTools: {
    textAlign: 'center',
    paddingVertical: 16,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginLeft: 8,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorSwatchSelected: {
    borderColor: '#ffffff',
  },
  colorSwatchInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  bodyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginLeft: 8,
  },
  bodySwatch: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  bodySwatchSelected: {
    borderColor: theme.colors.accent,
  },
  resetChip: {
    marginLeft: 8,
  },
});