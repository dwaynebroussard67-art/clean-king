/**
 * Owner onboarding checklist (WP-G4).
 * Shows tiered onboarding fields from the manifest, with status per tier.
 * Tier 0/1: owner can propose values. Tier 2: secure entry via encrypted vault.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { ownerLoginEnabled } from '../../../lib/server/supabase';
import { FRANCHISE_MANIFEST, fieldsByTier, TIER } from '../../../lib/onboarding/manifest.mjs';

export const dynamic = 'force-dynamic';

function Bi({ en, es }) { return <>{en} / {es}</>; }

async function sessionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const store = await cookies();
  return createClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try { items.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* */ }
      },
    },
  });
}

async function getTenantId(client, user) {
  if (!client || !user) return null;
  const { data } = await client
    .from('owner_memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .limit(1);
  if (data?.length > 0) return data[0].organization_id;
  return null;
}

export default async function OnboardingPage() {
  if (!ownerLoginEnabled()) redirect('/owner/login');

  const client = await sessionClient();
  if (!client) redirect('/owner/login');

  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect('/owner/login');

  const tenantId = await getTenantId(client, user);
  if (!tenantId) redirect('/not-approved');

  const publicFields = fieldsByTier(TIER.PUBLIC);
  const delegatedFields = fieldsByTier(TIER.DELEGATED);
  const sensitiveFields = fieldsByTier(TIER.SENSITIVE);

  return (
    <div className="public-page">
      <main className="public-main">
        <div className="public-card">
          <h1><Bi en="Onboarding checklist" es="Lista de incorporación"/></h1>
          <p className="public-intro">
            <Bi en="Provide your business information tier by tier. Tier 0 is public data already on your site; tier 1 is delegated data you confirm; tier 2 is sensitive data you (or your employees) type securely."
                es="Proporcione la información de su empresa nivel por nivel. El nivel 0 es datos públicos ya en su sitio; el nivel 1 es datos delegados que confirma; el nivel 2 es datos sensibles que usted (o sus empleados) escriben de forma segura." />
          </p>

          <section className="onboarding-tier">
            <h2><Bi en="Tier 0 — Public (from your listings)" es="Nivel 0 — Público (de sus listados)"/></h2>
            <p className="muted"><Bi en="These fields are public and can be confirmed without additional verification." es="Estos campos son públicos y pueden confirmarse sin verificación adicional."/></p>
            {publicFields.map((f) => (
              <div key={f.key} className="onboarding-field">
                <label><Bi en={f.label.en} es={f.label.es}/></label>
                <span className="tier-badge tier-0">0</span>
              </div>
            ))}
          </section>

          <section className="onboarding-tier">
            <h2><Bi en="Tier 1 — Delegated (you confirm)" es="Nivel 1 — Delegado (usted confirma)"/></h2>
            <p className="muted"><Bi en="Drop your spreadsheet or enter these values. You review and confirm before they are saved." es="Suba su hoja de cálculo o ingrese estos valores. Usted revisa y confirma antes de guardarlos."/></p>
            {delegatedFields.map((f) => (
              <div key={f.key} className="onboarding-field">
                <label><Bi en={f.label.en} es={f.label.es}/></label>
                <span className="tier-badge tier-1">1</span>
              </div>
            ))}
          </section>

          <section className="onboarding-tier">
            <h2><Bi en="Tier 2 — Sensitive (secure entry)" es="Nivel 2 — Sensible (entrada segura)"/></h2>
            <p className="muted"><Bi en="Never imported. You or your employees type these values directly into the encrypted vault. The platform never sees them in plaintext." es="Nunca se importan. Usted o sus empleados escriben estos valores directamente en la bóveda cifrada. La plataforma nunca los ve en texto plano."/></p>
            {sensitiveFields.map((f) => (
              <div key={f.key} className="onboarding-field">
                <label><Bi en={f.label.en} es={f.label.es}/></label>
                <span className="tier-badge tier-2">2</span>
                <button className="btn light small"><Bi en="Enter securely" es="Ingresar de forma segura"/></button>
              </div>
            ))}
            <p className="public-intro">
              <Bi en="Owner secrets (SSN, EIN, bank) are typed on your own session. Employee secrets (SSN, ID, direct deposit) are collected through one-time links you send to each employee." />
              <Bi en="Los secretos del propietario (SSN, EIN, banco) se escriben en su propia sesión. Los secretos del empleado (SSN, ID, depósito directo) se recopilan mediante enlaces de un solo uso que envía a cada empleado." />
            </p>
          </section>

          <div className="onboarding-actions">
            <form action="/owner/onboarding/confirm" method="POST">
              <button className="btn dark"><Bi en="Confirm proposed values" es="Confirmar valores propuestos"/></button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}