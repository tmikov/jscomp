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

__asmh__({},"#include <dirent.h>");

function opendir (path)
{
    path = String(path);
    var dir = $jsc.createNative(1);
    if (!__asm__({},["res"],[["dir",dir], ["path", path]],[],
            "DIR * d = ::opendir(%[path].raw.sval->getStr());\n" +
            "if (d) {\n" +
            "  %[dir].raw.oval->setInternalProp(0, (uintptr_t)d);\n" +
            "  %[res] = js::makeBooleanValue(true);\n" +
            "} else {\n" +
            "  %[res] = js::makeBooleanValue(false);\n" +
            "}"
        ))
    {
        _jsc.throwIOError("opendir", path);
    }

    // Set the finalizer
    __asmh__({},
        "static void dir_finalizer (js::NativeObject * obj)\n" +
        "{\n" +
        "  DIR * d = (DIR *)obj->getInternalUnsafe(0);\n" +
        "  if (d) ::closedir(d);\n" +
        "}"
    );
    __asm__({},[],[["dir", dir]],[],
        "((js::NativeObject *)%[dir].raw.oval)->setNativeFinalizer(dir_finalizer);"
    );
    return dir;
}

function closedir (dir)
{
    if (__asm__({},["res"],[["dir",dir]],[],
            "DIR * d = (DIR *)%[dir].raw.oval->getInternalProp(0);\n" +
            "if (d) {\n" +
            "  %[dir].raw.oval->setInternalProp(0, 0);\n" +
            "  %[res] = js::makeNumberValue(::closedir(d));\n" +
            "} else {\n" +
            "  %[res] = js::makeNumberValue(0);\n" +
            "}"
        ) === -1)
    {
        _jsc.throwIOError("closedir");
    }
}

function readdir (dir)
{
    var name = null;
    if (!__asm__({},["res"],[["dir",dir],["name", name]],[],
            "DIR * d = (DIR *)%[dir].raw.oval->getInternalProp(0);\n" +
            "if (d) {\n" +
            "  struct dirent * de;\n" +
            "  errno = 0;\n" +
            "  de = ::readdir(d);\n" +
            "  if (de) {\n" +
            "    %[name] = js::makeStringValueFromUnvalidated(%[%frame], de->d_name);\n" +
            "    %[res] = js::makeBooleanValue(true);\n" +
            "  } else {\n" +
            "    %[res] = js::makeBooleanValue(errno == 0);\n" +
            "  }\n" +
            "} else {\n" +
            "  %[res] = js::makeBooleanValue(true);\n" +
            "}"
        ) === -1)
    {
        _jsc.throwIOError("readdir");
    }
    return name;
}

exports.readdir = function readdirSync (path)
{
    var dir = opendir(path);
    var res = [];
    try {
        var name;
        while ((name = readdir(dir)) !== null) {
            if (name !== "." && name !== "..")
                res.push(name);
        }
    } finally {
        closedir(dir);
    }
    return res;
};

exports.access = function access (path, mode)
{
    var res = __asm__({},["res"],[["path", String(path)], ["mode", mode | 0]], [],
        "%[res] = js::makeNumberValue(::access(%[path].raw.sval->getStr(), (int)%[mode].raw.nval));"
    );
    if (res === -1)
        _jsc.throwIOError("access", path);
};
