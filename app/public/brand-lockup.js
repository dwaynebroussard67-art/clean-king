import { brand } from '../../lib/brand.mjs';

// Both the skyline and Louisiana lettering come from the supplied business-page mark.
export default function BrandLockup() {
  return <span className="lcj-lockup">
    <img className="lcj-lockup-mark" src={brand.mark} width="56" height="56" alt="" />
    <span className="lcj-lockup-type">
      <img src="/brand/louisiana-script.png" width="135" height="38" alt="Louisiana" />
      <span>Commercial Janitor</span>
    </span>
  </span>;
}
