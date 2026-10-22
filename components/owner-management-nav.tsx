import Link from "next/link";

export function OwnerManagementNav({
  current,
}: {
  current: "today" | "services" | "barbers" | "settings";
}) {
  return (
    <nav aria-label="Owner navigation" className="flex flex-wrap gap-2 text-sm">
      {(
        [
          ["today", "Today", "/"],
          ["services", "Services", "/services"],
          ["barbers", "Barbers", "/barbers"],
          ["settings", "Settings", "/settings"],
        ] as const
      ).map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={current === key ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded-md px-3 underline-offset-4 hover:underline aria-[current=page]:bg-secondary aria-[current=page]:font-semibold"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
