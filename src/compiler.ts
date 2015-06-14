// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./estree-x.d.ts" />

import fs = require("fs");
import assert = require("assert");

import acorn = require("acorn/dist/acorn_csp");

import StringMap = require("../lib/StringMap");
import AssertionError = require("../lib/AssertionError");

import hir = require("./hir");

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
    initialized: boolean = false; //< function declarations and built-in values like 'this'
    assigned: boolean = false;
    accessed: boolean = false;
    escapes: boolean = false;
    functionDeclaration: ESTree.FunctionDeclaration;

    hparam: hir.Param = null;
    hvar: hir.Var = null;

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
        variable.hvar = this.ctx.builder.newVar(name);
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

const enum LabelKind
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
    thisParam: hir.Param;
    argumentsVar: Variable;

    labelList: Label = null;
    labels = new StringMap<Label>();

    builder: hir.FunctionBuilder = null;

    temporaries: hir.Local[] = [];

    constructor (parent: FunctionContext, parentScope: Scope, name: string, moduleBuilder: hir.ModuleBuilder)
    {
        this.parent = parent;
        this.name = name || null;
        this.strictMode = parent && parent.strictMode;

        this.builder = moduleBuilder.newFunction(name);
        this.funcScope = new Scope(this, parentScope);

        // Generate a param binding for 'this'
        this.thisParam = this.builder.newParam("this");

        this.argumentsVar = this.funcScope.newVariable("arguments");
        this.argumentsVar.declared = true;
        this.argumentsVar.initialized = true;
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

    public allocTemp (): hir.Local
    {
        if (!this.temporaries.length)
        {
            var t = this.builder.newLocal();
            t.isTemp = true;
            this.temporaries.push(t );
        }
        var tmp = this.temporaries.pop();
        //console.log(`allocTemp = ${tmp.id}`);
        return tmp;
    }

    public allocSpecific (t: hir.Local): void
    {
        assert(t.isTemp);
        for ( var i = this.temporaries.length - 1; i >= 0; --i )
            if (this.temporaries[i] === t) {
                //console.log(`allocSpecific = ${t.id}`);
                this.temporaries.splice(i, 1);
                return;
            }
        assert(false, "specific temporary is not available");
        return null;
    }

    public releaseTemp (t: hir.RValue ): void
    {
        var l: hir.Local;
        if (l = hir.isTempLocal(t)) {
            //console.log(`releaseTemp ${l.id}`);
            this.temporaries.push(l);
        }
    }
}

