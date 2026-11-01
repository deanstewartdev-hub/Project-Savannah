/****************************************************
 * Project Savannah - one-time maintenance: revise the five-scene text of ONE existing script.
 *
 * Safety rules, enforced in code:
 * - Dry run by default. Nothing is written unless apply === true is passed explicitly.
 * - Refuses unless the script ID and idea ID match the expected pair, and the record is still FORMATTED.
 * - Validates and formats the revision with the same validator, formatter and model the generator uses.
 * - Backs up the original record (full JSON) to a "Script Revision Backups" sheet before any write.
 * - Keeps the script ID, idea ID, title, call to action, status and creation time. The version is incremented.
 * - Never approves, never starts SEO or rendering, and never touches any other row.
 *
 * Run from the editor: ScriptRevisionMaintenance.run(scriptId, { apply: false }) first, then apply: true only
 * after the dry-run output has been reviewed.
 ****************************************************/
const ScriptRevisionMaintenance = (() => {
  const EXPECTED_IDEA_ID = "IDEA-C4EF1471";
  const BACKUP_SHEET_NAME = "Script Revision Backups";

  // The approved five-scene revision. Scene 4 narration is the owner's final wording.
  const REVISED_SCENES = Object.freeze([
    {
      sceneNumber: 1,
      narration: "In Morocco's Rif Mountains, a whole town is painted blue, and nobody agrees why. The town sits high on the hillside, and its alleys climb steeply between blue walls.",
      onScreenText: "Mystery of Blue Chefchaouen",
      visualDirection: "Wide shot of the blue medina climbing a green hillside, slow pan across the rooftops",
      estimatedSeconds: 10
    },
    {
      sceneNumber: 2,
      narration: "Some residents say the blue stands for peace. Others say it keeps mosquitoes away.",
      onScreenText: "Peace or pest control?",
      visualDirection: "Medium shot of a blue-painted alley, with a resident walking past a doorway",
      estimatedSeconds: 10
    },
    {
      sceneNumber: 3,
      narration: "One commonly cited explanation links the blue to Jewish communities who settled here, though the exact origin is not firmly documented.",
      onScreenText: "A commonly cited story",
      visualDirection: "Close-up of a blue doorway with a wooden door and steps leading up",
      estimatedSeconds: 10
    },
    {
      sceneNumber: 4,
      narration: "Residents continue repainting their walls, keeping the town's famous blue streets vibrant. From pale sky blue to deep indigo, almost every corner looks different.",
      onScreenText: "Repainted again and again",
      visualDirection: "Close-up of someone touching up a blue wall with a brush, then a shot of a sunlit street",
      estimatedSeconds: 10
    },
    {
      sceneNumber: 5,
      narration: "So what's the real reason? Tell me your theory in the comments.",
      onScreenText: "Your theory?",
      visualDirection: "Slow pan up a blue staircase to the rooftops, with street life below",
      estimatedSeconds: 9
    }
  ]);

  function error_(message) {
    const error = new Error(message);
    error.name = "ScriptRevisionMaintenanceError";
    return error;
  }

  // Plans the change: reads the record, validates and formats the revision, and builds the replacement model.
  // Nothing is written here.
  function plan_(scriptId) {
    const id = String(scriptId || "").trim();
    if (!id) throw error_("A script ID is required.");

    const existing = ScriptsRepository.getScriptById(id);
    if (!existing) throw error_("No script with that ID was found.");
    if (existing.ideaId !== EXPECTED_IDEA_ID) {
      throw error_("The script belongs to a different idea; refusing to revise it.");
    }
    if (existing.status !== "FORMATTED") {
      throw error_("Only a FORMATTED script can be revised. This one is " + existing.status + ".");
    }

    const voiceoverScript = REVISED_SCENES.map(function (scene) { return scene.narration; }).join(" ");
    const estimatedDurationSeconds = REVISED_SCENES.reduce(function (total, scene) { return total + scene.estimatedSeconds; }, 0);
    const source = {
      title: existing.title,
      hook: existing.hook,
      voiceoverScript: voiceoverScript,
      scenes: REVISED_SCENES.map(function (scene) { return Object.assign({}, scene); }),
      callToAction: existing.callToAction,
      estimatedDurationSeconds: estimatedDurationSeconds,
      generationNotes: existing.generationNotes || ""
    };

    const validated = ScriptValidator.validate(source);
    if (!validated || validated.valid !== true) {
      throw error_("The revision failed validation: " + JSON.stringify(validated && validated.errors || validated));
    }
    const formatted = ScriptFormatter.format(validated);
    if (!formatted || formatted.valid !== true) {
      throw error_("The revision could not be formatted.");
    }

    const model = ScriptModel.fromFormattedResult(formatted, {
      ideaId: existing.ideaId,
      status: existing.status,
      promptVersion: existing.promptVersion,
      aiModel: existing.aiModel
    });

    // Keep the record's identity and history. Only the content and the version change.
    model.id = existing.id;
    model.ideaId = existing.ideaId;
    model.createdAt = existing.createdAt;
    model.version = Number(existing.version || 1) + 1;
    model.status = existing.status;

    return { existing: existing, model: model, validation: validated.metadata, formattedDuration: estimatedDurationSeconds };
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
      currentVersion: plan.existing.version,
      newVersion: plan.model.version,
      status: plan.model.status,
      sceneCount: plan.model.scenes.length,
      wordCount: plan.validation && plan.validation.wordCount,
      durationSeconds: plan.formattedDuration,
      sceneNarration: plan.model.scenes.map(function (scene) { return scene.narration; })
    };
  }

  // Dry run by default. apply must be exactly true to write anything.
  function run(scriptId, options) {
    const apply = !!(options && options.apply === true);
    const plan = plan_(scriptId);
    const summary = summarise_(plan);
    if (!apply) {
      return { applied: false, summary: summary };
    }
    const backupRow = backupOriginal_(plan.existing);
    const result = ScriptsRepository.updateScript(plan.model);
    return { applied: true, backupRow: backupRow, saved: result && result.saved === true, summary: summary };
  }

  // Finds the single script for the expected idea and revises it. Refuses unless exactly one record matches.
  function runForIdea(options) {
    const matches = ScriptsRepository.getScriptsByIdeaId(EXPECTED_IDEA_ID);
    if (!matches || matches.length !== 1) {
      throw error_("Expected exactly one script for " + EXPECTED_IDEA_ID + "; found " + (matches ? matches.length : 0) + ". Nothing changed.");
    }
    return run(matches[0].id, options);
  }

  return { run: run, runForIdea: runForIdea, REVISED_SCENES: REVISED_SCENES, EXPECTED_IDEA_ID: EXPECTED_IDEA_ID };
})();

// Editor entry points. Dry run first; the apply function writes exactly one record, after a backup.
// They are top-level, so the editor's Run menu lists them. The web app is restricted to its owner.
// The editor's Run button shows only the execution log, so the result is logged as JSON.
function reviseChefchaouenScriptDryRun() {
  const result = ScriptRevisionMaintenance.runForIdea({ apply: false });
  Logger.log("Script revision DRY RUN: " + JSON.stringify(result.summary));
  return result;
}

function reviseChefchaouenScriptApply() {
  const result = ScriptRevisionMaintenance.runForIdea({ apply: true });
  Logger.log("Script revision APPLIED: " + JSON.stringify(result.summary) + " backupRow=" + result.backupRow + " saved=" + result.saved);
  return result;
}
