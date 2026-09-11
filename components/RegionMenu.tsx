'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export function RegionMenu({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = 'region-menu-panel';

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !document.getElementById(panelId)?.contains(target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  function togglePanel() {
    setIsOpen((prev) => !prev);
  }

  function closePanel() {
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        ref={triggerRef}
        onClick={togglePanel}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-haspopup="true"
        className="cursor-pointer uppercase hover:text-black"
      >
        {label}
      </button>
      {isOpen && (
        <div
          id={panelId}
          className="absolute left-0 top-full z-10 grid w-64 grid-cols-1 gap-1 border border-black bg-white p-3 normal-case tracking-normal text-black"
        >
          {items.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline" onClick={closePanel}>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
