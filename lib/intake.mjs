import { z } from 'zod';
import { isValidPhone } from './validation.mjs';
import { normalizeReferralCode } from './referrals.mjs';

const clean = (max) => z.string().trim().min(1).max(max);
const phone = clean(25).refine(isValidPhone, 'Enter a valid phone number.');
const applicantSchema = z.object({
  firstName: clean(80), phone, area: clean(100),
  shifts: z.array(z.enum(['days', 'nights', 'weekends'])).min(1).max(3).refine(x => new Set(x).size === x.length),
  transportation: z.enum(['yes', 'no']), languages: z.array(z.enum(['en', 'es'])).min(1).max(2).refine(x => new Set(x).size === x.length),
  experienceLevel: z.enum(['none','under_one','one_to_three','over_three']).nullable().optional().default(null),
  commercialExperience: z.enum(['yes','no']).nullable().optional().default(null),
  residentialExperience: z.enum(['yes','no']).nullable().optional().default(null),
  equipmentExperience: z.enum(['yes','no']).nullable().optional().default(null),
  trainingWillingness: z.enum(['yes','no','unsure']).nullable().optional().default(null),
  referrer: z.string().trim().max(100).default(''), referralCode: z.string().transform(v => v.trim() ? normalizeReferralCode(v) : '').refine(v => v !== null).optional().default(''), smsConsent: z.boolean(),
}).strict();
const quoteSchema = z.object({
  buildingType: z.enum(['school', 'clinic', 'hospital', 'office', 'other']),
  size: clean(80), frequency: z.enum(['daily', 'weekly', 'custom', 'unsure']),
  name: clean(100), phone, email: z.string().trim().email().max(254),
}).strict();
export const intakeSchema = z.object({
  kind: z.enum(['application', 'quote']), formLanguage: z.enum(['en', 'es']), requestId: z.string().uuid(), token: z.string().min(1).max(4096),
  data: z.unknown(),
}).strict().superRefine((input, ctx) => {
  const result = (input.kind === 'application' ? applicantSchema : quoteSchema).safeParse(input.data);
  if (!result.success) ctx.addIssue({ code: 'custom', message: 'Invalid form fields', path: ['data'] });
});
export function parseIntake(input) {
  const parsed = intakeSchema.safeParse(input);
  if (!parsed.success) return null;
  return { ...parsed.data, data: (parsed.data.kind === 'application' ? applicantSchema : quoteSchema).parse(parsed.data.data) };
}
export function toRow(input) {
  const d = input.data;
  return input.kind === 'application' ? {
    request_id: input.requestId, first_name: d.firstName, phone: d.phone, area: d.area,
    shifts: d.shifts, transportation: d.transportation === 'yes', languages: d.languages,
    experience_level: d.experienceLevel, commercial_experience: d.commercialExperience, residential_experience: d.residentialExperience, equipment_experience: d.equipmentExperience, training_willingness: d.trainingWillingness,
    referrer: d.referrer || null, sms_consent: d.smsConsent, sms_consent_version: 'application-v1', form_language: input.formLanguage, consented_at: d.smsConsent ? new Date().toISOString() : null,
  } : { request_id: input.requestId, building_type: d.buildingType, size: d.size, frequency: d.frequency, contact_name: d.name, phone: d.phone, email: d.email };
}
