// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

import fs = require("fs");
import acorn = require("acorn/dist/acorn_csp");

export interface IErrorReporter
{
    error (loc: ESTree.SourceLocation, msg: string) : void;
    warning (loc: ESTree.SourceLocation, msg: string) : void;
}

export class Compiler
{
    private reporter: IErrorReporter;
    private fileName: string;

    constructor (fileName: string, reporter: IErrorReporter)
    {
        this.reporter = reporter;
        this.fileName = fileName;
    }

    compile (): boolean
    {
        var prog: ESTree.Program;
        if (!(this.parse(this.fileName)))
            return false;
        return true;
    }

    private parse (fileName: string): ESTree.Program
    {
        var options: acorn.Options = {
            ecmaVersion: 5,
            sourceType: "module",
            allowReserved: false,
            allowHashBang: true,
            locations: true,
        };

        try {
            var content = fs.readFileSync(fileName, 'utf-8');
        } catch (e) {
            this.reporter.error(null, e.message);
            return null;
        }

        try {
            return acorn.parse(content, options);
        } catch (e) {
            if (e instanceof SyntaxError)
                this.reporter.error({source: this.fileName, start: e.loc, end: e.loc}, e.message);
            else
                this.reporter.error(null, e.message);

            return null;
        }
    }
}
