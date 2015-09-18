// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

var jsc = require("./jsc");

exports.ShutdownWrap = function ()
{
    console.error("ShutdownWrap() not implemented");
};

function WriteWrap ()
{
    $jsc.setInitTag(writeWrapInitTag);
}
exports.WriteWrap = WriteWrap;

$jsc.sealNativePrototype(WriteWrap, 1);
var writeWrapInitTag = $jsc.newInitTag(WriteWrap.prototype);

function StreamWrap ()
{
    console.error("StreamWrap() not implemented");
    $jsc.setInitTag(streamWrapInitTag);
}
exports.StreamWrap = StreamWrap();

$jsc.sealNativePrototype(StreamWrap, 1);
var streamWrapInitTag = $jsc.newInitTag(StreamWrap.prototype);

StreamWrap.prototype.readStart = function streamWrap_readStart ()
{
    console.error("StreamWrap.readStart() not implemented");
};
StreamWrap.prototype.readStop = function streamWrap_readStop ()
{
    console.error("StreamWrap.readStop() not implemented");
};
StreamWrap.prototype.shutdown = function streamWrap_shutdown ()
{
    console.error("StreamWrap.shutdown() not implemented");
};

StreamWrap.prototype.writev = function streamWrap_writev ()
{
    console.error("StreamWrap.writev() not implemented");
};

StreamWrap.prototype.writeBuffer = function streamWrap_writeBuffer (req, buffer)
{
    console.error("StreamWrap.writeBuffer() not implemented");

    if (!$jsc.checkInitTag(this, streamWrapInitTag))
        throw TypeError("not a StreamWrap");
    if (!$jsc.checkInitTag(req, writeWrapInitTag))
        throw TypeError("arg 1 is not a WriteWrap");
    if (!Buffer.isBuffer(buffer))
        throw TypeError("arg 2 is not a buffer");

    __asm__({},[],["this", this],[],
        "uv_stream_t * h = (uv_stream_t *)%[this].raw.oval->getInternalProp();\n" +
        ""
    );
};

StreamWrap.prototype.writeAsciiString = function streamWrap_writeAsciiString (req, string)
{
    console.error("StreamWrap.writeAsciiString() not implemented");
};

StreamWrap.prototype.writeUtf8String = function streamWrap_writeUtf8String (req, string, handle)
{
    console.error("StreamWrap.writeUtf8String() not implemented");
};

StreamWrap.prototype.writeUcs2String = function streamWrap_writeUcs2String (req, string)
{
    return this.writeBuffer(req, new Buffer(string, "ucs2"), handle);
};

StreamWrap.prototype.writeBinaryString = function streamWrap_writeBinaryString (req, string)
{
    console.error("StreamWrap.writeBinaryString() not implemented");
};
