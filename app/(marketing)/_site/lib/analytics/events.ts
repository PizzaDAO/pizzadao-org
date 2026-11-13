/**
 * Single source of truth for tracked event names + payload shapes.
 *
 * Naming convention: `domain.object_action` (lowercase).
 *
 * Domains:
 *   comms.*  - channels, copy, outbound, newsletter
 *   sales.*  - partner / brand-asset funnel
 *   ux.*     - funnel friction (gate, scroll, dead clicks, 404)
 *   ui.*     - component-level interactions
 *   mafia.*  - /get-your-mafia-name funnel (now the primary join surface)
 *   community.* - /community page engagement
 *   transmission.* - /pre-launch funnel
 */

export const EVT = {
  // --- Comms ---------------------------------------------------------------
  OUTBOUND_LINK: "comms.outbound_link_clicked",
  NEWSLETTER_SUBMITTED: "comms.newsletter_subscribed",
  NEWSLETTER_FAILED: "comms.newsletter_submit_failed",

  // --- Sales / partnerships -----------------------------------------------
  CONTACT_VIEWED: "sales.contact_form_viewed",
  CONTACT_STARTED: "sales.contact_form_started",
  CONTACT_INTENT_SELECTED: "sales.contact_intent_selected",
  CONTACT_SUBMITTED: "sales.contact_form_submitted",
  CONTACT_FAILED: "sales.contact_form_failed",
  PARTNERS_CTA_CLICKED: "sales.partners_cta_clicked",
  FIGMA_OPENED: "sales.figma_kit_opened",
  BRAND_ASSET_DOWNLOADED: "sales.brand_asset_downloaded",

  // --- UX ------------------------------------------------------------------
  GATE_VIEWED: "ux.gate_viewed",
  GATE_SUBMITTED: "ux.gate_submitted",
  GATE_FAILED: "ux.gate_failed",
  SCROLL_DEPTH: "ux.scroll_depth",
  SECTION_VIEWED: "ux.section_viewed",
  CTA_CLICKED: "ux.cta_clicked",
  NOT_FOUND: "ux.404_hit",

  // --- UI ------------------------------------------------------------------
  NAV_CLICKED: "ui.nav_link_clicked",
  TAB_CHANGED: "ui.tab_changed",
  ACCORDION_TOGGLED: "ui.accordion_toggled",
  COPY_TOKEN: "ui.copy_token",

  // --- Mafia name flow (now also the "join" intent surface) ---------------
  MAFIA_STARTED: "mafia.started",
  MAFIA_INTENT_CLICKED: "mafia.intent_clicked",
  MAFIA_TOPPING_PICKED: "mafia.topping_picked",
  MAFIA_MOVIE_PICKED: "mafia.movie_picked",
  MAFIA_NAMES_GENERATED: "mafia.names_generated",
  MAFIA_NAME_REGENERATED: "mafia.name_regenerated",
  MAFIA_NAME_CLAIMED: "mafia.name_claimed",
  MAFIA_GENERATE_FAILED: "mafia.generate_failed",
  MAFIA_AVATAR_STARTED: "mafia.avatar_started",
  MAFIA_AVATAR_GENERATED: "mafia.avatar_generated",
  MAFIA_AVATAR_FAILED: "mafia.avatar_failed",
  MAFIA_AVATAR_REDRAW: "mafia.avatar_redrawn",
  MAFIA_AVATAR_DOWNLOADED: "mafia.avatar_downloaded",

  // --- Community page ------------------------------------------------------
  COMMUNITY_BUILD_VIEWED: "community.build_viewed",
  COMMUNITY_BUILD_EMBED_OPENED: "community.build_embed_opened",
  COMMUNITY_GALLERY_OPENED: "community.gallery_opened",
  COMMUNITY_GALLERY_NAVIGATED: "community.gallery_navigated",
  COMMUNITY_CALENDAR_OPENED: "community.calendar_opened",

  // --- Pre-launch (Transmission) ------------------------------------------
  TRANSMISSION_CTA: "transmission.cta_clicked",
  TRANSMISSION_ROLL_NAME: "transmission.roll_name_clicked",
} as const;

export type EventName = (typeof EVT)[keyof typeof EVT];
