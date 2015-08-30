// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.


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
