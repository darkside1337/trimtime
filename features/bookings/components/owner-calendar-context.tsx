"use client";

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { OwnerDiscardDialog } from "@/components/owner-discard-dialog";

export type OwnerAppointmentDraftValues = {
  customerName: string;
  email: string;
  phone: string;
  whatsappOptIn: boolean;
  serviceId: string;
  barberId: string;
  date: string;
  time: string;
  occurrence: string;
};

export type OwnerAppointmentDraft = {
  values: OwnerAppointmentDraftValues;
  baseline: OwnerAppointmentDraftValues;
  recoveryKey: string;
  submittedPayload: string | null;
  appointmentId?: string;
  operationMode?: "move" | "cancel";
  recoveryPending?: boolean;
};

function draftHasUnsavedWork(draft: OwnerAppointmentDraft | null) {
  return (
    !!draft &&
    (JSON.stringify(draft.values) !== JSON.stringify(draft.baseline) ||
      draft.recoveryPending === true)
  );
}

type Dismissal = {
  kind: "close" | "pop" | "navigate";
  href?: string;
};
type Phase = "idle" | "restoring" | "prompt" | "discarding";

type ContextValue = {
  draft: OwnerAppointmentDraft | null;
  formGeneration: number;
  setDraft: (draft: OwnerAppointmentDraft) => void;
  clearDraft: () => void;
  setModalActive: (active: boolean) => void;
  requestClose: () => void;
  requestNavigation: (href: string) => void;
  isDirty: boolean;
};

const Context = createContext<ContextValue | null>(null);

