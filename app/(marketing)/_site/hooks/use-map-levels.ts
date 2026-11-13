"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMapLevels, type MapLevels } from "@/app/(marketing)/_site/lib/mapLevels";

/** Levels for the reach map. `data` is null (not an error) whenever the app has nothing to show. */
export function useMapLevels(): MapLevels | null {
  const { data } = useQuery({
    queryKey: ["map-levels"],
    queryFn: () => fetchMapLevels(),
    staleTime: 10 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return data ?? null;
}
