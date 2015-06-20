// Copyright (c) 2015 Tzvetan Mikov.
// Licensed under the Apache License v2.0. See LICENSE in the project
// root for complete license information.

/// <reference path="../typings/tsd.d.ts" />

import assert = require("assert");
import util = require("util");
import stream = require("stream");

import StringMap = require("../lib/StringMap");

export class MemValue
{
    constructor(public id: number) {}
}

export class LValue extends MemValue
{
}

export class NullReg extends LValue
{
    toString (): string { return "#nullReg"; }
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

export type RValue = MemValue | string | boolean | number | Regex | SpecialConstantClass;

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
export var nullReg = new NullReg(0);

export function uwrapImmedate (v: RValue): any
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
            return <any>v instanceof SpecialConstantClass || <any>v instanceof Regex;
    }
    return false;
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
// However things fall apart when floating point is involved because comparions between
// NaN-s always return false. So, we cannot use equivalencies involving a logical negation.
// We need '<', '<=', '==' and '!='.
// a < b
// a > b  <==> b < a
// a <= b
// a >= b <==> b <= a
// a == b
// a != b

export const enum OpCode
{
    // Special
    CLOSURE,
    ASM,

    // Binary
    STRICT_EQ,
    STRICT_NE,
    LOOSE_EQ,
    LOOSE_NE,
    LT,
    LE,
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
    IN,
    INSTANCEOF,

    // Unary
    NEG_N,
    LOG_NOT,
    BIN_NOT_N,
    TYPEOF,
    VOID,
    DELETE,
    TO_NUMBER,

    // Assignment
    ASSIGN,

    // Property access
    GET,
    PUT,

    // Call
    CALL,
    CALLIND,

    // Unconditional jumps
    RET,
    GOTO,

    // Conditional jumps
    IF_TRUE,
    IF_STRICT_EQ,
    IF_STRICT_NE,
    IF_LOOSE_EQ,
    IF_LOOSE_NE,
    IF_LT,
    IF_LE,

    _BINOP_FIRST = STRICT_EQ,
    _BINOP_LAST = INSTANCEOF,
    _UNOP_FIRST = NEG_N,
    _UNOP_LAST = TO_NUMBER,
    _IF_FIRST = IF_TRUE,
    _IF_LAST = IF_LE,
    _BINCOND_FIRST = IF_STRICT_EQ,
    _BINCOND_LAST = IF_LE,
    _JUMP_FIRST = RET,
    _JUMP_LAST = IF_LE,
}

var g_opcodeName: string[] = [
    // Special
    "CLOSURE",
    "ASM",

    // Binary
    "STRICT_EQ",
    "STRICT_NE",
    "LOOSE_EQ",
    "LOOSE_NE",
    "LT",
    "LE",
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
    "IN",
    "INSTANCEOF",

    // Unary
    "NEG_N",
    "LOG_NOT",
    "BIN_NOT_N",
    "TYPEOF",
    "VOID",
    "DELETE",
    "TO_NUMBER",

    // Assignment
    "ASSIGN",

    // Property access
    "GET",
    "PUT",

    // Call
    "CALL",
    "CALLIND",

    // Unconditional jumps
    "RET",
    "GOTO",

    // Conditional jumps
    "IF_TRUE",
    "IF_STRICT_EQ",
    "IF_STRICT_NE",
    "IF_LOOSE_EQ",
    "IF_LOOSE_NE",
    "IF_LT",
    "IF_LE",
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

export function binopToBincond (op: OpCode): OpCode
{
    assert(op >= OpCode._BINOP_FIRST && op <= OpCode._BINOP_FIRST + OpCode._BINCOND_LAST - OpCode._BINCOND_FIRST);
    return op + OpCode._BINCOND_FIRST - OpCode._BINOP_FIRST;
}

function rv2s (v: RValue): string
{
    if (v === null)
        return "";
    else if (typeof v === "string")
        return "\"" + v + "\""; // FIXME: escaping, etc
    else
        return String(v); // FIXME: regex, other types, etc
}

function oc2s (op: OpCode): string
{
    return g_opcodeName[op];
}

class Instruction {
    constructor (public op: OpCode) {}
}
class ClosureOp extends Instruction {
    constructor (public dest: LValue, public funcRef: FunctionBuilder) { super(OpCode.CLOSURE); }
    toString (): string {
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${this.funcRef})`;
    }
}
class BinOp extends Instruction {
    constructor (op: OpCode, public dest: LValue, public src1: RValue, public src2: RValue) { super(op); }
    toString (): string {
        if (this.src2)
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${rv2s(this.src1)}, ${rv2s(this.src2)})`;
        else
            return `${rv2s(this.dest)} = ${oc2s(this.op)}(${rv2s(this.src1)})`;
    }
}
class UnOp extends BinOp {
    constructor (op: OpCode, dest: LValue, src: RValue) { super(op, dest, src, null); }
}
class AssignOp extends UnOp {
    constructor (dest: LValue, src: RValue) { super(OpCode.ASSIGN, dest, src); }
    toString (): string {
        return `${rv2s(this.dest)} = ${rv2s(this.src1)}`;
    }
}

