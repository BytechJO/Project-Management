"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import styles from "./app-shell.module.css";

export function NavigationFeedback() {
  const pathname = usePathname();
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNavigating(false));
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    let fallbackTimer: number | undefined;
    const finish = () => {
      window.clearTimeout(fallbackTimer);
      setNavigating(false);
    };
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      setNavigating(true);
      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(finish, 8_000);
    };

    document.addEventListener("click", handleClick);
    window.addEventListener("pageshow", finish);
    return () => {
      window.clearTimeout(fallbackTimer);
      document.removeEventListener("click", handleClick);
      window.removeEventListener("pageshow", finish);
    };
  }, []);

  return <span aria-hidden="true" className={styles.navigationProgress} data-active={navigating || undefined}><i /></span>;
}
