import type { ReactNode } from 'react';

interface PlaceholderProps {
  /** Tab id — used as the test hook so e2e can assert the visible view. */
  tab: string;
  icon: string;
  title: string;
  children: ReactNode;
}

/** Shared empty-state shell used by the four M0 view placeholders. */
export default function Placeholder({ tab, icon, title, children }: PlaceholderProps) {
  return (
    <section
      data-testid={`view-${tab}`}
      aria-labelledby={`view-${tab}-title`}
      className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-3 px-6 py-16 text-center lg:max-w-5xl lg:py-24"
    >
      <span aria-hidden="true" className="text-4xl">
        {icon}
      </span>
      <h1 id={`view-${tab}-title`} className="text-xl font-semibold text-stone-800">
        {title}
      </h1>
      <p className="max-w-sm text-sm leading-relaxed text-stone-500">{children}</p>
    </section>
  );
}
