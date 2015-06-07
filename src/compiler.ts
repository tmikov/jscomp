// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

import fs = require("fs");

import acorn = require("acorn/dist/acorn_csp");

import StringMap = require("../lib/StringMap");
import AssertionError = require("../lib/AssertionError");

function assert (cond: boolean, msg?: string): void
{
    if (!cond) {
        var message = "assertion failed:" + (msg ? msg : "");
        console.error(message);
        throw new AssertionError(message);
    }
}

export interface IErrorReporter
{
    error (loc: ESTree.SourceLocation, msg: string) : void;
    warning (loc: ESTree.SourceLocation, msg: string) : void;
}

export class Options
{
}

class NT<T extends ESTree.Node>
{
    constructor (public name: string) {}

    toString (): string { return this.name; }

    isTypeOf (node: ESTree.Node): T
    {
        return node && node.type === this.name ? <T>node : null;
    }

    cast (node: ESTree.Node): T
    {
        if (node && node.type === this.name)
            return <T>node;
        else
            throw new AssertionError(`node.type/${node.type}/ === ${this.name}`);
    }

    eq (node: ESTree.Node): boolean
    {
        return node && node.type === this.name;
    }

    static EmptyStatement = new NT<ESTree.EmptyStatement>("EmptyStatement");
    static BlockStatement = new NT<ESTree.BlockStatement>("BlockStatement");
    static ExpressionStatement = new NT<ESTree.ExpressionStatement>("ExpressionStatement");
    static IfStatement = new NT<ESTree.IfStatement>("IfStatement");
    static LabeledStatement = new NT<ESTree.LabeledStatement>("LabeledStatement");
    static BreakStatement = new NT<ESTree.BreakStatement>("BreakStatement");
    static ContinueStatement = new NT<ESTree.ContinueStatement>("ContinueStatement");
    static WithStatement = new NT<ESTree.WithStatement>("WithStatement");
    static SwitchStatement = new NT<ESTree.SwitchStatement>("SwitchStatement");
    static SwitchCase = new NT<ESTree.SwitchCase>("SwitchCase");
    static ReturnStatement = new NT<ESTree.ReturnStatement>("ReturnStatement");
    static ThrowStatement = new NT<ESTree.ThrowStatement>("ThrowStatement");
    static TryStatement = new NT<ESTree.TryStatement>("TryStatement");
    static CatchClause = new NT<ESTree.CatchClause>("CatchClause");
    static WhileStatement = new NT<ESTree.WhileStatement>("WhileStatement");
    static DoWhileStatement = new NT<ESTree.DoWhileStatement>("DoWhileStatement");
    static ForStatement = new NT<ESTree.ForStatement>("ForStatement");
    static ForInStatement = new NT<ESTree.ForInStatement>("ForInStatement");
    static DebuggerStatement = new NT<ESTree.DebuggerStatement>("DebuggerStatement");

    static FunctionDeclaration = new NT<ESTree.FunctionDeclaration>("FunctionDeclaration");
    static VariableDeclaration = new NT<ESTree.VariableDeclaration>("VariableDeclaration");
    static VariableDeclarator = new NT<ESTree.VariableDeclarator>("VariableDeclarator");

    static Literal = new NT<ESTree.Literal>("Literal");
    static Identifier = new NT<ESTree.Identifier>("Identifier");

    static ThisExpression = new NT<ESTree.ThisExpression>("ThisExpression");
    static ArrayExpression = new NT<ESTree.ArrayExpression>("ArrayExpression");
    static ObjectExpression = new NT<ESTree.ObjectExpression>("ObjectExpression");
    static Property = new NT<ESTree.Property>("Property");
    static FunctionExpression = new NT<ESTree.FunctionExpression>("FunctionExpression");
    static SequenceExpression = new NT<ESTree.SequenceExpression>("SequenceExpression");
    static UnaryExpression = new NT<ESTree.UnaryExpression>("UnaryExpression");
    static BinaryExpression = new NT<ESTree.BinaryExpression>("BinaryExpression");
    static AssignmentExpression = new NT<ESTree.AssignmentExpression>("AssignmentExpression");
    static UpdateExpression = new NT<ESTree.UpdateExpression>("UpdateExpression");
    static LogicalExpression = new NT<ESTree.LogicalExpression>("LogicalExpression");
    static ConditionalExpression = new NT<ESTree.ConditionalExpression>("ConditionalExpression");
    static CallExpression = new NT<ESTree.CallExpression>("CallExpression");
    static NewExpression = new NT<ESTree.NewExpression>("NewExpression");
    static MemberExpression = new NT<ESTree.MemberExpression>("MemberExpression");
}

