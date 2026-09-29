// app/lib/mafia-films.ts
//
// sicilian-99996 — Mafia film catalog + Wikipedia poster slug map.
// Ported from the Lovable mockup (src/data/mafia-films.ts).
// The wizard's movie picker (NameStep) renders these as poster cards and
// uses `FILM_WIKI_SLUG[id]` to fetch poster thumbnails via the public
// Wikipedia REST API (no key required).

export type MafiaFilm = {
  id: string;
  title: string;
  year: number;
  country: string;
  characters: string[];
  tone: string[];
  overview: string;
};

export const MAFIA_FILMS: MafiaFilm[] = [
  { id: "godfather", title: "The Godfather", year: 1972, country: "USA / Italy", characters: ["Vito Corleone", "Michael Corleone", "Sonny", "Tom Hagen", "Clemenza"], tone: ["operatic", "patriarchal", "sicilian", "loyalty"], overview: "An aging patriarch of a New York crime dynasty hands the reins to his reluctant son." },
  { id: "godfather-2", title: "The Godfather Part II", year: 1974, country: "USA / Italy", characters: ["Michael Corleone", "Young Vito", "Fredo", "Hyman Roth"], tone: ["operatic", "epic", "betrayal", "ascent"], overview: "Two parallel stories of Vito's rise and Michael's reign." },
  { id: "goodfellas", title: "Goodfellas", year: 1990, country: "USA", characters: ["Henry Hill", "Jimmy Conway", "Tommy DeVito", "Paulie Cicero"], tone: ["wiseguy", "kinetic", "queens", "irish-italian"], overview: "A young man grows up in the Brooklyn mob and becomes a wiseguy." },
  { id: "scarface", title: "Scarface", year: 1983, country: "USA / Cuba", characters: ["Tony Montana", "Manny Ribera", "Elvira Hancock"], tone: ["miami", "cuban", "cocaine", "excess"], overview: "A Cuban refugee climbs the Miami drug underworld." },
  { id: "ouatia", title: "Once Upon a Time in America", year: 1984, country: "USA", characters: ["Noodles", "Max", "Deborah"], tone: ["nostalgic", "lower east side", "jewish mob", "epic"], overview: "A Jewish gang's lifelong friendship and betrayal on the Lower East Side." },
  { id: "casino", title: "Casino", year: 1995, country: "USA", characters: ["Sam 'Ace' Rothstein", "Nicky Santoro", "Ginger"], tone: ["las vegas", "neon", "high roller", "downfall"], overview: "A mob-run casino in Vegas implodes in greed and violence." },
  { id: "donnie-brasco", title: "Donnie Brasco", year: 1997, country: "USA", characters: ["Donnie Brasco", "Lefty Ruggiero", "Sonny Black"], tone: ["undercover", "brooklyn", "fugazi", "loyalty"], overview: "An FBI agent infiltrates the Bonanno family." },
  { id: "bronx-tale", title: "A Bronx Tale", year: 1993, country: "USA", characters: ["Sonny", "Calogero", "Lorenzo"], tone: ["bronx", "coming of age", "stoop", "mentor"], overview: "A young boy is torn between his honest father and a charismatic mob boss." },
  { id: "irishman", title: "The Irishman", year: 2019, country: "USA", characters: ["Frank Sheeran", "Russell Bufalino", "Jimmy Hoffa"], tone: ["elegiac", "teamsters", "philly", "regret"], overview: "A hitman recalls his ties to the Bufalino family and Jimmy Hoffa." },
  { id: "untouchables", title: "The Untouchables", year: 1987, country: "USA", characters: ["Eliot Ness", "Al Capone", "Jim Malone"], tone: ["prohibition", "chicago", "lawmen", "stylish"], overview: "Eliot Ness assembles a team to bring down Al Capone." },
  { id: "mean-streets", title: "Mean Streets", year: 1973, country: "USA", characters: ["Charlie", "Johnny Boy", "Tony"], tone: ["little italy", "scorsese", "raw", "gritty"], overview: "Small-time hoods in Little Italy try to move up." },
  { id: "gomorrah", title: "Gomorrah", year: 2008, country: "Italy", characters: ["Don Ciro", "Totò", "Roberto"], tone: ["camorra", "naples", "verite", "brutal"], overview: "Five intersecting tales of the Camorra in Naples." },
  { id: "city-of-god", title: "City of God", year: 2002, country: "Brazil", characters: ["Rocket", "Lil Zé", "Benny"], tone: ["favela", "rio", "kinetic", "youth"], overview: "Gang wars in a Rio de Janeiro favela through the eyes of a young photographer." },
  { id: "eastern-promises", title: "Eastern Promises", year: 2007, country: "UK / Russia", characters: ["Nikolai", "Kirill", "Semyon"], tone: ["russian mob", "london", "tattoos", "cold"], overview: "A London midwife uncovers the Russian mafia through a diary." },
  { id: "a-prophet", title: "A Prophet", year: 2009, country: "France", characters: ["Malik El Djebena", "César Luciani"], tone: ["prison", "corsican", "rise", "french"], overview: "A young French-Arab man rises through prison gang hierarchy." },
  { id: "millers-crossing", title: "Miller's Crossing", year: 1990, country: "USA", characters: ["Tom Reagan", "Leo O'Bannon", "Johnny Caspar"], tone: ["prohibition", "irish", "coen", "ethics"], overview: "An Irish mob lieutenant navigates rival bosses during Prohibition." },
  { id: "road-to-perdition", title: "Road to Perdition", year: 2002, country: "USA", characters: ["Michael Sullivan", "John Rooney", "Connor Rooney"], tone: ["depression-era", "father-son", "painterly", "irish"], overview: "A mob enforcer goes on the run with his son for revenge." },
  { id: "departed", title: "The Departed", year: 2006, country: "USA", characters: ["Billy Costigan", "Colin Sullivan", "Frank Costello"], tone: ["boston", "irish", "moles", "scorsese"], overview: "An undercover cop and a mole in the police try to expose each other." },
  { id: "infernal-affairs", title: "Infernal Affairs", year: 2002, country: "Hong Kong", characters: ["Chan Wing-yan", "Lau Kin-ming", "Hon Sam"], tone: ["triad", "hong kong", "moles", "tense"], overview: "A triad mole and a police mole hunt each other in Hong Kong." },
  { id: "sonatine", title: "Sonatine", year: 1993, country: "Japan", characters: ["Murakawa"], tone: ["yakuza", "okinawa", "meditative", "deadpan"], overview: "A weary yakuza takes shelter on an Okinawan beach." },
  { id: "long-good-friday", title: "The Long Good Friday", year: 1980, country: "UK", characters: ["Harold Shand", "Victoria"], tone: ["london", "cockney", "ira", "kingpin"], overview: "A London gangster's empire is rocked by mysterious attacks." },
  { id: "sexy-beast", title: "Sexy Beast", year: 2000, country: "UK / Spain", characters: ["Gal", "Don Logan", "Teddy Bass"], tone: ["costa del sol", "retired", "menace", "brit"], overview: "A retired British safecracker is dragged back for one more job." },
  { id: "mesrine", title: "Mesrine: Killer Instinct", year: 2008, country: "France", characters: ["Jacques Mesrine"], tone: ["french", "outlaw", "70s", "audacious"], overview: "The notorious French criminal Jacques Mesrine's life of crime." },
  { id: "pusher", title: "Pusher", year: 1996, country: "Denmark", characters: ["Frank", "Tonny", "Milo"], tone: ["copenhagen", "drug debt", "raw", "scandi"], overview: "A Copenhagen drug dealer's week spirals out of control." },
  { id: "cercle-rouge", title: "Le Cercle Rouge", year: 1970, country: "France", characters: ["Corey", "Vogel", "Jansen"], tone: ["heist", "melville", "cool", "minimal"], overview: "A heist film about fate and honor among thieves." },
  { id: "sicilian-clan", title: "The Sicilian Clan", year: 1969, country: "France / Italy", characters: ["Vittorio Manalese", "Roger Sartet"], tone: ["heist", "sicilian", "europop", "gabin"], overview: "A French-Italian mob plans an audacious jewel heist." },
  { id: "public-enemy", title: "The Public Enemy", year: 1931, country: "USA", characters: ["Tom Powers", "Matt Doyle"], tone: ["pre-code", "prohibition", "cagney", "classic"], overview: "Two friends rise through bootlegging in 1920s Chicago." },
  { id: "little-caesar", title: "Little Caesar", year: 1931, country: "USA", characters: ["Rico Bandello", "Joe Massara"], tone: ["pre-code", "rise and fall", "robinson", "classic"], overview: "A small-time crook claws his way to the top of the underworld." },
  { id: "white-heat", title: "White Heat", year: 1949, country: "USA", characters: ["Cody Jarrett", "Verna"], tone: ["noir", "mother fixation", "cagney", "explosive"], overview: "A psychopathic gangster with a mother obsession plans a payroll heist." },
  { id: "angels-dirty-faces", title: "Angels with Dirty Faces", year: 1938, country: "USA", characters: ["Rocky Sullivan", "Jerry Connolly"], tone: ["hells kitchen", "cagney", "redemption", "classic"], overview: "Two slum kids grow up: one a priest, one a gangster." },
  { id: "black-caesar", title: "Black Caesar", year: 1973, country: "USA", characters: ["Tommy Gibbs"], tone: ["harlem", "blaxploitation", "rise", "funk"], overview: "A Harlem hit man builds a crime empire." },
  { id: "king-of-ny", title: "King of New York", year: 1990, country: "USA", characters: ["Frank White", "Jimmy Jump"], tone: ["new york", "ferrara", "neon", "robin hood"], overview: "A drug kingpin returns from prison aiming to control the city." },
  { id: "new-jack-city", title: "New Jack City", year: 1991, country: "USA", characters: ["Nino Brown", "Scotty Appleton", "Pookie"], tone: ["harlem", "crack era", "90s", "rise and fall"], overview: "A Harlem drug lord runs a crack empire from a fortified building." },
  { id: "carlitos-way", title: "Carlito's Way", year: 1993, country: "USA", characters: ["Carlito Brigante", "Dave Kleinfeld"], tone: ["new york", "puerto rican", "redemption", "tragic"], overview: "An ex-con tries to go straight but his past pulls him back." },
  { id: "bugsy", title: "Bugsy", year: 1991, country: "USA", characters: ["Bugsy Siegel", "Virginia Hill", "Meyer Lansky"], tone: ["las vegas", "glamour", "dreamer", "30s-40s"], overview: "Bugsy Siegel dreams up a casino in the Nevada desert." },
  { id: "american-gangster", title: "American Gangster", year: 2007, country: "USA", characters: ["Frank Lucas", "Richie Roberts"], tone: ["harlem", "heroin", "70s", "kingpin"], overview: "A Harlem entrepreneur runs heroin imported from Vietnam." },
  { id: "the-killing", title: "The Killing", year: 1956, country: "USA", characters: ["Johnny Clay", "Sherry Peatty"], tone: ["heist", "noir", "kubrick", "racetrack"], overview: "A racetrack heist unravels piece by piece." },
  { id: "eddie-coyle", title: "The Friends of Eddie Coyle", year: 1973, country: "USA", characters: ["Eddie Coyle", "Dillon"], tone: ["boston", "low-level", "70s grit", "informant"], overview: "A low-level Boston gunrunner gets squeezed by everyone." },
  { id: "rififi", title: "Rififi", year: 1955, country: "France", characters: ["Tony le Stéphanois", "Jo le Suédois"], tone: ["heist", "paris", "noir", "silent setpiece"], overview: "Four men plan an elaborate jewelry heist in Paris." },
  { id: "yakuza", title: "The Yakuza", year: 1974, country: "USA / Japan", characters: ["Harry Kilmer", "Ken Tanaka"], tone: ["yakuza", "tokyo", "honor", "noir"], overview: "An American is pulled back to Japan into the world of the yakuza." },
  { id: "the-killer", title: "The Killer", year: 1989, country: "Hong Kong", characters: ["Ah Jong", "Jennie", "Inspector Li"], tone: ["hong kong", "triad", "balletic", "honor"], overview: "An assassin takes one last job to pay for a singer's surgery." },
  { id: "election", title: "Election", year: 2005, country: "Hong Kong", characters: ["Lok", "Big D"], tone: ["triad", "hong kong", "political", "tense"], overview: "Two triad leaders vie for chairmanship of the Wo Shing society." },
  { id: "brother", title: "Brother", year: 2000, country: "Japan / USA", characters: ["Yamamoto", "Denny"], tone: ["yakuza", "la", "exile", "kitano"], overview: "An exiled yakuza joins his brother's small drug crew in LA." },
  { id: "tokyo-drifter", title: "Tokyo Drifter", year: 1966, country: "Japan", characters: ["Tetsu", "Otsuka"], tone: ["yakuza", "pop", "60s", "stylized"], overview: "A loyal yakuza is forced to wander after his clan dissolves." },
  { id: "battles-without-honor", title: "Battles Without Honor and Humanity", year: 1973, country: "Japan", characters: ["Shozo Hirono"], tone: ["yakuza", "postwar", "hiroshima", "ruthless"], overview: "Postwar yakuza wars in Hiroshima told in jagged docu-style." },
  { id: "the-traitor", title: "The Traitor", year: 2019, country: "Italy", characters: ["Tommaso Buscetta", "Giovanni Falcone"], tone: ["cosa nostra", "sicilian", "trial", "informant"], overview: "Mafia boss Tommaso Buscetta turns state's witness." },
  { id: "suburra", title: "Suburra", year: 2015, country: "Italy", characters: ["Samurai", "Numero 8", "Sebastiano"], tone: ["rome", "corruption", "political", "noir"], overview: "Roman criminals, politicians, and clergy collide over a real estate deal." },
  { id: "the-ruthless", title: "The Ruthless", year: 2019, country: "Italy", characters: ["Santo Russo"], tone: ["calabria", "ndrangheta", "milan", "rise"], overview: "A Calabrian boy becomes a Milan crime boss in the '70s and '80s." },
  { id: "raid-2", title: "The Raid 2", year: 2014, country: "Indonesia", characters: ["Rama", "Uco", "Bejo"], tone: ["jakarta", "undercover", "martial arts", "operatic"], overview: "An undercover cop infiltrates Jakarta's crime syndicate." },
  { id: "pope-greenwich", title: "The Pope of Greenwich Village", year: 1984, country: "USA", characters: ["Charlie", "Paulie"], tone: ["greenwich village", "80s", "cousins", "scheme"], overview: "Two cousins in the Village pull a score that goes very wrong." },
];

