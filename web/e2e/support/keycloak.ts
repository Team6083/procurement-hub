import { KEYCLOAK_URL, REALM } from './env';

/**
 * Minimal Keycloak admin REST client for test fixtures: team groups (/teams/<slug>/members)
 * that the role-mapping rules in e2e/role-mappings.yaml turn into team memberships.
 */
async function adminToken(): Promise<string> {
  const res = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin' }),
  });
  if (!res.ok) throw new Error(`Keycloak admin login failed: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await adminToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Keycloak ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface Group {
  id: string;
  name: string;
  path: string;
}

async function groupByPath(path: string): Promise<Group> {
  return call<Group>('GET', `/group-by-path${path}`);
}

async function ensureChild(parent: Group, name: string): Promise<Group> {
  const children = await call<Group[]>('GET', `/groups/${parent.id}/children?search=${encodeURIComponent(name)}&exact=true`);
  const found = children.find((g) => g.name === name);
  if (found) return found;
  await call('POST', `/groups/${parent.id}/children`, { name });
  return groupByPath(`${parent.path}/${name}`);
}

async function userId(username: string): Promise<string> {
  const found = await call<{ id: string; username: string }[]>('GET', `/users?username=${encodeURIComponent(username)}&exact=true`);
  const user = found.find((u) => u.username === username);
  if (!user) throw new Error(`Keycloak user ${username} not found`);
  return user.id;
}

/** Creates /teams/<slug>/<kind> (idempotent) and returns its id. */
export async function ensureTeamGroup(slug: string, kind: 'members' | 'admins'): Promise<string> {
  const teams = await groupByPath('/teams');
  const team = await ensureChild(teams, slug);
  return (await ensureChild(team, kind)).id;
}

export async function addToGroup(username: string, groupId: string): Promise<void> {
  await call('PUT', `/users/${await userId(username)}/groups/${groupId}`);
}

export async function removeFromGroup(username: string, groupId: string): Promise<void> {
  await call('DELETE', `/users/${await userId(username)}/groups/${groupId}`);
}
