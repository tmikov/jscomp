// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./estree-x.d.ts" />

import fs = require("fs");
import path = require("path");
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
    moduleDirs: string[] = [];
    includeDirs: string[] = [];
    libDirs: string[] = [];
    libs: string[] = ["pcre2-8", "jsruntime", "dtoa"];
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
    readOnly: boolean = false;
    constantValue: hir.RValue = null;
    declared: boolean = false;
    initialized: boolean = false; //< function declarations and built-in values like 'this'
    assigned: boolean = false;
    accessed: boolean = false;
    escapes: boolean = false;
    /**
     * Prevent this variable from being marked as escaping when accessed in 'try' block. We mark all
     * variables accessed in a try block as escaping, very conservatively, because we currently lack
     * the ability to analyze liveness. However in some specific cases we do know that the variable
     * doesn't need to be escaped, and there this flag comes along.
     */
    overrideEscapeInTryBlocks: boolean = false;
    funcRef: hir.FunctionBuilder = null;
    consRef: hir.FunctionBuilder = null;

    hvar: hir.Var = null;

    constructor (ctx: FunctionContext, name: string)
    {
        this.ctx = ctx;
        this.name = name;
    }

    setConstant (constantValue: hir.RValue): void
    {
        this.readOnly = true;
        this.constantValue = constantValue;
    }

    setAccessed (need: boolean, ctx: FunctionContext): void
    {
        if (need) {
            this.accessed = true;
            // Note: if we are inside a try block, we mark all variables as escaping
            // it pessimizes the code a lot, but for now guarantees correctness
            if (ctx !== this.ctx || (ctx.tryStack.length && !this.overrideEscapeInTryBlocks))
                this.escapes = true;
        }
    }
    setAssigned (ctx: FunctionContext): void
    {
        this.assigned = true;
        // Note: if we are inside a try block, we mark all variables as escaping
        // it pessimizes the code a lot, but for now guarantees correctness
        if (ctx !== this.ctx || (ctx.tryStack.length && !this.overrideEscapeInTryBlocks))
            this.escapes = true;
    }
}

class Scope
{
    ctx: FunctionContext;
    /**
     * A scope where the 'var'-s bubble up to. Normally, in JavaScript only function scopes do
     * that (in C every scope is like that), but we would like the ability to designate other
     * scopes with such behavior for source transformations.
     */
    isVarScope: boolean = false;
    parent: Scope;
    level: number;
    varScope: Scope; // reference to the closest 'var scope'
    private vars: StringMap<Variable>;

    constructor (ctx: FunctionContext, isVarScope: boolean, parent: Scope)
    {
        this.ctx = ctx;
        this.isVarScope = isVarScope;
        this.parent = parent;
        this.level = parent ? parent.level + 1 : 0;
        this.varScope = isVarScope || !parent ? this : parent.varScope;
        this.vars = new StringMap<Variable>();
    }

    newVariable (name: string, hvar?: hir.Var): Variable
    {
        var variable = new Variable(this.ctx, name);
        variable.hvar = hvar ? hvar : this.ctx.builder.newVar(name);
        this.setVar(variable);
        return variable;
    }
    newAnonymousVariable (name: string, hvar?: hir.Var): Variable
    {
        var variable = new Variable(this.ctx, name);
        variable.hvar = hvar ? hvar : this.ctx.builder.newVar(name);
        this.setAnonymousVar(variable);
        return variable;
    }
    newConstant (name: string, value: hir.RValue): Variable
    {
        var variable = new Variable(this.ctx, name);
        variable.setConstant(value);
        this.setVar(variable);
        variable.declared = true;
        variable.initialized = true;
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
    setAnonymousVar (v: Variable): void
    {
        this.ctx.vars.push(v);
    }

    lookup (name: string, lastScope?: Scope): Variable
    {
        var v: Variable;
        var scope = this;
        do {
            if (v = scope.vars.get(name))
                return v;
            if (scope === lastScope)
                break;
        } while (scope = scope.parent);
        return null;
    }
}

const enum LabelKind
{
    INTERNAL,
    LOOP,
    SWITCH,
    NAMED,
}

class Label
{
    prev: Label = null;

    constructor (
        public kind: LabelKind,
        public name: string, public loc: ESTree.SourceLocation,
        public breakLab: hir.Label, public continueLab: hir.Label
    )
    {}
}

class TryBlock
{
    topLabel: Label; //< the top of the label stack at the moment this block was created
    controlVar: Variable;
    exitHandler: hir.Label;
    // Keep track of all jumps crossing a 'try' handler and assign consecutive
    // numbers to each
    jumpsSet: { [key: number]: number } = Object.create(null);
    outgoingJumps: hir.Label[] = [];

    constructor(topLabel: Label, controlVar: Variable, exitHandler: hir.Label)
    {
        this.topLabel = topLabel;
        this.controlVar = controlVar;
        this.exitHandler = exitHandler;
    }

    // Adds a jump target and returns the value that should be set in the control variable to
    // go there through the finally block
    addJump (target: hir.Label): number
    {
        var n: any;
        if ((n = this.jumpsSet[target.id]) !== void 0)
            return <number>n;
        var index = this.outgoingJumps.length;
        this.outgoingJumps.push(target);
        this.jumpsSet[target.id] = index;
        return index;
    }
}

class FunctionContext
{
    parent: FunctionContext;
    name: string;
    strictMode: boolean;

    scope: Scope;
    thisParam: Variable;
    argumentsVar: Variable = null;

    labelList: Label = null;
    labels = new StringMap<Label>();
    /** Used for 'return' from blocks guarded with try/finally */
    returnPad: Label = null;
    returnValue: Variable = null;
    tryStack: TryBlock[] = [];

    vars: Variable[] = [];

    builder: hir.FunctionBuilder = null;

    private tempStack: hir.Local[] = [];

    constructor (parent: FunctionContext, parentScope: Scope, name: string, builder: hir.FunctionBuilder)
    {
        this.parent = parent;
        this.name = name || null;
        this.builder = builder;

        this.strictMode = parent && parent.strictMode;
        this.scope = new Scope(this, true, parentScope);

        this.thisParam = this.addParam("this");

        this.returnPad = new Label(LabelKind.INTERNAL, null, null, this.builder.newLabel(), null);
        this.pushLabel(this.returnPad);
    }

    close (): void
    {
        this.vars.forEach( (v: Variable) => {
            if (v.hvar)
                this.builder.setVarAttributes(v.hvar,
                    v.escapes, v.accessed || v.assigned, v.initialized && !v.assigned, v.funcRef, v.consRef
                );
        });

        this.builder.close();
    }

    findLabel (name: string): Label
    {
        return this.labels.get(name);
    }

    findAnonBreakContinueLabel (isBreak: boolean): Label
    {
        for ( var label = this.labelList; label; label = label.prev ) {
            if (!label.name) {
                switch (label.kind) {
                    case LabelKind.LOOP:
                        return label;
                    case LabelKind.SWITCH:
                    case LabelKind.NAMED:
                        if (isBreak)
                            return label;
                        break;
                }
            }
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

    pushTryBlock (): TryBlock
    {
        var controlVar = this.scope.newAnonymousVariable("");
        controlVar.overrideEscapeInTryBlocks = true;
        var tryBlock = new TryBlock(this.labelList, controlVar, this.builder.newLabel());
        this.tryStack.push(tryBlock);
        return tryBlock;
    }
    popTryBlock (tryBlock: TryBlock): void
    {
        var popped = this.tryStack.pop();
        assert(popped === tryBlock);
    }

    /**
     * Generate a goto to a label in the label stack. Normally it would be a very simple operation, but it is
     * complicated by the presence of try blocks. If our jump crosses such a block, it must execute its exit handler.
     * To do that, we must either inline the contents of the exit handler before we do the jump (that is what production
     * compilers do, as far as I can tell), or we can apply our strategy (described below), which is simpler to
     * implement and hopefully leads to less code bloat, possibly with some performance cost (though I would argue
     * that try blocks have never been the paragon of performance). Anyway, our long term plan is to eventually
     * do the inlining, which enables more optimization, but for now this is simpler.
     *
     * The code in each exit handler is generated only once and has a 'control variable' assigned to it. The value
     * of the variable determines where to jump after the block executes. Note that 'return' is also just a goto.
     *
     * Nested try blocks are also handled naturally by this scheme where the inner one jumps to the outer
     * one after executing.
     *
     * Example:
     * <pre>
     *   function () {
     *     try {
     *       if (foo)
     *            return;
     *       bar;
     *     } finally {
     *       baz;
     *     }
     *     bla;
     * }
     * </pre>
     * It should produce code (conceptually) looking like:
     * <pre>
     *     var control_var;
     *     if (setjmp(...) != 0) goto EXC_HANDLER;
     *     if (foo) {
     *          control_var = 1;
     *          goto FIN_HANDLER;
     *     }
     *     bar;
     *     control_var = 2;
     *     goto FIN_HANDLER;
     * EXC_HANDLER:
     *     control_var = 0;
     *     goto FIN_HANDLER;
     * FIN_HANDLER:
     *     baz;
     *     switch (control_var) {
     *     case 0: rethrow_exception();
     *     case 1: goto EXIT;
     *     case 2: goto B1;
     *     }
     * B1:
     *     bla;
     *     goto EXIT;
     * EXIT:
     *     return;
     * </pre>
     */
    genGoto (label: Label, target: hir.Label): void
    {
        var lowestIndex: number; // lowest index in tryStack
        var highestIndex: number = -1; // highest index in tryStack

        // Check which try blocks we are crossing with this jump. To accomplish that, we walk backwards
        // the label stack until after we find our target label. These are all the active labels we could potentially
        // ever cross. In the process, each time we match the current label from the label stack to the top of tryStack,
        // we mark it as being crossed and move to the next element in tryStack
        var tryIndex: number = this.tryStack.length - 1;
        for ( var curLab = this.labelList; curLab && tryIndex >= 0; curLab = curLab.prev ) {
            for ( ; tryIndex >= 0 && this.tryStack[tryIndex].topLabel === curLab; --tryIndex ) {
                if (highestIndex < 0)
                    highestIndex = tryIndex;
                lowestIndex = tryIndex;
            }

            if (curLab === label)
                break;
        }

        if (highestIndex < 0) { // A simple jump, not crossing any try/finally blocks
            this.builder.genGoto(target);
            return;
        }

        var curTarget = target;
        for ( tryIndex = lowestIndex; tryIndex <= highestIndex; ++tryIndex ) {
            var block = this.tryStack[tryIndex];
            var controlValue = block.addJump(curTarget);
            block.controlVar.setAssigned(this);
            this.builder.genAssign(block.controlVar.hvar, hir.wrapImmediate(controlValue));
            curTarget = block.exitHandler;
        }

        this.builder.genGoto(curTarget);
    }

    genReturn (value: hir.RValue): void
    {
        this.releaseTemp(value);
        if (!this.tryStack.length) { // simple case, no exception blocks to worry about
            this.builder.genRet(value);
            return;
        }

        if (!this.returnValue) {
            this.returnValue = this.scope.newAnonymousVariable("returnValue");
            this.returnValue.overrideEscapeInTryBlocks = true;
        }

        this.returnValue.setAssigned(this);
        this.builder.genAssign(this.returnValue.hvar, value);
        this.genGoto(this.returnPad, this.returnPad.breakLab);

        if (!this.returnPad.breakLab.bb) { // If we haven't generated the return pad yet
            this.builder.genLabel(this.returnPad.breakLab);
            this.returnValue.setAccessed(true, this);
            this.builder.genRet(this.returnValue.hvar);
        }
    }

    genTryBlockSwitch (tryBlock: TryBlock): void
    {
        // Dispatch every outgoing jump to its actual destination
        var values: number[] = new Array<number>(tryBlock.outgoingJumps.length);
        for ( var i = 0; i < values.length; ++i )
            values[i] = i;
        tryBlock.controlVar.setAccessed(true, this);
        this.builder.genSwitch(tryBlock.controlVar.hvar, null, values, tryBlock.outgoingJumps);
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
            //for ( var i = this.tempStack.length - 1; i >= 0; --i )
            //    assert(this.tempStack[i] !== l, `Re-inserting temp ${l.id}`);
            this.tempStack.push(l);
        }
    }

    public addClosure (name: string): hir.FunctionBuilder
    {
        return this.builder.newClosure(name);
    }
    public addBuiltinClosure (name: string, mangledName: string, runtimeVar: string): hir.FunctionBuilder
    {
        return this.builder.newBuiltinClosure(name, mangledName, runtimeVar);
    }

    public addParam (name: string): Variable
    {
        var param = this.builder.newParam(name);
        var v = this.scope.newVariable(name, param.variable);

        v.initialized = true;
        v.declared = true;

        return v;
    }
}

class Module
{
    id: string;
    path: string;
    printable: string;
    notFound: boolean;
    modVar: Variable = null;

