import { useEffect, useState } from "react";

// Matches the breakpoint useChatInboxState already uses to decide the inbox's initial open state.
const compactMediaQuery = "(max-width: 759px)";

export function useCompactViewport(): boolean {
  const [isCompact, setIsCompact] = useState(() => window.matchMedia(compactMediaQuery).matches);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(compactMediaQuery);
    function handleChange(event: MediaQueryListEvent) {
      setIsCompact(event.matches);
    }
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, []);

  return isCompact;
}
