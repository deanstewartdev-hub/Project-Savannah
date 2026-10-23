/****************************************************
 * Project Savannah v1.3 - unattended production queue.
 ****************************************************/
const ProductionQueueService = (() => {
  const HANDLER = "processProductionQueue";
  // After an interrupted attempt (timeout or crash) wait 5, 10, 20... minutes before trying again.
  const BACKOFF_BASE_MS = 5 * 60 * 1000;

  function interruptedAttempts(task) {
    return Math.max(0, Number(task && task.attempts || 0) - (task && task.preparedScenes || []).length);
  }
  // A PREPARING task whose last attempt never finished is not due until its backoff has passed.
  function isDue(task, nowMs) {
    if (!task || task.status !== "PREPARING") return true;
    const interrupted = interruptedAttempts(task);
    if (interrupted < 1) return true;
    const updated = new Date(task.updatedAt).getTime();
    return !isFinite(updated) || nowMs - updated >= BACKOFF_BASE_MS * Math.pow(2, interrupted - 1);
  }

  function processNext(nowMs) {
    const now = Number(nowMs) || Date.now();
    // The existing 5-minute automation also drains render callbacks even if
    // there are no queued scene-preparation tasks. A broken inbox (e.g. schema
    // mismatch) must not stop scene preparation; receipts stay pending.
    let callbacks;
    try {
      callbacks = MediaWorkerCallbackInbox.processPending();
    } catch (caught) {
      callbacks = { error: String(caught && caught.message || caught) };
    }
    // Settle tasks whose worker disappeared before choosing work. A failure here must not stop the tick.
    let stalled;
    try {
      stalled = ProductionController.reviewStalledTasks(now);
    } catch (caught) {
      stalled = { error: String(caught && caught.message || caught) };
    }
    // Under Cloud Run, scene preparation would only buy images the render ignores
    // (ProductionController refuses it), so leftover PREPARING tasks are not run.
    const cloudRun = provider_() === "cloud-run";
    const tasks = rankTasks(ProductionTaskRepository.getAll().filter(function (task) {
      return task.status === "READY" || (task.status === "PREPARING" && !cloudRun && isDue(task, now));
    }));
    if (!tasks.length) return { processed: false, message: "No production tasks are waiting.", callbacks: callbacks, stalled: stalled };
    const task = tasks[0];
    const response = task.status === "READY" ?
      ProductionController.submitPrepared({ taskId: task.id }) :
      ProductionController.prepareNextScene({ taskId: task.id });
    if (!response || !response.success) {
      const message = response && response.error && response.error.message || "The queued production step failed.";
      // A step that failed before it could record its own failure would stay first in line and
      // be retried every tick, starving every task behind it. Stop it unless the cause is
      // temporary (a busy lock, a rate limit).
      if (!(response && response.error && response.error.retryable === true)) containFailedTask_(task, message);
      throw error_(message);
    }
    return { processed: true, taskId: task.id, previousStatus: task.status, result: response.data };
  }

  function provider_() {
    return String(Secrets.getVideoProvider() || "cloud-run").toLowerCase();
  }

  function containFailedTask_(task, message) {
    try {
      const current = ProductionTaskRepository.getById(task.id);
      if (current && current.status === task.status) {
        ProductionTaskRepository.persist(ProductionTaskRepository.update(current, {
          status: "FAILED", errorMessage: "Stopped by the queue: " + message
        }));
      }
    } catch (ignored) {}
  }

  function rankTasks(tasks) {
    return (Array.isArray(tasks) ? tasks : []).slice().sort(function (a, b) {
      return Number(b.priority || 3) - Number(a.priority || 3) || new Date(a.createdAt) - new Date(b.createdAt);
    });
  }

  function install() {
    const existing = triggers_();
    if (!existing.length) ScriptApp.newTrigger(HANDLER).timeBased().everyMinutes(5).create();
    PropertiesService.getScriptProperties().setProperty("PRODUCTION_QUEUE_ENABLED", "true");
    return status();
  }

  function uninstall() {
    triggers_().forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    PropertiesService.getScriptProperties().deleteProperty("PRODUCTION_QUEUE_ENABLED");
    return status();
  }

  function status() {
    const waiting = ProductionTaskRepository.getAll().filter(function (task) {
      return ["PREPARING", "READY", "SUBMITTING", "PAUSED", "FAILED"].indexOf(task.status) !== -1;
    });
    return {
      enabled: PropertiesService.getScriptProperties().getProperty("PRODUCTION_QUEUE_ENABLED") === "true",
      workerCount: PropertiesService.getScriptProperties().getProperty("PRODUCTION_QUEUE_ENABLED") === "true" ? 1 : 0,
      waitingTasks: waiting.length,
      actionableTasks: waiting.filter(function (task) { return ["PREPARING", "READY"].indexOf(task.status) !== -1; }).length,
      intervalMinutes: 5
    };
  }

  function triggers_() {
    return ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === HANDLER;
    });
  }
  function error_(message) { const error = new Error(message); error.name = "ProductionQueueError"; return error; }
  return { processNext: processNext, rankTasks: rankTasks, isDue: isDue, install: install, uninstall: uninstall, status: status };
})();

function processProductionQueue() {
  try {
    const result = ProductionQueueService.processNext();
    LoggingService.success("QUEUE-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      "PRODUCTION_QUEUE", result.message || "Production queue processed one step.");
    return result;
  } catch (error) {
    try { LoggingService.failure("QUEUE-" + Utilities.getUuid().slice(0, 8).toUpperCase(),
      "PRODUCTION_QUEUE", "Production queue step failed.", error); } catch (ignored) {}
    throw error;
  }
}
