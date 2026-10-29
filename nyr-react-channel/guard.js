(function () {
  const ALLOWED_HOSTS = [
    "nyr-react-channel-v1.vercel.app"
  ];

  if (!ALLOWED_HOSTS.includes(window.location.hostname)) {
    window.location.replace("../index.html");
  }
})();
