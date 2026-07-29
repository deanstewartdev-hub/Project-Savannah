/****************************************************
 * Project Savannah v1.3
 * Approval/Approval_Repository.js
 *
 * Persists ApprovalModel records in the Approval Queue
 * worksheet. Saved scripts remain the source of truth
 * for review content; this repository stores links and
 * workflow/audit data only.
 ****************************************************/

const ApprovalRepository = (() => {
  const REPOSITORY_VERSION = "approval-repository-v1.0";

  const HEADERS = Object.freeze([
    "Approval ID",
    "Script ID",
    "Idea ID",
    "Script Version",
    "Script Title",
    "Approval Status",
    "Submitted At",
    "Submitted By",
    "Reviewed At",
    "Reviewed By",
    "Review Notes",
    "Decision Reason",
    "Metadata JSON",
    "Created At",
    "Updated At",
    "Version",
    "Model Version"
  ]);

  const COLUMN = Object.freeze({
    APPROVAL_ID: 1,
    SCRIPT_ID: 2,
    IDEA_ID: 3,
    STATUS: 6
  });

  function saveApproval(approval) {
    const sheet = getOrCreateSheet_();
    const canonical = ApprovalModel.create(approval);

    if (findRowByApprovalId_(sheet, canonical.id)) {
      throw repositoryError_(
        "Approval " + canonical.id + " already exists."
      );
    }

    if (
      canonical.status === "PENDING_APPROVAL" &&
      findActiveRowByScriptId_(sheet, canonical.scriptId)
    ) {
      throw repositoryError_(
        "Script " + canonical.scriptId +
        " already has an active approval."
      );
    }

    const rowNumber = sheet.getLastRow() + 1;
    sheet
      .getRange(rowNumber, 1, 1, HEADERS.length)
      .setValues([toRow_(canonical)]);

    return result_("saved", canonical, rowNumber);
  }

  function updateApproval(approval) {
    const sheet = getOrCreateSheet_();
    const canonical = ApprovalModel.create(approval);
    const rowNumber = findRowByApprovalId_(
      sheet,
      canonical.id
    );

    if (!rowNumber) {
      throw repositoryError_(
        "Approval " + canonical.id + " does not exist."
      );
    }

    sheet
      .getRange(rowNumber, 1, 1, HEADERS.length)
      .setValues([toRow_(canonical)]);

    return result_("updated", canonical, rowNumber);
  }

  function getApprovalById(approvalId) {
    const sheet = getOrCreateSheet_();
    const rowNumber = findRowByApprovalId_(
      sheet,
      requireId_(approvalId, "Approval ID")
    );
    return rowNumber ? readRow_(sheet, rowNumber) : null;
  }

  function getActiveApprovalByScriptId(scriptId) {
    const sheet = getOrCreateSheet_();
    const rowNumber = findActiveRowByScriptId_(
      sheet,
      requireId_(scriptId, "Script ID")
    );
    return rowNumber ? readRow_(sheet, rowNumber) : null;
  }

  function getApprovalsByStatus(status) {
    const expected = String(status || "").trim().toUpperCase();
    if (!expected) {
      throw repositoryError_("Approval status is required.");
    }
    return getAllApprovals().filter(function (approval) {
      return approval.status === expected;
    });
  }

  function getApprovalsByScriptId(scriptId) {
    const expected = requireId_(scriptId, "Script ID");
    return getAllApprovals().filter(function (approval) {
      return approval.scriptId === expected;
    });
  }

  function getAllApprovals() {
    const sheet = getOrCreateSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }
    return sheet
      .getRange(2, 1, lastRow - 1, HEADERS.length)
      .getValues()
      .filter(function (row) {
        return String(row[0] || "").trim() !== "";
      })
      .map(rowToApproval_);
  }

  function ensureSheet() {
    getOrCreateSheet_();
    return true;
  }

  function getOrCreateSheet_() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) {
      throw repositoryError_(
        "No active spreadsheet is available."
      );
    }

    let sheet = spreadsheet.getSheetByName(
      SHEETS.APPROVAL_QUEUE
    );
    if (!sheet) {
      sheet = spreadsheet.insertSheet(
        SHEETS.APPROVAL_QUEUE
      );
    }
    ensureHeaders_(sheet);
    return sheet;
  }

  function ensureHeaders_(sheet) {
    if (sheet.getLastRow() === 0) {
      writeHeaders_(sheet);
      return;
    }

    const width = Math.max(sheet.getLastColumn(), HEADERS.length);
    const current = sheet
      .getRange(1, 1, 1, width)
      .getValues()[0]
      .map(function (value) {
        return String(value || "").trim();
      });

    const matches = HEADERS.every(function (header, index) {
      return current[index] === header;
    });
    if (matches) {
      return;
    }

    // The pre-v1.3 queue sheet was only a placeholder. It
    // may be upgraded safely when it contains no records.
    if (sheet.getLastRow() <= 1) {
      sheet.clear();
      writeHeaders_(sheet);
      return;
    }

    throw repositoryError_(
      "Approval Queue headers are outdated and the sheet contains data. " +
      "Migrate the existing records before continuing."
    );
  }

  function writeHeaders_(sheet) {
    sheet
      .getRange(1, 1, 1, HEADERS.length)
      .setValues([HEADERS.slice()]);
    sheet.setFrozenRows(1);
    sheet
      .getRange(1, 1, 1, HEADERS.length)
      .setFontWeight("bold");
  }

  function findRowByApprovalId_(sheet, approvalId) {
    return findRow_(sheet, COLUMN.APPROVAL_ID, approvalId);
  }

  function findActiveRowByScriptId_(sheet, scriptId) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return 0;
    }
    const rows = sheet
      .getRange(2, 1, lastRow - 1, HEADERS.length)
      .getValues();
    for (let index = 0; index < rows.length; index += 1) {
      if (
        String(rows[index][COLUMN.SCRIPT_ID - 1] || "").trim() === scriptId &&
        String(rows[index][COLUMN.STATUS - 1] || "").trim() ===
          "PENDING_APPROVAL"
      ) {
        return index + 2;
      }
    }
    return 0;
  }

  function findRow_(sheet, column, expected) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return 0;
    }
    const values = sheet
      .getRange(2, column, lastRow - 1, 1)
      .getValues();
    for (let index = 0; index < values.length; index += 1) {
      if (String(values[index][0] || "").trim() === expected) {
        return index + 2;
      }
    }
    return 0;
  }

  function readRow_(sheet, rowNumber) {
    return rowToApproval_(
      sheet
        .getRange(rowNumber, 1, 1, HEADERS.length)
        .getValues()[0]
    );
  }

  function toRow_(approval) {
    return [
      approval.id,
      approval.scriptId,
      approval.ideaId,
      approval.scriptVersion,
      approval.title,
      approval.status,
      approval.submittedAt,
      approval.submittedBy,
      approval.reviewedAt,
      approval.reviewedBy,
      approval.reviewNotes,
      approval.decisionReason,
      JSON.stringify(approval.metadata || {}),
      approval.createdAt,
      approval.updatedAt,
      approval.version,
      approval.modelVersion
    ];
  }

  function rowToApproval_(row) {
    let metadata = {};
    if (row[12]) {
      try {
        metadata = JSON.parse(String(row[12]));
      } catch (error) {
        throw repositoryError_(
          "Approval " + row[0] + " contains invalid metadata JSON."
        );
      }
    }
    return ApprovalModel.create({
      id: row[0],
      scriptId: row[1],
      ideaId: row[2],
      scriptVersion: Number(row[3]),
      title: row[4],
      status: row[5],
      submittedAt: dateValue_(row[6]),
      submittedBy: row[7],
      reviewedAt: dateValue_(row[8]),
      reviewedBy: row[9],
      reviewNotes: row[10],
      decisionReason: row[11],
      metadata: metadata,
      createdAt: dateValue_(row[13]),
      updatedAt: dateValue_(row[14]),
      version: Number(row[15]),
      modelVersion: row[16]
    });
  }

  function dateValue_(value) {
    if (!value) {
      return "";
    }
    if (Object.prototype.toString.call(value) === "[object Date]") {
      return value.toISOString();
    }
    return String(value);
  }

  function requireId_(value, label) {
    const id = String(value || "").trim();
    if (!id) {
      throw repositoryError_(label + " is required.");
    }
    return id;
  }

  function result_(action, approval, rowNumber) {
    return {
      saved: true,
      created: action === "saved",
      updated: action === "updated",
      rowNumber: rowNumber,
      approvalId: approval.id,
      scriptId: approval.scriptId,
      status: approval.status,
      version: approval.version,
      repositoryVersion: REPOSITORY_VERSION
    };
  }

  function repositoryError_(message) {
    const error = new Error(
      "Approval repository error: " + message
    );
    error.name = "ApprovalRepositoryError";
    return error;
  }

  return {
    saveApproval: saveApproval,
    updateApproval: updateApproval,
    getApprovalById: getApprovalById,
    getActiveApprovalByScriptId:
      getActiveApprovalByScriptId,
    getApprovalsByScriptId: getApprovalsByScriptId,
    getApprovalsByStatus: getApprovalsByStatus,
    getAllApprovals: getAllApprovals,
    ensureSheet: ensureSheet,
    getHeaders: function () {
      return HEADERS.slice();
    },
    getRepositoryVersion: function () {
      return REPOSITORY_VERSION;
    }
  };
})();
