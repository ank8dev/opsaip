// After "Sign out": the app rests on the baton until you sign back in. Preview only —
// signing in restores the sample data and opens your default workspace.

import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../state/store';
import { useSettings } from '../state/settings';
import { T, useMotion, usePalette } from '../theme/theme';
import { Appear, enter, exit } from '../theme/motion';
import { Baton } from './Baton';
import { Button } from './Button';

export function SignedOut() {
  const p = usePalette();
  const m = useMotion();
  const insets = useSafeAreaInsets();
  const { signIn } = useStore();
  const { email } = useSettings().settings.profile;
  return (
    <Animated.View entering={enter(m)} exiting={exit(m)} style={{ position: 'absolute', inset: 0, backgroundColor: p.bg, paddingTop: insets.top, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <Appear>
          <Baton height={64} live={false} />
        </Appear>
        <Appear delay={m.enterStep} style={{ alignItems: 'center', gap: 6 }}>
          <T v="display">Opsaip</T>
          <T v="callout" tone="secondary" style={{ textAlign: 'center' }}>Signed out. Your agents keep running.</T>
        </Appear>
      </View>
      <Appear delay={m.enterStep * 2} style={{ gap: 10 }}>
        <Button label={`Sign in as ${email}`} kind="primary" onPress={signIn} />
        <T v="caption" tone="muted" style={{ textAlign: 'center' }}>Preview: no password, the sample data comes back.</T>
      </Appear>
    </Animated.View>
  );
}
