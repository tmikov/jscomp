// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

var _jsc = require("./_jsc");
var events = require("events");

function Process () {}
Process.prototype = Object.create(events.EventEmitter.prototype, {constructor: {value: Process.constructor}});

exports = module.exports = new Process();

exports.execArgv = null;
exports.argv = null;
exports.env = null;

exports.exit = function exit (code)
{
    __asm__({},[],[["code", code | 0]],[],
        "::exit((int)%[code].raw.nval);"
    );
};

__asmh__({},"#include <unistd.h>");
__asmh__({},"#include <errno.h>");

exports.cwd = function cwd ()
{
    var res = __asm__({},["res"],[],[],
        "char * s = ::getcwd(NULL, 0);\n" +
        "if (s) {\n" +
        "  %[res] = js::makeStringValueFromUnvalidated(%[%frame], s);\n" +
        "  ::free(s);\n" +
        "} else {\n" +
        "  %[res] = JS_NULL_VALUE;\n" +
        "}"
    );

    if (res === null)
        _jsc.throwIOError("getcwd");
    return res;
};

exports.nextTick = function process_nextTick (cb) // FIXME
{
    console.error("process.nextTick() is not implemented!");
};

exports._setupNextTick = function process_setupNextTick (tickInfo, tickCallback, runMicrotasks)
{
    console.error("process._setupNextTick() is not implemented!");
};

var s_bindings = {
    fs: require("./_fs"),
    constants: require("./_constants"),
    tty_wrap: require("./_tty_wrap.js"),
    timer_wrap: require("./_timer_wrap.js")
};

exports.binding = function process_binding (name) // FIXME
{
    var res = s_bindings[name];
    if (!res) {
        console.error("process.binding(", name, ") is not implemented");
        return {};
    }
    return res;
};

function initArgv ()
{
    var argc = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(JS_GET_RUNTIME(%[%frame])->argc)");
    var argv = new Array(argc);

    for ( var i = 0; i < argc; ++i ) {
        argv[i] = __asm__({},["res"],[["i",i]], [],
            "%[res] = js::makeStringValueFromUnvalidated(%[%frame], JS_GET_RUNTIME(%[%frame])->argv[(int)%[i].raw.nval]);"
        );
    }

    var nodeArgv = new Array(argc + 1);
    nodeArgv[0] = argv[0];
    nodeArgv[1] = "";
    for ( i = 1; i < argc; ++i )
        nodeArgv[i+1] = argv[i];

    exports.argv = nodeArgv;
}

function initEnv ()
{
    var env = {};
    var name, value;
    var i = 0;
    for (;;) {
        if (!__asm__({},["res"],[["i", i], ["name", name], ["value", value]],[],
                "extern char ** environ;\n" +
                "const char * line = environ[(int)%[i].raw.nval];\n" +
                "if (line) {\n" +
                "  const char * eq = ::strchr(line, '=');\n" +
                "  if (eq) {\n" +
                "    %[name] = js::makeStringValueFromUnvalidated(%[%frame], line, eq - line);\n" +
                "    %[value] = js::makeStringValueFromUnvalidated(%[%frame], eq+1);\n" +
                "  } else {\n" +
                "    %[name] = js::makeStringValueFromUnvalidated(%[%frame], line);\n" +
                "    %[value] = js::makeStringValue(JS_GET_RUNTIME(%[%frame])->permStrEmpty);\n" +
                "  }\n" +
                "  %[res] = js::makeBooleanValue(true);\n" +
                "} else {\n" +
                "  %[res] = js::makeBooleanValue(false);\n" +
                "}"
            ))
        {
            break;
        }

        env[name] = value;
        ++i;
    }

    exports.env = env;
}

initArgv();
initEnv();
