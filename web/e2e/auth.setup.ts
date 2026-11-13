import { test as setup } from '@playwright/test';
import { signInOnKeycloak, expectSignedIn } from './support/app';
import { SIGNED_IN_USERS, storageStatePath } from './support/env';

// Signs each user in once through the real Keycloak login form. That creates their user record
// in the app (so they can be picked as team admins and members) and stores their Keycloak SSO
// cookie for the other tests. Tokens are never stored: the SPA keeps them in memory only.
for (const user of SIGNED_IN_USERS) {
  setup(`sign in ${user}`, async ({ page }) => {
    await page.goto('/');
    await signInOnKeycloak(page, user);
    await expectSignedIn(page, user);
    await page.context().storageState({ path: storageStatePath(user) });
  });
}
