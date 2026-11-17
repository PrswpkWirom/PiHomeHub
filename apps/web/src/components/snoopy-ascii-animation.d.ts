export interface SnoopyAsciiPlayback {
  play(): void;
  pause(): void;
  destroy(): void;
}

export function mountSnoopyAsciiAnimation(
  canvas: HTMLCanvasElement,
  options?: { onPlaybackChange?: (playing: boolean) => void },
): SnoopyAsciiPlayback | null;
