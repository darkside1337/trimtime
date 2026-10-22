"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
const signInError = "Google sign-in could not start. Please try again.";
export function OwnerAuthControls({ providerFailed = false }: { providerFailed?: boolean }) {
  const [error, setError] = useState<string | null>(providerFailed ? "Google sign-in was cancelled or could not be completed. Please try again." : null); const [pending, setPending] = useState(false);
  async function signIn() {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" });
      if (result.error) setError(signInError);
    } catch {
      setError(signInError);
    } finally {
      setPending(false);
    }
  }
  return <div className="grid gap-4">
    {error ? <p id="sign-in-error" role="alert" className="rounded-md border border-destructive bg-[var(--destructive-surface)] p-4 text-sm text-destructive-text">{error}</p> : null}
    <Button className="owner-google-button" type="button" onClick={signIn} disabled={pending} aria-busy={pending} aria-describedby={error ? "sign-in-error" : undefined}>{pending ? "Connecting to Google…" : "Continue with Google"}</Button>
    {pending ? <p role="status" className="sr-only">Connecting to Google…</p> : null}
  </div>;
}
export function OwnerSignOut() { const router = useRouter(); return <Button variant="outline" onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => router.push("/sign-in") } })}>Sign out</Button>; }
