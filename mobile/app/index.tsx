import { View, StyleSheet, ScrollView } from 'react-native';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  Screen,
  Text,
  Button,
  Card,
  Chip,
  Badge,
  Divider,
  EmptyState,
  Spinner,
  SheetModal,
} from '@/components/ui';
import { theme } from '@/theme/tokens';

export default function DemoScreen() {
  const [sheetVisible, setSheetVisible] = React.useState(false);

  return (
    <Screen>
      <StatusBar style="light" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text variant="title" style={styles.sectionTitle}>
          Theme Demo
        </Text>
        <Text variant="body" style={styles.description}>
          This screen demonstrates all base UI components from the design system.
        </Text>

        <Divider />

        <Text variant="caption" style={styles.sectionTitle}>
          Text Variants
        </Text>
        <View style={styles.componentGroup}>
          <Text variant="title">Title (24px, bold)</Text>
          <Text variant="body">Body (15px, normal)</Text>
          <Text variant="muted">Muted (15px, 55% opacity)</Text>
          <Text variant="caption">Caption (11px, uppercase)</Text>
        </View>

        <Divider />

        <Text variant="caption" style={styles.sectionTitle}>
          Buttons
        </Text>
        <View style={styles.componentGroup}>
          <Button title="Primary" variant="primary" style={styles.button} />
          <Button title="Secondary" variant="secondary" style={styles.button} />
          <Button title="Danger" variant="danger" style={styles.button} />
          <Button title="Loading" variant="primary" loading style={styles.button} />
          <Button title="Disabled" variant="primary" disabled style={styles.button} />
        </View>

        <Divider />

        <Text variant="caption" style={styles.sectionTitle}>
          Card
        </Text>
        <Card style={styles.card}>
          <Text variant="body">This is a card with surface background and border.</Text>
        </Card>

        <Divider />

        <Text variant="caption" style={styles.sectionTitle}>
          Chips
        </Text>
        <View style={StyleSheet.flatten([styles.chipGroup]) ?? undefined}>
          <Chip>Default</Chip>
          <Chip selected>Selected</Chip>
          <Chip onPress={() => {}}>Pressable</Chip>
        </View>

        <Divider />

        <Text variant="caption" style={styles.sectionTitle}>
          Badges (Score Colors)
        </Text>
        <View style={StyleSheet.flatten([styles.badgeGroup]) ?? undefined}>
          <Badge score={95} />
          <Badge score={75} />
          <Badge score={45} />
          <Badge score={null} />
        </View>

        <Divider />

        <Text variant="caption" style={styles.sectionTitle}>
          EmptyState
        </Text>
        <Card style={StyleSheet.flatten([styles.card, { height: 150 }]) ?? undefined}>
          <EmptyState
            title="No messages yet"
            subtitle="Start a conversation to see messages here"
            actionLabel="New chat"
            onAction={() => {}}
          />
        </Card>

        <Divider />

        <Text variant="caption" style={styles.sectionTitle}>
          Spinner
        </Text>
        <View style={styles.componentGroup}>
          <Spinner size="large" />
          <Spinner size="small" color={theme.colors.warning} />
        </View>

        <Divider />

        <Text variant="caption" style={styles.sectionTitle}>
          SheetModal
        </Text>
        <Button title="Open Sheet" variant="primary" onPress={() => setSheetVisible(true)} style={styles.button} />

        <SheetModal
          visible={sheetVisible}
          onClose={() => setSheetVisible(false)}
          title="Sheet Modal"
          accessibilityLabel="Demo sheet modal"
        >
          <Text variant="body">This is a bottom sheet modal with a title and content.</Text>
          <Button title="Close" variant="secondary" onPress={() => setSheetVisible(false)} style={{ marginTop: 16 }} />
        </SheetModal>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  sectionTitle: {
    marginBottom: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  description: {
    marginBottom: theme.spacing.lg,
    lineHeight: 22,
  },
  componentGroup: {
    marginVertical: theme.spacing.sm,
  },
  button: {
    width: '100%',
    marginBottom: theme.spacing.sm,
  },
  card: {
    width: '100%',
  },
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -theme.spacing.xs,
  },
  badgeGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -theme.spacing.xs,
  },
});