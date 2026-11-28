// Public display identity. These are not legal entity names, auth defaults or tenant IDs.
// Provenance and outstanding owner questions: docs/brand-and-owner.md.
export const brand = Object.freeze({
  name: 'Louisiana Commercial Janitor',
  owner: 'Andy Merchant',
  motto: 'Our People Are Our Assets',
  mottoEs: 'Nuestra gente es nuestro mayor valor',
  mark: '/brand/lcj-mark.png',
  seal: '/brand/lcj-seal.webp',
});

export function publicPath(path, lang = 'en') {
  return lang === 'es' ? `${path}?lang=es` : path;
}
