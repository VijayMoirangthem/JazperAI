import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { ChevronDown, Shuffle } from 'lucide-react-native';
import { SheetHeader, SheetScreen, CircleButton, useToast } from '@/components/ui/kit';
import { Button } from '@/components/ui';
import { Mascot, MascotState } from '@/components/Mascot';
import { MascotBodyId } from '@/mascot/bodies';
import { LookPicker } from '@/components/LookPicker';
import { MASCOT_PALETTE, theme } from '@/theme/tokens';
import { MascotPaletteName, PICKER_BODIES, colorHex } from '@/utils/mascot';
import { getSession } from '@/api/session';
import { useBots } from '@/store/bots';
import { useMascotLooks } from '@/store/mascot';
import { insertMessage } from '@/db/chat';
import { useHome } from '@/store/home';

const RANDOM_COLORS: MascotPaletteName[] = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink', 'brown'];

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export default function CreateBotSheet() {
  const router = useRouter();
  const toast = useToast((s) => s.show);
  const setLook = useMascotLooks((s) => s.setLook);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [instructions, setInstructions] = useState('');
  const [showRole, setShowRole] = useState(false);
  const [body, setBody] = useState<MascotBodyId>(() => pick(PICKER_BODIES));
  const [colorKey, setColorKey] = useState<MascotPaletteName>(() => pick(RANDOM_COLORS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<MascotState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hop = () => {
    setState('happy');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 900);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const hex = MASCOT_PALETTE[colorKey];
  const valid = name.trim().length >= 2;

  const create = async () => {
    const session = getSession();
    if (!session || !valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await session.client.createBot(
        {
          display_name: name.trim(),
          role_title: role.trim() || undefined,
          instructions: instructions.trim() || undefined,
          look: { body, color: colorKey },
        },
        session.creds
      );
      setLook(created.slug, { body, color: colorHex(colorKey) });
      insertMessage({
        bot_slug: created.slug,
        role: 'assistant',
        from_slug: created.slug,
        text: `Hi, I'm ${created.display_name}. What should I help with first?`,
        ts: Date.now(),
        status: 'done',
      });
      await useBots.getState().loadBots(session.client);
      useHome.getState().refresh();
      router.back();
      setTimeout(() => router.push(`/chat/${created.slug}` as Href), 220);
    } catch {
      setError("Couldn't create the bot. Check that Jasper is running and try again.");
      toast('Nothing was lost. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetScreen height="tall">
      <SheetHeader title="Create New Bot" />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.preview}>
          <Mascot slug="new-bot-preview" size={150} animated state={state} body={body} color={hex} />
          <View style={styles.shuffle}>
            <CircleButton
              label="Shuffle shape and colour"
              size={36}
              tone="grey"
              onPress={() => {
                setBody(pick(PICKER_BODIES));
                setColorKey(pick(RANDOM_COLORS));
                hop();
              }}
            >
              <Shuffle size={16} color={theme.colors.text} />
            </CircleButton>
          </View>
        </View>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name your bot"
          placeholderTextColor={theme.colors.faint}
          maxLength={40}
          autoFocus
          returnKeyType="done"
          style={styles.name}
          accessibilityLabel="Bot name"
        />

        <Pressable onPress={() => setShowRole((v) => !v)} style={styles.disclosure} accessibilityRole="button" accessibilityLabel="Add a role">
          <Text style={styles.disclosureText}>Add a role</Text>
          <ChevronDown size={16} color={theme.colors.muted} style={{ transform: [{ rotate: showRole ? '180deg' : '0deg' }] }} />
        </Pressable>
        {showRole ? (
          <View style={{ gap: 10 }}>
            <TextInput value={role} onChangeText={setRole} maxLength={60} placeholder="Role, for example Personal Shopper" placeholderTextColor={theme.colors.faint} style={styles.field} accessibilityLabel="Role" />
            <TextInput
              value={instructions}
              onChangeText={setInstructions}
              maxLength={500}
              multiline
              placeholder="What should it do?"
              placeholderTextColor={theme.colors.faint}
              style={[styles.field, { minHeight: 90, textAlignVertical: 'top' }]}
              accessibilityLabel="What should it do"
            />
          </View>
        ) : null}

        <LookPicker
          body={body}
          colorKey={colorKey}
          onChange={(next) => {
            setBody(next.body);
            setColorKey(next.colorKey);
            hop();
          }}
        />

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <Button title="Create" onPress={create} loading={busy} disabled={!valid} style={styles.create} />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', paddingBottom: 16, gap: 18 },
  preview: { alignItems: 'center', justifyContent: 'center', height: 170, width: '100%' },
  shuffle: { position: 'absolute', right: 4, bottom: 4 },
  name: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    backgroundColor: theme.colors.chipBg,
    textAlign: 'center',
    fontSize: theme.fontSizes.lg,
    fontWeight: '500',
    color: theme.colors.text,
  },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 4 },
  disclosureText: { fontSize: theme.fontSizes.sm, color: theme.colors.muted },
  field: { width: '100%', borderRadius: 14, backgroundColor: theme.colors.chipBg, paddingHorizontal: 14, paddingVertical: 12, fontSize: theme.fontSizes.body, color: theme.colors.text },
  error: { color: theme.colors.danger, fontSize: theme.fontSizes.sm, textAlign: 'center' },
  create: { height: 52, marginTop: 8 },
});
