// Stands in for google.script.run inside one copy of the Production page. Every server call is recorded in window.__calls.
// The reply comes from the scripted queue for that function (cfg.replies), or from a default. Replies are asynchronous, as
// they are in Apps Script. A reply of { __failure: "..." } is a network-level failure (the page's withFailureHandler).
(function () {
  const cfg = window.__cfg || {};
  window.__calls = [];
  window.__alerts = [];
  window.alert = function (message) { window.__alerts.push(String(message)); };
  window.confirm = function () { return true; };

  const defaults = {
    productionListReady: function () {
      return { success: true, data: { provider: "cloud-run", items: cfg.items || [] } };
    },
    productionListJobs: function () {
      return { success: true, data: { health: {}, jobs: cfg.jobs || [] } };
    },
    productionSubmit: function () { return { success: true, data: { job: { id: "RND-NEW", status: "RENDERING" }, duplicate: false } }; },
    productionRetry: function () { return { success: true, data: { job: { id: "RND-RETRY", status: "RENDERING" }, duplicate: false } }; },
    productionRenderNewVersion: function () { return { success: true, data: { job: { id: "RND-VERSION", status: "RENDERING" }, duplicate: false } }; }
  };

  function reply(rpc, args) {
    const queue = (cfg.replies && cfg.replies[rpc]) || [];
    if (queue.length) return queue.shift();
    const fallback = defaults[rpc];
    return fallback ? fallback(args[0]) : { success: false, error: { message: "Not mocked: " + rpc } };
  }

  function runner(onSuccess, onFailure) {
    return new Proxy({}, {
      get: function (target, name) {
        if (name === "withSuccessHandler") return function (fn) { return runner(fn, onFailure); };
        if (name === "withFailureHandler") return function (fn) { return runner(onSuccess, fn); };
        return function () {
          const args = Array.prototype.slice.call(arguments);
          window.__calls.push({ rpc: String(name), args: JSON.parse(JSON.stringify(args)) });
          const value = reply(String(name), args);
          setTimeout(function () {
            if (value && value.__failure !== undefined) {
              if (onFailure) onFailure(value.__failure);
              return;
            }
            if (onSuccess) onSuccess(value);
          }, 0);
        };
      }
    });
  }

  window.google = { script: { run: runner(null, null) } };
})();
