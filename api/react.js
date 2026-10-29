"use strict";

const { withProxyGuard } = require("../nyr-react-channel/proxy/proxy");
const { handleReact } = require("../nyr-react-channel/backend/react-handler");

module.exports = withProxyGuard(handleReact);
