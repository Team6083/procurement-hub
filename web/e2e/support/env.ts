/** Addresses of the e2e environment (e2e/docker-compose.yml). */
export const WEB_URL = 'http://localhost:18173';
export const API_URL = 'http://localhost:18080';
/** The second backend, built with a different commit (spec section 21.8). */
export const API_NEXT_URL = 'http://localhost:18081';
/** Keycloak as seen from the test runner (the browser uses http://keycloak:18180). */
export const KEYCLOAK_URL = 'http://localhost:18180';
export const REALM = 'example';

export const READY_URLS = [
  `${WEB_URL}/config.json`,
  'http://localhost:19090/readyz',
  'http://localhost:19091/readyz',
  `${KEYCLOAK_URL}/realms/${REALM}/.well-known/openid-configuration`,
];

export const PASSWORD = 'e2e-password';

/** Users of e2e/keycloak/realm-example.json. */
export const users = {
  /** procurement-hub-api:admin, i.e. ADMIN_ROLES. */
  sysadmin: { username: 'sysadmin', name: 'Sam Sysadmin' },
  /** ALLOWED_ROLES; made first team admin by the tests. */
  tara: { username: 'tara', name: 'Tara Teamadmin' },
  alice: { username: 'alice', name: 'Alice Member' },
  bob: { username: 'bob', name: 'Bob Member' },
  carol: { username: 'carol', name: 'Carol Reviewer' },
  /** Allowed to use the service but never a member of the tests' teams. */
  oscar: { username: 'oscar', name: 'Oscar Outsider' },
  /** procurement-hub-api:purchaser (PURCHASER_ROLES). */
  pat: { username: 'pat', name: 'Pat Purchaser' },
  /** procurement-hub-api:receiver (RECEIVER_ROLES). */
  rita: { username: 'rita', name: 'Rita Receiver' },
  /** Lacks the ALLOWED_ROLES role. */
  nora: { username: 'nora', name: 'Nora Norole' },
} as const;

export type UserKey = keyof typeof users;

/** Users signed in once by auth.setup.ts, so they exist in the app and have an SSO session. */
export const SIGNED_IN_USERS: UserKey[] = ['sysadmin', 'tara', 'alice', 'bob', 'carol', 'oscar', 'pat', 'rita'];

export const storageStatePath = (user: UserKey) => `e2e/.auth/${user}.json`;

/** A lowercase id unique to this run, for team slugs and titles. */
export const runId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