class Variable
{
    name: string;
    declared: boolean;
    assigned: boolean;
    accessed: boolean;
    escapes: boolean;
    functionDeclaration: ESTree.FunctionDeclaration;

    constructor (name: string)
    {
        this.name = name;
        this.declared = false;
        this.assigned = false;
        this.accessed = false;
        this.escapes = false;
        this.functionDeclaration = null;
    }
}

class FunctionScope
{
    parent: FunctionScope;
    name: string;
    level: number;
    vars: StringMap<Variable>;

    constructor (parent: FunctionScope, name: string)
    {
        this.parent = parent;
        this.name = name || null;
        this.level = parent ? parent.level + 1 : 0;
        this.vars = new StringMap<Variable>();
    }

    lookup (name: string): Variable
    {
        var v: Variable;
        var scope = this;
        do {
            if (v = scope.vars.get(name))
                return v;
        } while (scope = scope.parent);
        return null;
    }
}

class Context
{
    parent: Context;
    scope: FunctionScope;
    strictMode: boolean;

    constructor (parent: Context, scope: FunctionScope)
    {
        this.parent = parent;
        this.scope = scope;
        this.strictMode = parent && parent.strictMode;
    }
}

export function compile (m_fileName: string, m_reporter: IErrorReporter, m_options: Options): boolean
{
    return compileIt();

    function logInfo (msg: string, loc?: ESTree.SourceLocation)
    {
        if (loc)
            console.info("info: %s:%s:%s: %s", m_fileName, loc.start.line, loc.start.column + 1, msg);
        else
            console.info("info: %s: %s", m_fileName, msg);
    }

    function error (loc: ESTree.SourceLocation, msg: string)
    {
        m_reporter.error(loc, msg);
    }

    function warning (loc: ESTree.SourceLocation, msg: string)
    {
        m_reporter.warning(loc, msg);
    }

    function compileIt (): boolean
    {
        var prog: ESTree.Program;
        if (!(prog = parse(m_fileName)))
            return false;
        compileProgram(prog);
        return true;
    }

    function location (node: ESTree.Node): ESTree.SourceLocation
    {
        return node.loc;
    }

    function parse (fileName: string): ESTree.Program
    {
        var options: acorn.Options = {
            ecmaVersion: 5,
            sourceType: "module",
            allowReserved: false,
            allowHashBang: true,
            locations: true,
            sourceFile: fileName
        };

        try {
            var content = fs.readFileSync(fileName, 'utf-8');
        } catch (e) {
            error(null, e.message);
            return null;
        }

        try {
            return acorn.parse(content, options);
        } catch (e) {
            if (e instanceof SyntaxError)
                error({source: m_fileName, start: e.loc, end: e.loc}, e.message);
            else
                error(null, e.message);

            return null;
        }
    }

    function matchStrictMode (stmt: ESTree.Statement): boolean
    {
        var es: ESTree.ExpressionStatement;
        var lit: ESTree.Literal;
        if (es = NT.ExpressionStatement.isTypeOf(stmt))
            if (lit = NT.Literal.isTypeOf(es.expression))
                if (lit.value === "use strict")
                    return true;
        return false;
    }

    function compileProgram (prog: ESTree.Program): void
    {
        var moduleContext = new Context(null, new FunctionScope(null, "<module>"));
        compileBody(moduleContext, prog.body);
    }

    function compileBody (ctx: Context, body: ESTree.Statement[]): void
    {
        var startIndex: number = 0;
        if (body.length && matchStrictMode(body[0])) {
            startIndex = 1;
            ctx.strictMode = true;
            logInfo("strict mode enabled", location(body[0]));
        }

        // Scan for declarations
        for (var i = startIndex, e = body.length; i < e; ++i)
            scanStatementForDeclarations(ctx, body[i]);

        logInfo(`variables in scope ${ctx.scope.name} level ${ctx.scope.level}:`);
        ctx.scope.vars.forEach((v: Variable) => {
            logInfo(`  ${v.name}: declared=${v.declared} function=${v.functionDeclaration && "yes" || "no"} assigned=${v.assigned}`);
        });
    }

    function declareVar (ctx: Context, ident: ESTree.Identifier): Variable
    {
        var scope = ctx.scope;
        var name = ident.name;
        var v: Variable;
        if (!(v = scope.vars.get(name)))
            scope.vars.set(name, v = new Variable(name));
        v.declared = true;
        return v;
    }

    function declareAssignedVar (ctx: Context, ident: ESTree.Identifier): void
    {
        var scope = ctx.scope;
        var name = ident.name;
        var v: Variable;
        if (!(v = scope.lookup(name)))
            scope.vars.set(name, v = new Variable(name));
        v.assigned = true;
    }

    function scanStatementForDeclarations (ctx: Context, stmt: ESTree.Statement): void
    {
        if (!stmt)
            return;
        switch (stmt.type) {
            case "BlockStatement":
                var blockStatement: ESTree.BlockStatement = NT.BlockStatement.cast(stmt);
                blockStatement.body.forEach((s: ESTree.Statement) => {
                    scanStatementForDeclarations(ctx, s);
                });
                break;
            case "ExpressionStatement":
                var expressionStatement: ESTree.ExpressionStatement = NT.ExpressionStatement.cast(stmt);
                scanExpressionForDeclarations(ctx, expressionStatement.expression);
                break;
            case "IfStatement":
                var ifStatement: ESTree.IfStatement = NT.IfStatement.cast(stmt);
                scanExpressionForDeclarations(ctx, ifStatement.test);
                if (ifStatement.consequent)
                    scanStatementForDeclarations(ctx, ifStatement.consequent);
                if (ifStatement.alternate)
                    scanStatementForDeclarations(ctx, ifStatement.alternate);
                break;
            case "LabeledStatement":
                var labeledStatement: ESTree.LabeledStatement = NT.LabeledStatement.cast(stmt);
                scanStatementForDeclarations(ctx, labeledStatement.body);
                break;
            case "WithStatement":
                var withStatement: ESTree.WithStatement = NT.WithStatement.cast(stmt);
                error(location(withStatement), "'with' is not supported");
                break;
            case "SwitchStatement":
                var switchStatement: ESTree.SwitchStatement = NT.SwitchStatement.cast(stmt);
                scanExpressionForDeclarations(ctx, switchStatement.discriminant);
                switchStatement.cases.forEach((sc: ESTree.SwitchCase) => {
                    if (sc.test)
                        scanExpressionForDeclarations(ctx, sc.test);
                    sc.consequent.forEach((s: ESTree.Statement) => {
                        scanStatementForDeclarations(ctx, s);
                    });
                });
                break;
            case "ReturnStatement":
                var returnStatement: ESTree.ReturnStatement = NT.ReturnStatement.cast(stmt);
                if (returnStatement.argument)
                    scanExpressionForDeclarations(ctx, returnStatement.argument);
                break;
            case "ThrowStatement":
                var throwStatement: ESTree.ThrowStatement = NT.ThrowStatement.cast(stmt);
                scanExpressionForDeclarations(ctx, throwStatement.argument);
                break;
            case "TryStatement":
                var tryStatement: ESTree.TryStatement = NT.TryStatement.cast(stmt);
                scanStatementForDeclarations(ctx, tryStatement.block);
                if (tryStatement.handler)
                    scanStatementForDeclarations(ctx, tryStatement.handler.body);
                if (tryStatement.finalizer)
                    scanStatementForDeclarations(ctx, tryStatement.finalizer);
                break;
            case "WhileStatement":
                var whileStatement: ESTree.WhileStatement = NT.WhileStatement.cast(stmt);
                scanExpressionForDeclarations(ctx, whileStatement.test);
                scanStatementForDeclarations(ctx, whileStatement.body);
                break;
            case "DoWhileStatement":
                var doWhileStatement: ESTree.DoWhileStatement = NT.DoWhileStatement.cast(stmt);
                scanExpressionForDeclarations(ctx, doWhileStatement.test);
                scanStatementForDeclarations(ctx, doWhileStatement.body);
                break;
            case "ForStatement":
                var forStatement: ESTree.ForStatement = NT.ForStatement.cast(stmt);
                var forStatementInitDecl: ESTree.VariableDeclaration;
                if (forStatement.init)
                    if (forStatementInitDecl = NT.VariableDeclaration.isTypeOf(forStatement.init))
                        scanStatementForDeclarations(ctx, forStatementInitDecl);
                    else
                        scanExpressionForDeclarations(ctx, forStatement.init);
                if (forStatement.test)
                    scanExpressionForDeclarations(ctx, forStatement.test);
                if (forStatement.update)
                    scanExpressionForDeclarations(ctx, forStatement.update);
                scanStatementForDeclarations(ctx, forStatement.body);
                break;
            case "ForInStatement":
                var forInStatement: ESTree.ForInStatement = NT.ForInStatement.cast(stmt);
                var forInStatementLeftDecl: ESTree.VariableDeclaration;
                if (forInStatementLeftDecl = NT.VariableDeclaration.isTypeOf(forInStatement.left))
                    scanStatementForDeclarations(ctx, forInStatementLeftDecl);
                else
                    scanExpressionForDeclarations(ctx, forInStatement.left);
                scanStatementForDeclarations(ctx, forInStatement.body);
                break;

            case "FunctionDeclaration":
                var functionDeclaration: ESTree.FunctionDeclaration = NT.FunctionDeclaration.cast(stmt);
                var variable = declareVar(ctx, functionDeclaration.id);

                if (variable.functionDeclaration)
                    warning( location(functionDeclaration),  `hiding previous declaration of function '${variable.name}'` );
                variable.functionDeclaration = functionDeclaration;
                break;
            case "VariableDeclaration":
                var variableDeclaration: ESTree.VariableDeclaration = NT.VariableDeclaration.cast(stmt);
                variableDeclaration.declarations.forEach((vd: ESTree.VariableDeclarator) => {
                    var variable = declareVar(ctx, NT.Identifier.cast(vd.id));
                    if (vd.init) {
                        variable.assigned = true;
                        scanExpressionForDeclarations(ctx, vd.init);
                    }
                });
                break;
        }
    }

    function scanExpressionForDeclarations (ctx: Context, e: ESTree.Expression)
    {
        if (!e)
            return;
        switch (e.type) {
            case "ArrayExpression":
                var arrayExpression: ESTree.ArrayExpression = NT.ArrayExpression.cast(e);
                arrayExpression.elements.forEach((elem) => {
                    if (elem && elem.type !== "SpreadElement")
                        scanExpressionForDeclarations(ctx, elem);
                });
                break;
            case "ObjectExpression":
                var objectExpression: ESTree.ObjectExpression = NT.ObjectExpression.cast(e);
                objectExpression.properties.forEach((prop: ESTree.Property) => {
                    scanExpressionForDeclarations(ctx, prop.value);
                });
                break;
            case "FunctionExpression":
                var functionExpression: ESTree.FunctionExpression = NT.FunctionExpression.cast(e);
                break;
            case "SequenceExpression":
                var sequenceExpression: ESTree.SequenceExpression = NT.SequenceExpression.cast(e);
                sequenceExpression.expressions.forEach((e: ESTree.Expression) => {
                    scanExpressionForDeclarations(ctx, e);
                });
                break;
            case "UnaryExpression":
                var unaryExpression: ESTree.UnaryExpression = NT.UnaryExpression.cast(e);
                scanExpressionForDeclarations(ctx, unaryExpression.argument);
                break;
            case "BinaryExpression":
                var binaryExpression: ESTree.BinaryExpression = NT.BinaryExpression.cast(e);
                scanExpressionForDeclarations(ctx, binaryExpression.left);
                scanExpressionForDeclarations(ctx, binaryExpression.right);
                break;
            case "AssignmentExpression":
                var assignmentExpression: ESTree.AssignmentExpression = NT.AssignmentExpression.cast(e);
                var assignmentIdentifier: ESTree.Identifier;
                if (assignmentIdentifier = NT.Identifier.isTypeOf(assignmentExpression.left)) {
                    if (assignmentExpression.operator === "=")
                        declareAssignedVar(ctx, assignmentIdentifier);
                } else {
                    scanExpressionForDeclarations(ctx, assignmentExpression.left);
                }
                scanExpressionForDeclarations(ctx, assignmentExpression.right);
                break;
            case "UpdateExpression":
                var updateExpression: ESTree.UpdateExpression = NT.UpdateExpression.cast(e);
                scanExpressionForDeclarations(ctx, updateExpression.argument);
                break;
            case "LogicalExpression":
                var logicalExpression: ESTree.LogicalExpression = NT.LogicalExpression.cast(e);
                scanExpressionForDeclarations(ctx, logicalExpression.left);
                scanExpressionForDeclarations(ctx, logicalExpression.right);
                break;
            case "ConditionalExpression":
                var conditionalExpression: ESTree.ConditionalExpression = NT.ConditionalExpression.cast(e);
                scanExpressionForDeclarations(ctx, conditionalExpression.test);
                scanExpressionForDeclarations(ctx, conditionalExpression.alternate);
                scanExpressionForDeclarations(ctx, conditionalExpression.consequent);
                break;
            case "CallExpression":
                var callExpression: ESTree.CallExpression = NT.CallExpression.cast(e);
                scanExpressionForDeclarations(ctx, callExpression.callee);
                callExpression.arguments.forEach((e: ESTree.Expression) => {
                    scanExpressionForDeclarations(ctx, e);
                });
                break;
            case "NewExpression":
                var newExpression: ESTree.NewExpression = NT.NewExpression.cast(e);
                scanExpressionForDeclarations(ctx, newExpression.callee);
                newExpression.arguments.forEach((e: ESTree.Expression) => {
                    scanExpressionForDeclarations(ctx, e);
                });
                break;
            case "MemberExpression":
                var memberExpression: ESTree.MemberExpression = NT.MemberExpression.cast(e);
                scanExpressionForDeclarations(ctx, memberExpression.object);
                if (memberExpression.computed)
                    scanExpressionForDeclarations(ctx, memberExpression.property);
                break;
        }
    }
}
