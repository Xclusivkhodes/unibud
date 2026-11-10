/**
 * Screen entry points.
 * GameVerse reads `score` and `total` together from the built-in game response.
 * A score line is omitted unless both fields are present.
 */
export { TodayScreen } from "./view/mission.js";
export { CoursesScreen, CourseScreen } from "./view/courses.js";
export { GamesScreen } from "./view/games.js";
export { CramScreen, AutopilotScreen } from "./view/schedule.js";
export { PracticeScreen, CardsScreen, MemoryScreen, StressScreen, PlannerScreen } from "./view/study.js";
export { CompanionScreen, StudioScreen, ExplainerScreen, CompilerScreen } from "./view/learn.js";
export { LabScreen, LensScreen, UniverseScreen, ResourcesScreen } from "./view/explore.js";
export { TwinScreen, RadarScreen, ArenaScreen, CircleScreen, ActivityScreen, SettingsScreen, ToolsScreen, SearchScreen } from "./view/rest.js";
