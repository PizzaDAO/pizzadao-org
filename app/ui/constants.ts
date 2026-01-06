export const TURTLES = [
  {
    id: "Leonardo",
    label: "Leonardo",
    role: "Leader",
    image: "/turtles/leonardo.png",
  },
  {
    id: "Donatello",
    label: "Donatello",
    role: "Builder",
    image: "/turtles/donatello.png",
  },
  {
    id: "Michelangelo",
    label: "Michelangelo",
    role: "Creative",
    image: "/turtles/michelangelo.png",
  },
  {
    id: "Raphael",
    label: "Raphael",
    role: "Connector",
    image: "/turtles/raphael.png",
  },
  {
    id: "April",
    label: "April",
    role: "Storyteller",
    image: "/turtles/april.png",
  },
  {
    id: "Splinter",
    label: "Splinter",
    role: "Counsel",
    image: "/turtles/splinter.png",
  },
  {
    id: "Foot Clan",
    label: "Foot Clan",
    role: "Ground Support",
    image: "/turtles/foot-clan.png",
  },
] as const;

export const CREWS = [
  { id: "ops", label: "Ops" },
  { id: "tech", label: "Tech" },
  { id: "comms", label: "Comms" },
  { id: "events", label: "Events" },
  { id: "design", label: "Design" },
  { id: "partnerships", label: "Partnerships" },
] as const;

export const TURTLE_ROLE_IDS: Record<string, string> = {
  RAPHAEL: "815277786012975134",
  LEONARDO: "815269418305191946",
  MICHELANGELO: "815277933622591531",
  DONATELLO: "815277900492046356",
  APRIL: "815976204900499537",
};

export const ROLE_ID_TO_TURTLE: Record<string, string> = Object.entries(TURTLE_ROLE_IDS).reduce((acc, [key, value]) => {
  acc[value] = key.charAt(0) + key.slice(1).toLowerCase(); // "LEONARDO" -> "Leonardo"
  return acc;
}, {} as Record<string, string>);
