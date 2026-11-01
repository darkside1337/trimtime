import { cn } from "@/lib/utils";
import type { CustomerReplacementChoices } from "../../types";

export function ReplacementStepServices({
  choices,
  serviceId,
  onServiceChange,
}: {
  choices: CustomerReplacementChoices;
  serviceId: string;
  onServiceChange: (serviceId: string) => void;
}) {
  return (
    <fieldset className="grid gap-3 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold">
        1. Choose your service
      </legend>
      {choices.services.map((service) => (
        <label
          className={cn(
            "flex min-h-[72px] cursor-pointer items-center gap-4 border border-[#e6e6e2] px-4 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f]",
            serviceId === service.id && "border-[#21734f] bg-[#f7f7f5]",
          )}
          key={service.id}
        >
          <input
            checked={serviceId === service.id}
            name="replacement-service"
            onChange={() => onServiceChange(service.id)}
            type="radio"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{service.name}</span>
            <span className="text-xs text-[#72726e]">
              {service.durationMinutes} minutes
              {service.id === choices.retainedService.id
                ? " · Your current service"
                : ""}
            </span>
          </span>
          <span className="text-right text-sm text-[#72726e]">
            ${Number(service.priceUsd).toFixed(2)}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
