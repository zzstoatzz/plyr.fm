import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { palette } from "@/palette";
import { PlayerProvider } from "@/player/PlayerProvider";
import { QueryProvider } from "@/query";
import { color } from "@/theme";
import { font } from "@/type";

void SplashScreen.preventAutoHideAsync();

/** The navigation theme decides the native header's light/dark traits, search field included. */
function NavigationTheme({ children }: { children: ReactNode }) {
  const dark = useColorScheme() !== "light";
  const mode = dark ? "dark" : "light";
  const base = dark ? DarkTheme : DefaultTheme;
  const colors = {
    ...base.colors,
    background: palette.canvas[mode],
    card: palette.surface[mode],
    text: palette.ink[mode],
    border: palette.border[mode],
    primary: palette.accent[mode],
  };
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palette.canvas[mode]);
  }, [mode]);
  return <ThemeProvider value={{ ...base, dark, colors }}>{children}</ThemeProvider>;
}

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <NavigationTheme>
      <QueryProvider>
        <PlayerProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="player"
              options={{
                presentation: "formSheet",
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                sheetCornerRadius: 24,
                contentStyle: { backgroundColor: color.canvas },
              }}
            />
            <Stack.Screen
              name="about"
              options={{
                presentation: "formSheet",
                headerShown: true,
                headerTransparent: true,
                headerTitleStyle: { color: color.ink, fontFamily: font.bold },
                sheetAllowedDetents: [0.5, 1],
                sheetGrabberVisible: true,
                sheetCornerRadius: 24,
                contentStyle: { backgroundColor: color.canvas },
              }}
            />
            <Stack.Screen
              name="queue"
              options={{
                presentation: "formSheet",
                headerShown: true,
                headerTransparent: true,
                headerTitleStyle: { color: color.ink, fontFamily: font.bold },
                sheetAllowedDetents: [1],
                sheetGrabberVisible: true,
                sheetCornerRadius: 24,
                contentStyle: { backgroundColor: color.canvas },
              }}
            />
          </Stack>
        </PlayerProvider>
      </QueryProvider>
    </NavigationTheme>
  );
}
