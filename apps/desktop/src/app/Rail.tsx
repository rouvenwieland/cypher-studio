import { NavLink, useLocation } from "react-router";
import { t } from "../i18n/de";
import { formatCombo } from "../lib/keys";
import { FitText } from "../ui/FitText";
import { IconJobs, IconSettings, type IconComponent } from "../ui/icons";
import { Tip } from "../ui/Tip";
import { MODULES, SETTINGS_PATH, type ModuleDef } from "./modules";
import { JobsPopover } from "./JobsPopover";
import { lampOf, useJobs, useUpdate } from "./stores";
import { useBreakpoint } from "./theme";

function RailLink({
  to,
  icon: Icon,
  label,
  combo,
  narrow,
  testId,
}: {
  to: string;
  icon: IconComponent;
  label: string;
  combo: string;
  narrow: boolean;
  testId?: string;
}) {
  // Den aktiven Zustand selbst berechnen und die Klasse als Zeichenkette geben: Radix `asChild` im Tooltip
  // (schmale Rail) macht aus einer className-Funktion sonst Quelltext im class-Attribut.
  const { pathname } = useLocation();
  const active = pathname === to || pathname.startsWith(`${to}/`);
  const link = (
    <NavLink
      to={to}
      className={active ? "rail__item rail__item--on" : "rail__item"}
      aria-label={narrow ? label : undefined}
      {...(testId ? { "data-testid": testId } : {})}
      aria-keyshortcuts={combo.replace("mod", "Control")}
    >
      <Icon size={20} />
      <span className="rail__label">{label}</span>
      <kbd className="rail__kbd">{formatCombo(combo)}</kbd>
    </NavLink>
  );
  return narrow ? (
    <Tip label={label} combo={combo} side="right">
      {link}
    </Tip>
  ) : (
    link
  );
}

function groupedModules(): { key: ModuleDef["group"]; items: ModuleDef[] }[] {
  const out: { key: ModuleDef["group"]; items: ModuleDef[] }[] = [];
  for (const m of MODULES) {
    if (m.id === "start") continue;
    const last = out[out.length - 1];
    if (last && last.key === m.group) last.items.push(m);
    else out.push({ key: m.group, items: [m] });
  }
  return out;
}

export function Rail() {
  const bp = useBreakpoint();
  const narrow = bp === "narrow";
  const active = useJobs((s) => s.active);
  const unseen = useJobs((s) => s.unseenFailures);
  const lamp = lampOf(active, unseen);
  const update = useUpdate((s) => s.available);
  const start = MODULES[0];

  return (
    <nav className="rail" aria-label={t.common.region.rail} data-region="rail" tabIndex={-1}>
      <NavLink
        to="/start"
        className="rail__brand"
        aria-label={t.nav.brandHome}
        title={t.nav.brandHome}
        data-testid="brand"
      >
        <FitText
          text={narrow ? t.nav.brandShort : t.nav.brandName.toUpperCase()}
          size={22}
          minSize={12}
          maxSize={26}
          label={t.nav.brandName}
        />
      </NavLink>
      <div className="rail__scroll">
        <ul className="rail__list">
          {start ? (
            <li>
              <RailLink
                to={start.path}
                icon={start.icon}
                label={start.name}
                combo={`mod+${start.digit}`}
                narrow={narrow}
                testId="nav-start"
              />
            </li>
          ) : null}
        </ul>
        {groupedModules().map((g) => (
          <div key={g.key ?? "none"} role="group" aria-labelledby={`rail-g-${g.key}`}>
            <h2 className="rail__group t-label" id={`rail-g-${g.key}`}>
              {narrow ? "" : g.key ? t.nav.groups[g.key] : ""}
            </h2>
            <ul className="rail__list">
              {g.items.map((m) => (
                <li key={m.id}>
                  <RailLink
                    to={m.path}
                    icon={m.icon}
                    label={m.name}
                    combo={`mod+${m.digit}`}
                    narrow={narrow}
                    testId={`nav-${m.id}`}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="rail__foot">
        {update?.available && update.version ? (
          <button
            type="button"
            className="rail__update"
            onClick={() => (window.location.hash = SETTINGS_PATH + "/updates")}
            data-testid="rail-update"
          >
            <span className="rail__update-text">{t.nav.updateReady(update.version)}</span>
            <span className="rail__update-act">{t.nav.restart}</span>
          </button>
        ) : null}
        <JobsPopover narrow={narrow} lamp={lamp} count={active.length} icon={IconJobs} />
        <RailLink
          to={SETTINGS_PATH}
          icon={IconSettings}
          label={t.nav.settings}
          combo="mod+,"
          narrow={narrow}
          testId="nav-settings"
        />
      </div>
    </nav>
  );
}
