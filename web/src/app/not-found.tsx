import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-5 py-24">
      <h1 className="text-xl font-semibold">There is nothing at this address</h1>
      <p className="mt-2 text-ink-2">It may have moved, or the link may be incomplete.</p>
      <div className="mt-6 flex gap-3">
        <Link href="/book" className="btn-primary">Book an appointment</Link>
        <Link href="/admin" className="btn-quiet">Front desk</Link>
      </div>
    </div>
  );
}
