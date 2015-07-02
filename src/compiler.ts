// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./estree-x.d.ts" />

import fs = require("fs");
import assert = require("assert");
import util = require("util");
import child_process = require("child_process");

import acorn = require("../js/acorn/acorn_csp");

import StringMap = require("../lib/StringMap");

import hir = require("./hir");

export interface IErrorReporter
{
    error (loc: ESTree.SourceLocation, msg: string) : void;
    warning (loc: ESTree.SourceLocation, msg: string) : void;
    note (loc: ESTree.SourceLocation, msg: string) : void;
    errorCount (): number;
}

export class Options
{
    dumpAST = false;
    dumpHIR = false;
    strictMode = true;
    debug = false;
    compileOnly = false;
    sourceOnly = false;
    outputName: string = null;
    verbose = false;
    runtimeIncDir: string = null;
    runtimeLibDir: string = null;
    includeDirs: string[] = [];
    libDirs: string[] = [];
    buildDir: string = ".jsbuild";
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
            assert(false, `node.type/${node.type}/ === ${this.name}`);
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
    funcRef: hir.FunctionBuilder;

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
    private vars: StringMap<Variable>;

    constructor (ctx: FunctionContext, parent: Scope)
    {
        this.ctx = ctx;
        this.parent = parent;
        this.level = parent ? parent.level + 1 : 0;
        this.vars = new StringMap<Variable>();
    }

    newVariable (name: string, hvar?: hir.Var): Variable
    {
        var variable = new Variable(this.ctx, name);
        variable.hvar = hvar ? hvar : this.ctx.builder.newVar(name);
        this.setVar(variable);
        return variable;
    }

    getVar (name: string): Variable
    {
        return this.vars.get(name);
    }