    constructor (id: string, path: string)
    {
        this.id = id;
        this.path = path;
        this.printable = id;
        this.notFound = path === null;
    }

}

function startsWith (big: string, prefix: string): boolean
{
    return big.length >= prefix.length && big.slice(0, prefix.length) === prefix;
}

function checkReadAccess (p: string): boolean
{
    try { (<any>fs).accessSync(p, (<any>fs).R_OK); } catch (e) {
        return false;
    }
    return true;
}

class Modules
{
    private resolved = new StringMap<Module>();
    private queue: Module[] = [];
    public paths: string[] = [];

    constructor (paths: string[])
    {
        // Make sure all paths are absolute
        for (var i = 0; i < paths.length; ++i )  {
            if (paths[i])
                this.paths.push(path.isAbsolute(paths[i]) ? paths[i] : path.resolve(paths[i]));
        }
    }

    private resolvePath (trypath: string): string
    {
        try {
            var pkg = JSON.parse(fs.readFileSync(path.join(trypath, "package.json"), "utf-8"));
            if (pkg["main"])
                trypath = path.resolve(trypath, pkg["main"]);
            else
                trypath = path.join(trypath, "index.js");
        } catch (e) {
        }

        if (!path.extname(trypath))
            trypath += ".js";

        return checkReadAccess(trypath) ? trypath : null;
    }

    private tryResolve (dirname: string, modname: string): Module
    {
        var trypath = path.resolve(dirname, modname);
        var m: Module;

        if (m = this.resolved.get(trypath))
            return m;

        var resolved = this.resolvePath(trypath);

        if (resolved) {
            m = new Module(trypath, resolved);
            this.resolved.set(trypath, m);
            this.queue.push(m);
            return m;
        } else {
            return null;
        }
    }

    resolve (dirname: string, modname: string): Module
    {
        var m: Module;

        if (startsWith(modname, "./") || startsWith(modname, "../") || path.isAbsolute(modname)) {
            if (m = this.tryResolve(dirname, modname))
                return m;
            modname = path.resolve(dirname, modname);
        } else {
            if (m = this.tryResolve(path.join(dirname, "node_modules"), modname))
                return m;
            for (var i = 0; i < this.paths.length; ++i ) {
                if (m = this.tryResolve(this.paths[i], modname))
                    return m;
            }
        }

        // Register it as failed to resolve
        m = new Module(modname, null);
        this.resolved.set(modname, m);
        this.queue.push(m);
        return m;
    }

    next (): Module
    {
        return this.queue.length > 0 ? this.queue.shift() : null;
    }
}

class Runtime
{
    ctx: FunctionContext;
    moduleRequire: Variable = null;
    defineModule: Variable = null;
    _defineAccessor: Variable = null;
    regExp: Variable = null;
    runtimeInit: Variable = null;

    constructor (ctx: FunctionContext)
    {
        this.ctx = ctx;
    }

    public lookupSymbols (coreScope: Scope): void
    {
        if (!this.moduleRequire)
            this.moduleRequire = coreScope.lookup("moduleRequire");
        if (!this.defineModule)
            this.defineModule = coreScope.lookup("defineModule");
        if (!this._defineAccessor)
            this._defineAccessor = coreScope.lookup("_defineAccessor");
        if (!this.regExp)
            this.regExp  = coreScope.lookup("$RegExp");
        if (!this.runtimeInit)
            this.runtimeInit = coreScope.lookup("runtimeInit");
    }

    public allSymbolsDefined (): boolean
    {
        return !!(
            this.moduleRequire &&
            this.defineModule &&
            this._defineAccessor &&
            this.regExp &&
            this.runtimeInit
        );
    }
}

class SpecialVars
{
    require: Variable = null;
    _defineAccessor: Variable = null;
    regExp: Variable = null;

    constructor (r?: Runtime)
    {
        if (r) {
            this.require = r.moduleRequire;
            this._defineAccessor = r._defineAccessor;
            this.regExp = r.regExp;
        }
    }
}

class AsmBinding {
    public used: boolean = false;
    public hv: hir.RValue = null;
    public result: boolean = false;
    constructor(public index: number, public name: string, public e: ESTree.Expression) {}
}

/** A property descriptor in an "ObjectExpression" */
class ObjectExprProp
{
    public value: ESTree.Expression = null;
    public getter: ESTree.FunctionExpression = null;
    public setter: ESTree.FunctionExpression = null;

