// Settings › About › Send feedback. Preview: nothing leaves the phone.

import { useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { T, useMotion, usePalette } from '../theme/theme';
import { font, radius } from '../theme/tokens';
import { enter, exit } from '../theme/motion';
import { haptic } from '../lib/haptics';
import { Button } from '../components/Button';
import { CheckIcon } from '../components/Icons';

export default function FeedbackSheet() {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <T v="title">Send feedback</T>
        <T v="callout" tone="secondary">What felt off, what you missed. It goes to the Opsaip maintainers.</T>
      </View>
      {sent ? (
        <Animated.View entering={enter(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 120 }}>
          <CheckIcon color={p.signal} size={20} strokeWidth={1.8} />
          <T v="calloutMedium">Thanks — got it.</T>
        </Animated.View>
      ) : (
        <Animated.View key="form" exiting={exit(m)} style={{ gap: 16 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder="The reminder chips should…"
            placeholderTextColor={p.textMuted}
            keyboardAppearance={p.scheme}
            selectionColor={p.signal}
            style={{ minHeight: 120, maxHeight: 220, padding: 14, borderRadius: radius.lg, backgroundColor: p.surface, color: p.text, fontFamily: font.sans, fontSize: 16, lineHeight: 22, textAlignVertical: 'top' }}
          />
          <Button
            label="Send"
            kind="primary"
            disabled={!text.trim()}
            onPress={() => {
              haptic.success();
              setSent(true);
              setTimeout(() => router.back(), 1200);
            }}
          />
        </Animated.View>
      )}
    </View>
  );
}
