// Haptics, one rule each. Only on things you do — never on scrolling or on updates
// that arrive by themselves. Settings › Appearance › Haptics turns them all off.
// Expo Go supports all of these.
//
//   select   choosing: the mode menu, a mode, a recipient, a toggle, a quick reply
//   light    touching the composer: focus, attaching, removing an attachment
//   send     sending a message (medium impact)
//   success  something went through: approve, merge, send done, a reminder set
//   warning  a failed run opened, a desktop-only action tapped

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const native = Platform.OS === 'ios' || Platform.OS === 'android';
let enabled = true;
/** Settings › Appearance › Haptics. */
export const setHaptics = (on: boolean) => {
  enabled = on;
};
const quiet = (p: Promise<unknown>) => p.catch(() => undefined);
const on = () => native && enabled;

export const haptic = {
  select: () => on() && quiet(Haptics.selectionAsync()),
  light: () => on() && quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  send: () => on() && quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => on() && quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => on() && quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
