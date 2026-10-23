import { StyleSheet, View } from 'react-native';
import React from 'react';
import { Button, Screen, Text } from '@/components/ui';
import { theme } from '@/theme/tokens';

export interface RootErrorProps {
  error: unknown;
  retry: () => void;
}

export function RootError({ error, retry }: RootErrorProps) {
  const detail = __DEV__ && error instanceof Error ? error.message : null;

  return (
    <Screen>
      <View style={styles.container}>
        <Text variant="title" style={styles.title}>
          Something went wrong
        </Text>
        <Text variant="muted" style={styles.body}>
          Jasper hit an unexpected problem. Restart the screen to keep going.
        </Text>
        {detail ? (
          <Text variant="caption" style={styles.detail} numberOfLines={4}>
            {detail}
          </Text>
        ) : null}
        <Button title="Restart" onPress={retry} style={styles.button} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
  detail: {
    textAlign: 'center',
    textTransform: 'none',
  },
  button: {
    marginTop: theme.spacing.md,
  },
});

export default RootError;