    setVar (v: Variable): void
    {
        this.vars.set(v.name, v);
        this.ctx.vars.push(v);
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

class Label
{
    prev: Label = null;

    constructor (
        public name: string, public loc: ESTree.SourceLocation,
        public breakLab: hir.Label, public continueLab: hir.Label
    )
    {}
}

class FunctionContext
{
    parent: FunctionContext;
    name: string;
    strictMode: boolean;

    funcScope: Scope;
    thisParam: Variable;
    argumentsVar: Variable;

    labelList: Label = null;
    labels = new StringMap<Label>();

    vars: Variable[] = [];

    builder: hir.FunctionBuilder = null;

    private tempStack: hir.Local[] = [];

    constructor (parent: FunctionContext, parentScope: Scope, name: string, builder: hir.FunctionBuilder)
    {
        this.parent = parent;
        this.name = name || null;
        this.builder = builder;

        this.strictMode = parent && parent.strictMode;
        this.funcScope = new Scope(this, parentScope);

        var param = this.builder.newParam("this");
        this.thisParam = this.funcScope.newVariable("this", param.variable);
        this.thisParam.initialized = true;
        this.thisParam.declared = true;

        this.argumentsVar = this.funcScope.newVariable("arguments");
        this.argumentsVar.declared = true;
        this.argumentsVar.initialized = true;
    }

    close (): void
    {
        this.vars.forEach( (v: Variable) => {
            this.builder.setVarAttributes(v.hvar,
                v.escapes, v.accessed || v.assigned, v.initialized && !v.assigned, v.funcRef
            );
        });

        this.builder.close();
    }

    findLabel (name: string): Label
    {
        return this.labels.get(name);
    }

    findAnonLabel (loopOnly: boolean): Label
    {
        for ( var label = this.labelList; label; label = label.prev ) {
            if (!label.name && (!loopOnly || label.continueLab))
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
        if (!this.tempStack.length)
        {
            var t = this.builder.newLocal();
            t.isTemp = true;
            this.tempStack.push(t );
        }
        var tmp = this.tempStack.pop();
        //console.log(`allocTemp = ${tmp.id}`);
        return tmp;
    }

    public allocSpecific (t: hir.Local): void
    {
        assert(t.isTemp);
        for ( var i = this.tempStack.length - 1; i >= 0; --i )
            if (this.tempStack[i] === t) {
                //console.log(`allocSpecific = ${t.id}`);
                this.tempStack.splice(i, 1);
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
            this.tempStack.push(l);
        }
    }

    public addClosure (id: ESTree.Identifier): hir.FunctionBuilder
    {
        return this.builder.newClosure(id && id.name);
    }
}

class AsmBinding {
    public used: boolean = false;
    constructor(public index: number, public name: string, public e: ESTree.Expression) {}
}


function compileSource (
    m_scope: Scope, m_undefinedVarScope: Scope,
    m_fileName: string, m_reporter: IErrorReporter, m_options: Options
): void
{
    var m_input: string;

    return compileIt();

    function compileIt (): void
    {
        var prog: ESTree.Program;
        if ((prog = parse(m_fileName))) {
            if (m_options.dumpAST) {
                // Special handling for regular expression literal since we need to
                // convert it to a string literal, otherwise it will be decoded
                // as object "{}" and the regular expression would be lost.
                function adjustRegexLiteral(key: any, value: any)
                {
                    if (key === 'value' && value instanceof RegExp) {
                        value = value.toString();
                    }
                    return value;
                }

                console.log(JSON.stringify(prog, adjustRegexLiteral, 4));
            }

            compileBody(m_scope, prog.body);
        }
    }

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
            //sourceType: "module",
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
                error({source: fileName, start: e.loc, end: e.loc}, e.message);
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
        if (!(v = scope.getVar(name)))
            v = scope.newVariable(name);
        v.declared = true;
        return v;
    }

    function compileFunction (parentScope: Scope, ast: ESTree.Function, funcRef: hir.FunctionBuilder): FunctionContext
    {
        var funcCtx = new FunctionContext(parentScope && parentScope.ctx, parentScope, funcRef.name, funcRef);
        var funcScope = funcCtx.funcScope;

        // Declare the parameters
        // Create a HIR param+var binding for each of them
        ast.params.forEach( (pat: ESTree.Pattern): void => {
            var ident = NT.Identifier.cast(pat);

            var param = funcCtx.builder.newParam(ident.name);
            var v: Variable;

            if (v = funcScope.getVar(ident.name)) {
                (funcCtx.strictMode ? error : warning)(location(ident), `parameter '${ident.name}' already declared`);
                // Overwrite the assigned hvar. When we have duplicate parameter names, the last one wins
                v.hvar = param.variable;
            } else {
                v = funcScope.newVariable(ident.name, param.variable);
                v.initialized = true;
                v.declared = true;
            }
        });

        var bodyBlock: ESTree.BlockStatement;
        if (bodyBlock = NT.BlockStatement.isTypeOf(ast.body))
            compileBody(funcScope, bodyBlock.body);
        else
            assert(false, "TODO: implement ES6");

        funcCtx.close();

        return funcCtx;
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
                scanStatementForDeclarations(scope, whileStatement.body);
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
                scanFunctionDeclaration(scope, NT.FunctionDeclaration.cast(stmt));
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

    function scanFunctionDeclaration (scope: Scope, stmt: ESTree.FunctionDeclaration): void
    {
        var ctx = scope.ctx;
        var funcScope = ctx.funcScope;
        var name = stmt.id.name;

        var variable = funcScope.getVar(name);
        if (variable) {
            if (variable.funcRef)
                warning( location(stmt),  `hiding previous declaration of function '${variable.name}'` );
        } else {
            variable = new Variable(ctx, name);
            funcScope.setVar(variable);
        }
        variable.declared = true;
        variable.funcRef = ctx.addClosure(stmt.id);
        variable.hvar = variable.funcRef.closureVar;

        if (!variable.initialized && !variable.assigned)
            variable.initialized = true;
        else
            variable.assigned = true;
        variable.accessed = true;
    }

    function compileStatement (scope: Scope, stmt: ESTree.Statement, parent: ESTree.Node): void
    {
        if (!stmt)
            return;
        switch (stmt.type) {
            case "EmptyStatement":
                break;
            case "BlockStatement":
                var blockStatement: ESTree.BlockStatement = NT.BlockStatement.cast(stmt);
                blockStatement.body.forEach((s: ESTree.Statement) => {
                    compileStatement(scope, s, stmt);
                });
                break;
            case "ExpressionStatement":
                var expressionStatement: ESTree.ExpressionStatement = NT.ExpressionStatement.cast(stmt);
                compileExpression(scope, expressionStatement.expression, false);
                break;
            case "IfStatement":
                compileIfStatement(scope, NT.IfStatement.cast(stmt));
                break;
            case "LabeledStatement":
                compileLabeledStatement(scope, NT.LabeledStatement.cast(stmt));
                break;
            case "BreakStatement":
                compileBreakStatement(scope, NT.BreakStatement.cast(stmt));
                break;
            case "ContinueStatement":
                compileContinueStatement(scope, NT.ContinueStatement.cast(stmt));
                break;
            case "WithStatement":
                var withStatement: ESTree.WithStatement = NT.WithStatement.cast(stmt);
                error(location(withStatement), "'with' is not supported");
                break;
            case "SwitchStatement":
                compileSwitchStatement(scope, NT.SwitchStatement.cast(stmt));
                break;
            case "ReturnStatement":
                compileReturnStatement(scope, NT.ReturnStatement.cast(stmt));
                break;
            case "ThrowStatement":
                error(location(stmt), "'throw' is not implemented yet");
                var throwStatement: ESTree.ThrowStatement = NT.ThrowStatement.cast(stmt);
                compileExpression(scope, throwStatement.argument);
                break;
            case "TryStatement":
                error(location(stmt), "'try' is not implemented yet");
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
                compileForStatement(scope, NT.ForStatement.cast(stmt));
                break;
            case "ForInStatement":
                error(location(stmt), "'for-in' is not implemented yet");
                var forInStatement: ESTree.ForInStatement = NT.ForInStatement.cast(stmt);
                var forInStatementLeftDecl: ESTree.VariableDeclaration;
                if (forInStatementLeftDecl = NT.VariableDeclaration.isTypeOf(forInStatement.left))
                    compileStatement(scope, forInStatementLeftDecl, stmt);
                else
                    compileExpression(scope, forInStatement.left);
                var breakLab: hir.Label = scope.ctx.builder.newLabel();
                var continueLab: hir.Label = scope.ctx.builder.newLabel();
                scope.ctx.pushLabel(new Label(null, location(forInStatement), breakLab, continueLab));
                compileStatement(scope, forInStatement.body, stmt);
                scope.ctx.builder.genLabel(breakLab);
                scope.ctx.popLabel();
                break;
            case "ForOfStatement":
                error(location(stmt), "'for-of' is not implemented yet");
                var forOfStatement: ESTree.ForOfStatement = NT.ForOfStatement.cast(stmt);
                var forOfStatementLeftDecl: ESTree.VariableDeclaration;
                if (forOfStatementLeftDecl = NT.VariableDeclaration.isTypeOf(forOfStatement.left))
                    compileStatement(scope, forOfStatementLeftDecl, stmt);
                else
                    compileExpression(scope, forOfStatement.left);
                var breakLab: hir.Label = scope.ctx.builder.newLabel();
                var continueLab: hir.Label = scope.ctx.builder.newLabel();
                scope.ctx.pushLabel(new Label(null, location(forOfStatement), breakLab, continueLab));
                compileStatement(scope, forOfStatement.body, stmt);
                scope.ctx.builder.genLabel(breakLab);
                scope.ctx.popLabel();
                break;
            case "DebuggerStatement":
                error(location(stmt), "'debugger' is not implemented yet");
                var debuggerStatement: ESTree.DebuggerStatement = NT.DebuggerStatement.cast(stmt);
                break;

            case "FunctionDeclaration":
                compileFunctionDeclaration(scope, NT.FunctionDeclaration.cast(stmt), parent);
                break;
            case "VariableDeclaration":
                compileVariableDeclaration(scope, NT.VariableDeclaration.cast(stmt));
                break;
            default:
                error(location(stmt), "unsupported statement");
                assert(false, `unsupported statement '${stmt.type}'`);
                break;
        }
    }

    function compileLabeledStatement (scope: Scope, stmt: ESTree.LabeledStatement): void
    {
        var prevLabel: Label;
        var loc = location(stmt);
        var breakLab: hir.Label = null;

        if (prevLabel = scope.ctx.findLabel(stmt.label.name)) {
            error(loc, `label '${prevLabel.name}' already declared`);
            note(prevLabel.loc, `previous declaration of label '${prevLabel.name}'`);
        } else {
            breakLab = scope.ctx.builder.newLabel();
            // Find the target statement by skipping nested labels (if any)
            for ( var targetStmt = stmt.body;
                  NT.LabeledStatement.eq(targetStmt);
                  targetStmt = NT.LabeledStatement.cast(targetStmt).body )
            {}

            var label = new Label(stmt.label.name, loc, breakLab, null);
            scope.ctx.pushLabel(label);

            // Add the label to the label set of the statement.
            // It is actually only needed by loops to implement 'continue'
            if (!targetStmt.labels)
                targetStmt.labels = [label];
            else
                targetStmt.labels.push(label);
        }

        compileStatement(scope, stmt.body, stmt);

        if (breakLab) {
            scope.ctx.builder.genLabel(breakLab);
            scope.ctx.popLabel();
        }
    }

    function compileBreakStatement (scope: Scope, stmt: ESTree.BreakStatement): void
    {
        var label: Label = null;
        if (stmt.label) {
            if (!(label = scope.ctx.findLabel(stmt.label.name))) {
                error(location(stmt), `'break' label '${stmt.label.name}:' is not defined`);
                return;
            }
        } else {
            if (!(label = scope.ctx.findAnonLabel(false))) {
                error(location(stmt), "'break': there is no surrounding loop");
                return;
            }
        }
        scope.ctx.builder.genGoto(label.breakLab);
    }

    function compileContinueStatement (scope: Scope, stmt: ESTree.ContinueStatement): void
    {
        var label: Label = null;
        if (stmt.label) {
            if (!(label = scope.ctx.findLabel(stmt.label.name))) {
                error(location(stmt), `'continue' label '${stmt.label.name}:' is not defined`);
                return;
            } else if (!label.continueLab) {
                error(location(stmt), `'continue' label '${stmt.label.name}:' is not a loop`);
                note(label.loc, `label '${stmt.label.name}:' defined here`);
                return;
            }
        } else {
            if (!(label = scope.ctx.findAnonLabel(true))) {
                error(location(stmt), "'continue': there is no surrounding loop");
                return;
            }
        }
        scope.ctx.builder.genGoto(label.continueLab);
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

    // TODO: check if all expressions are constant integers and generate a SWITCH instruction
    function compileSwitchStatement (scope: Scope, stmt: ESTree.SwitchStatement): void
    {
        if (stmt.cases.length === 0) {
            warning(location(stmt), "empty 'switch' statement");
            compileExpression(scope, stmt.discriminant, false, null, null);
            return;
        }

        var ctx = scope.ctx;
        var breakLab: hir.Label = scope.ctx.builder.newLabel();
        var labels: hir.Label[] = new Array<hir.Label>(stmt.cases.length);

        for ( var i = 0; i < stmt.cases.length; ++i )
            labels[i] = ctx.builder.newLabel();

        var discr = compileExpression(scope, stmt.discriminant, true, null, null);
        if (hir.isImmediate(discr))
            warning(location(stmt.discriminant), "'switch' expression is constant");

        var defaultLabel: hir.Label = null;
        var elseLabel: hir.Label = null;

        for ( var i = 0; i < stmt.cases.length; ++i ) {
            var sc = stmt.cases[i];
            if (!sc.test) {
                defaultLabel = labels[i];
                continue;
            }

            if (elseLabel != null)
                ctx.builder.genLabel(elseLabel);

            var testval = compileExpression(scope, sc.test, true, null, null);
            ctx.releaseTemp(testval);
            elseLabel = ctx.builder.newLabel();
            ctx.builder.genIf(hir.OpCode.IF_STRICT_EQ, discr, testval, labels[i], elseLabel);
        }

        if (elseLabel) {
            ctx.builder.genLabel(elseLabel);
            if (defaultLabel)
                ctx.builder.genGoto(defaultLabel);
            else
                ctx.builder.genGoto(breakLab);
        }

        ctx.releaseTemp(discr);

        scope.ctx.pushLabel(new Label(null, location(stmt), breakLab, null));

        for ( var i = 0; i < stmt.cases.length; ++i ) {
            ctx.builder.genLabel(labels[i]);
            stmt.cases[i].consequent.forEach((s: ESTree.Statement) => {
                compileStatement(scope, s, stmt);
            });
        }

        scope.ctx.builder.genLabel(breakLab);
        scope.ctx.popLabel();
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

    function fillContinueInNamedLoopLabels (labels: Label[], continueLab: hir.Label): void
    {
        if (labels)
            for ( var i = 0, e = labels.length; i < e; ++i )
                labels[i].continueLab = continueLab;
    }

    function compileWhileStatement (scope: Scope, stmt: ESTree.WhileStatement): void
    {
        var ctx = scope.ctx;
        var exitLoop = ctx.builder.newLabel();
        var loop = ctx.builder.newLabel();
        var body = ctx.builder.newLabel();

        fillContinueInNamedLoopLabels(stmt.labels, body);

        ctx.builder.genLabel(loop);
        compileExpression(scope, stmt.test, true, body, exitLoop);
        ctx.builder.genLabel(body);
        scope.ctx.pushLabel(new Label(null, location(stmt), exitLoop, loop));
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

        fillContinueInNamedLoopLabels(stmt.labels, body);

        ctx.builder.genLabel(body);
        scope.ctx.pushLabel(new Label(null, location(stmt), exitLoop, loop));
        compileStatement(scope, stmt.body, stmt);
        scope.ctx.popLabel();
        ctx.builder.genLabel(loop);
        compileExpression(scope, stmt.test, true, body, exitLoop);
        ctx.builder.genLabel(exitLoop);
    }

    function compileForStatement (scope: Scope, stmt: ESTree.ForStatement): void
    {
        var ctx = scope.ctx;
        var exitLoop = ctx.builder.newLabel();
        var loopStart = ctx.builder.newLabel();
        var loop = ctx.builder.newLabel();
        var body = ctx.builder.newLabel();

        fillContinueInNamedLoopLabels(stmt.labels, body);

        var forStatementInitDecl: ESTree.VariableDeclaration;
        if (stmt.init)
            if (forStatementInitDecl = NT.VariableDeclaration.isTypeOf(stmt.init))
                compileStatement(scope, forStatementInitDecl, stmt);
            else
                compileExpression(scope, stmt.init);

        ctx.builder.genLabel(loopStart);
        if (stmt.test)
            compileExpression(scope, stmt.test, true, body, exitLoop);
        ctx.builder.genLabel(body);
        scope.ctx.pushLabel(new Label(null, location(stmt), exitLoop, loop));
        compileStatement(scope, stmt.body, stmt);
        scope.ctx.popLabel();

        ctx.builder.genLabel(loop);
        if (stmt.update)
            compileExpression(scope, stmt.update);
        ctx.builder.genGoto(loopStart);
        ctx.builder.genLabel(exitLoop);
    }

    function compileFunctionDeclaration (scope: Scope, stmt: ESTree.FunctionDeclaration, parent: ESTree.Statement): void
    {
        if (scope.ctx.strictMode && parent)
            error(location(stmt), "functions can only be declared at top level in strict mode");

        var variable = scope.ctx.funcScope.lookup(stmt.id.name);
        compileFunction(scope, stmt, variable.funcRef);
    }

    function compileVariableDeclaration (scope: Scope, stmt: ESTree.VariableDeclaration): void
    {
        stmt.declarations.forEach((vd: ESTree.VariableDeclarator) => {
            if (vd.init) {
                var identifier = NT.Identifier.cast(vd.id);
                var variable = scope.lookup(identifier.name);
                variable.assigned = true;

                var value = compileExpression(scope, vd.init, true, null, null);
                scope.ctx.releaseTemp(value);
                scope.ctx.builder.genAssign(variable.hvar, value);
            }
        });
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
                error(location(e), "'[array expression]' is not implemented yet");
                var arrayExpression: ESTree.ArrayExpression = NT.ArrayExpression.cast(e);
                arrayExpression.elements.forEach((elem) => {
                    if (elem && elem.type !== "SpreadElement")
                        compileSubExpression(scope, elem);
                });
                break;
            case "ObjectExpression":
                return compileObjectExpression(scope, NT.ObjectExpression.cast(e), need, onTrue, onFalse);
            case "FunctionExpression":
                return toLogical(
                    scope, e, compileFunctionExpression(scope, NT.FunctionExpression.cast(e), need),
                    need, onTrue, onFalse
                );
            case "SequenceExpression":
                return compileSequenceExpression(scope, NT.SequenceExpression.cast(e), need, onTrue, onFalse);
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
                return compileConditionalExpression(scope, NT.ConditionalExpression.cast(e), need, onTrue, onFalse);
            case "CallExpression":
                return toLogical(scope, e, compileCallExpression(scope, NT.CallExpression.cast(e), need), need, onTrue, onFalse);
            case "NewExpression":
                return toLogical(scope, e, compileNewExpression(scope, NT.NewExpression.cast(e), need), need, onTrue, onFalse);
            case "MemberExpression":
                return toLogical(
                    scope, e,
                    compileMemberExpression(scope, NT.MemberExpression.cast(e), need),
                    need, onTrue, onFalse
                );
            default:
                error(location(e), "unsupported expression");
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

    function toNumberValue (scope: Scope, v: hir.RValue): hir.RValue
    {
        return v;
        /*
         var t : hir.RValue;
         if (hir.isImmediate(v))
         if ((t = hir.foldUnary(hir.OpCode.TO_NUMBER, v)) !== null)
         return t;

         scope.ctx.releaseTemp(v);
         var r = scope.ctx.allocTemp();
         scope.ctx.builder.genUnop(hir.OpCode.TO_NUMBER, r, v);
         return r;
         */
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
            } else
                return hir.wrapImmediate(literal.value);
        } else {
            return null;
        }
    }

    function compileThisExpression (scope: Scope, thisExp: ESTree.ThisExpression, need: boolean): hir.RValue
    {
        var variable = scope.ctx.thisParam;
        if (need) {
            variable.accessed = true;
            return variable.hvar;
        } else {
            return null;
        }
    }

    function compileObjectExpression (
        scope: Scope, e: ESTree.ObjectExpression, need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        var ctx = scope.ctx;

        if (!need || onTrue) {
            warning(location(e), onTrue ? "condition is always true" : "unused object expression");

            e.properties.forEach((prop: ESTree.Property) => {
                compileSubExpression(scope, prop.value, false, null, null);
            });

            if (onTrue)
                ctx.builder.genGoto(onTrue);

            return null;
        }

        var objProto = ctx.allocTemp();
        ctx.builder.genLoadSC(objProto, hir.SysConst.OBJECT_PROTOTYPE);
        ctx.releaseTemp(objProto);
        var dest = ctx.allocTemp();
        ctx.builder.genCreate(dest, objProto);

        e.properties.forEach((prop: ESTree.Property) => {
            var propName: hir.RValue;
            if (prop.computed)
                propName = compileSubExpression(scope, prop.key);
            else
                propName = hir.wrapImmediate(NT.Identifier.cast(prop.key).name);
            var val = compileSubExpression(scope, prop.value, true, null, null);
            ctx.releaseTemp(val);
            ctx.releaseTemp(propName);
            ctx.builder.genPropSet(dest, propName, val);
        });

        return dest;
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
                variable = m_undefinedVarScope.newVariable(identifier.name);
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

    function compileFunctionExpression (scope: Scope, e: ESTree.FunctionExpression, need: boolean): hir.RValue
    {
        if (!need)
            warning(location(e), "unused function");

        var funcRef = scope.ctx.addClosure(e.id);
        var nameScope = new Scope(scope.ctx, scope); // A scope for the function name
        if (e.id) {
            var funcVar = nameScope.newVariable(e.id.name, funcRef.closureVar);
            funcVar.funcRef = funcRef;
            funcVar.declared = true;
            funcVar.initialized = true;
            funcVar.accessed = need;
        }
        compileFunction(nameScope, e, funcRef);
        return need ? funcRef.closureVar : null;
    }

    function compileSequenceExpression (
        scope: Scope, e: ESTree.SequenceExpression,
        need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        var i: number;
        for ( i = 0; i < e.expressions.length-1; ++i )
            compileSubExpression(scope, e.expressions[i], false, null, null);
        return compileSubExpression(scope, e.expressions[i], need, onTrue, onFalse);
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
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.NEG_N, true, e.argument), true, onTrue, onFalse);
            case "+":
                return toLogical(scope, e,
                    toNumberValue(scope, compileSubExpression(scope, e.argument, true, null, null)),
                    true, onTrue, onFalse
                );
            case "~":
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.BIN_NOT_N, true, e.argument), true, onTrue, onFalse);
            case "delete":
                assert(false, "FIXME"); // FIXME
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.DELETE, false, e.argument), true, onTrue, onFalse);

