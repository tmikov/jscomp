// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

declare
class Error
{
    constructor (message: string);
}

class AssertionError extends Error
{
    constructor (msg: string)
    {
        super(msg);
    }
}

export = AssertionError;
