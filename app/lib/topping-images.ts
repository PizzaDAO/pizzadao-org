// app/lib/topping-images.ts
//
// quattro-formaggi-54456 — Catalog of topping image assets used by the
// NameStep topping picker. Maps the canonical topping name (matching
// `PIZZA_TOPPINGS` in `mafia-films.ts`) to a public URL.
//
// Ported from the Lovable mockup (`src/data/topping-images.ts`). The
// mockup bundled the JPGs through Vite imports; we instead serve them
// from `public/toppings/*.jpg` as Next.js static assets.

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
