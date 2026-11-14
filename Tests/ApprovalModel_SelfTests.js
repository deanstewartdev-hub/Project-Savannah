/****************************************************
 * Project Savannah - ApprovalModel hand-run self-tests
 *
 * Moved verbatim from Models/Approval.js (modular refactor,
 * November 2026) so the production file holds production code only. The functions keep
 * their global names and still appear in the Apps Script editor's Run menu. Nothing here
 * runs automatically; tests with real side effects stay behind assertLiveTestAllowed_.
 ****************************************************/

/****************************************************
 * Approval Model tests
 ****************************************************/

/**
 * Tests creation of a pending Approval Queue record.
 *
 * @return {Object} Created approval.
 */
function testApprovalModelCreatesPendingApproval() {
  const approval = ApprovalModel.create({
    scriptId: "SCR-TEST-001",
    ideaId: "IDEA-TEST-001",
    scriptVersion: 1,
    title: "Five Travel Mistakes to Avoid"
  });

  if (!approval.id) {
    throw new Error(
      "Approval Model did not create an ID."
    );
  }

  if (
    approval.status !== "PENDING_APPROVAL"
  ) {
    throw new Error(
      "Approval Model did not create a pending record."
    );
  }

  if (approval.version !== 1) {
    throw new Error(
      "New Approval Model must begin at version 1."
    );
  }

  if (
    approval.modelVersion !==
    ApprovalModel.getModelVersion()
  ) {
    throw new Error(
      "Approval Model version was not assigned."
    );
  }

  Logger.log(
    JSON.stringify(approval, null, 2)
  );

  Logger.log(
    "Approval Model pending-record test completed successfully."
  );

  return approval;
}

/**
 * Tests creation from a saved ScriptModel record.
 *
 * @return {Object} Created approval.
 */
function testApprovalModelCreatesFromScript() {
  const script = createApprovalModelScriptFixture_();

  const approval = ApprovalModel.fromScript(
    script,
    {
      submittedBy: "Test User",
      reviewNotes:
        "Please review the final script."
    }
  );

  if (approval.scriptId !== script.id) {
    throw new Error(
      "Approval Model did not preserve the Script ID."
    );
  }

  if (approval.ideaId !== script.ideaId) {
    throw new Error(
      "Approval Model did not preserve the Idea ID."
    );
  }

  if (
    approval.scriptVersion !==
    script.version
  ) {
    throw new Error(
      "Approval Model did not preserve the script version."
    );
  }

  if (
    approval.status !== "PENDING_APPROVAL"
  ) {
    throw new Error(
      "Approval from script did not begin pending."
    );
  }

  Logger.log(
    JSON.stringify(approval, null, 2)
  );

  Logger.log(
    "Approval Model from-script test completed successfully."
  );

  return approval;
}

/**
 * Tests approval of a pending queue record.
 *
 * @return {Object} Approved record.
 */
function testApprovalModelApprovesPendingRecord() {
  const pending =
    ApprovalModel.fromScript(
      createApprovalModelScriptFixture_()
    );

  const approved = ApprovalModel.transition(
    pending,
    "APPROVED",
    {
      reviewedBy: "Test Reviewer",
      reviewNotes:
        "Script is ready for production."
    }
  );

  if (approved.status !== "APPROVED") {
    throw new Error(
      "Approval Model did not approve the record."
    );
  }

  if (!approved.reviewedAt) {
    throw new Error(
      "Approved record did not receive a reviewed timestamp."
    );
  }

  if (
    approved.version !==
    pending.version + 1
  ) {
    throw new Error(
      "Approval transition did not increment the version."
    );
  }

  Logger.log(
    JSON.stringify(approved, null, 2)
  );

  Logger.log(
    "Approval Model approval-transition test completed successfully."
  );

  return approved;
}

/**
 * Tests rejection with a required reason.
 *
 * @return {Object} Rejected record.
 */
