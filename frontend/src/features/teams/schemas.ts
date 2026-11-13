import { z } from 'zod';
import { MAX_RATE_DIGITS, fractionDigits } from '../money';

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Positive decimal string such as "1", "0.5", ".25"; zero is rejected. */
export function isPositiveDecimal(s: string): boolean {
  const v = s.trim();
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(v) && /[1-9]/.test(v);
}

// Messages are i18n keys, translated where the error is rendered.
export const createTeamSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, 'common:validation.required')
    .max(63, 'common:validation.tooLong')
    .regex(SLUG_RE, 'teams:validation.slug'),
  name: z.string().trim().min(1, 'common:validation.required').max(200, 'common:validation.tooLong'),
  description: z.string(),
  firstAdminUserId: z.string().min(1, 'common:validation.required'),
});
export type CreateTeamForm = z.infer<typeof createTeamSchema>;

export const generalSchema = z.object({
  name: z.string().trim().min(1, 'common:validation.required').max(200, 'common:validation.tooLong'),
  description: z.string(),
  visibility: z.enum(['public', 'members']),
  locale: z.enum(['en', 'zh-TW']),
  priority: z.object({
    '1': z.string().max(200, 'common:validation.tooLong'),
    '2': z.string().max(200, 'common:validation.tooLong'),
    '3': z.string().max(200, 'common:validation.tooLong'),
    '4': z.string().max(200, 'common:validation.tooLong'),
    '5': z.string().max(200, 'common:validation.tooLong'),
  }),
});
export type GeneralForm = z.infer<typeof generalSchema>;

export const ratesSchema = z
  .object({
    rates: z.array(
      z.object({
        currency: z.string().min(1, 'common:validation.required'),
        rateToBase: z
          .string()
          .refine(isPositiveDecimal, 'teams:validation.rate')
          .refine((v) => fractionDigits(v) <= MAX_RATE_DIGITS, 'teams:validation.rateDigits'),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.rates.forEach((r, i) => {
      if (seen.has(r.currency)) ctx.addIssue({ code: 'custom', path: ['rates', i, 'currency'], message: 'teams:validation.duplicateCurrency' });
      seen.add(r.currency);
    });
  });
export type RatesForm = z.infer<typeof ratesSchema>;

export const roleMappingSchema = z.object({
  claim: z.enum(['groups', 'roles']),
  pattern: z.string().trim().min(1, 'common:validation.required'),
  team: z.string().trim().min(1, 'common:validation.required'),
  role: z.enum(['member', 'admin']),
  enabled: z.boolean(),
  description: z.string(),
});
export type RoleMappingForm = z.infer<typeof roleMappingSchema>;
