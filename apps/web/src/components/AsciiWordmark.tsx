import { useEffect, useState } from "react";

const PHH = [
  "########   ##      ##   ##      ##",
  "##     ##  ##      ##   ##      ##",
  "##     ##  ##      ##   ##      ##",
  "########   ##########   ##########",
  "##         ##      ##   ##      ##",
  "##         ##      ##   ##      ##",
  "##         ##      ##   ##      ##",
].join("\n");
const GLYPHS = ".:/+*#%";

/** A single, bounded scramble; the accessible name never changes. */
export function AsciiWordmark() {
  const [art, setArt] = useState(PHH);

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let paused = false;
    try { paused = window.localStorage.getItem("pihomehub-ascii-motion") === "paused"; } catch { /* Static preference remains optional when storage is unavailable. */ }
    if (preference?.matches || paused || document.hidden) return;

    let frame = 0;
    let lastFrame = -Infinity;
    const started = performance.now();
    const finish = () => { cancelAnimationFrame(frame); setArt(PHH); };
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / 850);
      if (progress === 1) { finish(); return; }
      if (now - lastFrame >= 40) {
        lastFrame = now;
        setArt([...PHH].map((char, index) => {
          if (char !== "#") return char;
          // A scattered, deterministic resolve keeps the letter silhouettes steady.
          const threshold = ((index * 37) % 101) / 101;
          return progress >= threshold ? char : GLYPHS[(index + Math.floor(now / 70)) % GLYPHS.length];
        }).join(""));
      }
      frame = requestAnimationFrame(animate);
    };
    const onPreference = () => { if (preference?.matches) finish(); };
    const onVisibility = () => { if (document.hidden) finish(); };
    frame = requestAnimationFrame(animate);
    preference?.addEventListener("change", onPreference);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pihomehub:ascii-motion", finish);
    return () => {
      cancelAnimationFrame(frame);
      preference?.removeEventListener("change", onPreference);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pihomehub:ascii-motion", finish);
    };
  }, []);

  return <div className="ascii-wordmark" role="img" aria-label="PHH"><pre aria-hidden="true">{art}</pre></div>;
}
