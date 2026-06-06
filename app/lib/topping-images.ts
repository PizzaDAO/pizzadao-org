// app/lib/topping-images.ts
//
// quattro-formaggi-54456 — Canonical catalog of pizza toppings used by the
// NameStep topping picker, plus the image and emoji maps that decorate
// each entry.
//
// Ported from the Lovable mockup (`src/data/topping-images.ts` +
// `src/data/mafia-films.ts`). The mockup bundled the JPGs through Vite
// imports; we instead serve them from `public/toppings/*.jpg` as Next.js
// static assets.
//
// `PIZZA_TOPPINGS` is the ordered list shown in the picker drawer.
// `TOPPING_EMOJI` provides the small visual glyph used as a fallback when
// no image asset exists for a topping (e.g., free-text custom entries).
// `TOPPING_IMAGE` maps the canonical topping name to a public URL.
// `TOPPING_DESCRIPTOR` is the 3-word editorial phrase shown beneath the
// topping name in the picker drawer and selected-card summary (e.g.,
// "loud · classic · respected" for Pepperoni). Ported from
// `MafiaNamePage.tsx` in the mockup — dough-83017 made this the source of
// truth so the picker UI no longer ships its own copy.

export const PIZZA_TOPPINGS = [
  "Pepperoni", "Mushroom", "Basil", "Mozzarella", "Anchovy", "Sausage",
  "Hot honey", "Ricotta", "Garlic", "Onion", "Olives", "Prosciutto",
  "Pineapple", "Jalapeño", "Banana peppers", "Soppressata", "Meatball",
  "Roasted red pepper", "Truffle", "Artichoke", "Eggplant", "Broccoli rabe",
  "Chili crisp", "Burrata", "Oregano", "Parmesan", "Tomato", "Spicy salami",
];

export const TOPPING_EMOJI: Record<string, string> = {
  Pepperoni: "🍕", Mushroom: "🍄", Basil: "🌿", Mozzarella: "🧀", Anchovy: "🐟",
  Sausage: "🌭", "Hot honey": "🍯", Ricotta: "🥛", Garlic: "🧄", Onion: "🧅",
  Olives: "🫒", Prosciutto: "🥓", Pineapple: "🍍", "Jalapeño": "🌶️",
  "Banana peppers": "🌶️", Soppressata: "🥩", Meatball: "🍖",
  "Roasted red pepper": "🫑", Truffle: "🍄‍🟫", Artichoke: "🌱",
  Eggplant: "🍆", "Broccoli rabe": "🥦", "Chili crisp": "🌶️",
  Burrata: "🧀", Oregano: "🌿", Parmesan: "🧀", Tomato: "🍅", "Spicy salami": "🥩",
};

export const TOPPING_IMAGE: Record<string, string> = {
  "Pepperoni": "/toppings/pepperoni.jpg",
  "Mushroom": "/toppings/mushroom.jpg",
  "Basil": "/toppings/basil.jpg",
  "Mozzarella": "/toppings/mozzarella.jpg",
  "Anchovy": "/toppings/anchovy.jpg",
  "Sausage": "/toppings/sausage.jpg",
  "Hot honey": "/toppings/hot-honey.jpg",
  "Ricotta": "/toppings/ricotta.jpg",
  "Garlic": "/toppings/garlic.jpg",
  "Onion": "/toppings/onion.jpg",
  "Olives": "/toppings/olives.jpg",
  "Prosciutto": "/toppings/prosciutto.jpg",
  "Pineapple": "/toppings/pineapple.jpg",
  "Jalapeño": "/toppings/jalapeno.jpg",
  "Banana peppers": "/toppings/banana-peppers.jpg",
  "Soppressata": "/toppings/soppressata.jpg",
  "Meatball": "/toppings/meatball.jpg",
  "Roasted red pepper": "/toppings/roasted-red-pepper.jpg",
  "Truffle": "/toppings/truffle.jpg",
  "Artichoke": "/toppings/artichoke.jpg",
  "Eggplant": "/toppings/eggplant.jpg",
  "Broccoli rabe": "/toppings/broccoli-rabe.jpg",
  "Chili crisp": "/toppings/chili-crisp.jpg",
  "Burrata": "/toppings/burrata.jpg",
  "Oregano": "/toppings/oregano.jpg",
  "Parmesan": "/toppings/parmesan.jpg",
  "Tomato": "/toppings/tomato.jpg",
  "Spicy salami": "/toppings/spicy-salami.jpg",
};

export const TOPPING_DESCRIPTOR: Record<string, string> = {
  Pepperoni: "loud · classic · respected",
  Mushroom: "earthy · quiet · dangerous",
  Basil: "green · honest · sicilian",
  Mozzarella: "soft · loyal · everywhere",
  Anchovy: "salty · brutal · old-school",
  Sausage: "heavy · brooklyn · proud",
  "Hot honey": "sweet · chaotic · respected",
  Ricotta: "creamy · gentle · holy",
  Garlic: "sharp · unforgettable · armed",
  Onion: "tearful · loyal · stubborn",
  Olives: "bitter · sicilian · patient",
  Prosciutto: "elegant · cured · expensive",
  Pineapple: "controversial · sunlit · brave",
  "Jalapeño": "hot · quick · unpredictable",
  "Banana peppers": "tangy · cheerful · sneaky",
  Soppressata: "spicy · cured · feared",
  Meatball: "round · familiar · violent",
  "Roasted red pepper": "sweet · smoky · charming",
  Truffle: "rare · expensive · whispered",
  Artichoke: "armored · roman · stubborn",
  Eggplant: "deep · sicilian · velvet",
  "Broccoli rabe": "bitter · green · honest",
  "Chili crisp": "loud · oily · modern",
  Burrata: "soft · luxurious · creamy",
  Oregano: "dry · grandmotherly · sicilian",
  Parmesan: "sharp · aged · proud",
  Tomato: "red · the beginning · everything",
  "Spicy salami": "hot · cured · dangerous",
};

/**
 * Case-insensitive image lookup. Returns `undefined` if no image exists
 * for the given topping (e.g., a free-text custom entry). Callers should
 * fall back to the emoji + name treatment when this returns undefined.
 */
export function toppingImageFor(topping: string): string | undefined {
  const trimmed = topping.trim();
  if (!trimmed) return undefined;
  if (TOPPING_IMAGE[trimmed]) return TOPPING_IMAGE[trimmed];
  const lower = trimmed.toLowerCase();
  const matchedKey = Object.keys(TOPPING_IMAGE).find(
    (k) => k.toLowerCase() === lower,
  );
  return matchedKey ? TOPPING_IMAGE[matchedKey] : undefined;
}

/**
 * Case-insensitive descriptor lookup. Returns the 3-word editorial phrase
 * for the given topping, falling back to `"off-canon · your call · respected"`
 * for free-text / custom entries that aren't in the canonical catalog.
 */
export function toppingDescriptorFor(topping: string): string {
  const trimmed = topping.trim();
  if (!trimmed) return "off-canon · your call · respected";
  if (TOPPING_DESCRIPTOR[trimmed]) return TOPPING_DESCRIPTOR[trimmed];
  const lower = trimmed.toLowerCase();
  const matchedKey = Object.keys(TOPPING_DESCRIPTOR).find(
    (k) => k.toLowerCase() === lower,
  );
  return matchedKey
    ? TOPPING_DESCRIPTOR[matchedKey]
    : "off-canon · your call · respected";
}
