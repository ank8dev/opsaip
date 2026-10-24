// What stays on desktop, said plainly, with one thing you can do about it now:
// send it to the top of your desktop inbox.

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { T, useMotion, usePalette } from '../theme/theme';
import { enter, exit } from '../theme/motion';
import { haptic } from '../lib/haptics';
import { Button } from '../components/Button';
import { CheckIcon, DesktopIcon } from '../components/Icons';

export default function DesktopSheet() {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { title, text } = useLocalSearchParams<{ title?: string; text?: string }>();
  const [sent, setSent] = useState(false);
  // a desktop-only action was tapped: one warning tap as the sheet opens
  useEffect(() => {
    haptic.warning();
  }, []);
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40, gap: 18 }}>
      <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface }}>
        <DesktopIcon color={p.text} size={26} />
      </View>
      <View style={{ gap: 6 }}>
        <T v="title">{title ?? 'This one is on desktop'}</T>
        <T v="body" tone="secondary">{text ?? 'Setup, access and anything destructive are done in Opsaip on your computer.'}</T>
      </View>
      {sent ? (
        <Animated.View key="sent" entering={enter(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 }}>
          <CheckIcon color={p.signal} size={18} strokeWidth={1.8} />
          <T v="calloutMedium" style={{ flex: 1 }}>On top of your desktop inbox</T>
        </Animated.View>
      ) : (
        <Animated.View key="send" exiting={exit(m)} style={{ gap: 10 }}>
          <Button
            label="Send to my desktop"
            kind="primary"
            onPress={() => {
              haptic.success();
              setSent(true);
              setTimeout(() => router.back(), 1100);
            }}
          />
          <Button label="Not now" kind="quiet" onPress={() => router.back()} />
        </Animated.View>
      )}
    </View>
  );
}
