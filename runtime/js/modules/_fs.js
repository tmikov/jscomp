// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.
var _jsc = require("./_jsc");

__asmh__({},"#include <sys/stat.h>");

exports.FSInitialize = function FSInitialize (stats) {
    console.error("process.binding.fs.FSInitialize() is not implemented");
};

exports.open = function open (path, flags, mode)
{
    var hnd = __asm__({},["res"],[["path", String(path)], ["flags", flags | 0], ["mode", mode | 0]], [],
        "%[res] = js::makeNumberValue(" +
            "::open(%[path].raw.sval->getStr()," +
            "(int)%[flags].raw.nval," +
            "(int)%[mode].raw.nval" +
        "));"
    );
    if (hnd === -1)
        _jsc.throwIOError("open", path);
    return hnd;
};

exports.close = function close(fd) {
    console.error("process.binding.fs.close() is not implemented");
};

exports.fstat = function fstat (fd)
{
    var size;
    if (__asm__({},["res"],[["fd", fd|0], ["size", size]],[],
            "struct stat buf;\n" +
            "int res;\n" +
            "%[res] = js::makeNumberValue(res = ::fstat((int)%[fd].raw.nval, &buf));\n" +
            "if (res != -1) {\n" +
            "  %[size] = js::makeNumberValue(buf.st_size);\n" +
            "}"
        ) === -1)
    {
        _jsc.throwIOError("fstat");
    }

    return { size: size };
};

exports.read = function read(fd, buffer, offset, length, position) {
    console.error("process.binding.fs.read() is not implemented");
    return 0;
};


