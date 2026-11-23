// In-repo secret tripwire. Scans git-tracked text files for high-signal credential
// patterns. This is a seatbelt, not a scanner with full coverage: it exists to fail CI
// when an obvious key lands in the repository. Real verification still relies on not
// committing secrets in the first place (see SECURITY.md).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['GitHub personal access token', /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['GitHub OAuth token', /gho_[A-Za-z0-9]{20,}/],
  ['Slack token', /xox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9-]{20,}/],
  ['OpenAI API key', /sk-[A-Za-z0-9_-]{20,}T3BlbkFJ/],
  ['Supabase service role JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

const ALLOWLIST = [
  /scripts\/secret-scan\.mjs$/, // this file contains the patterns
  /\.env\.example$/,            // documents variable names, not values
];

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const findings = [];
for (const file of files) {
  if (ALLOWLIST.some((re) => re.test(file))) continue;
  if (/\.(png|jpe?g|webp|gif|ico|woff2?|pdf|zip|gz)$/i.test(file)) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const [name, pattern] of PATTERNS) {
    if (pattern.test(text)) findings.push({ file, name });
  }
}
if (findings.length) {
  for (const f of findings) console.error(`secret-scan: ${f.name} pattern found in ${f.file}`);
  process.exit(1);
}
console.log(`secret-scan: no known credential patterns in ${files.length} tracked files.`);
