// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

__asmh__({},"#include <fcntl.h>");

exports.O_APPEND = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(O_APPEND);");
exports.O_CREAT  = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(O_CREAT);");
exports.O_EXCL   = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(O_EXCL);");
exports.O_RDONLY = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(O_RDONLY);");
exports.O_RDWR   = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(O_RDWR);");
exports.O_SYNC   = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(O_SYNC);");
exports.O_TRUNC  = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(O_TRUNC);");
exports.O_WRONLY = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(O_WRONLY);");

exports.F_OK = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(F_OK);");
exports.R_OK = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(R_OK);");
exports.W_OK = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(W_OK);");
exports.X_OK = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(X_OK);");

exports.S_IFMT = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(S_IFMT);");
exports.S_IFDIR = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(S_IFDIR);");
exports.S_IFREG = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(S_IFREG);");
exports.S_IFBLK = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(S_IFBLK);");
exports.S_IFCHR = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(S_IFCHR);");
exports.S_IFLNK = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(S_IFLNK);");
exports.S_IFIFO = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(S_IFIFO);");
exports.S_IFSOCK = __asm__({},["res"],[],[],"%[res] = js::makeNumberValue(S_IFSOCK);");
