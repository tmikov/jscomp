// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.
var _jsc = require("./_jsc");

__asmh__({},'#include "jsc/fs.h"');
__asmh__({},'#include "jsc/jsni.h"');
__asmh__({},"#include <sys/stat.h>");

var s_statsCon;

exports.FSInitialize = function FSInitialize (statsCons) {
    if (typeof statsCons !== 'function')
        throw TypeError("parameter must be a function");

    s_statsCon = statsCons; // prevent it from being GC-ed
    __asm__({},[],[["statsCons", statsCons]],[],"js::g_statsConFn = js::jsniMakeObjectHandle(%[%frame], %[statsCons]);");
};

function cbwrap (req, fs_type, result, obj)
{
    //console.log("cbwrap", req.syscall, fs_type, result);
    var cb = req.oncomplete;
    if (!cb)
        return;

    if (result < 0) {
        cb(_jsc.makeUVError(result, req.syscall, req.path));
        return;
    }

    switch (fs_type) {
        case  2: // UV_FS_CLOSE
        case 12: // UV_FS_ACCESS
            cb(null);
            break;

        default:
        //case  1: // UV_FS_OPEN
        //case  3: // UV_FS_READ
        //case  4: // UV_FS_WRITE
        //case  6: // UV_FS_STAT
        //case  7: // UV_FS_LSTAT
        //case  8: // UV_FS_FSTAT
        //case 22: // UV_FS_SCANDIR
            cb(null, obj);
            break;
    }
}

/**
 * Initialize the native object (which must have two internal properties): <ul>
 *     <li>Prop 0 is initialized with a pointer to a new 'uv_fs_t' object;
 *     <li>prop 1 is a handle to 'cbwrap()'.
 *     <li>'uv_fs_t.data' is initialized with a handle to 'this'
 * </ul>
 * @constructor
 */
function FSReqWrap ()
{
    this.syscall = "";
    this.path = undefined;
    this.buffer = undefined;

    __asm__({},[],[["this", this], ["cbwrap", cbwrap]],[],
        "js::NativeObject * o = js::safeObjectCast<js::NativeObject>(%[%frame], %[this]);\n" +
        "uv_fs_t * req = (uv_fs_t *)malloc(sizeof(uv_fs_t));\n" +
        "if (!req) js::throwOutOfMemory(%[%frame]);\n" +
        "req->data = (void *)js::jsniMakeObjectHandle(%[%frame], o);\n" +
        "o->setInternalUnsafe(0, (uintptr_t)req);\n" +
        "o->setInternalUnsafe(1, js::jsniMakeObjectHandle(%[%frame], %[cbwrap].raw.oval));\n"
    );

    $jsc.setInitTag(this, fsReqWrapInitTag);
}

$jsc.sealNativePrototype(FSReqWrap, 2);
var fsReqWrapInitTag = $jsc.newInitTag(FSReqWrap.prototype);

exports.FSReqWrap = FSReqWrap;

exports.open = function open (path, flags, mode, req)
{
    var syscall = "open";
    var res;

    path = String(path);

    if ($jsc.checkInitTag(req, fsReqWrapInitTag)) {
        req.syscall = syscall;
        req.path = path;

        res = __asm__({},["res"],[["path", path], ["flags", flags | 0], ["mode", mode | 0], ["req", req]], [],
            "uv_fs_t * req = (uv_fs_t *)((js::NativeObject *)%[req].raw.oval)->getInternalUnsafe(0);\n" +
            "%[res] = js::makeNumberValue(uv_fs_open(uv_default_loop(), req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   (int)%[flags].raw.nval,\n" +
            "   (int)%[mode].raw.nval,\n" +
            "   js::fsCompletionCallback\n" +
            "));"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);
    }
    else {
        res = __asm__({},["res"],[["path", path], ["flags", flags | 0], ["mode", mode | 0]], [],
            "uv_fs_t req;\n" +
            "%[res] = js::makeNumberValue(uv_fs_open(uv_default_loop(), &req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   (int)%[flags].raw.nval,\n" +
            "   (int)%[mode].raw.nval,\n" +
            "   NULL\n" +
            "));\n" +
            "uv_fs_req_cleanup(&req);"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);

        return res;
    }
};

