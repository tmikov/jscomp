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

exports.close = function close (fd)
{
    if (__asm__({},["res"],[["fd", fd|0]],[], "%[res] = js::makeNumberValue(::close((int)%[fd].raw.nval));") === -1)
        _jsc.throwIOError("close");
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

exports.read = function read (fd, buffer, offset, length, position)
{
    if (!Buffer.isBuffer(buffer))
        throw TypeError("invalid buffer");
    offset = +offset;
    length = +length;
    if (offset < 0)
        throw TypeError("negative offset");
    if (length < 0)
        throw TypeError("negative length");
    if (offset + length > buffer.length)
        throw TypeError("offset+length exceeds buffer size");

    // We do know that our current "buffer" implementation is a Uint8Array
    if (!(buffer instanceof Uint8Array))
        throw TypeError("invalid buffer");
    var arrayBuffer = buffer.buffer;
    offset += buffer.byteOffset; // Offset in the underlying ArrayBuffer
    if (offset + length > arrayBuffer.byteLength)
        throw TypeError("offset+length exceeds buffer size");

    var res;
    var syscall;

    if (position !== null && position !== undefined) {
        syscall = "pread";
        res = __asm__({},["res"],
            [["fd", fd|0], ["arrayBuffer", arrayBuffer], ["offset", offset], ["length", length], ["position",+position]], [],
            "js::ArrayBuffer * ab = (js::ArrayBuffer *)%[arrayBuffer].raw.oval;\n" +
            "%[res] = js::makeNumberValue(::pread(" +
                "(int)%[fd].raw.nval," +
                "(char *)ab->data + (size_t)%[offset].raw.nval," +
                "(size_t)%[length].raw.nval," +
                "(off_t)%[position].raw.nval" +
            "));"
        );
    } else {
        syscall = "read";
        res = __asm__({},["res"],[["fd", fd|0], ["arrayBuffer", arrayBuffer], ["offset", offset], ["length", length]], [],
            "js::ArrayBuffer * ab = (js::ArrayBuffer *)%[arrayBuffer].raw.oval;\n" +
            "%[res] = js::makeNumberValue(::read(" +
                "(int)%[fd].raw.nval," +
                "(char *)ab->data + (size_t)%[offset].raw.nval," +
                "(size_t)%[length].raw.nval" +
            "));"
        );
    }

    if (res === -1)
        _jsc.throwIOError(syscall);

    return res;
};


