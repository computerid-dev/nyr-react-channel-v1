(function () {
  const ALLOWED_HOSTS = [
    "nyr-react-channel-v1.vercel.app"
  ];
  const DESTINATION = "./nyr-react-channel/index.html";
  const DENIED_MESSAGE = "link tidak resmi! Tidak dapat dibuka!";

  const isVerified = ALLOWED_HOSTS.includes(window.location.hostname);

  if (isVerified) {
    window.location.replace(DESTINATION);
    return;
  }

  document.body.innerHTML = "";
  const notice = document.createElement("p");
  notice.id = "guard-message";
  notice.textContent = DENIED_MESSAGE;
  document.body.appendChild(notice);
})();
