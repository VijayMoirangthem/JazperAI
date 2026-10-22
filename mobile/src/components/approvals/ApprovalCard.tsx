import { View, StyleSheet } from 'react-native';
import React from 'react';
import { ApprovalRequest } from '@/api/types';
import { Button, Chip, Text } from '@/components/ui';
import { hasUntrustedMarker } from '@/utils/approvals';
import { theme } from '@/theme/tokens';

export interface ApprovalCardProps {
  request: ApprovalRequest;
  responding?: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

export function ApprovalCard({ request, responding = false, onApprove, onDeny }: ApprovalCardProps) {
  const untrusted = hasUntrustedMarker(request.summary);
  const tierDanger = request.tier >= 3;

  return (
    <View style={styles.card} accessibilityLabel={`Approval ${request.action}`}>
      <View style={styles.topRow}>
        <Chip
          textStyle={tierDanger ? styles.tierDangerText : styles.tierText}
          style={tierDanger ? styles.tierDanger : styles.tier}
        >
          Tier {request.tier}
        </Chip>
        <Text style={styles.time}>{formatTime(request.created_at)}</Text>
      </View>

      <Text style={styles.action}>{request.action}</Text>
      <Text style={styles.requester}>{request.requester}</Text>

      {untrusted ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            This action was requested after reading external content. Check it is what you asked for.
          </Text>
        </View>
      ) : null}

      <Text style={styles.summary}>{request.summary}</Text>

      <View style={styles.actions}>
        <Button
          title="Deny"
          variant="secondary"
          onPress={onDeny}
          disabled={responding}
          style={styles.actionButton}
          accessibilityLabel={`Deny ${request.action}`}
        />
        <Button
          title="Approve"
          variant="primary"
          onPress={onApprove}
          loading={responding}
          style={styles.actionButton}
          accessibilityLabel={`Approve ${request.action}`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    marginHorizontal: theme.spacing.md,
    marginVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tier: {
    backgroundColor: theme.colors.raised,
  },
  tierDanger: {
    backgroundColor: 'rgba(239,68,68,0.18)',
    borderColor: theme.colors.danger,
  },
  tierText: {
    color: theme.colors.text,
  },
  tierDangerText: {
    color: theme.colors.danger,
  },
  time: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.xs,
  },
  action: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.lg,
    fontWeight: '600',
  },
  requester: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.sm,
  },
  warning: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderRadius: theme.radii.button,
    borderWidth: 1,
    borderColor: theme.colors.warning,
    padding: theme.spacing.md,
  },
  warningText: {
    color: theme.colors.warning,
    fontSize: theme.fontSizes.sm,
  },
  summary: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  actionButton: {
    minWidth: 104,
  },
});
