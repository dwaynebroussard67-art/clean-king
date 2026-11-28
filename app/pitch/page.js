import { defaultBrand } from '../../lib/brand.mjs';
import PitchClient from './pitch-client';
import { CHAPTERS, PITCH_META, FACTS } from '../../lib/pitch/script.mjs';
import { META_AI_ASSETS } from '../../lib/pitch/meta-ai-assets.mjs';
import durations from './durations.json';

export const metadata = {
  title: `The $1,000,000 Question | ${defaultBrand.legacyPitchName}`,
  description: `A ten-minute investor pitch for ${defaultBrand.legacyPitchName}, narrated by Bubbles.`,
};

export default function PitchPage() {
  // Functions are not serializable across the server/client boundary.
  const { audioChapter, ...meta } = PITCH_META;
  return (
    <PitchClient
      chapters={CHAPTERS}
      meta={meta}
      facts={FACTS}
      durations={durations}
      metaAiAssets={META_AI_ASSETS}
    />
  );
}
