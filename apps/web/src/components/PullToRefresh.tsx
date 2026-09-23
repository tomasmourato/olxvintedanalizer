import { useEffect, useRef, useState } from "react";
import { reloadApp } from "../lib/push";
import { Icon } from "./ui";

const THRESHOLD = 70;

/** Pull down at the top of the page to reload: installed apps have no native pull-to-refresh. */
export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const pullRef = useRef(0);

  useEffect(() => {
    let startY: number | null = null;
    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const start = (e: TouchEvent) => {
      startY = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
      setDragging(startY != null);
    };
    const move = (e: TouchEvent) => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      set(dy > 0 && window.scrollY <= 0 ? Math.min(dy * 0.5, 110) : 0);
    };
    const end = () => {
      if (startY == null) return;
      startY = null;
      setDragging(false);
      if (pullRef.current >= THRESHOLD) {
        set(THRESHOLD);
        setBusy(true);
        void reloadApp();
      } else set(0);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  if (!pull && !busy) return null;
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-10 flex justify-center ${dragging ? "" : "transition-transform duration-200"}`}
      style={{ transform: `translateY(${pull - 40}px)` }}
      aria-hidden
    >
      <span className="grid size-9 place-items-center rounded-full bg-white text-black shadow-lg shadow-black" style={{ opacity: Math.min(1, pull / THRESHOLD) }}>
        <span className={`block ${busy ? "animate-spin" : ""}`} style={busy ? undefined : { transform: `rotate(${pull * 3}deg)` }}>
          <Icon name="arrowPath" className="size-5" strokeWidth={2} />
        </span>
      </span>
    </div>
  );
}
