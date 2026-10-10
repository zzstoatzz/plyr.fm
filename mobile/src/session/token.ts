import * as SecureStore from "expo-secure-store";

const KEY = "session";

// the session id is a bearer credential, so it lives in the keychain and nowhere else
let held: string | null | undefined;

export async function readToken(): Promise<string | null> {
  if (held === undefined) held = await SecureStore.getItemAsync(KEY).catch(() => null);
  return held;
}

export async function writeToken(token: string | null): Promise<void> {
  held = token;
  if (token)
    await SecureStore.setItemAsync(KEY, token, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  else await SecureStore.deleteItemAsync(KEY);
}
