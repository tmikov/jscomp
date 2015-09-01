// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

exports.FSInitialize = function FSInitialize (stats) {
    console.error("process.binding.fs.FSInitialize() is not implemented");
};
exports.open = function close(path, flags, mode) {
    console.error("process.binding.fs.open() is not implemented");
};
exports.close = function close(fd) {
    console.error("process.binding.fs.close() is not implemented");
};
exports.fstat = function fstat(fd) {
    console.error("process.binding.fs.fstat() is not implemented");
    return {size: 0};
};
exports.read = function read(fd, buffer, offset, length, position) {
    console.error("process.binding.fs.read() is not implemented");
    return 0;
};


