// app/lib/namegen-names.ts
//
// Name pools shared by the name generator (app/api/namegen/route.ts) and the
// code that judges an existing name (app/lib/themed-name.ts). One list, so the
// generator and the "was this generated?" check cannot drift apart.

/**
 * Iconic family names from popular mafia/crime shows and movies.
 * These should appear first in suggestions when the title matches.
 */
export const ICONIC_FAMILIES: Record<string, string[]> = {
  "the sopranos": ["Soprano"],
  "sopranos": ["Soprano"],
  "the wire": ["Barksdale", "Bell", "Omar"],
  "wire": ["Barksdale", "Bell", "Omar"],
  "the godfather": ["Corleone"],
  "godfather": ["Corleone"],
  "the godfather part ii": ["Corleone"],
  "the godfather part iii": ["Corleone"],
  "goodfellas": ["Hill", "DeVito"],
  "scarface": ["Montana"],
  "boardwalk empire": ["Thompson", "Nucky"],
  "breaking bad": ["White", "Heisenberg"],
  "ozark": ["Byrde"],
  "the departed": ["Costello", "Costigan"],
  "departed": ["Costello", "Costigan"],
  "casino": ["Rothstein", "Santoro"],
  "a bronx tale": ["Calogero", "Sonny"],
  "bronx tale": ["Calogero", "Sonny"],
  "donnie brasco": ["Brasco", "Pistone"],
  "gomorrah": ["Savastano"],
  "gomorra": ["Savastano"],
  "peaky blinders": ["Shelby"],
  "the irishman": ["Sheeran", "Bufalino"],
  "irishman": ["Sheeran", "Bufalino"],
  "mob city": ["Cohen"],
  "power": ["St. Patrick", "Ghost"],
  "narcos": ["Escobar"],
  "narcos mexico": ["Gallardo"],
  "sons of anarchy": ["Teller", "Morrow"],
};

/**
 * The generator takes names from a film's TMDB cast and crew, so the full pool
 * is open-ended. This is the iconic families plus the distinctive surnames of the
 * catalog films' characters, casts and directors that members actually receive.
 * Everyday names (Hill, White, Bell, Black, Michael, Tony...) are left out on
 * purpose, so "Jack White" is not mistaken for a generated name.
 */
export const GENERATOR_SURNAMES: readonly string[] = [
  ...new Set([
    ...Object.values(ICONIC_FAMILIES)
      .flat()
      .filter((f) => !["Hill", "White", "Bell", "Thompson", "Cohen", "Ghost", "Morrow", "Teller"].includes(f)),
    "Corleone", "Soprano", "Montana", "Costello", "Costigan", "Rothstein", "Santoro", "Brasco", "Pistone",
    "Bufalino", "Sheeran", "Savastano", "Barksdale", "DeVito", "Cicero", "Conway", "Hagen", "Clemenza",
    "Ruggiero", "Hoffa", "Capone", "Caspar", "Luciani", "Scorsese", "Coppola", "Ford Coppola",
    "Liotta", "De Niro", "Pacino", "Pesci", "Brando", "Caan", "Duvall", "Cazale", "Keaton", "Gandolfini",
    "Imperioli", "Sirico", "Falco", "Pantoliano", "Chiklis", "Buscemi", "Pileggi", "Sorvino", "Bracco",
    "Palminteri", "Pfeiffer", "Hackman", "Scheider", "Gazzara", "Mantegna", "Gotti", "Gambino",
    "Genovese", "Lucchese", "Bonanno", "Luciano", "Lansky", "Spilotro",
  ]),
];

/** Distinctive first names of the catalog films' characters ("Vito Pepperoni"). */
export const GENERATOR_FIRST_NAMES: readonly string[] = [
  "Vito", "Fredo", "Sonny", "Clemenza", "Tessio", "Silvio", "Paulie", "Nucky", "Omar", "Stringer",
  "Calogero", "Lorenzo", "Lefty", "Noodles", "Nikolai", "Kirill", "Semyon", "Malik", "Murakawa",
  "Apollonia", "Ciro", "Carmela", "Tommy", "Manny", "Elvira",
];
