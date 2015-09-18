// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

__asmh__({},'#include "uv.h"');

var s_handleTypes = ["TCP", "TTY", "UDP", "FILE", "PIPE", "UNKNOWN"];

function guessHandleType (fd)
{
    return __asm__({},["res"],[["fd", fd|0], ["types", s_handleTypes]],[],
        "switch (uv_guess_handle((int)%[fd].raw.nval)) {\n" +
        "    case UV_TCP: %[res] = ((js::Array *)%[types].raw.oval)->getElem(0); break;\n" +
        "    case UV_TTY: %[res] = ((js::Array *)%[types].raw.oval)->getElem(1); break;\n" +
        "    case UV_UDP: %[res] = ((js::Array *)%[types].raw.oval)->getElem(2); break;\n" +
        "    case UV_FILE: %[res] = ((js::Array *)%[types].raw.oval)->getElem(3); break;\n" +
        "    case UV_NAMED_PIPE: %[res] = ((js::Array *)%[types].raw.oval)->getElem(4); break;\n" +
        "    default:\n" +
        "    case UV_UNKNOWN_HANDLE: %[res] = ((js::Array *)%[types].raw.oval)->getElem(5); break;\n" +
        "}"
    );
}
exports.guessHandleType = guessHandleType;

exports.isTTY = function isTTY (fd)
{
    return guessHandleType(fd) === "TTY";
};

function TTY (fd, flag)
{
    console.error("TTY is not implemented");
}

TTY.prototype.getWindowSize = function (winSize)
{
    console.error("TTY.getWindowSize is not implemented");
};

TTY.prototype.writeUtf8String = function (req, data)
{
    console.error("TTY.writeUtf8String() not implemented");
};

exports.TTY = TTY;
