// Runs before first paint so a remembered theme does not flash.
try {
  var t = localStorage.getItem('rack-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
