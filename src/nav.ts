export type Dest = { href: string; label: string; alias?: string[] };

export const groups: Array<{ id: string; label: string; href?: string; items: Dest[] }> = [
  { id: "today", label: "Today", href: "/today", items: [] },
  {
    id: "learn",
    label: "Learn",
    items: [
      { href: "/companion", label: "Study Companion", alias: ["gemma study companion"] },
      { href: "/studio", label: "Learning Studio" },
      { href: "/explainer", label: "Explainer Studio" },
      { href: "/compiler", label: "Academic Compiler" },
    ],
  },
  {
    id: "explore",
    label: "Explore",
    items: [
      { href: "/lab", label: "Reality Lab" },
      { href: "/lens", label: "Reality Lens" },
      { href: "/universe", label: "Knowledge Universe" },
      { href: "/resources", label: "Resource Discovery" },
    ],
  },
  {
    id: "practice",
    label: "Practice",
    items: [
      { href: "/practice", label: "Practice and Quiz" },
      { href: "/cards", label: "Flashcard Studio" },
      { href: "/memory", label: "Memory Studio" },
      { href: "/stress", label: "Knowledge Stress Test" },
      { href: "/games", label: "GameVerse" },
    ],
  },
  {
    id: "exams",
    label: "Exams",
    items: [
      { href: "/cram", label: "Exam Cram Sprint" },
      { href: "/arena", label: "Exam Arena" },
    ],
  },
  {
    id: "plan",
    label: "Plan",
    items: [
      { href: "/planner", label: "Study Planner" },
      { href: "/twin", label: "Learning Twin" },
      { href: "/radar", label: "Misconception Radar" },
      { href: "/autopilot", label: "Academic Autopilot" },
    ],
  },
  { id: "collaborate", label: "Collaborate", items: [{ href: "/circle", label: "Study Circle" }] },
];

export const mobileNav = [
  { href: "/today", label: "Today" },
  { href: "/courses", label: "Courses" },
  { href: "/practice", label: "Practice" },
  { href: "/planner", label: "Plan" },
  { href: "/tools", label: "Tools" },
];

export function allDestinations(): Dest[] {
  return groups.flatMap((group) => (group.href ? [{ href: group.href, label: "Mission Control" }] : group.items));
}
