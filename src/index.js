"use strict";

const { installRuntimeHardening } = require("./hardening/runtime");
installRuntimeHardening();

require("./modules/stream-notifier");
