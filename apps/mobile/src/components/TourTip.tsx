// The guided tour's hint on the screen it took you to: one line about what you're looking at,
// and a way back to the thread, where the next step is waiting. Hidden in the thread itself.

import { View } from 'react-native';
import { usePathname } from 'expo-router';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../state/store';
import { T, useMotion, usePalette } from '../theme/theme';
import { radius } from '../theme/tokens';
import { enter, exit } from '../theme/motion';
import { Button } from './Button';

export function TourTip() {
  const p = usePalette();
  const m = useMotion();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const { state, backToTour } = useStore();
  const tip = state.tour.tip;
  if (!tip || path === '/') return null;
  return (
    <Animated.View
      entering={enter(m, 'medium')}
      exiting={exit(m, 'medium')}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 96 }}
    >
      <View
        style={{
          borderRadius: radius.xl, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, padding: 16, gap: 12,
          shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 10 },
        }}
      >
        <T v="caption" tone="signal">Tour</T>
        <T v="callout">{tip}</T>
        <Button label="Back to the tour" kind="primary" small onPress={backToTour} style={{ alignSelf: 'flex-start' }} />
      </View>
    </Animated.View>
  );
}