            case "!":
                if (onTrue)
                    return compileSubExpression(scope, e.argument, true, onFalse, onTrue);
                else
                    return compileSimpleUnary(scope, hir.OpCode.LOG_NOT, false, e.argument);

            case "typeof":
                if (onTrue) {
                    ctx.releaseTemp(compileSubExpression(scope, e.argument, false, null, null));
                    warning(location(e), "condition is always true");
                    ctx.builder.genGoto(onTrue);
                } else {
                    return compileSimpleUnary(scope, hir.OpCode.TYPEOF, false, e.argument);
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

        function compileSimpleUnary (scope: Scope, op: hir.OpCode, arith: boolean, e: ESTree.Expression): hir.RValue
        {
            var v = compileSubExpression(scope, e, true, null, null);
            if (arith)
                v = toNumberValue(scope, v);
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
            case ">":   return compileLogBinary(ctx, e, hir.OpCode.GT, v1, v2, onTrue, onFalse);
            case ">=":  return compileLogBinary(ctx, e, hir.OpCode.GE, v1, v2, onTrue, onFalse);
            case "in":  return compileLogBinary(ctx, e, hir.OpCode.IN, v1, v2, onTrue, onFalse);
            case "instanceof": return compileLogBinary(ctx, e, hir.OpCode.INSTANCEOF, v1, v2, onTrue, onFalse);

            case "<<":  return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.SHL_N, v1, v2), true, onTrue, onFalse);
            case ">>":  return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.ASR_N, v1, v2), true, onTrue, onFalse);
            case ">>>": return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.SHR_N, v1, v2), true, onTrue, onFalse);
            case "+":   return toLogical(scope, e, compileGenericBinary(ctx, hir.OpCode.ADD, v1, v2), true, onTrue, onFalse);
            case "-":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.SUB_N, v1, v2), true, onTrue, onFalse);
            case "*":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.MUL_N, v1, v2), true, onTrue, onFalse);
            case "/":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.DIV_N, v1, v2), true, onTrue, onFalse);
            case "%":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.MOD_N, v1, v2), true, onTrue, onFalse);
            case "|":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.OR_N, v1, v2), true, onTrue, onFalse);
            case "^":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.XOR_N, v1, v2), true, onTrue, onFalse);
            case "&":   return toLogical(scope, e, compileArithBinary(ctx, hir.OpCode.AND_N, v1, v2), true, onTrue, onFalse);
            default:
                assert(false, `unknown binary operator '${e.operator}'`);
                break;
        }

        return null;

        function compileGenericBinary (ctx: FunctionContext, op: hir.OpCode, v1: hir.RValue, v2: hir.RValue): hir.RValue
        {
            var folded = hir.foldBinary(op, v1, v2);
            if (folded !== null)
                return folded;

            var dest = ctx.allocTemp();
            ctx.builder.genBinop(op, dest, v1, v2);
            return dest;
        }

        function compileArithBinary (ctx: FunctionContext, op: hir.OpCode, v1: hir.RValue, v2: hir.RValue): hir.RValue
        {
            return compileGenericBinary(ctx, op, toNumberValue(scope, v1), toNumberValue(scope, v2));
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
                performOperation(scope, e.operator, variable.hvar, rvalue);
                return variable.hvar;
            }
        } else if(memb = NT.MemberExpression.isTypeOf(e.left)) {
            var membObject: hir.RValue;
            var membPropName: hir.RValue;

            if (memb.computed)
                membPropName = compileSubExpression(scope, memb.property, true, null, null);
            else
                membPropName = hir.wrapImmediate(NT.Identifier.cast(memb.property).name);
            membObject = compileSubExpression(scope, memb.object, true, null, null);

            if (e.operator == "=") {
                scope.ctx.builder.genPropSet(membObject, membPropName, rvalue);
                scope.ctx.releaseTemp(membObject);
                scope.ctx.releaseTemp(membPropName);
                return rvalue;
            } else {
                var res = scope.ctx.allocTemp();
                scope.ctx.builder.genPropGet(res, membObject, membPropName);
                scope.ctx.releaseTemp(rvalue);
                performOperation(scope, e.operator, res, rvalue);

                scope.ctx.builder.genPropSet(membObject, membPropName, res);
                scope.ctx.releaseTemp(membObject);
                scope.ctx.releaseTemp(membPropName);
                scope.ctx.releaseTemp(rvalue);
                return res;
            }
        } else {
            assert(false, `unrecognized assignment target '${e.left.type}'`);
            return null;
        }

        function performOperation (scope: Scope, operator: string, dest: hir.LValue, src: hir.RValue): void
        {
            var opcode: hir.OpCode;

            switch (operator) {
                case "+=":
                    scope.ctx.builder.genBinop(hir.OpCode.ADD, dest, dest, src);
                    return;

                case "-=":    opcode = hir.OpCode.SUB_N; break;
                case "*=":    opcode = hir.OpCode.MUL_N; break;
                case "/=":    opcode = hir.OpCode.DIV_N; break;
                case "%=":    opcode = hir.OpCode.MOD_N; break;
                case "<<=":   opcode = hir.OpCode.SHL_N; break;
                case ">>=":   opcode = hir.OpCode.ASR_N; break;
                case ">>>=":  opcode = hir.OpCode.SHR_N; break;
                case "|=":    opcode = hir.OpCode.OR_N; break;
                case "^=":    opcode = hir.OpCode.XOR_N; break;
                case "&=":    opcode = hir.OpCode.AND_N; break;
                default:
                    assert(false, `unrecognized assignment operator '${operator}'`);
                    return null;
            }

            src = toNumberValue(scope, src);
            var d = toNumberValue(scope, dest);
            scope.ctx.releaseTemp(d);
            scope.ctx.builder.genBinop(opcode, dest, d, src);
        }
    }

    function compileUpdateExpression (scope: Scope, e: ESTree.UpdateExpression, need: boolean): hir.RValue
    {
        var identifier: ESTree.Identifier;
        var memb: ESTree.MemberExpression;

        var variable: Variable;
        var opcode: hir.OpCode = e.operator == "++" ? hir.OpCode.ADD_N : hir.OpCode.SUB_N;
        var immOne = hir.wrapImmediate(1);
        var ctx = scope.ctx;

        if (identifier = NT.Identifier.isTypeOf(e.argument)) {
            variable = findVariable(scope, identifier, true);
            variable.assigned = true;
            var lval = variable.hvar;

            if (!e.prefix && need) { // Postfix? It only matters if we need the result
                var res = toNumberValue(scope, lval);
                ctx.builder.genBinop(opcode, lval, lval, immOne);
                return res;
            } else {
                var res = toNumberValue(scope, lval);
                ctx.builder.genBinop(opcode, lval, res, immOne);
                return lval;
            }
        } else if(memb = NT.MemberExpression.isTypeOf(e.argument)) {
            var membObject: hir.RValue;
            var membPropName: hir.RValue = null;

            if (memb.computed)
                membPropName = compileSubExpression(scope, memb.property, true, null, null);
            else
                membPropName = hir.wrapImmediate(NT.Identifier.cast(memb.property).name);
            membObject = compileSubExpression(scope, memb.object, true, null, null);

            var val: hir.Local = ctx.allocTemp();
            ctx.builder.genPropGet(val, membObject, membPropName);
            var n = toNumberValue(scope, val);

            if (!e.prefix && need) { // Postfix? It only matters if we need the result
                var tmp = ctx.allocTemp();
                ctx.builder.genBinop(opcode, tmp, n, immOne);
                ctx.builder.genPropSet(membObject, membPropName, tmp);
                ctx.releaseTemp(tmp);
            } else {
                ctx.builder.genBinop(opcode, val, n, immOne);
                ctx.builder.genPropSet(membObject, membPropName, val);
            }

            ctx.releaseTemp(membObject);
            ctx.releaseTemp(membPropName);
            return val;
        } else {
            assert(false, `unrecognized assignment target '${e.argument.type}'`);
            return null;
        }
    }

    function isStringLiteral (e: ESTree.Expression): string
    {
        var lit = NT.Literal.isTypeOf(e);
        return lit && typeof lit.value === "string" ? <string>lit.value : null;
    }

    /**
     * Used by compiler extensions when an an argument is required to be a constant string. Besides a
     * single string literal we also handle addition of literals.
     * @param e
     * @returns {any}
     */
    function parseConstantString (e: ESTree.Expression): string
    {
        var str = isStringLiteral(e);
        if (str !== null)
            return str;
        var bine = NT.BinaryExpression.isTypeOf(e);
        if (!bine || bine.operator != "+") {
            error(location(e), "not a constant string literal");
            return null;
        }
        var a = parseConstantString(bine.left);
        if (a === null)
            return null;
        var b = parseConstantString(bine.right);
        if (b === null)
            return null;
        return a + b;
    }

    function compileAsmExpression (scope: Scope, e: ESTree.CallExpression, need: boolean): hir.RValue
    {
        // __asm__( options: object, result: [], inputs: [[]*]?, pattern: string )
        var resultBinding: AsmBinding = null;
        var bindings: AsmBinding[] = [];
        var bindingMap = new StringMap<AsmBinding>();
        var pattern: hir.AsmPattern = null;

        function addBinding (name: string, e: ESTree.Expression): AsmBinding
        {
            var b = new AsmBinding(bindings.length, name, e);
            bindings.push(b);
            bindingMap.set(name, b);
            return b;
        }

        function parseOptions (e: ESTree.Expression): void
        {
            var objE = NT.ObjectExpression.isTypeOf(e);
            if (!objE) {
                error(location(e), "'__asm__' parameter 1 (options) must be an object literal");
            } else if (objE.properties.length > 0) {
                error(location(e), "'__asm__': no options are currently implemented");
            }
        }

        function parseResult (e: ESTree.Expression): void
        {
            var arrE = NT.ArrayExpression.isTypeOf(e);
            if (!arrE) {
                error(location(e), "'__asm__' parameter 2 (result) must be an array literal");
                return;
            }
            if (arrE.elements.length === 0)
                return;
            var name = isStringLiteral(arrE.elements[0]);
            if (!name) {
                error(location(arrE.elements[0]), "__asm__ result name must be a string literal");
                return;
            }
            resultBinding = addBinding(name, null);
            if (arrE.elements.length > 1) {
                error(location(arrE.elements[1]), "unsupported __asm__ result options");
                return;
            }
        }

        function parseInputDeclaration (e: ESTree.Expression): void
        {
            var arrE = NT.ArrayExpression.isTypeOf(e);
            if (!arrE) {
                error(location(e), "'__asm__' every input declaration must be an array literal");
                return;
            }
            var name = isStringLiteral(arrE.elements[0]);
            if (!name) {
                error(location(e), "'__asm__' every input declaration must begin with a string literal");
                return;
            }
            if (bindingMap.has(name)) {
                error(location(e), `'__asm__' binding '${name}' already declared`);
                return;
            }

            if (arrE.elements.length < 2) {
                error(location(e), "'__asm__' input declaration needs an initializing expression");
                return;
            }
            addBinding(name, arrE.elements[1]);

            if (arrE.elements.length > 2) {
                error(location(e), "'__asm__' input declaration options not supported yet");
                return;
            }
        }

        function parseInputs (e: ESTree.Expression): void
        {
            var arrE = NT.ArrayExpression.isTypeOf(e);
            if (!arrE) {
                error(location(e), "'__asm__' parameter 3 (inputs) must be an array literal");
                return;
            }
            arrE.elements.forEach(parseInputDeclaration);
        }

        function parsePattern (e: ESTree.Expression): void
        {
            var patstr = parseConstantString(e);
            if (patstr === null)
                return;

            var lastIndex = 0;
            var asmPat: hir.AsmPattern = [];
            var re =  /(%%)|(%\[([^\]]*)\])/g;
            var match : RegExpExecArray;

            function pushStr (str: string): void
            {
                if (asmPat.length && typeof asmPat[asmPat.length-1] === "string")
                    asmPat[asmPat.length-1] += str;
                else
                    asmPat.push(str);
            }

            while (match = re.exec(patstr)) {
                if (match.index > lastIndex)
                    pushStr(patstr.slice(lastIndex, match.index));

                if (match[1]) { // "%%"?
                    pushStr("%");
                } else {
                    var name = match[3];
                    var bnd = bindingMap.get(name);
                    if (!bnd) {
                        error(location(e), `undeclared binding '%[${name}]'`);
                        return;
                    }
                    bnd.used = true;
                    asmPat.push(bnd.index);
                }

                lastIndex = re.lastIndex;
            }

            if (lastIndex < patstr.length)
                pushStr(patstr.slice(lastIndex, patstr.length));

            if (resultBinding && !resultBinding.used) {
                error(location(e), `result binding '%[${resultBinding.name}]' wasn't used`);
                return;
            }

            bindingMap.forEach((b) => {
                if (!b.used)
                    warning(location(e), `binding '%[${b.name}]' wasn't used`);
            });

            pattern = asmPat;
        }


        if (e.arguments.length !== 4) {
            error(location(e), "'__asm__' requires exactly four arguments");
        } else {
            parseOptions(e.arguments[0]);
            parseResult(e.arguments[1]);
            parseInputs(e.arguments[2]);
            parsePattern(e.arguments[3]);
        }

        if (!pattern) // error?
            return need ? hir.nullReg : null;

        var hbnd: hir.RValue[] = new Array<hir.RValue>(bindings.length);
        var dest: hir.LValue = null;

        for ( var i = 0; i < bindings.length; ++i ) {
            var b = bindings[i];
            if (!b.used)
                hbnd[i] = null;
            else if (b.e)
                hbnd[i] = compileSubExpression(scope, b.e, true, null, null);
            else
                hbnd[i] = dest = scope.ctx.allocTemp();
        }

        // Release the temporaries in reverse order, except the result
        for ( var i = bindings.length-1; i >= 0; --i )
            if (bindings[i].e) // if not an output
                scope.ctx.releaseTemp(hbnd[i]);

        scope.ctx.builder.genAsm(dest, hbnd, pattern);

        if (need) {
            if (dest) {
                return dest;
            } else {
                warning(location(e), "'__asm__': no result value generated");
                return hir.undefinedValue;
            }
        } else {
            scope.ctx.releaseTemp(dest);
            return null;
        }
    }

    function compileAsmHExpression (scope: Scope, e: ESTree.CallExpression, need: boolean): hir.RValue
    {
        function parseOptions (e: ESTree.Expression): void
        {
            var objE = NT.ObjectExpression.isTypeOf(e);
            if (!objE) {
                error(location(e), "'__asmh__' parameter 1 (options) must be an object literal");
            } else if (objE.properties.length > 0) {
                error(location(e), "'__asmh__': no options are currently implemented");
            }
        }


        exit:
        {
            if (e.arguments.length !== 2) {
                error(location(e), "'__asmh__' requires exactly two arguments");
                break exit;
            }

            parseOptions(e.arguments[0]);
            var str = parseConstantString(e.arguments[1]);
            if (!str)
                break exit;

            scope.ctx.builder.module.addAsmHeader(str);
        }
        return need ? hir.undefinedValue : null;
    }

    function extractCallIdentifier (e: ESTree.CallExpression): string
    {
        var identifierExp: ESTree.Identifier;
        return (identifierExp = NT.Identifier.isTypeOf(e.callee)) ? identifierExp.name : null;
    }

    function compileConditionalExpression (
        scope: Scope, e: ESTree.ConditionalExpression, need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        var ctx = scope.ctx;
        var trueLab = ctx.builder.newLabel();
        var falseLab = ctx.builder.newLabel();
        var endLab: hir.Label;
        var dest: hir.Local = null;
        var v1: hir.RValue;
        var v2: hir.RValue;

        if (!onTrue)
            endLab = ctx.builder.newLabel();

        compileSubExpression(scope, e.test, true, trueLab, falseLab);

        ctx.builder.genLabel(trueLab);
        v1 = compileSubExpression(scope, e.consequent, need, onTrue, onFalse);
        ctx.releaseTemp(v1);
        if (!onTrue) {
            if (need) {
                dest = ctx.allocTemp();
                ctx.builder.genAssign(dest, v1);
                ctx.releaseTemp(dest);
            }
            ctx.builder.genGoto(endLab);
        }

        ctx.builder.genLabel(falseLab);
        v2 = compileSubExpression(scope, e.alternate, need, onTrue, onFalse);
        ctx.releaseTemp(v2);

        if (!onTrue) {
            if (need) {
                ctx.allocSpecific(dest);
                ctx.builder.genAssign(dest, v2);
            }
            ctx.builder.genLabel(endLab);
        }

        return dest;
    }

    function compileCallExpression (scope: Scope, e: ESTree.CallExpression, need: boolean): hir.RValue
    {
        // Check for compiler extensions
        switch (extractCallIdentifier(e)) {
            case "__asm__": return compileAsmExpression(scope, e, need);
            case "__asmh__": return compileAsmHExpression(scope, e, need);
        }

        var ctx = scope.ctx;
        var args: hir.RValue[] = [];
        var fref: hir.FunctionBuilder = null;

        var closure: hir.RValue;
        var thisArg: hir.RValue;

        var memb: ESTree.MemberExpression;
        if (memb = NT.MemberExpression.isTypeOf(e.callee)) {
            var tmp = compileMemberExpressionHelper(scope, memb, true, true);
            closure = tmp.dest;
            thisArg = tmp.obj;
        } else {
            closure = compileSubExpression(scope, e.callee, true, null, null);
            thisArg = hir.undefinedValue;
        }

        args.push(thisArg);
        e.arguments.forEach((e: ESTree.Expression) => {
            args.push( compileSubExpression(scope, e, true, null, null) );
        });

        for ( var i = args.length - 1; i >= 0; --i )
            ctx.releaseTemp(args[i]);
        ctx.releaseTemp(thisArg);
        ctx.releaseTemp(closure);

        var dest: hir.LValue = null;
        if (need)
            dest = ctx.allocTemp();

        ctx.builder.genCall(dest, closure, args);
        return dest;
    }

    function compileNewExpression (scope: Scope, e: ESTree.NewExpression, need: boolean): hir.RValue
    {
        var ctx = scope.ctx;
        var objLab = ctx.builder.newLabel();
        var notObjLab = ctx.builder.newLabel();
        var closure = compileSubExpression(scope, e.callee);

        var prototype = ctx.allocTemp();
        ctx.builder.genPropGet(prototype, closure, hir.wrapImmediate("prototype"));
        ctx.builder.genIfIsObject(prototype, objLab, notObjLab);
        ctx.builder.genLabel(notObjLab);
        ctx.builder.genLoadSC(prototype, hir.SysConst.OBJECT_PROTOTYPE);
        ctx.builder.genLabel(objLab);
        ctx.releaseTemp(prototype);
        var obj = ctx.allocTemp();
        ctx.builder.genCreate(obj, prototype);

        var args: hir.RValue[] = [];
        args.push(obj);

        e.arguments.forEach((e: ESTree.Expression) => {
            args.push( compileSubExpression(scope, e, true, null, null) );
        });

        for ( var i = args.length - 1; i > 0; --i )
            ctx.releaseTemp(args[i]);

        var res = ctx.allocTemp();
        ctx.builder.genCall(res, closure, args);

        var undLab = ctx.builder.newLabel();
        var notUndLab = ctx.builder.newLabel();
        ctx.builder.genIf(hir.OpCode.IF_STRICT_EQ, res, hir.undefinedValue, undLab, notUndLab );
        ctx.builder.genLabel(notUndLab);
        ctx.releaseTemp(res);
        ctx.builder.genAssign(obj, res);
        ctx.builder.genLabel(undLab);

        return obj;
    }

    function compileMemberExpressionHelper (scope: Scope, e: ESTree.MemberExpression, need: boolean, needObj: boolean)
    : { obj: hir.RValue; dest: hir.RValue }
    {
        var propName: hir.RValue;
        if (e.computed)
            propName = compileSubExpression(scope, e.property);
        else
            propName = hir.wrapImmediate(NT.Identifier.cast(e.property).name);

        var obj: hir.RValue = compileSubExpression(scope, e.object, true, null, null);

        if (!needObj)
            scope.ctx.releaseTemp(obj);
        scope.ctx.releaseTemp(propName);

        var dest: hir.LValue;
        if (need)
            dest = scope.ctx.allocTemp();
        else
            dest = hir.nullReg;

        scope.ctx.builder.genPropGet(dest, obj, propName);

        return { obj: needObj ? obj : null, dest: need ? dest: null };
    }

    function compileMemberExpression (scope: Scope, e: ESTree.MemberExpression, need: boolean): hir.RValue
    {
        return compileMemberExpressionHelper(scope, e, need, false).dest;
    }
}