// Wikipedia page slugs — used to fetch poster thumbnails via the free
// Wikipedia REST API. Disambiguated where needed to avoid landing on a
// non-film page.
export const FILM_WIKI_SLUG: Record<string, string> = {
  "godfather": "The_Godfather",
  "godfather-2": "The_Godfather_Part_II",
  "goodfellas": "Goodfellas",
  "scarface": "Scarface_(1983_film)",
  "ouatia": "Once_Upon_a_Time_in_America",
  "casino": "Casino_(1995_film)",
  "donnie-brasco": "Donnie_Brasco_(film)",
  "bronx-tale": "A_Bronx_Tale",
  "irishman": "The_Irishman",
  "untouchables": "The_Untouchables_(film)",
  "mean-streets": "Mean_Streets",
  "gomorrah": "Gomorrah_(film)",
  "city-of-god": "City_of_God_(2002_film)",
  "eastern-promises": "Eastern_Promises",
  "a-prophet": "A_Prophet",
  "millers-crossing": "Miller%27s_Crossing",
  "road-to-perdition": "Road_to_Perdition",
  "departed": "The_Departed",
  "infernal-affairs": "Infernal_Affairs",
  "sonatine": "Sonatine_(1993_film)",
  "long-good-friday": "The_Long_Good_Friday",
  "sexy-beast": "Sexy_Beast",
  "mesrine": "Mesrine_(film_series)",
  "pusher": "Pusher_(1996_film)",
  "cercle-rouge": "Le_Cercle_Rouge",
  "sicilian-clan": "The_Sicilian_Clan",
  "public-enemy": "The_Public_Enemy",
  "little-caesar": "Little_Caesar_(film)",
  "white-heat": "White_Heat",
  "angels-dirty-faces": "Angels_with_Dirty_Faces",
  "black-caesar": "Black_Caesar_(film)",
  "king-of-ny": "King_of_New_York",
  "new-jack-city": "New_Jack_City",
  "carlitos-way": "Carlito%27s_Way",
  "bugsy": "Bugsy",
  "american-gangster": "American_Gangster_(film)",
  "the-killing": "The_Killing_(film)",
  "eddie-coyle": "The_Friends_of_Eddie_Coyle_(film)",
  "rififi": "Rififi",
  "yakuza": "The_Yakuza",
  "the-killer": "The_Killer_(1989_film)",
  "election": "Election_(2005_film)",
  "brother": "Brother_(2000_film)",
  "tokyo-drifter": "Tokyo_Drifter",
  "battles-without-honor": "Battles_Without_Honor_and_Humanity",
  "the-traitor": "The_Traitor_(2019_film)",
  "suburra": "Suburra_(film)",
  "the-ruthless": "The_Ruthless",
  "raid-2": "The_Raid_2",
  "pope-greenwich": "The_Pope_of_Greenwich_Village",
};
