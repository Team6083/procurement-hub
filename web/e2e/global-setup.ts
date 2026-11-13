import { READY_URLS } from './support/env';

/** Fails fast with a clear message when the e2e environment is not up (or still starting). */
export default async function globalSetup() {
  const deadline = Date.now() + 180_000;
  for (const url of READY_URLS) {
    let last: string;
    for (;;) {
      try {
        const res = await fetch(url);
        if (res.ok) break;
        last = `HTTP ${res.status}`;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
      }
      if (Date.now() > deadline) {
        throw new Error(`e2e environment not ready: ${url} (${last}). Start it with \`npm run e2e:up\`.`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
