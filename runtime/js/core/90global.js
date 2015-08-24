// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

global = {};

hidden(global, "isNaN", isNaN);
hidden(global, "isFinite", isFinite);
hidden(global, "parseInt", parseInt);
hidden(global, "decodeURI", decodeURI);
hidden(global, "decodeURIComponent", decodeURIComponent);
hidden(global, "encodeURI", decodeURI);
hidden(global, "encodeURIComponent", encodeURIComponent);
hidden(global, "SyntaxError", SyntaxError);
hidden(global, "InternalError", InternalError);
hidden(global, "RangeError", RangeError);
hidden(global, "URIError", URIError);
