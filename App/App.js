/****************************************************
 * Project Savannah v1.2
 * App.js
 *
 * Purpose:
 * Web application entrypoint and HTML template loader.
 ****************************************************/

/**
 * Serves the Project Savannah web application.
 *
 * Route examples:
 * ?page=dashboard
 * ?page=ideas
 * ?page=scripts
 *
 * @param {Object=} event Apps Script web request event.
 * @return {GoogleAppsScript.HTML.HtmlOutput} Rendered page.
 */
/**
 * Serves the Project Savannah web application.
 *
 * Route examples:
 * ?page=dashboard
 * ?page=ideas
 * ?page=scripts
 *
 * @param {Object=} event Apps Script web request event.
 * @return {GoogleAppsScript.HTML.HtmlOutput} Rendered page.
 */

function doGet(event) {
  const requestedPage =
    event &&
    event.parameter &&
    event.parameter.page
      ? event.parameter.page
      : APP_ROUTES.DASHBOARD;

  const route =
    resolveAppRoute(requestedPage);

  const template =
    HtmlService.createTemplateFromFile(
      "Frontend/Index"
    );

  template.appName =
    "Project Savannah";

  template.appVersion =
    "v1.2";

  template.currentRoute =
    route;

  template.navigationItems =
    getAppNavigation();

  /*
   * The deployed web-app URL is supplied to the HTML
   * template so navigation links do not resolve against
   * Google's embedded googleusercontent iframe.
   */
  template.webAppUrl =
    ScriptApp.getService().getUrl();

  return template
    .evaluate()
    .setTitle(
      route.title +
      " | Project Savannah"
    )
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1"
    );
}

/**
 * Loads an HTML file using its full project path.
 *
 * Examples:
 * Frontend/Assets/Styles
 * Frontend/Assets/Scripts
 * Frontend/Views/Dashboard
 *
 * @param {string} filename Full Apps Script HTML file path.
 * @return {string} HTML file contents.
 */
function includeFrontend(filename) {
  if (
    !filename ||
    typeof filename !== "string" ||
    !filename.trim()
  ) {
    throw new Error(
      "A valid frontend filename is required."
    );
  }

  return HtmlService
    .createHtmlOutputFromFile(filename.trim())
    .getContent();
}

/**
 * Loads the view configured for a route.
 *
 * @param {Object} route Resolved route configuration.
 * @return {string} View HTML.
 */
function renderAppView(route) {
  if (
    !route ||
    !route.viewFile
  ) {
    throw new Error(
      "A valid application route is required."
    );
  }

  return includeFrontend(route.viewFile);
}

/**
 * Tests the application template without deployment.
 *
 * @return {string} Evaluated application HTML.
 */
function testApplicationTemplate() {
  const output = doGet({
    parameter: {
      page: APP_ROUTES.DASHBOARD
    }
  });

  const html = output.getContent();

  if (
    html.indexOf("Project Savannah") === -1
  ) {
    throw new Error(
      "Application name was not rendered."
    );
  }

  if (
    html.indexOf("Dashboard") === -1
  ) {
    throw new Error(
      "Dashboard view was not rendered."
    );
  }

  Logger.log(
    "Application template test completed successfully."
  );

  return html;
}