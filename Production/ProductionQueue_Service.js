/****************************************************
 * Project Savannah v1.3 - unattended production queue.
 ****************************************************/
const ProductionQueueService = (() => {
  const HANDLER = "processProductionQueue";

  function processNext() {
    const tasks = ProductionTaskRepository.getAll().filter(function (task) {
      return ["PREPARING", "READY"].indexOf(task.status) !== -1;
    }).sort(function (a, b) {
      return Number(b.priority || 3) - Number(a.priority || 3) || new Date(a.createdAt) - new Date(b.createdAt);
    });
    if (!tasks.length) return { processed: false, message: "No production tasks are waiting." };
    const task = tasks[0];
    const response = task.status === "READY" ?
      ProductionController.submitPrepared({ taskId: task.id }) :
      ProductionController.prepareNextScene({ taskId: task.id });
    if (!response || !response.success) {
      throw error_(response && response.error && response.error.message || "The queued production step failed.");
    }
    return { processed: true, taskId: task.id, previousStatus: task.status, result: response.data };
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
      return ["PREPARING", "READY", "PAUSED", "FAILED"].indexOf(task.status) !== -1;
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
  return { processNext: processNext, install: install, uninstall: uninstall, status: status };
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
