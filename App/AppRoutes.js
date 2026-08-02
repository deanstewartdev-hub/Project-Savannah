/****************************************************
 * Project Savannah v1.2
 * AppRoutes.js
 *
 * Purpose:
 * Central route registry for the multi-page web app.
 ****************************************************/

const APP_ROUTES = Object.freeze({
  DASHBOARD: "dashboard",
  IDEAS: "ideas",
  SCRIPTS: "scripts",
  SEO: "seo",
  PRODUCTION: "production",
  ANALYTICS: "analytics",
  QUEUE: "queue",
  SETTINGS: "settings"
});

const APP_ROUTE_CONFIG = Object.freeze({
  dashboard: {
    key: APP_ROUTES.DASHBOARD,
    title: "Dashboard",
    viewFile: "Frontend/Views/Dashboard"
  },

  ideas: {
    key: APP_ROUTES.IDEAS,
    title: "Ideas",
    viewFile: "Frontend/Views/Ideas"
  },

  scripts: {
    key: APP_ROUTES.SCRIPTS,
    title: "Scripts",
    viewFile: "Frontend/Views/Scripts"
  },

  seo: {
    key: APP_ROUTES.SEO,
    title: "SEO",
    viewFile: "Frontend/Views/Seo"
  },

  production: {
    key: APP_ROUTES.PRODUCTION,
    title: "Production",
    viewFile: "Frontend/Views/Production"
  },

  analytics: {
    key: APP_ROUTES.ANALYTICS,
    title: "Analytics",
    viewFile: "Frontend/Views/Analytics"
  },

  queue: {
    key: APP_ROUTES.QUEUE,
    title: "Approval Queue",
    viewFile: "Frontend/Views/Queue"
  },

  settings: {
    key: APP_ROUTES.SETTINGS,
    title: "Settings",
    viewFile: "Frontend/Views/Settings"
  }
});

/**
 * Resolves a requested page into a valid route.
 *
 * Unknown routes fall back to the dashboard.
 *
 * @param {string=} requestedRoute Route supplied in the URL.
 * @return {Object} Resolved route configuration.
 */
function resolveAppRoute(requestedRoute) {
  const normalisedRoute = String(
    requestedRoute || APP_ROUTES.DASHBOARD
  )
    .trim()
    .toLowerCase();

  return (
    APP_ROUTE_CONFIG[normalisedRoute] ||
    APP_ROUTE_CONFIG[APP_ROUTES.DASHBOARD]
  );
}

/**
 * Returns navigation items in display order.
 *
 * @return {Object[]} Navigation definitions.
 */
function getAppNavigation() {
  return [
    APP_ROUTE_CONFIG.dashboard,
    APP_ROUTE_CONFIG.ideas,
    APP_ROUTE_CONFIG.scripts,
    APP_ROUTE_CONFIG.seo,
    APP_ROUTE_CONFIG.production,
    APP_ROUTE_CONFIG.analytics,
    APP_ROUTE_CONFIG.queue,
    APP_ROUTE_CONFIG.settings
  ];
}

/**
 * Tests route resolution.
 *
 * @return {Object} Test result.
 */
function testAppRoutes() {
  const dashboardRoute =
    resolveAppRoute("dashboard");

  const ideasRoute =
    resolveAppRoute("IDEAS");

  const fallbackRoute =
    resolveAppRoute("invalid-page");

  if (
    dashboardRoute.key !== APP_ROUTES.DASHBOARD ||
    dashboardRoute.viewFile !==
      "Frontend/Views/Dashboard"
  ) {
    throw new Error(
      "Dashboard route did not resolve correctly."
    );
  }

  if (
    ideasRoute.key !== APP_ROUTES.IDEAS ||
    ideasRoute.viewFile !==
      "Frontend/Views/Ideas"
  ) {
    throw new Error(
      "Ideas route did not resolve correctly."
    );
  }

  if (
    fallbackRoute.key !== APP_ROUTES.DASHBOARD
  ) {
    throw new Error(
      "Invalid routes must fall back to Dashboard."
    );
  }

  Logger.log(
    "Application route test completed successfully."
  );

  return {
    dashboardRoute: dashboardRoute,
    ideasRoute: ideasRoute,
    fallbackRoute: fallbackRoute
  };
}
