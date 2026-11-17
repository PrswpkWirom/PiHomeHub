import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";

const MOTION_KEY = "pihomehub-ascii-motion";
const MOTION_EVENT = "pihomehub:ascii-motion";
let memoryPaused = false;
let storageUnavailable = false;

function motionPaused() {
  if (storageUnavailable) return memoryPaused;
  try {
    const stored = window.localStorage.getItem(MOTION_KEY);
    return stored == null ? memoryPaused : stored === "paused";
  } catch { storageUnavailable = true; return memoryPaused; }
}
function subscribeMotion(onChange: () => void) {
  window.addEventListener(MOTION_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MOTION_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function toggleMotion() {
  memoryPaused = !motionPaused();
  try { window.localStorage.setItem(MOTION_KEY, memoryPaused ? "paused" : "playing"); }
  catch { storageUnavailable = true; }
  window.dispatchEvent(new Event(MOTION_EVENT));
}

const NETWORK = String.raw`                          .----------------.
                         / :::::::::::::: /|
                        +----------------+ |
                        | [::::] [::::] o| |
       .--------.       |----------------| |
       |  >_    |-------| [::::] [::::] o| |
       |________|       |----------------| |
      /________/    +---| [::::] [::::] o| /
                    |   +----------------+/
    .-------.       |           |
    | + + + |-------+     .-----+-----.
    '-------'             |  . . . .  |
                          '-----------'`;

const RACK = String.raw`  .----------------.
 /________________/|
 | [:::::::]  o o | |
 |----------------| |
 | [:::::::]  o o | |
 |________________|/
      |  |  |
   ---+--+--+---`;

function ink(line: string) {
  return line.split(/(\[::::\]|\[:::::::\]|>_)/g).map((part, index) => (
    <span key={index} className={/^\[|^>_/.test(part) ? "ascii-ink" : undefined}>{part}</span>
  ));
}

/** Decorative character art; its packets are illustrative, never network telemetry. */
export function AsciiArtwork({ variant = "network" }: { variant?: "network" | "rack" }) {
  const ref = useRef<HTMLElement>(null);
  const paused = useSyncExternalStore(subscribeMotion, motionPaused, () => false);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);

  useEffect(() => {
    const updateVisibility = () => setTabVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    if (ref.current) observer?.observe(ref.current);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      observer?.disconnect();
    };
  }, []);

  const rows = (variant === "rack" ? RACK : NETWORK).split("\n");
  return (
    <figure ref={ref} className={`ascii-art ascii-art--${variant}`} data-motion={!paused && inView && tabVisible ? "running" : "paused"}>
      <div className="ascii-scene" aria-hidden="true">
        <pre>{rows.map((row, index) => <span className="ascii-line" key={index}>{ink(row)}{index < rows.length - 1 ? "\n" : ""}</span>)}</pre>
        {variant === "network" ? <>
          <span className="ascii-packet ascii-packet--console">*</span>
          <span className="ascii-packet ascii-packet--switch">*</span>
          <span className="ascii-packet ascii-packet--home">*</span>
        </> : <span className="ascii-packet ascii-packet--rack">:</span>}
      </div>
      <figcaption>
        <span>{variant === "rack" ? "Server study" : "Network study"}<span className="ascii-caption-dot"> / </span>ASCII</span>
        <button type="button" className="ascii-motion-toggle" onClick={toggleMotion} aria-label={paused ? "Play ASCII animation" : "Pause ASCII animation"} aria-pressed={paused} title={paused ? "Play ASCII animation" : "Pause ASCII animation"}>
          {paused ? <Play size={12} /> : <Pause size={12} />}<span>{paused ? "Play" : "Pause"}</span>
        </button>
      </figcaption>
    </figure>
  );
}
