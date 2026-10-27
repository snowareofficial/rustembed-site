/* 写作台前端 · API 封装（同源 /api/*，由 Rust 反代到 Python 引擎）。
 * 登录态接口（session/whoami/purge/recent/about）由 Rust 直接处理，其余反代。 */
(function (global) {
  'use strict';

  function request(method, path, payload) {
    var opts = { method: method, headers: {} };
    if (payload !== undefined && payload !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(payload);
    }
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var msg = (data && (data.error || (data.errors && data.errors.length && data.errors[0].msg))) || ('HTTP ' + r.status);
          var err = new Error(msg);
          err.status = r.status;
          err.errors = (data && data.errors) || [];
          throw err;
        }
        return data || {};
      });
    });
  }

  global.api = {
    types: function () { return request('GET', '/api/types'); },
    tree: function (type) { return request('GET', '/api/tree' + (type ? '?type=' + encodeURIComponent(type) : '')); },
    status: function () { return request('GET', '/api/status'); },
    doc: function (path) { return request('GET', '/api/doc?path=' + encodeURIComponent(path)); },
    save: function (payload) { return request('PUT', '/api/doc', payload); },
    validate: function (payload) { return request('POST', '/api/validate', payload); },
    preview: function (payload) { return request('POST', '/api/preview', payload); },
    create: function (payload) { return request('POST', '/api/new', payload); },
    asset: function (payload) { return request('POST', '/api/asset', payload); },
    resources: function (q, kind, folder) {
      var qs = [];
      if (q) { qs.push('q=' + encodeURIComponent(q)); }
      if (kind) { qs.push('kind=' + encodeURIComponent(kind)); }
      if (folder) { qs.push('folder=' + encodeURIComponent(folder)); }
      return request('GET', '/api/resources' + (qs.length ? '?' + qs.join('&') : ''));
    },
    remove: function (payload) { return request('POST', '/api/delete', payload); },
    rename: function (payload) { return request('POST', '/api/rename', payload); },
    reviewers: function () { return request('GET', '/api/reviewers'); },
    pr: function (payload) { return request('POST', '/api/pr', payload); },
    about: function () { return request('GET', '/api/about'); },
    // 登录态（Rust 直处理；未登录时 whoami 抛 401，err.status === 401）
    login: function (payload) { return request('POST', '/api/session', payload); },
    whoami: function () { return request('GET', '/api/whoami'); },
    logout: function (purge) { return request('DELETE', '/api/session' + (purge ? '?purge=true' : '')); },
    purge: function (items) { return request('POST', '/api/purge', { items: items || [] }); }
  };
})(window);
