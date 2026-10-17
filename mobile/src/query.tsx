import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AppState } from "react-native";

focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener("change", (status) => handleFocus(status === "active"));
  return () => subscription.remove();
});

onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)));

const create = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 60_000,
        refetchOnWindowFocus: true,
        refetchIntervalInBackground: false,
      },
    },
  });

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(create);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
