import Link from "next/link";
import { TrimTimeLogo } from "@/components/trimtime-logo";

export default function Home() {
  const ownerOrigin = process.env.APP_ORIGIN ?? "http://app.localhost:3100";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-6 text-center">
        <TrimTimeLogo arrangement="horizontal" width={320} priority />
        <p className="text-sm text-muted-foreground">
          A friendlier way to book a barber appointment.
        </p>
        <p className="text-sm text-muted-foreground">A fictional barber-booking portfolio demo.</p>
        <Link
          href={`${ownerOrigin}/sign-in`}
          className="underline underline-offset-4"
        >
          Owner sign in
        </Link>
      </div>
    </main>
  );
}
