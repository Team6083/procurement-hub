import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppFrame } from './AppFrame';

type BuildProps = { version?: string | null; commit?: string | null; components?: { name: string }[] };
const seen: BuildProps[] = [];
const metaState: { data?: { build: { version: string | null; commit: string | null; builtAt: string | null } } } = {};

// The shell and BuildInfo belong to the UI library; here we only look at what the app hands to BuildInfo.
vi.mock('@team6083/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@team6083/ui')>()),
  AppShell: ({ buildInfo, children }: { buildInfo: ReactNode; children: ReactNode }) => (
    <>
      {buildInfo}
      {children}
    </>
  ),
  BuildInfo: (props: BuildProps) => {
    seen.push(props);
    return <span>build</span>;
  },
}));
vi.mock('../api/meta', () => ({ useMeta: () => metaState }));
vi.mock('../auth/AuthGate', () => ({ useSession: () => ({ user: { profile: { name: 'Alice' } }, logout: vi.fn() }) }));
vi.mock('../auth/useAccess', () => ({ useAccess: () => ({ isPurchaser: false, canSeeReceiving: false, isSystemAdmin: false }) }));
vi.mock('../i18n/useLanguage', () => ({ useChangeLanguage: () => ({ change: vi.fn() }) }));

afterEach(() => {
  cleanup();
  seen.length = 0;
  metaState.data = undefined;
});

function lastProps(): BuildProps {
  render(
    <MemoryRouter>
      <AppFrame>x</AppFrame>
    </MemoryRouter>,
  );
  expect(screen.getByText('build')).toBeTruthy();
  return seen[seen.length - 1]!;
}

const build = (commit: string) => ({ version: '1.2.3', commit, builtAt: '2026-01-01T00:00:00Z' });

describe('AppFrame build info', () => {
  it('passes the API version when the app and the API are the same commit', () => {
    metaState.data = { build: build(__APP_COMMIT__) };
    const props = lastProps();
    expect(props.version).toBe('1.2.3');
    expect(props.components?.[0]?.name).toBe('API');
  });

  it('passes no version when the commits differ', () => {
    metaState.data = { build: build('f'.repeat(40)) };
    const props = lastProps();
    expect(props.version).toBeUndefined();
    expect(props.components).toHaveLength(1);
  });

  it('passes no version and no components while /meta has not answered', () => {
    const props = lastProps();
    expect(props.version).toBeUndefined();
    expect(props.components).toEqual([]);
  });
});
