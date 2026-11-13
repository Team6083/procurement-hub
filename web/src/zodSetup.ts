import { z } from 'zod';

// zod probes `new Function` to enable its JIT when a schema is created; under the CSP (no
// 'unsafe-eval') the probe is reported as a violation even though zod catches it. Imported first
// in main.tsx so that it runs before any module defines a schema.
z.config({ jitless: true });
