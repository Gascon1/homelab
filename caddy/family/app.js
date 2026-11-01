(function () {
  var host = location.hostname;
  document.querySelectorAll('a.tile[data-port]').forEach(function (a) {
    a.href = 'https://' + host + ':' + a.dataset.port + a.dataset.path;
  });
  var url = 'https://' + host + ':2283';
  var code = document.getElementById('immich-url');
  var btn = document.getElementById('copy');
  var status = document.getElementById('copy-status');
  code.textContent = url;
  function select() {
    var r = document.createRange();
    r.selectNodeContents(code);
    var s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  btn.hidden = false;
  btn.addEventListener('click', function () {
    function done(t) { status.textContent = t; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done('Copied'); }, function () { select(); done('Press and hold to copy'); });
    } else { select(); done('Press and hold to copy'); }
  });
  code.addEventListener('focus', select);
})();
