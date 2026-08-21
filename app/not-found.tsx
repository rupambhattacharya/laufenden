export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="font-serif text-5xl font-black">404</h1>
      <p className="text-neutral-600">This page doesn&apos;t exist.</p>
      <a href="/en" className="border-b border-black text-sm font-semibold">
        Back to laufenden
      </a>
    </div>
  );
}
