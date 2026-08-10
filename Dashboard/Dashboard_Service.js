/****************************************************
 * Project Savannah v1.2
 * Dashboard_Service.js
 *
 * Purpose:
 * Build the live dashboard model consumed by the app.
 *
 * Responsibilities:
 * - Request raw data from DashboardRepository.
 * - Apply dashboard business rules.
 * - Return frontend-safe data.
 *
 * Must not:
 * - Read spreadsheet ranges directly.
 * - Render HTML.
 * - Display alerts.
 ****************************************************/

const DashboardService = (() => {
  const DAILY_IDEA_TARGET = 3;
  const DAILY_SCRIPT_TARGET = 3;

  /**
   * Builds the complete live dashboard model.
   *
   * @return {Object} Frontend-ready dashboard model.
   */
  function getDashboardModel() {
    const rawData =
      DashboardRepository.getDashboardData();

    return {
      generatedAt: new Date().toISOString(),

      system: {
        status: Secrets.hasOpenAIApiKey()
          ? "operational"
          : "configuration_required",

        statusLabel: Secrets.hasOpenAIApiKey()
          ? "System operational"
          : "API key required",

        version:
          typeof APP !== "undefined" && APP.VERSION
            ? APP.VERSION
            : "v1.2"
      },

      kpis: {
        ideasGeneratedToday: {
          value: rawData.today.ideas,
          target: DAILY_IDEA_TARGET,
          progressPercentage: calculatePercentage_(
            rawData.today.ideas,
            DAILY_IDEA_TARGET
          )
        },

        scriptsCreatedToday: {
          value: rawData.today.scripts,
          target: DAILY_SCRIPT_TARGET,
          progressPercentage: calculatePercentage_(
            rawData.today.scripts,
            DAILY_SCRIPT_TARGET
          )
        },

        seoPacksReady: {
          value: rawData.today.seoPacks,
          target: DAILY_SCRIPT_TARGET,
          progressPercentage: calculatePercentage_(
            rawData.today.seoPacks,
            DAILY_SCRIPT_TARGET
          )
        },

        approvalQueue: {
          value: rawData.totals.approvalQueue
        },

        totalCost: {
          value: roundCurrency_(rawData.totalCost),
          formattedValue:
            formatCurrency_(rawData.totalCost)
        }
      },

      // Ordered to match the real production flow: idea -> script -> human
      // review -> SEO metadata -> render -> publish.
      pipeline: [
        createPipelineStage_(
          "Ideas",
          "active",
          rawData.totals.ideas
        ),

        createPipelineStage_(
          "Scripts",
          rawData.totals.scripts > 0
            ? "active"
            : "building",
          rawData.totals.scripts
        ),

        createPipelineStage_(
          "Approval",
          rawData.totals.approvalQueue > 0
            ? "review_required"
            : "planned",
          rawData.totals.approvalQueue
        ),

        createPipelineStage_(
          "SEO",
          rawData.totals.seoPacks > 0
            ? "active"
            : "planned",
          rawData.totals.seoPacks
        ),

        createPipelineStage_(
          "Production",
          rawData.totals.renders > 0
            ? "active"
            : "planned",
          rawData.totals.renders
        ),

        createPipelineStage_(
          "Published",
          rawData.totals.published > 0
            ? "active"
            : "planned",
          rawData.totals.published
        )
      ],

      totals: {
        ideas: rawData.totals.ideas,
        scripts: rawData.totals.scripts,
        seoPacks: rawData.totals.seoPacks,
        approvalQueue:
          rawData.totals.approvalQueue,
        logs: rawData.totals.logRecords,
        costs: rawData.totals.costRecords
      },

      recentActivity:
        rawData.recentActivity.map(
          mapActivityRecord_
        )
    };
  }

  /**
   * Creates one pipeline-stage view model.
   *
   * @param {string} name
   * @param {string} status
   * @param {number} recordCount
   * @return {Object}
   */
  function createPipelineStage_(
    name,
    status,
    recordCount
  ) {
    return {
      name: name,
      status: status,
      statusLabel:
        getPipelineStatusLabel_(status),
      badgeClass:
        getPipelineBadgeClass_(status),
      recordCount: Number(recordCount) || 0
    };
  }

  /**
   * Maps a repository log record into a UI-safe record.
   *
   * @param {Object} activity
   * @return {Object}
   */
  function mapActivityRecord_(activity) {
    return {
      timestamp: activity.timestamp,
      displayTime:
        formatActivityTime_(activity.timestamp),
      action: activity.action,
      status: activity.status,
      message:
        activity.message ||
        activity.action ||
        "Activity recorded",
      badgeClass:
        getActivityBadgeClass_(activity.status)
    };
  }

  /**
   * Calculates progress against a target.
   *
   * Progress is capped at 100 for display purposes.
   *
   * @param {number} value
   * @param {number} target
   * @return {number}
   */
  function calculatePercentage_(value, target) {
    const numericValue = Number(value) || 0;
    const numericTarget = Number(target) || 0;

    if (numericTarget <= 0) {
      return 0;
    }

    return Math.min(
      Math.round(
        (numericValue / numericTarget) * 100
      ),
      100
    );
  }

  /**
   * Returns a human-readable pipeline status.
   *
   * @param {string} status
   * @return {string}
   */
  function getPipelineStatusLabel_(status) {
    const labels = {
      active: "Active",
      building: "Building",
      planned: "Planned",
      review_required: "Review required"
    };

    return labels[status] || "Unknown";
  }

  /**
   * Returns the design-system badge class for a stage.
   *
   * @param {string} status
   * @return {string}
   */
  function getPipelineBadgeClass_(status) {
    const classes = {
      active: "badge-success",
      building: "badge-warning",
      planned: "",
      review_required: "badge-info"
    };

    return classes[status] || "";
  }

  /**
   * Returns the badge class for a log status.
   *
   * @param {string} status
   * @return {string}
   */
  function getActivityBadgeClass_(status) {
    const normalisedStatus =
      String(status || "").toLowerCase();

    if (
      normalisedStatus === "success" ||
      normalisedStatus === "completed"
    ) {
      return "badge-success";
    }

    if (
      normalisedStatus === "failed" ||
      normalisedStatus === "error"
    ) {
      return "badge-danger";
    }

    if (
      normalisedStatus === "warning" ||
      normalisedStatus === "pending"
    ) {
      return "badge-warning";
    }

    return "badge-info";
  }

  /**
   * Formats an ISO timestamp for activity display.
   *
   * @param {string} timestamp
   * @return {string}
   */
  function formatActivityTime_(timestamp) {
    if (!timestamp) {
      return "";
    }

    const date = new Date(timestamp);

    if (isNaN(date.getTime())) {
      return String(timestamp);
    }

    return Utilities.formatDate(
      date,
      Session.getScriptTimeZone(),
      "dd MMM yyyy, HH:mm"
    );
  }

  /**
   * Rounds currency to four decimal places.
   *
   * @param {number} value
   * @return {number}
   */
  function roundCurrency_(value) {
    return Math.round(
      (Number(value) || 0) * 10000
    ) / 10000;
  }

  /**
   * Formats the estimated cost.
   *
   * @param {number} value
   * @return {string}
   */
  function formatCurrency_(value) {
    return "£" + roundCurrency_(value).toFixed(4);
  }

  return {
    getDashboardModel: getDashboardModel
  };
})();

/**
 * Tests the repository and service together.
 *
 * @return {Object} Complete dashboard model.
 */
function testDashboardService() {
  const model =
    DashboardService.getDashboardModel();

  if (
    !model ||
    !model.kpis ||
    !Array.isArray(model.pipeline) ||
    !Array.isArray(model.recentActivity)
  ) {
    throw new Error(
      "Dashboard service returned an invalid model."
    );
  }

  Logger.log(
    JSON.stringify(model, null, 2)
  );

  Logger.log(
    "Dashboard service test completed successfully."
  );

  return model;
}