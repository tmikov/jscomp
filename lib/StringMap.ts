// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

class StringMap<V>
{
    map: { [key: string]: V };

    constructor ()
    {
        this.map = Object.create(null);
    }

    get (key: string): V
    {
        return this.map[key];
    }

    set (key: string, value: V): void
    {
        this.map[key] = value;
    }

    has (key: string): boolean
    {
        return key in this.map;
    }

    forEach (cb: (val: V, key: string)=> void): void
    {
        for (var k in this.map)
            cb(this.map[k], k);
    }
}

export = StringMap;