class PutOp extends Instruction {
    constructor (public obj: RValue, public propName: RValue, public src: RValue) { super(OpCode.PUT); }
    toString (): string {
        return `${oc2s(this.op)}(${rv2s(this.obj)}, ${rv2s(this.propName)}, ${rv2s(this.src)})`;
    }
}

class CallOp extends Instruction {
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
class JumpInstruction extends Instruction {
    constructor (op: OpCode, public label1: Label, public label2: Label)  { super(op); }
}
class RetOp extends JumpInstruction {
    constructor (label1: Label, public src: RValue) { super(OpCode.RET, label1, null); }
    toString (): string {
        return `ret ${this.label1}, ${rv2s(this.src)}`;
    }
}
class GotoOp extends JumpInstruction {
    constructor (target: Label) { super(OpCode.GOTO, target, null); }
    toString(): string {
        return `${oc2s(this.op)} ${this.label1}`;
    }
}
class IfOp extends JumpInstruction {
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

class AsmOp extends Instruction {
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

class BasicBlock
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
        this.body.push(inst);
    }

    jump (inst: JumpInstruction): void
    {
        this.push(inst);
        if (inst.label1)
            this.succ.push(inst.label1);
        if (inst.label2)
            this.succ.push(inst.label2);
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
    var a1: any = uwrapImmedate(v1);
    var a2: any = uwrapImmedate(v2);
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
        default:               return null;
    }

