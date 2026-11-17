import { useEffect, useRef } from "react";

import { mountSnoopyAsciiAnimation } from "./snoopy-ascii-animation.js";
import "./SnoopyAsciiArtwork.css";

export function SnoopyAsciiArtwork() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvas.current) return;
    const animation = mountSnoopyAsciiAnimation(canvas.current);
    return () => animation?.destroy();
  }, []);

  return (
    <div className="ascii-art ascii-art--snoopy" aria-hidden="true">
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}