export function OwnerAppointmentProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<OwnerAppointmentDraft | null>(null);
  const [formGeneration, setFormGeneration] = useState(0);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptInstance, setPromptInstance] = useState(0);
  const [traversalRevision, setTraversalRevision] = useState(0);
  const phase = useRef<Phase>("idle");
  const modalHref = useRef<string | null>(null);
  const draftRef = useRef<OwnerAppointmentDraft | null>(null);
  const pendingRef = useRef<Dismissal | null>(null);
  const restoreRequested = useRef(false);
  const focusReturn = useRef<HTMLElement | null>(null);
  const focusName = useRef<string | null>(null);
  const focusRestoreAttempt = useRef(0);
  const writeDraft = useCallback((next: OwnerAppointmentDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const clearDraft = useCallback(() => {
    writeDraft(null);
    setFormGeneration((generation) => generation + 1);
  }, [writeDraft]);
  const dirty = draftHasUnsavedWork(draft);
  const begin = useCallback(
    (next: Dismissal) => {
      if (phase.current === "prompt" || phase.current === "restoring") return;
      const isDirty = draftHasUnsavedWork(draftRef.current);
      if (!isDirty) {
        clearDraft();
        phase.current = "idle";
        if (next.kind === "navigate" && next.href) router.push(next.href);
        else router.back();
        return;
      }
      focusRestoreAttempt.current += 1;
      focusReturn.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      focusName.current = focusReturn.current?.getAttribute("name") ?? null;
      phase.current = "prompt";
      pendingRef.current = next;
      setPromptOpen(true);
    },
    [clearDraft, router],
  );

  const restorePromptWhenEntryIsAccessible = useCallback((modalKey: string) => {
    const check = (frame = 0) => {
      if (phase.current !== "restoring" || pendingRef.current?.kind !== "pop")
        return;
      if (`${window.location.pathname}${window.location.search}` !== modalKey)
        return;
      const entry = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"][data-open]'),
      ).find((dialog) => {
        const title = dialog
          .getAttribute("aria-labelledby")
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
        const portal = dialog.closest<HTMLElement>("[data-base-ui-portal]");
        return (
          (title?.includes("New appointment") ||
            title?.includes("Appointment details")) &&
          !portal?.hasAttribute("aria-hidden") &&
          !portal?.hasAttribute("inert")
        );
      });
      if (entry) {
        phase.current = "prompt";
        restoreRequested.current = false;
        setPromptInstance((instance) => instance + 1);
        setPromptOpen(true);
      } else if (frame < 240) {
        requestAnimationFrame(() => check(frame + 1));
      }
    };
    requestAnimationFrame(() => check());
  }, []);

  const onRouteCommit = useCallback(
    (routeKey: string) => {
      if (phase.current !== "restoring" || pendingRef.current?.kind !== "pop")
        return;
      const target = modalHref.current;
      if (!target) return;
      const modal = new URL(target);
      const modalKey = `${modal.pathname}${modal.search}`;
      if (routeKey === modalKey) {
        restorePromptWhenEntryIsAccessible(modalKey);
        return;
      }
      if (!restoreRequested.current) {
        restoreRequested.current = true;
        router.forward();
      }
    },
    [restorePromptWhenEntryIsAccessible, router],
  );

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !target.matches("input[name], select[name], textarea[name]")
      )
        return;
      focusReturn.current = target;
      focusName.current = target.getAttribute("name");
    };
    const onPopState = () => {
      if (phase.current === "discarding") {
        phase.current = "idle";
        return;
      }
      const isDirty = draftHasUnsavedWork(draftRef.current);
      if (!isDirty || !modalHref.current) return;
      if (phase.current === "prompt" || phase.current === "idle") {
        const wasPromptOpen = phase.current === "prompt";
        phase.current = "restoring";
        pendingRef.current = { kind: "pop" };
        if (!wasPromptOpen) {
          const active = document.activeElement;
          if (
            active instanceof HTMLElement &&
            active.matches("input[name], select[name], textarea[name]")
          ) {
            focusReturn.current = active;
            focusName.current = active.getAttribute("name");
          }
        }
        focusRestoreAttempt.current += 1;
        restoreRequested.current = false;
        setPromptOpen(false);
        setTraversalRevision((revision) => revision + 1);
      }
    };
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("popstate", onPopState, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("popstate", onPopState, true);
      focusRestoreAttempt.current += 1;
    };
  }, []);

  const keepEditing = useCallback(() => {
    phase.current = "idle";
    pendingRef.current = null;
    setPromptOpen(false);
    const attempt = ++focusRestoreAttempt.current;
    const restoreFocus = (frame = 0) => {
      if (attempt !== focusRestoreAttempt.current) return;
      const replacement = focusName.current
        ? Array.from(
            document.querySelectorAll<HTMLElement>(
              `[name="${CSS.escape(focusName.current)}"]`,
            ),
          ).find((element) => {
            const portal = element.closest<HTMLElement>(
              "[data-base-ui-portal]",
            );
            return (
              element.getClientRects().length > 0 &&
              !element.hasAttribute("disabled") &&
              !portal?.hasAttribute("aria-hidden") &&
              !portal?.hasAttribute("inert")
            );
          })
        : null;
      const original = focusReturn.current;
      const target =
        replacement ??
        (original?.isConnected && original.getClientRects().length > 0
          ? original
          : null);
      if (target && !target.closest("[inert]")) target.focus();
      else if (frame < 240)
        requestAnimationFrame(() => restoreFocus(frame + 1));
    };
    requestAnimationFrame(() => restoreFocus());
  }, []);

  const discard = useCallback(() => {
    const destination = pendingRef.current;
    phase.current = "discarding";
    pendingRef.current = null;
    setPromptOpen(false);
    clearDraft();
    if (destination?.kind === "navigate" && destination.href) {
      phase.current = "idle";
      router.push(destination.href);
    } else {
      router.back();
    }
  }, [clearDraft, router]);

  const markModalActive = useCallback((active: boolean) => {
    if (!active || typeof window === "undefined") return;
    modalHref.current = window.location.href;
  }, []);

  const value = useMemo(
    () => ({
      draft,
      formGeneration,
      setDraft: writeDraft,
      clearDraft,
      setModalActive: markModalActive,
      requestClose: () => begin({ kind: "close" }),
      requestNavigation: (href: string) => begin({ kind: "navigate", href }),
      isDirty: dirty,
    }),
    [
      draft,
      formGeneration,
      begin,
      dirty,
      markModalActive,
      writeDraft,
      clearDraft,
    ],
  );

  return (
    <Context.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <AppointmentRouteCommitObserver
          revision={traversalRevision}
          onCommit={onRouteCommit}
        />
      </Suspense>
      <OwnerDiscardDialog
        key={promptInstance}
        open={promptOpen}
        onKeepEditing={keepEditing}
        onDiscard={discard}
      />
    </Context.Provider>
  );
}

function AppointmentRouteCommitObserver({
  revision,
  onCommit,
}: {
  revision: number;
  onCommit: (routeKey: string) => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
  useEffect(() => onCommit(routeKey), [onCommit, routeKey, revision]);
  return null;
}

export function useOwnerAppointmentDraft() {
  const context = useContext(Context);
  if (!context) throw new Error("OwnerAppointmentProvider is missing.");
  return context;
}