    return wrapImmediate(r);
}

export function isImmediateTrue (v: RValue): boolean
{
    assert(isImmediate(v));
    return !!uwrapImmedate(v);
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
    var a: any = uwrapImmedate(v);
    var r: any;
    switch (op) {
        case OpCode.NEG_N:     r = -a; break;
        case OpCode.LOG_NOT:   r = !a; break;
        case OpCode.BIN_NOT_N: r = ~a; break;
        case OpCode.TYPEOF:    r = typeof a; break;
        case OpCode.VOID:      r = void 0; break;
        case OpCode.DELETE:    return null;
        case OpCode.TO_NUMBER: r = Number(a); break;
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

    visit(entry);
    while (queue.length)
        visit(queue.shift());
    // Finally generate the exit node
    visit(exit);
}

function buildBlockList (entry: BasicBlock, exit: BasicBlock): BasicBlock[]
{
    var blockList: BasicBlock[] = [];
    bfs(entry, exit, (bb: BasicBlock) => blockList.push(bb));
    return blockList;
}

export class FunctionBuilder
{
    public id: number;
    public module: ModuleBuilder;
    public parentBuilder: FunctionBuilder;
    public closureVar: Var; //< variable in the parent where this closure is kept
    public name: string;

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

        this.envLevel = parentBuilder ? parentBuilder.envLevel + 1 : 0;

        this.nextLocalId = parentBuilder ? parentBuilder.nextLocalId+1 : 1;

        this.entryBB = this.getBB();
        this.exitLabel = this.newLabel();
    }

    toString() { return `Function(${this.id}/*${this.name}*/)`; }

    newClosure (name: string): FunctionBuilder
    {
        var fref = new FunctionBuilder(this.module.newFunctionId(), this.module, this, this.newVar(name), name);
        this.closures.push(fref);
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

    setVarAttributes (v: Var, escapes: boolean, accessed: boolean, constant: boolean, funcRef: FunctionBuilder): void
    {
        v.escapes = escapes;
        v.constant = constant;
        v.accessed = accessed;

        if (constant)
            v.funcRef = funcRef;
    }

    private getBB (): BasicBlock
    {
        if (this.curBB)
            return this.curBB;
        else
            return this.curBB = new BasicBlock(this.nextBBId++);
    }

    private closeBB (): void
    {
        this.curBB = null;
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
    genIfTrue(value: RValue, onTrue: Label, onFalse: Label): void
    {
        if (isImmediate(value))
            return this.genGoto(isImmediateTrue(value) ? onTrue : onFalse);

        this.getBB().jump(new IfOp(OpCode.IF_TRUE, value, null, onTrue, onFalse));
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

    genCall(dest: LValue, fref: FunctionBuilder, closure: RValue, args: RValue[]): void
    {
        if (dest === null)
            dest = nullReg;

        var bb = this.getBB();

        var slots: ArgSlot[] = Array<ArgSlot>(args.length);
        for ( var i = 0, e = args.length; i < e; ++i ) {
            slots[i] = this.getArgSlot(i);
            bb.push(new AssignOp(slots[i], args[i]));
        }

        this.getBB().push(new CallOp(OpCode.CALLIND, dest, null, closure, slots));
    }

    blockList: BasicBlock[] = [];

    close (): void
    {
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
        this.processVars();
        this.closures.forEach((fb: FunctionBuilder) => fb.prepareForCodegen());
    }

    private processVars (): void
    {
        // Allocate locals for the arg slots
        this.argSlots.forEach((a: ArgSlot) => {
            a.local = this.newLocal();
        });

        // Allocate parameter locals
        this.paramSlotsCount = 0;
        this.paramSlots = [];

        this.vars.forEach( (v: Var) => {
            if (!v.escapes && v.accessed) {
                if (v.formalParam) {
                    v.local = this.newLocal();
                    this.paramSlots.push( v.local );
                    ++this.paramSlotsCount;
                } else {
                    v.local = this.newLocal();
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
            if (clvar && clvar.accessed)
                this.entryBB.insertAt(instIndex++, new ClosureOp(clvar, fb));
        });

        this.optimizeKnownFuncRefs();

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
     * Change CALLIND to CALL for all known functions.
     */
    private optimizeKnownFuncRefs (): void
    {
        for ( var i = 0, e = this.blockList.length; i < e; ++i )
            scanBlock(this.blockList[i]);

        function scanBlock (bb: BasicBlock): void
        {
            for ( var i = 0, e = bb.body.length; i < e; ++i ) {
                var inst = bb.body[i];
                // Transform CALLIND with a known funcRef into CALL(funcRef)
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
                }
            }
        }
    }

    dump (): void
    {
        assert(this.closed);

        this.closures.forEach((ifb: FunctionBuilder) => {
            ifb.dump();
        });

        function ss (slots: Local[]): string {
            if (!slots || !slots.length)
                return "0";
            return `${slots[0].index}..${slots[slots.length-1].index}`;
        }

        console.log(`\nFUNC_${this.id}://${this.name}`);

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

    private out: NodeJS.WritableStream = null;

    private gen (...params: any[])
    {
        this.out.write(util.format.apply(null, arguments));
    }

    private strEnvAccess (envLevel: number): string
    {
        if (envLevel < 0)
            return "NULL";

        if (envLevel === this.envLevel)
            return "frame.escaped";

        var path = "env";
        for ( var fb: FunctionBuilder = this; fb = fb.parentBuilder; ) {
            if (fb.envLevel === envLevel) {
                return path;
            } else if (fb.envSize > 0) {
                path += "->parent";
            }
        }
        assert(false, util.format("cannot access envLevel %d from envLevel %d (%s)", envLevel, this.envLevel, this.name));
    }

    private strEscapingVar (v: Var): string
    {
        assert(v.escapes);
        return util.format("%s->vars[%d]", this.strEnvAccess(v.envLevel), v.envIndex);
    }


    private strMemValue (lv: MemValue): string
    {
        if (lv instanceof Var) {
            if (lv.local)
                return this.strMemValue(lv.local);
            else if (lv.param)
                return this.strMemValue(lv.param);
            else
                return this.strEscapingVar(lv);
        }
        else if (lv instanceof Param) {
            return `(argc > ${lv.index} ? argv[${lv.index}] : JS_UNDEFINED_VALUE)`;
        }
        else if (lv instanceof ArgSlot) {
            return this.strMemValue(lv.local);
        }
        else if (lv instanceof Local) {
            return `frame.locals[${lv.index}]`;
        }
        else {
            assert(false, "unsupported LValue "+ lv);
            return "???";
        }
    }

    private strRValue (rv: RValue): string
    {
        if (<any>rv instanceof MemValue)
            return this.strMemValue(<MemValue>rv);
        else if (rv === undefinedValue)
            return "JS_UNDEFINED_VALUE";
        else if (rv === nullValue)
            return "JS_NULL_VALUE";
        else if (typeof rv === "number")
            return `js::makeNumberValue(${rv})`;
        else if (typeof rv === "boolean")
            return `js::makeBooleanValue(${rv ? "true":"false"})`;
        else
            return rv2s(rv);
    }

    private strBlock (bb: BasicBlock): string
    {
        return `B${bb.id}`;
    }

    private strDest (v: LValue): string
    {
        if (v !== nullReg)
            return util.format("%s = ", this.strMemValue(v));
        else
            return "";
    }

    private generateAsm (asm: AsmOp): void
    {
        this.gen("{");
        for ( var i = 0, e = asm.pat.length; i < e; ++i )
        {
            var pe = asm.pat[i];
            if (typeof pe === "string") {
                this.gen(<string>pe);
            } else if (typeof pe === "number") {
                this.gen("(%s)", this.strRValue(asm.bindings[<number>pe]));
            } else
                assert(false, "unsupported pattern value "+ pe);
        }
        this.gen(";}\n");
    }

    private generateBinopOutofline (binop: BinOp): void
    {
        var callerStr: string = "&frame, ";
        this.gen("  %sjs::operator_%s(%s%s, %s);\n",
            this.strDest(binop.dest),
            oc2s(binop.op),
            callerStr,
            this.strRValue(binop.src1), this.strRValue(binop.src2)
        );
    }

    private strToNumber (rv: RValue): string
    {
        var callerStr: string = "&frame, ";
        return isImmediate(rv) ? String(uwrapImmedate(rv)) : util.format("js::toNumber(%s%s)", callerStr, this.strRValue(rv));
    }

    /**
     * Unwrap a value which we know is numeric
     * @param rv
     */
    private strUnwrapN (rv: RValue): string
    {
        return isImmediate(rv) ? String(uwrapImmedate(rv)) : util.format("%s.raw.nval", this.strRValue(rv));
    }

    private outNumericBinop (binop: BinOp, coper: string): void
    {
        this.gen("  %sjs::makeNumberValue(%s %s %s);\n", this.strDest(binop.dest),
            this.strToNumber(binop.src1), coper, this.strToNumber(binop.src2));
    }

    /**
     * A binary operator where we know the operands are numbers
     * @param binop
     * @param coper
     */
    private outBinop_N (binop: BinOp, coper: string): void
    {
        this.gen("  %sjs::makeNumberValue(%s %s %s);\n", this.strDest(binop.dest),
            this.strUnwrapN(binop.src1), coper, this.strUnwrapN(binop.src2));
    }

    private generateBinop (binop: BinOp): void
    {
        var callerStr: string = "";
        if (binop.op === OpCode.ADD)
            callerStr = "&frame, ";

        switch (binop.op) {
            case OpCode.ADD:   this.generateBinopOutofline(binop); break;
            case OpCode.ADD_N: this.outNumericBinop(binop, "+"); break;
            case OpCode.SUB_N: this.outNumericBinop(binop, "-"); break;
            case OpCode.MUL_N: this.outNumericBinop(binop, "*"); break;

            default:
                this.generateBinopOutofline(binop);
                break;
        }
    }

    private generateUnop (unop: UnOp): void
    {
       switch (unop.op) {
           case OpCode.TO_NUMBER:
               this.gen("  %sjs::makeNumberValue(%s);\n", this.strDest(unop.dest), this.strToNumber(unop.src1));
               break;
           default:
               assert(false, "Unsupported instruction "+ unop);
               break;
       }
    }

    private generateInst(inst: Instruction): void
    {
        switch (inst.op) {
            case OpCode.CLOSURE:
                var closureop = <ClosureOp>inst;
                this.gen("  %sjs::newFunction(&frame, %s, \"%s\", %d, %s);\n",
                    this.strDest(closureop.dest),
                    this.strEnvAccess(closureop.funcRef.lowestEnvAccessed),
                    closureop.funcRef.name || "",
                    closureop.funcRef.params.length-1,
                    this.module.strFunc(closureop.funcRef)
                );
                break;
            case OpCode.ASM:
                this.generateAsm(<AsmOp>inst);
                break;
            case OpCode.ASSIGN:
                var assignop = <AssignOp>inst;
                this.gen("  %s%s;\n", this.strDest(assignop.dest), this.strRValue(assignop.src1));
                break;
            case OpCode.CALL:
                // TODO: self tail-recursion optimization
                var callop = <CallOp>inst;
                this.gen("  %s%s(&frame, %s, %d, &%s);\n",
                    this.strDest(callop.dest),
                    this.module.strFunc(callop.fref),
                    this.strEnvAccess(callop.fref.lowestEnvAccessed),
                    callop.args.length,
                    this.strMemValue(callop.args[0])
                );
                break;
            case OpCode.CALLIND:
                var callop = <CallOp>inst;
                this.gen("  js::call(&frame, %s, %d, &%s);\n",
                    this.strRValue(callop.closure),
                    callop.args.length,
                    this.strMemValue(callop.args[0])
                );
                break;
            default:
                if (inst.op >= OpCode._BINOP_FIRST && inst.op <= OpCode._BINOP_LAST) {
                    this.generateBinop(<BinOp>inst);
                } else if (inst.op >= OpCode._UNOP_FIRST && inst.op <= OpCode._UNOP_LAST) {
                    this.generateUnop(<UnOp>inst);
                }
                else {
                    assert(false, "Unsupported instruction "+ inst);
                }
                break;
        }
    }

    /**
     * Generate a jump instruction, taking care of the fall-through case.
     * @param inst
     * @param nextBB
     */
    private generateJump (inst: Instruction, nextBB: BasicBlock): void
    {
        assert(inst instanceof JumpInstruction);
        var jump = <JumpInstruction>inst;

        var bb1 = jump.label1 && jump.label1.bb;
        var bb2 = jump.label2 && jump.label2.bb;

        if (jump.op === OpCode.GOTO) {
            if (bb1 !== nextBB)
            this.gen("  goto %s;\n", this.strBlock(bb1));
        }
        else if (jump.op >= OpCode._IF_FIRST && jump.op <= OpCode._IF_LAST) {
            var ifop = <IfOp>(jump);
            var cond: string;
            if (jump.op >= OpCode._BINCOND_FIRST && jump.op <= OpCode._BINCOND_LAST) {
                cond = util.format("operator_%s(%s, %s)",
                                    oc2s(ifop.op), this.strRValue(ifop.src1), this.strRValue(ifop.src2));
            } else {
                cond = util.format("operator_%s(%s)", oc2s(ifop.op), this.strRValue(ifop.src1));
            }

            if (bb2 === nextBB)
                this.gen("  if (%s) goto %s;\n", cond, this.strBlock(bb1));
            else if (bb1 === nextBB)
                this.gen("  if (!%s) goto %s;\n", cond, this.strBlock(bb2));
            else
                this.gen("  if (%s) goto %s; else goto %s;\n", cond, this.strBlock(bb1), this.strBlock(bb2));
        }
        else if (jump.op === OpCode.RET) {
            var retop = <RetOp>jump;
            this.gen("  return %s;\n", this.strRValue(retop.src));
        }
        else
            assert(false, "unknown instructiopn "+ jump);
    }

    private _generateC (): void
    {
        var gen = this.gen.bind(this);
        gen("\n// %s\n/*static*/ js::TaggedValue %s (js::StackFrame * caller, js::Env * env, unsigned argc, const js::TaggedValue * argv)\n{\n",
            this.name || "<unnamed>", this.module.strFunc(this)
        );
        gen("  js::StackFrameN<%d,%d,%d> frame(caller, env, __FILE__ \":%s\", __LINE__);\n\n",
            this.envSize, this.locals.length, this.paramSlotsCount,
            this.name || "<unnamed>"
        );

        // Keep track if the very last thing we generated was a label, so we can add a ';' after i
        // at the end
        var labelWasLast = false;
        for ( var bi = 0, be = this.blockList.length; bi < be; ++bi ) {
            var bb = this.blockList[bi];
            labelWasLast = bb.body.length === 0;
            gen("%s:\n", this.strBlock(bb));
            for ( var ii = 0, ie = bb.body.length-1; ii < ie; ++ii )
                this.generateInst(bb.body[ii]);

            if (ie >= 0)
                this.generateJump(bb.body[ii], bi < be - 1 ? this.blockList[bi+1] : null);
        }
        if (labelWasLast)
            gen("  ;\n");

        gen("}\n");
    }

    generateC (out: NodeJS.WritableStream): void
    {
        this.out = out;
        try
        {
            this._generateC();
        }
        finally
        {
            this.out = null;
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

    addAsmHeader (h: string) {
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

    strFunc (fref: FunctionBuilder): string
    {
        return util.format("fn%d", fref.id);
    }

    private out: NodeJS.WritableStream = null;

    private gen (...params: any[])
    {
        this.out.write(util.format.apply(null, arguments));
    }

    private _generateC (): void
    {
        if (!this.topLevel)
            return;

        var gen = this.gen.bind(this);
        gen("#include <jsc/runtime.h>\n");
        // Generate the headers added with __asmh__
        this.asmHeaders.forEach((h: string) => gen("%s\n", h));
        gen("\n");

        var forEachFunc = (fb: FunctionBuilder, cb: (fb: FunctionBuilder)=>void) => {
            if (fb !== this.topLevel)
                cb(fb);
            fb.closures.forEach((fb) => forEachFunc(fb, cb));
        };

        forEachFunc(this.topLevel, (fb) => {
            gen("/*static*/ js::TaggedValue %s (js::StackFrame*, js::Env*, unsigned, const js::TaggedValue*); // %s\n",
                this.strFunc(fb), fb.name || "<unnamed>"
            );
        });
        gen("\n");
        forEachFunc(this.topLevel, (fb) => fb.generateC(this.out));
    }

    generateC (out: NodeJS.WritableStream): void
    {
        this.out = out;
        try {
            this._generateC();
        } finally {
            this.out = null;
        }
    }
}