exports.close = function close (fd, req)
{
    var syscall = "close";
    var res;

    if ($jsc.checkInitTag(req, fsReqWrapInitTag)) {
        req.syscall = syscall;

        res = __asm__({},["res"],[["fd", fd|0], ["req", req]], [],
            "uv_fs_t * req = (uv_fs_t *)((js::NativeObject *)%[req].raw.oval)->getInternalUnsafe(0);\n" +
            "%[res] = js::makeNumberValue(uv_fs_close(uv_default_loop(), req,\n" +
            "   (uv_file)%[fd].raw.nval,\n" +
            "   js::fsCompletionCallback\n" +
            "));"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall);

    } else {
        res = __asm__({},["res"],[["fd", fd|0]], [],
            "uv_fs_t req;\n" +
            "%[res] = js::makeNumberValue(uv_fs_close(uv_default_loop(), &req,\n" +
            "   (uv_file)%[fd].raw.nval,\n" +
            "   NULL\n" +
            "));\n" +
            "uv_fs_req_cleanup(&req);"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall);
    }
};

exports.stat = function stat (path, req)
{
    var syscall = "stat";
    var res;

    path = String(path);

    if ($jsc.checkInitTag(req, fsReqWrapInitTag)) {
        req.syscall = syscall;
        req.path = path;

        res = __asm__({},["res"],[["path", path], ["req", req]], [],
            "uv_fs_t * req = (uv_fs_t *)((js::NativeObject *)%[req].raw.oval)->getInternalUnsafe(0);\n" +
            "%[res] = js::makeNumberValue(uv_fs_stat(uv_default_loop(), req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   js::fsCompletionCallback\n" +
            "));"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);
    } else {
        var st;
        res = __asm__({},["res"],[["path", path], ["stat", st]], [],
            "uv_fs_t req;\n" +
            "int res;\n" +
            "%[res] = js::makeNumberValue(res = uv_fs_stat(uv_default_loop(), &req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   NULL\n" +
            "));\n" +
            "if (res >= 0) {\n" +
            "   %[stat] = js::fsMakeStats(%[%frame], &req);" +
            "}\n" +
            "uv_fs_req_cleanup(&req);"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);
        return st;
    }
};

exports.lstat = function lstat (path, req)
{
    var syscall = "lstat";
    var res;

    path = String(path);

    if ($jsc.checkInitTag(req, fsReqWrapInitTag)) {
        req.syscall = syscall;
        req.path = path;

        res = __asm__({},["res"],[["path", path], ["req", req]], [],
            "uv_fs_t * req = (uv_fs_t *)((js::NativeObject *)%[req].raw.oval)->getInternalUnsafe(0);\n" +
            "%[res] = js::makeNumberValue(uv_fs_lstat(uv_default_loop(), req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   js::fsCompletionCallback\n" +
            "));"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);
    } else {
        var st;
        res = __asm__({},["res"],[["path", path], ["stat", st]], [],
            "uv_fs_t req;\n" +
            "int res;\n" +
            "%[res] = js::makeNumberValue(res = uv_fs_lstat(uv_default_loop(), &req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   NULL\n" +
            "));\n" +
            "if (res >= 0) {\n" +
            "   %[stat] = js::fsMakeStats(%[%frame], &req);" +
            "}\n" +
            "uv_fs_req_cleanup(&req);"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);
        return st;
    }
};

exports.fstat = function fstat (fd, req)
{
    var syscall = "fstat";
    var res;

    if ($jsc.checkInitTag(req, fsReqWrapInitTag)) {
        req.syscall = syscall;

        res = __asm__({},["res"],[["fd", fd|0], ["req", req]], [],
            "uv_fs_t * req = (uv_fs_t *)((js::NativeObject *)%[req].raw.oval)->getInternalUnsafe(0);\n" +
            "%[res] = js::makeNumberValue(uv_fs_fstat(uv_default_loop(), req,\n" +
            "   (uv_file)%[fd].raw.nval,\n" +
            "   js::fsCompletionCallback\n" +
            "));"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall);
    } else {
        var st;
        res = __asm__({},["res"],[["fd", fd|0], ["stat", st]], [],
            "uv_fs_t req;\n" +
            "int res;\n" +
            "%[res] = js::makeNumberValue(res = uv_fs_fstat(uv_default_loop(), &req,\n" +
            "   (uv_file)%[fd].raw.nval,\n" +
            "   NULL\n" +
            "));\n" +
            "if (res >= 0) {\n" +
            "   %[stat] = js::fsMakeStats(%[%frame], &req);" +
            "}\n" +
            "uv_fs_req_cleanup(&req);"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall);
        return st;
    }
};

