"use client";

import { Check, X } from "lucide-react";
import type { ReactNode } from "react";

interface DoDontProps {
  doExample: ReactNode;
  dontExample: ReactNode;
  /** Single sentence guidance shown beneath both cards */
  note: string;
}

/**
 * Side-by-side correct vs incorrect example pair.
 * Place inside a section to clarify a usage rule visually.
 */
const DoDont = ({ doExample, dontExample, note }: DoDontProps) => {
  return (
    <figure className="mt-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Do */}
        <div className="flex flex-col overflow-hidden rounded-2xl bg-cream shadow-sm">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-cream">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
              Do
            </span>
          </div>
          <div className="flex min-h-[140px] flex-1 items-center justify-center p-5">
            {doExample}
          </div>
        </div>

        {/* Don't */}
        <div className="flex flex-col overflow-hidden rounded-2xl bg-cream shadow-sm">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-tomato text-cream">
              <X className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-tomato">
              Don't
            </span>
          </div>
          <div className="flex min-h-[140px] flex-1 items-center justify-center p-5">
            {dontExample}
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-sm leading-relaxed text-ink/70 max-w-[60ch]">
        {note}
      </figcaption>
    </figure>
  );
};

export default DoDont;
