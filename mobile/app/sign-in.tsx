import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { SIGN_IN_MESSAGES, canSignIn, normalizeIdentifier, parseSignupHost, type SignInFailure } from "plyr-shared/account";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getJSON } from "@/api";
import { HandleField } from "@/components/HandleField";
import { haptic } from "@/haptics";
import { SignInError } from "@/session/auth";
import { useSession } from "@/session/SessionProvider";
import { useActorSuggestions } from "@/session/typeahead";
import { useAccent } from "@/settings";
import { color, inset } from "@/theme";
import { type } from "@/type";

const GLOSSARY = "https://atproto.com/guides/glossary#handle";

/** One box, one button. The account's own server asks for the password, in a system sheet this app cannot read. */
export default function SignIn() {
  const router = useRouter();
  const { signIn, createAccount } = useSession();
  const { accent } = useAccent();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const { query, actors } = useActorSuggestions(typed);
  const signup = useQuery({
    queryKey: ["signup-host"],
    staleTime: Infinity,
    queryFn: ({ signal }) => getJSON("/auth/pds-options", parseSignupHost, signal),
  });

  const host = signup.data ?? null;
  const identifier = normalizeIdentifier(typed);
  const ready = canSignIn(identifier) && pending === null;
  const message = failure ? SIGN_IN_MESSAGES[failure] : null;

  const run = async (label: string, attempt: () => Promise<void>) => {
    setFailure(null);
    setPending(label);
    try {
      await attempt();
      haptic.success();
      if (router.canGoBack()) router.back();
      else router.replace("/");
    } catch (error) {
      setFailure(error instanceof SignInError ? error.failure : "failed");
    } finally {
      setPending(null);
    }
  };

  const change = (text: string) => {
    setTyped(text);
    setFailure(null);
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.screen}
    >
      <View style={styles.lead}>
        <Text style={[type.title, { color: color.ink }]} accessibilityRole="header">
          sign in
        </Text>
        <Text style={[type.secondary, { color: color.muted }]}>
          with your{" "}
          <Text style={{ color: accent }} accessibilityRole="link" onPress={() => void Linking.openURL(GLOSSARY)}>
            atmosphere account
          </Text>
          : your @handle from Bluesky or Blacksky.
        </Text>
      </View>

      <HandleField
        value={typed}
        onChange={change}
        onSubmit={() => (ready ? void run(identifier, () => signIn(identifier)) : undefined)}
        query={query}
        actors={actors}
        onPick={(actor) => {
          // the field keeps what was typed: writing the whole handle into it would be a new search, and the list would change under the wait
          haptic.selection();
          void run(actor.handle, () => signIn(actor.handle));
        }}
        pending={pending}
      />

      {message ? (
        <Text style={[type.secondary, styles.failure]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}

      <Pressable
        onPress={() => void run(identifier, () => signIn(identifier))}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel="sign in"
        accessibilityState={{ disabled: !ready, busy: pending !== null }}
        style={({ pressed }) => [styles.primary, { backgroundColor: accent }, !ready && styles.idle, pressed && styles.pressed]}
      >
        {pending !== null ? <ActivityIndicator color={color.onAccent} /> : <Text style={[type.row, { color: color.onAccent }]}>sign in</Text>}
      </Pressable>

      {host ? (
        <View style={styles.newcomer}>
          <Text style={[type.secondary, { color: color.muted }]}>new to the atmosphere?</Text>
          <Pressable
            onPress={() => void run("new account", () => createAccount(host.url))}
            disabled={pending !== null}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`create an account on ${host.name}`}
            accessibilityHint={host.description ?? undefined}
          >
            <Text style={[type.secondary, type.strong, { color: accent }]}>create an account on {host.name}</Text>
          </Pressable>
          {host.description ? <Text style={[type.meta, { color: color.muted }]}>{host.description}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: inset, gap: 16, paddingBottom: 60 },
  lead: { gap: 6, paddingHorizontal: 4 },
  failure: { color: color.danger, paddingHorizontal: 4 },
  primary: {
    height: 52,
    borderRadius: 26,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  idle: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  newcomer: { gap: 4, paddingHorizontal: 4, paddingTop: 8 },
});