exports.read = function read (fd, buffer, offset, length, position, req)
{
    var res;
    var syscall = "read";

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

    if (position === null || position === undefined)
        position = -1; // read from current pos
    else
        position = +position;

    if ($jsc.checkInitTag(req, fsReqWrapInitTag)) {
        req.syscall = syscall;
        req.buffer = buffer; // prevent the buffer from being garbage-collected

        res = __asm__({},["res"],
            [
                ["fd", fd|0], ["arrayBuffer", arrayBuffer], ["offset", offset], ["length", length],
                ["position",position], ["req", req]
            ], [],

            "uv_fs_t * req = (uv_fs_t *)((js::NativeObject *)%[req].raw.oval)->getInternalUnsafe(0);\n" +
            "js::ArrayBuffer * ab = (js::ArrayBuffer *)%[arrayBuffer].raw.oval;\n" +
            "uv_buf_t bufs[] = { {(char *)ab->data + (size_t)%[offset].raw.nval, (size_t)%[length].raw.nval} };\n" +
            "%[res] = js::makeNumberValue(uv_fs_read(uv_default_loop(), req,\n" +
            "   (uv_file)%[fd].raw.nval,\n" +
            "   bufs,\n" +
            "   1,\n" +
            "   (int64_t)%[position].raw.nval," +
            "   js::fsCompletionCallback\n" +
            "));"
        );

        if (res < 0)
            _jsc.throwUVError(res, syscall);
    } else {
        res = __asm__({},["res"],
            [["fd", fd|0], ["arrayBuffer", arrayBuffer], ["offset", offset], ["length", length], ["position",position]], [],

            "js::ArrayBuffer * ab = (js::ArrayBuffer *)%[arrayBuffer].raw.oval;\n" +
            "uv_buf_t bufs[] = { {(char *)ab->data + (size_t)%[offset].raw.nval, (size_t)%[length].raw.nval} };\n" +
            "uv_fs_t req;\n" +
            "%[res] = js::makeNumberValue(uv_fs_read(uv_default_loop(), &req,\n" +
            "   (uv_file)%[fd].raw.nval,\n" +
            "   bufs,\n" +
            "   1,\n" +
            "   (int64_t)%[position].raw.nval," +
            "   NULL" +
            "));\n" +
            "uv_fs_req_cleanup(&req);"
        );

        if (res < 0)
            _jsc.throwUVError(res, syscall);

        return res;
    }
};

