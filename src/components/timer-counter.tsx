"use client";

import { useEffect, useState } from "react";

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function TimerCounter({ startedAt }: { startedAt: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  return <strong aria-label="Elapsed timer">{formatElapsed(elapsedSeconds)}</strong>;
}
