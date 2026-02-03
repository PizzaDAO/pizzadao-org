// app/ui/onboarding/types.ts
// Shared types for the onboarding wizard

// ============================================================================
// Flow State Machine
// ============================================================================

/**
 * Discriminated union representing all possible states of the onboarding flow.
 * This replaces multiple boolean flags (mounted, initializing, lookupLoading, etc.)
 * and makes invalid states impossible.
 */
export type FlowState =
  | { type: "initializing" }
  | { type: "checking_session" }
  | { type: "looking_up_member"; discordId: string }
  | { type: "submitting" }
  | {
      type: "claim_flow";
      step: "ask" | "input-id" | "input-pass" | "processing";
      memberId: string;
      foundName: string | null;
      error: string | null;
    }
  | { type: "wizard"; step: 0 | 1 | 2 | 3 | 4 | 5 | 6; isUpdate: boolean }
  | { type: "success"; redirectTo: string }
  | { type: "error"; message: string; details?: string };

// ============================================================================
// Wizard Data (Form State)
// ============================================================================

/**
 * The actual form data collected during the wizard.
 * Separate from flow control state.
 */
export type WizardData = {
  sessionId: string;

  // Step 1: Name generation
  topping: string;
  mafiaMovieTitle: string;
  style: "balanced" | "serious" | "goofy";
  resolvedMovieTitle?: string;
  tmdbMovieId?: string;
  releaseDate?: string;
  mediaType?: "movie" | "tv";
  suggestions?: string[];
  mafiaName?: string;
  seenNames: string[];

  // Step 2: City
  city: string;

  // Step 3: Roles (turtles)
  turtles: string[];

  // Step 4: Member ID
  memberId?: string;

  // Step 5: Crews
  crews: string[];

  // Discord info
  discordId?: string;
  discordJoined?: boolean;
  discordNick?: string;

  // For edit/update flow
  existingData?: {
    mafiaName?: string;
    city?: string;
    turtles: string[];
    crews: string[];
  };
};

// ============================================================================
// API Response Types
// ============================================================================

export type NamegenResponse = {
  cached: boolean;
  topping: string;
  mafiaMovieTitle: string;
  resolvedMovieTitle: string;
  tmdbMovieId: string;
  releaseDate: string;
  mediaType?: "movie" | "tv";
  style: "balanced" | "serious" | "goofy";
  suggestions: string[];
};

export type CityPrediction = {
  description: string;
  place_id: string;
};

export type CrewOption = {
  id: string;
  label: string;
  turtles?: string[] | string;
  role?: string;
  channel?: string;
  event?: string;
  emoji?: string;
  sheet?: string;
  callTime?: string;
  callLength?: string;
  tasks?: { label: string; url?: string }[];
};

// ============================================================================
// Step Component Props
// ============================================================================

export type StepProps<T = WizardData> = {
  data: T;
  onChange: (updater: (prev: T) => T) => void;
  onNext: () => void;
  onBack: () => void;
  isUpdate?: boolean;
};

// ============================================================================
// Constants
// ============================================================================

export const LS_KEY = "mob_pizza_onboarding_v3";
export const PENDING_CLAIM_KEY = "mob_pizza_onboarding_pending_claim_v1";

// ============================================================================
// Utility Functions
// ============================================================================

export function uuidLike() {
  return `sess_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function norm(s: unknown) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normKey(s: unknown) {
  return norm(s).toLowerCase();
}

export function splitTurtlesCell(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(norm).filter(Boolean);
  const s = norm(v);
  if (!s) return [];
  return s
    .split(/[,/|]+/)
    .map((x) => norm(x))
    .filter(Boolean);
}

// ============================================================================
// Default Values
// ============================================================================

export const initialWizardData: WizardData = {
  sessionId: uuidLike(),
  topping: "",
  mafiaMovieTitle: "",
  style: "balanced",
  city: "",
  turtles: [],
  crews: [],
  seenNames: [],
};

export const initialFlowState: FlowState = { type: "initializing" };
