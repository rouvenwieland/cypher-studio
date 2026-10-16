import {
  IconCutout,
  IconHome,
  IconLibrary,
  IconMockup,
  IconPrint,
  IconPrograms,
  IconSocial,
  type IconComponent,
} from "../ui/icons";
import { t } from "../i18n/de";

export type ModuleId = "start" | "library" | "programs" | "print" | "mockup" | "social" | "cutout";

export interface ModuleDef {
  id: ModuleId;
  path: string;
  name: string;
  icon: IconComponent;
  /** Strg+1 … Strg+7 */
  digit: number;
  group: "material" | "output" | "extra" | null;
}

export const MODULES: readonly ModuleDef[] = [
  { id: "start", path: "/start", name: t.nav.start, icon: IconHome, digit: 1, group: null },
  { id: "library", path: "/bibliothek", name: t.nav.library, icon: IconLibrary, digit: 2, group: "material" },
  { id: "programs", path: "/programme", name: t.nav.programs, icon: IconPrograms, digit: 3, group: "material" },
  { id: "print", path: "/druck", name: t.nav.print, icon: IconPrint, digit: 4, group: "output" },
  { id: "mockup", path: "/mockups", name: t.nav.mockup, icon: IconMockup, digit: 5, group: "output" },
  { id: "social", path: "/social", name: t.nav.social, icon: IconSocial, digit: 6, group: "output" },
  { id: "cutout", path: "/freistellen", name: t.nav.cutout, icon: IconCutout, digit: 7, group: "extra" },
];

export const SETTINGS_PATH = "/einstellungen";
export const ONBOARDING_PATH = "/erststart";

export function moduleByPath(pathname: string): ModuleDef | undefined {
  return MODULES.find((m) => pathname === m.path || pathname.startsWith(`${m.path}/`));
}
