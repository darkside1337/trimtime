import {
  processNotificationRetriesWithCandidateSource,
  type RetryWorkerDependencies,
  type RetryCandidate,
} from "./retry-worker";

export function processNotificationRetriesForTests(
  injected: RetryWorkerDependencies,
  candidates: RetryCandidate[],
  candidateBarrier?: () => Promise<void>,
) {
  return processNotificationRetriesWithCandidateSource(injected, async () => {
    await candidateBarrier?.();
    return candidates;
  });
}
