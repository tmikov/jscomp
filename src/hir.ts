// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

import assert = require("assert");
import util = require("util");
import stream = require("stream");

import StringMap = require("../lib/StringMap");

export interface SourceLocation
{
    fileName: string;
    line: number;
    column: number;
}

export function setSourceLocation (loc: SourceLocation, fileName: string, line: number, column: number): void
{
    loc.fileName = fileName;
    loc.line = line;
    loc.column = column;
}
export function hasSourceLocation (loc: SourceLocation): boolean
{
    return loc.fileName !== null;
}

export class MemValue
{
    constructor(public id: number) {}
}

export class LValue extends MemValue
{
}

export class SystemReg extends LValue
{
    constructor (id: number, public name: string) {super(id);}
    toString (): string { return this.name; }
}

export class Regex
{
    constructor (public pattern: string, public flags: string) {}
    toString(): string { return `Regex(/${this.pattern}/${this.flags})`; }
}

/** for null and undefined */
export class SpecialConstantClass
{
    constructor (public name: string) {}
    toString(): string { return `#${this.name}`; }
}

export type RValue = MemValue | string | boolean | number | SpecialConstantClass;

export class Param extends MemValue
{
    index: number;
    name: string;
    variable: Var;

    constructor(id: number, index: number, name: string, variable: Var)
    {
        super(id);
        this.index = index;
        this.name = name;
        this.variable = variable;
        variable.formalParam = this;
    }
    toString() { return `Param(${this.index}/*${this.name}*/)`; }
}

export class ArgSlot extends MemValue
{
    local: Local = null;

    constructor (id: number, public index: number) { super(id); }
    toString() {
        if (this.local)
            return this.local.toString();
        else
            return `Arg(${this.index})`;
    }
}

export class Var extends LValue
{
    envLevel: number; //< environment nesting level
    name: string;
    formalParam: Param = null; // associated formal parameter
    escapes: boolean = false;
    constant: boolean = false;
    accessed: boolean = true;
    funcRef: FunctionBuilder = null;
    consRef: FunctionBuilder = null;
    local: Local = null; // The corresponding local to use if it doesn't escape
    param: Param = null; // The corresponding param to use if it is constant and doesn't escape
    envIndex: number = -1; //< index in its environment block, if it escapes

    constructor(id: number, envLevel: number, name: string)
    {
        super(id);
        this.envLevel = envLevel;
        this.name = name || "";
    }

    toString()
    {
        if (this.local)
            return this.local.toString();
        else if (this.param)
            return this.param.toString();
        else
            return `Var(env@${this.envLevel}[${this.envIndex}]/*${this.name}*/)`;
    }
}

export class Local extends LValue
{
    isTemp: boolean = false; // for users of the module. Has no meaning internally
    index: number;

    constructor(id: number, index: number)
    {
        super(id);
        this.index = index;
    }
    toString() { return `Local(${this.index})`; }
}

export var nullValue = new SpecialConstantClass("null");
export var undefinedValue = new SpecialConstantClass("undefined");
export var nullReg = new SystemReg(0, "#nullReg");
export var frameReg = new SystemReg(-1, "#frameReg");
export var argcReg = new SystemReg(-2, "#argcReg");
export var argvReg = new SystemReg(-3, "#argvReg");
export var lastThrownValueReg = new SystemReg(-4, "#lastThrownValue");

export function unwrapImmediate (v: RValue): any
{
    if (v === nullValue)
        return null;
    else if (v === undefinedValue)
        return void 0;
    else
        return v;
}

export function wrapImmediate (v: any): RValue
{
    if (v === void 0)
        return undefinedValue;
    else if (v === null)
        return nullValue;
    else
        return v;
}

export function isImmediate (v: RValue): boolean
{
    switch (typeof v) {
        case "string":
        case "boolean":
        case "number":
            return true;
        case "object":
            return <any>v instanceof SpecialConstantClass;
    }
    return false;
}

export function isString (v: RValue): boolean
{
    return typeof v === "string";
}

export function isLValue (v: RValue): LValue
{
    if (<any>v instanceof LValue)
        return <LValue>v;
    else
        return null;
}

export function isVar (v: RValue): Var
{
    if (<any>v instanceof Var)
        return <Var>v;
    else
        return null;
}

export function isTempLocal (v: RValue): Local
{
    if (<any>v instanceof Local) {
        var l = <Local>v;
        if (l.isTemp)
            return l;
    }
    return null;
}


// Note: in theory all comparisons can be simulated using only '<' and '=='.
// a < b   = LESS(a,b)
// a > b   = LESS(b,a)
// a >= b  = !LESS(a,b)
// a <= b  = !LESS(b,a)
// a != b  = !(a == b)
// However things fall apart first when floating point is involved (because comparions between
// NaN-s always return false) and second because JavaScript requires left-to-right evaluation and
// converting to a primitive value for comparison could cause a function call.

