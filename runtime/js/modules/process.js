// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

exports.execArgv = null;
exports.argv = null;
exports.env = null;

exports.exit = function exit (code)
{
    __asm__({},[],[["code", code | 0]],[],
        "::exit((int)%[code].raw.nval);"
    );
};

function strerror (errno)
{
    return __asm__({},["res"], [["errno", errno|0]], [],
        "%[res] = js::makeStringValueFromASCII(%[%frame], ::strerror((int)%[errno].raw.nval));"
    );
}

function throwIOError (errno, path, syscall)
{
    var msg = strerror(errno);
    if (path)
        msg = msg + " '" + path + "'";
    var e = new Error(msg);
    e.errno = errno;
    //TODO: e.code = "???" // and also append it to the message
    if (path !== undefined)
        e.path = path;
    if (syscall !== undefined)
        e.syscall = syscall;

    throw e;
}

__asmh__({},"#include <unistd.h>");
__asmh__({},"#include <errno.h>");

exports.cwd = function cwd ()
{
    var errno = 0;
    var res = __asm__({},["res"],[["errno", errno]],[],
        "char * s = ::getcwd(NULL, 0);\n" +
        "if (s) {\n" +
        "  %[errno] = js::makeNumberValue(0);\n" +
        "  %[res] = js::makeStringValueFromUnvalidated(%[%frame], s);\n" +
        "  ::free(s);\n" +
        "} else {\n" +
        "  %[errno] = js::makeNumberValue(errno);\n" +
        "  %[res] = JS_NULL_VALUE;\n" +
        "}"
    );

    if (res === null)
        throwIOError(errno, undefined, "getcwd");
    return res;
};



exports.binding = function process_binding (name) // FIXME
{
    console.error("process.binding(", name, ")is not implemented");
    return {};
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
