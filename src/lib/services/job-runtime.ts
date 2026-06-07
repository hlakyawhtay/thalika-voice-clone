const activeControllers = new Map<string, AbortController>();

export function createJobAbortController(jobId: string) {
  const previous = activeControllers.get(jobId);
  previous?.abort();

  const controller = new AbortController();
  activeControllers.set(jobId, controller);
  return controller;
}

export function clearJobAbortController(jobId: string, controller?: AbortController) {
  if (controller && activeControllers.get(jobId) !== controller) return;
  activeControllers.delete(jobId);
}

export function abortActiveJob(jobId: string) {
  const controller = activeControllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isJobRunning(jobId: string) {
  return activeControllers.has(jobId);
}
