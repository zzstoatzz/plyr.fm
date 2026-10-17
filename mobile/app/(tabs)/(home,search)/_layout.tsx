import { Stack } from "expo-router";
import { color } from "@/theme";
import { font } from "@/type";
import { useAccent } from "@/settings";

const roots = { "(home)": "home", "(search)": "search" } as const;

export const unstable_settings = {
  home: { initialRouteName: "home" },
  search: { initialRouteName: "search" },
};

const isTabSegment = (segment: string): segment is keyof typeof roots => segment in roots;

export default function TabStack({ segment }: { segment: string }) {
  const { accent } = useAccent();
  const root = isTabSegment(segment) ? roots[segment] : "home";
  return (
    <Stack
      initialRouteName={root}
      screenOptions={{
        headerTransparent: true,
        headerShadowVisible: false,
        headerTintColor: accent,
        headerTitleStyle: { color: color.ink, fontFamily: font.bold },
        contentStyle: { backgroundColor: color.canvas },
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name={root} options={{ headerShown: false }} />
    </Stack>
  );
}
