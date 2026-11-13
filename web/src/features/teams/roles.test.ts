import { describe, expect, it } from 'vitest';
import { canAdminTeam, canClearManualRole, canRemoveMember, effectiveRole, isTeamMember, showSsoLock } from './roles';

describe('effectiveRole', () => {
  it('is the higher of sso and manual', () => {
    expect(effectiveRole('member', 'admin')).toBe('admin');
    expect(effectiveRole('admin', 'member')).toBe('admin');
    expect(effectiveRole('member', '')).toBe('member');
    expect(effectiveRole('', 'member')).toBe('member');
    expect(effectiveRole('member', 'member')).toBe('member');
  });
  it('is none when both sources are unset', () => {
    expect(effectiveRole('', '')).toBe('');
    expect(effectiveRole(null, undefined)).toBe('');
  });
});

describe('SSO lock and member actions', () => {
  it('shows the lock exactly when an SSO role exists', () => {
    expect(showSsoLock({ ssoRole: 'member', manualRole: '' })).toBe(true);
    expect(showSsoLock({ ssoRole: 'admin', manualRole: 'admin' })).toBe(true);
    expect(showSsoLock({ ssoRole: '', manualRole: 'admin' })).toBe(false);
    expect(showSsoLock({ ssoRole: null, manualRole: null })).toBe(false);
  });
  it('allows clearing the manual role only when an SSO role remains', () => {
    expect(canClearManualRole({ ssoRole: 'member', manualRole: 'admin' })).toBe(true);
    expect(canClearManualRole({ ssoRole: '', manualRole: 'admin' })).toBe(false); // MEMBER_NO_ROLE_SOURCE
    expect(canClearManualRole({ ssoRole: 'member', manualRole: '' })).toBe(false);
  });
  it('allows removal only when there is a manual role (else MEMBER_MANAGED_BY_SSO)', () => {
    expect(canRemoveMember({ ssoRole: '', manualRole: 'member' })).toBe(true);
    expect(canRemoveMember({ ssoRole: 'admin', manualRole: 'member' })).toBe(true);
    expect(canRemoveMember({ ssoRole: 'admin', manualRole: '' })).toBe(false);
  });
});

describe('team permissions', () => {
  const me = {
    isSystemAdmin: false,
    memberships: [
      { teamId: 'a', role: 'admin' },
      { teamId: 'b', role: 'member' },
    ],
  } as Parameters<typeof canAdminTeam>[0];
  it('team admins and system admins can administer', () => {
    expect(canAdminTeam(me, 'a')).toBe(true);
    expect(canAdminTeam(me, 'b')).toBe(false);
    expect(canAdminTeam(me, 'c')).toBe(false);
    expect(canAdminTeam({ ...me!, isSystemAdmin: true }, 'c')).toBe(true);
    expect(canAdminTeam(undefined, 'a')).toBe(false);
  });
  it('detects membership', () => {
    expect(isTeamMember(me, 'b')).toBe(true);
    expect(isTeamMember(me, 'c')).toBe(false);
  });
});
