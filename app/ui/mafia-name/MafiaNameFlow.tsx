// app/ui/mafia-name/MafiaNameFlow.tsx
//
// The public /get-your-mafia-name flow (plans/mafia-name-port.md, Phase 3). It
// reuses NameStep (topping + film pickers, name cards) and FinaleScene (the
// certificate, AI portrait and sharing) in their "public" modes, so there is no
// login and no profile: the only hand-off is the "Join the family" link into
// /join, which carries the picks.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { trackActivation } from "@/app/lib/activation-client";
import { getAnonymousActor, requestNamegen } from "@/app/lib/namegen-client";
import { filmCode, rerollCode, toppingCode } from "@/app/lib/mafia-funnel";
import { MAFIA_FILMS } from "@/app/lib/mafia-films";
import { buildJoinHref } from "@/app/lib/mafia-join-params";
import type { NameOrigin, NameOriginWithFilm } from "@/app/lib/name-origin";
import { NameStep } from "@/app/ui/onboarding/steps/NameStep";
import { FinaleScene } from "@/app/ui/onboarding/FinaleScene";

type Style = "balanced" | "serious" | "goofy";

type Batch = {
  suggestions?: string[];
  origins?: Record<string, NameOrigin>;
  sigs?: Record<string, string>;
  resolvedMovieTitle?: string;
  tmdbMovieId?: string;
  releaseDate?: string;
  mediaType?: "movie" | "tv";
};

type Picked = { name: string; origin?: NameOriginWithFilm; sig?: string };

const mergeSeen = (seen: string[], more: string[]) => Array.from(new Set([...seen, ...more])).slice(-120);

export function MafiaNameFlow() {
  const t = useTranslations("onboarding.chrome");
  const router = useRouter();
  const [actor, setActor] = useState("");
  const [topping, setTopping] = useState("");
  const [movieTitle, setMovieTitle] = useState("");
  const [style, setStyle] = useState<Style>("balanced");
  const [batch, setBatch] = useState<Batch>({});
  const [seenNames, setSeenNames] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [picked, setPicked] = useState<Picked | null>(null);
  const lastParams = useRef<{ topping: string; movie: string; style: string } | null>(null);
  const rerolls = useRef(0);

  useEffect(() => {
    const id = getAnonymousActor();
    setActor(id);
    trackActivation("mafia_page", id, "viewed");
  }, []);

  const generate = useCallback(
    async (force: boolean) => {
      setGenerating(true);
      setError(undefined);
      const current = { topping, movie: movieTitle, style };
      const prev = lastParams.current;
      const same = prev && prev.topping === current.topping && prev.movie === current.movie && prev.style === current.style;
      const reroll = force || Boolean(same && batch.suggestions?.length);
      try {
        const result = await requestNamegen(
          { topping, movieTitle, style, force: reroll, exclude: reroll ? seenNames : [] },
          t("errorGenerateNames"),
        );
        if (prev?.topping !== current.topping) trackActivation("topping_picked", actor, toppingCode(topping));
        if (prev?.movie !== current.movie) trackActivation("film_picked", actor, filmCode(movieTitle));
        if (reroll && batch.suggestions?.length) {
          rerolls.current += 1;
          trackActivation("name_rerolled", actor, rerollCode(rerolls.current));
        } else {
          trackActivation("names_generated", actor, "ok");
        }
        setBatch({
          suggestions: result.suggestions,
          origins: result.origins,
          sigs: result.sigs,
          resolvedMovieTitle: result.resolvedMovieTitle,
          tmdbMovieId: result.tmdbMovieId,
          releaseDate: result.releaseDate,
          mediaType: result.mediaType,
        });
        setSeenNames((s) => mergeSeen(s, result.suggestions ?? []));
        lastParams.current = current;
      } catch (e) {
        setError((e as Error)?.message || t("errorGenerateNames"));
      } finally {
        setGenerating(false);
      }
    },
    [actor, batch.suggestions, movieTitle, seenNames, style, t, topping],
  );

  const pick = (name: string) => {
    const origin = batch.origins?.[name];
    const film = batch.resolvedMovieTitle || movieTitle;
    setPicked({
      name,
      origin: origin && film ? { ...origin, film } : undefined,
      sig: origin && film ? batch.sigs?.[name] : undefined,
    });
    trackActivation("mafia_page", actor, "name_picked");
  };

  if (picked) {
    const filmTitle = batch.resolvedMovieTitle || movieTitle;
    const film = MAFIA_FILMS.find((f) => f.title.toLowerCase() === filmTitle.trim().toLowerCase());
    return (
      <FinaleScene
        mode="public"
        actor={actor}
        mafiaName={picked.name}
        dashboardHref={buildJoinHref({
          name: picked.name,
          topping,
          filmId: film?.id,
          filmTitle: film ? undefined : filmTitle,
          origin: picked.origin,
          sig: picked.sig,
        })}
        topping={topping || undefined}
        filmId={film?.id}
        filmTitle={film?.title ?? (filmTitle || undefined)}
        tmdbMovieId={batch.tmdbMovieId}
        origin={picked.origin}
        originSig={picked.sig}
        candidates={seenNames.slice(-60)}
        onJoin={() => trackActivation("mafia_page", actor, "join_clicked")}
        onRestart={() => setPicked(null)}
      />
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-6 rounded-xl border border-border bg-card p-4 text-sm text-foreground">
          {error}
        </p>
      )}
      <NameStep
        mode="public"
        topping={topping}
        mafiaMovieTitle={movieTitle}
        style={style}
        suggestions={batch.suggestions}
        origins={batch.origins}
        resolvedMovieTitle={batch.resolvedMovieTitle}
        releaseDate={batch.releaseDate}
        mediaType={batch.mediaType}
        seenNames={seenNames}
        submitting={generating}
        onChange={(u) => {
          if (u.topping !== undefined) setTopping(u.topping);
          if (u.mafiaMovieTitle !== undefined) setMovieTitle(u.mafiaMovieTitle);
          if (u.style !== undefined) setStyle(u.style);
        }}
        onGenerate={generate}
        onPickName={pick}
        onKeepExisting={() => {}}
        onBack={() => router.push("/")}
        onChangeInputs={() => setBatch({})}
      />
    </>
  );
}
