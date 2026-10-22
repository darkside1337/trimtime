import type { ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function ShopField({ name, label, value, onChange, errors, description, placeholder, multiline = false }: {
  name: string; label: string; value: string; onChange: (value: string) => void;
  errors?: string[]; description?: string; placeholder?: string; multiline?: boolean;
}) {
  const Control = multiline ? Textarea : Input;
  const descriptionIds = [description && `${name}-description`, errors?.length && `${name}-error`].filter(Boolean).join(" ");
  return <div className="grid gap-2">
    <div className="flex items-center gap-1"><Label htmlFor={name}>{label}</Label><span aria-hidden="true" className="text-destructive-text">*</span></div>
    <Control id={name} name={name} value={value} required placeholder={placeholder}
      onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value)}
      aria-invalid={Boolean(errors?.length)} aria-describedby={descriptionIds || undefined} />
    {description && <p id={`${name}-description`} className="text-sm text-muted-foreground">{description}</p>}
    {errors?.length ? <p id={`${name}-error`} className="text-sm text-destructive-text">{errors.join(" ")}</p> : null}
  </div>;
}