export const enum OpCode
{
    // Special
    CLOSURE,
    CREATE,
    CREATE_ARGUMENTS,
    LOAD_SC,
    END_TRY,
    ASM,

    // Binary
    STRICT_EQ,
    STRICT_NE,
    LOOSE_EQ,
    LOOSE_NE,
    LT,
    LE,
    GT,
    GE,
    IN,
    INSTANCEOF,
    SHL_N,
    SHR_N,
    ASR_N,
    ADD,
    ADD_N,
    SUB_N,
    MUL_N,
    DIV_N,
    MOD_N,
    OR_N,
    XOR_N,
    AND_N,
    ASSERT_OBJECT,
    ASSERT_FUNC,
    DELETE,

    // Unary
    NEG_N,
    LOG_NOT,
    BIN_NOT_N,
    TYPEOF,
    VOID,
    TO_NUMBER,
    TO_STRING,
    TO_OBJECT,

    // Assignment
    ASSIGN,

    // Property access
    GET,
    PUT,

    // Call
    CALL,
    CALLIND,
    CALLCONS,

    // Unconditional jumps
    RET,
    THROW,
    GOTO,

    // Conditional jumps
    BEGIN_TRY,
    SWITCH,
    IF_TRUE,
    IF_IS_OBJECT,
    IF_STRICT_EQ,
    IF_STRICT_NE,
    IF_LOOSE_EQ,
    IF_LOOSE_NE,
    IF_LT,
    IF_LE,
    IF_GT,
    IF_GE,
    IF_IN,
    IF_INSTANCEOF,

    _BINOP_FIRST = STRICT_EQ,
    _BINOP_LAST = DELETE,
    _UNOP_FIRST = NEG_N,
    _UNOP_LAST = TO_OBJECT,
    _IF_FIRST = IF_TRUE,
    _IF_LAST = IF_INSTANCEOF,
    _BINCOND_FIRST = IF_STRICT_EQ,
    _BINCOND_LAST = IF_INSTANCEOF,
    _JUMP_FIRST = RET,
    _JUMP_LAST = IF_INSTANCEOF,
}

var g_opcodeName: string[] = [
    // Special
    "CLOSURE",
    "CREATE",
    "CREATE_ARGUMENTS",
    "LOAD_SC",
    "END_TRY",
    "ASM",

    // Binary
    "STRICT_EQ",
    "STRICT_NE",
    "LOOSE_EQ",
    "LOOSE_NE",
    "LT",
    "LE",
    "GT",
    "GE",
    "IN",
    "INSTANCEOF",
    "SHL_N",
    "SHR_N",
    "ASR_N",
    "ADD",
    "ADD_N",
    "SUB_N",
    "MUL_N",
    "DIV_N",
    "MOD_N",
    "OR_N",
    "XOR_N",
    "AND_N",
    "ASSERT_OBJECT",
    "ASSERT_FUNC",
    "DELETE",

    // Unary
    "NEG_N",
    "LOG_NOT",
    "BIN_NOT_N",
    "TYPEOF",
    "VOID",
    "TO_NUMBER",
    "TO_STRING",
    "TO_OBJECT",

    // Assignment
    "ASSIGN",

    // Property access
    "GET",
    "PUT",

    // Call
    "CALL",
    "CALLIND",
    "CALLCONS",

    // Unconditional jumps
    "RET",
    "THROW",
    "GOTO",

    // Conditional jumps
    "BEGIN_TRY",
    "SWITCH",
    "IF_TRUE",
    "IF_IS_OBJECT",
    "IF_STRICT_EQ",
    "IF_STRICT_NE",
    "IF_LOOSE_EQ",
    "IF_LOOSE_NE",
    "IF_LT",
    "IF_LE",
    "IF_GT",
    "IF_GE",
    "IF_IN",
    "IF_INSTANCEOF",
];

export const enum SysConst
{
    RUNTIME_VAR,
    ARGUMENTS_LEN,
}
var g_sysConstName : string[] = [
    "RUNTIME_VAR",
    "ARGUMENTS_LEN",
];

// Note: surprisingly, 'ADD' is not commutative because 'string+x' is not the same as 'x+string'
// Ain't dynamic typing great?
var g_binOpCommutative: boolean[] = [
    true,  //STRICT_EQ,
    true,  //STRICT_NE,
    true,  //LOOSE_EQ,
    true,  //LOOSE_NE,
    false, //LT,
    false, //LE,
    false, //GT,
    false, //GE,
    false, //SHL,
    false, //SHR,
    false, //ASR,
    false, //ADD,
    true,  //ADD_N,
    false, //SUB_N
    true,  //MUL,
    false, //DIV,
    false, //MOD,
    true,  //OR,
    true,  //XOR,
    true,  //AND,
    false, //IN,
    false, //INSTANCEOF
];

export function isCommutative (op: OpCode): boolean
{
    assert(op >= OpCode._BINOP_FIRST && op <= OpCode._BINOP_LAST);
    return g_binOpCommutative[op - OpCode._BINOP_FIRST];
}

export function  isBinop (op: OpCode): boolean
{
    return op >= OpCode._BINOP_FIRST && op <= OpCode._BINOP_LAST;
}

export function isJump (op: OpCode): boolean
{
    return op >= OpCode._JUMP_FIRST && op <= OpCode._JUMP_LAST;
}

export function isBinopConditional (op: OpCode): boolean
{
    return op >= OpCode._BINOP_FIRST && op <= OpCode._BINOP_FIRST + OpCode._BINCOND_LAST - OpCode._BINCOND_FIRST;
}

