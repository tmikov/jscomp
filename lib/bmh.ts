// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

// Boyer-Moore-Harspool substring search algorithm

function bmh_preprocess (p: Buffer): number[]
{
    var t = new Array<number>(256);
    var e = p.length;
    for ( var i = 0; i < 256; ++i )
        t[i] = e;
    for ( i = 0; i < e; ++i )
        t[p[i]] = e - 1 - i;
    return t;
}

export function search (haystack: Buffer, hfrom: number, hto: number, needle: Buffer): number
{
    var t = bmh_preprocess(needle);
    var needlen = needle.length;
    var skip = hfrom;
    while (hto - skip >= needlen) {
        for ( var i = needlen - 1; haystack[skip + i] === needle[i]; --i )
            if (i === 0)
                return skip;
        skip = skip + t[haystack[skip + needlen - 1]];
    }
    return -1;
}
