// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="typings/tsd.d.ts" />

import compiler = require("./src/compiler");

// Special handling for regular expression literal since we need to
// convert it to a string literal, otherwise it will be decoded
// as object "{}" and the regular expression would be lost.
//function adjustRegexLiteral(key: any, value: any)
//{
//    if (key === 'value' && value instanceof RegExp) {
//        value = value.toString();
//    }
//    return value;
//}

function printSyntax (): void
{
    console.error("syntax: jscomp filename");
}

function main (argv: string[]): void
{
    if (argv.length !== 2) {
        printSyntax();
        process.exit(1);
    }
    var fname = argv[1];

    var reporter: compiler.IErrorReporter = {
        error: (loc: ESTree.SourceLocation, msg: string) => {
            if (loc)
                console.error(`${loc.source}:${loc.start.line}:${loc.start.column}: error: ${msg}`);
            else
                console.error(`error: ${msg}`);
        },
        warning: (loc: ESTree.SourceLocation, msg: string) => {
            if (loc)
                console.warn(`${loc.source}:${loc.start.line}:${loc.start.column}: warning: ${msg}`);
            else
                console.warn(`warning: ${msg}`);
        }
    };

    var comp = new compiler.Compiler(fname, reporter);
    comp.compile();
}

main(process.argv.slice(1));
