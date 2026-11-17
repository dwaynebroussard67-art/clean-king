import Link from 'next/link';
export default function PublicHeader() {
 return <header className="public-header"><Link className="public-brand" href="/">✳ <strong>goodwork<span>.</span></strong></Link><nav><Link href="/apply">Apply / Solicitar</Link><Link href="/quote">Request a quote / Cotización</Link><Link href="/owner">Owner / Dueño</Link></nav></header>;
}
