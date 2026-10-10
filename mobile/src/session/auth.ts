import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { parseAuthStart, parseCurrentUser, parseSession, readAuthReturn, type CurrentUser, type SignInFailure } from "plyr-shared/account";
import { HttpError, getJSON, postJSON } from "@/api";
import { readToken, writeToken } from "./token";

/** Where the backend sends the system auth session when it is done; `scheme` in app.json. */
const RETURN = "fm.plyr://auth";

export class SignInError extends Error {
  constructor(readonly failure: SignInFailure) {
    super(failure);
  }
}

const base64url = (base64: string) => base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pkce() {
  const verifier = Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  return { verifier, challenge: base64url(digest) };
}

function failureOf(error: unknown): SignInFailure {
  if (error instanceof SignInError) return error.failure;
  if (error instanceof HttpError) return error.status === 404 ? "handle_not_found" : "failed";
  return "unreachable";
}

/**
 * The whole round trip. plyr.fm is the OAuth client and keeps the atproto tokens; the phone opens the account's own
 * sign-in page in a system auth session and comes back with a one-time code that only this PKCE verifier redeems.
 */
async function start(target: { handle: string } | { pds_url: string }): Promise<CurrentUser> {
  try {
    const { verifier, challenge } = await pkce();
    const authUrl = await postJSON("/auth/app/start", { ...target, code_challenge: challenge }, parseAuthStart);

    const result = await WebBrowser.openAuthSessionAsync(authUrl, RETURN);
    if (result.type !== "success") throw new SignInError("cancelled");

    const returned = readAuthReturn(result.url);
    if ("failure" in returned) throw new SignInError(returned.failure);

    const sessionId = await postJSON("/auth/exchange", { exchange_token: returned.code, code_verifier: verifier }, parseSession);
    await writeToken(sessionId);
    const viewer = await whoami();
    if (!viewer) throw new SignInError("failed");
    return viewer;
  } catch (error) {
    throw new SignInError(failureOf(error));
  }
}

export const signIn = (identifier: string) => start({ handle: identifier });

/** The same round trip, asking a host to make the account first: atproto has no sign-up of its own. */
export const createAccount = (pdsUrl: string) => start({ pds_url: pdsUrl });

/** Who the stored session belongs to. A session the server no longer accepts is forgotten; an unreachable server is not. */
export async function whoami(): Promise<CurrentUser | null> {
  if (!(await readToken())) return null;
  try {
    return await getJSON("/auth/me", parseCurrentUser);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      await writeToken(null);
      return null;
    }
    throw error;
  }
}

/** Signing out on the phone has to work when the network does not. */
export async function signOut(): Promise<void> {
  await postJSON("/auth/logout", undefined, () => null).catch(() => null);
  await writeToken(null);
}
