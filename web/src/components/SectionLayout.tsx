import { Box, HStack, Stack, Tabs } from '@chakra-ui/react';
import { PageHeader } from '@team6083/ui';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, useLocation, useNavigate } from 'react-router';

export interface SectionTab {
  /** The tab's path; also the tab's value. */
  to: string;
  label: string;
  /** Shown under the heading while the tab is open. */
  description?: ReactNode;
  /** Other paths that open this tab (e.g. an old URL that redirects). */
  match?: string[];
}

const ActionsSlot = createContext<HTMLElement | null>(null);

/**
 * A page's own actions (New vendor, New delivery), shown on the right of the section's heading. Pages inside a
 * SectionLayout render their buttons in this instead of a heading of their own.
 */
export function SectionActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionsSlot);
  return slot ? createPortal(children, slot) : null;
}

/** How specifically the tab matches the path: the length of its longest path that is the path or a parent of it. */
const matchLength = (tab: SectionTab, pathname: string) =>
  Math.max(-1, ...[tab.to, ...(tab.match ?? [])].filter((p) => pathname === p || pathname.startsWith(`${p}/`)).map((p) => p.length));

/**
 * The one sub-navigation pattern of the app: a section's PageHeader, then URL-routed line tabs under it, then the
 * open tab's page. The pages never repeat the tab's name as a heading. With a single tab no tab list shows, and the
 * tab's own label is the heading unless `keepTitle`.
 */
export function SectionLayout({ title, badge, tabs, keepTitle = false, children }: {
  title: ReactNode;
  badge?: ReactNode;
  tabs: SectionTab[];
  /** Keep `title` as the heading even with a single tab (a record's name, like a team's). */
  keepTitle?: boolean;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // The most specific tab wins (a team's /settings/members over /settings).
  const active = tabs.reduce<SectionTab | undefined>((best, tab) => (matchLength(tab, pathname) > (best ? matchLength(best, pathname) : -1) ? tab : best), undefined) ?? tabs[0];
  const single = tabs.length <= 1;
  return (
    <Stack gap="4">
      <PageHeader
        mb="0"
        title={single && active && !keepTitle ? active.label : title}
        badge={badge}
        description={active?.description}
        actions={<HStack ref={setSlot} gap="2" wrap="wrap" />}
      />
      {!single && (
        <Tabs.Root value={active?.to ?? ''} onValueChange={(e) => void navigate(e.value)}>
          <Box overflowX="auto">
            <Tabs.List>
              {tabs.map((tab) => <Tabs.Trigger key={tab.to} value={tab.to}>{tab.label}</Tabs.Trigger>)}
            </Tabs.List>
          </Box>
        </Tabs.Root>
      )}
      <ActionsSlot.Provider value={slot}>{children ?? <Outlet />}</ActionsSlot.Provider>
    </Stack>
  );
}
