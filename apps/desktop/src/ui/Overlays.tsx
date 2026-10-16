import * as Popover from "@radix-ui/react-popover";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { IconMore } from "./icons";
import { IconButton } from "./Button";
import { t } from "../i18n/de";

export function Pop({
  trigger,
  children,
  open,
  onOpenChange,
  align = "start",
  side = "bottom",
  label,
  padded = true,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  label: string;
  padded?: boolean;
}) {
  return (
    <Popover.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={padded ? "pop pop--pad" : "pop"}
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface MenuEntry {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function ActionMenu({ entries, label = t.common.more }: { entries: MenuEntry[]; label?: string }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <IconButton icon={IconMore} label={label} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="pop" align="end" sideOffset={4} collisionPadding={8}>
          {entries.map((e) => (
            <div key={e.id}>
              {e.separatorBefore ? <Dropdown.Separator className="menu__sep" /> : null}
              <Dropdown.Item className="menu__item" disabled={e.disabled} onSelect={e.onSelect}>
                {e.label}
              </Dropdown.Item>
            </div>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
}

export function Tabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <TabsPrimitive.Root className="tabs" value={value} onValueChange={onChange}>
      <TabsPrimitive.List className="tabs__list" aria-label={label}>
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger key={tab.id} value={tab.id} className="tabs__tab">
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content key={tab.id} value={tab.id} className="tabs__panel" tabIndex={-1}>
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
