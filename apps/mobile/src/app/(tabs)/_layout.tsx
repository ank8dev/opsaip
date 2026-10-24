// Three tabs under one glass tab bar: the thread with Opsaip, the team, settings.
// Scenes cross-fade with a slight settle (a large motion, 720ms) instead of cutting;
// with reduced motion they only cross-fade.

import { Easing } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { Dock, DockSpaceProvider } from '../../components/Dock';
import { usePalette, useMotion } from '../../theme/theme';
import { duration } from '../../theme/motion';

const OUT = Easing.bezier(0.32, 0.72, 0, 1);

export default function TabsLayout() {
  const p = usePalette();
  const m = useMotion();
  return (
    <DockSpaceProvider>
      <Tabs
        tabBar={(props) => <Dock {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: p.bg },
          animation: 'fade',
          transitionSpec: { animation: 'timing', config: { duration: duration('large'), easing: OUT } },
          sceneStyleInterpolator: ({ current }) => ({
            sceneStyle: {
              opacity: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
              transform: [{ scale: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: m.reduced ? [1, 1, 1] : [0.985, 1, 0.985] }) }],
            },
          }),
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Thread' }} />
        <Tabs.Screen name="team" options={{ title: 'Team' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
    </DockSpaceProvider>
  );
}
