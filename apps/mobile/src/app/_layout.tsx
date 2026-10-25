import { useEffect } from 'react';
import { Appearance, Platform } from 'react-native';
import { Stack, ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { InstrumentSans_400Regular, InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans';
import { DMMono_400Regular, DMMono_500Medium } from '@expo-google-fonts/dm-mono';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeRoot, usePalette } from '../theme/theme';
import { StoreProvider, useStore } from '../state/store';
import { font } from '../theme/tokens';
import { SignedOut } from '../components/SignedOut';
import { TourTip } from '../components/TourTip';
import { SettingsProvider, useSettings } from '../state/settings';
import { hasLiquidGlass, useGlassMode } from '../components/Glass';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 480, fade: true });

export default function RootLayout() {
  const [loaded, error] = useFonts({ InstrumentSans_400Regular, InstrumentSans_500Medium, DMMono_400Regular, DMMono_500Medium });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded, error]);

  // Keep the splash up until the brand fonts are in; no flash of system type.
  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SettingsProvider>
          <ThemeRoot>
            <StoreProvider>
              <Navigation />
            </StoreProvider>
          </ThemeRoot>
        </SettingsProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function Navigation() {
  const p = usePalette();
  const glass = useGlassMode();
  const { appearance } = useSettings().settings;

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(p.bg).catch(() => undefined);
  }, [p.bg]);

  // native pieces (sheets, Liquid Glass, the keyboard) follow Settings › Appearance too
  useEffect(() => {
    if (Platform.OS !== 'web') Appearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
  }, [appearance]);

  const base = p.scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: p.bg, card: p.bg, text: p.text, border: p.border, primary: p.signal } };

  // Sheets: native iOS form sheets. On iOS 26 the sheet itself is Liquid Glass, so the
  // content stays transparent; elsewhere it sits on the surface colour.
  const sheetBg = glass === 'liquid' && hasLiquidGlass ? 'transparent' : p.surface;
  const sheet = {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    sheetCornerRadius: Platform.OS === 'ios' && hasLiquidGlass ? undefined : 24,
    contentStyle: { backgroundColor: sheetBg },
    headerShown: false,
  };

  // Settings sub-pages: a pushed page with the native back bar, in the brand type.
  const page = {
    headerShown: true,
    headerShadowVisible: false,
    headerBackTitle: 'Settings',
    headerTintColor: p.text,
    headerStyle: { backgroundColor: p.bg },
    headerTitleStyle: { fontFamily: font.sansMedium, color: p.text },
    contentStyle: { backgroundColor: p.bg },
  };
  const { state } = useStore();
  const signedOut = state.signedOut;

  return (
    <ThemeProvider value={theme}>
      <StatusBar style={p.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="workspaces" options={{ ...sheet, sheetAllowedDetents: [0.52, 0.92] }} />
        <Stack.Screen name="person/[id]" options={{ ...sheet, sheetAllowedDetents: [0.7, 0.95] }} />
        <Stack.Screen name="details/[id]" options={{ ...sheet, sheetAllowedDetents: [0.7, 0.95] }} />
        <Stack.Screen name="agent/[id]" options={{ ...sheet, sheetAllowedDetents: [0.7, 0.95] }} />
        <Stack.Screen name="run/[id]" options={{ ...sheet, sheetAllowedDetents: [0.7, 0.95] }} />
        <Stack.Screen name="agents" options={{ ...sheet, sheetAllowedDetents: [0.6, 0.95] }} />
        <Stack.Screen name="reminders" options={{ ...sheet, sheetAllowedDetents: [0.55, 0.92] }} />
        <Stack.Screen name="compose/to" options={{ ...sheet, sheetAllowedDetents: [0.62, 0.95] }} />
        <Stack.Screen name="compose/attach" options={{ ...sheet, sheetAllowedDetents: [0.5, 0.8] }} />
        <Stack.Screen name="desktop" options={{ ...sheet, sheetAllowedDetents: [0.5] }} />
        <Stack.Screen name="feedback" options={{ ...sheet, sheetAllowedDetents: [0.6] }} />
        <Stack.Screen name="prefs/profile" options={{ ...page, title: 'Profile' }} />
        <Stack.Screen name="prefs/notifications" options={{ ...page, title: 'Per workspace' }} />
        <Stack.Screen name="prefs/agents" options={{ ...page, title: 'My agents' }} />
        <Stack.Screen name="prefs/connectors" options={{ ...page, title: 'Connectors' }} />
        <Stack.Screen name="prefs/memory" options={{ ...page, title: 'My memory' }} />
      </Stack>
      <TourTip />
      {signedOut ? <SignedOut /> : null}
    </ThemeProvider>
  );
}
