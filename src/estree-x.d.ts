// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

// Decorate the standard ESTree nodes with additional properties from Acorn
// and further ones which we generate

declare module ESTree
{
    interface Node
    {
        start: number;
        end: number;
    }

    interface Statement
    {
        labels?: any[];
    }

    interface FunctionDeclaration
    {
        variable: any;
    }

    interface VariableDeclarator
    {
        variable: any;
    }
}