function writeBuffer (fd, buffer, offset, length, position, req)
{
    var res;
    var syscall = "write";

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

    if (position === null || position === undefined)
        position = -1; // read from current pos
    else
        position = +position;

    if ($jsc.checkInitTag(req, fsReqWrapInitTag)) {
        req.syscall = syscall;
        req.buffer = buffer; // prevent the buffer from being garbage-collected

        res = __asm__({},["res"],
            [
                ["fd", fd|0], ["arrayBuffer", arrayBuffer], ["offset", offset], ["length", length],
                ["position",position], ["req", req]
            ], [],

            "uv_fs_t * req = (uv_fs_t *)((js::NativeObject *)%[req].raw.oval)->getInternalUnsafe(0);\n" +
            "js::ArrayBuffer * ab = (js::ArrayBuffer *)%[arrayBuffer].raw.oval;\n" +
            "uv_buf_t bufs[] = { {(char *)ab->data + (size_t)%[offset].raw.nval, (size_t)%[length].raw.nval} };\n" +
            "%[res] = js::makeNumberValue(uv_fs_write(uv_default_loop(), req,\n" +
            "   (uv_file)%[fd].raw.nval,\n" +
            "   bufs,\n" +
            "   1,\n" +
            "   (int64_t)%[position].raw.nval," +
            "   js::fsCompletionCallback\n" +
            "));"
        );

        if (res < 0)
            _jsc.throwUVError(res, syscall);
    } else {
        res = __asm__({},["res"],
            [["fd", fd|0], ["arrayBuffer", arrayBuffer], ["offset", offset], ["length", length], ["position",position]], [],

            "js::ArrayBuffer * ab = (js::ArrayBuffer *)%[arrayBuffer].raw.oval;\n" +
            "uv_buf_t bufs[] = { {(char *)ab->data + (size_t)%[offset].raw.nval, (size_t)%[length].raw.nval} };\n" +
            "uv_fs_t req;\n" +
            "%[res] = js::makeNumberValue(uv_fs_write(uv_default_loop(), &req,\n" +
            "   (uv_file)%[fd].raw.nval,\n" +
            "   bufs,\n" +
            "   1,\n" +
            "   (int64_t)%[position].raw.nval," +
            "   NULL" +
            "));\n" +
            "uv_fs_req_cleanup(&req);"
        );

        if (res < 0)
            _jsc.throwUVError(res, syscall);

        return res;

    }
}
exports.writeBuffer = writeBuffer;

exports.writeString = function writeString (fd, data, position, encoding, req)
{
    if (!$jsc.checkInitTag(req, fsReqWrapInitTag))
        req = null;

    var buf = new Buffer(String(data), encoding);
    return writeBuffer(fd, buf, 0, buf.length, position, req);
};

exports.readdir = function readdir (path, req)
{
    var syscall = "scandir";
    var res;

    path = String(path);

    if ($jsc.checkInitTag(req, fsReqWrapInitTag)) {
        req.syscall = syscall;
        req.path = path;

        res = __asm__({},["res"],[["path", path], ["req", req]], [],
            "uv_fs_t * req = (uv_fs_t *)((js::NativeObject *)%[req].raw.oval)->getInternalUnsafe(0);\n" +
            "%[res] = js::makeNumberValue(uv_fs_scandir(uv_default_loop(), req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   0,\n" +
            "   js::fsCompletionCallback\n" +
            "));"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);
    } else {
        var array;
        res = __asm__({},["res"],[["path", path], ["array", array]], [],
            "uv_fs_t req;\n" +
            "int res;\n" +
            "%[res] = js::makeNumberValue(res = uv_fs_scandir(uv_default_loop(), &req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   0,\n" +
            "   NULL" +
            "));\n" +
            "if (res >= 0) {\n" +
            "   %[array] = js::fsMakeReaddirArray(%[%frame], &req);" +
            "}\n" +
            "uv_fs_req_cleanup(&req);"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);
        return array;
    }
};

exports.access = function access (path, mode, req)
{
    var syscall = "access";
    var res;

    path = String(path);

    if ($jsc.checkInitTag(req, fsReqWrapInitTag)) {
        req.syscall = syscall;
        req.path = path;

        res = __asm__({},["res"],[["path", path], ["mode", mode|0], ["req", req]], [],
            "uv_fs_t * req = (uv_fs_t *)((js::NativeObject *)%[req].raw.oval)->getInternalUnsafe(0);\n" +
            "%[res] = js::makeNumberValue(uv_fs_access(uv_default_loop(), req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   (int)%[mode].raw.nval,\n" +
            "   js::fsCompletionCallback\n" +
            "));"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);
    } else {
        res = __asm__({},["res"],[["path", path], ["mode", mode|0]], [],
            "uv_fs_t req;\n" +
            "%[res] = js::makeNumberValue(uv_fs_access(uv_default_loop(), &req,\n" +
            "   %[path].raw.sval->getStr(),\n" +
            "   (int)%[mode].raw.nval,\n" +
            "   NULL\n" +
            "));\n" +
            "uv_fs_req_cleanup(&req);"
        );
        if (res < 0)
            _jsc.throwUVError(res, syscall, path);
    }
};
