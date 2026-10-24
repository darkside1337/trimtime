"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RemoveBlockDialog } from "./remove-block-dialog";
import { OwnerDiscardDialog } from "@/components/owner-discard-dialog";
import type { AvailabilityData } from "../queries";
import { createTimeBlockAction, removeTimeBlockAction } from "../actions";
import { DateOverrideFields } from "./date-override-fields";
import { dateRangeDrafts } from "../date-editor";
import { useDateAvailability } from "../hooks/use-date-availability";
import { useTimeBlockDraft } from "../hooks/use-time-block-draft";
import { useDateOverrideDraft } from "../hooks/use-date-override-draft";
import { BarberTimeBlockEditor } from "./barber-time-block-editor";
import { DateExceptionDialog } from "./date-exception-dialog";

import { barberIdForTarget, isSameTarget, scheduleTargetFromValue, type ScheduleTarget } from "../types";
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
  const [dialogTarget, setDialogTarget] = useState<ScheduleTarget>({ kind: "shop" });
  const [exceptionView, setExceptionView] = useState<ExceptionView>("date");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingLoad, setPendingLoad] = useState<{
    date: string;
    target: ScheduleTarget;
    view?: ExceptionView;
  } | null>(null);
  const [removeBlockId, setRemoveBlockId] = useState<string | null>(null);
  const [removeMessage, setRemoveMessage] = useState("");
  const [target, setTarget] = useState<ScheduleTarget>({ kind: "shop" });
  const [blockBarberId, setBlockBarberId] = useState("");
  const {
    data,
    loadedTarget,
    loading,
    load: loadAvailability,
  } = useDateAvailability();
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
    (barber) => target.kind === "barber" && barber.id === target.barberId && barber.archived,
  );
  const hasBlockDraft = blockDraft.hasDraft;
  const busy = loading || mutationPending;
  const hasLoadedSelection =
    data?.date === date &&
    loadedTarget !== null && isSameTarget(loadedTarget, target) &&
    data.date === dialogDate &&
    loadedTarget !== null && isSameTarget(loadedTarget, dialogTarget);

  useEffect(() => {
    const openAdd = () => {
      setDialogDate(date);
      setDialogTarget(target);
      setAddDialogOpen(true);
    };
    window.addEventListener("trimtime:availability-add", openAdd);
    return () =>
      window.removeEventListener("trimtime:availability-add", openAdd);
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

  useEffect(() => {
    const editException = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          date?: string;
          target?: string;
          view?: ExceptionView;
        }>
      ).detail;
      if (!detail?.date || !detail.target) return;
      const next = {
        date: detail.date,
        target: scheduleTargetFromValue(detail.target),
        view: detail.view ?? "date",
      };
      if (dirty || hasBlockDraft) {
        setPendingLoad(next);
        setDiscardDialogOpen(true);
        return;
      }
      setExceptionView(next.view);
      setDialogDate(next.date);
      setDialogTarget(next.target);
      setAddDialogOpen(true);
      setDate(next.date);
      setTarget(next.target);
      setBlockBarberId(
        barberIdForTarget(next.target, activeBarbers),
      );
      void load(next.date, next.target);
    };
    window.addEventListener("trimtime:availability-edit", editException);
    return () =>
      window.removeEventListener("trimtime:availability-edit", editException);
  }, [activeBarbers, dirty, hasBlockDraft, load]);

  const reload = () => load(date, target);

  function handleLoadFromDialog() {
    void continueFromAddDialog();
  }

  function handleReloadDate() {
    void reload();
  }

  function requestAddDialogClose() {
    if (busy) return;
    if (dirty || hasBlockDraft) {
      setDiscardDialogOpen(true);
      return;
    }
    setAddDialogOpen(false);
  }

  function requestDialogSelection(next: { date: string; target: ScheduleTarget }) {
    if (dirty || hasBlockDraft) {
      setPendingLoad({ ...next, view: exceptionView });
      setDiscardDialogOpen(true);
      return;
    }
    setDialogDate(next.date);
    setDialogTarget(next.target);
    setBlockBarberId(
      barberIdForTarget(next.target, activeBarbers),
    );
    blockDraft.reset();
  }

  async function continueFromAddDialog() {
    if (!dialogDate) {
      setMessage("Choose a date to review or add an exception.");
      return;
    }
    if (dirty || hasBlockDraft) {
      setPendingLoad({
        date: dialogDate,
        target: dialogTarget,
        view: exceptionView,
      });
      setDiscardDialogOpen(true);
      return;
    }
    if (await load(dialogDate, dialogTarget)) {
      setDate(dialogDate);
      setTarget(dialogTarget);
      setBlockBarberId(
        barberIdForTarget(dialogTarget, activeBarbers),
      );
      setAddDialogOpen(true);
    }
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
    if (result.success) {
      window.dispatchEvent(new Event("trimtime:availability-changed"));
      router.refresh();
      await reload();
    }
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
    window.dispatchEvent(new Event("trimtime:availability-changed"));
    router.refresh();
    if (await reload()) {
      setMessage("Saved. Preview again to see the updated availability.");
    } else {
      setMessage(
        "Saved, but the refreshed state could not be loaded. Reload date to verify.",
      );
    }
  }

  async function addBlock() {
    if (!data || !date || !startInstant || !endInstant) {
      setMessage(
        "Resolve both block times and choose any repeated-time offsets.",
      );
      return;
    }
    const barberId =
      barberIdForTarget(target, activeBarbers) || blockBarberId;
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
    window.dispatchEvent(new Event("trimtime:availability-changed"));
    router.refresh();
    if (await reload()) {
      setMessage("Block saved. Preview again to see the updated availability.");
    } else {
      setMessage(
        "Block saved, but the refreshed state could not be loaded. Reload saved state to verify.",
      );
    }
  }

  function handleOverrideChange(enabled: boolean) {
    if (enabled && !draft.override && !draft.working.length && date) {
      const day = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
      const recurring =
        target.kind === "shop"
          ? initial.shop.week[day]
          : initial.barbers.find((barber) => barber.id === target.barberId)?.schedule
              .week[day];
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

  function handleSaveSchedule() {
    void saveSchedule();
  }

  function handleSaveBlock() {
    void addBlock();
  }

  function handleReloadBlock() {
    void continueFromAddDialog();
  }

  function handleRequestBlockRemoval(id: string) {
    setRemoveMessage("");
    setRemoveBlockId(id);
  }

  function handleRemoveDialogOpenChange(open: boolean) {
    if (!open && !busy) setRemoveBlockId(null);
  }

  function handleConfirmBlockRemoval() {
    if (removeBlockId) void removeBlock(removeBlockId);
  }

  function handleKeepEditing() {
    setDiscardDialogOpen(false);
    setPendingLoad(null);
    if (!addDialogOpen && !pendingLoad) setAddDialogOpen(true);
  }

  function handleDiscardChanges() {
    const next = pendingLoad;
    setPendingLoad(null);
    scheduleDraft.discardChanges();
    setDiscardDialogOpen(false);
    blockDraft.reset();
    if (next) {
      setDialogDate(next.date);
      setDialogTarget(next.target);
      setExceptionView(next.view ?? "date");
      setDate(next.date);
      setTarget(next.target);
      setBlockBarberId(
        barberIdForTarget(next.target, activeBarbers),
      );
      void load(next.date, next.target);
      setAddDialogOpen(true);
    } else {
      blockDraft.reset();
      setAddDialogOpen(false);
      void reload();
    }
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
        onLoad={handleLoadFromDialog}
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
                onSave={handleSaveSchedule}
                onReload={handleReloadDate}
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
                onBlockBarberChange={setBlockBarberId}
                busy={busy}
                dirty={dirty}
                draft={blockDraft}
                onSave={handleSaveBlock}
                onReload={handleReloadBlock}
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
        onConfirm={handleConfirmBlockRemoval}
      />
      <OwnerDiscardDialog
        open={discardDialogOpen}
        onKeepEditing={handleKeepEditing}
        onDiscard={handleDiscardChanges}
      />
    </section>
  );
}