function testApprovalModelRejectsWithReason() {
  const pending =
    ApprovalModel.fromScript(
      createApprovalModelScriptFixture_()
    );

  const rejected = ApprovalModel.transition(
    pending,
    "REJECTED",
    {
      reviewedBy: "Test Reviewer",
      decisionReason:
        "The opening hook is not strong enough.",
      reviewNotes:
        "Rewrite the first five seconds."
    }
  );

  if (rejected.status !== "REJECTED") {
    throw new Error(
      "Approval Model did not reject the record."
    );
  }

  if (!rejected.decisionReason) {
    throw new Error(
      "Rejected approval did not preserve its reason."
    );
  }

  Logger.log(
    JSON.stringify(rejected, null, 2)
  );

  Logger.log(
    "Approval Model rejection test completed successfully."
  );

  return rejected;
}

/**
 * Tests that rejection without a reason fails.
 *
 * @return {boolean} True when rejected correctly.
 */
function testApprovalModelRejectsMissingDecisionReason() {
  const pending =
    ApprovalModel.fromScript(
      createApprovalModelScriptFixture_()
    );

  try {
    ApprovalModel.transition(
      pending,
      "REJECTED",
      {
        reviewedBy: "Test Reviewer"
      }
    );
  } catch (error) {
    if (
      error.name !==
      "ApprovalModelValidationError"
    ) {
      throw error;
    }

    Logger.log(error.message);

    Logger.log(
      "Approval Model missing-reason test completed successfully."
    );

    return true;
  }

  throw new Error(
    "Approval Model accepted a rejection without a reason."
  );
}

/**
 * Tests requesting changes.
 *
 * @return {Object} Changes-requested record.
 */
function testApprovalModelRequestsChanges() {
  const pending =
    ApprovalModel.fromScript(
      createApprovalModelScriptFixture_()
    );

  const result = ApprovalModel.transition(
    pending,
    "CHANGES_REQUESTED",
    {
      reviewedBy: "Test Reviewer",
      decisionReason:
        "The call to action needs to be shorter.",
      reviewNotes:
        "Keep the final line under ten words."
    }
  );

  if (
    result.status !==
    "CHANGES_REQUESTED"
  ) {
    throw new Error(
      "Approval Model did not request changes."
    );
  }

  if (!ApprovalModel.isTerminal(result)) {
    throw new Error(
      "Changes-requested queue record should be terminal."
    );
  }

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "Approval Model changes-requested test completed successfully."
  );

  return result;
}

/**
 * Tests prevention of a second decision.
 *
 * @return {boolean} True when rejected correctly.
 */
function testApprovalModelRejectsInvalidTransition() {
  const pending =
    ApprovalModel.fromScript(
      createApprovalModelScriptFixture_()
    );

  const approved = ApprovalModel.transition(
    pending,
    "APPROVED",
    {
      reviewedBy: "Test Reviewer"
    }
  );

  try {
    ApprovalModel.transition(
      approved,
      "REJECTED",
      {
        reviewedBy: "Second Reviewer",
        decisionReason:
          "Attempted second decision."
      }
    );
  } catch (error) {
    if (
      error.name !==
      "ApprovalTransitionError"
    ) {
      throw error;
    }

    Logger.log(error.message);

    Logger.log(
      "Approval Model invalid-transition test completed successfully."
    );

    return true;
  }

  throw new Error(
    "Approval Model accepted an invalid second decision."
  );
}

/**
 * Tests Approval Model updates and version increments.
 *
 * @return {Object} Updated approval.
 */
function testApprovalModelUpdatesVersion() {
  const original =
    ApprovalModel.fromScript(
      createApprovalModelScriptFixture_()
    );

  const updated = ApprovalModel.update(
    original,
    {
      reviewNotes:
        "Updated submission note."
    }
  );

  if (updated.id !== original.id) {
    throw new Error(
      "Approval update changed the Approval ID."
    );
  }

  if (
    updated.createdAt !==
    original.createdAt
  ) {
    throw new Error(
      "Approval update changed the creation timestamp."
    );
  }

  if (
    updated.submittedAt !==
    original.submittedAt
  ) {
    throw new Error(
      "Approval update changed the submission timestamp."
    );
  }

  if (
    updated.version !==
    original.version + 1
  ) {
    throw new Error(
      "Approval update did not increment the version."
    );
  }

  Logger.log(
    JSON.stringify(updated, null, 2)
  );

  Logger.log(
    "Approval Model update test completed successfully."
  );

  return updated;
}

