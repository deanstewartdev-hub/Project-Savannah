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

  template.webAppUrl =
    resolveWebAppUrl_(event);

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
 * Resolves the deployed web-app URL.
 *
 * A test URL may be supplied by internal template tests
 * because ScriptApp.getService().getUrl() can be empty
 * when executed directly from the Apps Script editor.
 *
 * @param {Object=} event Request or test event.
 * @return {string} Absolute web-app URL.
 */
function resolveWebAppUrl_(event) {
  const testUrl =
    event &&
    typeof event.__testWebAppUrl === "string"
      ? event.__testWebAppUrl.trim()
      : "";

  if (testUrl) {
    return testUrl;
  }

  const deployedUrl =
    ScriptApp.getService().getUrl();

  if (
    !deployedUrl ||
    typeof deployedUrl !== "string" ||
    !deployedUrl.trim()
  ) {
    throw new Error(
      "The deployed web-app URL is unavailable. " +
      "Run this through an active web-app deployment."
    );
  }

  return deployedUrl.trim();
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
}/**
 * Loads a static frontend HTML file using its full project path.
 *
 * Use this helper for files that do not contain Apps Script
 * template expressions.
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
 * Evaluates a frontend HTML template using supplied data.
 *
 * Use this helper for components containing template
 * expressions such as:
 *
 * <?= appName ?>
 * <? navigationItems.forEach(...) ?>
 *
 * @param {string} filename Full Apps Script HTML file path.
 * @param {Object=} templateData Values exposed to the template.
 * @return {string} Evaluated HTML content.
 */
function renderFrontendTemplate(
  filename,
  templateData
) {
  if (
    !filename ||
    typeof filename !== "string" ||
    !filename.trim()
  ) {
    throw new Error(
      "A valid frontend template filename is required."
    );
  }

  const template =
    HtmlService.createTemplateFromFile(
      filename.trim()
    );

  const data =
    templateData &&
    typeof templateData === "object"
      ? templateData
      : {};

  Object.keys(data).forEach(function (key) {
    template[key] = data[key];
  });

  return template
    .evaluate()
    .getContent();
}

/**
 * Renders the primary navigation component.
 *
 * @param {Object} currentRoute Active application route.
 * @param {Object[]} navigationItems Navigation routes.
 * @param {string} webAppUrl Deployed web-app URL.
 * @return {string} Evaluated navigation HTML.
 */
function renderNavigation(
  currentRoute,
  navigationItems,
  webAppUrl
) {
  if (
    !currentRoute ||
    typeof currentRoute !== "object"
  ) {
    throw new Error(
      "A valid current route is required."
    );
  }

  if (!Array.isArray(navigationItems)) {
    throw new Error(
      "Navigation items must be an array."
    );
  }

  if (
    !webAppUrl ||
    typeof webAppUrl !== "string" ||
    !webAppUrl.trim()
  ) {
    throw new Error(
      "A valid web-app URL is required."
    );
  }

  return renderFrontendTemplate(
    "Frontend/Components/Navigation/Navigation",
    {
      currentRoute: currentRoute,
      navigationItems: navigationItems,
      webAppUrl: webAppUrl.trim()
    }
  );
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
 * Tests the application template without requiring an
 * active web-app execution context.
 *
 * @return {string} Evaluated application HTML.
 */
function testApplicationTemplate() {
  const output = doGet({
    parameter: {
      page: APP_ROUTES.DASHBOARD
    },

    __testWebAppUrl:
      "https://script.google.com/macros/s/TEST_DEPLOYMENT/exec"
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

  if (
    html.indexOf(
      "https://script.google.com/macros/s/TEST_DEPLOYMENT/exec"
    ) === -1
  ) {
    throw new Error(
      "The navigation web-app URL was not rendered."
    );
  }

  Logger.log(
    "Application template test completed successfully."
  );

  return html;
}