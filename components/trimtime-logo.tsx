import Image from "next/image";

type LockupTreatment = "primary" | "mono" | "reversed" | "white";
type LogoConfiguration =
  | {
      arrangement: "symbol" | "horizontal" | "stacked";
      treatment?: LockupTreatment;
    }
  | { arrangement: "wordmark"; treatment?: "ink" | "white" };

type TrimTimeLogoProps = LogoConfiguration & {
  width?: number;
  className?: string;
  decorative?: boolean;
  label?: string;
  priority?: boolean;
};

const dimensions = {
  symbol: [256, 256],
  horizontal: [1000, 256],
  stacked: [600, 480],
  wordmark: [512, 256],
} as const;

/**
 * Renders only the approved Soft Welcome assets. Source masters and derivation
 * rules live in brand/soft-welcome; public/brand/soft-welcome serves copies.
 */
export function TrimTimeLogo({
  arrangement,
  treatment,
  width,
  className,
  decorative = false,
  label = "TrimTime",
  priority,
}: TrimTimeLogoProps) {
  const [sourceWidth, sourceHeight] = dimensions[arrangement];
  const version = treatment ?? (arrangement === "wordmark" ? "ink" : "primary");
  const renderedWidth = width ?? sourceWidth;

  return (
    <Image
      src={`/brand/soft-welcome/${arrangement}-${version}.svg`}
      alt={decorative ? "" : label}
      width={renderedWidth}
      height={Math.round((sourceHeight / sourceWidth) * renderedWidth)}
      className={className}
      priority={priority}
    />
  );
}
