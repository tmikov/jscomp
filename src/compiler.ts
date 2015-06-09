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

interface AcornNode extends ESTree.Node
{
    start: number;
    end: number;
}

export interface IErrorReporter
{
    error (loc: ESTree.SourceLocation, msg: string) : void;
    warning (loc: ESTree.SourceLocation, msg: string) : void;
    note (loc: ESTree.SourceLocation, msg: string) : void;
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
    static ForOfStatement = new NT<ESTree.ForOfStatement>("ForOfStatement");
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
    ctx: FunctionContext;
    name: string;
    declared: boolean = false;
    assigned: boolean = false;
    accessed: boolean = false;
    escapes: boolean = false;
    functionDeclaration: ESTree.FunctionDeclaration = null;

    constructor (ctx: FunctionContext, name: string)
    {
        this.ctx = ctx;
        this.name = name;
    }
}

class Scope
{
    ctx: FunctionContext;
    parent: Scope;
    level: number;
    vars: StringMap<Variable>;

    constructor (ctx: FunctionContext, parent: Scope)
    {
        this.ctx = ctx;
        this.parent = parent;
        this.level = parent ? parent.level + 1 : 0;
        this.vars = new StringMap<Variable>();
    }

    newVariable (name: string): Variable
    {
        var variable = new Variable(this.ctx, name);
        this.vars.set(name, variable);
        return variable;
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

enum LabelKind
{
    LOOP,
    SWITCH,
    OTHER,
}

class Label
{
    prev: Label = null;
    constructor (
        public name: string, public loc: ESTree.SourceLocation, public kind: LabelKind, public stmt: ESTree.Statement
    )
    {}
}

class FunctionContext
{
    parent: FunctionContext;
    name: string;
    strictMode: boolean;

    funcScope: Scope;

    labelList: Label = null;
    labels = new StringMap<Label>();

    constructor (parent: FunctionContext, parentScope: Scope, name: string)
    {
        this.parent = parent;
        this.name = name || null;
        this.strictMode = parent && parent.strictMode;

        this.funcScope = new Scope(this, parentScope);
    }

    findLabel (name: string): Label
    {
        return this.labels.get(name);
    }

    findAnonLabel (loopOnly: boolean): Label
    {
        for ( var label = this.labelList; label; label = label.prev ) {
            if (label.kind === LabelKind.LOOP || !loopOnly && label.kind === LabelKind.SWITCH)
                return label;
        }
        return null;
    }

    pushLabel (label: Label): void
    {
        if (label.name)
            this.labels.set(label.name,label);
        label.prev = this.labelList;
        this.labelList = label;
    }

    popLabel (): void
    {
        var label = this.labelList;
        if (label.name)
            this.labels.remove(label.name);
        this.labelList = label.prev;
        label.prev = null; // Facilitate GC
    }
}

export function compile (m_fileName: string, m_reporter: IErrorReporter, m_options: Options): boolean
{
    var m_globalContext: FunctionContext;
    var m_input: string;

    return compileIt();

    function error (loc: ESTree.SourceLocation, msg: string)
    {
        m_reporter.error(loc, msg);
    }

    function warning (loc: ESTree.SourceLocation, msg: string)
    {
        m_reporter.warning(loc, msg);
    }

    function note (loc: ESTree.SourceLocation, msg: string)
    {
        m_reporter.note(loc, msg);
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
        if (!node.loc) {
            var pos = acorn.getLineInfo(m_input, (<AcornNode>node).start);
            return { source: m_fileName, start: pos, end: pos };
        } else {
            return node.loc;
        }
    }

    function parse (fileName: string): ESTree.Program
    {
        var options: acorn.Options = {
            ecmaVersion: 5,
            sourceType: "module",
            allowReserved: false,
            allowHashBang: true,
            locations: false,
        };

        try {
            m_input = fs.readFileSync(fileName, 'utf-8');
        } catch (e) {
            error(null, e.message);
            return null;
        }

        try {
            return acorn.parse(m_input, options);
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

    function classifyLabelStatement (stmt: ESTree.Statement): LabelKind
    {
        switch (stmt.type) {
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ForInStatement":
            case "ForOfStatement":
                return LabelKind.LOOP;
            case "Switch":
                return LabelKind.SWITCH;
            default:
                return LabelKind.OTHER;
        }
    }

    function compileProgram (prog: ESTree.Program): void
    {
        m_globalContext = new FunctionContext(null, null, "<module>");
        compileBody(m_globalContext.funcScope, prog.body);
    }

    function compileBody (scope: Scope, body: ESTree.Statement[]): void
    {
        var startIndex: number = 0;
        if (body.length && matchStrictMode(body[0])) {
            startIndex = 1;
            scope.ctx.strictMode = true;
            note(location(body[0]), "strict mode enabled");
        }

        // Scan for declarations
        for (var i = startIndex, e = body.length; i < e; ++i)
            scanStatementForDeclarations(scope, body[i]);

        // Bind
        for (var i = startIndex, e = body.length; i < e; ++i)
            bindStatement(scope, body[i], null);
    }

    /**
     * Declare a variable at the function-level scope with letrec semantics.
     * @param ctx
     * @param ident
     * @returns {Variable}
     */
    function varDeclaration (ctx: FunctionContext, ident: ESTree.Identifier): Variable
    {
        var scope = ctx.funcScope;
        var name = ident.name;
        var v: Variable;
        if (!(v = scope.vars.get(name)))
            v = scope.newVariable(name);
        v.declared = true;
        return v;
    }

    function scanStatementForDeclarations (scope: Scope, stmt: ESTree.Statement): void
    {
        if (!stmt)
            return;
        switch (stmt.type) {
            case "BlockStatement":
                var blockStatement: ESTree.BlockStatement = NT.BlockStatement.cast(stmt);
                blockStatement.body.forEach((s: ESTree.Statement) => {
                    scanStatementForDeclarations(scope, s);
                });
                break;
                break;
            case "IfStatement":
                var ifStatement: ESTree.IfStatement = NT.IfStatement.cast(stmt);
                if (ifStatement.consequent)
                    scanStatementForDeclarations(scope, ifStatement.consequent);
                if (ifStatement.alternate)
                    scanStatementForDeclarations(scope, ifStatement.alternate);
                break;
            case "LabeledStatement":
                var labeledStatement: ESTree.LabeledStatement = NT.LabeledStatement.cast(stmt);
                scanStatementForDeclarations(scope, labeledStatement.body);
                break;
            case "WithStatement":
                var withStatement: ESTree.WithStatement = NT.WithStatement.cast(stmt);
                scanStatementForDeclarations(scope, withStatement.body);
                break;
            case "SwitchStatement":
                var switchStatement: ESTree.SwitchStatement = NT.SwitchStatement.cast(stmt);
                switchStatement.cases.forEach((sc: ESTree.SwitchCase) => {
                    sc.consequent.forEach((s: ESTree.Statement) => {
                        scanStatementForDeclarations(scope, s);
                    });
                });
                break;
            case "TryStatement":
                var tryStatement: ESTree.TryStatement = NT.TryStatement.cast(stmt);
                scanStatementForDeclarations(scope, tryStatement.block);
                if (tryStatement.handler)
                    scanStatementForDeclarations(scope, tryStatement.handler.body);
                if (tryStatement.finalizer)
                    scanStatementForDeclarations(scope, tryStatement.finalizer);
                break;
            case "WhileStatement":
                var whileStatement: ESTree.WhileStatement = NT.WhileStatement.cast(stmt);
                scope.ctx.pushLabel(new Label(null, location(whileStatement), LabelKind.LOOP, whileStatement));
                scanStatementForDeclarations(scope, whileStatement.body);
                scope.ctx.popLabel();
                break;
            case "DoWhileStatement":
                var doWhileStatement: ESTree.DoWhileStatement = NT.DoWhileStatement.cast(stmt);
                scanStatementForDeclarations(scope, doWhileStatement.body);
                break;
            case "ForStatement":
                var forStatement: ESTree.ForStatement = NT.ForStatement.cast(stmt);
                var forStatementInitDecl: ESTree.VariableDeclaration;
                if (forStatement.init)
                    if (forStatementInitDecl = NT.VariableDeclaration.isTypeOf(forStatement.init))
                        scanStatementForDeclarations(scope, forStatementInitDecl);
                scanStatementForDeclarations(scope, forStatement.body);
                break;
            case "ForInStatement":
                var forInStatement: ESTree.ForInStatement = NT.ForInStatement.cast(stmt);
                var forInStatementLeftDecl: ESTree.VariableDeclaration;
                if (forInStatementLeftDecl = NT.VariableDeclaration.isTypeOf(forInStatement.left))
                    scanStatementForDeclarations(scope, forInStatementLeftDecl);
                scanStatementForDeclarations(scope, forInStatement.body);
                break;
            case "ForOfStatement":
                var forOfStatement: ESTree.ForOfStatement = NT.ForOfStatement.cast(stmt);
                var forOfStatementLeftDecl: ESTree.VariableDeclaration;
                if (forOfStatementLeftDecl = NT.VariableDeclaration.isTypeOf(forOfStatement.left))
                    scanStatementForDeclarations(scope, forOfStatementLeftDecl);
                scanStatementForDeclarations(scope, forOfStatement.body);
                break;

            case "FunctionDeclaration":
                var functionDeclaration: ESTree.FunctionDeclaration = NT.FunctionDeclaration.cast(stmt);
                varDeclaration(scope.ctx, functionDeclaration.id);
                break;
            case "VariableDeclaration":
                var variableDeclaration: ESTree.VariableDeclaration = NT.VariableDeclaration.cast(stmt);
                variableDeclaration.declarations.forEach((vd: ESTree.VariableDeclarator) => {
                    varDeclaration(scope.ctx, NT.Identifier.cast(vd.id));
                });
                break;
        }
    }

    function bindStatement (scope: Scope, stmt: ESTree.Statement, parent: ESTree.Node): void
    {
        if (!stmt)
            return;
        switch (stmt.type) {
            case "BlockStatement":
                var blockStatement: ESTree.BlockStatement = NT.BlockStatement.cast(stmt);
                blockStatement.body.forEach((s: ESTree.Statement) => {
                    bindStatement(scope, s, stmt);
                });
                break;
            case "ExpressionStatement":
                var expressionStatement: ESTree.ExpressionStatement = NT.ExpressionStatement.cast(stmt);
                bindExpression(scope, expressionStatement.expression);
                break;
            case "IfStatement":
                var ifStatement: ESTree.IfStatement = NT.IfStatement.cast(stmt);
                bindExpression(scope, ifStatement.test);
                if (ifStatement.consequent)
                    bindStatement(scope, ifStatement.consequent, stmt);
                if (ifStatement.alternate)
                    bindStatement(scope, ifStatement.alternate, stmt);
                break;
            case "LabeledStatement":
                var labeledStatement: ESTree.LabeledStatement = NT.LabeledStatement.cast(stmt);
                var prevLabel: Label;
                var loc = location(stmt);
                var pushed = false;
                if (prevLabel = scope.ctx.findLabel(labeledStatement.label.name)) {
                    error(loc, `label '${prevLabel.name}' already declared`);
                    note(prevLabel.loc, `previous declaration of label '${prevLabel.name}'`);
                } else {
                    scope.ctx.pushLabel(new Label(labeledStatement.label.name, loc, classifyLabelStatement(labeledStatement.body),
                        labeledStatement.body));
                    pushed = true;
                }
                bindStatement(scope, labeledStatement.body, stmt);
                if (pushed)
                    scope.ctx.popLabel();
                break;
            case "BreakStatement":
                var breakStatement: ESTree.BreakStatement = NT.BreakStatement.cast(stmt);
                var label: Label = null;
                if (breakStatement.label) {
                    if (!(label = scope.ctx.findLabel(breakStatement.label.name)))
                        error(location(stmt), `label '${breakStatement.label.name}:' is not defined`);
                } else {
                    if (!(label = scope.ctx.findAnonLabel(false)))
                        error(location(stmt), "there is no surrounding loop");
                }
                (<any>breakStatement).boundLabel = label;
                break;
            case "ContinueStatement":
                var continueStatement: ESTree.ContinueStatement = NT.ContinueStatement.cast(stmt);
                var label: Label = null;
                if (continueStatement.label) {
                    if (!(label = scope.ctx.findLabel(continueStatement.label.name)))
                        error(location(stmt), `label '${continueStatement.label.name}:' is not defined`);
                    else if (label.kind !== LabelKind.LOOP) {
                        error(location(stmt), `label '${continueStatement.label.name}:' is not a loop`);
                        note(label.loc, `label '${continueStatement.label.name}:' defined here`);
                        label = null;
                    }
                } else {
                    if (!(label = scope.ctx.findAnonLabel(true)))
                        error(location(stmt), "there is no surrounding loop");
                }
                (<any>continueStatement).boundLabel = label;
                break;
            case "WithStatement":
                var withStatement: ESTree.WithStatement = NT.WithStatement.cast(stmt);
                error(location(withStatement), "'with' is not supported");
                break;
            case "SwitchStatement":
                var switchStatement: ESTree.SwitchStatement = NT.SwitchStatement.cast(stmt);
                bindExpression(scope, switchStatement.discriminant);
                scope.ctx.pushLabel(new Label(null, location(switchStatement), LabelKind.SWITCH, switchStatement));
                switchStatement.cases.forEach((sc: ESTree.SwitchCase) => {
                    if (sc.test)
                        bindExpression(scope, sc.test);
                    sc.consequent.forEach((s: ESTree.Statement) => {
                        bindStatement(scope, s, stmt);
                    });
                });
                scope.ctx.popLabel();
                break;
            case "ReturnStatement":
                var returnStatement: ESTree.ReturnStatement = NT.ReturnStatement.cast(stmt);
                if (returnStatement.argument)
                    bindExpression(scope, returnStatement.argument);
                break;
            case "ThrowStatement":
                var throwStatement: ESTree.ThrowStatement = NT.ThrowStatement.cast(stmt);
                bindExpression(scope, throwStatement.argument);
                break;
            case "TryStatement":
                var tryStatement: ESTree.TryStatement = NT.TryStatement.cast(stmt);
                bindStatement(scope, tryStatement.block, stmt);
                if (tryStatement.handler) {
                    var catchIdent: ESTree.Identifier = NT.Identifier.cast(tryStatement.handler.param);
                    assert( !tryStatement.handler.guard, "catch guards not supported in ES5");

                    var catchScope = new Scope(scope.ctx, scope);
                    catchScope.newVariable(catchIdent.name).declared = true;
                    bindStatement(catchScope, tryStatement.handler.body, stmt);
                }
                if (tryStatement.finalizer)
                    bindStatement(scope, tryStatement.finalizer, stmt);
                break;
            case "WhileStatement":
                var whileStatement: ESTree.WhileStatement = NT.WhileStatement.cast(stmt);
                bindExpression(scope, whileStatement.test);
                scope.ctx.pushLabel(new Label(null, location(whileStatement), LabelKind.LOOP, whileStatement));
                bindStatement(scope, whileStatement.body, stmt);
                scope.ctx.popLabel();
                break;
            case "DoWhileStatement":
                var doWhileStatement: ESTree.DoWhileStatement = NT.DoWhileStatement.cast(stmt);
                bindExpression(scope, doWhileStatement.test);
                scope.ctx.pushLabel(new Label(null, location(doWhileStatement), LabelKind.LOOP, doWhileStatement));
                bindStatement(scope, doWhileStatement.body, stmt);
                scope.ctx.popLabel();
                break;
            case "ForStatement":
                var forStatement: ESTree.ForStatement = NT.ForStatement.cast(stmt);
                var forStatementInitDecl: ESTree.VariableDeclaration;
                if (forStatement.init)
                    if (forStatementInitDecl = NT.VariableDeclaration.isTypeOf(forStatement.init))
                        bindStatement(scope, forStatementInitDecl, stmt);
                    else
                        bindExpression(scope, forStatement.init);
                if (forStatement.test)
                    bindExpression(scope, forStatement.test);
                if (forStatement.update)
                    bindExpression(scope, forStatement.update);
                scope.ctx.pushLabel(new Label(null, location(forStatement), LabelKind.LOOP, forStatement));
                bindStatement(scope, forStatement.body, stmt);
                scope.ctx.popLabel();
                break;
            case "ForInStatement":
                var forInStatement: ESTree.ForInStatement = NT.ForInStatement.cast(stmt);
                var forInStatementLeftDecl: ESTree.VariableDeclaration;
                if (forInStatementLeftDecl = NT.VariableDeclaration.isTypeOf(forInStatement.left))
                    bindStatement(scope, forInStatementLeftDecl, stmt);
                else
                    bindExpression(scope, forInStatement.left);
                scope.ctx.pushLabel(new Label(null, location(forInStatement), LabelKind.LOOP, forInStatement));
                bindStatement(scope, forInStatement.body, stmt);
                scope.ctx.popLabel();
                break;
            case "ForOfStatement":
                var forOfStatement: ESTree.ForOfStatement = NT.ForOfStatement.cast(stmt);
                var forOfStatementLeftDecl: ESTree.VariableDeclaration;
                if (forOfStatementLeftDecl = NT.VariableDeclaration.isTypeOf(forOfStatement.left))
                    bindStatement(scope, forOfStatementLeftDecl, stmt);
                else
                    bindExpression(scope, forOfStatement.left);
                scope.ctx.pushLabel(new Label(null, location(forOfStatement), LabelKind.LOOP, forOfStatement));
                bindStatement(scope, forOfStatement.body, stmt);
                scope.ctx.popLabel();
                break;

            case "FunctionDeclaration":
                var functionDeclaration: ESTree.FunctionDeclaration = NT.FunctionDeclaration.cast(stmt);
                var variable = scope.ctx.funcScope.lookup(functionDeclaration.id.name);

                if (scope.ctx.strictMode && parent)
                    error(location(functionDeclaration), "functions can only be declared at top level in strict mode");

                if (variable.functionDeclaration)
                    warning( location(functionDeclaration),  `hiding previous declaration of function '${variable.name}'` );

                variable.functionDeclaration = functionDeclaration;
                bindFunction(scope, functionDeclaration);
                break;
            case "VariableDeclaration":
                var variableDeclaration: ESTree.VariableDeclaration = NT.VariableDeclaration.cast(stmt);
                variableDeclaration.declarations.forEach((vd: ESTree.VariableDeclarator) => {
                    if (vd.init)
                        bindExpression(scope, vd.init);
                });
                break;
            default:
                assert(false, `unsupported statement '${stmt.type}'`);
                break;
        }
    }

    function bindExpression (scope: Scope, e: ESTree.Expression)
    {
        if (!e)
            return;
        switch (e.type) {
            case "Literal":
                var literal: ESTree.Literal = NT.Literal.cast(e);
                break;
            case "Identifier":
                var identifier: ESTree.Identifier = NT.Identifier.cast(e);
                var variable: Variable = scope.lookup(identifier.name);
                if (!variable) {
                    if (scope.ctx.strictMode) {
                        error(location(e), `undefined identifier '${identifier.name}'`);
                        // Declare a dummy variable at function level to decrease noise
                        variable = scope.ctx.funcScope.newVariable(identifier.name);
                    } else {
                        warning(location(e), `undefined identifier '${identifier.name}'`);
                        variable = m_globalContext.funcScope.newVariable(identifier.name);
                    }
                } else if (!scope.ctx.strictMode && !variable.declared) {
                    warning(location(e), `undefined identifier '${identifier.name}'`);
                }
                // If the current function context is not where the variable was declared, then it escapes
                if (variable.ctx !== scope.ctx)
                    variable.escapes = true;
                break;
            case "ThisExpression":
                var thisExpression: ESTree.ThisExpression = NT.ThisExpression.cast(e);
                break;
            case "ArrayExpression":
                var arrayExpression: ESTree.ArrayExpression = NT.ArrayExpression.cast(e);
                arrayExpression.elements.forEach((elem) => {
                    if (elem && elem.type !== "SpreadElement")
                        bindExpression(scope, elem);
                });
                break;
            case "ObjectExpression":
                var objectExpression: ESTree.ObjectExpression = NT.ObjectExpression.cast(e);
                objectExpression.properties.forEach((prop: ESTree.Property) => {
                    bindExpression(scope, prop.value);
                });
                break;
            case "FunctionExpression":
                var functionExpression: ESTree.FunctionExpression = NT.FunctionExpression.cast(e);
                bindFunction(scope, functionExpression);
                break;
            case "SequenceExpression":
                var sequenceExpression: ESTree.SequenceExpression = NT.SequenceExpression.cast(e);
                sequenceExpression.expressions.forEach((e: ESTree.Expression) => {
                    bindExpression(scope, e);
                });
                break;
            case "UnaryExpression":
                var unaryExpression: ESTree.UnaryExpression = NT.UnaryExpression.cast(e);
                bindExpression(scope, unaryExpression.argument);
                break;
            case "BinaryExpression":
                var binaryExpression: ESTree.BinaryExpression = NT.BinaryExpression.cast(e);
                bindExpression(scope, binaryExpression.left);
                bindExpression(scope, binaryExpression.right);
                break;
            case "AssignmentExpression":
                var assignmentExpression: ESTree.AssignmentExpression = NT.AssignmentExpression.cast(e);
                var assignmentIdentifier: ESTree.Identifier;
                if (assignmentIdentifier = NT.Identifier.isTypeOf(assignmentExpression.left)) {
                    bindExpression(scope, assignmentExpression.left);
                } else {
                    bindExpression(scope, assignmentExpression.left);
                }
                bindExpression(scope, assignmentExpression.right);
                break;
            case "UpdateExpression":
                var updateExpression: ESTree.UpdateExpression = NT.UpdateExpression.cast(e);
                bindExpression(scope, updateExpression.argument);
                break;
            case "LogicalExpression":
                var logicalExpression: ESTree.LogicalExpression = NT.LogicalExpression.cast(e);
                bindExpression(scope, logicalExpression.left);
                bindExpression(scope, logicalExpression.right);
                break;
            case "ConditionalExpression":
                var conditionalExpression: ESTree.ConditionalExpression = NT.ConditionalExpression.cast(e);
                bindExpression(scope, conditionalExpression.test);
                bindExpression(scope, conditionalExpression.alternate);
                bindExpression(scope, conditionalExpression.consequent);
                break;
            case "CallExpression":
                var callExpression: ESTree.CallExpression = NT.CallExpression.cast(e);
                bindExpression(scope, callExpression.callee);
                callExpression.arguments.forEach((e: ESTree.Expression) => {
                    bindExpression(scope, e);
                });
                break;
            case "NewExpression":
                var newExpression: ESTree.NewExpression = NT.NewExpression.cast(e);
                bindExpression(scope, newExpression.callee);
                newExpression.arguments.forEach((e: ESTree.Expression) => {
                    bindExpression(scope, e);
                });
                break;
            case "MemberExpression":
                var memberExpression: ESTree.MemberExpression = NT.MemberExpression.cast(e);
                bindExpression(scope, memberExpression.object);
                if (memberExpression.computed)
                    bindExpression(scope, memberExpression.property);
                break;
            default:
                assert(false, `unsupported expression '${e.type}'`);
                break;
        }
    }

    function bindFunction (parentScope: Scope, ast: ESTree.Function): void
    {
        var funcCtx = new FunctionContext(parentScope.ctx, parentScope, ast.id && ast.id.name);
        var funcScope = funcCtx.funcScope;

        // Declare the parameters
        ast.params.forEach( (pat: ESTree.Pattern): void => {
            var ident = NT.Identifier.cast(pat);
            if (funcScope.vars.get(ident.name))
                (funcCtx.strictMode ? error : warning)(location(ident), `parameter '${ident.name}' already declared`);
            else
                varDeclaration(funcCtx, ident);
        });

        var bodyBlock: ESTree.BlockStatement;
        if (bodyBlock = NT.BlockStatement.isTypeOf(ast.body))
            compileBody(funcScope, bodyBlock.body);
        else
            assert(false, "TODO: implement ES6");
    }

}
