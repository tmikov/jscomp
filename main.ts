// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="typings/tsd.d.ts" />

import compiler = require("./src/compiler");


function printSyntax (): void
{
    console.error(
"syntax: jscomp [options] filename\n"+
"   -h           this help\n"+
"   --dump-ast   dump AST\n"+
"   --dump-hir   dump HIR\n"
    );
}

function main (argv: string[]): void
{
    var options = new compiler.Options();
    var fname: string = null;

    if (argv.length === 1) {
        printSyntax();
        process.exit(1);
    }

    for ( var i = 1; i < argv.length; ++i ) {
        var arg = argv[i];
        if (arg[0] === "-") {
            switch (arg) {
                case "--dump-ast": options.dumpAST = true; break;
                case "--dump-hir": options.dumpHIR = true; break;
                case "--help":
                case "-h":
                    printSyntax();
                    process.exit(0);
                    break;
                default:
                    console.error("error: unknown option '%s'", arg);
                    process.exit(1);
                    break;
            }
        } else {
            if (fname) {
                console.error("error: more than one file name specified");
                process.exit(1);
            }
            fname = arg;
        }
    }

    if (!fname) {
        console.error("error: no filename specified");
        process.exit(1);
    }

    var reporter: compiler.IErrorReporter = {
        error: (loc: ESTree.SourceLocation, msg: string) => {
            if (loc)
                console.error(`${loc.source}:${loc.start.line}:${loc.start.column + 1}: error: ${msg}`);
            else
                console.error(`error: ${msg}`);
        },
        warning: (loc: ESTree.SourceLocation, msg: string) => {
            if (loc)
                console.warn(`${loc.source}:${loc.start.line}:${loc.start.column + 1}: warning: ${msg}`);
            else
                console.warn(`warning: ${msg}`);
        },
        note: (loc: ESTree.SourceLocation, msg: string) => {
            if (loc)
                console.warn(`${loc.source}:${loc.start.line}:${loc.start.column + 1}: note: ${msg}`);
            else
                console.warn(`note: ${msg}`);
        }
    };

    compiler.compile(fname, reporter, options);
}

main(process.argv.slice(1));
