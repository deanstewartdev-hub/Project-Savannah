/****************************************************
 * Project Savannah v1.3
 * App.js
 *
 * Purpose:
 * Web application entrypoint, request context builder
 * and HTML template loader.
 *
 * Responsibilities:
 * - Resolve the requested application route.
 * - Capture safe page parameters.
 * - Build the initial page context.
 * - Render the frontend application template.
 * - Load static and evaluated HTML components.
 *
 * Must not:
 * - Read or write application data.
 * - Call AI providers.
 * - Implement page business logic.
 ****************************************************/

/**
 * Serves the Project Savannah web application.
 *
 * Route examples:
 * ?page=dashboard
 * ?page=ideas
 * ?page=scripts
 *
 * Scripts prefill example:
 * ?page=scripts
 * &ideaId=IDEA-12345678
 * &videoIdea=Example
 * &hook=Example
 * &targetAudience=Travellers
 * &niche=Travel
 *
 * @param {Object=} event Apps Script web request event.
 * @return {GoogleAppsScript.HTML.HtmlOutput} Rendered page.
 */
function doGet(event) {
  const requestParameters =
    event &&
    event.parameter &&
    typeof event.parameter === "object"
      ? event.parameter
      : {};

  const requestedPage =
    normaliseAppRequestText_(
      requestParameters.page
    ) || APP_ROUTES.DASHBOARD;

  const route =
    resolveAppRoute(requestedPage);

  const webAppUrl =
    resolveWebAppUrl_(event);

  const pageContext =
    createPageContext_(
      route,
      requestParameters
    );

  const template =
    HtmlService.createTemplateFromFile(
      "Frontend/Index"
    );

  template.appName =
    "Project Savannah";

  template.appVersion =
    "v1.3";

  template.currentRoute =
    route;

  template.navigationItems =
    getAppNavigation();

  template.webAppUrl =
    webAppUrl;

  template.pageContext =
    pageContext;

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
 * Web app POST entrypoint. Only used today by savannah-media-worker's completion
 * webhook (see media-worker/README.md and Production/VideoProcessingProvider.js).
 * Routing only, same as doGet: the actual read/write happens in
 * MediaWorkerCallbackService.
 *
 * @param {Object=} event Apps Script POST request event.
 * @return {GoogleAppsScript.Content.TextOutput} JSON response.
 */
function doPost(event) {
  const parameters =
    event &&
    event.parameter &&
    typeof event.parameter === "object"
      ? event.parameter
      : {};

  const route = normaliseAppRequestText_(parameters.route);

  const result =
    route === "media-worker-callback"
      ? MediaWorkerCallbackService.handle(event)
      : { success: false, error: "Unknown callback route." };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Creates the initial page context exposed to the
 * frontend.
 *
 * The context contains only explicitly supported,
 * sanitised values.
 *
 * @param {Object} route Resolved route.
 * @param {Object} parameters Request parameters.
 * @return {Object} Frontend-safe page context.
 * @private
 */
function createPageContext_(
  route,
  parameters
) {
  const safeParameters =
    parameters &&
    typeof parameters === "object"
      ? parameters
      : {};

  const context = {
    route: {
      key:
        normaliseAppRequestText_(
          route && route.key
        ),

      title:
        normaliseAppRequestText_(
          route && route.title
        )
    },

    scriptPrefill: {
      ideaId: "",
      videoIdea: "",
      hook: "",
      targetAudience: "",
      niche: ""
    }
  };

  if (
    context.route.key ===
    APP_ROUTES.SCRIPTS
  ) {
    context.scriptPrefill =
      createScriptPrefillContext_(
        safeParameters
      );
  }

  return context;
}

/**
 * Creates a safe Scripts-page prefill model.
 *
 * @param {Object} parameters Request parameters.
 * @return {Object} Script prefill context.
 * @private
 */
function createScriptPrefillContext_(
  parameters
) {
  return {
    ideaId:
      limitAppRequestText_(
        parameters.ideaId,
        120
      ),

    videoIdea:
      limitAppRequestText_(
        parameters.videoIdea,
        500
      ),

    hook:
      limitAppRequestText_(
        parameters.hook,
        1000
      ),

    targetAudience:
      limitAppRequestText_(
        parameters.targetAudience,
        500
      ),

    niche:
      limitAppRequestText_(
        parameters.niche,
        250
      )
  };
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
 * @private
 */
function resolveWebAppUrl_(event) {
  const testUrl =
    event &&
    typeof event.__testWebAppUrl ===
      "string"
      ? event.__testWebAppUrl.trim()
      : "";

  if (testUrl) {
    return testUrl;
  }

  const deployedUrl =
    ScriptApp
      .getService()
      .getUrl();

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
 * Loads a static frontend HTML file.
 *
 * Use this helper only for files that do not contain
 * Apps Script template expressions.
 *
 * @param {string} filename Full Apps Script HTML path.
 * @return {string} HTML file contents.
 */
function includeFrontend(filename) {
  const safeFilename =
    normaliseAppRequestText_(
      filename
    );

  if (!safeFilename) {
    throw new Error(
      "A valid frontend filename is required."
    );
  }

  return HtmlService
    .createHtmlOutputFromFile(
      safeFilename
    )
    .getContent();
}

/**
 * Evaluates a frontend HTML template using supplied
 * template values.
 *
 * Use this helper for components containing Apps Script
 * template expressions.
 *
 * @param {string} filename Full Apps Script HTML path.
 * @param {Object=} templateData Template values.
 * @return {string} Evaluated HTML content.
 */
function renderFrontendTemplate(
  filename,
  templateData
) {
  const safeFilename =
    normaliseAppRequestText_(
      filename
    );

  if (!safeFilename) {
    throw new Error(
      "A valid frontend template filename is required."
    );
  }

  const template =
    HtmlService.createTemplateFromFile(
      safeFilename
    );

  const data =
    templateData &&
    typeof templateData === "object"
      ? templateData
      : {};

  Object.keys(data).forEach(
    function (key) {
      template[key] = data[key];
    }
  );

  return template
    .evaluate()
    .getContent();
}

/**
 * Renders the primary navigation component.
 *
 * @param {Object} currentRoute Active route.
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

  const safeWebAppUrl =
    normaliseAppRequestText_(
      webAppUrl
    );

  if (!safeWebAppUrl) {
    throw new Error(
      "A valid web-app URL is required."
    );
  }

  return renderFrontendTemplate(
    "Frontend/Components/Navigation/Navigation",
    {
      currentRoute:
        currentRoute,

      navigationItems:
        navigationItems,

      webAppUrl:
        safeWebAppUrl
    }
  );
}

/**
 * Loads the view configured for a route.
 *
 * @param {Object} route Resolved route.
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

  return includeFrontend(
    route.viewFile
  );
}

/**
 * Normalises request text.
 *
 * @param {*} value Input value.
 * @return {string} Trimmed text.
 * @private
 */
function normaliseAppRequestText_(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

/**
 * Normalises and limits request text.
 *
 * Control characters are removed before the length
 * limit is applied.
 *
 * @param {*} value Input value.
 * @param {number} maximumLength Maximum length.
 * @return {string} Safe text.
 * @private
 */
function limitAppRequestText_(
  value,
  maximumLength
) {
  const text =
    normaliseAppRequestText_(
      value
    )
      .replace(
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
        ""
      );

  const safeMaximumLength =
    Number(maximumLength);

  if (
    !isFinite(safeMaximumLength) ||
    safeMaximumLength <= 0
  ) {
    return text;
  }

  return text.slice(
    0,
    Math.floor(
      safeMaximumLength
    )
  );
}

/**
 * Tests the application template without requiring an
 * active web-app execution context.
 *
 * @return {string} Evaluated application HTML.
 */
function testApplicationTemplate() {
  const output =
    doGet({
      parameter: {
        page:
          APP_ROUTES.DASHBOARD
      },

      __testWebAppUrl:
        "https://script.google.com/macros/s/TEST_DEPLOYMENT/exec"
    });

  const html =
    output.getContent();

  if (
    html.indexOf(
      "Project Savannah"
    ) === -1
  ) {
    throw new Error(
      "Application name was not rendered."
    );
  }

  if (
    html.indexOf(
      "Dashboard"
    ) === -1
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

/**
 * Tests Scripts-page request context generation.
 *
 * @return {Object} Generated page context.
 */
function testScriptPrefillPageContext() {
  const route =
    resolveAppRoute(
      APP_ROUTES.SCRIPTS
    );

  const context =
    createPageContext_(
      route,
      {
        ideaId:
          "IDEA-TEST1234",

        videoIdea:
          "Five surprising facts about Japan",

        hook:
          "You probably did not know these facts.",

        targetAudience:
          "Travel enthusiasts",

        niche:
          "Travel facts"
      }
    );

  if (
    context.scriptPrefill.ideaId !==
      "IDEA-TEST1234" ||
    !context.scriptPrefill.videoIdea
  ) {
    throw new Error(
      "Scripts prefill context test failed."
    );
  }

  Logger.log(
    JSON.stringify(
      context,
      null,
      2
    )
  );

  Logger.log(
    "Scripts prefill page-context test completed successfully."
  );

  return context;
}