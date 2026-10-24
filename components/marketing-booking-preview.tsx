const services = [
  {
    name: "Signature haircut",
    note: "A fresh shape. A clean finish.",
    duration: "30 min",
    price: "$30",
  },
  {
    name: "Haircut & beard",
    note: "The full tidy-up.",
    duration: "45 min",
    price: "$45",
  },
  {
    name: "Beard trim",
    note: "A clean-up and finish.",
    duration: "30 min",
    price: "$15",
  },
];

export function MarketingBookingPreview() {
  return (
    <div className="rounded-2xl bg-[var(--secondary)] p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 pb-3 text-xs text-muted-foreground">
        <span>A look at the booking flow</span>
        <span className="rounded-full border border-border px-2 py-1">
          Illustrative preview
        </span>
      </div>
      <div
        role="group"
        aria-label="Static customer booking preview"
        className="rounded-2xl bg-background p-4 sm:p-5"
      >
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-[var(--mint)] text-xs font-bold"
          >
            SC
          </span>
          <h3 className="font-heading font-bold">Sharp Cuts</h3>
        </div>
        <div aria-hidden="true" className="my-4 flex gap-1">
          <span className="h-1 flex-1 rounded-full bg-foreground" />
          <span className="h-1 flex-1 rounded-full bg-border" />
          <span className="h-1 flex-1 rounded-full bg-border" />
          <span className="h-1 flex-1 rounded-full bg-border" />
        </div>
        <p className="mb-3 text-sm font-semibold">Choose a service</p>
        <div className="grid gap-2">
          {services.map((service, index) => (
            <div
              key={service.name}
              className={`flex min-h-[76px] items-center justify-between gap-3 rounded-xl border p-3 ${index === 0 ? "border-foreground bg-muted" : "border-border bg-background"}`}
            >
              <span className="min-w-0">
                <strong className="block text-sm">{service.name}</strong>
                <span className="block text-xs text-muted-foreground">
                  {service.note}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {service.duration} · {service.price}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`size-4 shrink-0 rounded-full border-2 ${index === 0 ? "border-foreground bg-foreground ring-2 ring-background ring-offset-2 ring-offset-foreground" : "border-muted-foreground"}`}
              />
            </div>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="mt-4 flex min-h-11 items-center justify-between rounded-full bg-foreground px-4 text-sm font-semibold text-background"
        >
          <span>Next: choose your barber</span>
          <span>›</span>
        </div>
        <p className="sr-only">
          Fictional services and prices. This preview does not create an
          appointment.
        </p>
      </div>
    </div>
  );
}
