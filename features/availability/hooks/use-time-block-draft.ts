import { useRef, useState } from "react";
import { getBlockBoundaryChoicesAction } from "../actions";
import { parseDraftMinute } from "../schedule-draft";

export type TimeBoundary = { instant: string; offset: string };

export function useTimeBlockDraft(
  date: string,
  onMessage: (message: string) => void,
) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [startChoices, setStartChoices] = useState<TimeBoundary[]>([]);
  const [endChoices, setEndChoices] = useState<TimeBoundary[]>([]);
  const [startInstant, setStartInstant] = useState("");
  const [endInstant, setEndInstant] = useState("");
  const [note, setNote] = useState("");
  const startVersion = useRef(0);
  const endVersion = useRef(0);

  const hasDraft = Boolean(start || end || startInstant || endInstant || note);

  function changeBoundary(value: string, isEnd: boolean) {
    if (isEnd) {
      endVersion.current++;
      setEnd(value);
      setEndChoices([]);
      setEndInstant("");
    } else {
      startVersion.current++;
      setStart(value);
      setStartChoices([]);
      setStartInstant("");
    }
  }

  function reset() {
    startVersion.current++;
    endVersion.current++;
    setStart("");
    setEnd("");
    setStartChoices([]);
    setEndChoices([]);
    setStartInstant("");
    setEndInstant("");
    setNote("");
  }

  async function resolveBoundary(value: string, isEnd: boolean) {
    const version = isEnd ? ++endVersion.current : ++startVersion.current;
    const currentVersion = () =>
      isEnd ? endVersion.current : startVersion.current;
    if (isEnd) {
      setEndChoices([]);
      setEndInstant("");
    } else {
      setStartChoices([]);
      setStartInstant("");
    }
    const minute = parseDraftMinute(value, isEnd);
    if (!date || minute === null) {
      onMessage("Enter a valid local time first.");
      return;
    }
    let result: Awaited<ReturnType<typeof getBlockBoundaryChoicesAction>>;
    try {
      result = await getBlockBoundaryChoicesAction({ date, minute });
    } catch {
      if (version === currentVersion())
        onMessage("Unable to resolve that time. Try again.");
      return;
    }
    if (version !== currentVersion()) return;
    if (!result.success) {
      onMessage(result.error.message);
      return;
    }
    const choices = result.data;
    if (!choices.length) {
      onMessage("That local time does not exist in the shop time zone.");
      return;
    }
    if (isEnd) {
      setEndChoices(choices);
      setEndInstant(choices.length === 1 ? choices[0]!.instant : "");
    } else {
      setStartChoices(choices);
      setStartInstant(choices.length === 1 ? choices[0]!.instant : "");
    }
    onMessage(
      choices.length > 1
        ? "Choose the correct UTC offset for this repeated local time."
        : "",
    );
  }

  return {
    start,
    end,
    startChoices,
    endChoices,
    startInstant,
    endInstant,
    note,
    hasDraft,
    setNote,
    setStartInstant,
    setEndInstant,
    changeBoundary,
    resolveBoundary,
    reset,
  };
}
