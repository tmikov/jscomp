// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

__asmh__({},"#include <errno.h>");

function getErrno ()
{
    return __asm__({},["res"],[],[],
        "%[res] = js::makeNumberValue(errno);"
    );
}
exports.getErrno = getErrno;

function strerror (errno)
{
    return __asm__({},["res"], [["errno", errno|0]], [],
        "%[res] = js::makeStringValueFromASCII(%[%frame], ::strerror((int)%[errno].raw.nval));"
    );
}
exports.strerror = strerror;

exports.throwIOError = function throwIOError (syscall, path, errno)
{
    if (errno === undefined)
        errno = getErrno();

    var msg = strerror(errno);

    if (path !== undefined)
        path = String(path);

    if (path)
        msg = msg + " '" + String(path) + "'";

    var e = new Error(msg);
    e.errno = errno;
    //TODO: e.code = "???" // and also append it to the message
    if (path !== undefined)
        e.path = path;
    if (syscall !== undefined)
        e.syscall = syscall;

    throw e;
};