// NOTE: since we have a very dumb backend (for now), we have to perform some optimizations
// that wouldn't normally be necessary
export function compile (m_fileName: string, m_reporter: IErrorReporter, m_options: Options): boolean
{
    var m_globalContext: FunctionContext;
    var m_input: string;
    var m_moduleBuilder = new hir.ModuleBuilder();

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
            var pos = acorn.getLineInfo(m_input, node.start);
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
        m_globalContext = new FunctionContext(null, null, "<module>", m_moduleBuilder);
        var ast: ESTree.Function = {
            start: prog.start,
            end: prog.end,
            type: "Function",
            params: [],
            body: { start: prog.start, end: prog.end, type: NT.BlockStatement.name, body: prog.body },
            generator: false
        };
        compileFunction(m_globalContext.funcScope, ast);
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

    function compileFunction (parentScope: Scope, ast: ESTree.Function): void
    {
        var funcCtx = new FunctionContext(parentScope.ctx, parentScope, ast.id && ast.id.name, m_moduleBuilder);
        var funcScope = funcCtx.funcScope;

        // Declare the parameters
        // Create a HIR param+var binding for each of them
        ast.params.forEach( (pat: ESTree.Pattern): void => {
            var ident = NT.Identifier.cast(pat);

            var param = funcCtx.builder.newParam(ident.name);
            var v: Variable;

            if (v = funcScope.vars.get(ident.name)) {
                (funcCtx.strictMode ? error : warning)(location(ident), `parameter '${ident.name}' already declared`);
            } else {
                v = varDeclaration(funcCtx, ident);
            }

            v.hparam = param;
        });

        var bodyBlock: ESTree.BlockStatement;
        if (bodyBlock = NT.BlockStatement.isTypeOf(ast.body))
            compileBody(funcScope, bodyBlock.body);
        else
            assert(false, "TODO: implement ES6");

        funcCtx.builder.log();
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
            compileStatement(scope, body[i], null);
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
                    var variable = varDeclaration(scope.ctx, NT.Identifier.cast(vd.id));
                    if (!variable.hvar)
                        variable.hvar = scope.ctx.builder.newVar(variable.name);
                });
                break;
        }
    }

    function compileStatement (scope: Scope, stmt: ESTree.Statement, parent: ESTree.Node): void
    {
        if (!stmt)
            return;
        switch (stmt.type) {
            case "BlockStatement":
                var blockStatement: ESTree.BlockStatement = NT.BlockStatement.cast(stmt);
                blockStatement.body.forEach((s: ESTree.Statement) => {
                    compileStatement(scope, s, stmt);
                });
                break;
            case "ExpressionStatement":
                var expressionStatement: ESTree.ExpressionStatement = NT.ExpressionStatement.cast(stmt);
                compileExpression(scope, expressionStatement.expression);
                break;
            case "IfStatement":
                compileIfStatement(scope, NT.IfStatement.cast(stmt));
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
                compileStatement(scope, labeledStatement.body, stmt);
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
                compileExpression(scope, switchStatement.discriminant);
                scope.ctx.pushLabel(new Label(null, location(switchStatement), LabelKind.SWITCH, switchStatement));
                switchStatement.cases.forEach((sc: ESTree.SwitchCase) => {
                    if (sc.test)
                        compileExpression(scope, sc.test);
                    sc.consequent.forEach((s: ESTree.Statement) => {
                        compileStatement(scope, s, stmt);
                    });
                });
                scope.ctx.popLabel();
                break;
            case "ReturnStatement":
                compileReturnStatement(scope, NT.ReturnStatement.cast(stmt));
                break;
            case "ThrowStatement":
                var throwStatement: ESTree.ThrowStatement = NT.ThrowStatement.cast(stmt);
                compileExpression(scope, throwStatement.argument);
                break;
            case "TryStatement":
                var tryStatement: ESTree.TryStatement = NT.TryStatement.cast(stmt);
                compileStatement(scope, tryStatement.block, stmt);
                if (tryStatement.handler) {
                    var catchIdent: ESTree.Identifier = NT.Identifier.cast(tryStatement.handler.param);
                    assert( !tryStatement.handler.guard, "catch guards not supported in ES5");

                    var catchScope = new Scope(scope.ctx, scope);
                    var catchVar = catchScope.newVariable(catchIdent.name);
                    catchVar.declared = true;
                    catchVar.initialized = true;
                    compileStatement(catchScope, tryStatement.handler.body, stmt);
                }
                if (tryStatement.finalizer)
                    compileStatement(scope, tryStatement.finalizer, stmt);
                break;
            case "WhileStatement":
                compileWhileStatement(scope, NT.WhileStatement.cast(stmt));
                break;
            case "DoWhileStatement":
                compileDoWhileStatement(scope, NT.DoWhileStatement.cast(stmt));
                break;
            case "ForStatement":
                var forStatement: ESTree.ForStatement = NT.ForStatement.cast(stmt);
                var forStatementInitDecl: ESTree.VariableDeclaration;
                if (forStatement.init)
                    if (forStatementInitDecl = NT.VariableDeclaration.isTypeOf(forStatement.init))
                        compileStatement(scope, forStatementInitDecl, stmt);
                    else
                        compileExpression(scope, forStatement.init);
                if (forStatement.test)
                    compileExpression(scope, forStatement.test);
                if (forStatement.update)
                    compileExpression(scope, forStatement.update);
                scope.ctx.pushLabel(new Label(null, location(forStatement), LabelKind.LOOP, forStatement));
                compileStatement(scope, forStatement.body, stmt);
                scope.ctx.popLabel();
                break;
            case "ForInStatement":
                var forInStatement: ESTree.ForInStatement = NT.ForInStatement.cast(stmt);
                var forInStatementLeftDecl: ESTree.VariableDeclaration;
                if (forInStatementLeftDecl = NT.VariableDeclaration.isTypeOf(forInStatement.left))
                    compileStatement(scope, forInStatementLeftDecl, stmt);
                else
                    compileExpression(scope, forInStatement.left);
                scope.ctx.pushLabel(new Label(null, location(forInStatement), LabelKind.LOOP, forInStatement));
                compileStatement(scope, forInStatement.body, stmt);
                scope.ctx.popLabel();
                break;
            case "ForOfStatement":
                var forOfStatement: ESTree.ForOfStatement = NT.ForOfStatement.cast(stmt);
                var forOfStatementLeftDecl: ESTree.VariableDeclaration;
                if (forOfStatementLeftDecl = NT.VariableDeclaration.isTypeOf(forOfStatement.left))
                    compileStatement(scope, forOfStatementLeftDecl, stmt);
                else
                    compileExpression(scope, forOfStatement.left);
                scope.ctx.pushLabel(new Label(null, location(forOfStatement), LabelKind.LOOP, forOfStatement));
                compileStatement(scope, forOfStatement.body, stmt);
                scope.ctx.popLabel();
                break;

            case "FunctionDeclaration":
                var functionDeclaration: ESTree.FunctionDeclaration = NT.FunctionDeclaration.cast(stmt);
                var variable = scope.ctx.funcScope.lookup(functionDeclaration.id.name);

                if (scope.ctx.strictMode && parent)
                    error(location(functionDeclaration), "functions can only be declared at top level in strict mode");

                if (variable.functionDeclaration)
                    warning( location(functionDeclaration),  `hiding previous declaration of function '${variable.name}'` );

                variable.initialized = true;
                variable.functionDeclaration = functionDeclaration;
                compileFunction(scope, functionDeclaration);
                break;
            case "VariableDeclaration":
                var variableDeclaration: ESTree.VariableDeclaration = NT.VariableDeclaration.cast(stmt);
                variableDeclaration.declarations.forEach((vd: ESTree.VariableDeclarator) => {
                    if (vd.init) {
                        var identifier = NT.Identifier.cast(vd.id);
                        scope.lookup(identifier.name).assigned = true;
                        compileExpression(scope, vd.init);
                    }
                });
                break;
            default:
                assert(false, `unsupported statement '${stmt.type}'`);
                break;
        }
    }

    function compileIfStatement (scope: Scope, ifStatement: ESTree.IfStatement): void
    {
        var thenLabel: hir.Label = scope.ctx.builder.newLabel();
        var elseLabel: hir.Label = scope.ctx.builder.newLabel();
        var endLabel: hir.Label = null;

        if (ifStatement.alternate)
            endLabel = scope.ctx.builder.newLabel();

        compileExpression(scope, ifStatement.test, true, thenLabel, elseLabel);

        scope.ctx.builder.genLabel(thenLabel);
        compileStatement(scope, ifStatement.consequent, ifStatement);
        if (ifStatement.alternate)
            scope.ctx.builder.genGoto(endLabel);

        scope.ctx.builder.genLabel(elseLabel);
        if (ifStatement.alternate) {
            compileStatement(scope, ifStatement.alternate, ifStatement);
            scope.ctx.builder.genLabel(endLabel);
        }
    }

    function compileReturnStatement (scope: Scope, stmt: ESTree.ReturnStatement): void
    {
        var value: hir.RValue;
        if (stmt.argument)
            value = compileExpression(scope, stmt.argument, true, null, null);
        else
            value = hir.undefinedValue;
        scope.ctx.releaseTemp(value);
        scope.ctx.builder.genRet(value);
    }

    function compileWhileStatement (scope: Scope, stmt: ESTree.WhileStatement): void
    {
        var ctx = scope.ctx;
        var exitLoop = ctx.builder.newLabel();
        var loop = ctx.builder.newLabel();
        var body = ctx.builder.newLabel();

        ctx.builder.genLabel(loop);
        compileExpression(scope, stmt.test, true, body, exitLoop);
        ctx.builder.genLabel(body);
        scope.ctx.pushLabel(new Label(null, location(stmt), LabelKind.LOOP, stmt));
        compileStatement(scope, stmt.body, stmt);
        scope.ctx.popLabel();
        ctx.builder.genGoto(loop);
        ctx.builder.genLabel(exitLoop);
    }

    function compileDoWhileStatement (scope: Scope, stmt: ESTree.DoWhileStatement): void
    {
        var ctx = scope.ctx;
        var exitLoop = ctx.builder.newLabel();
        var loop = ctx.builder.newLabel();
        var body = ctx.builder.newLabel();

        ctx.builder.genLabel(body);
        scope.ctx.pushLabel(new Label(null, location(stmt), LabelKind.LOOP, stmt));
        compileStatement(scope, stmt.body, stmt);
        scope.ctx.popLabel();
        ctx.builder.genLabel(loop);
        compileExpression(scope, stmt.test, true, body, exitLoop);
        ctx.builder.genLabel(exitLoop);
    }

    function compileExpression (
        scope: Scope, e: ESTree.Expression, need: boolean=true, onTrue?: hir.Label, onFalse?: hir.Label
    ): hir.RValue
    {
        return compileSubExpression(scope, e, need, onTrue, onFalse);
    }

    function compileSubExpression (
        scope: Scope, e: ESTree.Expression, need: boolean=true, onTrue?: hir.Label, onFalse?: hir.Label
    ): hir.RValue
    {
        if (!e)
            return;
        switch (e.type) {
            case "Literal":
                return toLogical(scope, e, compileLiteral(scope, NT.Literal.cast(e), need), need, onTrue, onFalse);
            case "Identifier":
                return toLogical(scope, e, compileIdentifier(scope, NT.Identifier.cast(e), need), need, onTrue, onFalse);
            case "ThisExpression":
                return toLogical(scope, e, compileThisExpression(scope, NT.ThisExpression.cast(e), need), need, onTrue, onFalse);
            case "ArrayExpression":
                var arrayExpression: ESTree.ArrayExpression = NT.ArrayExpression.cast(e);
                arrayExpression.elements.forEach((elem) => {
                    if (elem && elem.type !== "SpreadElement")
                        compileSubExpression(scope, elem);
                });
                break;
            case "ObjectExpression":
                var objectExpression: ESTree.ObjectExpression = NT.ObjectExpression.cast(e);
                objectExpression.properties.forEach((prop: ESTree.Property) => {
                    compileSubExpression(scope, prop.value);
                });
                break;
            case "FunctionExpression":
                var functionExpression: ESTree.FunctionExpression = NT.FunctionExpression.cast(e);
                compileFunction(scope, functionExpression);
                break;
            case "SequenceExpression":
                var sequenceExpression: ESTree.SequenceExpression = NT.SequenceExpression.cast(e);
                sequenceExpression.expressions.forEach((e: ESTree.Expression) => {
                    compileSubExpression(scope, e);
                });
                break;
            case "UnaryExpression":
                return compileUnaryExpression(scope, NT.UnaryExpression.cast(e), need, onTrue, onFalse);
            case "BinaryExpression":
                return compileBinaryExpression(scope, NT.BinaryExpression.cast(e), need, onTrue, onFalse);
            case "AssignmentExpression":
                return toLogical(
                    scope, e,
                    compileAssigmentExpression(scope, NT.AssignmentExpression.cast(e), need),
                    need, onTrue, onFalse
                );
            case "UpdateExpression":
                return toLogical(
                    scope, e,
                    compileUpdateExpression(scope, NT.UpdateExpression.cast(e), need),
                    need, onTrue, onFalse
                );
            case "LogicalExpression":
                return compileLogicalExpression(scope,  NT.LogicalExpression.cast(e), need, onTrue, onFalse);
            case "ConditionalExpression":
                var conditionalExpression: ESTree.ConditionalExpression = NT.ConditionalExpression.cast(e);
                compileSubExpression(scope, conditionalExpression.test);
                compileSubExpression(scope, conditionalExpression.alternate);
                compileSubExpression(scope, conditionalExpression.consequent);
                break;
            case "CallExpression":
                var callExpression: ESTree.CallExpression = NT.CallExpression.cast(e);
                compileSubExpression(scope, callExpression.callee);
                callExpression.arguments.forEach((e: ESTree.Expression) => {
                    compileSubExpression(scope, e);
                });
                break;
            case "NewExpression":
                var newExpression: ESTree.NewExpression = NT.NewExpression.cast(e);
                compileSubExpression(scope, newExpression.callee);
                newExpression.arguments.forEach((e: ESTree.Expression) => {
                    compileSubExpression(scope, e);
                });
                break;
            case "MemberExpression":
                var memberExpression: ESTree.MemberExpression = NT.MemberExpression.cast(e);
                compileSubExpression(scope, memberExpression.object);
                if (memberExpression.computed)
                    compileSubExpression(scope, memberExpression.property);
                break;
            default:
                assert(false, `unsupported expression '${e.type}'`);
                break;
        }
    }

    function toLogical (
        scope: Scope, node: ESTree.Node, value: hir.RValue, need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        if (need) {
            if (onTrue) {
                scope.ctx.releaseTemp(value);
                if (hir.isImmediate(value)) {
                    var boolv = hir.isImmediateTrue(value);
                    warning(location(node), `condition is always ${boolv?'true':'false'}`);
                    scope.ctx.builder.genGoto(boolv ? onTrue : onFalse);
                } else {
                    scope.ctx.builder.genIfTrue(value, onTrue, onFalse);
                }
                return null;
            } else {
                return value;
            }
        } else {
            scope.ctx.releaseTemp(value);
            return null;
        }
    }

    function compileLiteral (scope: Scope, literal: ESTree.Literal, need: boolean): hir.RValue
    {
        if (need) {
            // Most literal values we just pass through, but regex and null need special handling
            if ((<any>literal).regex) {
                var regex = (<ESTree.RegexLiteral>literal).regex;
                return new hir.Regex(regex.pattern, regex.flags);
            } else if (literal.value === null){
                return hir.nullValue;
            } else {
                return literal.value;
            }
        } else {
            return null;
        }
    }

    function compileThisExpression (scope: Scope, thisExp: ESTree.ThisExpression, need: boolean): hir.RValue
    {
        return need ? scope.ctx.thisParam : null;
    }

    function findVariable (scope: Scope, identifier: ESTree.Identifier, need: boolean): Variable
    {
        var variable: Variable = scope.lookup(identifier.name);
        if (!variable) {
            if (scope.ctx.strictMode) {
                error(location(identifier), `undefined identifier '${identifier.name}'`);
                // Declare a dummy variable at function level to decrease noise
                variable = scope.ctx.funcScope.newVariable(identifier.name);
            } else {
                warning(location(identifier), `undefined identifier '${identifier.name}'`);
                variable = m_globalContext.funcScope.newVariable(identifier.name);
            }
        } else if (!scope.ctx.strictMode && !variable.declared) {
            // Report all warnings in non-strict mode
            warning(location(identifier), `undefined identifier '${identifier.name}'`);
        }

        if (need) {
            // If the current function context is not where the variable was declared, then it escapes
            if (variable.ctx !== scope.ctx)
                variable.escapes = true;
        }

        return variable;
    }

    function compileIdentifier (scope: Scope, identifier: ESTree.Identifier, need: boolean): hir.RValue
    {
        var variable = findVariable(scope, identifier, need);
        if (need) {
            variable.accessed = true;
            return variable.hvar;
        } else {
            return null;
        }
    }

    function compileUnaryExpression (
        scope: Scope, e: ESTree.UnaryExpression,
        need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        if (!need) {
            scope.ctx.releaseTemp(compileSubExpression(scope, e.argument, false, null, null));
            return null;
        }

        var ctx = scope.ctx;

        switch (e.operator) {
            case "-":
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.NEG, e.argument), true, onTrue, onFalse);
            case "+":
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.UPLUS, e.argument), true, onTrue, onFalse);
            case "~":
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.BIN_NOT, e.argument), true, onTrue, onFalse);
            case "delete":
                assert(false, "FIXME"); // FIXME
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.DELETE, e.argument), true, onTrue, onFalse);

            case "!":
                if (onTrue)
                    return compileSubExpression(scope, e.argument, true, onFalse, onTrue);
                else
                    return compileSimpleUnary(scope, hir.OpCode.LOG_NOT, e.argument);

            case "typeof":
                if (onTrue) {
                    ctx.releaseTemp(compileSubExpression(scope, e.argument, false, null, null));
                    warning(location(e), "condition is always true");
                    ctx.builder.genGoto(onTrue);
                } else {
                    return compileSimpleUnary(scope, hir.OpCode.TYPEOF, e.argument);
                }
                break;

            case "void":
                ctx.releaseTemp(compileSubExpression(scope, e.argument, false, null, null));
                if (onTrue) {
                    warning(location(e), "condition is always false");
                    ctx.builder.genGoto(onFalse);
                } else {
                    return hir.undefinedValue;
                }
                break;

            default:
                assert(false, `unknown unary operator '${e.operator}'`);
                return null;
        }

        return null;

        function compileSimpleUnary (scope: Scope, op: hir.OpCode, e: ESTree.Expression): hir.RValue
        {
            var v = compileSubExpression(scope, e, true, null, null);
            scope.ctx.releaseTemp(v);

            var folded = hir.foldUnary(op, v);
            if (folded !== null) {
                return folded;
            } else {
                var dest = scope.ctx.allocTemp();
                scope.ctx.builder.genUnop(op, dest, v);
                return dest;
            }
        }
    }


    // This performs only very primitive constant folding.
    // TODO: real constant folding and expression reshaping
    function compileBinaryExpression (
        scope: Scope, e: ESTree.BinaryExpression,
        need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        var ctx = scope.ctx;

        if (!need) {
            ctx.releaseTemp(compileSubExpression(scope, e.left, false, null, null));
            ctx.releaseTemp(compileSubExpression(scope, e.right, false, null, null));
            return null;
        }

        // TODO: re-order based on number of temporaries needed by each sub-tree
        var v1 = compileSubExpression(scope, e.left, true);
        var v2 = compileSubExpression(scope, e.right, true);
        ctx.releaseTemp(v1);
        ctx.releaseTemp(v2);

        switch (e.operator) {
            case "==":
                warning(location(e), "operator '==' is not recommended");
                return compileLogBinary(ctx, e, hir.OpCode.LOOSE_EQ, v1, v2, onTrue, onFalse);
            case "!=":
                warning(location(e), "operator '!=' is not recommended");
                return compileLogBinary(ctx, e, hir.OpCode.LOOSE_NE, v1, v2, onTrue, onFalse);
            case "===": return compileLogBinary(ctx, e, hir.OpCode.STRICT_EQ, v1, v2, onTrue, onFalse);
            case "!==": return compileLogBinary(ctx, e, hir.OpCode.STRICT_NE, v1, v2, onTrue, onFalse);
            case "<":   return compileLogBinary(ctx, e, hir.OpCode.LT, v1, v2, onTrue, onFalse);
            case "<=":  return compileLogBinary(ctx, e, hir.OpCode.LE, v1, v2, onTrue, onFalse);
            case ">":   return compileLogBinary(ctx, e, hir.OpCode.LT, v2, v1, onTrue, onFalse);
            case ">=":  return compileLogBinary(ctx, e, hir.OpCode.LE, v2, v1, onTrue, onFalse);
            case "in":  return compileLogBinary(ctx, e, hir.OpCode.IN, v1, v2, onTrue, onFalse);
            case "instanceof": return compileLogBinary(ctx, e, hir.OpCode.INSTANCEOF, v1, v2, onTrue, onFalse);

            case "<<":  return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.SHL, v1, v2), true, onTrue, onFalse);
            case ">>":  return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.ASR, v1, v2), true, onTrue, onFalse);
            case ">>>": return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.SHR, v1, v2), true, onTrue, onFalse);
            case "+":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.ADD, v1, v2), true, onTrue, onFalse);
            case "-":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.SUB, v1, v2), true, onTrue, onFalse);
            case "*":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.MUL, v1, v2), true, onTrue, onFalse);
            case "/":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.DIV, v1, v2), true, onTrue, onFalse);
            case "%":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.MOD, v1, v2), true, onTrue, onFalse);
            case "|":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.OR, v1, v2), true, onTrue, onFalse);
            case "^":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.XOR, v1, v2), true, onTrue, onFalse);
            case "&":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.AND, v1, v2), true, onTrue, onFalse);
            default:
                assert(false, `unknown binary operator '${e.operator}'`);
                break;
        }

        return null;

        function compileArithBinary (ctx: FunctionContext, op: hir.OpCode, v1: hir.RValue, v2: hir.RValue): hir.RValue
        {
            var folded = hir.foldBinary(op, v1, v2);
            if (folded !== null)
                return folded;

            var dest = ctx.allocTemp();
            ctx.builder.genBinop(op, dest, v1, v2);
            return dest;
        }

        function compileLogBinary (
            ctx: FunctionContext, e: ESTree.Node, op: hir.OpCode,
            v1: hir.RValue, v2: hir.RValue, onTrue: hir.Label, onFalse: hir.Label
        ): hir.RValue
        {
            if (onTrue) {
                var folded = hir.foldBinary(op, v1, v2);
                if (folded !== null) {
                    var boolv = hir.isImmediateTrue(folded);
                    warning(location(e), `condition is always ${boolv?'true':'false'}`);
                    ctx.builder.genGoto(boolv ? onTrue : onFalse);
                } else {
                    ctx.builder.genIf(hir.binopToBincond(op), v1, v2, onTrue, onFalse);
                }
                return null;
            } else {
                return compileArithBinary(ctx, op, v1, v2);
            }
        }
    }


    function compileLogicalExpression (
        scope: Scope, e: ESTree.LogicalExpression,
        need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        switch (e.operator) {
            case "||": return compileLogicalOr(scope, e, need, onTrue, onFalse);
            case "&&": return compileLogicalAnd(scope, e, need, onTrue, onFalse);
            default:
                assert(false, `unknown logical operator '${e.operator}'`);
                break;
        }
        return null;
    }

    function compileLogicalOr (
        scope: Scope, e: ESTree.LogicalExpression,
        need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        var ctx = scope.ctx;
        var labLeftFalse: hir.Label;
        var labLeftTrue: hir.Label;
        var labEnd: hir.Label;

        if (need) {
            if (onTrue) {
                labLeftFalse = ctx.builder.newLabel();
                compileSubExpression(scope, e.left, true, onTrue, labLeftFalse);
                ctx.builder.genLabel(labLeftFalse);
                compileSubExpression(scope, e.right, true, onTrue, onFalse);
            } else {
                var v1: hir.RValue;
                var v2: hir.RValue;
                var dest: hir.Local;

                labLeftFalse = ctx.builder.newLabel();
                labEnd = ctx.builder.newLabel();

                v1 = compileSubExpression(scope, e.left, true, null, null);
                ctx.releaseTemp(v1);
                dest = ctx.allocTemp();
                ctx.releaseTemp(dest);
                if (dest === v1) {
                    ctx.builder.genIfTrue(v1, labEnd, labLeftFalse);
                } else {
                    labLeftTrue = ctx.builder.newLabel();
                    ctx.builder.genIfTrue(v1, labLeftTrue, labLeftFalse);
                    ctx.builder.genLabel(labLeftTrue);
                    ctx.builder.genAssign(dest, v1);
                    ctx.builder.genGoto(labEnd);
                }
                ctx.builder.genLabel(labLeftFalse);
                v2 = compileSubExpression(scope, e.right, true, null, null);
                ctx.builder.genLabel(labEnd);
                ctx.releaseTemp(v2);
                ctx.allocSpecific(dest);
                ctx.builder.genAssign(dest, v2);
                return dest;
            }
        } else {
            labLeftFalse = ctx.builder.newLabel();
            labEnd = ctx.builder.newLabel();
            compileSubExpression(scope, e.left, true, labEnd, labLeftFalse);
            ctx.builder.genLabel(labLeftFalse);
            compileSubExpression(scope, e.right, false, null, null);
            ctx.builder.genLabel(labEnd);
        }
    }

    function compileLogicalAnd (
        scope: Scope, e: ESTree.LogicalExpression,
        need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        var ctx = scope.ctx;
        var labLeftFalse: hir.Label;
        var labLeftTrue: hir.Label;
        var labEnd: hir.Label;

        if (need) {
            if (onTrue) {
                labLeftTrue = ctx.builder.newLabel();
                compileSubExpression(scope, e.left, true, labLeftTrue, onFalse);
                ctx.builder.genLabel(labLeftTrue);
                compileSubExpression(scope, e.right, true, onTrue, onFalse);
            } else {
                var v1: hir.RValue;
                var v2: hir.RValue;
                var dest: hir.Local;

                labLeftTrue = ctx.builder.newLabel();
                labEnd = ctx.builder.newLabel();

                v1 = compileSubExpression(scope, e.left, true, null, null);
                ctx.releaseTemp(v1);
                dest = ctx.allocTemp();
                ctx.releaseTemp(dest);
                if (dest === v1) {
                    ctx.builder.genIfTrue(v1, labLeftTrue, labEnd);
                } else {
                    labLeftFalse = ctx.builder.newLabel();
                    ctx.builder.genIfTrue(v1, labLeftTrue, labLeftFalse);
                    ctx.builder.genLabel(labLeftFalse);
                    ctx.builder.genAssign(dest, v1);
                    ctx.builder.genGoto(labEnd);
                }
                ctx.builder.genLabel(labLeftTrue);
                v2 = compileSubExpression(scope, e.right, true, null, null);
                ctx.builder.genLabel(labEnd);
                ctx.releaseTemp(v2);
                ctx.allocSpecific(dest);
                ctx.builder.genAssign(dest, v2);
                return dest;
            }
        } else {
            labLeftTrue = ctx.builder.newLabel();
            labEnd = ctx.builder.newLabel();
            compileSubExpression(scope, e.left, true, labLeftTrue, labEnd);
            ctx.builder.genLabel(labLeftTrue);
            compileSubExpression(scope, e.right, false, null, null);
            ctx.builder.genLabel(labEnd);
        }
    }

    function compileAssigmentExpression (scope: Scope, e: ESTree.AssignmentExpression, need: boolean): hir.RValue
    {
        var identifier: ESTree.Identifier;
        var memb: ESTree.MemberExpression;

        var rvalue = compileSubExpression(scope, e.right);
        var variable: Variable;

        if (identifier = NT.Identifier.isTypeOf(e.left)) {
            variable = findVariable(scope, identifier, true);
            variable.assigned = true;

            if (e.operator == "=") {
                scope.ctx.builder.genAssign(variable.hvar, rvalue);
                return rvalue;
            } else {
                scope.ctx.releaseTemp(rvalue);
                scope.ctx.builder.genBinop(mapAssignmentOperator(e.operator), variable.hvar, variable.hvar, rvalue);
                return variable.hvar;
            }
        } else if(memb = NT.MemberExpression.isTypeOf(e.left)) {
            var membObject: hir.RValue;
            var membProp: hir.RValue = null;
            var membPropName: string;

            if (memb.computed)
                membProp = compileSubExpression(scope, memb.property, true, null, null);
            else
                membPropName = NT.Identifier.cast(memb.property).name;
            membObject = compileSubExpression(scope, memb.object, true, null, null);

            if (e.operator == "=") {
                if (memb.computed)
                    scope.ctx.builder.genComputedPropSet(membObject, membProp, rvalue);
                else
                    scope.ctx.builder.genPropSet(membObject, membPropName, rvalue);
                scope.ctx.releaseTemp(membProp);
                scope.ctx.releaseTemp(membObject);
                return rvalue;
            } else {
                var res = scope.ctx.allocTemp();
                if (memb.computed)
                    scope.ctx.builder.genComputedPropGet(res, membObject, membProp);
                else
                    scope.ctx.builder.genPropGet(res, membObject, membPropName);

                scope.ctx.releaseTemp(rvalue);
                scope.ctx.builder.genBinop(mapAssignmentOperator(e.operator), res, res, rvalue);

                if (memb.computed)
                    scope.ctx.builder.genComputedPropSet(membObject, membProp, res);
                else
                    scope.ctx.builder.genPropSet(membObject, membPropName, res);
                scope.ctx.releaseTemp(membProp);
                scope.ctx.releaseTemp(membObject);
                scope.ctx.releaseTemp(rvalue);
                return res;
            }
        } else {
            assert(false, `unrecognized assignment target '${e.left.type}'`);
            return null;
        }

        function mapAssignmentOperator (operator: string): hir.OpCode
        {
            switch (operator) {
                case "+=":    return hir.OpCode.ADD;
                case "-=":    return hir.OpCode.SUB;
                case "*=":    return hir.OpCode.MUL;
                case "/=":    return hir.OpCode.DIV;
                case "%=":    return hir.OpCode.MOD;
                case "<<=":   return hir.OpCode.SHL;
                case ">>=":   return hir.OpCode.ASR;
                case ">>>=":  return hir.OpCode.SHR;
                case "|=":    return hir.OpCode.OR;
                case "^=":    return hir.OpCode.XOR;
                case "&=":    return hir.OpCode.AND;
                default:
                    assert(false, `unrecognized assignment operator '${operator}'`);
                    return null;
            }
        }
    }

    function compileUpdateExpression (scope: Scope, e: ESTree.UpdateExpression, need: boolean): hir.RValue
    {
        var identifier: ESTree.Identifier;
        var memb: ESTree.MemberExpression;

        var variable: Variable;
        var opcode: hir.OpCode = e.operator == "++" ? hir.OpCode.ADD : hir.OpCode.SUB;
        var immOne = 1;
        var ctx = scope.ctx;

        if (identifier = NT.Identifier.isTypeOf(e.argument)) {
            variable = findVariable(scope, identifier, true);
            variable.assigned = true;
            var lval = variable.hvar;

            if (!e.prefix && need) { // Postfix? It only matters if we need the result
                var res = ctx.allocTemp();
                ctx.builder.genUnop(hir.OpCode.TO_NUMBER, res, lval);
                ctx.builder.genBinop(opcode, lval, lval, immOne);
                return res;
            } else {
                ctx.builder.genUnop(hir.OpCode.TO_NUMBER, lval, lval);
                ctx.builder.genBinop(opcode, lval, lval, immOne);
                return lval;
            }
        } else if(memb = NT.MemberExpression.isTypeOf(e.argument)) {
            var membObject: hir.RValue;
            var membProp: hir.RValue = null;
            var membPropName: string;

            if (memb.computed)
                membProp = compileSubExpression(scope, memb.property, true, null, null);
            else
                membPropName = NT.Identifier.cast(memb.property).name;
            membObject = compileSubExpression(scope, memb.object, true, null, null);

            var val: hir.Local = ctx.allocTemp();

            if (memb.computed)
                ctx.builder.genComputedPropGet(val, membObject, membProp);
            else
                ctx.builder.genPropGet(val, membObject, membPropName);
            ctx.builder.genUnop(hir.OpCode.TO_NUMBER, val, val);

            if (!e.prefix && need) { // Postfix? It only matters if we need the result
                var tmp = ctx.allocTemp();
                ctx.builder.genBinop(opcode, tmp, val, immOne);
                store(tmp);
                ctx.releaseTemp(tmp);
            } else {
                ctx.builder.genBinop(opcode, val, val, immOne);
                store(val);
            }

            function store (src: hir.RValue)
            {
                if (memb.computed)
                    ctx.builder.genComputedPropSet(membObject, membProp, src);
                else
                    ctx.builder.genPropSet(membObject, membPropName, src);
            }

            ctx.releaseTemp(membObject);
            ctx.releaseTemp(membProp);
            return val;
        } else {
            assert(false, `unrecognized assignment target '${e.argument.type}'`);
            return null;
        }
    }
}