    constructor(public name: string)
    {}
}

function compileSource (
    m_scope: Scope, m_undefinedVarScope: Scope,
    m_fileName: string, m_reporter: IErrorReporter,
    m_specVars: SpecialVars, m_modules: Modules,
    m_options: Options
): boolean
{
    var m_absFileName = path.resolve(m_fileName);
    var m_dirname = path.dirname(m_absFileName);
    var m_input: string;
    var m_errors = 0;

    if (m_options.verbose)
        console.log("Compiling", m_fileName);

    compileIt();
    return m_errors === 0;

    function compileIt (): void
    {
        function adjustRegexLiteral(key: any, value: any)
        {
            if (key === 'value' && value instanceof RegExp) {
                value = value.toString();
            }
            return value;
        }

        var prog: ESTree.Program;
        if ((prog = parse(m_fileName))) {
            if (m_options.dumpAST) {
                // Special handling for regular expression literal since we need to
                // convert it to a string literal, otherwise it will be decoded
                // as object "{}" and the regular expression would be lost.

                console.log(JSON.stringify(prog, adjustRegexLiteral, 4));
            }

            compileBody(m_scope, prog.body, prog, false);
        }
    }

    function error (loc: ESTree.SourceLocation, msg: string)
    {
        ++m_errors;
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

    function setSourceLocation (target: hir.SourceLocation, node: ESTree.Node): void
    {
        var loc = location(node);
        hir.setSourceLocation(target, loc.source, loc.start.line, loc.start.column);
    }

    function parse (fileName: string): ESTree.Program
    {
        var options: acorn.Options = {
            strict: m_options.strictMode,
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

    function compileFunction (parentScope: Scope, ast: ESTree.Function, funcRef: hir.FunctionBuilder): FunctionContext
    {
        var funcCtx = new FunctionContext(parentScope && parentScope.ctx, parentScope, funcRef.name, funcRef);
        var funcScope = funcCtx.scope;

        setSourceLocation(funcCtx.builder, ast);

        // Declare the parameters
        // Create a HIR param+var binding for each of them
        ast.params.forEach( (pat: ESTree.Pattern): void => {
            var ident = NT.Identifier.cast(pat);

            var v: Variable;
            if (v = funcScope.getVar(ident.name)) {
                (funcCtx.strictMode ? error : warning)(location(ident), `parameter '${ident.name}' already declared`);
                // Overwrite the assigned hvar. When we have duplicate parameter names, the last one wins
                var param = funcCtx.builder.newParam(ident.name);
                v.hvar = param.variable;
            } else {
                funcCtx.addParam(ident.name);
            }
        });

        var builder = funcCtx.builder;
        var entryLabel = builder.newLabel();
        var nextLabel = builder.newLabel();
        builder.genLabel(entryLabel);
        builder.genGoto(nextLabel);
        builder.genLabel(nextLabel);

        var bodyBlock: ESTree.BlockStatement;
        if (bodyBlock = NT.BlockStatement.isTypeOf(ast.body))
            compileBody(funcScope, bodyBlock.body, bodyBlock, true);
        else
            error(location(ast.body), "ES6 not supported");

        if (funcCtx.argumentsVar && funcCtx.argumentsVar.accessed) {
            var bb = builder.getCurBB();
            builder.closeBB();
            builder.openLabel(entryLabel);
            builder.genCreateArguments(funcCtx.argumentsVar.hvar);
            builder.openBB(bb);
        }

        funcCtx.close();

        return funcCtx;
    }

    /**
     *
     * @param scope
     * @param body
     * @param parentNode the parent node of 'body' used only for error location
     * @param functionBody is this a function body (whether to generate 'arguments')
     */
    function compileBody (scope: Scope, body: ESTree.Statement[], parentNode: ESTree.Node, functionBody: boolean): void
    {
        var startIndex: number = 0;
        if (body.length && matchStrictMode(body[0])) {
            startIndex = 1;
            if (!scope.ctx.strictMode) {
                scope.ctx.strictMode = true;
                note(location(body[0]), "strict mode enabled");
            }
        }

        // Scan for declarations
        for (var i = startIndex, e = body.length; i < e; ++i)
            scanStatementForDeclarations(scope, body[i]);

        if (functionBody) {
            if (scope.lookup("arguments", scope.ctx.scope)) {
                warning(location(parentNode), "'arguments' bound to a local");
            } else {
                var ctx = scope.ctx;
                ctx.argumentsVar = ctx.scope.newVariable("arguments");
                ctx.argumentsVar.declared = true;
                ctx.argumentsVar.initialized = true;
            }
        }

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
                scanVariableDeclaration(scope, NT.VariableDeclaration.cast(stmt));
                break;
        }
    }

    function scanFunctionDeclaration (scope: Scope, stmt: ESTree.FunctionDeclaration): void
    {
        var ctx = scope.ctx;
        var varScope = scope.varScope;
        var name = stmt.id.name;

        var variable = varScope.getVar(name);
        if (variable && variable.readOnly) {
            (scope.ctx.strictMode ? error : warning)(location(stmt), `initializing read-only symbol '${variable.name}'`);
            variable = new Variable(ctx, name);
            varScope.setAnonymousVar(variable);
        } else if (variable) {
            if (variable.funcRef)
                warning( location(stmt),  `hiding previous declaration of function '${variable.name}'` );
        } else {
            variable = new Variable(ctx, name);
            varScope.setVar(variable);
        }
        variable.declared = true;
        variable.funcRef = ctx.addClosure(stmt.id && stmt.id.name);
        variable.hvar = variable.funcRef.closureVar;

        if (!variable.initialized && !variable.assigned)
            variable.initialized = true;
        else
            variable.setAssigned(ctx)
        variable.setAccessed(true, ctx);

        stmt.variable = variable;
    }

    function scanVariableDeclaration (scope: Scope, stmt: ESTree.VariableDeclaration): void
    {
        var varScope = scope.varScope;

        stmt.declarations.forEach((vd: ESTree.VariableDeclarator) => {
            var ident = NT.Identifier.isTypeOf(vd.id);
            if (ident) {
                var v: Variable = varScope.getVar(ident.name);

                if (v && vd.init && v.readOnly) {
                    (scope.ctx.strictMode ? error : warning)(location(vd), `re-declaring read-only symbol '${ident.name}'`);
                    v = varScope.newAnonymousVariable(ident.name);
                } else if (!v) {
                    v = varScope.newVariable(ident.name);
                }
                v.declared = true;

                if (!v.hvar)
                    v.hvar = scope.ctx.builder.newVar(v.name);

                vd.variable = v;
            } else {
                error(location(ident), "ES6 pattern not supported");
            }
        });
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
                compileThrowStatement(scope, NT.ThrowStatement.cast(stmt));
                break;
            case "TryStatement":
                compileTryStatement(scope, NT.TryStatement.cast(stmt));
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
                compileForInStatement(scope, NT.ForInStatement.cast(stmt));
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
                scope.ctx.pushLabel(new Label(LabelKind.LOOP, null, location(forOfStatement), breakLab, continueLab));
                compileStatement(scope, forOfStatement.body, stmt);
                scope.ctx.builder.genLabel(breakLab);
                scope.ctx.popLabel();
                break;
            case "DebuggerStatement":
                warning(location(stmt), "'debugger' is not implemented yet");
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

            var label = new Label(LabelKind.NAMED, stmt.label.name, loc, breakLab, null);
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
            if (!(label = scope.ctx.findAnonBreakContinueLabel(true))) {
                error(location(stmt), "'break': there is no surrounding loop");
                return;
            }
        }
        scope.ctx.genGoto(label, label.breakLab);
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
            if (!(label = scope.ctx.findAnonBreakContinueLabel(false))) {
                error(location(stmt), "'continue': there is no surrounding loop");
                return;
            }
        }
        scope.ctx.genGoto(label, label.continueLab);
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
        // The integer cases
        var intCase: boolean[] = new Array<boolean>(stmt.cases.length);
        var dupCase: boolean[] = new Array<boolean>(stmt.cases.length);

        for ( var i = 0; i < stmt.cases.length; ++i )
            labels[i] = ctx.builder.newLabel();

        var discr = compileExpression(scope, stmt.discriminant, true, null, null);
        if (hir.isImmediate(discr))
            warning(location(stmt.discriminant), "'switch' expression is constant");

        var intValueSet: { [key: string]: number } = Object.create(null);
        var intValues: number[] = [];
        var intTargets: hir.Label[] = [];
        var nonIntCount = 0; // count of values who are not integer constants
        var defaultLabel: hir.Label = null;
        var elseLabel: hir.Label = null;

        // Find the integer constant cases
        for ( var i = 0; i < stmt.cases.length; ++i ) {
            if (!stmt.cases[i].test) {
                assert(!defaultLabel);
                defaultLabel = labels[i];
                continue;
            }
            var rv = tryFoldExpression(scope, stmt.cases[i].test);
            if (rv !== null  && hir.isImmediateInteger(rv)) {
                intCase[i] = true;
                var nv = hir.unwrapImmedate(rv) | 0;
                var snv = String(nv);
                if (!(snv in intValueSet)) {
                    intValueSet[snv] = nv;
                    intValues.push(nv);
                    intTargets.push(labels[i]);
                } else {
                    warning(location(stmt.cases[i].test), `duplicate switch case '${nv}'`);
                    dupCase[i] = true;
                }
            } else {
                ++nonIntCount;
            }
        }

        // Not worth it for just one integer case
        if (intValues.length < 2)
            intValues.length = 0;

        // If we have integer cases, generate a SWITCH table for them
        if (intValues.length) {
            if (nonIntCount > 0)
                elseLabel = ctx.builder.newLabel();
            var failLabel = elseLabel || defaultLabel || breakLab;
            var goodLabel = ctx.builder.newLabel();

            // Check if discr is an integer
            var idiscr = ctx.allocTemp();
            ctx.builder.genBinop(hir.OpCode.OR_N, idiscr, discr, hir.wrapImmediate(0));
            ctx.builder.genIf(hir.OpCode.IF_STRICT_EQ, idiscr, discr, goodLabel, failLabel);

            ctx.builder.genLabel(goodLabel);
            ctx.releaseTemp(idiscr);
            ctx.builder.genSwitch(idiscr, failLabel, intValues, intTargets);

            if (elseLabel) {
                ctx.builder.genLabel(elseLabel);
                elseLabel = null;
            }
        }

        for ( var i = 0; i < stmt.cases.length; ++i ) {
            var sc = stmt.cases[i];
            if (!sc.test)
                continue;
            if (dupCase[i]) // skip duplicate cases
                continue;
            // Skip integer cases, but only if we decided there were enough of them
            if (intValues.length && intCase[i])
                continue;

            if (elseLabel !== null)
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

        scope.ctx.pushLabel(new Label(LabelKind.SWITCH, null, location(stmt), breakLab, null));

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

        scope.ctx.genReturn(value);
    }

    function compileThrowStatement (scope: Scope, stmt: ESTree.ThrowStatement): void
    {
        var value = compileExpression(scope, stmt.argument, true, null, null);
        scope.ctx.builder.genThrow(value);
    }

    function fillContinueInNamedLoopLabels (labels: Label[], continueLab: hir.Label): void
    {
        if (labels)
            for ( var i = 0, e = labels.length; i < e; ++i ) {
                assert(labels[i].kind === LabelKind.NAMED);
                labels[i].kind = LabelKind.LOOP;
                labels[i].continueLab = continueLab;
            }
    }

    function compileTryStatement (scope: Scope, stmt: ESTree.TryStatement): void
    {
        compileFinally(scope, stmt);

        function compileCatch (scope: Scope, stmt: ESTree.TryStatement): void
        {
            if (!stmt.handler)
                return compileStatement(scope, stmt.block, stmt);

            var ctx = scope.ctx;
            var exitLabel = new Label(LabelKind.INTERNAL, null, null, ctx.builder.newLabel(), null);
            ctx.pushLabel(exitLabel);

            var onNormal = ctx.builder.newLabel();
            var onException = ctx.builder.newLabel();
            var tryId = ctx.builder.genBeginTry(onNormal, onException);
            var tryBlock = ctx.pushTryBlock();

            ctx.builder.genLabel(onNormal);
            compileStatement(scope, stmt.block, stmt);

            if (!tryBlock.outgoingJumps.length) {
                // Fast case when there are no outgoing jumps
                ctx.popTryBlock(tryBlock);
                ctx.builder.genLabel(tryBlock.exitHandler);
                ctx.builder.genEndTry(tryId);
                ctx.builder.genGoto(exitLabel.breakLab);
            } else {
                // Slow case - there are outgoing jumps and the ending of the try block must be treated as one
                // Generate an indirect jump to the "normal code" after the block
                ctx.genGoto(exitLabel, exitLabel.breakLab);

                ctx.popTryBlock(tryBlock);

                ctx.builder.genLabel(tryBlock.exitHandler);
                ctx.builder.genEndTry(tryId);

                // Dispatch every outgoing jump to its actual destination
                ctx.genTryBlockSwitch(tryBlock);
            }

            var catchIdent: ESTree.Identifier = NT.Identifier.cast(stmt.handler.param);
            if (stmt.handler.guard)
                error(location(stmt.handler.guard), "catch guards not supported in ES5");

            var catchScope = new Scope(scope.ctx, false, scope);
            var catchVar = catchScope.newVariable(catchIdent.name);
            catchVar.declared = true;

            ctx.builder.genLabel(onException);
            catchVar.setAssigned(ctx);
            ctx.builder.genAssign(catchVar.hvar, hir.lastThrownValueReg);
            ctx.builder.genAssign(hir.lastThrownValueReg, hir.undefinedValue);
            ctx.builder.genEndTry(tryId);
            compileStatement(catchScope, stmt.handler.body, stmt);
            ctx.builder.genGoto(exitLabel.breakLab);

            ctx.popLabel();
            ctx.builder.genLabel(exitLabel.breakLab);
        }

        function compileFinally (scope: Scope, stmt: ESTree.TryStatement): void
        {
            if (!stmt.finalizer)
                return compileCatch(scope, stmt);

            var ctx = scope.ctx;
            var exitLabel = new Label(LabelKind.INTERNAL, null, null, ctx.builder.newLabel(), null);
            ctx.pushLabel(exitLabel);
            var exceptionLabel = new Label(LabelKind.INTERNAL, null, null, ctx.builder.newLabel(), null);
            ctx.pushLabel(exceptionLabel);

            var onNormal = ctx.builder.newLabel();
            var onException = ctx.builder.newLabel();
            var tryId = ctx.builder.genBeginTry(onNormal, onException);
            var tryBlock = ctx.pushTryBlock();

            ctx.builder.genLabel(onNormal);
            compileCatch(scope, stmt);

            // The ending of the try block must be treated as an outgoing jump
            // Generate an indirect jump to the "normal code" after the block. It will go through the exit handler
            ctx.genGoto(exitLabel, exitLabel.breakLab);

            ctx.builder.genLabel(onException);
            var saveLastThrown = ctx.allocTemp();
            ctx.builder.genAssign(saveLastThrown, hir.lastThrownValueReg);

            ctx.genGoto(exceptionLabel, exceptionLabel.breakLab);

            ctx.popTryBlock(tryBlock);

            ctx.builder.genLabel(tryBlock.exitHandler);
            ctx.builder.genEndTry(tryId);
            compileStatement(scope, stmt.finalizer, stmt);

            // Dispatch every outgoing jump to its actual destination
            ctx.genTryBlockSwitch(tryBlock);

            ctx.popLabel();
            ctx.builder.genLabel(exceptionLabel.breakLab);
            ctx.releaseTemp(saveLastThrown);
            ctx.builder.genThrow(saveLastThrown);

            ctx.popLabel();
            ctx.builder.genLabel(exitLabel.breakLab);
        }
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
        scope.ctx.pushLabel(new Label(LabelKind.LOOP, null, location(stmt), exitLoop, loop));
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
        scope.ctx.pushLabel(new Label(LabelKind.LOOP, null, location(stmt), exitLoop, loop));
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
                compileVariableDeclaration(scope, forStatementInitDecl);
            else
                compileExpression(scope, stmt.init);

        ctx.builder.genLabel(loopStart);
        if (stmt.test)
            compileExpression(scope, stmt.test, true, body, exitLoop);
        ctx.builder.genLabel(body);
        scope.ctx.pushLabel(new Label(LabelKind.LOOP, null, location(stmt), exitLoop, loop));
        compileStatement(scope, stmt.body, stmt);
        scope.ctx.popLabel();

        ctx.builder.genLabel(loop);
        if (stmt.update)
            compileExpression(scope, stmt.update);
        ctx.builder.genGoto(loopStart);
        ctx.builder.genLabel(exitLoop);
    }

    function compileForInStatement (scope: Scope, stmt: ESTree.ForInStatement): void
    {
        var ctx = scope.ctx;
        var exitLoop = ctx.builder.newLabel();
        var loopStart = ctx.builder.newLabel();
        var loop = ctx.builder.newLabel();
        var body = ctx.builder.newLabel();

        fillContinueInNamedLoopLabels(stmt.labels, body);

        var target: ESTree.Expression;
        var forInStatementLeftDecl: ESTree.VariableDeclaration = NT.VariableDeclaration.isTypeOf(stmt.left);
        if (forInStatementLeftDecl) {
            compileVariableDeclaration(scope, forInStatementLeftDecl);
            target = forInStatementLeftDecl.declarations[0].id;
        } else {
            target = stmt.left;
        }

        var experValue = compileExpression(scope, stmt.right, true, null, null);
        var notUndef = ctx.builder.newLabel();
        var notNull = ctx.builder.newLabel();
        ctx.builder.genIf(hir.OpCode.IF_STRICT_EQ, experValue, hir.undefinedValue, exitLoop, notUndef);
        ctx.builder.genLabel(notUndef);
        ctx.builder.genIf(hir.OpCode.IF_STRICT_EQ, experValue, hir.nullValue, exitLoop, notNull);
        ctx.builder.genLabel(notNull);

        ctx.releaseTemp(experValue);
        var obj = ctx.allocTemp();
        ctx.builder.genUnop(hir.OpCode.TO_OBJECT, obj, experValue);

        ctx.releaseTemp(obj);
        var iter = ctx.allocTemp();
        ctx.builder.genMakeForInIterator(iter, obj);

        ctx.builder.genLabel(loopStart);
        var value = ctx.allocTemp();
        var more = ctx.allocTemp();

        ctx.builder.genForInIteratorNext(more, value, iter);
        ctx.releaseTemp(more);
        ctx.builder.genIfTrue(more, body, exitLoop);

        ctx.builder.genLabel(body);
        toLogical(scope, stmt, _compileAssignment(scope, hir.OpCode.ASSIGN, true, target, value, false), false, null, null);
        scope.ctx.pushLabel(new Label(LabelKind.LOOP, null, location(stmt), exitLoop, loop));
        compileStatement(scope, stmt.body, stmt);
        scope.ctx.popLabel();

        ctx.builder.genLabel(loop);
        ctx.builder.genGoto(loopStart);
        ctx.builder.genLabel(exitLoop);

        ctx.releaseTemp(iter);
    }

    function compileFunctionDeclaration (scope: Scope, stmt: ESTree.FunctionDeclaration, parent: ESTree.Statement): void
    {
        if (scope.ctx.strictMode && parent)
            error(location(stmt), "functions can only be declared at top level in strict mode");

        var variable = stmt.variable;
        compileFunction(scope, stmt, variable.funcRef);
    }

    function compileVariableDeclaration (scope: Scope, stmt: ESTree.VariableDeclaration): void
    {
        stmt.declarations.forEach((vd: ESTree.VariableDeclarator) => {
            var variable: Variable = vd.variable;
            if (!variable) {
                // if not present, there was an error that we already reported
            } else if (vd.init) {
                variable.setAssigned(scope.ctx);

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

    function tryFoldExpression (scope: Scope, e: ESTree.Expression): hir.RValue
    {
        return fold(e);

        function foldLiteral (e: ESTree.Literal): hir.RValue
        {
            if (e.regex)
                return null;
            switch (typeof e.value) {
                case "object":
                    if (e.value !== null)
                        return null;
                case "number":
                case "string":
                case "undefined":
                    return hir.wrapImmediate(e.value);
            }
            return null;
        }

        function foldSequence (e: ESTree.SequenceExpression): hir.RValue
        {
            var i: number;
            for ( i = 0; i < e.expressions.length-1; ++i )
                if (fold(e.expressions[i]) === null)
                    return null;

            return fold(e.expressions[i]);
        }

        function foldUnary (e: ESTree.UnaryExpression): hir.RValue
        {
            // Check for the special case of "typeof undefined identifier"
            var ident: ESTree.Identifier;
            if (e.operator === "typeof" && (ident = isUndefinedIdentifier(scope, e.argument)) !== null) {
                if (!ident.warned) {
                    ident.warned = true;
                    warning(location(e.argument), `undefined identifier '${ident.name}'`);
                }
                return hir.wrapImmediate("undefined");
            }

            // Try folding the argument
            var arg = fold(e.argument);
            if (arg === null)
                return null;

            var op: hir.OpCode;

            switch (e.operator) {
                case "-": op = hir.OpCode.NEG_N; break;
                case "+": op = hir.OpCode.TO_NUMBER; break;
                case "~": op = hir.OpCode.BIN_NOT_N; break;
                case "delete": return null;
                case "!": op = hir.OpCode.LOG_NOT; break;
                case "typeof": op = hir.OpCode.TYPEOF; break;
                case "void": return hir.undefinedValue;
                default:
                    return null;
            }

            return hir.foldUnary(op, arg);
        }

        function foldBinary (e: ESTree.BinaryExpression): hir.RValue
        {
            var left = fold(e.left);
            if (left === null)
                return null;
            var right = fold(e.right);
            if (right === null)
                return null;

            var op: hir.OpCode;
            switch (e.operator) {
                case "in":
                case "instanceof": return null;

                case "==":
                    if (!e.warned) {
                        e.warned = true;
                        warning(location(e), "operator '==' is not recommended");
                    }
                    op = hir.OpCode.LOOSE_EQ;
                    break;
                case "!=":
                    if (!e.warned) {
                        e.warned = true;
                        warning(location(e), "operator '!=' is not recommended");
                    }
                    op = hir.OpCode.LOOSE_NE;
                    break;

                case "===": op = hir.OpCode.STRICT_EQ; break;
                case "!==": op = hir.OpCode.STRICT_NE; break;
                case "<":   op = hir.OpCode.LT; break;
                case "<=":  op = hir.OpCode.LE; break;
                case ">":   op = hir.OpCode.GT; break;
                case ">=":  op = hir.OpCode.GE; break;
                case "<<":   op = hir.OpCode.SHL_N; break;
                case ">>":   op = hir.OpCode.ASR_N; break;
                case ">>>":  op = hir.OpCode.SHR_N; break;
                case "+":    op = hir.OpCode.ADD; break;
                case "-":    op = hir.OpCode.SUB_N; break;
                case "*":    op = hir.OpCode.MUL_N; break;
                case "/":    op = hir.OpCode.DIV_N; break;
                case "%":    op = hir.OpCode.MOD_N; break;
                case "|":    op = hir.OpCode.OR_N; break;
                case "^":    op = hir.OpCode.XOR_N; break;
                case "&":    op = hir.OpCode.AND_N; break;
                default:
                    return null;
            }

            return hir.foldBinary(op, left, right);
        }

        function foldLogical (e: ESTree.LogicalExpression): hir.RValue
        {
            var left = fold(e.left);
            if (left === null)
                return null;
            var right = fold(e.right);
            if (right === null)
                return null;

            switch (e.operator) {
                case "||": return hir.isImmediateTrue(left) ? left : right;
                case "&&": return !hir.isImmediateTrue(left) ? left : right;
            }
            return null;
        }

        function foldConditional (e: ESTree.ConditionalExpression): hir.RValue
        {
            var test = fold(e.test);
            if (test === null)
                return null;
            var cons = fold(e.consequent);
            if (cons === null)
                return null;
            var alt = fold(e.alternate);
            if (alt === null)
                return null;

            return hir.isImmediateTrue(test) ? cons : alt;
        }

        // To avoid allocating environments use this for recursion
        function fold (e: ESTree.Expression): hir.RValue
        {
            switch (e.type) {
                case "Literal": return foldLiteral(NT.Literal.cast(e));
                case "SequenceExpression": return foldSequence(NT.SequenceExpression.cast(e));
                case "UnaryExpression": return foldUnary(NT.UnaryExpression.cast(e));
                case "BinaryExpression": return foldBinary(NT.BinaryExpression.cast(e));
                case "LogicalExpression": return foldLogical(NT.LogicalExpression.cast(e));
                case "ConditionalExpression": return foldConditional(NT.ConditionalExpression.cast(e));
            }
            return null;
        }
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
                return compileArrayExpression(scope, NT.ArrayExpression.cast(e), need, onTrue, onFalse);
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
                    compileAssignmentExpression(scope, NT.AssignmentExpression.cast(e), need),
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

    function compileLiteral (scope: Scope, literal: ESTree.Literal, need: boolean): hir.RValue
    {
        if (literal.regex)
            return compileRegexLiteral(scope, <ESTree.RegexLiteral>literal, need);

        if (need) {
            return hir.wrapImmediate(literal.value);
        } else {
            return null;
        }
    }

    function compileRegexLiteral (scope: Scope, regexLit: ESTree.RegexLiteral, need: boolean): hir.RValue
    {
        if (!m_specVars.regExp) {
            error(location(regexLit), "RegExp not initialized yet");
            return hir.nullValue;
        }

        var regex = regexLit.regex;

        // Note: it has probably already been validated by the parser, but validate it again
        // ourselves as parsers don't do it consistently
        try {
            new RegExp(regex.pattern, regex.flags);
        } catch (e) {
            error(location(regexLit), e.message || "invalid RegExp");
            return hir.nullValue;
        }

        if (!need)
            return null;

        var ctx = scope.ctx;

        // Create an anonymous variable in the global scope
        var re = m_scope.newAnonymousVariable("$re");
        re.declared = true;

        var labCreated: hir.Label = ctx.builder.newLabel();
        var labNotCreated: hir.Label = ctx.builder.newLabel();

        ctx.builder.genIfTrue(re.hvar, labCreated, labNotCreated);

        ctx.builder.genLabel(labNotCreated);
        re.setAssigned(ctx);
        m_specVars.regExp.setAccessed(true, ctx);
        var t = ctx.builder.genCall(re.hvar, m_specVars.regExp.hvar, [hir.undefinedValue, regex.pattern, regex.flags]);
        setSourceLocation(t, regexLit);
        ctx.builder.genGoto(labCreated);

        ctx.builder.genLabel(labCreated);
        re.setAccessed(true, ctx);
        return re.hvar;
    }

    function compileThisExpression (scope: Scope, thisExp: ESTree.ThisExpression, need: boolean): hir.RValue
    {
        var variable = scope.ctx.thisParam;
        if (need) {
            variable.setAccessed(true, scope.ctx);
            return variable.hvar;
        } else {
            return null;
        }
    }

    function compileArrayExpression (
        scope: Scope, e: ESTree.ArrayExpression, need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        var ctx = scope.ctx;

        if (!need || onTrue) {
            warning(location(e), onTrue ? "condition is always true" : "unused array expression");

            e.elements.forEach((elem) => {
                if (elem)
                    if (elem.type === "SpreadElement")
                        error(location(elem), "ES6 spread elements not supported");
                    else
                        compileSubExpression(scope, elem, false, null, null);
            });

            if (onTrue)
                ctx.builder.genGoto(onTrue);

            return null;
        }

        var objProto = ctx.allocTemp();
        ctx.builder.genLoadRuntimeVar(objProto, "arrayPrototype");
        ctx.releaseTemp(objProto);
        var dest = ctx.allocTemp();
        ctx.builder.genCreate(dest, objProto);

        if (e.elements.length > 0) {
            // Resize the array in advance, but only for more than one element
            if (e.elements.length > 1)
                ctx.builder.genPropSet(dest, hir.wrapImmediate("length"), hir.wrapImmediate(e.elements.length));

            e.elements.forEach((elem, index) => {
                if (elem) {
                    if (elem.type === "SpreadElement")
                        error(location(elem), "ES6 spread elements not supported");
                    else {
                        var val = compileSubExpression(scope, elem, true, null, null);
                        ctx.releaseTemp(val);
                        ctx.builder.genPropSet(dest, hir.wrapImmediate(index), val);
                    }
                }
            });
        }

        return dest;
    }

    function compileObjectExpression (
        scope: Scope, e: ESTree.ObjectExpression, need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        var ctx = scope.ctx;
        var propMap = new StringMap<ObjectExprProp>();
        var props: ObjectExprProp[] = [];
        var errors = false;

        // First accumulate the properties
        e.properties.forEach((prop: ESTree.Property) => {
            var ident: ESTree.Identifier;
            var lit: ESTree.Literal;
            var name: string;

            if (prop.computed) {
                error(location(prop), "computed object expression not supported in ES5");
                errors = true;
                return;
            }

            if (ident = NT.Identifier.isTypeOf(prop.key)) {
                name = ident.name;
            } else if (lit = NT.Literal.isTypeOf(prop.key)) {
                name = String(lit.value);
            } else {
                error(location(prop.key), "unsupported property key");
                errors = true;
                return;
            }

            var propDesc: ObjectExprProp = propMap.get(name);
            if (propDesc) {
                if (prop.kind === "init" && propDesc.value) {
                    if (scope.ctx.strictMode) {
                        error(location(prop), `duplicate data property '${name}' in strict mode`);
                        errors = true;
                    }
                    // Disable the old one, so we can overwrite with the new one, but still calculate the old
                    // expression
                    propMap.remove(name);
                    propDesc.name = null;
                    propDesc = null;
                }
                else if (prop.kind === "init" && (propDesc.getter || propDesc.setter) ||
                         (prop.kind === "get" || prop.kind === "set") && propDesc.value)
                {
                    error(location(prop), `data and accessor property with the same name '${name}'`);
                    errors = true;
                }
                else if (prop.kind === "get" && propDesc.getter || prop.kind === "set" && propDesc.setter) {
                    error(location(prop), `multiple getters/setters with the same name '${name}'`);
                    errors = true;
                }
            }

            if (!propDesc) {
                propDesc = new ObjectExprProp(name);
                propMap.set(name, propDesc);
                props.push(propDesc);
            }

            switch (prop.kind) {
                case "init": propDesc.value = prop.value; break;
                case "get": propDesc.getter = NT.FunctionExpression.cast(prop.value); break;
                case "set": propDesc.setter = NT.FunctionExpression.cast(prop.value); break;
                default:
                    error(location(prop), "unsupported property kind");
                    errors = true;
                    break;
            }
        });

        // If there are errors, compile the init values, only to validate them
        // If we don't need the result, same...
        if (errors || !need || onTrue) {
            if (!need)
                warning(location(e), "unused object expression");
            else if(onTrue)
                warning(location(e), "condition is always true");

            props.forEach((propDesc: ObjectExprProp) => {
                if (propDesc.value)
                    compileSubExpression(scope, propDesc.value, false, null, null);
                if (propDesc.getter)
                    compileSubExpression(scope, propDesc.getter, false, null, null);
                if (propDesc.setter)
                    compileSubExpression(scope, propDesc.setter, false, null, null);
            });

            if (onTrue)
                ctx.builder.genGoto(onTrue);

            return need ? hir.undefinedValue : null;
        }

        var objProto = ctx.allocTemp();
        ctx.builder.genLoadRuntimeVar(objProto, "objectPrototype");
        ctx.releaseTemp(objProto);
        var dest = ctx.allocTemp();
        ctx.builder.genCreate(dest, objProto);

        props.forEach((propDesc: ObjectExprProp) => {
            if (propDesc.name === null) { // if this property was overwritten?
                // compile and ignore the values
                if (propDesc.value)
                    compileSubExpression(scope, propDesc.value, false, null, null);
                if (propDesc.getter)
                    compileSubExpression(scope, propDesc.getter, false, null, null);
                if (propDesc.setter)
                    compileSubExpression(scope, propDesc.setter, false, null, null);
            } else {
                var propName = hir.wrapImmediate(propDesc.name);

                if (!propDesc.getter && !propDesc.setter) { // is this a data property?
                    assert(propDesc.value);

                    var val = compileSubExpression(scope, propDesc.value, true, null, null);
                    ctx.releaseTemp(val);
                    ctx.releaseTemp(propName);
                    ctx.builder.genPropSet(dest, propName, val);
                } else {
                    assert(m_specVars._defineAccessor);

                    var getter: hir.RValue =
                        propDesc.getter ? compileSubExpression(scope, propDesc.getter, true, null, null) : hir.undefinedValue;
                    var setter: hir.RValue =
                        propDesc.setter ? compileSubExpression(scope, propDesc.setter, true, null, null) : hir.undefinedValue;

                    ctx.releaseTemp(getter);
                    ctx.releaseTemp(setter);

                    m_specVars._defineAccessor.setAccessed(true, ctx);
                    ctx.builder.genCall(null, m_specVars._defineAccessor.hvar, [
                        hir.undefinedValue, dest, propName, getter, setter
                    ]);
                }
            }
        });

        if (!need) {
            ctx.releaseTemp(dest);
            return null;
        }
        else
            return dest;
    }

    function findVariable (scope: Scope, identifier: ESTree.Identifier): Variable
    {
        var variable: Variable = scope.lookup(identifier.name);
        if (!variable) {
            if (scope.ctx.strictMode) {
                error(location(identifier), `undefined identifier '${identifier.name}'`);
                // Declare a dummy variable at 'var-scope' level to decrease noise
                variable = scope.varScope.newVariable(identifier.name);
            } else {
                warning(location(identifier), `undefined identifier '${identifier.name}'`);
                variable = m_undefinedVarScope.newVariable(identifier.name);
            }
        } else if (!scope.ctx.strictMode && !variable.declared) {
            // Report all warnings in non-strict mode
            warning(location(identifier), `undefined identifier '${identifier.name}'`);
        }

        return variable;
    }

    function compileIdentifier (scope: Scope, identifier: ESTree.Identifier, need: boolean): hir.RValue
    {
        var variable = findVariable(scope, identifier);
        if (need) {
            variable.setAccessed(true, scope.ctx);
            return variable.constantValue !== null ? variable.constantValue : variable.hvar;
        } else {
            return null;
        }
    }

    function compileFunctionExpression (scope: Scope, e: ESTree.FunctionExpression, need: boolean): hir.RValue
    {
        if (!need)
            warning(location(e), "unused function");

        var funcRef = scope.ctx.addClosure(e.id && e.id.name);
        var nameScope = new Scope(scope.ctx, false, scope); // A scope for the function name
        if (e.id) {
            var funcVar = nameScope.newVariable(e.id.name, funcRef.closureVar);
            funcVar.funcRef = funcRef;
            funcVar.declared = true;
            funcVar.initialized = true;
            funcVar.setAccessed(need, scope.ctx);
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

    /** Check if an expression is just an undefined identifier; this is used only by "typeof" */
    function isUndefinedIdentifier (scope: Scope, e: ESTree.Expression): ESTree.Identifier
    {
        var ident = NT.Identifier.isTypeOf(e);
        return ident && !scope.lookup(ident.name) ? ident : null;
    }

    function compileUnaryExpression (
        scope: Scope, e: ESTree.UnaryExpression,
        need: boolean, onTrue: hir.Label, onFalse: hir.Label
    ): hir.RValue
    {
        var ctx = scope.ctx;

        switch (e.operator) {
            case "-":
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.NEG_N, e.argument, need), need, onTrue, onFalse);
            case "+":
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.TO_NUMBER, e.argument, need), need, onTrue, onFalse);
            case "~":
                return toLogical(scope, e, compileSimpleUnary(scope, hir.OpCode.BIN_NOT_N, e.argument, need), need, onTrue, onFalse);
            case "delete":
                return toLogical(scope, e, compileDelete(scope, e, need), need, onTrue, onFalse);

            case "!":
                if (onTrue)
                    return compileSubExpression(scope, e.argument, need, onFalse, onTrue);
                else
                    return compileSimpleUnary(scope, hir.OpCode.LOG_NOT, e.argument, need);

            case "typeof":
                // Check for the special case of undefined identifier
                var ident: ESTree.Identifier;
                if ((ident = isUndefinedIdentifier(scope, e.argument)) !== null) {
                    if (!ident.warned) {
                        ident.warned = true;
                        warning(location(e.argument), `undefined identifier '${ident.name}'`);
                    }
                    return toLogical(scope, e, hir.wrapImmediate("undefined"), need, onTrue, onFalse);
                } else {
                    if (onTrue) {
                        ctx.releaseTemp(compileSubExpression(scope, e.argument, false, null, null));
                        warning(location(e), "condition is always true");
                        ctx.builder.genGoto(onTrue);
                    } else {
                        return compileSimpleUnary(scope, hir.OpCode.TYPEOF, e.argument, need);
                    }
                }
                break;

            case "void":
                ctx.releaseTemp(compileSubExpression(scope, e.argument, false, null, null));
                if (onTrue) {
                    warning(location(e), "condition is always false");
                    ctx.builder.genGoto(onFalse);
                } else {
                    return need ? hir.undefinedValue : null;
                }
                break;

            default:
                assert(false, `unknown unary operator '${e.operator}'`);
                return null;
        }

        return null;

        function compileSimpleUnary (scope: Scope, op: hir.OpCode, e: ESTree.Expression, need: boolean): hir.RValue
        {
            var v = compileSubExpression(scope, e, need, null, null);
            scope.ctx.releaseTemp(v);

            if (!need)
                return null;

            var folded = hir.foldUnary(op, v);
            if (folded !== null) {
                return folded;
            } else {
                var dest = scope.ctx.allocTemp();
                scope.ctx.builder.genUnop(op, dest, v);
                return dest;
            }
        }

        function compileDelete (scope: Scope, e: ESTree.UnaryExpression, need: boolean): hir.RValue
        {
            var ctx = scope.ctx;
            var memb: ESTree.MemberExpression = NT.MemberExpression.isTypeOf(e.argument);

            if (!memb) {
                warning(location(e), "'delete' of non-member");
                compileSubExpression(scope, e.argument, false, null, null);
                return need ? hir.wrapImmediate(true) : null;
            }

            var objExpr: hir.RValue = compileSubExpression(scope, memb.object, true, null, null);
            var propName: hir.RValue;

            ctx.releaseTemp(objExpr);
            var obj = ctx.allocTemp();
            ctx.builder.genUnop(hir.OpCode.TO_OBJECT, obj, objExpr);

            if (memb.computed)
                propName = compileSubExpression(scope, memb.property, true, null, null);
            else
                propName = hir.wrapImmediate(NT.Identifier.cast(memb.property).name);

            ctx.releaseTemp(propName);
            ctx.releaseTemp(obj);

            var res: hir.LValue = need ? ctx.allocTemp() : hir.nullReg;
            ctx.builder.genBinop(hir.OpCode.DELETE, res, obj, propName);
            return res;
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

        switch (e.operator) {
            case "in":  return compileInInstanceOf(ctx, e, hir.OpCode.IN, need, onTrue, onFalse);
            case "instanceof": return compileInInstanceOf(ctx, e, hir.OpCode.INSTANCEOF, need, onTrue, onFalse);
        }

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
                if (!e.warned) {
                    e.warned = true;
                    warning(location(e), "operator '==' is not recommended");
                }
                return compileLogBinary(ctx, e, hir.OpCode.LOOSE_EQ, v1, v2, onTrue, onFalse);
            case "!=":
                if (!e.warned) {
                    e.warned = true;
                    warning(location(e), "operator '!=' is not recommended");
                }
                return compileLogBinary(ctx, e, hir.OpCode.LOOSE_NE, v1, v2, onTrue, onFalse);
            case "===": return compileLogBinary(ctx, e, hir.OpCode.STRICT_EQ, v1, v2, onTrue, onFalse);
            case "!==": return compileLogBinary(ctx, e, hir.OpCode.STRICT_NE, v1, v2, onTrue, onFalse);
            case "<":   return compileLogBinary(ctx, e, hir.OpCode.LT, v1, v2, onTrue, onFalse);
            case "<=":  return compileLogBinary(ctx, e, hir.OpCode.LE, v1, v2, onTrue, onFalse);
            case ">":   return compileLogBinary(ctx, e, hir.OpCode.GT, v1, v2, onTrue, onFalse);
            case ">=":  return compileLogBinary(ctx, e, hir.OpCode.GE, v1, v2, onTrue, onFalse);

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
            return compileGenericBinary(ctx, op, v1, v2);
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

        function compileInInstanceOf (
            ctx: FunctionContext, e: ESTree.BinaryExpression, op: hir.OpCode,
            need: boolean, onTrue: hir.Label, onFalse: hir.Label
        ): hir.RValue
        {
            var v1 = compileSubExpression(scope, e.left, true);
            var v2r = compileSubExpression(scope, e.right, true);

            ctx.releaseTemp(v2r);
            var v2 = ctx.allocTemp();

            if (op === hir.OpCode.IN)
                ctx.builder.genBinop(hir.OpCode.ASSERT_OBJECT, v2, v2r,
                    hir.wrapImmediate("second operand of 'in' is not an object")
                );
            else
                ctx.builder.genBinop(hir.OpCode.ASSERT_FUNC, v2, v2r,
                    hir.wrapImmediate("second operand of 'instanceof' is not a function")
                );

            ctx.releaseTemp(v2);
            ctx.releaseTemp(v1);

            if (!need)
                return null;

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
                var dest = ctx.allocTemp();
                ctx.builder.genBinop(op, dest, v1, v2);
                return dest;
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
                ctx.releaseTemp(v2);
                ctx.allocSpecific(dest);
                ctx.builder.genAssign(dest, v2);
                ctx.builder.genLabel(labEnd);
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
                ctx.releaseTemp(v2);
                ctx.allocSpecific(dest);
                ctx.builder.genAssign(dest, v2);
                ctx.builder.genLabel(labEnd);
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

    function compileAssignmentExpression (scope: Scope, e: ESTree.AssignmentExpression, need: boolean): hir.RValue
    {
        var opcode: hir.OpCode;

        switch (e.operator) {
            case "=":     opcode = hir.OpCode.ASSIGN; break;
            case "+=":    opcode = hir.OpCode.ADD; break;
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
                assert(false, `unrecognized assignment operator '${e.operator}'`);
                return null;
        }

        var rvalue = compileSubExpression(scope, e.right);
        return _compileAssignment(scope, opcode, true, e.left, rvalue, need);
    }

    function _compileAssignment (
        scope: Scope, opcode: hir.OpCode, prefix: boolean, left: ESTree.Expression, rvalue: hir.RValue, need: boolean
    ): hir.RValue
    {
        var ctx = scope.ctx;
        var identifier: ESTree.Identifier;
        var memb: ESTree.MemberExpression;

        var variable: Variable;

        if (identifier = NT.Identifier.isTypeOf(left)) {
            variable = findVariable(scope, identifier);

            if (!variable.readOnly)
                variable.setAssigned(ctx);
            else
                (scope.ctx.strictMode ? error : warning)(location(left), `modifying read-only symbol ${variable.name}`);

            if (opcode === hir.OpCode.ASSIGN) {
                if (!variable.readOnly)
                    ctx.builder.genAssign(variable.hvar, rvalue);
                return rvalue;
            } else {
                variable.setAccessed(true, ctx);

                if (!prefix && need) { // Postfix? It only matters if we need the result
                    var res = ctx.allocTemp();
                    ctx.builder.genUnop(hir.OpCode.TO_NUMBER, res,
                        variable.constantValue !== null ? variable.constantValue : variable.hvar
                    );
                    ctx.releaseTemp(rvalue);
                    if (!variable.readOnly)
                        ctx.builder.genBinop(opcode, variable.hvar, variable.hvar, rvalue);
                    return res;
                } else {
                    ctx.releaseTemp(rvalue);
                    if (!variable.readOnly) {
                        ctx.builder.genBinop(opcode, variable.hvar, variable.hvar, rvalue);
                        return variable.hvar;
                    } else {
                        var res = ctx.allocTemp();
                        ctx.builder.genBinop(opcode, res,
                            variable.constantValue !== null ? variable.constantValue : variable.hvar,
                            rvalue
                        );
                        return res;
                    }
                }
            }
        } else if(memb = NT.MemberExpression.isTypeOf(left)) {
            var membObject: hir.RValue;
            var membPropName: hir.RValue;

            if (memb.computed)
                membPropName = compileSubExpression(scope, memb.property, true, null, null);
            else
                membPropName = hir.wrapImmediate(NT.Identifier.cast(memb.property).name);
            membObject = compileSubExpression(scope, memb.object, true, null, null);

            if (opcode === hir.OpCode.ASSIGN) {
                ctx.builder.genPropSet(membObject, membPropName, rvalue);
                ctx.releaseTemp(membObject);
                ctx.releaseTemp(membPropName);
                return rvalue;
            } else {
                var val: hir.Local = ctx.allocTemp();
                ctx.builder.genPropGet(val, membObject, membPropName);

                if (!prefix && need) { // Postfix? It only matters if we need the result
                    ctx.builder.genUnop(hir.OpCode.TO_NUMBER, val, val);
                    ctx.releaseTemp(rvalue);
                    var tmp = ctx.allocTemp();
                    ctx.builder.genBinop(opcode, tmp, val, rvalue);
                    ctx.builder.genPropSet(membObject, membPropName, tmp);
                    ctx.releaseTemp(tmp);
                } else {
                    ctx.releaseTemp(rvalue);
                    ctx.builder.genBinop(opcode, val, val, rvalue);
                    ctx.builder.genPropSet(membObject, membPropName, val);
                }

                ctx.releaseTemp(membObject);
                ctx.releaseTemp(membPropName);
                return val;
            }
        } else {
            error(location(left), "not an assignable expression");
            return hir.undefinedValue;
        }
    }

    function compileUpdateExpression (scope: Scope, e: ESTree.UpdateExpression, need: boolean): hir.RValue
    {
        var opcode: hir.OpCode = e.operator === "++" ? hir.OpCode.ADD_N : hir.OpCode.SUB_N;
        return _compileAssignment(scope, opcode, e.prefix, e.argument, hir.wrapImmediate(1), need);
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
     * @param reportError
     * @returns {string}
     */
    function parseConstantString (e: ESTree.Expression, reportError: boolean = true): string
    {
        var str = isStringLiteral(e);
        if (str !== null)
            return str;
        var bine = NT.BinaryExpression.isTypeOf(e);
        if (!bine || bine.operator !== "+") {
            if (reportError)
                error(location(e), "not a constant string literal");
            return null;
        }
        var a = parseConstantString(bine.left, reportError);
        if (a === null)
            return null;
        var b = parseConstantString(bine.right, reportError);
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
        var sysBindings : {[name: string]: hir.SystemReg} = Object.create(null);
        sysBindings["%frame"] = hir.frameReg;
        sysBindings["%argc"] = hir.argcReg;
        sysBindings["%argv"] = hir.argvReg;

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
            resultBinding.result = true;
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

        function parseClobberDeclaration (e: ESTree.Expression): void
        {
            var arrE = NT.ArrayExpression.isTypeOf(e);
            if (!arrE) {
                error(location(e), "'__asm__' every clobber declaration must be an array literal");
                return;
            }
            var name = isStringLiteral(arrE.elements[0]);
            if (!name) {
                error(location(e), "'__asm__' every clobber declaration must begin with a string literal");
                return;
            }
            if (bindingMap.has(name)) {
                error(location(e), `'__asm__' binding '${name}' already declared`);
                return;
            }

            addBinding(name, null);

            if (arrE.elements.length > 1) {
                error(location(e), "'__asm__' input declaration options not supported yet");
                return;
            }
        }
        function parseClobbers (e: ESTree.Expression): void
        {
            var arrE = NT.ArrayExpression.isTypeOf(e);
            if (!arrE) {
                error(location(e), "'__asm__' parameter 4 (clobbers) must be an array literal");
                return;
            }
            arrE.elements.forEach(parseClobberDeclaration);
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
                        var sysbnd = sysBindings[name];
                        if (!sysbnd) {
                            error(location(e), `undeclared binding '%[${name}]'`);
                            return;
                        }
                        bnd = addBinding(name, null);
                        bnd.hv = sysbnd;
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


        if (e.arguments.length !== 5) {
            error(location(e), "'__asm__' requires exactly five arguments");
        } else {
            parseOptions(e.arguments[0]);
            parseResult(e.arguments[1]);
            parseInputs(e.arguments[2]);
            parseClobbers(e.arguments[3]);
            parsePattern(e.arguments[4]);
        }

        if (!pattern) // error?
            return need ? hir.nullReg : null;

        var hbnd: hir.RValue[] = new Array<hir.RValue>(bindings.length);
        var dest: hir.LValue = null;

        for ( var i = 0; i < bindings.length; ++i ) {
            var b = bindings[i];
            if (!b.used)
                hbnd[i] = null;
            else if (b.hv !== null)
                hbnd[i] = b.hv;
            else if (b.e)
                hbnd[i] = compileSubExpression(scope, b.e, true, null, null);
            else {
                var temp = scope.ctx.allocTemp();
                hbnd[i] = temp;
                if (b.result)
                    dest = temp;
            }
        }

        // Release the temporaries in reverse order, except the result
        for ( var i = bindings.length-1; i >= 0; --i )
            if (!bindings[i].result) // if not an output
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
            if (dest)
                warning(location(e), "'__asm__': result value ignored");
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
            if (str === null)
                break exit;

            scope.ctx.builder.module.addAsmHeader(str);
        }
        return need ? hir.undefinedValue : null;
    }

    function compileRequireExpression (scope: Scope, e: ESTree.CallExpression, need: boolean): hir.RValue
    {
        var m: Module = null;

        if (e.arguments.length > 0) {
            var str = parseConstantString(e.arguments[0], false);
            if (str !== null) {
                var m = m_modules.resolve(m_dirname, str);
                if (m.notFound) {
                    warning(location(e), `cannot resolve module '${str}'`);
                } else {
                    // Replace the argument with the resolved path
                    var arg: ESTree.Literal = {
                        type: NT.Literal.name,
                        value: m.path,
                        start: e.arguments[0].start,
                        end: e.arguments[0].end
                    };
                    if (e.arguments[0].loc)
                        arg.loc = e.arguments[0].loc;
                    if (e.arguments[0].range)
                        arg.range = e.arguments[0].range;

                    e.arguments[0] = arg;
                }
            }
        }

        if (!m)
            warning(location(e), "dynamic 'require' invocation cannot be analyzed at compile time");

        return _compileCallExpression(scope, e, need);
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

    function extractMagicCallIdentifier (scope: Scope, e: ESTree.CallExpression): string
    {
        var identifierExp: ESTree.Identifier;
        if (identifierExp = NT.Identifier.isTypeOf(e.callee)) {
            var name = identifierExp.name;
            if (name === "__asm__")
                return "asm";
            else if (name === "__asmh__")
                return "asmh";

            var v = scope.lookup(name);
            if (v) {
                if (v === m_specVars.require)
                    return "require";
            }
        }

        return null;
    }

    function compileCallExpression (scope: Scope, e: ESTree.CallExpression, need: boolean): hir.RValue
    {
        // Check for compiler extensions
        switch (extractMagicCallIdentifier(scope, e)) {
            case "asm": return compileAsmExpression(scope, e, need);
            case "asmh": return compileAsmHExpression(scope, e, need);
            case "require": return compileRequireExpression(scope, e, need);
        }

        return _compileCallExpression(scope, e, need);
    }

    function _compileCallExpression (scope: Scope, e: ESTree.CallExpression, need: boolean): hir.RValue
    {
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

        for ( var i = args.length - 1; i >= 1 /*stop at 'thisArg'*/; --i )
            ctx.releaseTemp(args[i]);
        ctx.releaseTemp(thisArg);
        ctx.releaseTemp(closure);

        var dest: hir.LValue = null;
        if (need)
            dest = ctx.allocTemp();

        var t = ctx.builder.genCall(dest, closure, args);
        setSourceLocation(t, e);
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
        ctx.builder.genLoadRuntimeVar(prototype, "objectPrototype");
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
        var t = ctx.builder.genCallCons(res, closure, args);
        setSourceLocation(t, e);

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
    var m_modules = new Modules(m_options.moduleDirs);

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

        var runtime = compileRuntime(m_globalContext);
        if (!runtime || m_reporter.errorCount() > 0)
            return;

        // Resolve and compile all system modules
        if (!compileResolvedModules(runtime))
            return;
        callRuntimeFunction(runtime, runtime.runtimeInit);

        // Resolve main
        var main: Module = m_modules.resolve("", path.resolve(process.cwd(), m_fileName));
        main.printable = m_fileName;

        if (!compileResolvedModules(runtime))
            return;
        callModuleRequire(runtime, main);

        runtime.ctx.close();
        topLevelBuilder.close();
        m_moduleBuilder.prepareForCodegen();

        if (m_options.dumpHIR)
            runtime.ctx.builder.dump();

        if (!m_options.dumpAST && !m_options.dumpHIR)
            produceOutput();
    }

    function compileResolvedModules (runtime: Runtime): boolean
    {
        var m: Module;
        while (m = m_modules.next()) {
            if (m.notFound) {
                error(null, `cannot find module '${m.printable}'`);
                return false;
            }
            m.modVar = compileModule(runtime, runtime.ctx, m.path);
            if (m_reporter.errorCount() > 0)
                return false;
            callDefineModule(runtime, m);
        }
        return true;
    }

    function compileRuntime (parentContext: FunctionContext): Runtime
    {
        var runtimeFileName = "runtime/js/runtime.js";
        var coreFilesDir = "runtime/js/core/";

        var runtimeCtx = new FunctionContext(
            parentContext, parentContext.scope, runtimeFileName, parentContext.builder.newClosure(runtimeFileName)
        );

        function declareBuiltinConstructor (name: string, mangled: string, runtimeVar: string): void
        {
            var fobj = runtimeCtx.addBuiltinClosure(name, mangled+"Function", runtimeVar);
            var consobj = runtimeCtx.addBuiltinClosure(name, mangled+"Constructor", runtimeVar);
            var vobj = runtimeCtx.scope.newVariable(fobj.name, fobj.closureVar);
            vobj.funcRef = fobj;
            vobj.consRef = consobj;
            vobj.declared = true;
            vobj.initialized = true;
        }

        declareBuiltinConstructor("Object", "js::object", "object");
        declareBuiltinConstructor("Function", "js::function", "function");
        declareBuiltinConstructor("String", "js::string", "string");
        declareBuiltinConstructor("Number", "js::number", "number");
        declareBuiltinConstructor("Boolean", "js::boolean", "boolean");
        declareBuiltinConstructor("Array", "js::array", "array");
        declareBuiltinConstructor("Error", "js::error", "error");
        declareBuiltinConstructor("TypeError", "js::typeError", "typeError");
        declareBuiltinConstructor("ArrayBuffer", "js::ArrayBuffer::a", "arrayBuffer");
        declareBuiltinConstructor("DataView", "js::DataView::a", "dataView");
        declareBuiltinConstructor("Int8Array", "js::Int8Array::a", "int8Array");
        declareBuiltinConstructor("Uint8Array", "js::Uint8Array::a", "uint8Array");
        declareBuiltinConstructor("Uint8ClampedArray", "js::Uint8ClampedArray::a", "uint8ClampedArray");
        declareBuiltinConstructor("Int16Array", "js::Int16Array::a", "int16Array");
        declareBuiltinConstructor("Uint16Array", "js::Uint16Array::a", "uint16Array");
        declareBuiltinConstructor("Int32Array", "js::Int32Array::a", "int32Array");
        declareBuiltinConstructor("Uint32Array", "js::Uint32Array::a", "uint32Array");
        declareBuiltinConstructor("Float32Array", "js::Float32Array::a", "float32Array");
        declareBuiltinConstructor("Float64Array", "js::Float64Array::a", "float64Array");

        runtimeCtx.scope.newConstant("NaN", hir.wrapImmediate(NaN));
        runtimeCtx.scope.newConstant("Infinity", hir.wrapImmediate(Infinity));
        runtimeCtx.scope.newConstant("undefined", hir.undefinedValue);

        if (!compileSource(runtimeCtx.scope, runtimeCtx.scope, runtimeFileName, m_reporter, new SpecialVars(), m_modules, m_options))
            return null;

        var r: Runtime = new Runtime(runtimeCtx);

        var coreScope = compileCoreFiles(r, coreFilesDir);
        if (!coreScope)
            return null;

        r.lookupSymbols(coreScope);
        if (!r.allSymbolsDefined())
            error(null, "internal symbols missing from runtime");

        return r;
    }

    /**
     * Compile a core file in a nested scope. We want to achieve visibility separation, but
     * we don't want the physical separation of another environment, etc.
     */
    function compileInANestedScope (r: Runtime, coreCtx: FunctionContext, fileName: string): Scope
    {
        var scope = new Scope(coreCtx, true, coreCtx.scope);
        if (!compileInAScope(r, scope, fileName))
            return null;
        return scope;
    }

    function compileCoreFiles (r: Runtime, coreFilesDir: string): Scope
    {
        var runtimeCtx: FunctionContext = r.ctx;
        var coreScope = new Scope(runtimeCtx, true, runtimeCtx.scope);

        var entries: string[];
        try {
            entries = fs.readdirSync(coreFilesDir);
        } catch (e) {
            error(null, `cannot access '${coreFilesDir}'`);
            return null;
        }

        entries.sort();
        for ( var i = 0, e = entries.length; i < e; ++i ) {
            var entry = entries[i];
            if (entry[0] !== "." && path.extname(entry) === ".js") {
                if (!compileInAScope(r, coreScope, path.join(coreFilesDir,entry)))
                    return null;
                // Update the internal symbols after every new core file
                r.lookupSymbols(coreScope);
            }
        }

        return coreScope;
    }

    /**
     * Compile a core file in a pre-defined scope. We want to achieve visibility separation, but
     * we don't want the physical separation of another environment, etc.
     */
    function compileInAScope (r: Runtime, scope: Scope, fileName: string): boolean
    {
        var coreCtx: FunctionContext = scope.ctx;
        var specialVars = new SpecialVars(r);
        definePaths(scope, fileName);
        return compileSource(scope, coreCtx.scope, fileName, m_reporter, specialVars, m_modules, m_options);
    }

    function compileModule (runtime: Runtime, parentContext: FunctionContext, fileName: string): Variable
    {
        var ctx = new FunctionContext(
            parentContext, parentContext.scope, fileName, parentContext.addClosure(fileName)
        );
        hir.setSourceLocation(ctx.builder, fileName, 1, 0);

        var modVar = parentContext.scope.newAnonymousVariable(fileName, ctx.builder.closureVar);
        modVar.funcRef = ctx.builder;

        var modp = ctx.addParam("module");
        var require = ctx.addParam("require");

        var specVars = new SpecialVars(runtime);
        specVars.require = require;

        var tmp = ctx.allocTemp();
        modp.setAccessed(true, ctx);
        ctx.builder.genPropGet(tmp, modp.hvar, hir.wrapImmediate("exports"));
        defineVar(ctx.scope, "exports", tmp);

        definePaths(ctx.scope, fileName);
        compileSource(ctx.scope, ctx.scope, fileName, m_reporter, specVars, m_modules, m_options);
        ctx.close();

        return modVar;
    }

    function callDefineModule (runtime: Runtime, m: Module): void
    {
        var ctx = runtime.ctx;
        ctx.builder.genCall(null, runtime.defineModule.hvar, [
            hir.undefinedValue,
            hir.wrapImmediate(m.path),
            m.modVar.funcRef.closureVar
        ]);
        m.modVar.setAccessed(true, ctx);
        runtime.defineModule.setAccessed(true, ctx);
    }

    function callRuntimeFunction (runtime: Runtime, f: Variable): void
    {
        var ctx = runtime.ctx;
        ctx.builder.genCall(null, f.hvar, [
            hir.undefinedValue
        ]);
        f.setAccessed(true, ctx);
    }

    function callModuleRequire (runtime: Runtime, m: Module, result: hir.LValue = null): void
    {
        var ctx = runtime.ctx;
        ctx.builder.genCall(result, runtime.moduleRequire.hvar, [
            hir.undefinedValue,
            hir.wrapImmediate(m.path)
        ]);
        runtime.moduleRequire.setAccessed(true, ctx);
    }

    function definePaths (scope: Scope, fileName: string)
    {
        if (!path.isAbsolute(fileName))
            fileName = path.resolve(fileName);
        defineVar(scope, "__filename", hir.wrapImmediate(fileName));
        defineVar(scope, "__dirname", hir.wrapImmediate(path.dirname(fileName)));
    }

    function defineVar (scope: Scope, name: string, value: hir.RValue): Variable
    {
        var v: Variable;

        if (!(v = scope.getVar(name)))
            v = scope.newVariable(name);

        v.declared = true;
        v.setAssigned(scope.ctx);
        scope.ctx.releaseTemp(value);
        scope.ctx.builder.genAssign(v.hvar, value);

        return v;
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
                m_moduleBuilder.generateC(process.stdout, m_options.strictMode);
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
                    m_moduleBuilder.generateC(out, m_options.strictMode);
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

            if (m_options.compileOnly)
                args.push("-c");

            args.push("-");

            if (!m_options.compileOnly) {
                m_options.libDirs.forEach((d) => args.push("-L"+d));
                m_options.libs.forEach((d) => args.push("-l"+d));
            }
            args.push("-o", outName);

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
            m_moduleBuilder.generateC(child.stdin, m_options.strictMode);
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
