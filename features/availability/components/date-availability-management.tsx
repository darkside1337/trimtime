"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { OwnerDiscardDialog } from "@/components/owner-discard-dialog";
import type { AvailabilityData } from "../queries";
import { createTimeBlockAction, removeTimeBlockAction } from "../actions";
import { DateOverrideFields } from "./date-override-fields";
import { dateRangeDrafts } from "../date-editor";
import { useDateAvailability } from "../hooks/use-date-availability";
import { useTimeBlockDraft } from "../hooks/use-time-block-draft";
import { useDateOverrideDraft } from "../hooks/use-date-override-draft";
import { useDiscardGuard } from "../hooks/use-discard-guard";
import {
  emitAvailabilityChanged,
  subscribeAvailabilityAdd,
  subscribeAvailabilityEdit,
} from "../availability-events";
import { BarberTimeBlockEditor } from "./barber-time-block-editor";
import { DateExceptionDialog } from "./date-exception-dialog";
import { RemoveBlockDialog } from "./remove-block-dialog";
import {
  barberIdForTarget,
  isSameTarget,
  scheduleTargetFromValue,
  type ScheduleTarget,
} from "../types";

type ExceptionView = "date" | "block";

export function DateAvailabilityManagement({
  initial,
}: {
  initial: AvailabilityData;
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [dialogDate, setDialogDate] = useState("");
  const [dialogTarget, setDialogTarget] = useState<ScheduleTarget>({
    kind: "shop",
  });
  const [exceptionView, setExceptionView] = useState<ExceptionView>("date");
  const [removeBlockId, setRemoveBlockId] = useState<string | null>(null);
  const [removeMessage, setRemoveMessage] = useState("");
  const [target, setTarget] = useState<ScheduleTarget>({ kind: "shop" });
  const [shopBlockBarberId, setShopBlockBarberId] = useState("");
  const { loaded, loading, load: loadAvailability } = useDateAvailability();
  const data = loaded?.data ?? null;
  const scheduleDraft = useDateOverrideDraft();
  const { draft, dirty, fieldErrors, loadDraft } = scheduleDraft;
  const [mutationPending, setMutationPending] = useState(false);
  const [message, setMessage] = useState("");
  const blockDraft = useTimeBlockDraft(date, setMessage);
  const { startInstant, endInstant, note } = blockDraft;
  const activeBarbers = useMemo(
    () => initial.barbers.filter((barber) => !barber.archived),
    [initial.barbers],
  );
  const targetArchived = initial.barbers.some(
    (barber) =>
      target.kind === "barber" &&
      barber.id === target.barberId &&
      barber.archived,
  );
  const discardGuard = useDiscardGuard(dirty || blockDraft.hasDraft, () => {
    scheduleDraft.discardChanges();
    blockDraft.reset();
  });
  const busy = loading || mutationPending;
  const blockBarberId =
    barberIdForTarget(target, activeBarbers) ||
    (activeBarbers.some((barber) => barber.id === shopBlockBarberId)
      ? shopBlockBarberId
      : "");
  const hasLoadedSelection = Boolean(
    loaded &&
    loaded.date === date &&
    isSameTarget(loaded.target, target) &&
    loaded.date === dialogDate &&
    isSameTarget(loaded.target, dialogTarget),
  );

  useEffect(() => {
    return subscribeAvailabilityAdd(() => {
      setDialogDate(date);
      setDialogTarget(target);
      setAddDialogOpen(true);
    });
  }, [date, target]);

  const load = useCallback(
    async (dateValue: string, targetValue: ScheduleTarget) => {
      const result = await loadAvailability(dateValue, targetValue);
      if (!result) return false;
      if ("error" in result) {
        setMessage(
          result.error ?? "Unable to load dated availability. Try again.",
        );
        return false;
      }
      loadDraft(result.state);
      setMessage("");
      return true;
    },
    [loadAvailability, loadDraft],
  );

  const openSelection = useCallback(
    (next: { date: string; target: ScheduleTarget }, view: ExceptionView) => {
      setDialogDate(next.date);
      setDialogTarget(next.target);
      setExceptionView(view);
      setDate(next.date);
      setTarget(next.target);
      setShopBlockBarberId("");
      void load(next.date, next.target);
      setAddDialogOpen(true);
    },
    [load],
  );
  const guardDiscard = discardGuard.guard;

  useEffect(() => {
    return subscribeAvailabilityEdit((detail) => {
      const next = {
        date: detail.date,
        target: scheduleTargetFromValue(detail.target),
        view: detail.view ?? "date",
      };
      const open = () => openSelection(next, next.view);
      guardDiscard(open, open, true);
    });
  }, [guardDiscard, openSelection]);

  const reload = () => load(date, target);

  async function afterMutation(
    successMessage?: string,
    reloadFailedMessage?: string,
  ) {
    emitAvailabilityChanged();
    router.refresh();
    if (await reload()) {
      if (successMessage) setMessage(successMessage);
    } else if (reloadFailedMessage) setMessage(reloadFailedMessage);
  }

  function requestAddDialogClose() {
    if (busy) return;
    discardGuard.guard(
      () => {
        setAddDialogOpen(false);
        void reload();
      },
      () => setAddDialogOpen(false),
    );
  }

  function requestDialogSelection(next: {
    date: string;
    target: ScheduleTarget;
  }) {
    const applySelection = () => {
      setDialogDate(next.date);
      setDialogTarget(next.target);
      setShopBlockBarberId("");
      blockDraft.reset();
    };
    discardGuard.guard(
      () => openSelection(next, exceptionView),
      applySelection,
      true,
    );
  }

  async function continueFromAddDialog() {
    if (!dialogDate) {
      setMessage("Choose a date to review or add an exception.");
      return;
    }
    const next = {
      date: dialogDate,
      target: dialogTarget,
      view: exceptionView,
    };
    discardGuard.guard(
      () => openSelection(next, next.view),
      async () => {
        if (await load(next.date, next.target)) {
          setDate(next.date);
          setTarget(next.target);
          setShopBlockBarberId("");
          setAddDialogOpen(true);
        }
      },
      true,
    );
  }

  async function removeBlock(id: string) {
    setMutationPending(true);
    let result: Awaited<ReturnType<typeof removeTimeBlockAction>>;
    try {
      result = await removeTimeBlockAction({ id });
    } catch {
      setMutationPending(false);
      const error =
        "Removal status is uncertain. Reload saved state before retrying.";
      setRemoveMessage(error);
      setMessage(error);
      return;
    }
    setMutationPending(false);
    if (!result.success) {
      setRemoveMessage(result.error.message);
      setMessage(result.error.message);
      return;
    }
    setRemoveBlockId(null);
    setRemoveMessage("");
    setMessage("Block removed. Preview again to see the updated availability.");
    await afterMutation();
  }

  async function saveSchedule() {
    setMutationPending(true);
    const result = await scheduleDraft.save({ date, target, data });
    setMutationPending(false);
    if (result.type === "invalid") {
      setMessage("Check the hours and break ranges.");
      return;
    }
    if (result.type === "not-ready") return;
    if (result.type === "error") {
      setMessage(result.message);
      return;
    }
    if (result.type === "uncertain") {
      setMessage(
        "Save status is uncertain. Reload saved state before retrying.",
      );
      return;
    }
    await afterMutation(
      "Saved. Preview again to see the updated availability.",
      "Saved, but the refreshed state could not be loaded. Reload date to verify.",
    );
  }

  async function addBlock() {
    if (!data || !date || !startInstant || !endInstant) {
      setMessage(
        "Resolve both block times and choose any repeated-time offsets.",
      );
      return;
    }
    const barberId = blockBarberId;
    if (!barberId) {
      setMessage("Add an active barber before creating a block.");
      return;
    }
    setMutationPending(true);
    let result: Awaited<ReturnType<typeof createTimeBlockAction>>;
    try {
      result = await createTimeBlockAction({
        barberId,
        date,
        timeZone: data.timeZone,
        start: startInstant,
        end: endInstant,
        note,
      });
    } catch {
      setMutationPending(false);
      setMessage(
        "Save status is uncertain. Reload saved state before retrying.",
      );
      return;
    }
    setMutationPending(false);
    if (!result.success) {
      setMessage(result.error.message);
      return;
    }
    blockDraft.reset();
    await afterMutation(
      "Block saved. Preview again to see the updated availability.",
      "Block saved, but the refreshed state could not be loaded. Reload saved state to verify.",
    );
  }

  function handleOverrideChange(enabled: boolean) {
    if (enabled && !draft.override && !draft.working.length && date) {
      const day = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
      const recurring =
        target.kind === "shop"
          ? initial.shop.week[day]
          : initial.barbers.find((barber) => barber.id === target.barberId)
              ?.schedule.week[day];
      scheduleDraft.changeDraft({
        ...draft,
        working: dateRangeDrafts(recurring?.working),
        breaks: dateRangeDrafts(recurring?.breaks),
        override: enabled,
      });
      return;
    }
    scheduleDraft.changeDraft({ ...draft, override: enabled });
  }

  function handleRequestBlockRemoval(id: string) {
    setRemoveMessage("");
    setRemoveBlockId(id);
  }

  function handleRemoveDialogOpenChange(open: boolean) {
    if (!open && !busy) setRemoveBlockId(null);
  }

  function handleKeepEditing() {
    const hadPendingLoad = discardGuard.hasPendingLoad;
    discardGuard.keepEditing();
    if (!addDialogOpen && !hadPendingLoad) setAddDialogOpen(true);
  }

  return (
    <section
      className="mt-10 rounded-2xl border border-border bg-card p-5 sm:p-7"
      aria-labelledby="dated-availability-title"
    >
      <h2
        id="dated-availability-title"
        className="font-heading text-2xl font-bold"
      >
        Overrides &amp; blocks
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Review, add, and remove saved one-date changes and individual barber
        blocks in {initial.timeZone}.
      </p>
      <DateExceptionDialog
        open={addDialogOpen}
        date={date}
        dialogDate={dialogDate}
        dialogTarget={dialogTarget}
        exceptionView={exceptionView}
        hasLoadedSelection={hasLoadedSelection}
        busy={busy}
        dirty={dirty}
        message={message}
        barbers={initial.barbers}
        onSelectionChange={requestDialogSelection}
        onLoad={continueFromAddDialog}
        onViewChange={setExceptionView}
        onClose={requestAddDialogClose}
      >
        {hasLoadedSelection && date && data && (
          <>
            {exceptionView === "date" && (
              <DateOverrideFields
                date={date}
                target={target}
                targetArchived={targetArchived}
                draft={draft}
                busy={busy}
                dirty={dirty}
                fieldErrors={fieldErrors}
                onDraftChange={scheduleDraft.changeDraft}
                onOverrideChange={handleOverrideChange}
                onSave={saveSchedule}
                onReload={reload}
              />
            )}
            {exceptionView === "block" && (
              <BarberTimeBlockEditor
                date={date}
                target={target}
                targetArchived={targetArchived}
                barbers={initial.barbers}
                data={data}
                blockBarberId={blockBarberId}
                onBlockBarberChange={setShopBlockBarberId}
                busy={busy}
                dirty={dirty}
                draft={blockDraft}
                onSave={addBlock}
                onReload={continueFromAddDialog}
                onRemove={handleRequestBlockRemoval}
              />
            )}
          </>
        )}
      </DateExceptionDialog>
      <RemoveBlockDialog
        open={removeBlockId !== null}
        busy={busy}
        canRemove={Boolean(removeBlockId)}
        message={removeMessage}
        onOpenChange={handleRemoveDialogOpenChange}
        onKeepBlock={() => setRemoveBlockId(null)}
        onConfirm={() => removeBlockId && removeBlock(removeBlockId)}
      />
      <OwnerDiscardDialog
        open={discardGuard.open}
        onKeepEditing={handleKeepEditing}
        onDiscard={discardGuard.discard}
      />
    </section>
  );
}
