/****************************************************
 * Project Savannah - one-time maintenance: add the visual-only search fields (location and
 * searchKeywords) to the five saved scenes of ONE approved script.
 *
 * Safety rules, enforced in code:
 * - Dry run by default. Nothing is written unless apply === true is passed explicitly.
 * - Refuses unless the script ID and idea ID match the expected pair, and the saved record is APPROVED.
 *   It stays APPROVED. Approval records and the approval queue are not touched.
 * - Reads the saved record through ScriptsRepository.getScriptById. It never regenerates, reformats
 *   or re-validates the text, so the approved wording cannot drift.
 * - Refuses if any saved scene's sceneNumber, narration, on-screen text, visual direction or
 *   estimated seconds differs from the approved values.
 * - Changes only scenes[].location, scenes[].searchKeywords and the version (+1). Every other
 *   top-level field must compare equal (updatedAt is set by the save and is excluded from the check).
 * - Backs up the original record (full JSON) to the "Script Revision Backups" sheet before any write,
 *   then reads the record back to confirm the saved values.
 * - Touches no other script.
 ****************************************************/
const VisualFieldsMaintenance = (() => {
  const EXPECTED_SCRIPT_ID = "SCR-39e7d862-5faa-481c-b75a-389a55ef60df";
  const EXPECTED_IDEA_ID = "IDEA-C4EF1471";
  const REQUIRED_STATUS = "APPROVED";
  const BACKUP_SHEET_NAME = "Script Revision Backups";
  // Fields the save sets on its own; excluded from the unrelated-field check.
  const SAVE_MANAGED_FIELDS = Object.freeze(["scenes", "version", "updatedAt"]);

  // The approved wording (stored by the first revision) and the visual-only fields to add.
  const APPROVED_SCENES = Object.freeze([
    {
      sceneNumber: 1,
      narration: "In Morocco's Rif Mountains, a whole town is painted blue, and nobody agrees why. The town sits high on the hillside, and its alleys climb steeply between blue walls.",
      onScreenText: "Mystery of Blue Chefchaouen",
      visualDirection: "Wide shot of the blue medina climbing a green hillside, slow pan across the rooftops",
      estimatedSeconds: 10,
      location: "Chefchaouen",
      searchKeywords: "blue city aerial mountains rooftops"
    },
    {
      sceneNumber: 2,
      narration: "Some residents say the blue stands for peace. Others say it keeps mosquitoes away.",
      onScreenText: "Peace or pest control?",
      visualDirection: "Medium shot of a blue-painted alley, with a resident walking past a doorway",
      estimatedSeconds: 10,
      location: "Chefchaouen",
      searchKeywords: "blue alley steps street"
    },
    {
      sceneNumber: 3,
      narration: "One commonly cited explanation links the blue to Jewish communities who settled here, though the exact origin is not firmly documented.",
      onScreenText: "A commonly cited story",
      visualDirection: "Close-up of a blue doorway with a wooden door and steps leading up",
      estimatedSeconds: 10,
      location: "Chefchaouen",
      searchKeywords: "blue doorway wooden door"
    },
    {
      sceneNumber: 4,
      narration: "Residents continue repainting their walls, keeping the town's famous blue streets vibrant. From pale sky blue to deep indigo, almost every corner looks different.",
      onScreenText: "Repainted again and again",
      visualDirection: "Close-up of someone touching up a blue wall with a brush, then a shot of a sunlit street",
      estimatedSeconds: 10,
      location: "Chefchaouen",
      searchKeywords: "blue wall painting street"
    },
    {
      sceneNumber: 5,
      narration: "So what's the real reason? Tell me your theory in the comments.",
      onScreenText: "Your theory?",
      visualDirection: "Slow pan up a blue staircase to the rooftops, with street life below",
      estimatedSeconds: 9,
      location: "Chefchaouen",
      searchKeywords: "blue staircase rooftops street"
    }
  ]);

  const PROTECTED_SCENE_FIELDS = Object.freeze(["sceneNumber", "narration", "onScreenText", "visualDirection", "estimatedSeconds"]);
  const VISUAL_SCENE_FIELDS = Object.freeze(["location", "searchKeywords"]);

  function error_(message) {
    const error = new Error(message);
    error.name = "VisualFieldsMaintenanceError";
    return error;
  }

  function same_(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Reads and checks the saved record, and builds the proposed replacement. Nothing is written here.
  function plan_(scriptId) {
    const id = String(scriptId || "").trim();
    if (id !== EXPECTED_SCRIPT_ID) throw error_("This maintenance only changes one script. Refusing " + id + ".");

    const existing = ScriptsRepository.getScriptById(id);
    if (!existing) throw error_("No script with that ID was found.");
    if (existing.ideaId !== EXPECTED_IDEA_ID) throw error_("The script belongs to a different idea; refusing.");
    if (existing.status !== REQUIRED_STATUS) {
      throw error_("Only an " + REQUIRED_STATUS + " script can be changed here. This one is " + existing.status + ".");
    }
    if (!Array.isArray(existing.scenes) || existing.scenes.length !== APPROVED_SCENES.length) {
      throw error_("Expected " + APPROVED_SCENES.length + " saved scenes; found " + (existing.scenes ? existing.scenes.length : 0) + ".");
    }

    const changes = [];
    const newScenes = existing.scenes.map(function (scene, index) {
      const approved = APPROVED_SCENES[index];
      for (const key of PROTECTED_SCENE_FIELDS) {
        if (!same_(scene[key], approved[key])) {
          throw error_("Scene " + (index + 1) + " field " + key + " differs from the approved value; refusing.");
        }
      }
      const before = {};
      const after = {};
      for (const key of VISUAL_SCENE_FIELDS) {
        before[key] = scene[key] === undefined ? null : scene[key];
        after[key] = approved[key];
        if (scene[key] !== undefined && scene[key] !== approved[key]) {
          throw error_("Scene " + (index + 1) + " already has a different " + key + "; refusing to overwrite.");
        }
      }
      changes.push({ sceneNumber: approved.sceneNumber, before: before, after: after });
      return Object.assign({}, scene, after);
    });

    const updated = Object.assign({}, existing, {
      scenes: newScenes,
      version: Number(existing.version || 1) + 1
    });

    const unrelated = Object.keys(existing).filter(function (key) {
      return SAVE_MANAGED_FIELDS.indexOf(key) === -1 && !same_(existing[key], updated[key]);
    });
    if (unrelated.length > 0) throw error_("Unrelated fields would change: " + unrelated.join(", ") + ". Refusing.");

    return { existing: existing, updated: updated, changes: changes };
  }

  function backupOriginal_(existing) {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw error_("No active spreadsheet is available for the backup.");
    let sheet = spreadsheet.getSheetByName(BACKUP_SHEET_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(BACKUP_SHEET_NAME);
      sheet.getRange(1, 1, 1, 4).setValues([["Backed up at", "Script ID", "Idea ID", "Original record JSON"]]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date().toISOString(), existing.id, existing.ideaId, JSON.stringify(existing)]);
    return sheet.getLastRow();
  }

  function summarise_(plan) {
    return {
      scriptId: plan.existing.id,
      ideaId: plan.existing.ideaId,
      status: plan.existing.status,
      currentVersion: plan.existing.version,
      newVersion: plan.updated.version,
      changes: plan.changes,
      unrelatedFieldsChanged: []
    };
  }

  // Dry run by default. apply must be exactly true to write anything.
  function run(scriptId, options) {
    const apply = !!(options && options.apply === true);
    const plan = plan_(scriptId);
    const summary = summarise_(plan);
    if (!apply) return { applied: false, summary: summary };

    const backupRow = backupOriginal_(plan.existing);
    const result = ScriptsRepository.updateScript(plan.updated);
    if (!result || result.saved !== true) throw error_("The save did not confirm. Check the record and the backup row " + backupRow + ".");

    // Read the record back and confirm the saved fields.
    const stored = ScriptsRepository.getScriptById(plan.existing.id);
    const verified = !!stored && stored.version === plan.updated.version &&
      plan.changes.every(function (change, index) {
        return VISUAL_SCENE_FIELDS.every(function (key) { return stored.scenes[index][key] === change.after[key]; });
      });
    if (!verified) throw error_("The saved record does not match the plan. Backup row " + backupRow + ".");

    return { applied: true, backupRow: backupRow, verified: verified, summary: summary };
  }

  // Rollback: restores the most recent backup of this script's original record. The restored record
  // keeps the original content and takes the next version number. A dry run is the default.
  function findLatestBackup_(sheet) {
    const rows = sheet.getLastRow();
    for (let row = rows; row >= 2; row -= 1) {
      const values = sheet.getRange(row, 1, 1, 4).getValues()[0];
      if (values[1] === EXPECTED_SCRIPT_ID) return { row: row, original: JSON.parse(values[3]) };
    }
    return null;
  }

  function restore(options) {
    const apply = !!(options && options.apply === true);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet && spreadsheet.getSheetByName(BACKUP_SHEET_NAME);
    const backup = sheet && findLatestBackup_(sheet);
    if (!backup) throw error_("No backup of this script was found in " + BACKUP_SHEET_NAME + ". Nothing changed.");

    const original = backup.original;
    if (original.id !== EXPECTED_SCRIPT_ID || original.ideaId !== EXPECTED_IDEA_ID) {
      throw error_("The backup row belongs to a different script or idea; refusing.");
    }
    const current = ScriptsRepository.getScriptById(EXPECTED_SCRIPT_ID);
    if (!current) throw error_("The script was not found.");
    if (current.status !== REQUIRED_STATUS) throw error_("The script is " + current.status + "; restore only an " + REQUIRED_STATUS + " script.");

    const restored = Object.assign({}, original, { version: Number(current.version || 1) + 1, status: REQUIRED_STATUS });
    const summary = {
      scriptId: EXPECTED_SCRIPT_ID,
      backupRow: backup.row,
      currentVersion: current.version,
      newVersion: restored.version,
      visualFieldsRemoved: current.scenes.filter(function (scene) { return VISUAL_SCENE_FIELDS.some(function (k) { return scene[k] !== undefined; }); }).length
    };
    if (!apply) return { applied: false, summary: summary };

    const selfBackupRow = backupOriginal_(current);
    const result = ScriptsRepository.updateScript(restored);
    if (!result || result.saved !== true) throw error_("The restore did not confirm. Current record backed up at row " + selfBackupRow + ".");
    const stored = ScriptsRepository.getScriptById(EXPECTED_SCRIPT_ID);
    const verified = !!stored && stored.version === restored.version &&
      stored.scenes.every(function (scene, index) {
        return VISUAL_SCENE_FIELDS.every(function (k) { return scene[k] === undefined; }) &&
          scene.narration === original.scenes[index].narration;
      });
    if (!verified) throw error_("The restored record does not match the backup. Current record backed up at row " + selfBackupRow + ".");
    return { applied: true, backupRow: backup.row, selfBackupRow: selfBackupRow, verified: verified, summary: summary };
  }

  return {
    run: run,
    restore: restore,
    APPROVED_SCENES: APPROVED_SCENES,
    EXPECTED_SCRIPT_ID: EXPECTED_SCRIPT_ID,
    EXPECTED_IDEA_ID: EXPECTED_IDEA_ID
  };
})();

// Editor entry points. Dry run first; the apply function writes exactly one record, after a backup.
// The editor's Run button shows only the execution log, so results are logged as JSON.
function previewChefchaouenVisualFieldsDryRun() {
  const result = VisualFieldsMaintenance.run(VisualFieldsMaintenance.EXPECTED_SCRIPT_ID, { apply: false });
  Logger.log("Visual fields DRY RUN: " + JSON.stringify(result.summary));
  return result;
}

function applyChefchaouenVisualFields() {
  const result = VisualFieldsMaintenance.run(VisualFieldsMaintenance.EXPECTED_SCRIPT_ID, { apply: true });
  Logger.log("Visual fields APPLIED: " + JSON.stringify(result.summary) + " backupRow=" + result.backupRow + " verified=" + result.verified);
  return result;
}

// Rollback entry points: preview first, then restore the latest backup of this script.
function previewChefchaouenVisualFieldsRestore() {
  const result = VisualFieldsMaintenance.restore({ apply: false });
  Logger.log("Visual fields RESTORE DRY RUN: " + JSON.stringify(result.summary));
  return result;
}

function restoreChefchaouenVisualFieldsFromBackup() {
  const result = VisualFieldsMaintenance.restore({ apply: true });
  Logger.log("Visual fields RESTORED: " + JSON.stringify(result.summary) + " backupRow=" + result.backupRow + " verified=" + result.verified);
  return result;
}