/**
 * Tests that cloning does not retain shared references.
 *
 * @return {boolean} True when clone is independent.
 */
function testApprovalModelCloneIsIndependent() {
  const original =
    ApprovalModel.fromScript(
      createApprovalModelScriptFixture_(),
      {
        metadata: {
          testValue: "original"
        }
      }
    );

  const cloned =
    ApprovalModel.clone(original);

  cloned.metadata.testValue = "changed";

  if (
    original.metadata.testValue === "changed"
  ) {
    throw new Error(
      "Approval Model clone retained a shared reference."
    );
  }

  Logger.log(
    "Approval Model clone test completed successfully."
  );

  return true;
}

/**
 * Runs all safe Approval Model tests.
 *
 * No spreadsheet or AI requests are made.
 *
 * @return {Object} Test summary.
 */
function testApprovalModelAll() {
  testApprovalModelCreatesPendingApproval();
  testApprovalModelCreatesFromScript();
  testApprovalModelApprovesPendingRecord();
  testApprovalModelRejectsWithReason();
  testApprovalModelRejectsMissingDecisionReason();
  testApprovalModelRequestsChanges();
  testApprovalModelRejectsInvalidTransition();
  testApprovalModelUpdatesVersion();
  testApprovalModelCloneIsIndependent();

  const result = {
    passed: true,
    testsRun: 9,
    spreadsheetAccessed: false,
    liveProviderCalled: false,
    modelVersion:
      ApprovalModel.getModelVersion()
  };

  Logger.log(
    JSON.stringify(result, null, 2)
  );

  Logger.log(
    "All Approval Model tests completed successfully."
  );

  return result;
}

/**
 * Creates a complete saved-script fixture for Approval
 * Model tests.
 *
 * @return {Object} Saved-script fixture.
 */
function createApprovalModelScriptFixture_() {
  return {
    id: "SCR-TEST-APPROVAL-001",
    ideaId: "IDEA-TEST-APPROVAL-001",
    title:
      "Five Travel Mistakes to Avoid",
    hook:
      "These five mistakes can ruin your next holiday.",
    voiceoverScript:
      "These five mistakes can ruin your next holiday. " +
      "Plan your route before leaving the hotel. " +
      "Avoid restaurants beside major landmarks. " +
      "Keep your valuables secure in busy areas. " +
      "Do not attempt every attraction in one day. " +
      "Follow for more practical travel advice.",
    scenes: [
      {
        sceneNumber: 1,
        narration:
          "These five mistakes can ruin your holiday.",
        onScreenText:
          "Avoid these mistakes",
        visualDirection:
          "Fast montage of a busy holiday destination.",
        estimatedSeconds: 8
      },
      {
        sceneNumber: 2,
        narration:
          "Plan carefully and avoid obvious tourist traps.",
        onScreenText:
          "Plan ahead",
        visualDirection:
          "Map planning followed by a restaurant menu.",
        estimatedSeconds: 18
      },
      {
        sceneNumber: 3,
        narration:
          "Protect your valuables and leave time to enjoy the trip.",
        onScreenText:
          "Stay secure · Slow down",
        visualDirection:
          "Crowded street followed by a relaxed café.",
        estimatedSeconds: 19
      }
    ],
    callToAction:
      "Follow for more practical travel advice.",
    estimatedDurationSeconds: 45,
    generationNotes: "",
    status: "FORMATTED",
    validation: {
      valid: true
    },
    formatting: {
      valid: true
    },
    metadata: {
      provider: "test-provider"
    },
    displayText:
      "Five Travel Mistakes to Avoid",
    promptVersion:
      "script-prompt-test-v1.0",
    aiModel: "test-model",
    createdAt:
      "2026-07-19T12:00:00.000Z",
    updatedAt:
      "2026-07-19T12:00:00.000Z",
    version: 1,
    modelVersion:
      "script-model-v1.0"
  };
}
