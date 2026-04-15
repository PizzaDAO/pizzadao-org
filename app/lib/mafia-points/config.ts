// Mafia Points configuration — maps engagement sources to point values

export interface PointSource {
  id: string;
  label: string;
  category: "discord_role" | "nft" | "poap" | "attendance";
  points: number;
  roleId?: string;
  roleIds?: string[]; // "any of these" (Toppings Artists)
  contractName?: string; // matches NFTContract.name from contracts sheet
}

// Discord role IDs (from guild query)
const ROLE_DREAD_PIZZA_ROBERTS = "812131585327235113";
const ROLE_PIZZA_CAPO = "839206162837798945";

// Toppings Artists = all topping roles EXCEPT Pizzaiolo
export const TOPPINGS_ARTIST_ROLE_IDS = [
  "812359816831434833", // Sauce
  "812936391578878003", // Crust
  "812327710344216616", // Cheese
  "812327169103364117", // Vegetable
  "812344393352216597", // Fruit
  "911770733863120966", // Pepper
  "812327343095808080", // Meat
  "911767660247805974", // Fungi
  "812374658044919831", // Bugs
  "812328221311238155", // Nuts
  "812362573290536960", // Eggs
  "812327549438918687", // Seafood
  "812508108823461948", // Herbs & Spices
  "812328464353853461", // Snacks
  "812343576926486569", // Rare
  "813435285216034858", // Packaging
];

export const MAFIA_POINT_SOURCES: PointSource[] = [
  // Discord Roles
  {
    id: "dread-pizza-roberts",
    label: "Dread Pizza Roberts",
    category: "discord_role",
    points: 69420,
    roleId: ROLE_DREAD_PIZZA_ROBERTS,
  },
  {
    id: "pizza-capo",
    label: "Pizza Capo",
    category: "discord_role",
    points: 13370,
    roleId: ROLE_PIZZA_CAPO,
  },
  {
    id: "toppings-artists",
    label: "Toppings Artists",
    category: "discord_role",
    points: 3141,
    roleIds: TOPPINGS_ARTIST_ROLE_IDS,
  },

  // NFTs (per-item: points × count)
  {
    id: "pizza-amuse-brooch",
    label: "Pizza Amuse Brooch",
    category: "nft",
    points: 10000,
    contractName: "Pizza Amuse Brooch",
  },
  {
    id: "art-show-buyer",
    label: "Art Show Buyer",
    category: "nft",
    points: 4269,
    contractName: "Art Show",
  },
  {
    id: "rare-pizza",
    label: "Rare Pizza",
    category: "nft",
    points: 4000,
    contractName: "Rare Pizzas",
  },
  {
    id: "rare-pizza-box",
    label: "Rare Pizza Box",
    category: "nft",
    points: 1000,
    contractName: "Rare Pizza Box",
  },
  {
    id: "pizza-pop",
    label: "Pizza Pop",
    category: "nft",
    points: 420,
    contractName: "Pizza Pop",
  },
  {
    id: "pizza-sticks",
    label: "Pizza Sticks",
    category: "nft",
    points: 420,
    contractName: "Pizza Sticks",
  },
  {
    id: "molto-benny",
    label: "Molto Benny Edition",
    category: "nft",
    points: 420,
    contractName: "Molto Benny",
  },
  {
    id: "partner-nfts",
    label: "Partner NFTs",
    category: "nft",
    points: 314,
    contractName: "Partner NFTs",
  },
  {
    id: "stand-w-crypto",
    label: "Stand w/ Crypto Pizza",
    category: "nft",
    points: 314,
    contractName: "Stand w/ Crypto",
  },
  {
    id: "zora-pizza",
    label: "Zora Pizza Mints",
    category: "nft",
    points: 314,
    contractName: "Zora Pizza",
  },
  {
    id: "pizza-people",
    label: "Pizza People",
    category: "nft",
    points: 69,
    contractName: "Pizza People",
  },

  // POAPs (per-item)
  {
    id: "pizzadao-poap",
    label: "PizzaDAO POAP",
    category: "poap",
    points: 100,
  },

  // Attendance (per-call)
  {
    id: "call-attendance",
    label: "Call Attendance",
    category: "attendance",
    points: 100,
  },
];
