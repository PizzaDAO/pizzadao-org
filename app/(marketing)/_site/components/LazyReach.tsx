"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// The atlas pulls in react-simple-maps / d3-geo, a 136KB city list and a world-atlas fetch, none of
// which matter until the visitor scrolls near it. Load the section only once its placeholder is
// within ~1200px of the viewport. The placeholder reserves roughly the section's height so the page
// length (and everything below) does not jump when the real section replaces it.
const Reach = dynamic(() => import("@/app/(marketing)/_site/components/Reach"), {
  ssr: false,
  loading: () => <ReachPlaceholder />,
});

function ReachPlaceholder() {
  return (
    <section
      id="reach"
      aria-hidden
      className="relative min-h-[2560px] bg-cream md:min-h-[1900px]"
    />
  );
}

const LazyReach = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (very old browsers): just load it.
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "1200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // In-page links to #reach (SectionNav) must still find a target before the section has loaded;
  // the placeholder carries the same id, and scrolling to it brings it within the observer margin.
  return <div ref={ref}>{near ? <Reach /> : <ReachPlaceholder />}</div>;
};

export default LazyReach;
