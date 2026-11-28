import { defaultPalette } from './brand-palette.mjs';

/**
 * Public presentation defaults only. This is not a tenant resolver or an
 * authorization boundary. Goodwork is a provisional platform name.
 * Andy's artwork and business details require owner approval before use.
 * @typedef {{name:string, shortName:string, tagline:string, logo:string|null,
 *   assistantName:string, services:readonly string[], areasServed:readonly string[],
 *   contact:null, languages:readonly string[]}} Brand
 */
/** @type {Brand} */
export const defaultBrand = Object.freeze({
  id: 'louisiana-commercial-janitor',
  deploymentModel: 'separate',
  palette: defaultPalette,
  legacyPitchName: 'Clean King',
  legacyIntakeStoragePrefix: 'goodwork',
  name: 'Louisiana Commercial Janitor',
  shortName: 'Louisiana Commercial Janitor',
  tagline: 'Our People Are Our Assets',
  logo: null,
  assistantName: 'Bubbles',
  services: Object.freeze([]),
  areasServed: Object.freeze([]),
  contact: null,
  languages: Object.freeze(['en', 'es']),
});
