// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

#ifndef JSCOMP_COMMON_H
#define JSCOMP_COMMON_H

#define JS_NORETURN __attribute__((noreturn))
#define JS_LIKELY(cond)          __builtin_expect(!!(cond), 1)
#define JS_UNLIKELY(cond)        __builtin_expect(!!(cond), 0)

#endif //JSCOMP_COMMON_H
