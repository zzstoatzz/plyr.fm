export interface MediaSessionState {
  title: string;
  artist: string;
  album?: string | null;
  artwork?: string | null;
  playing: boolean;
  position?: number;
  duration?: number;
  play(): void;
  pause(): void;
  previous?(): void;
  next?(): void;
  seek?(seconds: number): void;
  skip?(seconds: number): void;
}

export function useMediaSession(_owner: 'player' | 'radio', _state: MediaSessionState | null) {}
