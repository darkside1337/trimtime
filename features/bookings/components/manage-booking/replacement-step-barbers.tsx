import { cn } from "@/lib/utils";

export function ReplacementStepBarbers({
  barbers,
  barberId,
  onBarberChange,
}: {
  barbers: { id: string; name: string }[];
  barberId: string;
  onBarberChange: (barberId: string) => void;
}) {
  return (
    <fieldset className="grid gap-3 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold">
        2. Choose your barber
      </legend>
      {barbers.length === 0 ? (
        <p className="text-xs text-[#72726e]">
          No barbers available for this service.
        </p>
      ) : (
        barbers.map((barber) => (
          <label
            className={cn(
              "flex min-h-[64px] cursor-pointer items-center gap-4 border border-[#e6e6e2] px-4 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f]",
              barberId === barber.id && "border-[#21734f] bg-[#f7f7f5]",
            )}
            key={barber.id}
          >
            <input
              checked={barberId === barber.id}
              name="replacement-barber"
              onChange={() => onBarberChange(barber.id)}
              type="radio"
            />
            <span>{barber.name}</span>
          </label>
        ))
      )}
    </fieldset>
  );
}
