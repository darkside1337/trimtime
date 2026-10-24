export function DesignPreviewNotice({
  kind,
}: {
  kind: "calendar" | "activity" | "services" | "barbers";
}) {
  return (
    <aside className="rounded-xl bg-secondary p-4 text-sm sm:px-5" role="note">
      <p className="font-semibold">Design preview</p>
      <p className="mt-1 text-secondary-foreground">
        {kind === "calendar"
          ? "Shop details are live. Sample appointments use this shop’s time zone; calendar changes stay on this screen and are not saved."
          : kind === "activity"
            ? "Shop details are live. Events and message outcomes below are samples; no messages were sent and nothing is saved."
            : kind === "services"
              ? "Services, prices, durations, offered status, and barber assignments are live. Service descriptions are illustrative and are not saved."
              : "Barber names, service assignments, and saved recurring hours are live. Specialty text and independent activation are illustrative and are not saved."}
      </p>
    </aside>
  );
}
