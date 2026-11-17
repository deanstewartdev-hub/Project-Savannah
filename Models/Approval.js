/****************************************************
 * Project Savannah v1.3
 * Models/Approval.js
 *
 * Purpose:
 * Define the canonical Approval Queue domain model
 * used throughout Project Savannah.
 *
 * Responsibilities:
 * - Create consistently structured approval records.
 * - Link approval records to saved scripts and ideas.
 * - Define valid Approval Queue workflow statuses.
 * - Validate approval records and review decisions.
 * - Control valid workflow status transitions.
 * - Preserve audit timestamps and reviewer details.
 * - Produce safe plain objects for repositories.
 *
 * Must not:
 * - Access Google Sheets.
 * - Call AI providers.
 * - Update Script records directly.
 * - Update Idea records directly.
 * - Log workflow events.
 * - Render frontend HTML.
 ****************************************************/

const ApprovalModel = (() => {
  const MODEL_VERSION = "approval-model-v1.0";

  const STATUS = Object.freeze({
    PENDING_APPROVAL: "PENDING_APPROVAL",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    CHANGES_REQUESTED: "CHANGES_REQUESTED",
    CANCELLED: "CANCELLED"
  });

  const ALLOWED_STATUSES = Object.freeze(
    Object.keys(STATUS).map(function (key) {
      return STATUS[key];
    })
  );

  const TERMINAL_STATUSES = Object.freeze([
    STATUS.APPROVED,
    STATUS.REJECTED,
    STATUS.CHANGES_REQUESTED,
    STATUS.CANCELLED
  ]);

  const ALLOWED_TRANSITIONS = Object.freeze({
    PENDING_APPROVAL: Object.freeze([
      STATUS.APPROVED,
      STATUS.REJECTED,
      STATUS.CHANGES_REQUESTED,
      STATUS.CANCELLED
    ]),
    APPROVED: Object.freeze([]),
    REJECTED: Object.freeze([]),
    CHANGES_REQUESTED: Object.freeze([]),
    CANCELLED: Object.freeze([])
  });

  /**
   * Creates a canonical Approval Queue record.
   *
   * @param {Object=} data Approval source data.
   * @return {Object} Canonical approval model.
   */
  function create(data) {
    const source = clone_(data || {});
    const now = new Date().toISOString();

    const approval = {
      id:
        normaliseOptionalString_(
          source.id ||
          source.approvalId ||
          source["Approval ID"]
        ) || createId_(),

      scriptId: firstNonEmptyString_([
        source.scriptId,
        source["Script ID"]
      ]),

      ideaId: firstNonEmptyString_([
        source.ideaId,
        source["Idea ID"]
      ]),

      scriptVersion: normalisePositiveInteger_(
        source.scriptVersion,
        1
      ),

      title: firstNonEmptyString_([
        source.title,
        source.scriptTitle,
        source["Script Title"],
        source["Title"]
      ]),

      status: normaliseStatus_(
        source.status || STATUS.PENDING_APPROVAL
      ),

      submittedAt:
        normaliseDateString_(source.submittedAt) ||
        normaliseDateString_(source.createdAt) ||
        now,

      submittedBy: normaliseOptionalString_(
        source.submittedBy
      ),

      reviewedAt: normaliseDateString_(
        source.reviewedAt
      ),

      reviewedBy: normaliseOptionalString_(
        source.reviewedBy
      ),

      reviewNotes: normaliseOptionalString_(
        source.reviewNotes
      ),

      decisionReason: normaliseOptionalString_(
        source.decisionReason
      ),

      metadata: normaliseObject_(source.metadata),

      createdAt:
        normaliseDateString_(source.createdAt) ||
        now,

      updatedAt:
        normaliseDateString_(source.updatedAt) ||
        now,

      version: normalisePositiveInteger_(
        source.version,
        1
      ),

      modelVersion: MODEL_VERSION
    };

    validate(approval);

    return approval;
  }

  /**
   * Creates a pending Approval Queue record from a
   * previously saved ScriptModel record.
   *
   * The script content itself is not copied into the
   * approval record. The saved script remains the
   * canonical source of review content.
   *
   * @param {Object} script Saved ScriptModel record.
   * @param {Object=} context Submission context.
   * @return {Object} Pending approval record.
   */
  function fromScript(script, context) {
    if (
      !script ||
      typeof script !== "object" ||
      Array.isArray(script)
    ) {
      throw createModelError_(
        "A valid saved script object is required."
      );
    }

    const scriptId = firstNonEmptyString_([
      script.id,
      script.scriptId,
      script["Script ID"]
    ]);

    const ideaId = firstNonEmptyString_([
      script.ideaId,
      script["Idea ID"]
    ]);

    const title = firstNonEmptyString_([
      script.title,
      script.scriptTitle,
      script["Script Title"],
      script["Title"]
    ]);

    if (!scriptId) {
      throw createModelError_(
        "The saved script must contain a Script ID."
      );
    }

    if (!ideaId) {
      throw createModelError_(
        "The saved script must contain an Idea ID."
      );
    }

    if (!title) {
      throw createModelError_(
        "The saved script must contain a title."
      );
    }

    const submissionContext = clone_(context || {});
    const submittedAt =
      normaliseDateString_(
        submissionContext.submittedAt
      ) || new Date().toISOString();

    const baseData = {
      scriptId: scriptId,
      ideaId: ideaId,
      scriptVersion: normalisePositiveInteger_(
        script.version,
        1
      ),
      title: title,
      status: STATUS.PENDING_APPROVAL,
      submittedAt: submittedAt,
      submittedBy: normaliseOptionalString_(
        submissionContext.submittedBy
      ),
      reviewedAt: "",
      reviewedBy: "",
      reviewNotes: normaliseOptionalString_(
        submissionContext.reviewNotes
      ),
      decisionReason: "",
      metadata: mergeObjects_(
        {
          sourceType: "SCRIPT",
          sourceScriptStatus:
            normaliseOptionalString_(script.status),
          sourceScriptModelVersion:
            normaliseOptionalString_(
              script.modelVersion
            )
        },
        submissionContext.metadata || {}
      )
    };

    return create(
      mergeObjects_(
        baseData,
        pickSupportedSubmissionOverrides_(
          submissionContext
        )
      )
    );
  }

  /**
   * Validates the domain-level Approval model.
   *
   * @param {Object} approval Approval candidate.
   * @return {Object} Validation result.
   */
  function validate(approval) {
    const errors = [];

    if (
      !approval ||
      typeof approval !== "object" ||
      Array.isArray(approval)
    ) {
      throw createModelError_(
        "Approval must be a valid object."
      );
    }

    validateRequiredString_(
      approval.id,
      "Approval ID",
      errors
    );

    validateRequiredString_(
      approval.scriptId,
      "Script ID",
      errors
    );

    validateRequiredString_(
      approval.ideaId,
      "Idea ID",
      errors
    );

    validateRequiredString_(
      approval.title,
      "Script title",
      errors
    );

    validateStatus_(approval.status, errors);

    if (
      !Number.isInteger(approval.scriptVersion) ||
      approval.scriptVersion < 1
    ) {
      errors.push(
        "Script version must be a positive integer."
      );
    }

    if (
      !Number.isInteger(approval.version) ||
      approval.version < 1
    ) {
      errors.push(
        "Approval version must be a positive integer."
      );
    }

    validateTimestamp_(
      approval.submittedAt,
      "Submitted timestamp",
      errors,
      true
    );

    validateTimestamp_(
      approval.createdAt,
      "Created timestamp",
      errors,
      true
    );

    validateTimestamp_(
      approval.updatedAt,
      "Updated timestamp",
      errors,
      true
    );

    validateTimestamp_(
      approval.reviewedAt,
      "Reviewed timestamp",
      errors,
      false
    );

    validateDecisionFields_(approval, errors);

    if (
      !approval.metadata ||
      typeof approval.metadata !== "object" ||
      Array.isArray(approval.metadata)
    ) {
      errors.push(
        "Approval metadata must be an object."
      );
    }

    if (errors.length > 0) {
      throw createModelValidationError_(errors);
    }

    return {
      valid: true,
      errors: []
    };
  }

  /**
   * Returns a safe deep clone of an approval model.
   *
   * @param {Object} approval Approval model.
   * @return {Object} Cloned approval model.
   */
  function clone(approval) {
    return create(clone_(approval));
  }

  /**
   * Returns a plain serialisable object.
   *
   * @param {Object} approval Approval model.
   * @return {Object} Plain approval object.
   */
  function toObject(approval) {
    validate(approval);
    return clone_(approval);
  }

  /**
   * Returns a copy with selected fields updated.
   *
   * Approval ID, creation timestamp and submission
   * timestamp are preserved. The model version,
   * record version and update timestamp are advanced.
   *
   * Workflow status should normally be changed with
   * transition() rather than update().
   *
   * @param {Object} approval Existing approval model.
   * @param {Object} changes Fields to update.
   * @return {Object} Updated approval model.
   */
  function update(approval, changes) {
    validate(approval);

    if (
      !changes ||
      typeof changes !== "object" ||
      Array.isArray(changes)
    ) {
      throw createModelError_(
        "Approval changes must be a valid object."
      );
    }

    const safeChanges = clone_(changes);

    delete safeChanges.id;
    delete safeChanges.approvalId;
    delete safeChanges.createdAt;
    delete safeChanges.submittedAt;
    delete safeChanges.version;
    delete safeChanges.modelVersion;

    if (
      safeChanges.status !== undefined &&
      normaliseStatus_(safeChanges.status) !==
        approval.status
    ) {
      throw createModelError_(
        "Approval status must be changed with transition()."
      );
    }

    const merged = mergeObjects_(
      toObject(approval),
      safeChanges
    );

    merged.id = approval.id;
    merged.createdAt = approval.createdAt;
    merged.submittedAt = approval.submittedAt;
    merged.status = approval.status;
    merged.updatedAt = new Date().toISOString();
    merged.version = approval.version + 1;
    merged.modelVersion = MODEL_VERSION;

    return create(merged);
  }

  /**
   * Determines whether an approval can move from one
   * workflow status to another.
   *
   * @param {string} currentStatus Current status.
   * @param {string} nextStatus Requested status.
   * @return {boolean} True when transition is allowed.
   */
  function canTransition(currentStatus, nextStatus) {
    const current = normaliseStatus_(currentStatus);
    const next = normaliseStatus_(nextStatus);

    const allowed =
      ALLOWED_TRANSITIONS[current] || [];

    return allowed.indexOf(next) !== -1;
  }

  /**
   * Returns a copy with a new workflow status.
   *
   * Expected decision context:
   * {
   *   reviewedBy: string,
   *   reviewNotes: string,
   *   decisionReason: string,
   *   reviewedAt: string,
   *   metadata: Object
   * }
   *
   * @param {Object} approval Existing approval model.
   * @param {string} nextStatus Requested status.
   * @param {Object=} decision Review decision context.
   * @return {Object} Transitioned approval model.
   */
  function transition(
    approval,
    nextStatus,
    decision
  ) {
    validate(approval);

    const targetStatus =
      normaliseStatus_(nextStatus);

    if (
      !canTransition(
        approval.status,
        targetStatus
      )
    ) {
      throw createTransitionError_(
        approval.status,
        targetStatus
      );
    }

    const decisionContext = clone_(decision || {});
    const now = new Date().toISOString();

    const changes = {
      status: targetStatus,
      reviewedAt:
        normaliseDateString_(
          decisionContext.reviewedAt
        ) || now,
      reviewedBy:
        normaliseOptionalString_(
          decisionContext.reviewedBy
        ),
      reviewNotes:
        normaliseOptionalString_(
          decisionContext.reviewNotes
        ),
      decisionReason:
        normaliseOptionalString_(
          decisionContext.decisionReason
        ),
      metadata: mergeObjects_(
        approval.metadata || {},
        decisionContext.metadata || {}
      ),
      updatedAt: now,
      version: approval.version + 1,
      modelVersion: MODEL_VERSION
    };

    const transitioned = mergeObjects_(
      toObject(approval),
      changes
    );

    transitioned.id = approval.id;
    transitioned.scriptId = approval.scriptId;
    transitioned.ideaId = approval.ideaId;
    transitioned.createdAt = approval.createdAt;
    transitioned.submittedAt = approval.submittedAt;

    return create(transitioned);
  }

  /**
   * Determines whether an approval has reached a final
   * queue outcome.
   *
   * @param {Object|string} approvalOrStatus Approval
   *     model or status string.
   * @return {boolean} True when terminal.
   */
  function isTerminal(approvalOrStatus) {
    const status =
      typeof approvalOrStatus === "string"
        ? normaliseStatus_(approvalOrStatus)
        : normaliseStatus_(
            approvalOrStatus &&
              approvalOrStatus.status
          );

    return (
      TERMINAL_STATUSES.indexOf(status) !== -1
    );
  }

  /**
   * Validates review fields required by each status.
   *
   * @param {Object} approval Approval candidate.
   * @param {string[]} errors Error collection.
   */
  function validateDecisionFields_(
    approval,
    errors
  ) {
    if (
      approval.status ===
      STATUS.PENDING_APPROVAL
    ) {
      if (approval.reviewedAt) {
        errors.push(
          "A pending approval cannot have a reviewed timestamp."
        );
      }

      if (approval.reviewedBy) {
        errors.push(
          "A pending approval cannot have a reviewer."
        );
      }

      if (approval.decisionReason) {
        errors.push(
          "A pending approval cannot have a decision reason."
        );
      }

      return;
    }

    if (!approval.reviewedAt) {
      errors.push(
        "Reviewed timestamp is required after a decision."
      );
    }

    if (
      approval.status === STATUS.REJECTED &&
      !approval.decisionReason
    ) {
      errors.push(
        "A rejection reason is required."
      );
    }

    if (
      approval.status ===
        STATUS.CHANGES_REQUESTED &&
      !approval.decisionReason
    ) {
      errors.push(
        "A reason is required when requesting changes."
      );
    }
  }

  /**
   * Returns only supported submission overrides.
   *
   * Prevents fromScript() callers from replacing the
   * canonical script linkage or initial queue status.
   *
   * @param {Object} context Submission context.
   * @return {Object} Supported overrides.
   */
  function pickSupportedSubmissionOverrides_(
    context
  ) {
    const overrides = {};

    if (context.id) {
      overrides.id =
        normaliseOptionalString_(context.id);
    }

    if (context.approvalId) {
      overrides.id =
        normaliseOptionalString_(
          context.approvalId
        );
    }

    if (context.createdAt) {
      overrides.createdAt =
        normaliseDateString_(
          context.createdAt
        );
    }

    if (context.updatedAt) {
      overrides.updatedAt =
        normaliseDateString_(
          context.updatedAt
        );
    }

    if (context.version) {
      overrides.version =
        normalisePositiveInteger_(
          context.version,
          1
        );
    }

    return overrides;
  }

  /**
   * Validates a required string.
   *
   * @param {*} value Candidate value.
   * @param {string} fieldName Field name.
   * @param {string[]} errors Error collection.
   */
  function validateRequiredString_(
    value,
    fieldName,
    errors
  ) {
    if (
      typeof value !== "string" ||
      !value.trim()
    ) {
      errors.push(fieldName + " is required.");
    }
  }

  /**
   * Validates a workflow status.
   *
   * @param {*} status Candidate status.
   * @param {string[]} errors Error collection.
   */
  function validateStatus_(status, errors) {
    if (
      ALLOWED_STATUSES.indexOf(status) === -1
    ) {
      errors.push(
        "Status must be one of: " +
          ALLOWED_STATUSES.join(", ") +
          "."
      );
    }
  }

  /**
   * Validates an ISO-compatible timestamp.
   *
   * @param {*} value Timestamp value.
   * @param {string} fieldName Field description.
   * @param {string[]} errors Error collection.
   * @param {boolean} required Whether value is required.
   */
  function validateTimestamp_(
    value,
    fieldName,
    errors,
    required
  ) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      if (required) {
        errors.push(
          fieldName + " is required."
        );
      }

      return;
    }

    if (
      typeof value !== "string" ||
      isNaN(new Date(value).getTime())
    ) {
      errors.push(
        fieldName + " must be a valid date."
      );
    }
  }

  /**
   * Normalises a workflow status.
   *
   * @param {*} status Source status.
   * @return {string} Normalised status.
   */
  function normaliseStatus_(status) {
    const normalised = String(status || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");

    if (
      ALLOWED_STATUSES.indexOf(normalised) === -1
    ) {
      throw createModelError_(
        "Unsupported approval status: " +
          normalised +
          "."
      );
    }

    return normalised;
  }

  /**
   * Normalises an optional string.
   *
   * @param {*} value Source value.
   * @return {string} Normalised string.
   */
  function normaliseOptionalString_(value) {
    if (
      value === undefined ||
      value === null
    ) {
      return "";
    }

    return String(value).trim();
  }

  /**
   * Returns the first non-empty string.
   *
   * @param {Array} values Candidate values.
   * @return {string} First resolved string.
   */
  function firstNonEmptyString_(values) {
    for (
      let index = 0;
      index < values.length;
      index++
    ) {
      const value = normaliseOptionalString_(
        values[index]
      );

      if (value) {
        return value;
      }
    }

    return "";
  }

  /**
   * Normalises a positive integer.
   *
   * @param {*} value Candidate value.
   * @param {number} fallback Fallback value.
   * @return {number} Positive integer.
   */
  function normalisePositiveInteger_(
    value,
    fallback
  ) {
    const numericValue = Number(value);

    if (
      !Number.isInteger(numericValue) ||
      numericValue < 1
    ) {
      return fallback;
    }

    return numericValue;
  }

  /**
   * Normalises a date string.
   *
   * @param {*} value Candidate date.
   * @return {string} ISO timestamp or empty string.
   */
  function normaliseDateString_(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return "";
    }

    const parsedDate = new Date(value);

    if (isNaN(parsedDate.getTime())) {
      throw createModelError_(
        "Approval timestamps must contain valid dates."
      );
    }

    return parsedDate.toISOString();
  }

  /**
   * Normalises a plain metadata object.
   *
   * @param {*} value Source object.
   * @return {Object} Cloned object.
   */
  function normaliseObject_(value) {
    if (
      value === undefined ||
      value === null
    ) {
      return {};
    }

    if (
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw createModelError_(
        "Approval metadata must be an object."
      );
    }

    return clone_(value);
  }

  /**
   * Shallow-merges plain objects.
   *
   * @param {Object} base Base values.
   * @param {Object} overrides Override values.
   * @return {Object} Merged clone.
   */
  function mergeObjects_(base, overrides) {
    const result = clone_(base || {});
    const suppliedOverrides = overrides || {};

    Object.keys(suppliedOverrides).forEach(
      function (key) {
        result[key] = clone_(
          suppliedOverrides[key]
        );
      }
    );

    return result;
  }

  /**
   * Creates a unique approval identifier.
   *
   * @return {string} Approval ID.
   */
  function createId_() {
    return "APR-" + Utilities.getUuid();
  }

  /**
   * Creates a safe JSON-compatible deep clone.
   *
   * @param {*} value Source value.
   * @return {*} Cloned value.
   */
  function clone_(value) {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Creates a general model error.
   *
   * @param {string} message Error detail.
   * @return {Error} Model error.
   */
  function createModelError_(message) {
    const error = new Error(
      "Approval model error: " + message
    );

    error.name = "ApprovalModelError";

    return error;
  }

  /**
   * Creates a model validation error.
   *
   * @param {string[]} errors Validation failures.
   * @return {Error} Validation error.
   */
  function createModelValidationError_(errors) {
    const error = new Error(
      "Approval model failed validation:\n- " +
        errors.join("\n- ")
    );

    error.name =
      "ApprovalModelValidationError";

    error.validationErrors = errors.slice();

    return error;
  }

  /**
   * Creates an invalid-transition error.
   *
   * @param {string} currentStatus Current status.
   * @param {string} nextStatus Requested status.
   * @return {Error} Transition error.
   */
  function createTransitionError_(
    currentStatus,
    nextStatus
  ) {
    const error = new Error(
      "Approval cannot transition from " +
        currentStatus +
        " to " +
        nextStatus +
        "."
    );

    error.name =
      "ApprovalTransitionError";

    error.currentStatus = currentStatus;
    error.nextStatus = nextStatus;

    return error;
  }

  return {
    create: create,
    fromScript: fromScript,
    validate: validate,
    clone: clone,
    toObject: toObject,
    update: update,
    canTransition: canTransition,
    transition: transition,
    isTerminal: isTerminal,

    getStatuses: function () {
      return clone_(STATUS);
    },

    getAllowedTransitions: function () {
      return clone_(ALLOWED_TRANSITIONS);
    },

    getTerminalStatuses: function () {
      return clone_(TERMINAL_STATUSES);
    },

    getModelVersion: function () {
      return MODEL_VERSION;
    }
  };
})();