export function binopToBincond (op: OpCode): OpCode
{
    assert(isBinopConditional(op));
    return op + OpCode._BINCOND_FIRST - OpCode._BINOP_FIRST;
}

export function rv2s (v: RValue): string
{
    if (v === null)
        return "";
    else if (typeof v === "string")
        return "\"" + v + "\""; // FIXME: escaping, etc
    else
        return String(v); // FIXME: regex, other types, etc
}

export function oc2s (op: OpCode): string
{
    return g_opcodeName[op];
}

export class Instruction {
    constructor (public op: OpCode) {}
}
export class ClosureOp extends Instruction {
    constructor (public dest: LValue, public funcRef: FunctionBuilder) { super(OpCode.CLOSURE); }
    toString (): string {
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${this.funcRef})`;
    }
}
export class LoadSCOp extends Instruction {
    constructor (public dest: LValue, public sc: SysConst, public arg?: string) { super(OpCode.LOAD_SC); }
    toString (): string {
        if (!this.arg)
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${g_sysConstName[this.sc]})`;
        else
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${g_sysConstName[this.sc]}, ${this.arg})`;
    }
}
export class BinOp extends Instruction {
    constructor (op: OpCode, public dest: LValue, public src1: RValue, public src2: RValue) { super(op); }
    toString (): string {
        if (this.src2 !== null)
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${rv2s(this.src1)}, ${rv2s(this.src2)})`;
        else
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${rv2s(this.src1)})`;
    }
}
export class UnOp extends BinOp {
    constructor (op: OpCode, dest: LValue, src: RValue) { super(op, dest, src, null); }
}
export class AssignOp extends UnOp {
    constructor (dest: LValue, src: RValue) { super(OpCode.ASSIGN, dest, src); }
    toString (): string {
        return `${rv2s(this.dest)} = ${rv2s(this.src1)}`;
    }
}

export class PutOp extends Instruction {
    constructor (public obj: RValue, public propName: RValue, public src: RValue) { super(OpCode.PUT); }
    toString (): string {
        return `${oc2s(this.op)}(${rv2s(this.obj)}, ${rv2s(this.propName)}, ${rv2s(this.src)})`;
    }
}

export class CallOp extends Instruction {
    public fileName: string = null;
    public line: number = 0;
    public column: number = 0;

    constructor(
        op: OpCode, public dest: LValue, public fref: FunctionBuilder, public closure: RValue, public args: ArgSlot[]
    )
    {
        super(op);
    }

    toString (): string {
        if (this.fref)
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${this.fref}, ${this.closure}, [${this.args}])`;
        else
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${this.closure}, [${this.args}])`;
    }
}
export class JumpInstruction extends Instruction {
    constructor (op: OpCode, public label1: Label, public label2: Label)  { super(op); }
}
export class RetOp extends JumpInstruction {
    constructor (label1: Label, public src: RValue) { super(OpCode.RET, label1, null); }
    toString (): string {
        return `${oc2s(this.op)} ${this.label1}, ${rv2s(this.src)}`;
    }
}
export class ThrowOp extends JumpInstruction {
    constructor (public src: RValue) { super(OpCode.THROW, null, null); }
    toString (): string {
        return `${oc2s(this.op)} ${rv2s(this.src)}`;
    }
}
export class GotoOp extends JumpInstruction {
    constructor (target: Label) { super(OpCode.GOTO, target, null); }
    toString(): string {
        return `${oc2s(this.op)} ${this.label1}`;
    }
}
export class BeginTryOp extends JumpInstruction {
    constructor (public tryId: number, onNormal: Label, onException: Label)
    {
        super(OpCode.BEGIN_TRY, onNormal, onException);
    }
    toString (): string {
        return `${oc2s(this.op)}(${this.tryId}) then ${this.label1} exc ${this.label2}`;
    }
}
export class EndTryOp extends Instruction {
    constructor (public tryId: number) { super(OpCode.END_TRY); }
    toString (): string {
        return `${oc2s(this.op)}(${this.tryId})`;
    }
}
export class SwitchOp extends JumpInstruction {
    constructor (public selector: RValue, defaultLab: Label, public values: number[], public targets: Label[])
    {
        super(OpCode.SWITCH, null, defaultLab);
    }
    toString (): string {
        var res: string = `${oc2s(this.op)} ${rv2s(this.selector)}`;
        if (this.label2)
            res += `,default:${this.label2}`;
        return res + ",[" + this.values.toString() + "],[" + this.targets.toString() +"]";
    }
}
export class IfOp extends JumpInstruction {
    constructor (op: OpCode, public src1: RValue, public src2: RValue, onTrue: Label, onFalse: Label)
    {
        super(op, onTrue, onFalse);
    }
    toString (): string {
        if (this.src2 !== null)
            return `${oc2s(this.op)}(${rv2s(this.src1)}, ${rv2s(this.src2)}) ${this.label1} else ${this.label2}`;
        else
            return `${oc2s(this.op)}(${rv2s(this.src1)}) ${this.label1} else ${this.label2}`;
    }
}

export type AsmPattern = Array<string|number>;

export class AsmOp extends Instruction {
    constructor (public dest: LValue, public bindings: RValue[], public pat: AsmPattern)
    {
        super(OpCode.ASM);
    }
    toString (): string
    {
        return `${rv2s(this.dest)} = ${oc2s(this.op)}([${this.bindings}], [${this.pat}])`;
    }
}

export class Label
{
    bb: BasicBlock = null;
    constructor(public id: number) {}
    toString() { return `B${this.bb.id}`; }
}

export class BasicBlock
{
    id: number;
    body: Instruction[] = [];
    labels: Label[] = [];
    succ: Label[] = [];

    constructor (id: number)
    {
        this.id = id;
    }

    insertAt (at: number, inst: Instruction): void
    {
        this.body.splice(at, 0, inst);
    }

    push (inst: Instruction): void
    {
        // If the BasicBlock hasn't been "closed" with a jump, just add to the end,
        // otherwise insert before the jump
        if (!this.succ.length)
            this.body.push(inst);
        else
            this.body.splice(this.body.length-1, 0, inst)
    }

    jump (inst: JumpInstruction): void
    {
        assert(!this.succ.length);
        this.body.push(inst);
        if (inst.label1)
            this.succ.push(inst.label1);
        if (inst.label2)
            this.succ.push(inst.label2);
        if (inst.op === OpCode.SWITCH) {
            var switchOp = <SwitchOp>inst;
            for ( var i = 0, e = switchOp.targets.length; i < e; ++i )
                this.succ.push(switchOp.targets[i]);
        }
    }

    placeLabel (lab: Label): void
    {
        assert(!this.body.length);
        assert(!lab.bb);
        lab.bb = this;
        this.labels.push(lab);
    }
}

/**
 *
 * @param op
 * @param v1
 * @param v2
 * @returns  RValue folded value or null if the operands cannot be folded at compile time
 */
export function foldBinary (op: OpCode, v1: RValue, v2: RValue): RValue
{
    if (!isImmediate(v1) || !isImmediate(v2))
        return null;
    var a1: any = unwrapImmediate(v1);
    var a2: any = unwrapImmediate(v2);
    var r: any;
    switch (op) {
        case OpCode.STRICT_EQ: r = a1 === a2; break;
        case OpCode.STRICT_NE: r = a1 !== a2; break;
        case OpCode.LOOSE_EQ:  r = a1 == a2; break;
        case OpCode.LOOSE_NE:  r = a1 != a2; break;
        case OpCode.LT:        r = a1 < a2; break;
        case OpCode.LE:        r = a1 <= a2; break;
        case OpCode.SHL_N:     r = a1 << a2; break;
        case OpCode.SHR_N:     r = a1 >> a2; break;
        case OpCode.ASR_N:     r = a1 >>> a2; break;
        case OpCode.ADD:
        case OpCode.ADD_N:     r = a1 + a2; break;
        case OpCode.SUB_N:     r = a1 - a2; break;
        case OpCode.MUL_N:     r = a1 * a2; break;
        case OpCode.DIV_N:     r = a1 / a2; break;
        case OpCode.MOD_N:     r = a1 % a2; break;
        case OpCode.OR_N:      r = a1 | a2; break;
        case OpCode.XOR_N:     r = a1 ^ a2; break;
        case OpCode.AND_N:     r = a1 & a2; break;
        case OpCode.IN:        return null;
        case OpCode.INSTANCEOF: return null;
        case OpCode.ASSERT_OBJECT: return null;
        case OpCode.ASSERT_FUNC: return null;
        case OpCode.DELETE:    r = false; break;
        default:               return null;
    }

    return wrapImmediate(r);
}

export function isImmediateTrue (v: RValue): boolean
{
    assert(isImmediate(v));
    return !!unwrapImmediate(v);
}

export function isImmediateInteger (v: RValue): boolean
{
    var tmp = unwrapImmediate(v);
    return typeof tmp === "number" && (tmp | 0) === tmp;
}

export function isValidArrayIndex (s: string): boolean
{
    var n = Number(s) >>> 0; // convert to uint32
    return n !== 4294967295 && String(n) === s;
}

/**
 *
 * @param op
 * @param v
 * @returns  RValue folded value or null if the operand cannot be folded at compile time
 */
export function foldUnary (op: OpCode, v: RValue): RValue
{
    if (!isImmediate(v))
        return null;
    var a: any = unwrapImmediate(v);
    var r: any;
    switch (op) {
        case OpCode.NEG_N:     r = -a; break;
        case OpCode.LOG_NOT:   r = !a; break;
        case OpCode.BIN_NOT_N: r = ~a; break;
        case OpCode.TYPEOF:    r = typeof a; break;
        case OpCode.VOID:      r = void 0; break;
        case OpCode.TO_NUMBER: r = Number(a); break;
        case OpCode.TO_STRING: r = String(a); break;
        case OpCode.TO_OBJECT: return null;
        default: return null;
    }
    return wrapImmediate(r);
}


function bfs (entry: BasicBlock, exit: BasicBlock, callback: (bb: BasicBlock)=>void): void
{
    var visited: boolean[] = [];
    var queue: BasicBlock[] = [];

    function enque (bb: BasicBlock): void {
        if (!visited[bb.id]) {
            visited[bb.id] = true;
            queue.push(bb);
        }
    }
    function visit (bb: BasicBlock): void {
        callback(bb);
        for (var i = 0, e = bb.succ.length; i < e; ++i)
            enque(bb.succ[i].bb );
    }

    // Mark the exit node as visited to guarantee we will visit it last
    visited[exit.id] = true;

    visited[entry.id] = true;
    visit(entry);
    while (queue.length)
        visit(queue.shift());
    // Finally generate the exit node
    visit(exit);
}

function dfs (entry: BasicBlock, exit: BasicBlock, callback: (bb: BasicBlock)=>void): void
{
    var visited: boolean[] = [];
    var stack: BasicBlock[] = [];

    function push (bb: BasicBlock): void {
        if (!visited[bb.id]) {
            visited[bb.id] = true;
            stack.push(bb);
        }
    }
    function visit (bb: BasicBlock): void {
        callback(bb);
        //NOTE: in our current naive algorithm, this visit order produces "slightly" better results
        //for (var i = 0, e = bb.succ.length; i < e; ++i)
        for (var i = bb.succ.length - 1; i >= 0; --i)
            push(bb.succ[i].bb );
    }

    // Mark the exit node as visited to guarantee we will visit it last
    visited[exit.id] = true;

    visited[entry.id] = true;
    visit(entry);
    var bb: BasicBlock;
    while ((bb = stack.pop()) !== void 0)
        visit(bb);

    // Finally generate the exit node
    visit(exit);
}

function buildBlockList (entry: BasicBlock, exit: BasicBlock): BasicBlock[]
{
    var blockList: BasicBlock[] = [];
    dfs(entry, exit, (bb: BasicBlock) => blockList.push(bb));
    return blockList;
}

function mangleName (name: string): string
{
    var res: string = "";
    var lastIndex = 0;
    for ( var i = 0, len = name.length; i < len; ++i ) {
        var ch = name[i];
        if (!(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch === '_')) {
            if (lastIndex < i)
                res += name.slice(lastIndex, i);
            res += '_';
            lastIndex = i + 1;
        }
    }
    if (lastIndex === 0)
        return name;
    if (lastIndex < i)
        res += name.slice(lastIndex, i);
    return res;
}

export class FunctionBuilder
{
    public id: number;
    public module: ModuleBuilder;
    public parentBuilder: FunctionBuilder;
    public closureVar: Var; //< variable in the parent where this closure is kept
    public name: string;
    public mangledName: string; // Name suitable for code generation
    public runtimeVar: string = null;
    public isBuiltIn = false;

    public fileName: string = null;
    public line: number = 0;
    public column: number = 0;

    // The nesting level of this function's environment
    private envLevel: number;

    private params: Param[] = [];
    private locals: Local[] = [];
    private vars: Var[] = [];
    private envSize: number = 0; //< the size of the escaping environment block
    private paramSlotsCount: number = 0; //< number of slots to copy params into
    private paramSlots: Local[] = null;
    private argSlotsCount: number = 0; //< number of slots we need to reserve for calling
    private argSlots: ArgSlot[] = [];
    private tryRecordCount: number = 0;

    private lowestEnvAccessed: number = -1;

    private nextParamIndex = 0;
    private nextLocalId = 1;
    private nextLabelId = 0;
    private nextBBId = 0;

    private closed = false;
    private curBB: BasicBlock = null;
    private entryBB: BasicBlock = null;
    private exitBB: BasicBlock = null;
    private exitLabel: Label = null;

    public closures: FunctionBuilder[] = [];

    constructor(id: number, module: ModuleBuilder, parentBuilder: FunctionBuilder, closureVar: Var, name: string)
    {
        this.id = id;
        this.module = module;
        this.parentBuilder = parentBuilder;
        this.closureVar = closureVar;
        this.name = name;
        this.mangledName = "fn" + id;
        if (name)
            this.mangledName += "_" + mangleName(name);

        this.envLevel = parentBuilder ? parentBuilder.envLevel + 1 : 0;

        this.nextLocalId = parentBuilder ? parentBuilder.nextLocalId+1 : 1;

        this.entryBB = this.getBB();
        this.exitLabel = this.newLabel();
    }

    public getEnvLevel (): number
    {
        return this.envLevel;
    }
    public getEnvSize (): number
    {
        return this.envSize;
    }
    public getLocalsLength (): number
    {
        return this.locals.length;
    }
    public getParamsLength (): number
    {
        return this.params.length;
    }
    public getParamSlotsCount (): number
    {
        return this.paramSlotsCount;
    }
    public getTryRecordCount (): number
    {
        return this.tryRecordCount;
    }
    public getBlockListLength (): number
    {
        return this.blockList.length;
    }
    public getBlock (n: number): BasicBlock
    {
        return this.blockList[n];
    }
    public getLowestEnvAccessed (): number
    {
        return this.lowestEnvAccessed;
    }

    toString() { return `Function(${this.id}/*${this.mangledName}*/)`; }

    newClosure (name: string): FunctionBuilder
    {
        var fref = new FunctionBuilder(this.module.newFunctionId(), this.module, this, this.newVar(name), name);
        this.closures.push(fref);
        return fref;
    }

    newBuiltinClosure (name: string, mangledName: string, runtimeVar: string): FunctionBuilder
    {
        var fref = this.newClosure(name);
        fref.mangledName = mangledName;
        fref.runtimeVar = runtimeVar;
        fref.isBuiltIn = true;
        return fref;
    }

    newParam(name: string): Param
    {
        var param = new Param(this.nextLocalId++, this.nextParamIndex++, name, this.newVar(name));
        this.params.push(param);
        return param;
    }

    private getArgSlot(index: number): ArgSlot
    {
        if (index < this.argSlots.length)
            return this.argSlots[index];
        assert(index === this.argSlots.length);

        var argSlot = new ArgSlot(this.nextLocalId++, this.argSlotsCount++);
        this.argSlots.push(argSlot);
        return argSlot;
    }

    newVar(name: string): Var
    {
        var v = new Var(this.nextLocalId++, this.envLevel, name);
        this.vars.push(v);
        return v;
    }

    newLocal(): Local
    {
        var loc = new Local(this.nextLocalId++, this.locals.length);
        this.locals.push(loc);
        return loc;
    }

    newLabel(): Label
    {
        var lab = new Label(this.nextLabelId++);
        return lab;
    }

    setVarAttributes (
        v: Var, escapes: boolean, accessed: boolean, constant: boolean,
        funcRef: FunctionBuilder, consRef: FunctionBuilder
    ): void
    {
        v.escapes = escapes;
        v.constant = constant;
        v.accessed = accessed;

        if (constant) {
            v.funcRef = funcRef;
            v.consRef = consRef;
        }
    }

    private getBB (): BasicBlock
    {
        if (this.curBB)
            return this.curBB;
        else
            return this.curBB = new BasicBlock(this.nextBBId++);
    }

    getCurBB (): BasicBlock
    {
        return this.curBB;
    }
    closeBB (): void
    {
        this.curBB = null;
    }
    openBB (bb: BasicBlock): void
    {
        this.closeBB();
        this.curBB = bb;
    }

    genClosure(dest: LValue, func: FunctionBuilder): void
    {
        this.getBB().push(new ClosureOp(dest, func));
    }
    genAsm (dest: LValue, bindings: RValue[], pat: AsmPattern): void
    {
        assert(!dest || bindings[0] === dest);
        this.getBB().push(new AsmOp(dest || nullReg, bindings, pat));
    }

    genBeginTry (onNormal: Label, onException: Label): number
    {
        var tryId = this.tryRecordCount++;
        this.getBB().jump(new BeginTryOp(tryId, onNormal, onException));
        this.closeBB();
        return tryId;
    }
    genEndTry (tryId: number): void
    {
        this.getBB().push(new EndTryOp(tryId));
    }
    genThrow (value: RValue): void
    {
        this.getBB().jump(new ThrowOp(value));
        this.closeBB();
    }

    genRet(src: RValue): void
    {
        this.getBB().jump(new RetOp(this.exitLabel, src));
        this.closeBB();
    }
    genGoto(target: Label): void
    {
        this.getBB().jump(new GotoOp(target));
        this.closeBB();
    }
    genSwitch (selector: RValue, defaultLab: Label, values: number[], targets: Label[]): void
    {
        assert(values.length === targets.length);
        if (targets.length === 1) { // optimize into IF or GOTO
            if (defaultLab)
                this.genIf(OpCode.IF_STRICT_EQ, selector, values[0], targets[0], defaultLab);
            else
                this.genGoto(targets[0]);
        }
        else {
            this.getBB().jump(new SwitchOp(selector, defaultLab, values, targets));
            this.closeBB();
        }
    }
    genIfTrue(value: RValue, onTrue: Label, onFalse: Label): void
    {
        if (isImmediate(value))
            return this.genGoto(isImmediateTrue(value) ? onTrue : onFalse);

        this.getBB().jump(new IfOp(OpCode.IF_TRUE, value, null, onTrue, onFalse));
        this.closeBB();
    }
    genIfIsObject(value: RValue, onTrue: Label, onFalse: Label): void
    {
        if (isImmediate(value))
            return this.genGoto(onFalse);

        this.getBB().jump(new IfOp(OpCode.IF_IS_OBJECT, value, null, onTrue, onFalse));
        this.closeBB();
    }
    genIf(op: OpCode, src1: RValue, src2: RValue, onTrue: Label, onFalse: Label): void
    {
        assert(op >= OpCode._BINCOND_FIRST && op <= OpCode._BINCOND_LAST);

        var folded = foldBinary(op, src1, src2);
        if (folded !== null)
            return this.genGoto(isImmediateTrue(folded) ? onTrue : onFalse);

        this.getBB().jump(new IfOp(op, src1, src2, onTrue, onFalse));
        this.closeBB();
    }

    genLabel(label: Label): void
    {
        assert(!label.bb);

        var bb = this.getBB();
        // If the current basic block is not empty, we must terminate it with a jump to the label
        if (bb.body.length) {
            this.getBB().jump(new GotoOp(label));
            this.closeBB();
            bb = this.getBB();
        }
        bb.placeLabel(label);
    }
    openLabel (label: Label): void
    {
        assert(label.bb);
        if (this.curBB !== label.bb) {
            assert(!this.curBB); // The last BB must have been closed
            this.curBB = label.bb;
        }
    }

    genBinop(op: OpCode, dest: LValue, src1: RValue, src2: RValue): void
    {
        assert(op >= OpCode._BINOP_FIRST && op <= OpCode._BINOP_LAST);
        var folded = foldBinary(op, src1, src2);
        if (folded !== null)
            return this.genAssign(dest, folded);

        // Reorder to make it cleaner. e.g. 'a=a+b' instead of 'a=b+a' and 'a=b+1' instead of 'a=1+b'
        if (isCommutative(op) && (dest === src2 || isImmediate(src1))) {
            var t = src1;
            src1 = src2;
            src2 = t;
        }

        this.getBB().push(new BinOp(op, dest, src1, src2));
    }
    genUnop(op: OpCode, dest: LValue, src: RValue): void
    {
        assert(op >= OpCode._UNOP_FIRST && op <= OpCode._UNOP_LAST);
        var folded = foldUnary(op, src);
        if (folded !== null)
            return this.genAssign(dest, folded);

        this.getBB().push(new UnOp(op, dest, src));
    }
    genCreate(dest: LValue, src: RValue): void
    {
        this.getBB().push(new UnOp(OpCode.CREATE, dest, src));
    }
    genCreateArguments(dest: LValue): void
    {
        this.getBB().push(new UnOp(OpCode.CREATE_ARGUMENTS, dest, undefinedValue));
    }
    genLoadRuntimeVar(dest: LValue, runtimeVar: string): void
    {
        this.getBB().push(new LoadSCOp(dest, SysConst.RUNTIME_VAR, runtimeVar));
    }
    genAssign(dest: LValue, src: RValue): void
    {
        if (dest === src)
            return;
        this.getBB().push(new AssignOp(dest, src));
    }

    genPropGet(dest: LValue, obj: RValue, propName: RValue): void
    {
        this.getBB().push(new BinOp(OpCode.GET, dest, obj, propName));
    }
    genPropSet(obj: RValue, propName: RValue, src: RValue): void
    {
        this.getBB().push(new PutOp(obj, propName, src));
    }

    private _genCall(op: OpCode, dest: LValue, closure: RValue, args: RValue[]): CallOp
    {
        if (dest === null)
            dest = nullReg;

        var bb = this.getBB();

        var slots: ArgSlot[] = Array<ArgSlot>(args.length);
        for ( var i = 0, e = args.length; i < e; ++i ) {
            slots[i] = this.getArgSlot(i);
            bb.push(new AssignOp(slots[i], args[i]));
        }

        var res: CallOp;
        this.getBB().push(res = new CallOp(op, dest, null, closure, slots));
        return res;
    }
    genCall(dest: LValue, closure: RValue, args: RValue[]): CallOp
    {
        return this._genCall(OpCode.CALLIND, dest, closure, args);
    }
    genCallCons(dest: LValue, closure: RValue, args: RValue[]): CallOp
    {
        return this._genCall(OpCode.CALLCONS, dest, closure, args);
    }

    genMakeForInIterator (dest: LValue, obj: RValue): void
    {
        //this.genAsm(dest, [dest, frameReg, obj], [
        //    "js::ForInIterator::make(",1,",&",0,",",2,".raw.oval);"
        //]);
        this.genAsm(dest, [dest, frameReg, obj], [
            0," = js::makeForInIteratorValue(",2,".raw.oval->makeIterator(",1,"));"
        ]);
    }
    genForInIteratorNext (more: LValue, value: LValue, iter: RValue): void
    {
        this.genAsm(more, [more, frameReg, iter, value], [
            0," = js::makeBooleanValue(((js::ForInIterator*)",2,".raw.mval)->next(",1,", &",3,"));"
        ]);
    }

    blockList: BasicBlock[] = [];

    close (): void
    {
        if (this.isBuiltIn)
            return;
        if (this.closed)
            return;
        this.closed = true;
        if (this.curBB)
            this.genRet(undefinedValue);
        this.genLabel(this.exitLabel);
        this.exitBB = this.curBB;
        this.closeBB();

        this.blockList = buildBlockList(this.entryBB, this.exitBB);
    }

    prepareForCodegen (): void
    {
        if (this.isBuiltIn)
            return;
        this.processVars();
        this.closures.forEach((fb: FunctionBuilder) => fb.prepareForCodegen());
    }

    private processVars (): void
    {
        // Allocate locals for the arg slots
        this.argSlots.forEach((a: ArgSlot) => {
            a.local = this.newLocal();
        });

        // Allocate locals
        this.vars.forEach( (v: Var) => {
            if (!v.escapes && v.accessed) {
                if (!v.formalParam)
                    v.local = this.newLocal();
            }
        });

        // Allocate parameter locals at the end of the local array
        this.paramSlotsCount = 0;
        this.paramSlots = [];

        this.vars.forEach( (v: Var) => {
            if (!v.escapes && v.accessed) {
                if (v.formalParam) {
                    v.local = this.newLocal();
                    this.paramSlots.push( v.local );
                    ++this.paramSlotsCount;
                }
            }
        });

        // Assign escaping var indexes
        this.envSize = 0;
        this.vars.forEach((v: Var) => {
            if (v.escapes && v.accessed)
                v.envIndex = this.envSize++;
        });

        // Copy parameters
        var instIndex = 0;
        this.params.forEach((p: Param) => {
            var v = p.variable;
            if (!v.param && v.accessed)
                this.entryBB.insertAt(instIndex++, new AssignOp(v, p));
        });

        // Create closures
        this.closures.forEach((fb: FunctionBuilder) => {
            var clvar = fb.closureVar;
            if (clvar && clvar.accessed) {
                var inst: Instruction;
                if (!fb.isBuiltIn)
                    inst = new ClosureOp(clvar, fb);
                else
                    inst = new LoadSCOp(clvar, SysConst.RUNTIME_VAR, fb.runtimeVar);
                this.entryBB.insertAt(instIndex++, inst);
            }
        });

        this.scanAllInstructions();

        // For now instead of finding the lowest possible environment, just find the lowest existing one
        // TODO: scan all escaping variable accesses and determine which environment we really need
        this.lowestEnvAccessed = -1; // No environment at all
        for ( var curb = this.parentBuilder; curb; curb = curb.parentBuilder ) {
            if (curb.envSize > 0) {
                this.lowestEnvAccessed = curb.envLevel;
                break;
            }
        }
    }

    /**
     * Perform operations which need to access every instruction.
     * <ul>
     * <li>Change CALLIND to CALL for all known functions.</li>
     * </ul>
     */
    private scanAllInstructions (): void
    {
        for ( var i = 0, e = this.blockList.length; i < e; ++i )
            scanBlock(this.blockList[i]);

        function scanBlock (bb: BasicBlock): void
        {
            for ( var i = 0, e = bb.body.length; i < e; ++i ) {
                var inst = bb.body[i];
                // Transform CALLIND,CALLCONS with a known funcRef/consRef into CALL(funcRef)
                //
                if (inst.op === OpCode.CALLIND) {
                    var callInst = <CallOp>inst;

                    var closure: Var;
                    if (closure = isVar(callInst.closure)) {
                        if (closure.funcRef)
                        {
                            callInst.op = OpCode.CALL;
                            callInst.fref = closure.funcRef;
                        }
                    }
                } else if (inst.op === OpCode.CALLCONS) {
                    var callInst = <CallOp>inst;

                    var closure: Var;
                    if (closure = isVar(callInst.closure)) {
                        if (closure.consRef)
                        {
                            callInst.op = OpCode.CALL;
                            callInst.fref = closure.consRef;
                        }
                    }
                }
            }
        }
    }

    dump (): void
    {
        if (this.isBuiltIn)
            return;
        assert(this.closed);

        this.closures.forEach((ifb: FunctionBuilder) => {
            ifb.dump();
        });

        function ss (slots: Local[]): string {
            if (!slots || !slots.length)
                return "0";
            return `${slots[0].index}..${slots[slots.length-1].index}`;
        }

        console.log(`\n${this.mangledName}://${this.name}`);

        var pslots: string;
        if (!this.paramSlots || !this.paramSlots.length)
            pslots = "0";
        else
            pslots = `${this.paramSlots[0].index}..${this.paramSlots[this.paramSlots.length-1].index}`;
        var aslots: string;
        if (!this.argSlots || !this.argSlots.length)
            aslots = "0";
        else
            aslots = `${this.argSlots[0].local.index}..${this.argSlots[this.argSlots.length-1].local.index}`;

        console.log(`//locals: ${this.locals.length} paramSlots: ${pslots} argSlots: ${aslots} env: ${this.envSize}`);

        for ( var i = 0, e = this.blockList.length; i < e; ++i ) {
            var bb = this.blockList[i];
            console.log(`B${bb.id}:`);
            bb.body.forEach( (inst: Instruction) => {
                console.log(`\t${inst}`);
            });
        }
    }
}

export class ModuleBuilder
{
    private nextFunctionId = 0;
    private topLevel: FunctionBuilder = null;

    /** Headers added with the __asmh__ compiler extension */
    private asmHeaders : string[] = [];
    private asmHeadersSet = new StringMap<Object>();

    public debugMode: boolean = false;

    constructor(debugMode: boolean)
    {
        this.debugMode = debugMode;
    }

    getTopLevel (): FunctionBuilder
    {
        return this.topLevel;
    }

    getAsmHeaders (): string[]
    {
        return this.asmHeaders;
    }

    isDebugMode (): boolean
    {
        return this.debugMode;
    }

    addAsmHeader (h: string)
    {
        if (!this.asmHeadersSet.has(h)) {
            this.asmHeadersSet.set(h, null);
            this.asmHeaders.push(h);
        }
    }

    newFunctionId (): number
    {
        return this.nextFunctionId++;
    }

    createTopLevel(): FunctionBuilder
    {
        assert(!this.topLevel);
        var fref = new FunctionBuilder(this.newFunctionId(), this, null, null, "<global>");
        this.topLevel = fref;
        return fref;
    }

    prepareForCodegen (): void
    {
        this.topLevel.prepareForCodegen();
    }
}
