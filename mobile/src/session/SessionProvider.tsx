import { useQueryClient } from "@tanstack/react-query";
import type { CurrentUser } from "plyr-shared/account";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as auth from "./auth";

type Session = {
  viewer: CurrentUser | null;
  /** True until the stored session has been checked once. */
  isLoading: boolean;
  signIn: (identifier: string) => Promise<void>;
  createAccount: (pdsUrl: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

/**
 * plyr.fm holds the atproto tokens; the phone holds a session id. Refreshing is the server's job, so there is no
 * token clock here and a dead refresh token cannot sign anyone out mid-track.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [viewer, setViewer] = useState<CurrentUser | null>(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    void auth
      .whoami()
      .then(setViewer)
      .catch((error: unknown) => console.warn("could not check the session", error))
      .finally(() => setLoading(false));
  }, []);

  // what a track list says (gated, liked) depends on who is asking
  const become = (next: CurrentUser | null) => {
    setViewer(next);
    void client.invalidateQueries();
  };

  const session: Session = {
    viewer,
    isLoading,
    signIn: async (identifier) => become(await auth.signIn(identifier)),
    createAccount: async (pdsUrl) => become(await auth.createAccount(pdsUrl)),
    signOut: async () => {
      await auth.signOut();
      become(null);
    },
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}