// NOTE: since we have a very dumb backend (for now), we have to perform some optimizations
// that wouldn't normally be necessary
export function compile (
    m_fileName: string, m_reporter: IErrorReporter, m_options: Options, m_doneCB: () => void
): void
{
    var m_globalContext: FunctionContext;
    var m_input: string;
    var m_moduleBuilder = new hir.ModuleBuilder(m_options.debug);

    compileProgram();
    fireCB();
    return;

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

    function location (node: ESTree.Node): ESTree.SourceLocation
    {
        if (!node.loc) {
            var pos = acorn.getLineInfo(m_input, node.start);
            return { source: m_fileName, start: pos, end: pos };
        } else {
            return node.loc;
        }
    }

    function fireCB (): void
    {
        if (!m_doneCB)
            return;
        var cb = m_doneCB;
        m_doneCB = null;
        process.nextTick(cb);
    }

    function compileProgram (): void
    {
        var topLevelBuilder = m_moduleBuilder.createTopLevel();

        m_globalContext = new FunctionContext(null, null, topLevelBuilder.name, topLevelBuilder);
        m_globalContext.strictMode = m_options.strictMode;

        var core = compileModule(m_globalContext, "runtime/js/core.js");
        if (m_reporter.errorCount() > 0)
            return;

        var moduleCtx = compileModule(core, m_fileName);
        if (m_reporter.errorCount() > 0)
            return;
        moduleCtx.close();

        // Call the module
        core.builder.genCall(hir.nullReg, moduleCtx.builder.closureVar, [hir.undefinedValue] );
        moduleCtx.builder.setVarAttributes(moduleCtx.builder.closureVar, false, true, true, moduleCtx.builder);

        core.close();
        topLevelBuilder.close();
        m_moduleBuilder.prepareForCodegen();

        if (m_options.dumpHIR)
            core.builder.dump();

        if (!m_options.dumpAST && !m_options.dumpHIR)
            produceOutput();
    }

    function compileModule (parentContext: FunctionContext, fileName: string): FunctionContext
    {
        var name = "<"+fileName+">";
        var moduleCtx = new FunctionContext(
            parentContext, parentContext.funcScope, name, parentContext.builder.newClosure(name)
        );

        compileSource(moduleCtx.funcScope, moduleCtx.funcScope, fileName, m_reporter, m_options);
        return moduleCtx;
    }

    function stripPathAndExtension (fn: string): string
    {
        var pos = fn.lastIndexOf(".");
        if (pos > 0)
            fn = fn.slice(0, pos);
        pos = fn.lastIndexOf("/");
        if (pos > 0)
            fn = fn.slice(pos+1, fn.length);
        return fn;
    }

    function produceOutput () {
        if (m_options.sourceOnly) {
            if (m_options.outputName === "-") { // output to pipe?
                m_moduleBuilder.generateC(process.stdout);
            } else {
                var ext = ".cxx";
                var outName: string = null;

                if (m_options.outputName !== null) {
                    outName = m_options.outputName;
                    if (outName.lastIndexOf(".") <= 0) // if no extension, add one (note that "." at pos 0 is not an ext)
                        outName += ext;
                } else {
                    outName = stripPathAndExtension(m_fileName) + ext;
                }

                try {
                    var fd = fs.openSync(outName, "w");
                    var out = fs.createWriteStream(null, {fd: fd});
                    m_moduleBuilder.generateC(out);
                    out.end();
                    out.once("error", (e: any) => {
                        error(null, e.message);
                        fireCB();
                    });
                    out.once("finish", () => fireCB());
                } catch (e) {
                    error(null, e.message);
                }
            }
        } else {
            var ext = m_options.compileOnly ? ".o" : "";
            var outName: string = null;

            if (m_options.outputName !== null) {
                outName = m_options.outputName;
                if (outName.lastIndexOf(".") <= 0) // if no extension, add one (note that "." at pos 0 is not an ext)
                    outName += ext;
            } else {
                outName = stripPathAndExtension(m_fileName) + ext;
            }

            var cc = "c++";
            if (process.env["CC"])
                cc = process.env["CC"];
            var cflags: string[] = [];
            if (process.env["CFLAGS"])
                cflags = process.env["CFLAGS"].split(" ");

            var args: string[] = [];

            if (m_options.runtimeIncDir)
                args.push("-I" + m_options.runtimeIncDir);
            m_options.includeDirs.forEach((d) => args.push("-I"+d));

            args.push("-xc++", "--std=c++11");
            if (cflags.length > 0) {
                args = args.concat(cflags);
            } else {
                if (m_options.debug)
                    args.push("-g");
                else
                    args.push("-O1");
            }
            if (m_options.debug)
                args.push("-DJS_DEBUG");

            if (m_options.compileOnly) {
                args.push("-c");
            } else {
                if (m_options.runtimeLibDir)
                    args.push("-L"+m_options.runtimeLibDir);
                m_options.libDirs.forEach((d) => args.push("-L"+d));
                args.push("-ljsruntime");
            }
            args.push("-o", outName);
            args.push("-");

            if (m_options.verbose)
                console.log(cc, args.join(" "));

            var child = child_process.spawn(
                cc,
                args,
                {stdio: ['pipe', process.stdout, process.stderr] }
            );
            child.stdin.once("error", (e: any) => {
                error(null, e.message);
            });
            child.stdin.write(util.format("#line 1 \"%s\"\n", m_fileName));
            m_moduleBuilder.generateC(child.stdin);
            child.stdin.end();
            child.once("error", (e: any) => {
                error(null, e.message);
                fireCB();
            });
            child.once("exit", (code: number, signal: string) => {
                if (code !== 0)
                    error(null, "child process terminated with code "+ code);
                else if (signal)
                    error(null, "child process terminated with an error");
                fireCB();
            });
        }
    }
}
