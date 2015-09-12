// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

__asmh__({},'#include "uv.h"');
__asmh__({},"#include <errno.h>");

exports.sealPrototype = function sealPrototype (obj, value)
{
    Object.defineProperty(obj, "prototype", {value: value, writable: false});
};

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


function uv_strerror (errno)
{
    return __asm__({},["res"], [["errno", errno|0]], [],
        "%[res] = js::makeStringValueFromASCII(%[%frame], ::uv_strerror((int)%[errno].raw.nval));"
    );
}
exports.uv_strerror = uv_strerror;

function uv_err_name (errno)
{
    return __asm__({},["res"], [["errno", errno|0]], [],
        "%[res] = js::makeStringValueFromASCII(%[%frame], ::uv_err_name((int)%[errno].raw.nval));"
    );
}
exports.uv_err_name = uv_err_name;

function makeUVError (errno, syscall, path)
{
    var code = uv_err_name(errno);
    var msg = code + ", " + uv_strerror(errno);

    if (path !== undefined)
        path = String(path);

    if (path)
        msg = msg + " '" + String(path) + "'";

    var e = new Error(msg);
    e.errno = errno;
    e.code = code;
    if (path !== undefined)
        e.path = path;
    if (syscall !== undefined)
        e.syscall = syscall;

    return e;
};
exports.makeUVError = makeUVError;

exports.throwUVError = function throwUVError (errno, syscall, path)
{
    throw makeUVError(errno, syscall, path);
};
