/****************************************************
 * Project Savannah v1.3
 * Config.gs
 * Purpose: Core app constants, sheet names, and defaults
 ****************************************************/

const APP = {
  NAME: "Project Savannah",
  VERSION: "1.3.0",
  PROMPT_VERSION: "ideas-v1.1-trend-led"
};

const APP_STATUS = {
  READY: "Ready",
  ERROR: "Error",
  NOT_CONNECTED: "Not Connected",
  CONNECTED: "Connected",
  PENDING: "Pending"
};

const CONTENT_STATUS = {
  NEW: "New",
  ACTIVE: "Active",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  COMPLETE: "Complete"
};

const DEFAULTS = {
  IDEAS_PER_RUN: 3,
  DAILY_IDEA_TARGET: 3,
  DAILY_SCRIPT_TARGET: 0,
  DAILY_SEO_TARGET: 0,
  DAILY_VIDEO_TARGET: 0
};

const MODELS = {
  DEFAULT_OPENAI_MODEL: "gpt-4o-mini"
};

const PROJECT_VERSION = APP.VERSION;

const SHEETS = {
  DASHBOARD: "Dashboard",
  SETTINGS: "Settings",
  IDEAS: "Ideas",
  SCRIPTS: "Scripts",
  SEO_PACK: "SEO Pack",
  RENDER_JOBS: "Render Jobs",
  PUBLISHING_JOBS: "Publishing Jobs",
  PRODUCTION_TASKS: "Production Tasks",
  ANALYTICS: "Analytics",
  CHANNEL_ANALYTICS: "Channel Analytics",
  APPROVAL_QUEUE: "Approval Queue",
  LOGS: "Logs",
  COSTS: "Costs"
};

const DEFAULT_MODEL = MODELS.DEFAULT_OPENAI_MODEL;

const IDEA_STATUS = {
  NEW: "New",
  APPROVED: "Approved",
  REJECTED: "Rejected"
};
