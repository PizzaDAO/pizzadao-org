// app/ui/print/catalog.ts
//
// garlic-67660 — Catalog of printable brand assets shown on /print.
//
// Paths are relative to /public. File type, pixel dimensions and file size are
// NOT hard-coded here — they're read from disk at build time by
// `readAssetFiles()` in ./file-meta.ts so they never drift from the actual
// files. To add a new printable, drop the file under public/brand-kit/ and add
// an entry below.

export type PrintCategoryId = "flyers" | "stickers" | "logos";

export type PrintAsset = {
  id: string;
  title: string;
  description: string;
  /** Public paths (e.g. "/brand-kit/flyers/pizzafesta.jpg"). First raster file is used as the thumbnail. */
  files: string[];
  /** Thumbnail backdrop — "dark" for white artwork so it stays visible. */
  backdrop?: "light" | "dark";
};

export type PrintCategory = {
  id: PrintCategoryId;
  overline: string;
  title: string;
  blurb: string;
  assets: PrintAsset[];
};

export const PRINT_CATALOG: PrintCategory[] = [
  {
    id: "flyers",
    overline: "Flyers & posters",
    title: "Party flyers",
    blurb:
      "Square flyers from past Global Pizza Party stops. Print them as posters, or use them as a reference layout for your own city's party.",
    assets: [
      {
        id: "flyer-pizzafesta",
        title: "Pizza Festa — Lisboa",
        description: "Riverside Pavilion party flyer.",
        files: ["/brand-kit/flyers/pizzafesta.jpg"],
      },
      {
        id: "flyer-pizza-future",
        title: "Pizza Future — Toronto",
        description: "Black-and-white Arta Gallery flyer starring Molto Benny.",
        files: ["/brand-kit/flyers/pizza-future.jpg"],
      },
      {
        id: "flyer-dao-tokyo",
        title: "レトロなピザ — DAO Tokyo",
        description: "Retro pixel-art flyer for Kanda Myoujin Shrine.",
        files: ["/brand-kit/flyers/dao-tokyo.jpg"],
      },
    ],
  },
  {
    id: "stickers",
    overline: "Stickers & characters",
    title: "Molto Benny & friends",
    blurb:
      "Transparent-background artwork that die-cuts cleanly. Use the SVG for vinyl cutters and print shops; the PNG for home printers.",
    assets: [
      {
        id: "molto-benny-color",
        title: "Molto Benny — full color",
        description: "Our slice-in-chief, mid-strut. The go-to sticker.",
        files: [
          "/brand-kit/molto-benny/molto-benny-color.png",
          "/brand-kit/molto-benny/molto-benny-color.svg",
        ],
      },
      {
        id: "molto-benny-black",
        title: "Molto Benny — black",
        description: "One-color version for stamps, screen prints and laser printers.",
        files: [
          "/brand-kit/molto-benny/molto-benny-black.png",
          "/brand-kit/molto-benny/molto-benny-black.svg",
        ],
      },
      {
        id: "molto-benny-white",
        title: "Molto Benny — white",
        description: "For dark shirts, clear vinyl and pizza boxes.",
        files: [
          "/brand-kit/molto-benny/molto-benny-white.png",
          "/brand-kit/molto-benny/molto-benny-white.svg",
        ],
        backdrop: "dark",
      },
      {
        id: "benny-peek",
        title: "Benny peek",
        description: "Waist-up crop — made for laptop lids and box corners.",
        files: ["/brand-kit/benny-peek.png"],
      },
      {
        id: "pep-coin",
        title: "$PEP coin",
        description: "Pixel pepperoni token. Round sticker, 1–2 in.",
        files: ["/pep-icon.png"],
      },
    ],
  },
  {
    id: "logos",
    overline: "Logos",
    title: "PizzaDAO marks",
    blurb:
      "The pizza-planet mark. Vector scales to any size — banners, tablecloths, pizza-box stamps.",
    assets: [
      {
        id: "logo-planet-black",
        title: "Pizza planet — black",
        description: "Vector mark on a transparent background.",
        files: ["/brand-kit/logos/pizzadao-planet-black.svg"],
      },
      {
        id: "logo-planet-app",
        title: "Pizza planet — tomato tile",
        description: "White mark on the tomato square. Good for small stickers.",
        files: ["/favicon.png"],
      },
    ],
  },
];
